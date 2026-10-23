// =====================================================================
// verifier-interferences.js — Contrôle d'interférence et d'épaisseur
// ---------------------------------------------------------------------
// Utilisation (depuis la racine du dépôt) :
//   node boitier-3d/outils/verifier-interferences.js
// Chemin d'OpenSCAD : variable d'environnement OPENSCAD, sinon les
// emplacements habituels (voir trouver-openscad.js).
//
// Principe (à expliquer au jury) :
//   1. chaque pièce imprimée et chaque composant « fantôme » (écran,
//      batterie, XIAO, boutons, joint, vis...) est exporté À SA PLACE dans
//      l'assemblage (boîtier fermé sur son collier, cales comprises), pour
//      connaître sa boîte englobante ;
//   2. pour chaque pièce, OpenSCAD calcule l'INTERSECTION de la pièce et
//      de tous les fantômes dont la boîte touche la sienne (rendu CGAL
//      exact, directement à partir du modèle). Résultat vide (« Current top
//      level object is empty ») = aucune collision. Sinon, chaque fantôme
//      est testé seul pour trouver le coupable ;
//   3. même calcul entre les pièces imprimées deux à deux ;
//   4. épaisseur de paroi : la cavité de la coque « grossie » de 2 mm
//      (minkowski avec une sphère) ne doit jamais sortir de l'enveloppe
//      extérieure ; sinon une paroi fait moins de 2 mm.
// Les composants posés sur une pièce sont dessinés à 0,01 mm de leur
// appui : un contact franc n'est donc pas compté comme une collision.
// Le script se termine avec le code 1 si un contrôle échoue.
// =====================================================================
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const dossier = path.join(__dirname, "..");
const openscad = require("./trouver-openscad.js")();   // variable OPENSCAD, sinon emplacements habituels
const modele = path.join(dossier, "boitier.scad").replace(/\\/g, "/");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "interf-"));
const FN = 32;                       // finesse suffisante pour ce contrôle
const PARALLELE = Math.max(2, Math.min(6, os.cpus().length - 1));

const pieces = ["coque", "couvercle", "collier", "bride", "cale_haut", "cale_bas"];
const fantomes = ["ecran", "vitre", "xiao", "batterie", "buzzer", "boutons", "led_rouge", "led_blanches",
  "connecteur", "plaquette", "cable_reed", "joint", "vis_couvercle", "inserts", "vis_ecran",
  "cintre", "caoutchouc", "vis_collier", "ecrou_collier"];

// ---------- outils ----------
function lancer(scad, sortie) {
  return new Promise(function (ok) {
    const f = path.join(tmp, sortie.replace(/\.stl$/, ".scad"));
    fs.writeFileSync(f, "include <" + modele + ">\n" + scad + "\n");
    const debut = Date.now();
    const p = spawn(openscad, ["-o", path.join(tmp, sortie), "-D", 'piece="aucune"', "-D", "$fn=" + FN, f]);
    let texte = "";
    p.stdout.on("data", function (d) { texte += d; });
    p.stderr.on("data", function (d) { texte += d; });
    p.on("close", function (code) {
      const vide = /Current top level object is empty/.test(texte);
      const erreur = /ERROR/.test(texte) || (code !== 0 && !vide);
      ok({ texte: texte, vide: vide, erreur: erreur, stl: lireStl(path.join(tmp, sortie)), s: (Date.now() - debut) / 1000 });
    });
  });
}
async function parLots(taches) {        // exécute les tâches PARALLELE par PARALLELE
  const res = new Array(taches.length);
  let i = 0;
  async function ouvrier() { while (i < taches.length) { const k = i++; res[k] = await taches[k](); } }
  await Promise.all(Array.from({ length: PARALLELE }, ouvrier));
  return res;
}
// Lit un STL ASCII : boîte englobante et volume (somme des tétraèdres)
function lireStl(f) {
  if (!fs.existsSync(f)) return null;
  const v = [];
  fs.readFileSync(f, "utf8").replace(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, function (_, a, b, c) { v.push([+a, +b, +c]); return ""; });
  if (v.length === 0) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  for (let k = 0; k + 2 < v.length; k += 3) {
    const a = v[k], b = v[k + 1], c = v[k + 2];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  v.forEach(function (p) { for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], p[j]); max[j] = Math.max(max[j], p[j]); } });
  return { min: min, max: max, vol: Math.abs(vol) };
}
function seRecouvrent(a, b) {
  for (let j = 0; j < 3; j++) if (a.max[j] < b.min[j] - 0.05 || b.max[j] < a.min[j] - 0.05) return false;
  return true;
}
// Verdict d'une intersection : vide, ou volume nul (contact) = pas de collision
function verdict(r) {
  if (r.erreur) return { ok: false, txt: "ERREUR OpenSCAD : " + r.texte.split("\n").filter(function (l) { return /ERROR/.test(l); }).join(" | ") };
  if (r.vide) return { ok: true, txt: "OK (intersection vide)" };
  if (r.stl && r.stl.vol < 0.001) return { ok: true, txt: "OK (contact, volume nul)" };
  const b = r.stl;
  return { ok: false, txt: "COLLISION " + b.vol.toFixed(3) + " mm3 de (" + b.min.map(function (x) { return x.toFixed(1); }) +
    ") à (" + b.max.map(function (x) { return x.toFixed(1); }) + ")" };
}
const fm = function (n) { return 'fantome_monte("' + n + '");'; };
const pm = function (n) { return 'piece_montee("' + n + '");'; };

(async function () {
  const t0 = Date.now();
  console.log("Dossier temporaire : " + tmp + "  (" + PARALLELE + " calculs en parallèle, $fn = " + FN + ")");

  // 1. boîtes englobantes des pièces et des fantômes
  const r1 = await parLots(pieces.map(function (n) { return function () { return lancer(pm(n), "p_" + n + ".stl"); }; })
    .concat(fantomes.map(function (n) { return function () { return lancer(fm(n), "f_" + n + ".stl"); }; })));
  const bp = {}, bf = {};
  pieces.forEach(function (n, k) { bp[n] = r1[k].stl; if (!bp[n]) throw new Error("export impossible : " + n); });
  fantomes.forEach(function (n, k) { bf[n] = r1[pieces.length + k].stl; if (!bf[n]) throw new Error("fantôme vide : " + n); });

  // 2. pièce / fantômes proches (un seul calcul par pièce), 3. pièce / pièce, 4. paroi
  const groupes = pieces.map(function (p) { return { p: p, f: fantomes.filter(function (f) { return seRecouvrent(bf[f], bp[p]); }) }; })
    .filter(function (g) { return g.f.length > 0; });
  const paires = [];
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++)
    if (seRecouvrent(bp[pieces[i]], bp[pieces[j]])) paires.push([pieces[i], pieces[j]]);
  const taches = groupes.map(function (g, k) {
    return function () { return lancer("intersection() {\n  " + pm(g.p) + "\n  union() { " + g.f.map(fm).join(" ") + " }\n}", "g_" + k + ".stl"); };
  }).concat(paires.map(function (c, k) {
    return function () { return lancer("intersection() {\n  " + pm(c[0]) + "\n  " + pm(c[1]) + "\n}", "pp_" + k + ".stl"); };
  })).concat([function () {
    return lancer("difference() {\n  intersection() { cavite_grossie(2.0); bloc(100, 100, 1, -5, z_rim - 0.6); }\n  enveloppe(0, z_rim);\n}", "paroi.stl");
  }]);
  const r2 = await parLots(taches);

  // détail, seulement pour les pièces dont le groupe n'est pas vide
  const detail = [];
  groupes.forEach(function (g, k) { if (!verdict(r2[k]).ok) g.f.forEach(function (f) { detail.push([g.p, f]); }); });
  const r3 = await parLots(detail.map(function (c, k) {
    return function () { return lancer("intersection() {\n  " + pm(c[0]) + "\n  " + fm(c[1]) + "\n}", "d_" + k + ".stl"); };
  }));

  // ---------- rapport ----------
  let echecs = 0;
  console.log("\nPièce / composants proches");
  groupes.forEach(function (g, k) {
    const v = verdict(r2[k]);
    console.log("  " + g.p.padEnd(10) + " / " + (g.f.join(", ") + " ").padEnd(70) + v.txt + "  [" + r2[k].s.toFixed(0) + " s]");
  });
  detail.forEach(function (c, k) {
    const v = verdict(r3[k]);
    if (!v.ok) echecs++;
    console.log("    détail " + (c[0] + " / " + c[1]).padEnd(30) + v.txt);
  });
  console.log("Pièce / pièce");
  paires.forEach(function (c, k) {
    const r = r2[groupes.length + k], v = verdict(r);
    if (!v.ok) echecs++;
    console.log("  " + (c[0] + " / " + c[1]).padEnd(24) + v.txt + "  [" + r.s.toFixed(0) + " s]");
  });
  const rp = r2[r2.length - 1], vp = verdict(rp);
  if (!vp.ok) echecs++;
  console.log("Épaisseur des parois de la coque ≥ 2 mm : " + (vp.ok ? "OK" : vp.txt.replace("COLLISION", "PAROI FINE")) + "  [" + rp.s.toFixed(0) + " s]");
  const seuls = fantomes.filter(function (f) { return !groupes.some(function (g) { return g.f.indexOf(f) >= 0; }); });
  if (seuls.length) console.log("(sans pièce à proximité : " + seuls.join(", ") + ")");
  console.log("\n" + (groupes.length + paires.length + detail.length + 1) + " calculs en " + ((Date.now() - t0) / 1000).toFixed(0) + " s : " +
    (echecs === 0 ? "aucune collision, parois ≥ 2 mm." : echecs + " problème(s)."));
  if (echecs > 0) process.exitCode = 1;
  else fs.rmSync(tmp, { recursive: true, force: true });
})();
