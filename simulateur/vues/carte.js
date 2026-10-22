// =====================================================================
// carte.js — Carte du parcours, profil d'altitude, vue radio de dessus
// ---------------------------------------------------------------------
// Pas de fond de carte téléchargé : un plan sobre, comme un relevé.
// Le parcours est projeté en mètres autour du point de départ.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// ---------------------------------------------------------------------
// Carte : tracé, bornes kilométriques, position, voisins, pirate
// ---------------------------------------------------------------------
TPMS.carteDessiner = function (svg, m) {
  var vb = svg.viewBox.baseVal, L = vb.width, H = vb.height, marge = 26;
  var cache = svg._cache;
  if (!cache || cache.parcoursId !== m.parcours.id) {
    // Calcul une seule fois par parcours : projection et échelle.
    var pts = m.prep.points || m.parcours.points;
    var xy = pts.map(function (p) {
      var lat = p.lat !== undefined ? p.lat : p[0];
      var lon = p.lon !== undefined ? p.lon : p[1];
      return TPMS.mondeVersMetres(m, lat, lon);
    });
    var xMin = Math.min.apply(null, xy.map(function (p) { return p.x; }));
    var xMax = Math.max.apply(null, xy.map(function (p) { return p.x; }));
    var yMin = Math.min.apply(null, xy.map(function (p) { return p.y; }));
    var yMax = Math.max.apply(null, xy.map(function (p) { return p.y; }));
    var echelle = Math.min((L - 2 * marge) / Math.max(1, xMax - xMin), (H - 2 * marge) / Math.max(1, yMax - yMin));
    var ox = marge + ((L - 2 * marge) - (xMax - xMin) * echelle) / 2 - xMin * echelle;
    var oy = H - marge - ((H - 2 * marge) - (yMax - yMin) * echelle) / 2 + yMin * echelle;
    cache = svg._cache = {
      parcoursId: m.parcours.id, echelle: echelle,
      X: function (x) { return ox + x * echelle; },
      Y: function (y) { return oy - y * echelle; }
    };
    svg.innerHTML = "";
    var fond = TPMS.svgElement("g", { class: "carte-fond" });
    // Quadrillage tous les 500 m ou 1 km
    var pas = (xMax - xMin) > 6000 ? 1000 : 500;
    for (var gx = Math.ceil(xMin / pas) * pas; gx <= xMax; gx += pas) {
      fond.appendChild(TPMS.svgElement("line", { x1: cache.X(gx), x2: cache.X(gx), y1: 0, y2: H, class: "grille" }));
    }
    for (var gy = Math.ceil(yMin / pas) * pas; gy <= yMax; gy += pas) {
      fond.appendChild(TPMS.svgElement("line", { x1: 0, x2: L, y1: cache.Y(gy), y2: cache.Y(gy), class: "grille" }));
    }
    var d = xy.map(function (p, i) { return (i ? "L" : "M") + cache.X(p.x).toFixed(1) + " " + cache.Y(p.y).toFixed(1); }).join(" ");
    fond.appendChild(TPMS.svgElement("path", { d: d, class: "trace" }));
    // Bornes kilométriques
    var longueur = m.prep.longueurM;
    var pasKm = longueur > 20000 ? 5000 : 1000;
    for (var dk = pasKm; dk < longueur; dk += pasKm) {
      var b = TPMS.parcoursPoint(m.prep, dk);
      var pb = TPMS.mondeVersMetres(m, b.lat, b.lon);
      fond.appendChild(TPMS.svgElement("circle", { cx: cache.X(pb.x), cy: cache.Y(pb.y), r: 2.5, class: "borne-km" }));
      fond.appendChild(TPMS.svgElement("text", { x: cache.X(pb.x) + 5, y: cache.Y(pb.y) - 4, class: "axe" }, (dk / 1000) + " km"));
    }
    var dep = cache.X(xy[0].x), depY = cache.Y(xy[0].y);
    fond.appendChild(TPMS.svgElement("rect", { x: dep - 4, y: depY - 4, width: 8, height: 8, class: "depart" }));
    // Nord et échelle
    fond.appendChild(TPMS.svgElement("text", { x: L - 16, y: 20, "text-anchor": "middle", class: "axe" }, "N"));
    fond.appendChild(TPMS.svgElement("line", { x1: L - 16, x2: L - 16, y1: 24, y2: 44, class: "trait" }));
    var echelleM = pas;
    fond.appendChild(TPMS.svgElement("line", { x1: 12, x2: 12 + echelleM * echelle, y1: H - 12, y2: H - 12, class: "trait" }));
    fond.appendChild(TPMS.svgElement("text", { x: 12, y: H - 17, class: "axe" }, echelleM >= 1000 ? (echelleM / 1000) + " km" : echelleM + " m"));
    svg.appendChild(fond);
    svg.appendChild(TPMS.svgElement("g", { class: "carte-dynamique" }));
  }

  // Partie qui bouge
  var dyn = svg.querySelector(".carte-dynamique");
  dyn.innerHTML = "";
  var p = TPMS.mondeVersMetres(m, m.point.lat, m.point.lon);
  if (m.positionPirate && m.pirate.actif) {
    dyn.appendChild(TPMS.svgElement("circle", { cx: cache.X(m.positionPirate.x), cy: cache.Y(m.positionPirate.y), r: 5, class: "pirate" }));
  }
  m.voisins.forEach(function (v) {
    var pv = TPMS.parcoursPoint(m.prep, Math.max(0, m.velo.distanceM + v.decalageM));
    var xy = TPMS.mondeVersMetres(m, pv.lat, pv.lon);
    dyn.appendChild(TPMS.svgElement("circle", { cx: cache.X(xy.x), cy: cache.Y(xy.y), r: 3, class: "voisin" }));
  });
  var cap = m.point.capDeg * Math.PI / 180;
  var cx = cache.X(p.x), cy = cache.Y(p.y);
  var pointe = [cx + Math.sin(cap) * 11, cy - Math.cos(cap) * 11];
  var g1 = [cx + Math.sin(cap + 2.5) * 7, cy - Math.cos(cap + 2.5) * 7];
  var g2 = [cx + Math.sin(cap - 2.5) * 7, cy - Math.cos(cap - 2.5) * 7];
  dyn.appendChild(TPMS.svgElement("polygon", { points: [pointe, g1, g2].map(function (q) { return q.join(","); }).join(" "), class: "cycliste" }));
};

// ---------------------------------------------------------------------
// Profil d'altitude avec la position courante
// ---------------------------------------------------------------------
TPMS.profilDessiner = function (svg, m) {
  if (!svg._points || svg._parcours !== m.parcours.id) {
    var pts = [];
    var n = 300;
    for (var i = 0; i <= n; i++) {
      var d = m.prep.longueurM * i / n;
      pts.push([d / 1000, TPMS.parcoursPoint(m.prep, d).altitudeM]);
    }
    svg._points = pts;
    svg._parcours = m.parcours.id;
  }
  var dist = m.parcours.boucle ? (m.velo.distanceM % m.prep.longueurM) : Math.min(m.velo.distanceM, m.prep.longueurM);
  TPMS.grapheLignes(svg, {
    series: [{ nom: "altitude", points: svg._points, classe: "serie-altitude" }],
    pasY: 50,
    formatX: function (x) { return x.toFixed(1).replace(".", ",") + " km"; },
    formatY: function (y) { return Math.round(y) + " m"; },
    curseurX: dist / 1000
  });
};

// ---------------------------------------------------------------------
// Vue radio de dessus : qui émet, d'où, avec quelle puissance reçue
// ---------------------------------------------------------------------
TPMS.vueRadioDessiner = function (svg, m, rayonM) {
  var vb = svg.viewBox.baseVal, L = vb.width, H = vb.height;
  var R = rayonM || 30;
  var echelle = Math.min(L, H) / 2 / R;
  var centre = m.positions ? m.positions.boitier : { x: 0, y: 0 };
  function X(x) { return L / 2 + (x - centre.x) * echelle; }
  function Y(y) { return H / 2 - (y - centre.y) * echelle; }
  svg.innerHTML = "";
  [0.5, 1, 2, 5, 10, 20, 30, 50].forEach(function (r) {
    if (r > R || r < R / 12) return;
    svg.appendChild(TPMS.svgElement("circle", { cx: L / 2, cy: H / 2, r: r * echelle, class: "anneau" }));
    svg.appendChild(TPMS.svgElement("text", { x: L / 2 + r * echelle + 3, y: H / 2 - 3, class: "axe" }, String(r).replace(".", ",") + " m"));
  });
  if (!m.positions) return;

  // Portée moyenne du pirate
  if (m.pirate.actif && m.positionPirate) {
    var portee = TPMS.radioPorteeM(m.canal, m.pirateMonde.puissanceDbm, -95);
    svg.appendChild(TPMS.svgElement("circle", { cx: X(m.positionPirate.x), cy: Y(m.positionPirate.y), r: Math.min(portee, R * 3) * echelle, class: "portee-pirate" }));
  }
  // Vélo : un trait dans l'axe
  var cap = m.positions.cap * Math.PI / 180;
  var b = m.positions.base;
  svg.appendChild(TPMS.svgElement("line", {
    x1: X(b.x + Math.sin(cap) * 0.9), y1: Y(b.y + Math.cos(cap) * 0.9),
    x2: X(b.x - Math.sin(cap) * 0.8), y2: Y(b.y - Math.cos(cap) * 0.8), class: "velo-trait"
  }));
  // Dernières trames reçues ou perdues : un trait par émetteur
  var vus = {};
  m.trafic.forEach(function (tr) {
    if (vus[tr.source]) return;
    vus[tr.source] = tr;
  });
  function emetteur(id, pos, classe, texte) {
    if (!pos) return;
    var tr = vus[id];
    if (tr && tr.rssiDbm !== null) {
      svg.appendChild(TPMS.svgElement("line", { x1: X(pos.x), y1: Y(pos.y), x2: L / 2, y2: H / 2, class: "lien " + (tr.raison === "ok" ? "lien-ok" : "lien-perdu") }));
      svg.appendChild(TPMS.svgElement("text", { x: X(pos.x) + 6, y: Y(pos.y) + 14, class: "axe" },
        Math.round(tr.rssiDbm) + " dBm"));
    }
    svg.appendChild(TPMS.svgElement("circle", { cx: X(pos.x), cy: Y(pos.y), r: 4.5, class: classe }));
    svg.appendChild(TPMS.svgElement("text", { x: X(pos.x) + 6, y: Y(pos.y) + 2, class: "etiquette-radio" }, texte));
  }
  var g = TPMS.GEOMETRIE_VELO;
  // Vue rapprochée : les roues (vues de dessus, ce sont des traits) et
  // les valves qui tournent avec elles.
  if (R <= 5) {
    [g.moyeuAV, g.moyeuAR].forEach(function (moyeu) {
      var cx = b.x + Math.sin(cap) * moyeu.avant, cy = b.y + Math.cos(cap) * moyeu.avant;
      var r = 0.34;
      svg.appendChild(TPMS.svgElement("line", {
        x1: X(cx + Math.sin(cap) * r), y1: Y(cy + Math.cos(cap) * r),
        x2: X(cx - Math.sin(cap) * r), y2: Y(cy - Math.cos(cap) * r), class: "roue-trait"
      }));
    });
  }
  var pc = m.positions.capteurs || {};
  emetteur("AV", pc.AV || { x: b.x + Math.sin(cap) * g.moyeuAV.avant, y: b.y + Math.cos(cap) * g.moyeuAV.avant }, "capteur", "AV");
  emetteur("AR", pc.AR || { x: b.x + Math.sin(cap) * g.moyeuAR.avant, y: b.y + Math.cos(cap) * g.moyeuAR.avant }, "capteur", "AR");
  if (m.pirate.actif) emetteur("pirate", m.positionPirate, "pirate", m.pirateMonde.brouillage ? "brouilleur" : "pirate");
  m.voisins.forEach(function (v) {
    var pv = TPMS.parcoursPoint(m.prep, Math.max(0, m.velo.distanceM + v.decalageM));
    var xy = TPMS.mondeVersMetres(m, pv.lat, pv.lon);
    if (Math.abs(xy.x - centre.x) < R * 1.2 && Math.abs(xy.y - centre.y) < R * 1.2) {
      emetteur("voisin", { x: xy.x + v.lateralM, y: xy.y }, "voisin", v.id);
    }
  });
  svg.appendChild(TPMS.svgElement("rect", { x: L / 2 - 5, y: H / 2 - 5, width: 10, height: 10, class: "boitier-radio" }));
  svg.appendChild(TPMS.svgElement("text", { x: L / 2 + 8, y: H / 2 - 8, class: "etiquette-radio" }, "boîtier"));
};
