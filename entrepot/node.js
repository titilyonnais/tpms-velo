// =====================================================================
// node.js — Charge dans Node.js les fichiers partagés de la version
// industrielle (même principe que flotte/node.js)
// ---------------------------------------------------------------------
// Utilisation : var TPMS = require("./node.js");
// =====================================================================
var path = require("path");

[
  "../logique/trame.js",
  "../logique/fuite.js",
  "../logique/alertes.js",
  "../logique/securite.js",
  "../simulateur/monde/alea.js",
  "../simulateur/monde/atmosphere.js",
  "../simulateur/monde/pneu.js",
  "../simulateur/monde/capteur.js",
  "chariots.js",
  "reception.js",
  "usine.js"
].forEach(function (fichier) {
  require(path.join(__dirname, fichier));
});

module.exports = globalThis.TPMS;
