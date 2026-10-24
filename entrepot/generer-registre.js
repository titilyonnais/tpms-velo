// =====================================================================
// generer-registre.js — Écrit serveur/capteurs-chariots.json
// ---------------------------------------------------------------------
// Lancer : node entrepot/generer-registre.js [nombre de chariots] [graine]
//
// Le registre est la LISTE BLANCHE du serveur : quel capteur est posé sur
// quel chariot, à quelle roue. En vrai, la maintenance le saisit quand
// elle pose les capteurs (adresse lue sur le capteur ou par une
// application de scan). Dans la maquette, on le tire de la simulation de
// l'entrepôt, avec les mêmes paramètres que le conteneur « monde ».
// =====================================================================
"use strict";
var fs = require("node:fs");
var path = require("node:path");
var TPMS = require("./node.js");

var nbChariots = Number(process.argv[2] || 8);
var graine = Number(process.argv[3] || 2026);
var monde = TPMS.creerEntrepot({ graine: graine, nbChariots: nbChariots, debutMs: 0 });
var registre = {
  _role: "Liste blanche des capteurs TPMS des chariots (saisie par la maintenance à la pose). Produite par entrepot/generer-registre.js.",
  chariots: monde.chariots.map(function (c) { return c.id; }),
  capteurs: TPMS.entrepotRegistreCapteurs(monde)
};
var fichier = path.join(__dirname, "..", "serveur", "capteurs-chariots.json");
fs.writeFileSync(fichier, JSON.stringify(registre, null, 2) + "\n");
console.log("Registre écrit : " + fichier + " (" + registre.capteurs.length + " capteurs, " + nbChariots + " chariots)");
