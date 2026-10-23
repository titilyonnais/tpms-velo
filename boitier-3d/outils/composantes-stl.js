// Compte les morceaux séparés d'un fichier STL (ASCII) et donne la boîte
// englobante de chacun. Un boîtier imprimable doit être d'un seul tenant
// (sauf pièces volontairement séparées).
// Utilisation : node boitier-3d/outils/composantes-stl.js boitier-3d/stl/coque.stl
const fs = require("fs");
const texte = fs.readFileSync(process.argv[2], "utf8");
const sommets = [], index = new Map(), triangles = [];
let courant = [];
texte.split("\n").forEach(function (ligne) {
  const m = ligne.trim().match(/^vertex\s+(\S+)\s+(\S+)\s+(\S+)/);
  if (!m) return;
  const cle = m[1] + " " + m[2] + " " + m[3];
  if (!index.has(cle)) { index.set(cle, sommets.length); sommets.push([+m[1], +m[2], +m[3]]); }
  courant.push(index.get(cle));
  if (courant.length === 3) { triangles.push(courant); courant = []; }
});
// Union-find : deux triangles qui partagent un sommet sont dans le même morceau.
const parent = sommets.map(function (_, i) { return i; });
function racine(i) { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; }
triangles.forEach(function (t) { parent[racine(t[1])] = racine(t[0]); parent[racine(t[2])] = racine(t[0]); });
const morceaux = new Map();
sommets.forEach(function (s, i) {
  const r = racine(i);
  const b = morceaux.get(r) || { n: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  b.n++;
  for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], s[k]); b.max[k] = Math.max(b.max[k], s[k]); }
  morceaux.set(r, b);
});
console.log(triangles.length + " triangles, " + morceaux.size + " morceau(x)");
[...morceaux.values()].sort(function (a, b) { return b.n - a.n; }).forEach(function (b) {
  console.log("  " + b.n + " sommets, de (" + b.min.map(function (v) { return v.toFixed(1); }).join(", ") + ") à (" + b.max.map(function (v) { return v.toFixed(1); }).join(", ") + ")");
});
