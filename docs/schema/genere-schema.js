// =====================================================================
// genere-schema.js — Produit docs/schema/schema-boitier.svg
// ---------------------------------------------------------------------
// Lancer :  node docs/schema/genere-schema.js
//
// Le dessin du schéma n'est PAS ici : il est dans simulateur/vues/schema.js,
// le même fichier que celui qu'utilise le simulateur pour animer le
// schéma dans la page. Un seul code de dessin, donc le schéma du dossier
// et celui du simulateur sont toujours identiques.
//
// Pour déplacer un composant : modifier ses coordonnées dans
// simulateur/vues/schema.js, puis relancer cette commande.
// =====================================================================
"use strict";
var fs = require("fs");
var path = require("path");

// schema.js est un script « navigateur » (pas un module) : il range ses
// fonctions dans l'objet global TPMS. require() suffit à l'exécuter.
require(path.join(__dirname, "..", "..", "simulateur", "vues", "schema.js"));

var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + TPMS.schemaSvg();
var sortie = path.join(__dirname, "schema-boitier.svg");
fs.writeFileSync(sortie, svg);
console.log("schema-boitier.svg écrit (" + svg.length + " caractères, " +
  TPMS.SCHEMA_COMPOSANTS.length + " composants repérés)");
