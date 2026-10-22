// =====================================================================
// pneu.tests.js — Vérifications du modèle physique : atmosphère, météo,
// pneu (gaz parfait, chaleur, altitude, fuites, pompe) et capteur TPMS.
// ---------------------------------------------------------------------
// Se lance en ligne de commande : node simulateur/tests/pneu.tests.js
// Les valeurs attendues sont des ORDRES DE GRANDEUR réalistes : on vérifie
// que la simulation se comporte « comme la réalité ».
// =====================================================================

if (typeof require !== "undefined") {
  var fichiers = [
    "../../logique/trame.js", "../../logique/energie.js",
    "../monde/alea.js", "../monde/atmosphere.js", "../monde/pneu.js", "../monde/capteur.js"
  ];
  fichiers.forEach(function (f) { require(require("path").join(__dirname, f)); });
}

var resultats = { reussis: 0, rates: 0, lignes: [] };

function verifier(nom, condition, detail) {
  if (condition) {
    resultats.reussis++;
    resultats.lignes.push("OK     " + nom);
  } else {
    resultats.rates++;
    resultats.lignes.push("ÉCHEC  " + nom + (detail !== undefined ? "  → obtenu : " + detail : ""));
  }
}

function proche(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

function arrondi(x, n) {
  var f = Math.pow(10, n === undefined ? 3 : n);
  return Math.round(x * f) / f;
}

// Fait avancer un pneu seconde par seconde jusqu'à ce qu'il soit à plat.
// Retourne la durée (s), ou -1 s'il tient plus de dureeMaxS.
function tempsAvantAPlat(pneu, ctx, pasS, dureeMaxS) {
  var t = 0;
  while (!pneu.aPlat && t < dureeMaxS) {
    TPMS.pneuAvancer(pneu, pasS, ctx);
    t += pasS;
  }
  return pneu.aPlat ? t : -1;
}

// ---------------------------------------------------------------------
// Atmosphère
// ---------------------------------------------------------------------
(function () {
  verifier("atmosphère : 1013,25 hPa au niveau de la mer",
    TPMS.pressionAtmospheriquePa(0) === 101325, TPMS.pressionAtmospheriquePa(0));
  var p1500 = TPMS.pressionAtmospheriquePa(1500);
  verifier("atmosphère : ≈ 845,6 hPa à 1500 m", proche(p1500, 84556, 50), arrondi(p1500, 0));
  var p3000 = TPMS.pressionAtmospheriquePa(3000);
  verifier("atmosphère : ≈ 701 hPa à 3000 m", proche(p3000, 70109, 100), arrondi(p3000, 0));
  verifier("atmosphère : −6,5 °C par km", proche(TPMS.temperatureAltitudeC(20, 1000), 13.5, 1e-9));
})();

// ---------------------------------------------------------------------
// Météo
// ---------------------------------------------------------------------
(function () {
  var m = TPMS.creerMeteo(TPMS.METEOS.printemps);
  var aube = TPMS.meteoInstant(m, m.leverH);
  var apresMidi = TPMS.meteoInstant(m, m.heureMaxH);
  verifier("météo : minimum vers le lever du soleil (8 °C ± 1)",
    proche(aube.temperatureC, 8, 1), arrondi(aube.temperatureC, 2));
  verifier("météo : maximum vers heureMax (19 °C ± 1)",
    proche(apresMidi.temperatureC, 19, 1), arrondi(apresMidi.temperatureC, 2));
  var t3h = TPMS.meteoInstant(m, 3).temperatureC;
  var t21h = TPMS.meteoInstant(m, 21).temperatureC;
  verifier("météo : la nuit, entre min et max, plus frais le matin que le soir",
    t3h < t21h && t3h > 7 && t21h < 19, arrondi(t3h, 1) + " / " + arrondi(t21h, 1));

  verifier("météo : pas de soleil la nuit", TPMS.meteoInstant(m, 2).ensoleillement === 0);
  var midi = TPMS.meteoInstant(m, 13.6).ensoleillement;
  verifier("météo : soleil marqué en milieu de journée (0,4 à 0,75)",
    midi > 0.4 && midi <= 0.75, arrondi(midi, 2));

  var m2 = TPMS.creerMeteo(TPMS.METEOS.printemps);
  verifier("météo : même graine → même météo (reproductible)",
    TPMS.meteoInstant(m2, 10.3).temperatureC === TPMS.meteoInstant(m, 10.3).temperatureC &&
    TPMS.meteoInstant(m2, 10.3).ventMs === TPMS.meteoInstant(m, 10.3).ventMs);
  var opts = Object.assign({}, TPMS.METEOS.printemps, { graine: 999 });
  var m3 = TPMS.creerMeteo(opts);
  verifier("météo : autre graine → autres petites variations",
    TPMS.meteoInstant(m3, 10.3).temperatureC !== TPMS.meteoInstant(m, 10.3).temperatureC);
  // Ordre des appels sans importance
  var avant = TPMS.meteoInstant(m, 9).temperatureC;
  TPMS.meteoInstant(m, 17);
  verifier("météo : le résultat ne dépend pas de l'ordre des appels",
    TPMS.meteoInstant(m, 9).temperatureC === avant);

  var noms = Object.keys(TPMS.METEOS);
  verifier("météo : 4 préréglages", noms.length === 4 &&
    TPMS.METEOS.ete_canicule && TPMS.METEOS.hiver_gel && TPMS.METEOS.automne_pluie, noms.join(","));
  var chaud = TPMS.meteoInstant(TPMS.creerMeteo(TPMS.METEOS.ete_canicule), 16).temperatureC;
  var froid = TPMS.meteoInstant(TPMS.creerMeteo(TPMS.METEOS.hiver_gel), 7).temperatureC;
  verifier("météo : canicule > 33 °C l'après-midi, gel < 0 °C le matin d'hiver",
    chaud > 33 && froid < 0, arrondi(chaud, 1) + " / " + arrondi(froid, 1));
  var pluie = TPMS.meteoInstant(TPMS.creerMeteo(TPMS.METEOS.automne_pluie), 13);
  verifier("météo : sous la pluie, presque pas de soleil", pluie.pluie && pluie.ensoleillement < 0.1,
    arrondi(pluie.ensoleillement, 3));
})();

// ---------------------------------------------------------------------
// Pneu : gaz parfait, chaleur, altitude
// ---------------------------------------------------------------------
(function () {
  var p = TPMS.creerPneu({ nom: "AV", pressionRelBar: 2.2, temperatureC: 20, largeurMm: 40 });
  verifier("pneu : pression de gonflage retrouvée (2,2 bar)", proche(p.pressionRelBar, 2.2, 1e-9), p.pressionRelBar);
  verifier("pneu : volume d'un 700×40 ≈ 2,6 L", proche(p.volumeReposM3 * 1000, 2.6, 0.15),
    arrondi(p.volumeReposM3 * 1000, 2));
  // n = PV/RT = 321 325 Pa × 2,67 L / (8,314 × 293,15 K) ≈ 0,35 mol (≈ 10 g d'air)
  verifier("pneu : ≈ 0,35 mol d'air (PV = nRT)", proche(p.nMol, 0.352, 0.01), arrondi(p.nMol, 4));
  verifier("pneu : volume légèrement plus grand gonflé (+2,2 %)",
    proche(TPMS.pneuVolumeM3(p) / p.volumeReposM3, 1.022, 1e-6));

  // Chauffé de 20 à 40 °C : P × 313/293 ≈ +0,21 bar (un peu moins grâce à l'élasticité)
  TPMS.pneuAvancer(p, 3 * 3600, { temperatureAmbianteC: 40 });
  verifier("pneu : air intérieur arrivé à 40 °C", proche(p.temperatureAirC, 40, 0.05), arrondi(p.temperatureAirC, 2));
  var hausse = p.pressionRelBar - 2.2;
  verifier("pneu : 20 → 40 °C donne ≈ +0,2 bar", hausse > 0.17 && hausse < 0.23, arrondi(hausse));

  // Constante de temps : après 10 min à l'arrêt, ≈ 63 % du chemin
  var q = TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: 20 });
  TPMS.pneuAvancer(q, 600, { temperatureAmbianteC: 30 });
  verifier("pneu : constante de temps ≈ 10 min (63 % en 600 s)",
    proche(q.temperatureAirC, 26.3, 0.2), arrondi(q.temperatureAirC, 2));

  // Montée de 0 à 1500 m sans perte d'air : la pression RELATIVE augmente
  var r = TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: 20, altitudeM: 0 });
  var absolueAvant = TPMS.pneuPressionAbsoluePa(r);
  TPMS.pneuAvancer(r, 1, { temperatureAmbianteC: 20, altitudeM: 1500 });
  var gain = r.pressionRelBar - 2.2;
  verifier("pneu : 0 → 1500 m, pression relative +0,14 à +0,17 bar", gain > 0.14 && gain < 0.17, arrondi(gain));
  // Elle baisse très légèrement (≈ −0,16 %) : la carcasse, plus tendue, gonfle un peu.
  verifier("pneu : 0 → 1500 m, pression absolue quasi inchangée (< 0,3 %)",
    Math.abs(TPMS.pneuPressionAbsoluePa(r) - absolueAvant) < 0.003 * absolueAvant,
    arrondi(TPMS.pneuPressionAbsoluePa(r) - absolueAvant, 0) + " Pa");

  // Soleil, roulage, freinage : effets thermiques
  var s = TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: 20 });
  TPMS.pneuAvancer(s, 3600, { temperatureAmbianteC: 20, ensoleillement: 1, vitesseMs: 0 });
  verifier("pneu : en plein soleil à l'arrêt, l'air chauffe d'environ +12 °C",
    proche(s.temperatureAirC, 32, 1), arrondi(s.temperatureAirC, 1));
  var f = TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: 20 });
  TPMS.pneuAvancer(f, 600, { temperatureAmbianteC: 20, vitesseMs: 12, freinage: 0.6 });
  verifier("pneu : longue descente freins sur jante → air > 50 °C, pression +0,3 bar",
    f.temperatureAirC > 50 && f.pressionRelBar > 2.5, arrondi(f.temperatureAirC, 1) + " °C, " + arrondi(f.pressionRelBar, 2) + " bar");
})();

// ---------------------------------------------------------------------
// Pneu : crevaisons, fuites, perméation
// ---------------------------------------------------------------------
(function () {
  var p = TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: 20 });
  TPMS.pneuPercer(p, { type: "epine", diametreMm: 1 });
  var tEpine = tempsAvantAPlat(p, { temperatureAmbianteC: 20 }, 1, 3600);
  verifier("crevaison épine 1 mm : à plat en 30 s à 5 min", tEpine >= 30 && tEpine <= 300, tEpine + " s");
  TPMS.pneuAvancer(p, 600, { temperatureAmbianteC: 20 });
  verifier("crevaison : la pression finit à 0 (jamais négative)",
    p.pressionRelBar > -1e-4 && p.pressionRelBar < 0.001, p.pressionRelBar);

  var q = TPMS.creerPneu({ pressionRelBar: 2.2 });
  TPMS.pneuPercer(q, { type: "pincement" });
  verifier("pincement : 2 fentes", q.orifices.length === 2, q.orifices.length);
  var tPince = tempsAvantAPlat(q, {}, 1, 3600);
  verifier("pincement : à plat en quelques secondes (< 15 s)", tPince > 0 && tPince < 15, tPince + " s");

  // Stabilité numérique : pas de 1 s ou de 0,1 s → même vidange
  var a = TPMS.creerPneu({ pressionRelBar: 2.2 }), b = TPMS.creerPneu({ pressionRelBar: 2.2 });
  TPMS.pneuPercer(a, { type: "epine" }); TPMS.pneuPercer(b, { type: "epine" });
  TPMS.pneuAvancer(a, 20, {});
  for (var i = 0; i < 200; i++) TPMS.pneuAvancer(b, 0.1, {});
  verifier("crevaison : même résultat avec des pas de 1 s ou 0,1 s",
    proche(a.pressionRelBar, b.pressionRelBar, 0.01), arrondi(a.pressionRelBar) + " / " + arrondi(b.pressionRelBar));

  // Fuite lente : quelques dixièmes de bar par heure
  var l = TPMS.creerPneu({ pressionRelBar: 2.2 });
  TPMS.pneuFuiteLente(l, 0.025);
  TPMS.pneuAvancer(l, 3600, {});
  var perteH = 2.2 - l.pressionRelBar;
  verifier("fuite lente 0,025 mm : 0,1 à 0,5 bar/h", perteH > 0.1 && perteH < 0.5, arrondi(perteH));
  TPMS.pneuReparer(l);
  var apresRep = l.pressionRelBar;
  TPMS.pneuAvancer(l, 3600, {});
  verifier("réparation : plus de fuite (perte < 0,01 bar/h)",
    l.orifices.length === 0 && apresRep - l.pressionRelBar < 0.01, arrondi(apresRep - l.pressionRelBar, 4));

  // Perméation sur 24 h : latex >> butyle
  var butyle = TPMS.creerPneu({ pressionRelBar: 2.2, chambre: "butyle" });
  var latex = TPMS.creerPneu({ pressionRelBar: 2.2, chambre: "latex" });
  TPMS.pneuAvancer(butyle, 86400, { temperatureAmbianteC: 20 });
  TPMS.pneuAvancer(latex, 86400, { temperatureAmbianteC: 20 });
  var pB = 2.2 - butyle.pressionRelBar, pL = 2.2 - latex.pressionRelBar;
  verifier("perméation 24 h : butyle perd < 0,06 bar", pB > 0.01 && pB < 0.06, arrondi(pB));
  verifier("perméation 24 h : latex perd 0,25 à 0,6 bar, ≥ 8× plus que le butyle",
    pL > 0.25 && pL < 0.6 && pL > 8 * pB, arrondi(pL));

  // Pneu à plat au sommet d'un col, on redescend : l'air rentre par le trou
  var c = TPMS.creerPneu({ pressionRelBar: 2.2, altitudeM: 1500 });
  TPMS.pneuPercer(c, { type: "valve" });
  TPMS.pneuAvancer(c, 120, { altitudeM: 1500 });
  var nSommet = c.nMol;
  TPMS.pneuAvancer(c, 600, { altitudeM: 0 });
  verifier("pneu crevé redescendu du col : l'air extérieur rentre (n augmente)",
    c.nMol > nSommet * 1.1 && proche(c.pressionRelBar, 0, 0.001), arrondi(nSommet, 4) + " → " + arrondi(c.nMol, 4));
})();

// ---------------------------------------------------------------------
// Pneu : pompe
// ---------------------------------------------------------------------
(function () {
  var p = TPMS.creerPneu({ pressionRelBar: 0, temperatureC: 20 });
  var coups = TPMS.pneuGonflerJusqua(p, 2.2, 0, 20);
  verifier("pompe à pied : 10 à 25 coups pour 2,2 bar dans 2,6 L", coups >= 10 && coups <= 25, coups);
  verifier("pompe : cible atteinte sans la dépasser de plus d'un coup",
    p.pressionRelBar >= 2.2 && p.pressionRelBar < 2.4, arrondi(p.pressionRelBar));
  var echauffement = p.temperatureAirC - 20;
  verifier("pompe : l'air comprimé chauffe un peu (+1 à +10 °C)", echauffement > 1 && echauffement < 10,
    arrondi(echauffement, 2));
  var juste = p.pressionRelBar;
  TPMS.pneuAvancer(p, 3600, { temperatureAmbianteC: 20 });
  var baisse = juste - p.pressionRelBar;
  verifier("pompe : en refroidissant, le pneu perd 0,01 à 0,1 bar", baisse > 0.01 && baisse < 0.1, arrondi(baisse));

  var avant = TPMS.creerPneu({ pressionRelBar: 1 }).pressionRelBar;
  var unCoup = TPMS.pneuGonfler(TPMS.creerPneu({ pressionRelBar: 1 }), 1, 400, 0, 20);
  verifier("pompe : un coup de 400 cm³ ≈ +0,15 bar", proche(unCoup - avant, 0.15, 0.03), arrondi(unCoup - avant));

  var max = TPMS.creerPneu({ pressionRelBar: 2 });
  TPMS.pneuGonflerJusqua(max, 40, 0, 20);
  verifier("pompe : plafonne (volume mort) vers 25 bar, n'atteint pas 40",
    max.pressionRelBar > 15 && max.pressionRelBar < 30, arrondi(max.pressionRelBar, 1));

  var montagne = TPMS.creerPneu({ pressionRelBar: 0, altitudeM: 1500 });
  var coupsMontagne = TPMS.pneuGonflerJusqua(montagne, 2.2, 1500, 20);
  verifier("pompe : en altitude il faut plus de coups (air moins dense)", coupsMontagne > coups,
    coupsMontagne + " contre " + coups);
})();

// ---------------------------------------------------------------------
// Capteur TPMS : rythme d'annonce, contenu des trames
// ---------------------------------------------------------------------
function creerCapteurTest(options) {
  return TPMS.creerCapteurTPMS(Object.assign({
    numero: 1, adresse: [0xEA, 0xCA, 0x3F, 0x1B, 0x07], graine: 7, decalageBar: 0
  }, options || {}));
}

// Fait vivre un capteur de t0 à t0 + dureeS par pas de pasS ; retourne
// toutes les émissions. avantChaquePas(t) permet de modifier le monde.
function fairevivre(c, pneu, ctx, t0Ms, dureeS, pasS, avantChaquePas) {
  var toutes = [];
  for (var s = pasS; s <= dureeS + 1e-9; s += pasS) {
    var t = t0Ms + s * 1000;
    if (avantChaquePas) avantChaquePas(t);
    if (pneu) TPMS.pneuAvancer(pneu, pasS, ctx);
    toutes = toutes.concat(TPMS.capteurTPMSAvancer(c, t, pasS, pneu, ctx));
  }
  return toutes;
}

(function () {
  var ctxRoule = { altitudeM: 0, vitesseMs: 8, temperatureAmbianteC: 20, ensoleillement: 0 };
  var pneu = TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: 20 });
  var c = creerCapteurTest();
  var em = fairevivre(c, pneu, ctxRoule, 0, 60, 1);
  verifier("capteur : en roulant, une annonce toutes les 3 s (19 à 21 en 60 s)",
    em.length >= 19 && em.length <= 21, em.length);
  var ecarts = [];
  for (var i = 1; i < em.length; i++) ecarts.push(em[i].tMs - em[i - 1].tMs);
  verifier("capteur : intervalles de 3000 à 3010 ms (advDelay BLE), pas tous identiques",
    ecarts.every(function (e) { return e >= 3000 && e <= 3010; }) &&
    ecarts.some(function (e) { return e !== ecarts[0]; }), ecarts.slice(0, 4).map(Math.round).join(","));
  verifier("capteur : émissions datées dans l'intervalle demandé",
    em.every(function (e) { return e.tMs > 0 && e.tMs <= 60000; }));

  var trame = em[em.length - 1].octets;
  var d = TPMS.decoderTrame(trame);
  verifier("capteur : trame de 18 octets décodable", trame.length === 18 && d !== null);
  verifier("capteur : numéro et adresse dans la trame", d.numero === 1 && d.adresse === "EA:CA:3F:1B:07", d.adresse);
  verifier("capteur : pression mesurée = vraie pression ± 0,03 bar (niveau de la mer)",
    proche(d.pressionBar, pneu.pressionRelBar, 0.03), d.pressionBar + " / " + arrondi(pneu.pressionRelBar));
  verifier("capteur : pression quantifiée au centième de bar",
    em.every(function (e) {
      var pb = TPMS.decoderTrame(e.octets).pressionBar;
      return proche(pb * 100, Math.round(pb * 100), 1e-6);
    }));
  var valeurs = em.map(function (e) { return TPMS.decoderTrame(e.octets).pressionBar; });
  verifier("capteur : bruit visible mais faible (au moins 2 valeurs différentes, écart < 0,05)",
    Math.max.apply(null, valeurs) !== Math.min.apply(null, valeurs) &&
    Math.max.apply(null, valeurs) - Math.min.apply(null, valeurs) < 0.05, valeurs.slice(0, 6).join(" "));
  verifier("capteur : pas d'alarme pneu gonflé, pile ≥ 90 %", d.alarme === 0 && d.batteriePct >= 90, d.batteriePct);

  // À l'arrêt : une annonce par minute
  var c2 = creerCapteurTest();
  var pneu2 = TPMS.creerPneu({ pressionRelBar: 2.2 });
  var ctxArret = { altitudeM: 0, vitesseMs: 0, temperatureAmbianteC: 20 };
  var em2 = fairevivre(c2, pneu2, ctxArret, 0, 600, 5);
  verifier("capteur : à l'arrêt, une annonce par minute (10 ± 1 en 10 min)",
    em2.length >= 9 && em2.length <= 11, em2.length);

  // Crevaison à l'arrêt : annonce immédiate (variation rapide)
  var dernier = em2[em2.length - 1].tMs;
  TPMS.pneuPercer(pneu2, { type: "pincement" });
  var em3 = fairevivre(c2, pneu2, ctxArret, 600000, 10, 1);
  verifier("capteur : crevaison à l'arrêt → annonce dans les 2 s (pas 60 s)",
    em3.length >= 1 && em3[0].tMs - 600000 <= 2000, em3.length ? (em3[0].tMs - 600000) + " ms" : "aucune");
  verifier("capteur : plusieurs annonces pendant la vidange rapide", em3.length >= 2, em3.length);
  var fin = fairevivre(c2, pneu2, ctxArret, 610000, 120, 1);
  var dFin = TPMS.decoderTrame(fin[fin.length - 1].octets);
  verifier("capteur : pneu à plat → 0 bar et alarme « pas de pression »",
    dFin.pressionBar <= 0.03 && dFin.alarme === 1, dFin.pressionBar + " bar, alarme " + dFin.alarme);

  // Reproductibilité
  var x = creerCapteurTest({ graine: 3 }), y = creerCapteurTest({ graine: 3 });
  var ex = fairevivre(x, TPMS.creerPneu({ pressionRelBar: 2 }), ctxRoule, 0, 30, 1);
  var ey = fairevivre(y, TPMS.creerPneu({ pressionRelBar: 2 }), ctxRoule, 0, 30, 1);
  verifier("capteur : même graine → mêmes trames aux mêmes instants",
    ex.length === ey.length && ex.every(function (e, i) {
      return e.tMs === ey[i].tMs && TPMS.trameEnHexa(e.octets) === TPMS.trameEnHexa(ey[i].octets);
    }));
})();

// ---------------------------------------------------------------------
// Capteur TPMS : altitude, température, retrait
// ---------------------------------------------------------------------
(function () {
  // En montagne : le capteur soustrait 1013,25 hPa fixe → sous-estime
  var pneu = TPMS.creerPneu({ pressionRelBar: 2.2, altitudeM: 1500 });
  var c = creerCapteurTest();
  var ctx = { altitudeM: 1500, vitesseMs: 8, temperatureAmbianteC: 20 };
  var em = fairevivre(c, pneu, ctx, 0, 10, 1);
  var d = TPMS.decoderTrame(em[em.length - 1].octets);
  var erreur = d.pressionBar - pneu.pressionRelBar;
  verifier("capteur à 1500 m : annonce ≈ 0,17 bar de moins que le manomètre",
    proche(erreur, -0.168, 0.03), arrondi(erreur));

  // Température : le capteur (dehors) ne suit pas l'air du pneu (dedans)
  var p2 = TPMS.creerPneu({ pressionRelBar: 2.2 });
  var c2 = creerCapteurTest();
  var descente = { altitudeM: 0, vitesseMs: 12, temperatureAmbianteC: 15, freinage: 0.6, ensoleillement: 0 };
  fairevivre(c2, p2, descente, 0, 900, 5);
  verifier("capteur : freinage → air du pneu > 45 °C mais capteur < 25 °C",
    p2.temperatureAirC > 45 && c2.temperatureCapteurC < 25,
    arrondi(p2.temperatureAirC, 1) + " / " + arrondi(c2.temperatureCapteurC, 1));

  var c3 = creerCapteurTest();
  var soleil = { altitudeM: 0, vitesseMs: 0, temperatureAmbianteC: 20, ensoleillement: 1 };
  fairevivre(c3, TPMS.creerPneu({ pressionRelBar: 2.2 }), soleil, 0, 1800, 10);
  verifier("capteur : en plein soleil à l'arrêt, le bouchon chauffe (+6 à +12 °C)",
    c3.temperatureCapteurC > 26 && c3.temperatureCapteurC < 32, arrondi(c3.temperatureCapteurC, 1));
  var dT = TPMS.decoderTrame(TPMS.encoderTrame({ numero: 1, adresse: c3.adresse,
    pressionBar: 2, temperatureC: c3.derniereMesure.temperatureC, batteriePct: 90, alarme: 0 }));
  verifier("capteur : température annoncée ≈ température du boîtier (± 2 °C)",
    proche(dT.temperatureC, c3.temperatureCapteurC, 2), dT.temperatureC);

  // Dévissé : alarme immédiate, puis silence, puis réveil quand on le remet
  var p4 = TPMS.creerPneu({ pressionRelBar: 2.2 });
  var c4 = creerCapteurTest();
  var arret = { altitudeM: 0, vitesseMs: 0, temperatureAmbianteC: 20 };
  fairevivre(c4, p4, arret, 0, 120, 1);
  TPMS.capteurTPMSRetirer(c4);
  var emRetire = fairevivre(c4, p4, arret, 120000, 5, 1);
  verifier("capteur dévissé : annonce immédiate 0 bar + alarme",
    emRetire.length === 1 && TPMS.decoderTrame(emRetire[0].octets).alarme === 1 &&
    TPMS.decoderTrame(emRetire[0].octets).pressionBar <= 0.05, emRetire.length);
  var emLongtemps = fairevivre(c4, p4, arret, 125000, 900, 5);
  var derniere = emLongtemps.length ? emLongtemps[emLongtemps.length - 1].tMs : 0;
  verifier("capteur dévissé : se tait après ≈ 5 min (sommeil profond)",
    !c4.actif && c4.sommeilProfond && derniere < 125000 + 330000, (derniere / 1000) + " s");
  TPMS.capteurTPMSRemettre(c4);
  var emRemis = fairevivre(c4, p4, arret, 1025000, 5, 1);
  verifier("capteur revissé : se réveille et annonce dans les 2 s",
    emRemis.length >= 1 && c4.actif && emRemis[0].tMs - 1025000 <= 2000 &&
    proche(TPMS.decoderTrame(emRemis[0].octets).pressionBar, 2.2, 0.05), emRemis.length);
})();

// ---------------------------------------------------------------------
// Capteur TPMS : pile CR1632
// ---------------------------------------------------------------------
(function () {
  // Consommation sur 24 h à l'arrêt, comparée au bilan d'energie.js
  var c = creerCapteurTest();
  var ctx = { altitudeM: 0, vitesseMs: 0, temperatureAmbianteC: 20 };
  fairevivre(c, TPMS.creerPneu({ pressionRelBar: 2.2 }), ctx, 0, 86400, 10);
  var conso = 130 - c.pileRestanteMAh;
  // bilan d'energie.js + auto-décharge de la pile (1 %/an de 130 mAh)
  var attendu = 130 / TPMS.dureeViePileCapteurJours(60000) + 130 * 0.01 / 365;
  verifier("pile : conso d'une journée à l'arrêt = bilan énergétique (± 5 %)",
    proche(conso, attendu, attendu * 0.05), arrondi(conso, 4) + " mAh / " + arrondi(attendu, 4));
  var c2 = creerCapteurTest();
  fairevivre(c2, TPMS.creerPneu({ pressionRelBar: 2.2 }), { altitudeM: 0, vitesseMs: 8, temperatureAmbianteC: 20 }, 0, 3600, 10);
  var consoRoule = 130 - c2.pileRestanteMAh;
  // 1200 annonces × 25 µC = 0,0083 mAh + sommeil 0,002 mAh ≈ 0,0105 mAh par heure
  verifier("pile : 1 h de roulage (1200 annonces) ≈ 0,0105 mAh, 4× plus qu'à l'arrêt",
    proche(consoRoule, 0.0105, 0.001) && consoRoule > 4 * conso / 24, arrondi(consoRoule, 4));

  // Courbe de tension
  var neuve = TPMS.pileTensionVideV(1, 20), moitie = TPMS.pileTensionVideV(0.5, 20),
      presqueVide = TPMS.pileTensionVideV(0.02, 20);
  verifier("pile : plateau ≈ 3 V puis chute (3,1 / 2,95 / 2,4 V)",
    proche(neuve, 3.1, 0.01) && proche(moitie, 2.95, 0.01) && proche(presqueVide, 2.4, 0.01),
    neuve + " / " + moitie + " / " + presqueVide);
  verifier("pile : le froid baisse la tension", TPMS.pileTensionVideV(0.5, -10) < moitie - 0.05,
    arrondi(TPMS.pileTensionVideV(0.5, -10), 3));
  verifier("pile : pourcentage annoncé ≈ 94 % à mi-vie, faible en fin de vie",
    TPMS.pilePourcentage(moitie) >= 90 && TPMS.pilePourcentage(presqueVide) <= 30,
    TPMS.pilePourcentage(moitie) + " % / " + TPMS.pilePourcentage(presqueVide) + " %");

  // Pile usée : fonctionne au chaud, muette au froid
  var usee = creerCapteurTest({ pile: { capaciteMAh: 130, restanteMAh: 130 * 0.03 } });
  var emChaud = fairevivre(usee, TPMS.creerPneu({ pressionRelBar: 2.2 }),
    { altitudeM: 0, vitesseMs: 8, temperatureAmbianteC: 20 }, 0, 30, 1);
  verifier("pile usée (3 %) à 20 °C : le capteur émet encore", emChaud.length >= 9 && usee.actif, emChaud.length);
  var emFroid = fairevivre(usee, TPMS.creerPneu({ pressionRelBar: 2.2, temperatureC: -20 }),
    { altitudeM: 0, vitesseMs: 8, temperatureAmbianteC: -20 }, 30000, 3600, 5);
  var dernierFroid = emFroid.length ? emFroid[emFroid.length - 1].tMs : 0;
  verifier("pile usée à −20 °C : le capteur devient muet (tension en charge < 2 V)",
    !usee.actif && usee.pileTensionChargeV < 2 && dernierFroid < 30000 + 1800000,
    arrondi(usee.pileTensionChargeV, 3) + " V");

  var morte = creerCapteurTest({ pile: { restanteMAh: 0 } });
  var emMorte = fairevivre(morte, TPMS.creerPneu({ pressionRelBar: 2.2 }),
    { altitudeM: 0, vitesseMs: 8, temperatureAmbianteC: 20 }, 0, 60, 1);
  verifier("pile vide : aucune émission", emMorte.length === 0 && !morte.actif, emMorte.length);
})();

// ---------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------
resultats.lignes.push("");
resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
if (typeof document !== "undefined") {
  var zone = document.getElementById("resultats");
  if (zone) zone.textContent = resultats.lignes.join("\n");
} else {
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
}
