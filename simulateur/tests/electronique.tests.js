// =====================================================================
// electronique.tests.js — Vérifications de l'électronique simulée
// ---------------------------------------------------------------------
// Se lance en ligne de commande :
//   node simulateur/tests/electronique.tests.js
// Vérifie la batterie LiPo et son chargeur (monde/lipo.js), la
// résolution du circuit (monde/circuit.js) et le schéma animé
// (vues/schema.js). Même style que tests.js.
// =====================================================================

if (typeof require !== "undefined") {
  var fichiers = [
    "../../logique/energie.js",
    "../monde/alea.js", "../monde/lipo.js", "../monde/circuit.js",
    "../vues/schema.js"
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
function ma(a) { return (a * 1000).toFixed(3) + " mA"; }

// Situations types du boîtier (les mêmes mots que logique/energie.js)
var ETATS = {
  veille: { veille: true },
  repos: { cpuActif: true },
  ecoute: { cpuActif: true, radioReception: true }
};

// ---------------------------------------------------------------------
// LiPo : courbe de tension
// ---------------------------------------------------------------------
(function () {
  var l = TPMS.creerLipo({ capaciteMAh: 500, etatCharge: 1 });
  verifier("LiPo pleine : 4,20 V", proche(l.tensionV, 4.20, 0.005), l.tensionV);
  var plateauOk = true;
  for (var s = 0.15; s <= 0.55; s += 0.05) {
    var v = TPMS.lipoTensionVideV(s, 25);
    if (v < 3.68 || v > 3.86) plateauOk = false;
  }
  verifier("LiPo : plateau 3,7-3,85 V entre 15 et 55 %", plateauOk);
  verifier("LiPo : sous 3,5 V en dessous de 4 %", TPMS.lipoTensionVideV(0.03, 25) < 3.5, TPMS.lipoTensionVideV(0.03, 25));
  var croissante = true, avant = 0;
  for (var i = 0; i <= 100; i++) {
    var u = TPMS.lipoTensionVideV(i / 100, 10);
    if (u < avant) croissante = false;
    avant = u;
  }
  verifier("LiPo : tension à vide croissante (dichotomie de la jauge possible)", croissante);
  verifier("LiPo : le froid baisse la tension à vide",
    TPMS.lipoTensionVideV(0.3, -10) < TPMS.lipoTensionVideV(0.3, 25) - 0.02,
    TPMS.lipoTensionVideV(0.3, -10));
  verifier("LiPo : résistance interne × 3 à −10 °C",
    TPMS.lipoResistanceOhm(l, -10) > 3 * TPMS.lipoResistanceOhm(l, 25), TPMS.lipoResistanceOhm(l, -10));

  // Sous courant : U = OCV − R0·I − Up, puis la tension remonte au repos.
  var b = TPMS.creerLipo({ etatCharge: 0.5 });
  TPMS.lipoAvancer(b, 60, 0.5, 25);
  var chute = b.tensionVideV - b.tensionV;
  verifier("LiPo : chute R·I sous 500 mA (≈ 0,09 V + polarisation)", chute > 0.09 && chute < 0.2, chute.toFixed(3) + " V");
  var sousCharge = b.tensionV;
  TPMS.lipoAvancer(b, 1, 0, 25);
  var juste = b.tensionV;
  TPMS.lipoAvancer(b, 180, 0, 25);
  verifier("LiPo : la tension remonte à l'arrêt (R0 tout de suite, puis polarisation)",
    juste > sousCharge + 0.08 && b.tensionV > juste + 0.01, sousCharge.toFixed(3) + " → " + juste.toFixed(3) + " → " + b.tensionV.toFixed(3));

  // Autodécharge : 30 jours sans rien brancher (3 %/mois + 3 µA de protection)
  var a = TPMS.creerLipo({ etatCharge: 1 });
  for (var j = 0; j < 30; j++) TPMS.lipoAvancer(a, 86400, 0, 25);
  verifier("LiPo : autodécharge ≈ 3,4 % en 30 jours", proche(1 - a.etatCharge, 0.034, 0.006), ((1 - a.etatCharge) * 100).toFixed(2) + " %");

  // Dispersion de fabrication : reproductible avec la graine
  var g1 = TPMS.creerLipo({ graine: 7 }), g2 = TPMS.creerLipo({ graine: 7 }), g3 = TPMS.creerLipo({ graine: 8 });
  verifier("LiPo : même graine = même cellule, autre graine = autre cellule",
    g1.capaciteMAh === g2.capaciteMAh && g1.capaciteMAh !== g3.capaciteMAh && Math.abs(g1.capaciteMAh - 500) < 50,
    g1.capaciteMAh.toFixed(1) + " / " + g3.capaciteMAh.toFixed(1));
})();

// ---------------------------------------------------------------------
// LiPo : décharge complète, protection, brownout, recharge
// ---------------------------------------------------------------------
(function () {
  var l = TPMS.creerLipo({ etatCharge: 1 });
  var t = 0, dt = 60, e;
  while (!l.coupee && t < 200 * 3600) {
    e = TPMS.circuitResoudre(ETATS.ecoute, l);
    TPMS.lipoAvancer(l, dt, e.courantBatterieA, 25);
    t += dt;
  }
  var heures = t / 3600;
  // 500 mAh / 5,02 mA = 99,6 h
  verifier("décharge complète en écoute radio : ≈ 99 h (500 mAh / 5 mA)", heures > 95 && heures < 101, heures.toFixed(1) + " h");
  verifier("protection : coupure en surdécharge", l.coupee && l.raisonCoupure === "surdecharge", l.raisonCoupure);
  verifier("protection : plus de tension aux bornes après la coupure", l.tensionV === 0, l.tensionV);

  e = TPMS.circuitResoudre(ETATS.ecoute, l);
  verifier("batterie vide : 3V3 = 0 V et nRF éteint", e.tensions.V3V3 === 0 && e.etats.nrfAlimente === false, e.tensions.V3V3);
  verifier("batterie vide : alerte brownout", e.alertes.some(function (a) { return a.indexOf("Brownout") === 0; }), e.alertes.join(" | "));

  // Une heure plus tard : la protection reste ouverte tant qu'on ne recharge pas
  TPMS.lipoAvancer(l, 3600, TPMS.circuitResoudre(ETATS.ecoute, l).courantBatterieA, 25);
  verifier("protection : reste coupée sans chargeur", l.coupee);

  // Câble magnétique branché : le boîtier repart, la batterie se charge
  e = TPMS.circuitResoudre({ cpuActif: true, vbusV: 5 }, l);
  verifier("recharge : 3V3 revient (alimenté par VBUS)", proche(e.tensions.V3V3, 3.3, 0.01), e.tensions.V3V3);
  verifier("recharge : le courant de batterie devient négatif", e.courantBatterieA < -0.05, ma(e.courantBatterieA));
  verifier("recharge : Schottky D2, VBUS = 5 V − 0,2 à 0,4 V", e.tensions.VBUS > 4.6 && e.tensions.VBUS < 4.8, e.tensions.VBUS.toFixed(3) + " V");
  TPMS.lipoAvancer(l, 10, e.courantBatterieA, 25);
  verifier("protection : réarmée par le chargeur", !l.coupee && l.tensionV > 3.0, l.tensionV);

  // Charge complète : CC puis CV puis fin de charge
  var phases = [], courantsCv = [], courantCc = 0, tCharge = 0, finSoc = 0;
  for (var k = 0; k < 4000; k++) {
    e = TPMS.circuitResoudre({ cpuActif: true, vbusV: 5 }, l);
    if (phases[phases.length - 1] !== e.chargeurPhase) phases.push(e.chargeurPhase);
    if (e.chargeurPhase === "cc") courantCc = e.courantChargeA;
    if (e.chargeurPhase === "cv") courantsCv.push(e.courantChargeA);
    if (e.chargeurPhase === "termine") { finSoc = l.etatCharge; break; }
    TPMS.lipoAvancer(l, 10, e.courantBatterieA, 25);
    tCharge += 10;
  }
  verifier("recharge : phases CC → CV → fin de charge", phases.join(" → ") === "cc → cv → termine", phases.join(" → "));
  verifier("recharge : courant constant de 100 mA", proche(courantCc, 0.100, 1e-6), ma(courantCc));
  var decroissant = courantsCv.length > 5;
  for (var m = 1; m < courantsCv.length; m++) if (courantsCv[m] > courantsCv[m - 1] + 1e-9) decroissant = false;
  verifier("recharge : courant décroissant en phase CV", decroissant, courantsCv.length + " pas");
  verifier("recharge : fin de charge sous 10 % de ICHG (10 mA)",
    courantsCv[courantsCv.length - 1] < 0.012 && courantsCv[courantsCv.length - 1] >= 0.010,
    ma(courantsCv[courantsCv.length - 1]));
  verifier("recharge : batterie pleine à 4,2 V en 4,5 à 6,5 h",
    finSoc > 0.99 && proche(l.tensionV, 4.2, 0.03) && tCharge > 4.5 * 3600 && tCharge < 6.5 * 3600,
    (tCharge / 3600).toFixed(2) + " h, " + (finSoc * 100).toFixed(1) + " %, " + l.tensionV.toFixed(3) + " V");
  e = TPMS.circuitResoudre({ cpuActif: true, vbusV: 5 }, l);
  verifier("recharge : plus de courant de charge après la fin", e.courantChargeA === 0 && e.chargeurPhase === "termine");

  // Surcharge (chargeur défaillant qui force 500 mA) : coupure à 4,25 V
  var s = TPMS.creerLipo({ etatCharge: 1 });
  TPMS.lipoAvancer(s, 5, -0.5, 25);
  verifier("protection : coupure en surcharge au-dessus de 4,25 V", s.coupee && s.raisonCoupure === "surcharge", s.tensionCelluleV);

  // Précharge : cellule très froide (tension à vide sous 3,0 V)
  var f = TPMS.creerLipo({ etatCharge: 0.05, temperatureC: -10 });
  e = TPMS.circuitResoudre({ cpuActif: true, vbusV: 5 }, f);
  verifier("chargeur : précharge à 20 mA sous 3,0 V", e.chargeurPhase === "precharge" && proche(e.courantChargeA, 0.02, 0.002), e.chargeurPhase + " " + ma(e.courantChargeA));
  verifier("chargeur : alerte de recharge hors 0-45 °C", e.alertes.some(function (a) { return a.indexOf("Recharge hors") === 0; }));
  var sansCable = TPMS.circuitResoudre({ cpuActif: true, vbusV: 0 }, TPMS.creerLipo({ etatCharge: 0.5 }));
  verifier("chargeur : rien sans 5 V", sansCable.chargeurPhase === "absent" && sansCable.courantChargeA === 0);
})();

// ---------------------------------------------------------------------
// Circuit : tensions, LED, MOSFET, reed
// ---------------------------------------------------------------------
(function () {
  var pleine = TPMS.circuitResoudre(ETATS.ecoute, TPMS.creerLipo({ etatCharge: 1 }));
  var moitie = TPMS.circuitResoudre(ETATS.ecoute, TPMS.creerLipo({ etatCharge: 0.5 }));
  verifier("tensions : VBAT entre 3,7 et 4,2 V", pleine.tensions.VBAT <= 4.2 && pleine.tensions.VBAT > 4.15 &&
    moitie.tensions.VBAT > 3.7 && moitie.tensions.VBAT < 3.9, pleine.tensions.VBAT.toFixed(3) + " / " + moitie.tensions.VBAT.toFixed(3));
  verifier("tensions : 3V3 = 3,30 V", proche(pleine.tensions.V3V3, 3.3, 0.005) && proche(moitie.tensions.V3V3, 3.3, 0.005), moitie.tensions.V3V3);

  var lipo = TPMS.creerLipo({ etatCharge: 0.5 });
  var led = TPMS.circuitResoudre({ cpuActif: true, ledAlerte: true }, lipo);
  verifier("LED rouge : ≈ 5 mA ((3,3 − 1,85) / 300 Ω)", led.courants.LED1 > 0.0045 && led.courants.LED1 < 0.0053, ma(led.courants.LED1));
  verifier("LED rouge : sortie D7 « forte » à plus de 3,1 V", led.tensions.D7 > 3.1 && led.tensions.D7 < 3.3, led.tensions.D7);

  function eclairage(soc) { return TPMS.circuitResoudre({ cpuActif: true, eclairage: true }, TPMS.creerLipo({ etatCharge: soc })); }
  var e100 = eclairage(1), e20 = eclairage(0.2), e2 = eclairage(0.02);
  verifier("LED blanches : ≈ 5 mA chacune à VBAT ≈ 3,7 V", e20.courants.LED2 > 0.0045 && e20.courants.LED2 < 0.0058,
    ma(e20.courants.LED2) + " à " + e20.tensions.VBAT.toFixed(2) + " V");
  verifier("LED blanches : le courant baisse quand la batterie se vide",
    e100.courants.LED2 > e20.courants.LED2 + 0.002 && e20.courants.LED2 > e2.courants.LED2 + 0.001,
    ma(e100.courants.LED2) + " > " + ma(e20.courants.LED2) + " > " + ma(e2.courants.LED2));
  verifier("alerte « batterie faible » sous 3,3 V",
    e2.alertes.some(function (a) { return a.indexOf("Batterie faible") === 0; }), e2.alertes.join(" | "));

  var bloque = TPMS.circuitResoudre({ cpuActif: true }, lipo);
  verifier("MOSFET Q2 bloqué sans tension de grille : LED éteintes", !bloque.etats.q2Passant && bloque.courants.Q2 < 1e-6, ma(bloque.courants.Q2));
  verifier("MOSFET Q1 bloqué sans tension de grille : buzzer muet", !bloque.etats.q1Passant && bloque.courants.BZ1 < 1e-6, ma(bloque.courants.BZ1));
  var bz = TPMS.circuitResoudre({ cpuActif: true, buzzer: true }, lipo);
  verifier("MOSFET Q1 passant : VDS < 5 mV (RDS(on) ≈ 31 mΩ)", bz.etats.q1Passant && bz.tensions.DQ1 < 0.005, (bz.tensions.DQ1 * 1000).toFixed(2) + " mV");
  verifier("buzzer : ≈ 25 mA", proche(bz.courants.BZ1, 0.025, 0.002) && bz.etats.buzzerSonne, ma(bz.courants.BZ1));
  verifier("grille Q1 : VGS ≈ 3,3 V (pont R2/R4 négligeable)", proche(bz.tensions.G1, 3.3, 0.02), bz.tensions.G1);

  var reed = TPMS.circuitResoudre({ cpuActif: true, reedFerme: true, reedPullupActif: true }, lipo);
  verifier("reed fermé, pull-up actif : ≈ 0,25 mA", proche(reed.courants.S1, 0.25e-3, 0.03e-3), ma(reed.courants.S1));
  verifier("reed fermé : D4 à l'état bas (< 0,3 × 3V3)", reed.tensions.D4 < 0.99, reed.tensions.D4);
  var reedCoupe = TPMS.circuitResoudre({ cpuActif: true, reedFerme: true, reedPullupActif: false }, lipo);
  verifier("reed fermé, pull-up débranché : 0 mA", reedCoupe.courants.S1 === 0);
  var reedOuvert = TPMS.circuitResoudre({ cpuActif: true, reedFerme: false, reedPullupActif: false }, lipo);
  verifier("reed ouvert sans tirage : D4 en l'air (null)", reedOuvert.tensions.D4 === null);
  var option = TPMS.circuitResoudre({ cpuActif: true, reedFerme: true, reedPullupActif: false, optionReedExterne: true }, lipo);
  verifier("option R9 1 MΩ : 3,3 µA aimant arrêté devant", proche(option.courants.S1, 3.3e-6, 0.1e-6), ma(option.courants.S1));

  // Régulateur en déchet et brownout (batterie imposée, sans modèle LiPo)
  var dechet = TPMS.circuitResoudre(ETATS.ecoute, null);
  verifier("sans LiPo : VBAT par défaut 3,8 V", dechet.tensions.VBAT === 3.8);
  var bas = TPMS.circuitResoudre({ cpuActif: true, radioReception: true, vbatV: 3.2 }, null);
  verifier("régulateur en déchet : 3V3 suit VBAT (3,2 V → < 3,2 V)", bas.tensions.V3V3 < 3.2 && bas.tensions.V3V3 > 3.15 && bas.etats.regulateurEnDechet, bas.tensions.V3V3);
  var ep = TPMS.circuitResoudre({ cpuActif: true, vbatV: 2.0 }, null);
  verifier("brownout e-paper sous 2,2 V", ep.alertes.some(function (a) { return a.indexOf("Brownout de l'e-paper") === 0; }) && ep.etats.nrfAlimente);
  var nrf = TPMS.circuitResoudre({ cpuActif: true, ledAlerte: true, vbatV: 1.6 }, null);
  verifier("brownout nRF52840 sous 1,7 V : sorties à 0", !nrf.etats.nrfAlimente && nrf.courants.LED1 === 0 &&
    nrf.alertes.some(function (a) { return a.indexOf("Brownout : 3V3") === 0; }));

  // Loi des nœuds : le courant de la batterie = somme des consommations
  var tout = TPMS.circuitResoudre({ cpuActif: true, radioReception: true, ecran: "partiel", ledAlerte: true, eclairage: true,
    buzzer: true, reedFerme: true, bouton1: true, bouton2: true, appConnectee: true }, lipo);
  var c = tout.courants;
  var somme = c.U1 + c.U2 + c.LED1 + c.BZ1 + c.R2 + c.R3 + c.S1 + c.SW1 + c.SW2 + c.Q2 + c["U1.pont"] + c["U1.regulateur"];
  verifier("loi des nœuds : I batterie = somme des courants des composants", proche(tout.courantBatterieA, somme, 1e-9),
    ma(tout.courantBatterieA) + " / " + ma(somme));
  verifier("puissance = VBAT × I", proche(tout.puissanceW, tout.tensions.VBAT * tout.courantBatterieA, 1e-9));
  verifier("tout allumé : ≈ 49 mA", tout.courantBatterieA > 0.044 && tout.courantBatterieA < 0.054, ma(tout.courantBatterieA));

  // Composants tirés au sort (tolérances)
  var k1 = TPMS.circuitTirerComposants(3), k2 = TPMS.circuitTirerComposants(3), k3 = TPMS.circuitTirerComposants(4);
  verifier("tolérances : reproductibles et dans ±1 % pour R1",
    k1.resistances.R1 === k2.resistances.R1 && k1.resistances.R1 !== k3.resistances.R1 && Math.abs(k1.resistances.R1 / 270 - 1) < 0.02,
    k1.resistances.R1.toFixed(2));
  var ledTiree = TPMS.circuitResoudre({ cpuActif: true, eclairage: true }, TPMS.creerLipo({ etatCharge: 0.5 }), k3);
  verifier("tolérances : les 2 LED blanches ne sont plus identiques", ledTiree.courants.LED2 !== ledTiree.courants.LED3,
    ma(ledTiree.courants.LED2) + " / " + ma(ledTiree.courants.LED3));
})();

// ---------------------------------------------------------------------
// Cohérence avec logique/energie.js
// ---------------------------------------------------------------------
(function () {
  var lipo = TPMS.creerLipo({ etatCharge: 0.2 });   // VBAT ≈ 3,73 V, comme l'hypothèse « 3,7 V » d'energie.js
  var cas = [
    ["veille", { veille: true }, { veille: true }],
    ["éveillé radio coupée", { cpuActif: true }, {}],
    ["écoute radio", ETATS.ecoute, { radio: true }],
    ["écoute + app connectée", { cpuActif: true, radioReception: true, radioEmission: true, appConnectee: true }, { radio: true, appConnectee: true }],
    ["LED d'alerte fixe", { cpuActif: true, ledAlerte: true }, { ledAlerte: "fixe" }],
    ["éclairage", { cpuActif: true, eclairage: true }, { eclairage: true }],
    ["reed resté fermé", { cpuActif: true, reedFerme: true }, { reedColle: true }],
    ["radio + éclairage + app + alerte", { cpuActif: true, radioReception: true, appConnectee: true, eclairage: true, ledAlerte: true },
      { radio: true, appConnectee: true, eclairage: true, ledAlerte: "fixe" }]
  ];
  cas.forEach(function (c) {
    var circuit = TPMS.circuitResoudre(c[1], lipo).courantBatterieA * 1000;
    var bilan = TPMS.consoInstantaneeMa(c[2]);
    verifier("energie.js : " + c[0] + " (" + bilan.toFixed(3) + " mA)", Math.abs(circuit / bilan - 1) < 0.10,
      circuit.toFixed(4) + " mA");
  });
  var ecran = TPMS.circuitResoudre({ cpuActif: true, ecran: "partiel" }, lipo).courants.U2 * 1000 * 0.5;
  verifier("energie.js : charge d'un rafraîchissement partiel (1,5 mA·s)", proche(ecran, TPMS.CONSO.ecranPartielMas, 0.01), ecran);
  var bip = TPMS.circuitResoudre({ cpuActif: true, buzzer: true }, lipo).courants.BZ1 * 1000 * 3 * 0.12;
  verifier("energie.js : charge d'un bip (9 mA·s)", proche(bip, TPMS.CONSO.bipMas, 0.5), bip.toFixed(2));
})();

// ---------------------------------------------------------------------
// Schéma SVG
// ---------------------------------------------------------------------
(function () {
  var svg = TPMS.schemaSvg();
  var manquants = [];
  TPMS.SCHEMA_COMPOSANTS.forEach(function (ref) {
    if (svg.indexOf('id="comp-' + ref + '"') < 0) manquants.push("comp-" + ref);
    if (svg.indexOf('id="val-' + ref + '"') < 0) manquants.push("val-" + ref);
  });
  verifier("schéma : un groupe comp-* et un texte val-* par composant (" + TPMS.SCHEMA_COMPOSANTS.length + ")",
    manquants.length === 0, manquants.join(", "));
  var noeudsManquants = Object.keys(TPMS.SCHEMA_NOEUDS).filter(function (n) { return svg.indexOf('id="tension-' + n + '"') < 0; });
  verifier("schéma : un texte tension-* par nœud", noeudsManquants.length === 0, noeudsManquants.join(", "));
  ["fil-led1", "fil-led2", "fil-led3", "fil-buzzer", "fil-eclairage", "fil-reed", "fil-recharge", "fil-batterie", "fil-spi",
   "lueur-LED1", "lueur-LED2", "lueur-LED3", "aimant", "alertes"].forEach(function (id) {
    if (svg.indexOf('id="' + id + '"') < 0) manquants.push(id);
  });
  verifier("schéma : groupes de fils, lueurs, aimant et zone d'alertes", manquants.length === 0, manquants.join(", "));

  // Toutes les clés data-courant existent dans le résultat du circuit
  var etat = TPMS.circuitResoudre({ cpuActif: true }, TPMS.creerLipo({}));
  var cles = {}, re = /data-courant="([^"]+)"/g, r;
  while ((r = re.exec(svg))) cles[r[1]] = true;
  var inconnues = Object.keys(cles).filter(function (k) { return !(k in etat.courants); });
  verifier("schéma : chaque data-courant correspond à un courant calculé (" + Object.keys(cles).length + " clés)",
    inconnues.length === 0 && Object.keys(cles).length >= 20, inconnues.join(", "));
  var ouvrants = (svg.match(/<g[ >]/g) || []).length, fermants = (svg.match(/<\/g>/g) || []).length;
  verifier("schéma : SVG bien formé (groupes équilibrés, pas de NaN ni d'undefined)",
    ouvrants === fermants && svg.indexOf("NaN") < 0 && svg.indexOf("undefined") < 0, ouvrants + " / " + fermants);
  var ids = svg.match(/ id="[^"]+"/g) || [], vus = {}, doublons = [];
  ids.forEach(function (i) { if (vus[i]) doublons.push(i); vus[i] = true; });
  verifier("schéma : aucun id en double", doublons.length === 0, doublons.join(","));

  // Le fichier du dossier est bien produit par ce même code
  if (typeof require !== "undefined") {
    var fs = require("fs"), path = require("path");
    var fichier = path.join(__dirname, "..", "..", "docs", "schema", "schema-boitier.svg");
    var contenu = fs.existsSync(fichier) ? fs.readFileSync(fichier, "utf8") : "";
    verifier("schéma : docs/schema/schema-boitier.svg à jour (node docs/schema/genere-schema.js)",
      contenu.indexOf(svg) >= 0);
  }

  // Aspect des fils : plus de courant = pointillés plus rapides et trait plus épais
  var s0 = TPMS.schemaStyleCourant(0), s1 = TPMS.schemaStyleCourant(5e-6), s2 = TPMS.schemaStyleCourant(0.025);
  var s3 = TPMS.schemaStyleCourant(-0.1);
  verifier("animation : rien sous 0,3 µA, plus vite et plus épais quand le courant augmente",
    s0 === null && s2.dureeS < s1.dureeS && s2.epaisseurPx > s1.epaisseurPx && s3.inverse && !s2.inverse);
  verifier("textes : 4,84 mA, 235,7 µA, 3,30 V, en l'air",
    TPMS.schemaTexteCourant(0.00484) === "4,84 mA" && TPMS.schemaTexteCourant(235.7e-6) === "235,7 µA" &&
    TPMS.schemaTexteTension(3.3) === "3,30 V" && TPMS.schemaTexteTension(null) === "en l'air");

  // Mise à jour sur un faux DOM minimal (sans navigateur)
  function FauxElement(attrs) {
    var classes = {};
    (attrs["class"] || "").split(/\s+/).forEach(function (c) { if (c) classes[c] = true; });
    this.attrs = attrs; this.textContent = ""; this.style = { props: {}, setProperty: function (k, v) { this.props[k] = v; } };
    this.classes = classes;
    this.classList = {
      add: function (c) { classes[c] = true; }, remove: function (c) { delete classes[c]; },
      contains: function (c) { return !!classes[c]; }
    };
    this.firstChild = null; this.enfants = [];
    this.ownerDocument = { createElementNS: function () { return new FauxElement({}); } };
  }
  FauxElement.prototype.getAttribute = function (k) { return this.attrs[k]; };
  FauxElement.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
  FauxElement.prototype.appendChild = function (e) { this.enfants.push(e); this.firstChild = this.enfants[0]; };
  FauxElement.prototype.removeChild = function () { this.enfants.shift(); this.firstChild = this.enfants[0] || null; };
  var elements = [], parId = {};
  var reEl = /<(polyline|text|g|circle)\b([^>]*)>/g, m;
  while ((m = reEl.exec(svg))) {
    var attrs = {}, reA = /([\w-]+)="([^"]*)"/g, a;
    while ((a = reA.exec(m[2]))) attrs[a[1]] = a[2];
    var el = new FauxElement(attrs);
    elements.push(el);
    if (attrs.id) parId[attrs.id] = el;
  }
  var racine = {
    querySelectorAll: function (sel) {
      var attr = sel.indexOf("data-courant") >= 0 ? "data-courant" : "data-signal";
      return elements.filter(function (e) { return e.classes["sch-conducteur"] && e.attrs[attr] !== undefined; });
    },
    querySelector: function (sel) { return parId[sel.slice(1).replace(/\\\./g, ".")] || null; }
  };
  var anime = TPMS.circuitResoudre({ cpuActif: true, ledAlerte: true, buzzer: true, reedFerme: true, ecran: "partiel" },
    TPMS.creerLipo({ etatCharge: 0.5 }));
  TPMS.schemaMettreAJour(racine, anime);
  var filLed = elements.filter(function (e) { return e.attrs["data-courant"] === "LED1" && e.classes["sch-conducteur"]; });
  var filQ2 = elements.filter(function (e) { return e.attrs["data-courant"] === "Q2" && e.classes["sch-conducteur"]; });
  verifier("mise à jour : fils de LED1 animés, fils de l'éclairage éteint immobiles",
    filLed.length > 3 && filLed.every(function (e) { return e.classes["sch-parcouru"] && e.style.props["--duree"]; }) &&
    filQ2.every(function (e) { return !e.classes["sch-parcouru"]; }));
  verifier("mise à jour : Q1 passant, Q2 bloqué, buzzer qui sonne, reed fermé",
    parId["comp-Q1"].classes["sch-passant"] && !parId["comp-Q2"].classes["sch-passant"] &&
    parId["comp-BZ1"].classes["sch-sonne"] && parId["comp-S1"].classes["sch-ferme"]);
  verifier("mise à jour : valeurs écrites (val-LED1, tension-V3V3)",
    /mA$/.test(parId["val-LED1"].textContent) && parId["tension-V3V3"].textContent === "3,30 V",
    parId["val-LED1"].textContent + " / " + parId["tension-V3V3"].textContent);
  verifier("mise à jour : aucune alerte affichée en fonctionnement normal", parId["alertes"].enfants.length === 0);
  TPMS.schemaMettreAJour(racine, TPMS.circuitResoudre({ veille: true, reedFerme: true }, TPMS.creerLipo({ etatCharge: 0.5 })));
  verifier("mise à jour : alerte « aimant arrêté devant le reed » en veille",
    parId["alertes"].enfants.length === 1 && parId["alertes"].enfants[0].textContent.indexOf("Aimant arrêté") >= 0);
})();

// ---------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------
resultats.lignes.push("");
resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
if (typeof document !== "undefined" && document.getElementById("resultats")) {
  document.getElementById("resultats").textContent = resultats.lignes.join("\n");
} else {
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
}
