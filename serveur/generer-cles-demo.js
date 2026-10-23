// =====================================================================
// generer-cles-demo.js — Crée serveur/cles-demo.json (20 clés de DÉMO)
// ---------------------------------------------------------------------
// Lancement : node serveur/generer-cles-demo.js
//
// Chaque vélo reçoit une clé secrète de 32 octets (256 bits) tirée par
// le générateur cryptographique du système (crypto.randomBytes), et non
// par Math.random() qui est prévisible.
//
// ATTENTION : ce fichier est publié dans le dépôt pour que la démo
// marche tout de suite. Ces clés sont donc PUBLIQUES et ne protègent
// rien. En production, chaque boîtier aurait sa clé gravée à la
// fabrication, et le serveur les lirait dans un coffre à secrets.
// =====================================================================
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var config = {
  _avertissement: "CLÉS DE DÉMONSTRATION, PUBLIQUES : ne jamais les utiliser en production.",
  _format: "identifiant du vélo → clé HMAC-SHA256 de 32 octets en hexadécimal",
  velos: {}
};
for (var n = 1; n <= 20; n++) {
  config.velos["V" + (n < 10 ? "0" : "") + n] = crypto.randomBytes(32).toString("hex");
}
var fichier = path.join(__dirname, "cles-demo.json");
fs.writeFileSync(fichier, JSON.stringify(config, null, 2) + "\n");
console.log("20 clés de démo écrites dans " + fichier);
