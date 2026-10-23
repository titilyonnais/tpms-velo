// =====================================================================
// node.js — Charge dans Node.js les fichiers partagés de la flotte
// ---------------------------------------------------------------------
// Dans le navigateur, flotte/index.html charge ces fichiers par des
// balises <script>, dans le même ordre. Dans Node (serveur, script de
// flotte, tests), on les charge ici avec require : chacun ajoute ses
// fonctions à l'objet global TPMS.
//
// Utilisation : var TPMS = require("../flotte/node.js");
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
  "flotte-logique.js",
  "registre.js",
  "flotte.js"
].forEach(function (fichier) {
  require(path.join(__dirname, fichier));
});

module.exports = globalThis.TPMS;
