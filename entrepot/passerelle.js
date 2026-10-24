// =====================================================================
// passerelle.js — Programme d'une passerelle BLE → MQTT de l'entrepôt
// ---------------------------------------------------------------------
// Dans la réalité : un petit ordinateur (Raspberry Pi, ou ESP32) fixé au
// plafond d'une zone, qui écoute en Bluetooth les annonces des capteurs
// TPMS et les remonte par le réseau filaire de l'usine (VLAN OT).
// Dans la maquette : la « radio » est le réseau air (voir monde.js) ;
// la passerelle calcule la puissance qu'elle recevrait et ignore ce qui
// est hors de sa portée.
//
// Ce qu'elle fait :
//   1. elle règle sa notion de l'heure avec le serveur NTP (SNTP) ;
//   2. elle se connecte au courtier MQTT en TLS, avec SON certificat
//      (authentification mutuelle) et un « testament » : si elle disparaît
//      sans prévenir, le courtier publie à sa place « hors ligne » ;
//   3. toutes les 10 s, elle publie le lot des annonces entendues (QoS 1 :
//      le courtier accuse réception) ;
//   4. si le courtier est injoignable, elle GARDE les lots (jusqu'à 1 h)
//      et les envoie au retour du réseau (« stocker puis transmettre ») ;
//   5. elle publie son état toutes les minutes et journalise ses
//      événements sur le syslog central.
//
// Variables d'environnement :
//   PASSERELLE_ID (1, 2 ou 3), SITE (lyon), GRAINE (2026), AIR_PORT (5555),
//   COURTIER (10.10.20.10), COURTIER_PORT (8883), COURTIER_NOM (courtier),
//   CA, CERT, CLE (chemins des fichiers PEM), NTP (10.10.20.30),
//   SYSLOG (10.10.20.40), LOT_S (10).
// =====================================================================
"use strict";
var dgram = require("node:dgram");
var fs = require("node:fs");
var TPMS = require("./node.js");
var mqtt = require("./mqtt.js");
var reseau = require("./reseau.js");

var VERSION = "1.0";
var env = process.env;
var id = Number(env.PASSERELLE_ID || 1);
var site = env.SITE || "lyon";
var position = TPMS.ENTREPOT.passerelles[id - 1];
if (!position) { console.error("PASSERELLE_ID inconnu : " + id); process.exit(1); }
var alea = TPMS.creerAleaNomme(Number(env.GRAINE || 2026), "radio-passerelle" + id);
var sujetTrames = "entrepot/" + site + "/passerelle/" + id + "/trames";
var sujetEtat = "entrepot/" + site + "/passerelle/" + id + "/etat";
var LOTS_MAX = Math.round(3600 / Number(env.LOT_S || 10));   // 1 h de lots en attente au plus

var journal = reseau.creerJournal("passerelle-" + id, env.SYSLOG || null, 514);
var annonces = [];          // entendues depuis le dernier lot
var lotsEnAttente = [];     // prêts, pas encore acceptés par le courtier
var client = null;
var compteurs = { entendues: 0, horsPortee: 0, lotsEnvoyes: 0, lotsPerdus: 0 };
var decalageNtpMs = null;

// ---------------------------------------------------------------------
// 1. La radio : ce que la passerelle entend
// ---------------------------------------------------------------------
var radio = dgram.createSocket({ type: "udp4", reuseAddr: true });
radio.on("message", function (message) {
  var a;
  try { a = JSON.parse(message.toString("utf8")); } catch (e) { return; }
  if (typeof a.trame !== "string" || typeof a.x !== "number" || typeof a.y !== "number") return;
  var rssi = TPMS.entrepotRssi(position, a.x, a.y, alea);
  if (rssi === null) { compteurs.horsPortee++; return; }
  compteurs.entendues++;
  // L'heure de RÉCEPTION, celle de la passerelle (réglée par NTP).
  annonces.push({ t: Date.now(), rssi: rssi, trame: a.trame });
});
radio.bind(Number(env.AIR_PORT || 5555));

// ---------------------------------------------------------------------
// 2. L'heure (SNTP), au démarrage puis toutes les 10 min
// ---------------------------------------------------------------------
function reglerHeure() {
  if (!env.NTP) return;
  reseau.demanderHeure(env.NTP).then(function (r) {
    decalageNtpMs = Math.round(r.decalageMs);
    var gravite = Math.abs(decalageNtpMs) > 2000 ? "attention" : "info";
    journal(gravite, "heure NTP : décalage " + decalageNtpMs + " ms (aller-retour " + r.allerRetourMs + " ms, strate " + r.strate + ")");
  }).catch(function (e) { journal("attention", "NTP injoignable : " + e.message); });
}
reglerHeure();
setInterval(reglerHeure, 10 * 60000);

// ---------------------------------------------------------------------
// 3. Le courtier MQTT
// ---------------------------------------------------------------------
function etat(texte) {
  return JSON.stringify({ etat: texte, passerelle: id, zone: position.zone, version: VERSION, t: Date.now(),
    decalageNtpMs: decalageNtpMs, entendues: compteurs.entendues, lotsEnAttente: lotsEnAttente.length });
}

var attenteReconnexionMs = 1000;
function connecter() {
  mqtt.connecter({
    hote: env.COURTIER || "10.10.20.10", port: Number(env.COURTIER_PORT || 8883), nomServeur: env.COURTIER_NOM || "courtier",
    ca: env.CA ? fs.readFileSync(env.CA) : undefined, cert: env.CERT ? fs.readFileSync(env.CERT) : undefined,
    cle: env.CLE ? fs.readFileSync(env.CLE) : undefined, tls: env.SANS_TLS ? false : true,
    idClient: "passerelle-" + id, gardeS: 30,
    testament: { sujet: sujetEtat, message: JSON.stringify({ etat: "hors ligne", passerelle: id, zone: position.zone }), qos: 1, retenu: true }
  }).then(function (c) {
    client = c;
    attenteReconnexionMs = 1000;
    journal("notice", "connectée au courtier" + (env.SANS_TLS ? " (SANS TLS : essai seulement)" : " (TLS, certificat passerelle-" + id + ")") +
      (lotsEnAttente.length ? ", " + lotsEnAttente.length + " lot(s) à rattraper" : ""));
    c.publier(sujetEtat, etat("en ligne"), { qos: 1, retenu: true });
    c.surFermeture(function () {
      client = null;
      journal("attention", "connexion au courtier perdue : les lots sont gardés en attendant");
      plusTard();
    });
    vider();
  }).catch(function (e) {
    journal("erreur", "courtier injoignable ou connexion refusée : " + e.message);
    plusTard();
  });
}
function plusTard() {
  setTimeout(connecter, attenteReconnexionMs);
  attenteReconnexionMs = Math.min(30000, attenteReconnexionMs * 2);   // 1, 2, 4… 30 s
}

// Envoie les lots en attente, un par un, dans l'ordre.
var envoiEnCours = false;
function vider() {
  if (envoiEnCours || !client || lotsEnAttente.length === 0) return;
  envoiEnCours = true;
  var lot = lotsEnAttente[0];
  client.publier(sujetTrames, JSON.stringify(lot), { qos: 1 }).then(function () {
    lotsEnAttente.shift();
    compteurs.lotsEnvoyes++;
    envoiEnCours = false;
    vider();
  }).catch(function () { envoiEnCours = false; });   // connexion perdue : on réessaiera
}

// ---------------------------------------------------------------------
// 4. Un lot toutes les LOT_S secondes, l'état toutes les minutes
// ---------------------------------------------------------------------
setInterval(function () {
  if (annonces.length === 0) return;
  lotsEnAttente.push({ passerelle: id, site: site, zone: position.zone, envoiMs: Date.now(), annonces: annonces });
  annonces = [];
  if (lotsEnAttente.length > LOTS_MAX) {
    lotsEnAttente.shift();
    compteurs.lotsPerdus++;
    journal("erreur", "plus d'une heure de lots en attente : le plus ancien est perdu");
  }
  vider();
}, Number(env.LOT_S || 10) * 1000);

setInterval(function () { if (client) client.publier(sujetEtat, etat("en ligne"), { qos: 1, retenu: true }); }, 60000);

journal("info", "passerelle " + id + " (" + position.zone + ") démarrée, version " + VERSION);
connecter();

process.on("SIGTERM", function () {
  // Arrêt prévu : on publie « hors ligne » nous-mêmes, puis DISCONNECT.
  if (!client) process.exit(0);
  client.publier(sujetEtat, etat("arrêtée"), { qos: 1, retenu: true }).then(function () { client.fermer(); process.exit(0); },
    function () { process.exit(0); });
});
