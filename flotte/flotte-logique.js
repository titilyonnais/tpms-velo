// =====================================================================
// flotte-logique.js — Logique du « mode flotte » (vélos de location)
// ---------------------------------------------------------------------
// LOGIQUE PURE, partagée par :
//   - le serveur Node.js (serveur/serveur.js), qui reçoit les mesures ;
//   - la page de supervision (flotte/index.html), en mode démo ;
//   - la simulation de la flotte (flotte/flotte.js).
// Le temps est toujours passé en paramètre (maintenantMs).
// Nécessite : logique/fuite.js, logique/alertes.js, logique/securite.js.
//
// Ce fichier répond à trois questions :
//   1. Un lot de mesures reçu est-il VALIDE ? (types, plages, ordre)
//      Que peut-on en garder, et combien de temps ? (RGPD)
//   2. Que s'est-il passé entre deux mesures ? (regonflage, alerte)
//   3. Quel est l'état d'un vélo pour l'entreprise ? (tendance sur
//      plusieurs jours, fuite lente, date du prochain regonflage,
//      priorité d'intervention du technicien)
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// ---------------------------------------------------------------------
// Réglages de la flotte
// ---------------------------------------------------------------------
// Vélos de location en 700×40 (≈ 2,6 L d'air), chambres butyle.
TPMS.FLOTTE = {
  nominalBar: { AV: 2.5, AR: 2.7 },    // pression de gonflage du technicien
  // « À regonfler » dès 90 % du nominal : on regonfle AVANT que le
  // boîtier n'alerte (seuil bas à 80 %), pour ne jamais louer un vélo mou.
  ratioRegonfler: 0.90,
  // Fuite lente : une chambre butyle perd naturellement ≈ 1,5 % de sa
  // pression par jour (≈ −0,04 bar/j à 2,6 bar). On parle de fuite au-delà
  // de −0,10 bar/j, plus du double. Le boîtier, lui, ne voit que les
  // fuites rapides (−0,15 bar/HEURE sur 20 min) : seul le serveur, qui
  // garde des jours de mesures, peut voir celles-ci.
  fuiteBarJour: -0.10,
  tendanceDureeMinH: 24,               // au moins 24 h de mesures : un cycle jour/nuit complet
  tendancePointsMin: 10,
  tendanceFenetreMs: 14 * 86400000,    // on ne regarde pas plus de 14 jours en arrière
  sautRegonflageBar: 0.2,              // même règle que logique/fuite.js (HISTO_SAUT_REGONFLAGE)
  silenceMuetMs: 26 * 3600000,         // plus de nouvelles depuis 26 h : boîtier « muet »
  batterieFaiblePct: 25,               // boîtier à recharger
  horizonSurveillerJ: 3                // regonflage prévu dans moins de 3 jours : « à surveiller »
};

// Seuils d'alerte des boîtiers de la flotte (80 % et ≈ 125 % du nominal).
TPMS.flotteSeuils = function () {
  var s = TPMS.seuilsParDefaut();
  s.AV = { basBar: 2.0, hautBar: 3.2 };
  s.AR = { basBar: 2.2, hautBar: 3.4 };
  return s;
};

TPMS.flotteSeuilRegonflerBar = function (roue) {
  return TPMS.FLOTTE.nominalBar[roue] * TPMS.FLOTTE.ratioRegonfler;
};

// Nom des champs d'une mesure pour une roue : ("p", "AV") → "pAv".
TPMS.flotteChamp = function (prefixe, roue) {
  return prefixe + (roue === "AV" ? "Av" : "Ar");
};

// ---------------------------------------------------------------------
// Stations de Lyon (coordonnées réelles approchées, altitude en m)
// ---------------------------------------------------------------------
TPMS.FLOTTE_STATIONS = [
  { id: "BEL", nom: "Bellecour",    lat: 45.7578, lon: 4.8320, altitudeM: 168 },
  { id: "TER", nom: "Terreaux",     lat: 45.7673, lon: 4.8337, altitudeM: 170 },
  { id: "CRX", nom: "Croix-Rousse", lat: 45.7743, lon: 4.8318, altitudeM: 254 },
  { id: "PDI", nom: "Part-Dieu",    lat: 45.7606, lon: 4.8593, altitudeM: 172 },
  { id: "JMA", nom: "Jean Macé",    lat: 45.7457, lon: 4.8424, altitudeM: 168 },
  { id: "CON", nom: "Confluence",   lat: 45.7405, lon: 4.8186, altitudeM: 164 }
];

// Tracé SCHÉMATIQUE du Rhône et de la Saône (pour la carte, pas pour naviguer).
TPMS.FLOTTE_FLEUVES = [
  { nom: "Saône", points: [[45.790, 4.814], [45.778, 4.821], [45.768, 4.827], [45.761, 4.828],
                           [45.754, 4.826], [45.747, 4.8195], [45.739, 4.8145], [45.729, 4.8160]] },
  { nom: "Rhône", points: [[45.790, 4.856], [45.779, 4.847], [45.770, 4.842], [45.762, 4.840],
                           [45.754, 4.838], [45.746, 4.833], [45.738, 4.8275], [45.729, 4.8180]] }
];

// Distance à vol d'oiseau entre deux points GPS (km), formule de haversine.
TPMS.flotteDistanceKm = function (lat1, lon1, lat2, lon2) {
  var R = 6371;                               // rayon moyen de la Terre (km)
  var rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Station la plus proche (et distance en km). Position inconnue (null,
// par exemple pendant une location) : { station: null, distanceKm: Infinity }.
TPMS.flotteStationProche = function (lat, lon) {
  var meilleure = null, dMin = Infinity;
  if (typeof lat !== "number" || typeof lon !== "number") return { station: null, distanceKm: Infinity };
  TPMS.FLOTTE_STATIONS.forEach(function (s) {
    var d = TPMS.flotteDistanceKm(lat, lon, s.lat, s.lon);
    if (d < dMin) { dMin = d; meilleure = s; }
  });
  return { station: meilleure, distanceKm: dMin };
};

// ---------------------------------------------------------------------
// Heure de Lyon (heure d'été : du dernier dimanche de mars au dernier
// dimanche d'octobre, à 1 h UTC). Calcul indépendant de l'ordinateur :
// la simulation donne le même résultat partout.
// ---------------------------------------------------------------------
function dernierDimancheUTC(annee, mois) {
  var d = new Date(Date.UTC(annee, mois + 1, 0, 1));   // dernier jour du mois, 1 h UTC
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
TPMS.flotteDecalageParisH = function (tMs) {
  var annee = new Date(tMs).getUTCFullYear();
  return (tMs >= dernierDimancheUTC(annee, 2) && tMs < dernierDimancheUTC(annee, 9)) ? 2 : 1;
};
// { heure (0..24, décimale), jourSemaine (0 = dimanche), jour (n° de jour) }
TPMS.flotteHeureLocale = function (tMs) {
  var local = tMs + TPMS.flotteDecalageParisH(tMs) * 3600000;
  var d = new Date(local);
  return {
    heure: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600,
    jourSemaine: d.getUTCDay(),
    jour: Math.floor(local / 86400000)
  };
};

// ---------------------------------------------------------------------
// 1. Validation d'un lot de mesures (côté serveur)
// ---------------------------------------------------------------------
// Principe : on n'accepte QUE ce qui est prévu (liste blanche des
// champs, des types et des plages). Tout le reste est refusé.
// Une mesure :
//   { t, pAv, pAr, tAv, tAr, pileAv, pileAr, batterie, lat, lon, km,
//     etatAv, etatAr, enLocation }
// p : pression en bar ; t... : température en °C ; pile, batterie en % ;
// km : compteur du boîtier ; etat : un état de logique/alertes.js.
// Les champs d'un capteur peuvent valoir null (capteur perdu).
// lat et lon sont FACULTATIFS (absents ou null) : pendant une location,
// le boîtier n'envoie pas sa position (RGPD, voir plus bas).
TPMS.FLOTTE_LIMITES = {
  mesuresParLotMax: 250,               // 250 mesures = 41 h à raison d'une toutes les 10 min
  futurToleranceMs: 5 * 60000,         // horloge du boîtier un peu en avance : toléré
  passeMaxMs: 60 * 86400000,           // pas de mesure de plus de 60 jours
  kmMax: 1000000
};

// Description de chaque champ : type, plage, null permis.
TPMS.FLOTTE_CHAMPS = {
  t:          { type: "entier", min: 0, max: Infinity },
  pAv:        { type: "nombre", min: 0, max: TPMS.PRESSION_MAX_BAR, nul: true },
  pAr:        { type: "nombre", min: 0, max: TPMS.PRESSION_MAX_BAR, nul: true },
  tAv:        { type: "nombre", min: TPMS.TEMPERATURE_MIN_C, max: TPMS.TEMPERATURE_MAX_C, nul: true },
  tAr:        { type: "nombre", min: TPMS.TEMPERATURE_MIN_C, max: TPMS.TEMPERATURE_MAX_C, nul: true },
  pileAv:     { type: "entier", min: 0, max: 100, nul: true },
  pileAr:     { type: "entier", min: 0, max: 100, nul: true },
  batterie:   { type: "entier", min: 0, max: 100 },
  lat:        { type: "nombre", min: -90, max: 90, nul: true, facultatif: true },
  lon:        { type: "nombre", min: -180, max: 180, nul: true, facultatif: true },
  km:         { type: "nombre", min: 0, max: TPMS.FLOTTE_LIMITES.kmMax },
  etatAv:     { type: "etat" },
  etatAr:     { type: "etat" },
  enLocation: { type: "booleen" }
};

function verifierChamp(nom, regle, valeur) {
  if (valeur === null && regle.nul) return null;
  if (regle.type === "booleen") return typeof valeur === "boolean" ? null : nom + " doit être vrai ou faux";
  if (regle.type === "etat") {
    return (typeof valeur === "string" && Object.prototype.hasOwnProperty.call(TPMS.ETAT, valeur) &&
      TPMS.ETAT[valeur] === valeur) ? null : nom + " : état inconnu";
  }
  // Nombres : typeof + isFinite écartent textes, NaN, Infinity
  if (typeof valeur !== "number" || !isFinite(valeur)) return nom + " doit être un nombre";
  if (regle.type === "entier" && !Number.isInteger(valeur)) return nom + " doit être un entier";
  if (valeur < regle.min || valeur > regle.max) return nom + " hors plage (" + valeur + ")";
  return null;
}

// corps : l'objet JSON reçu. Retourne { ok: true, mesures } ou { ok: false, erreur }.
TPMS.flotteValiderLot = function (corps, maintenantMs) {
  var L = TPMS.FLOTTE_LIMITES;
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) return { ok: false, erreur: "le corps doit être un objet JSON" };
  var cles = Object.keys(corps);
  if (cles.length !== 1 || cles[0] !== "mesures") return { ok: false, erreur: "seul le champ « mesures » est attendu" };
  var liste = corps.mesures;
  if (!Array.isArray(liste) || liste.length === 0) return { ok: false, erreur: "« mesures » doit être une liste non vide" };
  if (liste.length > L.mesuresParLotMax) return { ok: false, erreur: "trop de mesures dans le lot (max " + L.mesuresParLotMax + ")" };

  var propres = [];
  var tPrecedent = -Infinity;
  for (var i = 0; i < liste.length; i++) {
    var m = liste[i];
    if (m === null || typeof m !== "object" || Array.isArray(m)) return { ok: false, erreur: "mesure " + i + " : objet attendu" };
    var champs = Object.keys(m);
    for (var c = 0; c < champs.length; c++) {
      if (!Object.prototype.hasOwnProperty.call(TPMS.FLOTTE_CHAMPS, champs[c])) {
        return { ok: false, erreur: "mesure " + i + " : champ inconnu « " + String(champs[c]).slice(0, 30) + " »" };
      }
    }
    var propre = {};
    for (var nom in TPMS.FLOTTE_CHAMPS) {
      if (!Object.prototype.hasOwnProperty.call(m, nom)) {
        // Champ facultatif absent (position) : on le note null.
        if (TPMS.FLOTTE_CHAMPS[nom].facultatif) { propre[nom] = null; continue; }
        return { ok: false, erreur: "mesure " + i + " : champ « " + nom + " » manquant" };
      }
      var erreur = verifierChamp(nom, TPMS.FLOTTE_CHAMPS[nom], m[nom]);
      if (erreur) return { ok: false, erreur: "mesure " + i + " : " + erreur };
      propre[nom] = m[nom];
    }
    // Cohérence dans le temps : ni dans le futur, ni trop vieille, et
    // dans l'ordre (sinon le calcul des tendances n'a plus de sens).
    if (propre.t > maintenantMs + L.futurToleranceMs) return { ok: false, erreur: "mesure " + i + " : date dans le futur" };
    if (propre.t < maintenantMs - L.passeMaxMs) return { ok: false, erreur: "mesure " + i + " : date trop ancienne" };
    if (propre.t <= tPrecedent) return { ok: false, erreur: "mesure " + i + " : dates non croissantes" };
    tPrecedent = propre.t;
    propres.push(propre);
  }
  return { ok: true, mesures: propres };
};

// Identifiant d'un vélo : « V » + 2 chiffres. Tout le reste est refusé
// avant même d'interroger la base.
TPMS.flotteIdentifiantValide = function (id) {
  return typeof id === "string" && /^V[0-9]{2}$/.test(id);
};

// Texte signé par le vélo (HMAC-SHA256 avec sa clé secrète).
// On signe l'identifiant, l'horodatage, le numéro de séquence ET le
// corps : changer un seul caractère de l'un d'eux rend la signature fausse.
TPMS.flotteMessageASigner = function (veloId, horodatageMs, sequence, corps) {
  return veloId + "\n" + horodatageMs + "\n" + sequence + "\n" + corps;
};

// Réglages de sécurité du serveur (utilisés aussi par la démo).
TPMS.FLOTTE_SECURITE = {
  fenetreHorodatageMs: 60000,    // ±60 s entre l'horloge du vélo et celle du serveur
  corpsMaxOctets: 64 * 1024,     // 64 Kio : un lot plein (250 mesures × ≈ 230 octets) tient dedans
  requetesParMinute: 120,        // par vélo (un vrai boîtier envoie ≈ 1 lot / 30 min)
  refusParMinuteMax: 30,         // au-delà, l'adresse IP est bloquée...
  blocageMs: 5 * 60000           // ...pendant 5 minutes (anti force brute)
};

// Comparaison « à temps constant » de deux textes de même longueur :
// on parcourt TOUS les caractères, même après une différence. Une
// comparaison normale (===) s'arrête au premier caractère faux : en
// mesurant le temps de réponse, un attaquant pourrait deviner la bonne
// signature caractère par caractère (attaque temporelle).
TPMS.egaliteTempsConstant = function (a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};

// Contrôle d'authentification d'une requête POST, dans l'ordre :
//   1. identifiant et en-têtes bien formés      → 400
//   2. vélo connu (on a sa clé)                  → 401 « inconnu »
//   3. signature HMAC juste                      → 401 « signature »
//   4. horodatage dans la fenêtre de ±60 s       → 401 « horodatage »
//   5. séquence plus grande que la dernière vue  → 401 « rejeu »
// La signature est vérifiée AVANT l'horodatage et la séquence : sans
// clé, un attaquant ne peut ni rajeunir une requête ni changer son
// numéro (ils font partie du texte signé).
// r = { veloId, horodatage, sequence, signature (textes reçus),
//       signatureAttendue (hex, ou null si vélo inconnu),
//       derniereSequence, maintenantMs }
// Retourne null si tout va bien, sinon { statut, motif, detail }.
TPMS.flotteControlerRequete = function (r) {
  if (!TPMS.flotteIdentifiantValide(r.veloId)) return { statut: 400, motif: "identifiant", detail: "identifiant de vélo mal formé" };
  if (typeof r.horodatage !== "string" || !/^[0-9]{1,15}$/.test(r.horodatage) ||
      typeof r.sequence !== "string" || !/^[0-9]{1,15}$/.test(r.sequence) ||
      typeof r.signature !== "string" || !/^[0-9a-f]{64}$/.test(r.signature)) {
    return { statut: 400, motif: "en-tetes", detail: "en-têtes d'authentification absents ou mal formés" };
  }
  if (!r.signatureAttendue) return { statut: 401, motif: "inconnu", detail: "vélo inconnu" };
  if (!TPMS.egaliteTempsConstant(r.signature, r.signatureAttendue)) return { statut: 401, motif: "signature", detail: "signature invalide" };
  var ecart = r.maintenantMs - Number(r.horodatage);
  if (Math.abs(ecart) > TPMS.FLOTTE_SECURITE.fenetreHorodatageMs) {
    return { statut: 401, motif: "horodatage", detail: "horodatage hors fenêtre (" + Math.round(ecart / 1000) + " s d'écart)" };
  }
  if (Number(r.sequence) <= r.derniereSequence) {
    return { statut: 401, motif: "rejeu", detail: "séquence " + r.sequence + " déjà utilisée (dernière : " + r.derniereSequence + ")" };
  }
  return null;
};

// Séquence du prochain envoi : l'horloge en ms, ou la précédente + 1.
// Elle ne redescend jamais, même si le programme redémarre (un vrai
// boîtier garderait un compteur dans sa mémoire flash).
TPMS.flotteProchaineSequence = function (derniere, maintenantMs) {
  return Math.max(Math.floor(maintenantMs), derniere + 1);
};

// ---------------------------------------------------------------------
// 1 bis. RGPD : minimisation et durée de conservation
// ---------------------------------------------------------------------
// Pendant une location, la position du vélo EST celle du client : c'est
// une donnée personnelle (où il va, où il habite, à quelle heure...).
// Le métier (regonfler, réparer) n'en a pas besoin : le technicien ne
// passe que sur les vélos rendus en station. Principe de MINIMISATION
// (RGPD, article 5) : on ne garde que ce qui sert.
// Même règle partout, avant tout stockage : base SQLite du serveur
// (serveur/base.js) et registre du mode démo (flotte/registre.js). Le
// boîtier simulé (flotte/flotte.js) n'envoie même pas sa position
// pendant une location ; le serveur l'efface quand même si un boîtier
// mal programmé l'envoie (on ne fait pas confiance à l'émetteur).
TPMS.flotteMinimiserPosition = function (mesure) {
  var m = Object.assign({}, mesure);                 // copie : on ne modifie pas l'original
  var positionValide = typeof m.lat === "number" && typeof m.lon === "number";
  if (m.enLocation || !positionValide) {
    m.lat = null;
    m.lon = null;
  }
  return m;
};

// Durées de conservation (RGPD, article 5 : « limitation de la conservation »).
TPMS.FLOTTE_CONSERVATION = {
  // Mesures détaillées (une toutes les 10 min) et alertes : 30 jours.
  // Pourquoi 30 ? La tendance d'une roue regarde 14 jours en arrière
  // (tendanceFenetreMs) et l'historique d'un vélo en montre 30 au plus ;
  // une roue est regonflée en moyenne toutes les une à deux semaines :
  // 30 jours couvrent deux fenêtres de tendance et plusieurs regonflages.
  // Au-delà, seules restent des données agrégées (nombre et dates des
  // regonflages, tendances), qui ne décrivent plus aucun trajet.
  mesuresMs: 30 * 86400000,
  // Journal des refus : il contient des adresses IP (donnée personnelle).
  // 6 mois, durée recommandée par la CNIL pour les journaux de sécurité.
  refusMs: 183 * 86400000
};

// Date limite : tout ce qui est plus ancien est effacé. Elle se calcule
// à partir de la mesure la PLUS RÉCENTE reçue (l'instant des données),
// pas de l'horloge de l'ordinateur : la simulation compresse le temps
// (14 jours en 30 s), et rejouer d'anciennes données ne doit pas les
// faire disparaître aussitôt.
TPMS.flotteLimiteConservation = function (plusRecenteMs, dureeMs) {
  return plusRecenteMs - (dureeMs === undefined ? TPMS.FLOTTE_CONSERVATION.mesuresMs : dureeMs);
};

// ---------------------------------------------------------------------
// 2. Événements entre deux mesures successives d'un vélo
// ---------------------------------------------------------------------
// Pression ramenée à 20 °C (logique/fuite.js) : sans cela, le soleil de
// l'après-midi ressemblerait à un regonflage et la nuit à une fuite.
TPMS.flottePression20 = function (mesure, roue) {
  var p = mesure[TPMS.flotteChamp("p", roue)];
  var temp = mesure[TPMS.flotteChamp("t", roue)];
  if (p === null || temp === null || p === undefined || temp === undefined) return null;
  return TPMS.pressionCompenseeBar(p, temp);
};

// Retourne une liste d'événements :
//   { type: "regonflage", roue, avant, apres }
//   { type: "alerte", roue, alerte, pression, source }
TPMS.flotteEvenements = function (precedente, mesure) {
  var evenements = [];
  ["AV", "AR"].forEach(function (roue) {
    var etat = mesure[TPMS.flotteChamp("etat", roue)];
    var p = mesure[TPMS.flotteChamp("p", roue)];
    // Alerte du boîtier : seulement quand l'état CHANGE (pas à chaque mesure).
    var etatAvant = precedente ? precedente[TPMS.flotteChamp("etat", roue)] : null;
    if (TPMS.estAlerte(etat) && etat !== etatAvant) {
      evenements.push({ type: "alerte", roue: roue, alerte: etat, pression: p, source: "boitier" });
    }
    // Regonflage : la pression (à 20 °C) remonte d'un coup.
    if (precedente) {
      var avant = TPMS.flottePression20(precedente, roue);
      var apres = TPMS.flottePression20(mesure, roue);
      if (avant !== null && apres !== null && apres - avant > TPMS.FLOTTE.sautRegonflageBar) {
        evenements.push({ type: "regonflage", roue: roue, avant: precedente[TPMS.flotteChamp("p", roue)], apres: p });
      }
    }
  });
  // Batterie du boîtier : on prévient une fois, quand elle passe sous le seuil.
  var seuil = TPMS.FLOTTE.batterieFaiblePct;
  if (mesure.batterie < seuil && (!precedente || precedente.batterie >= seuil)) {
    evenements.push({ type: "alerte", roue: null, alerte: "BATTERIE", pression: null, source: "serveur" });
  }
  return evenements;
};

// ---------------------------------------------------------------------
// 3a. Tendance d'une roue sur plusieurs jours
// ---------------------------------------------------------------------
// points : [{ t, p, temp }] du plus ancien au plus récent (14 jours max).
// On remonte le temps depuis la dernière mesure jusqu'au dernier
// regonflage (forte BAISSE en remontant), puis on calcule la pente de la
// pression à 20 °C par les moindres carrés (logique/fuite.js).
// Retourne null s'il n'y a aucun point, sinon :
//   { penteBarJour (null si pas assez de recul), fuiteLente,
//     pressionBar (pression à 20 °C récente), seuilMs (date estimée du
//     passage sous le seuil « à regonfler »), depuisMs, dureeH, nbPoints }
// Pour aller vite sur 14 jours, on garde UNE mesure par demi-heure (la
// dernière) : 672 points au plus, largement assez pour une droite.
TPMS.FLOTTE_TRANCHE_MS = 30 * 60000;

TPMS.flotteTendance = function (points, roue) {
  var F = TPMS.FLOTTE;
  var t = [], p = [];
  var trancheGardee = null;
  for (var i = points.length - 1; i >= 0; i--) {
    var pt = points[i];
    if (pt.p === null || pt.temp === null) continue;
    var tranche = Math.floor(pt.t / TPMS.FLOTTE_TRANCHE_MS);
    if (tranche === trancheGardee) continue;        // déjà une mesure dans cette demi-heure
    trancheGardee = tranche;
    var p20 = TPMS.pressionCompenseeBar(pt.p, pt.temp);
    if (p.length > 0 && p[p.length - 1] - p20 > F.sautRegonflageBar) break;   // regonflage trouvé
    t.push(pt.t);
    p.push(p20);
  }
  if (t.length === 0) return null;
  t.reverse();
  p.reverse();

  var n = t.length;
  // Pression récente : moyenne des 6 dernières mesures (1 h), moins bruitée.
  var k = Math.min(6, n), somme = 0;
  for (var j = n - k; j < n; j++) somme += p[j];
  var recente = somme / k;

  var resultat = {
    penteBarJour: null, fuiteLente: false, pressionBar: recente, seuilMs: null,
    depuisMs: t[0], dureeH: (t[n - 1] - t[0]) / 3600000, nbPoints: n
  };
  if (n < F.tendancePointsMin || resultat.dureeH < F.tendanceDureeMinH) return resultat;

  var pente = TPMS.penteMoindresCarresParHeure(t, p) * 24;     // bar/h → bar/jour
  resultat.penteBarJour = pente;
  // Un pneu à plat n'est pas une « fuite lente » : c'est une crevaison,
  // déjà signalée par le boîtier.
  resultat.fuiteLente = pente < F.fuiteBarJour && recente >= TPMS.flotteSeuils().crevaisonBar;
  // Prochain regonflage : quand la droite passera sous le seuil.
  var seuil = TPMS.flotteSeuilRegonflerBar(roue);
  if (recente <= seuil) {
    resultat.seuilMs = t[n - 1];
  } else if (pente < 0) {
    resultat.seuilMs = Math.round(t[n - 1] + (recente - seuil) / -pente * 86400000);
  }
  return resultat;
};

// Une fuite lente vient-elle d'être découverte ? (alerte du serveur)
TPMS.flotteNouvelleFuite = function (avant, apres) {
  return !!(apres && apres.fuiteLente && !(avant && avant.fuiteLente));
};

// ---------------------------------------------------------------------
// 3b. Résumé d'un vélo pour l'entreprise : statut et priorité
// ---------------------------------------------------------------------
// fiche = { id, nom, derniere (dernière mesure ou null),
//           tendance: { AV: {penteBarJour, fuiteLente, seuilMs} | null, AR: ... } }
// Statuts, du plus grave au moins grave :
//   immobilise (crevaison) > urgent (sous le seuil bas) > regonfler
//   (sous 90 % ou fuite lente) > muet (plus de nouvelles) > surveiller > ok
// La priorité (0 à 100) sert à trier la tournée du technicien.
TPMS.FLOTTE_STATUTS = ["immobilise", "urgent", "regonfler", "muet", "surveiller", "ok"];

function nombreFr(x, n) { return x.toFixed(n).replace(".", ","); }
function nomRoue(roue) { return roue === "AV" ? "avant" : "arrière"; }

TPMS.flotteResume = function (fiche, maintenantMs) {
  var F = TPMS.FLOTTE;
  var seuils = TPMS.flotteSeuils();
  var d = fiche.derniere;
  var tend = fiche.tendance || {};
  var r = {
    id: fiche.id, nom: fiche.nom, t: null, lat: null, lon: null, station: null, enLocation: false,
    pAv: null, pAr: null, tAv: null, tAr: null, pileAv: null, pileAr: null, batterie: null, km: null,
    etatAv: null, etatAr: null, p20Av: null, p20Ar: null,
    penteAv: null, penteAr: null, fuiteAv: false, fuiteAr: false, prochainRegonflageMs: null,
    statut: "muet", priorite: 45, raison: "Aucune donnée reçue"
  };
  if (!d) return r;

  ["t", "lat", "lon", "enLocation", "pAv", "pAr", "tAv", "tAr", "pileAv", "pileAr", "batterie", "km", "etatAv", "etatAr"]
    .forEach(function (c) { r[c] = d[c]; });
  // Station : seulement si la position est connue (pas pendant une location).
  var proche = TPMS.flotteStationProche(d.lat, d.lon);
  r.station = proche.station && proche.distanceKm < 0.15 ? proche.station.nom : null;
  if (r.lat === undefined) r.lat = null;
  if (r.lon === undefined) r.lon = null;

  var statut = "ok", priorite = 0, raison = "Pneus correctement gonflés";
  function monter(nouveau, prio, texte) {
    // On garde le statut le plus grave ; à statut égal, la priorité la plus forte.
    var rangNouveau = TPMS.FLOTTE_STATUTS.indexOf(nouveau), rang = TPMS.FLOTTE_STATUTS.indexOf(statut);
    if (rangNouveau < rang || (rangNouveau === rang && prio > priorite)) {
      statut = nouveau; priorite = prio; raison = texte;
    }
  }

  ["AV", "AR"].forEach(function (roue) {
    var suffixe = roue === "AV" ? "Av" : "Ar";
    var tr = tend[roue];
    if (tr) {
      r["pente" + suffixe] = tr.penteBarJour;
      r["fuite" + suffixe] = !!tr.fuiteLente;
      if (tr.seuilMs !== null && tr.seuilMs !== undefined &&
          (r.prochainRegonflageMs === null || tr.seuilMs < r.prochainRegonflageMs)) {
        r.prochainRegonflageMs = tr.seuilMs;
      }
    }
    var etat = d["etat" + suffixe];
    var p = d["p" + suffixe];
    var p20 = TPMS.flottePression20(d, roue);
    r["p20" + suffixe] = p20;

    if (etat === TPMS.ETAT.CREVAISON || (p !== null && p < seuils.crevaisonBar)) {
      monter("immobilise", 100, "Crevaison " + nomRoue(roue) + " : vélo à réparer");
      return;
    }
    if (p20 === null) {
      monter("surveiller", 30, "Capteur " + nomRoue(roue) + " sans mesure (" + TPMS.texteEtat(etat).toLowerCase() + ")");
      return;
    }
    var bas = seuils[roue].basBar;
    var regonfler = TPMS.flotteSeuilRegonflerBar(roue);
    if (etat === TPMS.ETAT.BASSE || p20 < bas) {
      monter("urgent", 80 + Math.min(15, Math.round((bas - p20) * 30)),
        "Pression basse " + nomRoue(roue) + " : " + nombreFr(p20, 2) + " bar");
    }
    if (tr && tr.fuiteLente) {
      monter("regonfler", Math.min(85, 60 + Math.round(-tr.penteBarJour * 50)),
        "Fuite lente " + nomRoue(roue) + " (" + nombreFr(tr.penteBarJour, 2) + " bar/j) : changer la chambre");
    }
    if (p20 < regonfler) {
      monter("regonfler", 50 + Math.min(25, Math.round((regonfler - p20) * 50)),
        "Sous 90 % du gonflage " + nomRoue(roue) + " : " + nombreFr(p20, 2) + " bar");
    }
    if (TPMS.estAlerte(etat) && etat !== TPMS.ETAT.BASSE) {
      monter("surveiller", 35, "Boîtier : " + TPMS.texteEtat(etat).toLowerCase() + " (" + nomRoue(roue) + ")");
    }
  });

  if (maintenantMs - d.t > F.silenceMuetMs) {
    monter("muet", 45, "Silencieux depuis " + Math.round((maintenantMs - d.t) / 3600000) + " h (boîtier déchargé ?)");
  }
  if (d.batterie < F.batterieFaiblePct) {
    monter("surveiller", 25 + Math.round((F.batterieFaiblePct - d.batterie) / 2), "Boîtier à recharger (" + d.batterie + " %)");
  }
  if (r.prochainRegonflageMs !== null) {
    var jours = (r.prochainRegonflageMs - maintenantMs) / 86400000;
    if (jours < F.horizonSurveillerJ) {
      monter("surveiller", 20 + Math.round((F.horizonSurveillerJ - Math.max(0, jours)) * 5),
        "Regonflage à prévoir dans " + nombreFr(Math.max(0, jours), 1) + " j");
    } else if (statut === "ok") {
      priorite = Math.max(0, Math.round(10 - jours));
      raison = "Prochain regonflage estimé dans " + Math.round(jours) + " j";
    }
  }
  r.statut = statut;
  r.priorite = Math.min(100, priorite);
  r.raison = raison;
  return r;
};

// Tri de la tournée : priorité décroissante, puis identifiant.
TPMS.flotteTrierParPriorite = function (resumes) {
  return resumes.slice().sort(function (a, b) {
    return b.priorite - a.priorite || (a.id < b.id ? -1 : 1);
  });
};

// ---------------------------------------------------------------------
// 3c. Indicateurs de l'entreprise, calculés à partir des résumés
// ---------------------------------------------------------------------
TPMS.flotteIndicateurs = function (resumes) {
  var I = {
    nbVelos: resumes.length, enLocation: 0, immobilises: 0, urgents: 0, aRegonfler: 0,
    fuitesLentes: 0, boitiersARecharger: 0, muets: 0, aSurveiller: 0, ok: 0, pressionMoyennePct: null
  };
  var somme = 0, n = 0;
  resumes.forEach(function (r) {
    if (r.enLocation) I.enLocation++;
    if (r.statut === "immobilise") I.immobilises++;
    if (r.statut === "urgent") I.urgents++;
    if (r.statut === "urgent" || r.statut === "regonfler") I.aRegonfler++;
    if (r.statut === "muet") I.muets++;
    if (r.statut === "surveiller") I.aSurveiller++;
    if (r.statut === "ok") I.ok++;
    if (r.fuiteAv || r.fuiteAr) I.fuitesLentes++;
    if (r.statut === "muet" || (r.batterie !== null && r.batterie < TPMS.FLOTTE.batterieFaiblePct)) I.boitiersARecharger++;
    ["AV", "AR"].forEach(function (roue) {
      var p20 = r[TPMS.flotteChamp("p20", roue)];
      if (p20 !== null && p20 !== undefined) { somme += p20 / TPMS.FLOTTE.nominalBar[roue] * 100; n++; }
    });
  });
  if (n > 0) I.pressionMoyennePct = somme / n;
  return I;
};

// Temps moyen entre deux regonflages d'une même roue (jours), ou null.
// (Le serveur fait le même calcul en SQL avec la fonction LAG.)
TPMS.flotteTempsMoyenEntreRegonflagesJ = function (regonflages) {
  var parRoue = {};
  regonflages.forEach(function (g) {
    var cle = g.veloId + "|" + g.roue;
    (parRoue[cle] = parRoue[cle] || []).push(g.t);
  });
  var somme = 0, n = 0;
  Object.keys(parRoue).forEach(function (cle) {
    var liste = parRoue[cle].sort(function (a, b) { return a - b; });
    for (var i = 1; i < liste.length; i++) { somme += liste[i] - liste[i - 1]; n++; }
  });
  return n > 0 ? somme / n / 86400000 : null;
};
