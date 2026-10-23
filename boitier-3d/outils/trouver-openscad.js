// =====================================================================
// trouver-openscad.js — Où est OpenSCAD sur cet ordinateur ?
// ---------------------------------------------------------------------
// Utilisé par exporter.js et verifier-interferences.js. On essaie dans
// l'ordre :
//   1. la variable d'environnement OPENSCAD (chemin complet) ;
//   2. les emplacements d'installation habituels sous Windows (installeur
//      officiel, archive portable dans le dossier « outils » de
//      l'utilisateur) ;
//   3. « openscad » tout court, s'il est dans le PATH (Linux, macOS).
// =====================================================================
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

module.exports = function trouverOpenscad() {
  if (process.env.OPENSCAD) return process.env.OPENSCAD;
  const candidats = [
    path.join(os.homedir(), "outils", "openscad-2021.01", "openscad.com"),
    "C:/Program Files/OpenSCAD/openscad.com",
    "C:/Program Files (x86)/OpenSCAD/openscad.com",
    "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"
  ];
  for (const c of candidats) if (fs.existsSync(c)) return c;
  return "openscad";
};
