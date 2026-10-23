// =====================================================================
// exporter.js — Rendu complet de chaque pièce, export STL et images
// ---------------------------------------------------------------------
// Utilisation (depuis la racine du dépôt) :
//   node boitier-3d/outils/exporter.js
// Chemin d'OpenSCAD : variable d'environnement OPENSCAD, sinon l'endroit
// où il a été installé sur le PC de développement (version 2021.01).
//
// Pour chaque pièce imprimable :
//   1. rendu complet (CGAL, comme F6) et export STL dans stl/ ;
//   2. vérification : pas d'avertissement, objet « Simple: yes »
//      (fermé, sans arête partagée par plus de deux faces) ;
//   3. vérification : la pièce est d'un seul tenant (outils/composantes-stl.js).
// Puis les images de rendu (rendus/*.png) pour la documentation.
// =====================================================================
var execFileSync = require("child_process").execFileSync;
var path = require("path");
var fs = require("fs");

var dossier = path.join(__dirname, "..");
var openscad = process.env.OPENSCAD || "C:/Users/utilisateur/outils/openscad-2021.01/openscad.com";
var modele = path.join(dossier, "boitier.scad");
var pieces = ["coque", "couvercle", "fixation_velo", "essai_joint"];
var images = ["tout", "eclate", "coque", "couvercle", "fixation_velo"];
var echecs = 0;

fs.mkdirSync(path.join(dossier, "stl"), { recursive: true });
fs.mkdirSync(path.join(dossier, "rendus"), { recursive: true });

function lancerAvecSortie(args) {
  var r = require("child_process").spawnSync(openscad, args, { encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "") + (r.status !== 0 ? "\nERROR: code " + r.status : "");
}

pieces.forEach(function (p) {
  var stl = path.join(dossier, "stl", p + ".stl");
  var debut = Date.now();
  // $fn = 96 pour l'export : cercles plus lisses (conseil du § 1).
  var sortie = lancerAvecSortie(["-o", stl, "-D", 'piece="' + p + '"', "-D", "$fn=96", modele]);
  var simple = /Simple:\s+yes/.test(sortie);
  var alerte = /WARNING|ERROR/i.test(sortie);
  var morceaux = execFileSync(process.execPath, [path.join(__dirname, "composantes-stl.js"), stl], { encoding: "utf8" });
  var unSeul = / 1 morceau\(x\)/.test(morceaux);
  var ok = simple && !alerte && unSeul;
  if (!ok) echecs++;
  console.log((ok ? "OK     " : "ÉCHEC  ") + p.padEnd(14) + ((Date.now() - debut) / 1000).toFixed(0) + " s · " +
    (simple ? "fermée" : "NON FERMÉE") + " · " + morceaux.split("\n")[0] + (alerte ? " · AVERTISSEMENT OpenSCAD" : ""));
  if (alerte) console.log(sortie.split("\n").filter(function (l) { return /WARNING|ERROR/i.test(l); }).join("\n"));
});

images.forEach(function (p) {
  // La vue éclatée est haute et étroite : image verticale.
  var taille = p === "eclate" ? "--imgsize=760,1000" : "--imgsize=1400,1000";
  lancerAvecSortie(["--render", "-o", path.join(dossier, "rendus", p + ".png"), "-D", 'piece="' + p + '"',
    taille, "--viewall", "--autocenter", "--colorscheme=Tomorrow Night", modele]);
  console.log("image  rendus/" + p + ".png");
});

console.log(echecs === 0 ? "\nToutes les pièces sont fermées et d'un seul tenant." : "\n" + echecs + " pièce(s) à corriger.");
if (echecs > 0) process.exitCode = 1;
