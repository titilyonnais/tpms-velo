// =====================================================================
// graphe.js — Courbes en SVG, sans bibliothèque
// ---------------------------------------------------------------------
// TPMS.grapheLignes(svg, options) redessine entièrement le graphe.
//   options = {
//     series: [{ nom, points: [[x, y], ...], classe }],   (y = null : trou)
//     xMin, xMax, yMin, yMax       (facultatifs : calculés sinon)
//     pasY                          (graduation verticale)
//     formatX(x), formatY(y)        (textes des axes)
//     reperes: [{ y, texte, classe }]  (lignes horizontales : seuils...)
//     curseurX                      (ligne verticale : instant courant)
//   }
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.SVG_NS = "http://www.w3.org/2000/svg";

TPMS.svgElement = function (nom, attributs, texte) {
  var el = document.createElementNS(TPMS.SVG_NS, nom);
  for (var cle in attributs) el.setAttribute(cle, attributs[cle]);
  if (texte !== undefined) el.textContent = texte;
  return el;
};

TPMS.grapheLignes = function (svg, o) {
  var vb = svg.viewBox.baseVal;
  var L = vb.width, H = vb.height;
  var G = 62, D = 10, Hh = 10, B = 22;     // marges
  svg.innerHTML = "";

  var xs = [], ys = [];
  o.series.forEach(function (s) {
    s.points.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || isNaN(p[1])) return;
      xs.push(p[0]);
      ys.push(p[1]);
    });
  });
  (o.reperes || []).forEach(function (r) { ys.push(r.y); });
  if (xs.length < 2) {
    svg.appendChild(TPMS.svgElement("text", { x: L / 2, y: H / 2, "text-anchor": "middle", class: "vide" }, o.vide || "Pas encore de données"));
    return;
  }
  var xMin = o.xMin !== undefined ? o.xMin : Math.min.apply(null, xs);
  var xMax = o.xMax !== undefined ? o.xMax : Math.max.apply(null, xs);
  if (xMax <= xMin) xMax = xMin + 1;
  var pas = o.pasY || 0.5;
  var yMin = o.yMin !== undefined ? o.yMin : Math.floor(Math.min.apply(null, ys) / pas) * pas;
  var yMax = o.yMax !== undefined ? o.yMax : Math.ceil(Math.max.apply(null, ys) / pas) * pas;
  if (yMax - yMin < pas) yMax = yMin + pas;
  // Pas plus de 6 graduations
  while ((yMax - yMin) / pas > 6) pas *= 2;

  function X(x) { return G + (x - xMin) / (xMax - xMin) * (L - G - D); }
  function Y(y) { return Hh + (yMax - y) / (yMax - yMin) * (H - Hh - B); }
  var fy = o.formatY || function (v) { return String(Math.round(v * 100) / 100).replace(".", ","); };
  var fx = o.formatX || function (v) { return String(Math.round(v)); };

  for (var v = Math.ceil(yMin / pas) * pas; v <= yMax + 1e-9; v += pas) {
    svg.appendChild(TPMS.svgElement("line", { x1: G, x2: L - D, y1: Y(v), y2: Y(v), class: "grille" }));
    svg.appendChild(TPMS.svgElement("text", { x: G - 5, y: Y(v) + 3, "text-anchor": "end", class: "axe" }, fy(v)));
  }
  svg.appendChild(TPMS.svgElement("text", { x: G, y: H - 5, class: "axe" }, fx(xMin)));
  svg.appendChild(TPMS.svgElement("text", { x: L - D, y: H - 5, "text-anchor": "end", class: "axe" }, fx(xMax)));
  if (o.titreX) svg.appendChild(TPMS.svgElement("text", { x: (G + L - D) / 2, y: H - 5, "text-anchor": "middle", class: "axe" }, o.titreX));

  (o.reperes || []).forEach(function (r) {
    svg.appendChild(TPMS.svgElement("line", { x1: G, x2: L - D, y1: Y(r.y), y2: Y(r.y), class: r.classe || "repere" }));
    if (r.texte) svg.appendChild(TPMS.svgElement("text", { x: L - D - 2, y: Y(r.y) - 3, "text-anchor": "end", class: "axe repere-texte" }, r.texte));
  });

  o.series.forEach(function (s) {
    var d = "", lever = true;
    // On sous-échantillonne : au plus un point par pixel.
    var pasPoints = Math.max(1, Math.floor(s.points.length / (L - G - D)));
    for (var i = 0; i < s.points.length; i += pasPoints) {
      var p = s.points[i];
      if (p[1] === null || p[1] === undefined || isNaN(p[1])) { lever = true; continue; }
      d += (lever ? "M" : "L") + X(p[0]).toFixed(1) + " " + Y(Math.max(yMin, Math.min(yMax, p[1]))).toFixed(1) + " ";
      lever = false;
    }
    svg.appendChild(TPMS.svgElement("path", { d: d, class: "serie " + (s.classe || "") }));
  });

  if (o.curseurX !== undefined && o.curseurX >= xMin && o.curseurX <= xMax) {
    svg.appendChild(TPMS.svgElement("line", { x1: X(o.curseurX), x2: X(o.curseurX), y1: Hh, y2: H - B, class: "curseur" }));
  }
};
