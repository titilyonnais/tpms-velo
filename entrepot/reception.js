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
//      comptée qu'une fois, et la passerelle qui l'a entendue le plus
//      fort donne la ZONE du chariot ;
//   5. évaluer l'état de chaque pneu (logique/alertes.js) et la fuite
//      lente (logique/fuite.js), signaler les alertes ;
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
  zoneValableMs: 30000,        // la zone d'un chariot vient de la meilleure réception des 30 s
  periodeStockageMs: 60000,    // une mesure par pneu et par minute en base
  // Seuils des pneus de chariot (HYPOTHÈSE : pression constructeur 8,5 bar).
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
        derniereTrame: null, derniereTrameMs: -Infinity, dernierStockageMs: -Infinity
      });
    }
    return pneus.get(adresse);
  }
  var zones = new Map();         // chariot → { zone, rssi, t }
  var compteurs = { lots: 0, acceptees: 0, doublons: 0, inconnues: 0, invalides: 0, invraisemblables: 0, lotsRefuses: 0 };
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
    // qu'une fois, mais la meilleure réception décide de la zone.
    var doublon = roue.derniereTrame === a.trame && Math.abs(a.t - roue.derniereTrameMs) < R.memeAnnonceMs;
    var z = zones.get(capteur.chariot);
    if (!z || a.t - z.t > R.zoneValableMs || a.rssi > z.rssi) {
      zones.set(capteur.chariot, { zone: zonePasserelle, rssi: a.rssi, t: a.t });
      if (!z || z.zone !== zonePasserelle) appeler("zone", capteur.chariot, zonePasserelle, a.t);
    }
    if (doublon) { compteurs.doublons++; return; }
    roue.derniereTrame = a.trame;
    roue.derniereTrameMs = a.t;

    var verdict = TPMS.verifierVraisemblance(roue.verification, roue.mesure, roue.dernierRecuMs, mesure, a.t, true, R.pressionMaxBar);
    if (verdict === "hors-limites" || verdict === "suspecte") { compteurs.invraisemblables++; return; }
    roue.mesure = mesure;
    roue.dernierRecuMs = a.t;
    TPMS.historiqueAjouter(roue.historique, a.t, TPMS.pressionCompenseeBar(mesure.pressionBar, mesure.temperatureC));
    roue.penteBarH = TPMS.historiquePenteBarH(roue.historique);
    compteurs.acceptees++;

    var etat = TPMS.evaluerRoue(roue, capteur.position, seuils, a.t, 0, false);
    if (etat !== roue.etat) {
      roue.etat = etat;
      if (TPMS.estAlerte(etat)) appeler("alerte", capteur.chariot, a.t, capteur.position, etat, mesure.pressionBar);
    }
    if (a.t - roue.dernierStockageMs >= R.periodeStockageMs) {
      roue.dernierStockageMs = a.t;
      appeler("mesure", capteur.chariot, capteur.position, a.t, mesure, passerelle, a.rssi);
    }
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
    if (m[2] === "etat") {
      if (!objet || typeof objet.etat !== "string") return "état illisible";
      appeler("passerelle", idSujet, { zone: typeof objet.zone === "string" ? objet.zone.slice(0, 16) : null, etat: objet.etat.slice(0, 16),
        t: maintenantMs, version: typeof objet.version === "string" ? objet.version.slice(0, 16) : null,
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
        etat: TPMS.evaluerRoue(roue, c.position, seuils, maintenantMs, 0, false), penteBarH: roue.penteBarH, t: roue.dernierRecuMs
      } : { etat: TPMS.ETAT.ATTENTE };
    });
    Object.keys(parChariot).forEach(function (id) {
      var ch = parChariot[id];
      var etats = TPMS.POSITIONS_PNEU_CHARIOT.map(function (p) { return ch.pneus[p] ? ch.pneus[p].etat : TPMS.ETAT.ATTENTE; });
      // Le pire état du chariot, du plus grave au moins grave.
      var ordre = ["CREVAISON", "PERDU", "INTRUSION", "BASSE", "HAUTE", "FUITE", "ATTENTE", "OK"];
      ch.etat = etats.slice().sort(function (a, b) { return ordre.indexOf(a) - ordre.indexOf(b); })[0];
    });
    return parChariot;
  }

  return {
    recevoirMessage: recevoirMessage,
    verifierLot: verifierLot,
    compteurs: compteurs,
    etatDesPneus: etatDesPneus,
    zoneDe: function (chariot) { var z = zones.get(chariot); return z ? z.zone : null; }
  };
};
