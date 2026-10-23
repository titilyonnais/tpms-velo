// =====================================================================
// generer-cles-demo.js — Crée ou complète serveur/cles-demo.json
// ---------------------------------------------------------------------
// Lancement : node serveur/generer-cles-demo.js
//             node serveur/generer-cles-demo.js --nouvelles-cles   (refait les 20 clés des vélos)
//             node serveur/generer-cles-demo.js --nouveaux-jetons  (refait les jetons des comptes)
// Sans option, ce qui existe déjà est gardé : on ajoute seulement ce
// qui manque (par exemple les comptes, apparus après les clés).
//
// Le fichier contient deux sortes de secrets de DÉMONSTRATION :
//   - « velos »   : la clé HMAC de chaque vélo (32 octets = 256 bits),
//                   pour signer ses envois de mesures ;
//   - « comptes » : un jeton par personne qui LIT l'API (technicien,
//                   gestionnaire), envoyé dans l'en-tête
//                   « Authorization: Bearer <jeton> ».
// Tout est tiré par le générateur cryptographique du système
// (crypto.randomBytes), et non par Math.random() qui est prévisible.
//
// ATTENTION : ce fichier est publié dans le dépôt pour que la démo
// marche tout de suite. Ces secrets sont donc PUBLICS et ne protègent
// rien. En production : clé gravée dans chaque boîtier à la fabrication,
// coffre à secrets côté serveur, et pour les comptes seule l'EMPREINTE
// SHA-256 du jeton est stockée (champ « empreinte » au lieu de « jeton »).
// =====================================================================
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var fichier = path.join(__dirname, "cles-demo.json");
var nouvellesCles = process.argv.indexOf("--nouvelles-cles") >= 0;
var nouveauxJetons = process.argv.indexOf("--nouveaux-jetons") >= 0;

var ancien = {};
if (fs.existsSync(fichier)) ancien = JSON.parse(fs.readFileSync(fichier, "utf8"));

var config = {
  _avertissement: "SECRETS DE DÉMONSTRATION, PUBLICS : ne jamais les utiliser en production.",
  _format: "identifiant du vélo → clé HMAC-SHA256 de 32 octets en hexadécimal",
  velos: {},
  _comptes: "Comptes de LECTURE de l'API (en-tête « Authorization: Bearer <jeton> »). Jetons de démo en clair pour que " +
    "la démo marche tout de suite ; le serveur n'en garde que l'empreinte SHA-256. En production, le fichier ne " +
    "contiendrait que « empreinte » (SHA-256 du jeton, en hexadécimal), jamais le jeton.",
  comptes: {}
};

// 1. Clés des 20 vélos
for (var n = 1; n <= 20; n++) {
  var id = "V" + (n < 10 ? "0" : "") + n;
  var existante = ancien.velos && ancien.velos[id];
  config.velos[id] = (!nouvellesCles && existante) ? existante : crypto.randomBytes(32).toString("hex");
}

// 2. Comptes de lecture : un rôle chacun.
//    technicien   : vélos, historique, alertes, statistiques (la tournée) ;
//    gestionnaire : tout cela, plus le journal de sécurité (/api/refus).
// Jeton : 24 octets aléatoires (192 bits) écrits en base64url (32
// caractères sans « + », « / » ni « = », faciles à copier).
["technicien", "gestionnaire"].forEach(function (nom) {
  var compte = ancien.comptes && ancien.comptes[nom];
  if (nouveauxJetons || !compte) compte = { role: nom, jeton: crypto.randomBytes(24).toString("base64url") };
  config.comptes[nom] = compte;
});

fs.writeFileSync(fichier, JSON.stringify(config, null, 2) + "\n");
console.log("Fichier écrit : " + fichier);
console.log("20 clés de vélos" + (nouvellesCles ? " (nouvelles)" : ""));
Object.keys(config.comptes).forEach(function (nom) {
  console.log("Compte « " + nom + " » : jeton " + config.comptes[nom].jeton);
});
