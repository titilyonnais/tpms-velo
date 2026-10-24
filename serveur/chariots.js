// =====================================================================
// chariots.js — Le serveur reçoit les trames des chariots par MQTT
// ---------------------------------------------------------------------
// Version industrielle (docs/orientation-industrielle.md). Les
// passerelles de l'entrepôt publient, toutes les 10 s, le lot des
// annonces Bluetooth qu'elles ont entendues. Le serveur :
//   1. VÉRIFIE le lot : sujet MQTT cohérent avec la passerelle annoncée,
//      champs, types, tailles et dates (une passerelle piratée ne doit pas
//      pouvoir remplir la base de n'importe quoi) ;
//   2. DÉCODE chaque trame avec LA MÊME logique que le boîtier
//      (logique/trame.js) : la logique sert à trois endroits ;
//   3. applique les MÊMES protections que le boîtier : liste blanche (le
//      registre des capteurs posés sur chaque chariot) et contrôle de
//      vraisemblance (logique/securite.js, plage 13 bar) ;
//   4. DÉDOUBLONNE : une annonce entendue par deux passerelles n'est
//      comptée qu'une fois, et la passerelle qui l'a entendue le plus
//      fort donne la ZONE du chariot ;
//   5. évalue l'état de chaque pneu (logique/alertes.js) et la fuite
//      lente (logique/fuite.js), note les alertes ;
//   6. garde une mesure par pneu et par minute au plus (la base ne
//      grossit pas de 40 000 lignes par heure).
//
// Requêtes SQL paramétrées uniquement, comme base.js.
// =====================================================================
"use strict";
var fs = require("node:fs");
var path = require("node:path");
var TPMS = require("../flotte/node.js");

var REGLES = {
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

var SCHEMA = `
-- Un chariot de la flotte.
CREATE TABLE IF NOT EXISTS chariots (
  id     TEXT PRIMARY KEY,                       -- "C01", "C02"...
  nom    TEXT NOT NULL,
  zone   TEXT,                                   -- dernière zone connue (quais, allées, cour)
  zone_t INTEGER                                 -- quand
);
-- Registre des capteurs (LISTE BLANCHE) : saisi par la maintenance à la pose.
CREATE TABLE IF NOT EXISTS capteurs (
  adresse    TEXT PRIMARY KEY,                   -- "C4:10:03:00:04"
  chariot_id TEXT NOT NULL REFERENCES chariots(id),
  position   TEXT NOT NULL                       -- AVG, AVD, ARG, ARD
);
-- Une mesure par pneu et par minute au plus.
CREATE TABLE IF NOT EXISTS mesures_pneus (
  id          INTEGER PRIMARY KEY,
  chariot_id  TEXT NOT NULL REFERENCES chariots(id),
  position    TEXT NOT NULL,
  t           INTEGER NOT NULL,
  pression    REAL NOT NULL, temperature REAL NOT NULL, pile INTEGER NOT NULL,
  passerelle  INTEGER NOT NULL, rssi INTEGER NOT NULL,
  UNIQUE (chariot_id, position, t)
);
CREATE INDEX IF NOT EXISTS mesures_pneus_t ON mesures_pneus (t);
-- Alertes des pneus de chariots.
CREATE TABLE IF NOT EXISTS alertes_chariots (
  id INTEGER PRIMARY KEY, chariot_id TEXT NOT NULL REFERENCES chariots(id),
  t INTEGER NOT NULL, position TEXT NOT NULL, type TEXT NOT NULL, pression REAL
);
CREATE INDEX IF NOT EXISTS alertes_chariots_t ON alertes_chariots (t);
-- État des passerelles (publié par elles, ou par le courtier : testament).
CREATE TABLE IF NOT EXISTS passerelles (
  id INTEGER PRIMARY KEY, zone TEXT, etat TEXT NOT NULL, t INTEGER NOT NULL,
  version TEXT, decalage_ntp_ms INTEGER, lots INTEGER NOT NULL DEFAULT 0, annonces INTEGER NOT NULL DEFAULT 0
);
`;

// Le registre des capteurs (en vrai : saisi par la maintenance ; dans la
// maquette : produit par entrepot/generer-registre.js).
function lireRegistre(fichier) {
  var r = JSON.parse(fs.readFileSync(fichier || path.join(__dirname, "capteurs-chariots.json"), "utf8"));
  return r.capteurs;
}

// db : connexion SQLite (base.db) ; noterRefus : base.noterRefus ;
// registre : [{ adresse, chariot, position }].
function creerReception(db, noterRefus, registre) {
  db.exec(SCHEMA);
  var R = {
    ajouterChariot: db.prepare("INSERT OR IGNORE INTO chariots (id, nom) VALUES (?, ?)"),
    ajouterCapteur: db.prepare("INSERT OR REPLACE INTO capteurs (adresse, chariot_id, position) VALUES (?, ?, ?)"),
    majZone: db.prepare("UPDATE chariots SET zone = ?, zone_t = ? WHERE id = ?"),
    insererMesure: db.prepare("INSERT OR IGNORE INTO mesures_pneus (chariot_id, position, t, pression, temperature, pile, passerelle, rssi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    insererAlerte: db.prepare("INSERT INTO alertes_chariots (chariot_id, t, position, type, pression) VALUES (?, ?, ?, ?, ?)"),
    majPasserelle: db.prepare("INSERT INTO passerelles (id, zone, etat, t, version, decalage_ntp_ms) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET zone = excluded.zone, etat = excluded.etat, t = excluded.t, " +
      "version = COALESCE(excluded.version, version), decalage_ntp_ms = COALESCE(excluded.decalage_ntp_ms, decalage_ntp_ms)"),
    compterLot: db.prepare("UPDATE passerelles SET lots = lots + 1, annonces = annonces + ? WHERE id = ?"),
    chariots: db.prepare("SELECT * FROM chariots ORDER BY id"),
    passerelles: db.prepare("SELECT * FROM passerelles ORDER BY id"),
    historique: db.prepare("SELECT position, t, pression, temperature FROM mesures_pneus WHERE chariot_id = ? AND t >= ? ORDER BY t"),
    alertes: db.prepare("SELECT * FROM alertes_chariots ORDER BY t DESC LIMIT ?")
  };
  var capteurs = new Map();      // adresse → { chariot, position }
  registre.forEach(function (c) {
    R.ajouterChariot.run(c.chariot, "Chariot " + c.chariot.slice(1));
    R.ajouterCapteur.run(c.adresse, c.chariot, c.position);
    capteurs.set(c.adresse, { chariot: c.chariot, position: c.position });
  });

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
  var S = REGLES.seuils;
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
    if (lot.annonces.length > REGLES.annoncesMaxParLot) return "trop d'annonces dans un lot";
    for (var i = 0; i < lot.annonces.length; i++) {
      var a = lot.annonces[i];
      if (!a || typeof a.t !== "number" || typeof a.rssi !== "number" || typeof a.trame !== "string") return "annonce mal formée";
      if (!/^[0-9a-f]{36}$/.test(a.trame)) return "trame qui n'est pas 18 octets en hexadécimal";
      if (a.rssi < -120 || a.rssi > 0) return "puissance reçue impossible";
      if (a.t > maintenantMs + REGLES.avanceMaxMs) return "annonce datée du futur (horloge de la passerelle ?)";
      if (a.t < maintenantMs - REGLES.ageMaxMs) return "annonce trop ancienne (rejeu ?)";
    }
    return "";
  }

  // -------------------------------------------------------------------
  // 2. Traitement d'une annonce
  // -------------------------------------------------------------------
  function traiterAnnonce(a, passerelle, zonePasserelle) {
    var octets = Uint8Array.from(Buffer.from(a.trame, "hex"));
    var mesure = TPMS.decoderTrame(octets);
    if (mesure === null) { compteurs.invalides++; return; }
    var capteur = capteurs.get(mesure.adresse);
    if (!capteur) {
      // Capteur inconnu : un autre véhicule, ou une trame inventée.
      compteurs.inconnues++;
      var dernier = dernierRefusInconnuMs.get(passerelle) || -Infinity;
      if (a.t - dernier > 60000) {
        dernierRefusInconnuMs.set(passerelle, a.t);
        noterRefus(a.t, "passerelle-" + passerelle, null, "capteur-inconnu", "capteur " + mesure.adresse + " absent du registre");
      }
      return;
    }
    var roue = roueDe(mesure.adresse);
    // Même annonce entendue par plusieurs passerelles : on ne la compte
    // qu'une fois, mais la meilleure réception décide de la zone.
    var doublon = roue.derniereTrame === a.trame && Math.abs(a.t - roue.derniereTrameMs) < REGLES.memeAnnonceMs;
    var z = zones.get(capteur.chariot);
    if (!z || a.t - z.t > REGLES.zoneValableMs || a.rssi > z.rssi) {
      zones.set(capteur.chariot, { zone: zonePasserelle, rssi: a.rssi, t: a.t });
      if (!z || z.zone !== zonePasserelle) R.majZone.run(zonePasserelle, a.t, capteur.chariot);
    }
    if (doublon) { compteurs.doublons++; return; }
    roue.derniereTrame = a.trame;
    roue.derniereTrameMs = a.t;

    var verdict = TPMS.verifierVraisemblance(roue.verification, roue.mesure, roue.dernierRecuMs, mesure, a.t, true, REGLES.pressionMaxBar);
    if (verdict === "hors-limites" || verdict === "suspecte") { compteurs.invraisemblables++; return; }
    roue.mesure = mesure;
    roue.dernierRecuMs = a.t;
    TPMS.historiqueAjouter(roue.historique, a.t, TPMS.pressionCompenseeBar(mesure.pressionBar, mesure.temperatureC));
    roue.penteBarH = TPMS.historiquePenteBarH(roue.historique);
    compteurs.acceptees++;

    var etat = TPMS.evaluerRoue(roue, capteur.position, seuils, a.t, 0, false);
    if (etat !== roue.etat) {
      roue.etat = etat;
      if (TPMS.estAlerte(etat)) R.insererAlerte.run(capteur.chariot, a.t, capteur.position, etat, mesure.pressionBar);
    }
    if (a.t - roue.dernierStockageMs >= REGLES.periodeStockageMs) {
      roue.dernierStockageMs = a.t;
      R.insererMesure.run(capteur.chariot, capteur.position, a.t, mesure.pressionBar, mesure.temperatureC, mesure.batteriePct, passerelle, a.rssi);
    }
  }

  // -------------------------------------------------------------------
  // 3. Messages MQTT reçus
  // -------------------------------------------------------------------
  // sujet : « entrepot/<site>/passerelle/<id>/trames » ou « .../etat ».
  // Retourne "" si accepté, sinon la raison du refus.
  function recevoirMessage(sujet, contenu, maintenantMs) {
    var m = /^entrepot\/[a-z0-9-]{1,32}\/passerelle\/([0-9]{1,3})\/(trames|etat)$/.exec(sujet);
    if (!m) return "sujet inconnu";
    var idSujet = Number(m[1]);
    var objet;
    try { objet = JSON.parse(contenu.toString("utf8")); } catch (e) { objet = null; }
    if (m[2] === "etat") {
      if (!objet || typeof objet.etat !== "string") return "état illisible";
      R.majPasserelle.run(idSujet, typeof objet.zone === "string" ? objet.zone.slice(0, 16) : null, objet.etat.slice(0, 16), maintenantMs,
        typeof objet.version === "string" ? objet.version.slice(0, 16) : null,
        typeof objet.decalageNtpMs === "number" ? Math.round(objet.decalageNtpMs) : null);
      return "";
    }
    compteurs.lots++;
    var probleme = verifierLot(idSujet, objet, maintenantMs);
    if (probleme) {
      compteurs.lotsRefuses++;
      noterRefus(maintenantMs, "passerelle-" + idSujet, null, "lot-mqtt", probleme);
      return probleme;
    }
    var zone = typeof objet.zone === "string" ? objet.zone.slice(0, 16) : null;
    db.exec("BEGIN");
    try {
      objet.annonces.forEach(function (a) { traiterAnnonce(a, idSujet, zone); });
      R.majPasserelle.run(idSujet, zone, "en ligne", maintenantMs, null, null);
      R.compterLot.run(objet.annonces.length, idSujet);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return "";
  }

  // -------------------------------------------------------------------
  // 4. Lectures pour l'API
  // -------------------------------------------------------------------
  function etatDesChariots(maintenantMs) {
    var parChariot = {};
    capteurs.forEach(function (c, adresse) {
      var roue = pneus.get(adresse);
      var ch = parChariot[c.chariot] || (parChariot[c.chariot] = { pneus: {} });
      ch.pneus[c.position] = roue && roue.mesure ? {
        pression: roue.mesure.pressionBar, temperature: roue.mesure.temperatureC, pile: roue.mesure.batteriePct,
        etat: TPMS.evaluerRoue(roue, c.position, seuils, maintenantMs, 0, false), penteBarH: roue.penteBarH, t: roue.dernierRecuMs
      } : { etat: TPMS.ETAT.ATTENTE };
    });
    return R.chariots.all().map(function (l) {
      var ch = parChariot[l.id] || { pneus: {} };
      var etats = TPMS.POSITIONS_PNEU_CHARIOT.map(function (p) { return ch.pneus[p] ? ch.pneus[p].etat : TPMS.ETAT.ATTENTE; });
      // Le pire état du chariot, du plus grave au moins grave.
      var ordre = ["CREVAISON", "PERDU", "INTRUSION", "BASSE", "HAUTE", "FUITE", "ATTENTE", "OK"];
      var pire = etats.slice().sort(function (a, b) { return ordre.indexOf(a) - ordre.indexOf(b); })[0];
      return { id: l.id, nom: l.nom, zone: l.zone, zoneT: l.zone_t, etat: pire, pneus: ch.pneus };
    });
  }

  return {
    recevoirMessage: recevoirMessage,
    verifierLot: verifierLot,
    compteurs: compteurs,
    chariots: etatDesChariots,
    passerelles: function () { return R.passerelles.all(); },
    historique: function (id, depuisMs) { return R.historique.all(id, depuisMs); },
    alertes: function (limite) { return R.alertes.all(limite); },
    connu: function (id) { return R.chariots.all().some(function (c) { return c.id === id; }); }
  };
}

TPMS.POSITIONS_PNEU_CHARIOT = ["AVG", "AVD", "ARG", "ARD"];

module.exports = { creerReception: creerReception, lireRegistre: lireRegistre, REGLES: REGLES };
