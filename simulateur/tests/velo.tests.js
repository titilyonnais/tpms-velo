// =====================================================================
// velo.tests.js — Vérifications des parcours, du vélo et du cycliste
// ---------------------------------------------------------------------
// Se lance en ligne de commande : node simulateur/tests/velo.tests.js
// Chaque test compare un résultat calculé à une valeur attendue ou à
// une plage « réaliste » (ordres de grandeur connus du cyclisme).
// =====================================================================

if (typeof require !== "undefined") {
  ["../monde/alea.js", "../monde/parcours.js", "../monde/velo.js"].forEach(function (f) {
    require(require("path").join(__dirname, f));
  });
}

var resultats = { reussis: 0, rates: 0, lignes: [] };

function verifier(nom, condition, detail) {
  if (condition) {
    resultats.reussis++;
    resultats.lignes.push("OK     " + nom + (detail !== undefined ? "  (" + detail + ")" : ""));
  } else {
    resultats.rates++;
    resultats.lignes.push("ÉCHEC  " + nom + (detail !== undefined ? "  → obtenu : " + detail : ""));
  }
}

function proche(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

function kmh(ms) { return (ms * 3.6).toFixed(1) + " km/h"; }

// Fait rouler un vélo à puissance constante pendant dureeS ; renvoie le vélo.
function rouler(type, puissanceW, pentePct, dureeS, autres) {
  var v = TPMS.creerVelo({ type: type, graine: 7 });
  var e = { puissanceW: puissanceW, penteRad: Math.atan(pentePct / 100), revetement: "asphalte" };
  for (var k in (autres || {})) e[k] = autres[k];
  for (var t = 0; t < dureeS; t += 0.25) TPMS.veloAvancer(v, 0.25, e);
  return v;
}

// Simule une sortie complète (cycliste + vélo) ; renvoie un résumé.
function sortie(idParcours, typeVelo, style, graine, dtS, dureeMaxS, options) {
  var o = options || {};
  var prep = TPMS.parcoursPreparer(TPMS.parcoursParId(idParcours), graine);
  var v = TPMS.creerVelo({ type: typeVelo, graine: graine });
  var cy = TPMS.creerCycliste({ style: style, graine: graine });
  var r = { prep: prep, v: v, cy: cy, trace: [], etats: {}, tS: 0,
            freinageS: 0, feuxGrilles: 0, distanceArretFeu: [], vitesses: [] };
  var dernierEtat = cy.etat;
  for (var t = 0; t < dureeMaxS; t += dtS) {
    var cond = o.conditions ? o.conditions(t, v) : {};
    var point = TPMS.veloEtapeParcours(v, cy, prep, t, dtS, cond);
    r.etats[cy.etat] = (r.etats[cy.etat] || 0) + dtS;
    if (v.forces.freinN > 0) r.freinageS += dtS;
    r.vitesses.push({ d: point.distanceSurParcoursM, v: v.vitesseMs, pente: point.pentePct });
    if (cy.etat === "feu" && dernierEtat !== "feu") r.distanceArretFeu.push(point.prochainFeuM);
    // Passage d'un feu rouge : le vélo franchit la position d'un feu rouge.
    if (point.prochainFeu && point.prochainFeuM < v.vitesseMs * dtS + 0.01 &&
        TPMS.feuEstRouge(point.prochainFeu, t) && v.vitesseMs > 0.5) r.feuxGrilles++;
    if (Math.round(t / dtS) % Math.round(10 / dtS) === 0) r.trace.push(v.distanceM);
    dernierEtat = cy.etat;
    r.tS = t + dtS;
    if (cy.etat === "fini") break;
    if (o.arret && o.arret(t, v, cy)) break;
  }
  return r;
}

// ---------------------------------------------------------------------
// Parcours
// ---------------------------------------------------------------------
(function () {
  verifier("haversine : 1° de latitude ≈ 111,2 km",
    proche(TPMS.distanceHaversineM(45, 4.8, 46, 4.8), 111195, 10),
    TPMS.distanceHaversineM(45, 4.8, 46, 4.8).toFixed(0) + " m");
  verifier("cap : vers l'est = 90°", proche(TPMS.capEntreDeg(45, 4.8, 45, 4.9), 90, 0.1),
    TPMS.capEntreDeg(45, 4.8, 45, 4.9).toFixed(2));

  var types = {};
  TPMS.PARCOURS.forEach(function (p) { types[p.type] = true; });
  verifier("au moins 4 parcours, les 4 types présents",
    TPMS.PARCOURS.length >= 4 && types.ville && types.route && types.vtt && types.trajet,
    TPMS.PARCOURS.length + " parcours");

  var champsOk = TPMS.PARCOURS.every(function (p) {
    return p.id && p.nom && p.description && p.type && p.environnementRadio &&
           typeof p.boucle === "boolean" && typeof p.feuxParKm === "number" &&
           p.revetementParDefaut && p.points.length > 10 && p.points[0].length === 3;
  });
  verifier("tous les champs demandés sont présents", champsOk);

  var ecartMax = 0, ecarts = [];
  TPMS.PARCOURS.forEach(function (p) {
    var prep = TPMS.parcoursPreparer(p);
    for (var i = 1; i < prep.cumulM.length; i++) {
      var e = prep.cumulM[i] - prep.cumulM[i - 1];
      ecarts.push(e); if (e > ecartMax) ecartMax = e;
    }
  });
  ecarts.sort(function (a, b) { return a - b; });
  var mediane = ecarts[ecarts.length >> 1];
  verifier("points tous les 50 à 150 m (médiane), jamais plus de 150 m",
    ecartMax <= 150 && mediane >= 50 && mediane <= 150,
    "médiane " + mediane.toFixed(0) + " m, max " + ecartMax.toFixed(0) + " m");

  var ville = TPMS.parcoursPreparer(TPMS.parcoursParId("lyon-ville"));
  var route = TPMS.parcoursPreparer(TPMS.parcoursParId("col-luere"));
  var vtt = TPMS.parcoursPreparer(TPMS.parcoursParId("monts-d-or-vtt"));
  var trajet = TPMS.parcoursPreparer(TPMS.parcoursParId("domicile-travail"));

  verifier("ville : boucle d'environ 8 km", ville.longueurM > 7000 && ville.longueurM < 10000,
    (ville.longueurM / 1000).toFixed(2) + " km");
  verifier("ville : plate (moins de 15 m d'écart d'altitude)",
    ville.altitudeMaxM - ville.altitudeMinM < 15, (ville.altitudeMaxM - ville.altitudeMinM) + " m");
  verifier("route : 30 à 40 km", route.longueurM > 30000 && route.longueurM < 40000,
    (route.longueurM / 1000).toFixed(2) + " km");
  verifier("route : un vrai col (sommet 714 m, plus de 450 m de D+)",
    route.altitudeMaxM === 714 && route.denivelePositifM > 450,
    "D+ " + route.denivelePositifM.toFixed(0) + " m");
  verifier("VTT : 12 à 18 km", vtt.longueurM > 12000 && vtt.longueurM < 18000,
    (vtt.longueurM / 1000).toFixed(2) + " km");
  verifier("trajet : environ 6 km", trajet.longueurM > 5000 && trajet.longueurM < 7500,
    (trajet.longueurM / 1000).toFixed(2) + " km");

  // Pente maximale du VTT (pentes fortes) et pente moyenne du col.
  var penteMaxVtt = 0;
  for (var d = 0; d < vtt.longueurM; d += 10) {
    penteMaxVtt = Math.max(penteMaxVtt, TPMS.parcoursPoint(vtt, d).pentePct);
  }
  verifier("VTT : pentes fortes (au moins 12 %)", penteMaxVtt >= 12, penteMaxVtt.toFixed(1) + " %");

  // Pente lissée : pas de saut brutal entre deux points distants de 1 m.
  var sautMax = 0, precedente = TPMS.parcoursPoint(route, 0).penteRad;
  for (var x = 1; x < route.longueurM; x += 1) {
    var pe = TPMS.parcoursPoint(route, x).penteRad;
    sautMax = Math.max(sautMax, Math.abs(pe - precedente));
    precedente = pe;
  }
  verifier("pente lissée (variation < 0,3 % par mètre)", sautMax < 0.003,
    (sautMax * 100).toFixed(3) + " % par m");

  // Au milieu de la montée du col (entre Vaugneray et le sommet), ça monte.
  var montee = TPMS.parcoursPoint(route, 14500);
  verifier("route : ça monte vers le col (pente 3 à 10 %)",
    montee.pentePct > 3 && montee.pentePct < 10, montee.pentePct.toFixed(1) + " %");

  var debut = TPMS.parcoursPoint(route, 0);
  var p0 = TPMS.parcoursParId("col-luere").points[0];
  verifier("point à 0 m = premier point du tracé",
    debut.lat === p0[0] && debut.lon === p0[1] && debut.altitudeM === p0[2] && !debut.fini);
  var fin = TPMS.parcoursPoint(route, route.longueurM + 50);
  verifier("parcours non bouclé : fini au-delà de la longueur", fin.fini && fin.resteM === 0);
  var a = TPMS.parcoursPoint(ville, 1234), b = TPMS.parcoursPoint(ville, 1234 + ville.longueurM);
  verifier("boucle : un tour plus loin = même endroit, tour suivant",
    proche(a.lat, b.lat, 1e-9) && proche(a.lon, b.lon, 1e-9) && b.tour === 1 && !b.fini);
  verifier("cap dans [0, 360[", a.capDeg >= 0 && a.capDeg < 360, a.capDeg.toFixed(1));

  verifier("revêtements : gravier de la place Bellecour au départ, VTT sur la terre",
    TPMS.parcoursPoint(ville, 50).revetement === "gravier" &&
    TPMS.parcoursPoint(ville, 2000).revetement === "asphalte" &&
    TPMS.parcoursPoint(vtt, 1000).revetement === "terre");

  var nbFeux = ville.feux.length, attendu = 2.5 * ville.longueurM / 1000;
  verifier("ville : nombre de feux cohérent avec feuxParKm (±40 %)",
    Math.abs(nbFeux - attendu) <= 0.4 * attendu, nbFeux + " feux pour " + attendu.toFixed(1) + " attendus");
  verifier("route de campagne : aucun feu", route.feux.length === 0);
  var f = ville.feux[0];
  verifier("feu : vert au début du cycle puis rouge",
    !TPMS.feuEstRouge(f, -f.phaseS + 1) && TPMS.feuEstRouge(f, -f.phaseS + f.vertS + 1));
  var memes = TPMS.parcoursPreparer(TPMS.parcoursParId("lyon-ville"), 0).feux;
  var autres = TPMS.parcoursPreparer(TPMS.parcoursParId("lyon-ville"), 99).feux;
  verifier("feux reproductibles (même graine = mêmes feux, autre graine = autres feux)",
    JSON.stringify(memes) === JSON.stringify(ville.feux) && JSON.stringify(autres) !== JSON.stringify(memes));
})();

// ---------------------------------------------------------------------
// Dynamique du vélo
// ---------------------------------------------------------------------
(function () {
  var v = rouler("route", 150, 0, 300);
  verifier("route, 150 W sur le plat : 25 à 28,5 km/h", v.vitesseMs * 3.6 > 25 && v.vitesseMs * 3.6 < 28.5,
    kmh(v.vitesseMs));
  var ville = rouler("ville", 100, 0, 300);
  verifier("vélo de ville, 100 W sur le plat : 17 à 22 km/h",
    ville.vitesseMs * 3.6 > 17 && ville.vitesseMs * 3.6 < 22, kmh(ville.vitesseMs));

  var m150 = rouler("route", 150, 7, 300), m200 = rouler("route", 200, 7, 300);
  verifier("montée à 7 %, 200 W : 9 à 12 km/h", m200.vitesseMs * 3.6 > 9 && m200.vitesseMs * 3.6 < 12,
    kmh(m200.vitesseMs) + " ; à 150 W : " + kmh(m150.vitesseMs));

  var libre = rouler("route", 0, -8, 300);
  verifier("descente à 8 % sans freiner : vitesse limite 50 à 65 km/h",
    libre.vitesseMs * 3.6 > 50 && libre.vitesseMs * 3.6 < 65, kmh(libre.vitesseMs));

  // Le cycliste tranquille freine pour rester sous 30 km/h dans la même descente.
  var vD = TPMS.creerVelo({ type: "route", graine: 3 });
  var cy = TPMS.creerCycliste({ style: "tranquille", graine: 3 });
  var point = { penteRad: Math.atan(-0.08), pentePct: -8, revetement: "asphalte", fini: false,
                resteM: Infinity, virages: [], prochainFeu: null, prochainFeuM: Infinity };
  var vMaxD = 0, freinUtilise = false;
  for (var t = 0; t < 300; t += 0.25) {
    var c = TPMS.cyclisteCommande(cy, vD, point, t, 0.25);
    if (c.freinage > 0 && vD.vitesseMs > 1) freinUtilise = true;
    TPMS.veloAvancer(vD, 0.25, { puissanceW: c.puissanceW, freinage: c.freinage,
                                 penteRad: point.penteRad, revetement: "asphalte" });
    if (t > 5) vMaxD = Math.max(vMaxD, vD.vitesseMs);
  }
  verifier("descente à 8 % avec freinage : reste sous 31 km/h (confort 30 km/h)",
    freinUtilise && vMaxD * 3.6 < 31 && vD.vitesseMs * 3.6 > 27, "max " + kmh(vMaxD));

  var face = rouler("route", 150, 0, 300, { ventFaceMs: 5 });
  var dos = rouler("route", 150, 0, 300, { ventFaceMs: -5 });
  verifier("vent de face ralentit, vent de dos accélère",
    face.vitesseMs < v.vitesseMs && dos.vitesseMs > v.vitesseMs, kmh(face.vitesseMs) + " / " + kmh(dos.vitesseMs));

  var leger = rouler("route", 150, 0, 300, { densiteAir: 1.0 });
  verifier("air moins dense (altitude, chaleur) : plus rapide", leger.vitesseMs > v.vitesseMs, kmh(leger.vitesseMs));

  // Résistance au roulement et pression.
  var vtt = TPMS.creerVelo({ type: "vtt" });
  var c15 = TPMS.veloCrr(vtt, 1.5, "asphalte"), c25 = TPMS.veloCrr(vtt, 2.5, "asphalte");
  verifier("Crr plus fort à 1,5 bar qu'à 2,5 bar (rapport ≈ √(2,5/1,5))",
    c15 > c25 && proche(c15 / c25, Math.sqrt(2.5 / 1.5), 0.01), c15.toFixed(4) + " / " + c25.toFixed(4));
  var plat = TPMS.veloCrr(vtt, 0.2, "asphalte");
  verifier("pneu à plat (0,2 bar) : Crr énorme", plat >= 0.25, plat.toFixed(3));
  var c04 = TPMS.veloCrr(vtt, 0.4, "asphalte");
  verifier("transition continue entre 0,5 et 0,3 bar",
    c04 > TPMS.veloCrr(vtt, 0.5, "asphalte") && c04 < plat, c04.toFixed(3));
  verifier("pavés et terre : Crr plus fort que sur asphalte",
    TPMS.veloCrr(vtt, 2.4, "pave") > TPMS.veloCrr(vtt, 2.4, "terre") &&
    TPMS.veloCrr(vtt, 2.4, "terre") > TPMS.veloCrr(vtt, 2.4, "asphalte"));
  var crev = rouler("route", 200, 0, 120, { pressionARBar: 0.1 });
  verifier("crevaison arrière à 200 W : on n'avance quasiment plus (< 8 km/h)",
    crev.vitesseMs * 3.6 < 8, kmh(crev.vitesseMs));
  var mou = rouler("route", 150, 0, 300, { pressionAVBar: 3, pressionARBar: 3 });
  verifier("pneus sous-gonflés (3 bar au lieu de 6,5) : plus lent", mou.vitesseMs < v.vitesseMs, kmh(mou.vitesseMs));

  // Tops de l'aimant.
  var r = TPMS.creerVelo({ type: "route", graine: 11 });
  var tops = 0, horsPas = false, tousTops = [];
  for (var t2 = 0; t2 < 120; t2 += 0.25) {
    TPMS.veloAvancer(r, 0.25, { puissanceW: 200 });
    tops += r.topsAimant.length;
    for (var i = 0; i < r.topsAimant.length; i++) {
      if (r.topsAimant[i] < 0 || r.topsAimant[i] >= 0.25) horsPas = true;
      tousTops.push(t2 + r.topsAimant[i]);
    }
  }
  var circ = 2 * Math.PI * r.rayonRoulementAVM;
  verifier("tops aimant : nombre = distance / circonférence (à 1 près)",
    Math.abs(tops - r.distanceM / circ) <= 1, tops + " tops pour " + (r.distanceM / circ).toFixed(1) + " tours");
  verifier("tops aimant : instants dans [0, dt[", !horsPas);
  var n = tousTops.length;
  var periode = tousTops[n - 1] - tousTops[n - 2];
  verifier("écart entre deux tops = circonférence / vitesse",
    proche(periode, circ / r.vitesseMs, 0.002), (periode * 1000).toFixed(1) + " ms");
  verifier("plusieurs tops dans un même pas si la roue tourne vite",
    (function () {
      var w = TPMS.creerVelo({ type: "route", graine: 2 });
      w.vitesseMs = 15;                         // 54 km/h, ~7 tours par seconde
      TPMS.veloAvancer(w, 0.25, {});
      return w.topsAimant.length >= 1 && w.topsAimant.length <= 2;
    })());
  verifier("angles des roues dans [0, 360[",
    r.angleRoueAVDeg >= 0 && r.angleRoueAVDeg < 360 && r.angleRoueARDeg >= 0 && r.angleRoueARDeg < 360);

  // Interpolation exacte : un grand pas donne les mêmes instants de tops
  // qu'un petit pas. En croisière, l'écart est de l'ordre de la ms ; en
  // pleine accélération depuis l'arrêt, Euler explicite (force évaluée au
  // début du pas) avance un peu le mouvement : on tolère 0,25 s sur 20 s.
  function instants(dt, vDepart) {
    var w = TPMS.creerVelo({ type: "ville", graine: 5 }), liste = [];
    w.vitesseMs = vDepart;
    for (var k = 0; k * dt < 20; k++) {
      TPMS.veloAvancer(w, dt, { puissanceW: 150 });
      w.topsAimant.forEach(function (x) { liste.push(k * dt + x); });
    }
    return liste;
  }
  function ecartMax(l1, l2) {
    var e = 0;
    for (var j = 0; j < Math.min(l1.length, l2.length); j++) e = Math.max(e, Math.abs(l1[j] - l2[j]));
    return e;
  }
  var croisiere = ecartMax(instants(0.25, 6.5), instants(0.01, 6.5));
  verifier("tops en croisière : mêmes instants avec dt = 0,25 s et dt = 0,01 s (< 5 ms)",
    croisiere < 0.005, (croisiere * 1000).toFixed(2) + " ms");
  var g1 = instants(0.25, 0), g2 = instants(0.01, 0);
  var depart = ecartMax(g1, g2);
  verifier("tops depuis l'arrêt : même nombre (±1), décalage < 0,25 s sur 20 s",
    Math.abs(g1.length - g2.length) <= 1 && depart < 0.25, (depart * 1000).toFixed(0) + " ms");

  // Stabilité d'Euler : même vitesse finale avec dt = 0,25 s et dt = 0,01 s.
  var w1 = TPMS.creerVelo({ type: "route" }), w2 = TPMS.creerVelo({ type: "route" });
  for (var k1 = 0; k1 < 240; k1++) TPMS.veloAvancer(w1, 0.25, { puissanceW: 150 });
  for (var k2 = 0; k2 < 6000; k2++) TPMS.veloAvancer(w2, 0.01, { puissanceW: 150 });
  verifier("Euler stable : dt = 0,25 s ≈ dt = 0,01 s (vitesse à 0,5 % près, distance à 1 %)",
    proche(w1.vitesseMs, w2.vitesseMs, 0.005 * w2.vitesseMs) && proche(w1.distanceM, w2.distanceM, 0.01 * w2.distanceM),
    kmh(w1.vitesseMs) + " / " + kmh(w2.vitesseMs));

  // Vitesse jamais négative : freinage complet à basse vitesse.
  var fr = TPMS.creerVelo({ type: "ville" }); fr.vitesseMs = 0.3;
  TPMS.veloAvancer(fr, 0.25, { freinage: 1 });
  var reste = fr.vitesseMs;
  TPMS.veloAvancer(fr, 0.25, { freinage: 0, penteRad: Math.atan(0.1) });
  verifier("vitesse jamais négative (freinage à l'arrêt, montée sans pédaler)",
    reste === 0 && fr.vitesseMs === 0);

  // Vibrations.
  var surPave = rouler("ville", 120, 0, 60, { revetement: "pave" });
  var surAsph = rouler("ville", 120, 0, 60, { revetement: "asphalte" });
  verifier("vibrations : pavés bien plus forts que l'asphalte",
    surPave.vibrationG > 3 * surAsph.vibrationG, surPave.vibrationG.toFixed(2) + " g / " + surAsph.vibrationG.toFixed(2) + " g");
  verifier("vibrations nulles à l'arrêt", TPMS.creerVelo({}).vibrationG === 0 &&
    (function () { var w = TPMS.creerVelo({}); TPMS.veloAvancer(w, 0.25, {}); return w.vibrationG === 0; })());

  // Rayon de roulement : pneu mou → tour de roue plus court.
  var rr = TPMS.creerVelo({ type: "ville" });
  verifier("pneu sous-gonflé : rayon de roulement plus petit",
    TPMS.veloRayonRoulementM(rr, 1.5, 300) < TPMS.veloRayonRoulementM(rr, 4, 300) &&
    TPMS.veloRayonRoulementM(rr, 4, 300) < rr.rayonRoueM);
})();

// ---------------------------------------------------------------------
// Cycliste sur les parcours
// ---------------------------------------------------------------------
(function () {
  var col = sortie("col-luere", "route", "sportif", 1, 0.25, 4 * 3600);
  var moy = col.v.distanceM / col.tS * 3.6;
  verifier("col de la Luère : arrivée, état « fini »", col.cy.etat === "fini" &&
    proche(col.v.distanceM, col.prep.longueurM, 5), (col.v.distanceM / 1000).toFixed(2) + " km");
  verifier("col de la Luère : moyenne réaliste pour un cycliste de club (20 à 28 km/h)",
    moy > 20 && moy < 28, moy.toFixed(1) + " km/h en " + (col.tS / 60).toFixed(0) + " min");

  var montee = col.vitesses.filter(function (x) { return x.pente > 5; });
  var plat = col.vitesses.filter(function (x) { return Math.abs(x.pente) < 1 && x.v > 3; });
  function moyenne(l) { return l.reduce(function (s, x) { return s + x.v; }, 0) / l.length; }
  verifier("col : plus lent dans la montée (> 5 %) que sur le plat, montée à 9-14 km/h",
    moyenne(montee) < moyenne(plat) && moyenne(montee) * 3.6 > 9 && moyenne(montee) * 3.6 < 14,
    "montée " + kmh(moyenne(montee)) + ", plat " + kmh(moyenne(plat)));
  verifier("col : jamais au-dessus de la vitesse de confort (55 km/h) + 1",
    col.v.vitesseMaxMs * 3.6 < 56, "max " + kmh(col.v.vitesseMaxMs));

  // Virages serrés de la descente : ralentissement net.
  var prep = col.prep;
  var epingle = prep.virages.filter(function (x) { return x.rayonM < 20 && x.distanceM > 17200 && x.distanceM < 20000; })[0];
  var autour = col.vitesses.filter(function (x) { return Math.abs(x.d - epingle.distanceM) < 3; });
  var avant = col.vitesses.filter(function (x) { return x.d > epingle.distanceM - 150 && x.d < epingle.distanceM - 100; });
  verifier("virage serré de la descente : ralentit (≤ √(a × R) + 1 m/s)",
    autour.length > 0 && Math.max.apply(null, autour.map(function (x) { return x.v; })) <=
      Math.sqrt(3.5 * epingle.rayonM) + 1 && moyenne(avant) > moyenne(autour),
    "rayon " + epingle.rayonM.toFixed(0) + " m, " + kmh(moyenne(avant)) + " → " + kmh(moyenne(autour)));

  // Ville : arrêts aux feux, jamais de feu grillé franchement.
  var ville = sortie("lyon-ville", "ville", "tranquille", 4, 0.25, 3600,
    { arret: function (t, v) { return v.distanceM > 8000; } });
  verifier("ville : s'arrête à des feux rouges", ville.cy.nbArretsFeu >= 2, ville.cy.nbArretsFeu + " arrêts");
  verifier("ville : s'arrête juste avant la ligne (0 à 5 m du feu)",
    ville.distanceArretFeu.every(function (d) { return d >= 0 && d <= 5; }),
    ville.distanceArretFeu.map(function (d) { return d.toFixed(1); }).join(" "));
  verifier("ville : moyenne 12 à 20 km/h avec les feux",
    (function () { var m = ville.v.distanceM / ville.tS * 3.6; return m > 12 && m < 20; })(),
    (ville.v.distanceM / ville.tS * 3.6).toFixed(1) + " km/h");

  // Départ : le cycliste démarre puis roule.
  var dep = sortie("domicile-travail", "ville", "trajet", 2, 0.25, 15);
  verifier("départ : état « roule » et vitesse > 10 km/h après 15 s",
    dep.cy.etat === "roule" && dep.v.vitesseMs * 3.6 > 10, kmh(dep.v.vitesseMs));

  // Crevaison à t = 120 s : le cycliste s'arrête.
  var crev = sortie("lyon-ville", "ville", "tranquille", 5, 0.25, 160, {
    conditions: function (t) { return t >= 120 ? { pneuAPlat: true, pressionARBar: 0.1 } : {}; }
  });
  verifier("crevaison : état « crevaison » et vélo arrêté en moins de 40 s",
    crev.cy.etat === "crevaison" && crev.v.vitesseMs === 0);

  // Fatigue.
  verifier("fatigue légère après le col (forme entre 0,8 et 0,95)",
    col.cy.forme > 0.8 && col.cy.forme < 0.95, col.cy.forme.toFixed(3));

  // Reproductibilité : même graine → même trajectoire au bit près.
  var a = sortie("monts-d-or-vtt", "vtt", "vtt", 42, 0.25, 1200);
  var b = sortie("monts-d-or-vtt", "vtt", "vtt", 42, 0.25, 1200);
  var c = sortie("monts-d-or-vtt", "vtt", "vtt", 43, 0.25, 1200);
  verifier("reproductible : même graine → même trajectoire",
    JSON.stringify(a.trace) === JSON.stringify(b.trace) && a.v.nbTopsAimant === b.v.nbTopsAimant &&
    a.v.vibrationG === b.v.vibrationG);
  verifier("autre graine → trajectoire différente", JSON.stringify(a.trace) !== JSON.stringify(c.trace));

  // Le pas de temps ne change pas le résultat global (dt 0,25 s vs 0,05 s).
  var fin = sortie("domicile-travail", "ville", "trajet", 9, 0.05, 3 * 3600);
  var gros = sortie("domicile-travail", "ville", "trajet", 9, 0.25, 3 * 3600);
  verifier("trajet complet : durée identique à 5 % près avec dt = 0,25 s ou 0,05 s",
    gros.cy.etat === "fini" && fin.cy.etat === "fini" && proche(gros.tS, fin.tS, 0.05 * fin.tS),
    (gros.tS / 60).toFixed(1) + " min / " + (fin.tS / 60).toFixed(1) + " min");
})();

// ---------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------
resultats.lignes.push("");
resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
if (typeof document !== "undefined") {
  document.getElementById("resultats").textContent = resultats.lignes.join("\n");
} else {
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
}
