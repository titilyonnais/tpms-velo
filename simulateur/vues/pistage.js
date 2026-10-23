// =====================================================================
// pistage.js — Carte de ce que voient les espions Bluetooth
// ---------------------------------------------------------------------
// Les rues équipées (parcours en ville), les récepteurs, et le trajet
// que l'espion reconstitue en reliant, dans l'ordre des heures, les
// récepteurs devant lesquels le vélo est passé.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.pistageDessiner = function (svg, reseau, suivi) {
  var vb = svg.viewBox.baseVal, L = vb.width, H = vb.height, marge = 24;
  if (!svg._cache) {
    // Projection simple autour du centre des récepteurs (calculée une fois).
    var lats = reseau.mouchards.map(function (m) { return m.lat; });
    var lons = reseau.mouchards.map(function (m) { return m.lon; });
    var lat0 = (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2;
    var lon0 = (Math.min.apply(null, lons) + Math.max.apply(null, lons)) / 2;
    var cos0 = Math.cos(lat0 * Math.PI / 180);
    function versM(lat, lon) { return { x: (lon - lon0) * 111320 * cos0, y: (lat - lat0) * 110540 }; }
    var rues = [];
    TPMS.PARCOURS.forEach(function (p) {
      if (p.type !== "ville" && p.type !== "trajet") return;
      var prep = TPMS.parcoursPreparer(p);
      var pts = [];
      for (var d = 0; d <= prep.longueurM; d += 50) {
        var q = TPMS.parcoursPoint(prep, d);
        pts.push(versM(q.lat, q.lon));
      }
      rues.push(pts);
    });
    var tous = [].concat.apply([], rues).concat(reseau.mouchards.map(function (m) { return versM(m.lat, m.lon); }));
    var xMin = Math.min.apply(null, tous.map(function (p) { return p.x; })), xMax = Math.max.apply(null, tous.map(function (p) { return p.x; }));
    var yMin = Math.min.apply(null, tous.map(function (p) { return p.y; })), yMax = Math.max.apply(null, tous.map(function (p) { return p.y; }));
    var e = Math.min((L - 2 * marge) / (xMax - xMin), (H - 2 * marge) / (yMax - yMin));
    var ox = marge + ((L - 2 * marge) - (xMax - xMin) * e) / 2 - xMin * e;
    var oy = H - marge - ((H - 2 * marge) - (yMax - yMin) * e) / 2 + yMin * e;
    function X(x) { return ox + x * e; }
    function Y(y) { return oy - y * e; }
    var positions = {};
    reseau.mouchards.forEach(function (m) { var p = versM(m.lat, m.lon); positions[m.id] = { x: X(p.x), y: Y(p.y) }; });
    svg._cache = { positions: positions };
    svg.innerHTML = "";
    var fond = TPMS.svgElement("g", {});
    rues.forEach(function (pts) {
      fond.appendChild(TPMS.svgElement("path", {
        class: "rue",
        d: pts.map(function (p, i) { return (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1); }).join(" ")
      }));
    });
    var echelle = 1000;
    fond.appendChild(TPMS.svgElement("line", { x1: 12, x2: 12 + echelle * e, y1: H - 12, y2: H - 12, class: "trait" }));
    fond.appendChild(TPMS.svgElement("text", { x: 12, y: H - 17, class: "axe" }, "1 km"));
    svg.appendChild(fond);
    svg.appendChild(TPMS.svgElement("g", { class: "pistage-dynamique" }));
  }

  var pos = svg._cache.positions;
  var dyn = svg.querySelector(".pistage-dynamique");
  dyn.innerHTML = "";
  var vus = {};
  if (suivi) suivi.trajets.forEach(function (t) { t.forEach(function (p) { vus[p.mouchard] = true; }); });

  // Dernier trajet reconstitué : on relie les récepteurs dans l'ordre.
  var dernier = suivi && suivi.trajets.length > 0 ? suivi.trajets[suivi.trajets.length - 1] : null;
  if (dernier && dernier.length > 1) {
    dyn.appendChild(TPMS.svgElement("path", {
      class: "trajet-espion",
      d: dernier.map(function (p, i) { var q = pos[p.mouchard]; return (i ? "L" : "M") + q.x.toFixed(1) + " " + q.y.toFixed(1); }).join(" ")
    }));
  }
  if (suivi && suivi.departHabituel) {
    var dp = pos[suivi.departHabituel];
    dyn.appendChild(TPMS.svgElement("circle", { cx: dp.x, cy: dp.y, r: 14, class: "depart-espion" }));
  }
  reseau.mouchards.forEach(function (m) {
    var q = pos[m.id];
    dyn.appendChild(TPMS.svgElement("rect", { x: q.x - 4, y: q.y - 4, width: 8, height: 8, rx: 2, class: vus[m.id] ? "mouchard actif" : "mouchard" }));
  });
};
