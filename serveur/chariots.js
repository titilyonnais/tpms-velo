// =====================================================================
// chariots.js — Le serveur reçoit les trames des chariots par MQTT
// ---------------------------------------------------------------------
// Version industrielle (docs/orientation-industrielle.md). Les
// passerelles de l'entrepôt publient, toutes les 10 s, le lot des
// annonces Bluetooth qu'elles ont entendues.
//
// Le TRAITEMENT des lots (vérification, décodage, liste blanche,
// vraisemblance, dédoublonnage, zone, état des pneus) est dans
// entrepot/reception.js, logique pure partagée avec le mode démo de la
// page flotte/chariots.html. Ce fichier-ci ENREGISTRE ce qu'elle signale
// dans la base SQLite : chariots, capteurs, mesures (une par pneu et par
// minute), alertes, état des passerelles, refus.
//
// Requêtes SQL paramétrées uniquement, comme base.js.
// =====================================================================
"use strict";
var fs = require("node:fs");
var path = require("node:path");
var TPMS = require("../flotte/node.js");
require("../entrepot/reception.js");

var REGLES = TPMS.RECEPTION;

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
  registre.forEach(function (c) {
    R.ajouterChariot.run(c.chariot, "Chariot " + c.chariot.slice(1));
    R.ajouterCapteur.run(c.adresse, c.chariot, c.position);
  });

  // Ce que la logique de réception signale est écrit en base.
  var coeur = TPMS.creerReceptionLots(registre, {
    refus: function (t, source, motif, detail) { noterRefus(t, source, null, motif, detail); },
    zone: function (chariot, zone, t) { R.majZone.run(zone, t, chariot); },
    mesure: function (chariot, position, t, m, passerelle, rssi) {
      R.insererMesure.run(chariot, position, t, m.pressionBar, m.temperatureC, m.batteriePct, passerelle, rssi);
    },
    alerte: function (chariot, t, position, etat, pressionBar) { R.insererAlerte.run(chariot, t, position, etat, pressionBar); },
    passerelle: function (id, p) {
      R.majPasserelle.run(id, p.zone, p.etat, p.t, p.version, p.decalageNtpMs);
      if (p.annonces !== null) R.compterLot.run(p.annonces, id);
    }
  });

  // Un message = une transaction : un lot est enregistré en entier, ou pas du tout.
  function recevoirMessage(sujet, contenu, maintenantMs) {
    db.exec("BEGIN");
    try {
      var r = coeur.recevoirMessage(sujet, contenu, maintenantMs);
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  function etatDesChariots(maintenantMs) {
    var pneus = coeur.etatDesPneus(maintenantMs);
    return R.chariots.all().map(function (l) {
      var ch = pneus[l.id] || { etat: TPMS.ETAT.ATTENTE, pneus: {} };
      return { id: l.id, nom: l.nom, zone: l.zone, zoneT: l.zone_t, etat: ch.etat, pneus: ch.pneus };
    });
  }

  return {
    recevoirMessage: recevoirMessage,
    verifierLot: coeur.verifierLot,
    compteurs: coeur.compteurs,
    chariots: etatDesChariots,
    passerelles: function () { return R.passerelles.all(); },
    historique: function (id, depuisMs) { return R.historique.all(id, depuisMs); },
    alertes: function (limite) { return R.alertes.all(limite); },
    connu: function (id) { return R.chariots.all().some(function (c) { return c.id === id; }); }
  };
}

module.exports = { creerReception: creerReception, lireRegistre: lireRegistre, REGLES: REGLES };
