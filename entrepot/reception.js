// =====================================================================
// reception.js — Réception des lots des passerelles (logique pure)
// ---------------------------------------------------------------------
// Ce que fait la supervision de chaque message MQTT des passerelles,
// SANS base de données : utilisable dans Node (serveur/chariots.js, qui
// enregistre en SQLite) ET dans le navigateur (mode démo de
// flotte/chariots.html). Le temps est passé en paramètre.
// Nécessite : logique/trame.js, fuite.js, alertes.js, securite.js.
//
// Pour chaque lot :
//   1. VÉRIFIER le lot : sujet MQTT cohérent avec la passerelle annoncée,
//      champs, types, tailles et dates (une passerelle piratée ne doit pas
//      pouvoir remplir la base de n'importe quoi) ;
//   2. DÉCODER chaque trame avec LA MÊME logique que le boîtier
//      (logique/trame.js) : la logique sert à trois endroits ;
//   3. appliquer les MÊMES protections que le boîtier : liste blanche (le
//      registre des capteurs posés sur chaque chariot) et contrôle de
//      vraisemblance (logique/securite.js, plage 13 bar) ;
//   4. DÉDOUBLONNER : une annonce entendue par deux passerelles n'est
//      comptée qu'une fois (les lots des passerelles arrivent l'un après
//      l'autre : on garde les trames des dernières secondes de chaque
//      capteur) ; la ZONE du chariot vient de la passerelle qui l'entend
//      le mieux EN MOYENNE (puissance lissée, hystérésis de 3 dB : une
//      seule annonce bruitée ne fait plus changer de zone) ;
//   5. évaluer l'état de chaque pneu (logique/alertes.js) sur la pression
//      RAMENÉE À 20 °C (un pneu qui sort dans la cour froide n'est pas
//      « bas » pour autant), la fuite rapide (logique/fuite.js, en bar/h)
//      et la FUITE LENTE sur plusieurs jours (tendance depuis le dernier
//      regonflage, en bar/jour) ; signaler les alertes, y compris
//      « capteur perdu » (contrôle des silences à chaque message) ;
//   6. garder une mesure par pneu et par minute au plus (la base ne
//      grossit pas de 40 000 lignes par heure).
// Ce qui doit être enregistré est confié à des « rappels » (voir plus bas).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.POSITIONS_PNEU_CHARIOT = ["AVG", "AVD", "ARG", "ARD"];

TPMS.RECEPTION = {
  pressionMaxBar: 13,          // plage des capteurs « poids lourd »
  annoncesMaxParLot: 2000,
  ageMaxMs: 2 * 3600000,       // une passerelle garde au plus 1 h de lots : 2 h de marge
  avanceMaxMs: 60000,          // une date dans le futur au-delà de 60 s : horloge fausse ou rejeu
  memeAnnonceMs: 3000,         // même trame, même capteur, à moins de 3 s : une seule annonce
  zoneValableMs: 30000,        // une passerelle qui n'a rien entendu depuis 30 s ne compte plus pour la zone
  zoneLissage: 0.3,            // moyenne glissante de la puissance reçue (poids de la nouvelle annonce)
  zoneHystereseDb: 3,          // il faut 3 dB de mieux, en moyenne, pour changer de zone
  // Fuite lente : tendance de la pression ramenée à 20 °C depuis le dernier
  // regonflage (une remontée de plus de 0,1 bar coupe la série), sur 12 h
  // au moins, un point toutes les 10 min.
  fuiteLente: { seuilBarJour: -0.1, dureeMinH: 12, periodePointMs: 600000, regonflageBar: 0.1, conserverH: 96 },
  periodeStockageMs: 60000,    // une mesure par pneu et par minute en base
  // Seuils des pneus de chariot (HYPOTHÈSE : pression constructeur 8,5 bar),
  // comparés à la pression ramenée à 20 °C.
  seuils: { basBar: 7.8, hautBar: 9.5, crevaisonBar: 4.0, fuiteBarH: -0.15, delaiPerteMs: 600000 }
};

// registre : [{ adresse: "C4:10:01:00:01", chariot: "C01", position: "AVG" }]
// rappels (tous facultatifs) :
//   refus(t, source, motif, detail)                  lot ou capteur refusé
//   zone(chariot, zone, t)                           le chariot a changé de zone
//   mesure(chariot, position, t, mesure, passerelle, rssi)   au plus 1 par minute et par pneu
//   alerte(chariot, t, position, etat, pressionBar)  un pneu passe en alerte
//   passerelle(id, { zone, etat, t, version, decalageNtpMs, annonces })
//       état publié par la passerelle (ou son testament) ; annonces : taille du lot reçu
TPMS.creerReceptionLots = function (registre, rappels) {
  var R = TPMS.RECEPTION;
  var rap = rappels || {};
  function appeler(nom) { if (rap[nom]) rap[nom].apply(null, Array.prototype.slice.call(arguments, 1)); }

  var capteurs = new Map();      // adresse → { chariot, position }
  registre.forEach(function (c) { capteurs.set(c.adresse, { chariot: c.chariot, position: c.position }); });

  // En mémoire : l'état de chaque pneu (comme le boîtier) et la zone de chaque chariot.
  var pneus = new Map();         // adresse → roue
  function roueDe(adresse) {
    if (!pneus.has(adresse)) {
      pneus.set(adresse, {
        mesure: null, dernierRecuMs: -1, penteBarH: 0, intrusionJusquaMs: -1, etat: TPMS.ETAT.ATTENTE,
        verification: TPMS.creerVerification(), historique: TPMS.creerHistorique(),
        recentes: [], dernierStockageMs: -Infinity,
        tendance: [], tendanceBarJour: null, dernierPointMs: -Infinity
      });
    }
    return pneus.get(adresse);
  }
  var zones = new Map();         // chariot → { zone, passerelle, t, puissances: { passerelle: { moy, t, zone } } }
  var compteurs = { lots: 0, acceptees: 0, doublons: 0, enRetard: 0, inconnues: 0, invalides: 0, invraisemblables: 0, lotsRefuses: 0 };
  var dernierRefusInconnuMs = new Map();

  // Seuils au format de logique/alertes.js (une entrée par position).
  var S = R.seuils;
  var seuils = { crevaisonBar: S.crevaisonBar, fuiteBarH: S.fuiteBarH, delaiPerteMs: S.delaiPerteMs, delaiPerteArretMs: S.delaiPerteMs };
  TPMS.POSITIONS_PNEU_CHARIOT.forEach(function (p) { seuils[p] = { basBar: S.basBar, hautBar: S.hautBar }; });

  // -------------------------------------------------------------------
  // 1. Vérification d'un lot
  // -------------------------------------------------------------------
  // Retourne "" si le lot est valable, sinon la raison du refus.
  function verifierLot(idSujet, lot, maintenantMs) {
    if (!lot || typeof lot !== "object") return "lot illisible";
    if (lot.passerelle !== idSujet) return "le lot se dit de la passerelle " + lot.passerelle + " mais arrive sur le sujet de la passerelle " + idSujet;
    if (!Array.isArray(lot.annonces)) return "annonces manquantes";
    if (lot.annonces.length > R.annoncesMaxParLot) return "trop d'annonces dans un lot";
    for (var i = 0; i < lot.annonces.length; i++) {
      var a = lot.annonces[i];
      if (!a || typeof a.t !== "number" || typeof a.rssi !== "number" || typeof a.trame !== "string") return "annonce mal formée";
      if (!/^[0-9a-f]{36}$/.test(a.trame)) return "trame qui n'est pas 18 octets en hexadécimal";
      if (a.rssi < -120 || a.rssi > 0) return "puissance reçue impossible";
      if (a.t > maintenantMs + R.avanceMaxMs) return "annonce datée du futur (horloge de la passerelle ?)";
      if (a.t < maintenantMs - R.ageMaxMs) return "annonce trop ancienne (rejeu ?)";
    }
    return "";
  }

  // 18 octets en hexadécimal → Uint8Array (sans Buffer : marche aussi dans le navigateur).
  function octetsDe(hex) {
    var o = new Uint8Array(hex.length / 2);
    for (var i = 0; i < o.length; i++) o[i] = parseInt(hex.substr(2 * i, 2), 16);
    return o;
  }

  // -------------------------------------------------------------------
  // 2. Traitement d'une annonce
  // -------------------------------------------------------------------
  function traiterAnnonce(a, passerelle, zonePasserelle) {
    var mesure = TPMS.decoderTrame(octetsDe(a.trame));
    if (mesure === null) { compteurs.invalides++; return; }
    var capteur = capteurs.get(mesure.adresse);
    if (!capteur) {
      // Capteur inconnu : un autre véhicule, ou une trame inventée.
      // (Au plus un refus noté par minute et par passerelle.)
      compteurs.inconnues++;
      var dernier = dernierRefusInconnuMs.get(passerelle) || -Infinity;
      if (a.t - dernier > 60000) {
        dernierRefusInconnuMs.set(passerelle, a.t);
        appeler("refus", a.t, "passerelle-" + passerelle, "capteur-inconnu", "capteur " + mesure.adresse + " absent du registre");
      }
      return;
    }
    var roue = roueDe(mesure.adresse);
    // Même annonce entendue par plusieurs passerelles : on ne la compte
    // qu'une fois. On garde les trames acceptées des 15 dernières secondes
    // du capteur ; une trame identique à moins de 3 s est un doublon.
    roue.recentes = roue.recentes.filter(function (r) { return Math.abs(a.t - r.t) < 15000; });
    var doublon = roue.recentes.some(function (r) { return r.trame === a.trame && Math.abs(a.t - r.t) < R.memeAnnonceMs; });
    if (doublon) {
      compteurs.doublons++;
      noterPuissance(capteur.chariot, passerelle, zonePasserelle, a);   // une vraie réception : elle compte pour la zone
      return;
    }
    // Annonce plus ancienne que la dernière acceptée (lot d'une passerelle
    // en retard) : valable, mais elle ne doit pas faire reculer la mesure.
    if (roue.mesure && a.t <= roue.dernierRecuMs) {
      if (mesure.pressionBar > R.pressionMaxBar) { compteurs.invraisemblables++; return; }
      compteurs.enRetard++;
      roue.recentes.push({ t: a.t, trame: a.trame });
      noterPuissance(capteur.chariot, passerelle, zonePasserelle, a);
      return;
    }

    var verdict = TPMS.verifierVraisemblance(roue.verification, roue.mesure, roue.dernierRecuMs, mesure, a.t, true, R.pressionMaxBar);
    if (verdict === "hors-limites" || verdict === "suspecte") { compteurs.invraisemblables++; return; }
    roue.recentes.push({ t: a.t, trame: a.trame });
    // La zone ne bouge que sur une trame acceptée (une fausse trame
    // émise tout près d'une passerelle ne déplace pas le chariot).
    noterPuissance(capteur.chariot, passerelle, zonePasserelle, a);
    roue.mesure = mesure;
    roue.dernierRecuMs = a.t;
    var p20 = TPMS.pressionCompenseeBar(mesure.pressionBar, mesure.temperatureC);
    TPMS.historiqueAjouter(roue.historique, a.t, p20);
    roue.penteBarH = TPMS.historiquePenteBarH(roue.historique);
    noterTendance(roue, a.t, p20);
    compteurs.acceptees++;

    reevaluer(roue, capteur, a.t, mesure.pressionBar);
    if (a.t - roue.dernierStockageMs >= R.periodeStockageMs) {
      roue.dernierStockageMs = a.t;
      appeler("mesure", capteur.chariot, capteur.position, a.t, mesure, passerelle, a.rssi);
    }
  }

  // État d'un pneu : seuils sur la pression ramenée à 20 °C, puis fuite
  // lente sur plusieurs jours (si l'état est OK).
  function etatRoue(roue, position, t) {
    var vue = roue;
    if (roue.mesure) {
      vue = Object.assign({}, roue, { mesure: Object.assign({}, roue.mesure,
        { pressionBar: TPMS.pressionCompenseeBar(roue.mesure.pressionBar, roue.mesure.temperatureC) }) });
    }
    var etat = TPMS.evaluerRoue(vue, position, seuils, t, 0, false);
    if (etat === TPMS.ETAT.OK && roue.tendanceBarJour !== null && roue.tendanceBarJour < R.fuiteLente.seuilBarJour) etat = "FUITE_LENTE";
    return etat;
  }
  // Si l'état change, on le note ; une entrée en alerte est signalée.
  function reevaluer(roue, capteur, t, pressionBar) {
    var etat = etatRoue(roue, capteur.position, t);
    if (etat === roue.etat) return;
    roue.etat = etat;
    if (TPMS.estAlerte(etat)) appeler("alerte", capteur.chariot, t, capteur.position, etat, etat === TPMS.ETAT.PERDU ? null : pressionBar);
  }

  // Tendance sur plusieurs jours : un point toutes les 10 min, série
  // coupée à chaque regonflage, pente des moindres carrés en bar/jour.
  function noterTendance(roue, t, p20) {
    var F = R.fuiteLente;
    if (t - roue.dernierPointMs < F.periodePointMs) return;
    roue.dernierPointMs = t;
    var serie = roue.tendance;
    if (serie.length && p20 - serie[serie.length - 1].p > F.regonflageBar) serie.length = 0;   // regonflage
    serie.push({ t: t, p: p20 });
    while (serie.length && serie[0].t < t - F.conserverH * 3600000) serie.shift();
    roue.tendanceBarJour = null;
    if (serie.length < 3 || serie[serie.length - 1].t - serie[0].t < F.dureeMinH * 3600000) return;
    var n = serie.length, mx = 0, my = 0;
    serie.forEach(function (s) { mx += s.t / 86400000; my += s.p; });
    mx /= n; my /= n;
    var num = 0, den = 0;
    serie.forEach(function (s) { var dx = s.t / 86400000 - mx; num += dx * (s.p - my); den += dx * dx; });
    roue.tendanceBarJour = den > 0 ? num / den : null;
  }

  // Puissance reçue, lissée par passerelle ; la zone change si une autre
  // passerelle fait mieux de 3 dB en moyenne, ou si l'actuelle n'entend
  // plus rien depuis 30 s.
  function noterPuissance(chariot, passerelle, zonePasserelle, a) {
    var z = zones.get(chariot) || { zone: null, passerelle: null, t: 0, puissances: {} };
    var pu = z.puissances[passerelle];
    if (!pu || a.t - pu.t > R.zoneValableMs) pu = z.puissances[passerelle] = { moy: a.rssi, t: a.t, zone: zonePasserelle };
    else { pu.moy += R.zoneLissage * (a.rssi - pu.moy); pu.t = Math.max(pu.t, a.t); pu.zone = zonePasserelle; }
    var meilleure = null;
    Object.keys(z.puissances).forEach(function (id) {
      var q = z.puissances[id];
      if (a.t - q.t > R.zoneValableMs) return;
      if (!meilleure || q.moy > z.puissances[meilleure].moy) meilleure = id;
    });
    var actuelle = z.passerelle !== null ? z.puissances[z.passerelle] : null;
    var actuelleValable = actuelle && a.t - actuelle.t <= R.zoneValableMs;
    if (meilleure !== null && String(meilleure) !== String(z.passerelle) &&
        (!actuelleValable || z.puissances[meilleure].moy >= actuelle.moy + R.zoneHystereseDb)) {
      var ancienne = z.zone;
      z.passerelle = meilleure; z.zone = z.puissances[meilleure].zone;
      if (z.zone !== ancienne) appeler("zone", chariot, z.zone, a.t);
    }
    z.t = a.t;
    zones.set(chariot, z);
  }

  // Les silences : un pneu dont on n'a plus rien reçu depuis 10 min passe
  // « capteur perdu », même si aucune annonce n'arrive pour le dire.
  function controlerSilences(t) {
    capteurs.forEach(function (c, adresse) {
      var roue = pneus.get(adresse);
      if (roue && roue.mesure) reevaluer(roue, { chariot: c.chariot, position: c.position }, t, roue.mesure.pressionBar);
    });
  }

  // -------------------------------------------------------------------
  // 3. Messages MQTT reçus
  // -------------------------------------------------------------------
  // sujet : « entrepot/<site>/passerelle/<id>/trames » ou « .../etat » ;
  // contenu : texte JSON (ou Buffer de Node).
  // Retourne "" si accepté, sinon la raison du refus.
  function recevoirMessage(sujet, contenu, maintenantMs) {
    var m = /^entrepot\/[a-z0-9-]{1,32}\/passerelle\/([0-9]{1,3})\/(trames|etat)$/.exec(sujet);
    if (!m) return "sujet inconnu";
    var idSujet = Number(m[1]);
    var objet;
    try { objet = JSON.parse(String(contenu)); } catch (e) { objet = null; }
    controlerSilences(maintenantMs);
    if (m[2] === "etat") {
      if (!objet || typeof objet.etat !== "string") return "état illisible";
      // « Dernière nouvelle » : l'heure du message s'il la donne (un message
      // retenu relu après un redémarrage n'est pas récent), sinon l'arrivée.
      var tEtat = typeof objet.t === "number" && objet.t <= maintenantMs + R.avanceMaxMs && objet.t > maintenantMs - R.ageMaxMs ? Math.min(objet.t, maintenantMs) : maintenantMs;
      appeler("passerelle", idSujet, { zone: typeof objet.zone === "string" ? objet.zone.slice(0, 16) : null, etat: objet.etat.slice(0, 16),
        t: tEtat, version: typeof objet.version === "string" ? objet.version.slice(0, 16) : null,
        decalageNtpMs: typeof objet.decalageNtpMs === "number" ? Math.round(objet.decalageNtpMs) : null, annonces: null });
      return "";
    }
    compteurs.lots++;
    var probleme = verifierLot(idSujet, objet, maintenantMs);
    if (probleme) {
      compteurs.lotsRefuses++;
      appeler("refus", maintenantMs, "passerelle-" + idSujet, "lot-mqtt", probleme);
      return probleme;
    }
    var zone = typeof objet.zone === "string" ? objet.zone.slice(0, 16) : null;
    objet.annonces.forEach(function (a) { traiterAnnonce(a, idSujet, zone); });
    appeler("passerelle", idSujet, { zone: zone, etat: "en ligne", t: maintenantMs, version: null, decalageNtpMs: null,
      annonces: objet.annonces.length });
    return "";
  }

  // -------------------------------------------------------------------
  // 4. Lecture : l'état des pneus de chaque chariot
  // -------------------------------------------------------------------
  // Retourne { C01: { etat (le pire), pneus: { AVG: {...}, ... } }, ... }
  function etatDesPneus(maintenantMs) {
    var parChariot = {};
    capteurs.forEach(function (c, adresse) {
      var roue = pneus.get(adresse);
      var ch = parChariot[c.chariot] || (parChariot[c.chariot] = { pneus: {} });
      ch.pneus[c.position] = roue && roue.mesure ? {
        pression: roue.mesure.pressionBar, temperature: roue.mesure.temperatureC, pile: roue.mesure.batteriePct,
        pression20: Math.round(TPMS.pressionCompenseeBar(roue.mesure.pressionBar, roue.mesure.temperatureC) * 100) / 100,
        etat: etatRoue(roue, c.position, maintenantMs), penteBarH: roue.penteBarH,
        tendanceBarJour: roue.tendanceBarJour === null ? null : Math.round(roue.tendanceBarJour * 1000) / 1000, t: roue.dernierRecuMs
      } : { etat: TPMS.ETAT.ATTENTE };
    });
    Object.keys(parChariot).forEach(function (id) {
      var ch = parChariot[id];
      var etats = TPMS.POSITIONS_PNEU_CHARIOT.map(function (p) { return ch.pneus[p] ? ch.pneus[p].etat : TPMS.ETAT.ATTENTE; });
      // Le pire état du chariot, du plus grave au moins grave.
      var ordre = ["CREVAISON", "PERDU", "INTRUSION", "BASSE", "HAUTE", "FUITE", "FUITE_LENTE", "ATTENTE", "OK"];
      ch.etat = etats.slice().sort(function (a, b) { return ordre.indexOf(a) - ordre.indexOf(b); })[0];
    });
    return parChariot;
  }

  return {
    recevoirMessage: recevoirMessage,
    verifierLot: verifierLot,
    compteurs: compteurs,
    etatDesPneus: etatDesPneus,
    zoneDe: function (chariot) { var z = zones.get(chariot); return z ? z.zone : null; },
    controlerSilences: controlerSilences
  };
};
