// =====================================================================
// exporter.js — Rendu complet de chaque pièce, export STL et images
// ---------------------------------------------------------------------
// Utilisation (depuis la racine du dépôt) :
//   node boitier-3d/outils/exporter.js            (pièces + images)
//   node boitier-3d/outils/exporter.js --images   (images seulement)
// Chemin d'OpenSCAD : variable d'environnement OPENSCAD, sinon l'endroit
// où il est installé sur le PC de développement (version 2021.01).
//
// Pour chaque pièce imprimable :
//   1. rendu complet (CGAL, comme F6) avec $fn = 96, export dans stl/ ;
//   2. contrôles : aucun WARNING/ERROR d'OpenSCAD, objet « Simple: yes »
//      (fermé, chaque arête partagée par 2 faces exactement), pièce d'un
//      seul tenant (outils/composantes-stl.js) ;
// puis les images de rendus/ : vues d'ensemble en couleurs (aperçu
// OpenCSG) et chaque pièce en rendu complet (CGAL) à partir de son STL.
// Les anciens fichiers de stl/ et rendus/ qui ne correspondent plus à une
// pièce ou une vue sont supprimés.
// =====================================================================
"use strict";
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const dossier = path.join(__dirname, "..");
const openscad = process.env.OPENSCAD || "C:/Users/utilisateur/outils/openscad-2021.01/openscad.com";
const modele = path.join(dossier, "boitier.scad");
const PARALLELE = Math.max(2, Math.min(5, os.cpus().length - 1));
const imagesSeules = process.argv.indexOf("--images") >= 0;

const pieces = ["coque", "couvercle", "collier", "bride", "cale_22_2", "cale_23_8", "cale_25_4", "cale_31_8",
  "test_jeux", "essai_joint"];
// Vues d'ensemble (aperçu en couleurs) : nom, pièce, caméra
// (tx,ty,tz,rx,ry,rz,distance), taille, finesse. La coupe est un dessin à
// plat (projection exacte de chaque pièce dans le plan de coupe).
const vues = [
  ["tout", "tout", "0,-9,24,55,0,330,270", "1400,1050", 48],
  ["tout_avant", "tout", "0,-9,24,58,0,145,270", "1400,1050", 48],
  ["tout_profil", "tout", "0,-9,14,90,0,90,260", "1400,1050", 48],
  ["eclate", "eclate", "0,-9,25,65,0,330,430", "1100,1300", 48],
  ["coupe", "coupe", "-16,18,0,0,0,0,310", "1600,1300", 32],
  ["coupe_joint", "coupe", "-36,45,0,0,0,0,42", "1200,900", 48, "etiquettes=false"],
];
// Images des pièces (rendu CGAL du STL, dans leur position d'impression)
const imagesPieces = [
  ["coque", "0,0,12,55,0,35,150"], ["coque_dessous", "0,0,12,125,0,330,175"],
  ["couvercle", "0,0,3,40,0,25,140"], ["couvercle_dessous", "0,0,3,145,0,25,140"],
  ["collier", "0,0,7,45,0,20,170"], ["bride", "14,0,7,45,0,20,140"],
  ["cale_22_2", "-10,0,8,50,0,30,110"], ["test_jeux", "33,18,5,50,0,20,175"], ["essai_joint", "0,0,4,55,0,35,140"],
];

fs.mkdirSync(path.join(dossier, "stl"), { recursive: true });
fs.mkdirSync(path.join(dossier, "rendus"), { recursive: true });

function lancer(args) {
  return new Promise(function (ok) {
    const debut = Date.now();
    const p = spawn(openscad, args);
    let texte = "";
    p.stdout.on("data", function (d) { texte += d; });
    p.stderr.on("data", function (d) { texte += d; });
    p.on("close", function (code) { ok({ texte: texte, code: code, s: (Date.now() - debut) / 1000 }); });
  });
}
async function parLots(taches) {
  const res = new Array(taches.length);
  let i = 0;
  async function ouvrier() { while (i < taches.length) { const k = i++; res[k] = await taches[k](); } }
  await Promise.all(Array.from({ length: PARALLELE }, ouvrier));
  return res;
}

(async function () {
  let echecs = 0;
  if (!imagesSeules) {
    console.log("Rendu complet de " + pieces.length + " pièces ($fn = 96, " + PARALLELE + " en parallèle)...");
    const res = await parLots(pieces.map(function (p) {
      return function () {
        return lancer(["-o", path.join(dossier, "stl", p + ".stl"), "-D", 'piece="' + p + '"', "-D", "$fn=96", modele]);
      };
    }));
    pieces.forEach(function (p, k) {
      const r = res[k];
      const stl = path.join(dossier, "stl", p + ".stl");
      const simple = /Simple:\s+yes/.test(r.texte);
      const alerte = /WARNING|ERROR/.test(r.texte) || r.code !== 0;
      const morceaux = fs.existsSync(stl) ? execFileSync(process.execPath, [path.join(__dirname, "composantes-stl.js"), stl], { encoding: "utf8" }) : "pas de STL";
      const unSeul = / 1 morceau\(x\)/.test(morceaux);
      const ok = simple && !alerte && unSeul;
      if (!ok) echecs++;
      console.log((ok ? "OK     " : "ÉCHEC  ") + p.padEnd(12) + (r.s.toFixed(0) + " s").padStart(6) + " · " +
        (simple ? "fermée" : "NON FERMÉE") + " · " + morceaux.split("\n")[0] + (alerte ? " · AVERTISSEMENT OpenSCAD" : ""));
      if (alerte) console.log(r.texte.split("\n").filter(function (l) { return /WARNING|ERROR/.test(l); }).join("\n"));
    });
  }

  // ---------- images ----------
  const vue = path.join(dossier, "rendus", "_vue_stl.scad");
  fs.writeFileSync(vue, 'f = "";\ncolor([0.42, 0.43, 0.47]) import(f);\n');
  const taches = vues.map(function (v) {
    return function () {
      return lancer(["-o", path.join(dossier, "rendus", v[0] + ".png"), "-D", 'piece="' + v[1] + '"', "-D", "$fn=" + v[4]]
        .concat(v[5] ? ["-D", v[5]] : [], ["--camera=" + v[2], "--imgsize=" + v[3], "--colorscheme=Tomorrow Night", modele]));
    };
  }).concat(imagesPieces.map(function (v) {
    const stl = path.join(dossier, "stl", v[0].replace(/_dessous$/, "") + ".stl").replace(/\\/g, "/");
    return function () {
      return lancer(["--render", "-o", path.join(dossier, "rendus", v[0] + ".png"), "-D", 'f="' + stl + '"', "--camera=" + v[1],
        "--imgsize=1200,900", "--colorscheme=Tomorrow Night", vue]);
    };
  }));
  const ri = await parLots(taches);
  fs.unlinkSync(vue);
  vues.concat(imagesPieces).forEach(function (v, k) {
    const ok = ri[k].code === 0 && !/ERROR/.test(ri[k].texte);
    if (!ok) echecs++;
    console.log((ok ? "image  " : "ÉCHEC  ") + "rendus/" + v[0] + ".png" + (" " + ri[k].s.toFixed(0) + " s").padStart(7));
  });

  // ---------- ménage : fichiers qui ne correspondent plus à rien ----------
  const attendus = new Set(pieces.map(function (p) { return p + ".stl"; })
    .concat(vues.map(function (v) { return v[0] + ".png"; }), imagesPieces.map(function (v) { return v[0] + ".png"; })));
  ["stl", "rendus"].forEach(function (d) {
    fs.readdirSync(path.join(dossier, d)).forEach(function (f) {
      if (!attendus.has(f)) { fs.unlinkSync(path.join(dossier, d, f)); console.log("supprimé  " + d + "/" + f); }
    });
  });

  console.log(echecs === 0 ? "\nToutes les pièces sont fermées et d'un seul tenant ; images à jour." : "\n" + echecs + " problème(s).");
  if (echecs > 0) process.exitCode = 1;
})();
