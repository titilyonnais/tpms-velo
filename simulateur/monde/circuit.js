// =====================================================================
// circuit.js — Résolution du circuit électrique du boîtier
// ---------------------------------------------------------------------
// MONDE SIMULÉ (logique pure, pas de DOM).
//
//   TPMS.circuitResoudre(entrees, lipo [, composants])
//     entrees = { veille, cpuActif, cpuCalcul, radioReception, radioEmission,
//                 ecran: "repos" | "partiel" | "complet",
//                 ledAlerte, eclairage, buzzer,
//                 reedFerme, reedPullupActif, optionReedExterne,
//                 bouton1, bouton2, vbusV, appConnectee, coupureCharge }
//     → { tensions: { VBAT, V5EXT, V5D, VBUS, V3V3, GND, D0…D10, NFC1, NFC2,
//                     G1, G2, G3, EN4, DQ1, DQ2, LED1A, LED2A, LED3A, J2 },
//         courants: { U1, U2, U3, U4, R1…R12, C1…C3, D1, D2, LED1…LED3,
//                     Q1, Q2, Q3, BZ1, BT1, SW1, SW2, S1, J1, J2, "U1.BAT", "U1.3V3",
//                     "U1.5V", "U1.regulateur", "U1.pont", "U1.chargeur",
//                     "U1.ledCharge" },
//         etats: { ... }, courantBatterieA, courantChargeA, chargeurPhase,
//         puissanceW, alertes: [textes] }
//
// Les noms (U1, R1, +VBAT…) sont ceux du schéma (simulateur/vues/schema.js
// et docs/schema-electrique.md). Une tension à null = nœud « en l'air »
// (broche non reliée) : sa tension n'est pas définie.
//
// Méthode : on cherche le POINT DE FONCTIONNEMENT. Le courant tiré sur la
// batterie fait baisser sa tension (résistance interne), et cette tension
// change le courant des LED blanches et la sortie du régulateur. On
// recalcule donc plusieurs fois (« point fixe ») jusqu'à ce que plus rien
// ne bouge. Les composants non linéaires (LED, diodes) sont résolus par
// DICHOTOMIE : on encadre la solution et on coupe l'intervalle en deux.
//
// Les courants sont des MOYENNES sur quelques millisecondes : la radio
// émet par salves d'environ 1 ms, ce qui donne quelques centaines de µA
// en moyenne, comme dans logique/energie.js.
//
// Sources des valeurs (HYPOTHÈSES tant que rien n'est mesuré) :
//   nRF52840 : fiche produit Nordic v1.x, § « Current consumption » :
//     System OFF ≈ 0,4 µA, RX 1 Mbit/s avec DC/DC ≈ 4,6 mA, TX 0 dBm
//     ≈ 4,8 mA, CPU 64 MHz ≈ 3,3 mA ; alimentation 1,7 à 3,6 V ;
//     sortie « high drive » : VOH ≥ VDD − 0,4 V à 5 mA ; résistance de
//     tirage interne 11 à 16 kΩ (13 kΩ typique).
//   Régulateur 3,3 V du XIAO : LDO (référence à lire sur le schéma
//     Seeed) ; modèle générique : courant de repos ≈ 1 µA, tension de
//     déchet ≈ 0,15 V à 100 mA. Quand VBAT < 3,3 V, 3V3 suit VBAT.
//   Chargeur BQ25101 : voir lipo.js.
//   E-paper WeAct 1,54″ (SSD1681, dalle GDEY0154D67) : sommeil profond
//     < 1 µA, ≈ 3 mA pendant un rafraîchissement, VCI 2,2 à 3,7 V.
//   AO3400A (Alpha & Omega) : VGS(th) 0,65 à 1,45 V (1,05 typique),
//     RDS(on) < 32 mΩ à VGS = 4,5 V, < 48 mΩ à 2,5 V.
//   LED 3 mm : rouge ≈ 2,0 V à 20 mA, blanche ≈ 3,0 à 3,2 V à 20 mA.
//   Buzzer actif 3 V (électromagnétique, oscillateur intégré) : ≤ 30 mA
//     sous 3 V ; on retient ≈ 25 mA sous 3,3 V (energie.js).
//   SS14 (Schottky 1 A, 40 V) : VF ≤ 0,5 V à 1 A ; ≈ 0,3 V à 100 mA.
//   1N4148 : diode rapide (trr 4 ns), 300 mA en continu.
//   BMP280 (Bosch, baromètre, U3) : sommeil 0,1 µA ; une mesure « basse
//     consommation » toutes les 10 s ≈ 0,3 µA en moyenne (2,74 µA à 1 Hz).
//   TPS22918 (TI, interrupteur de recharge, U4) : RON ≈ 52 mΩ, courant
//     de repos ≈ 8 µA passant, 0,5 µA bloqué, pris sur le 5 V du chargeur.
//   2N7002 (Q3) : VGS(th) 1 à 2,5 V ; commandé en 3,3 V, il est passant.
//   Pont de mesure de la batterie du XIAO : 1 MΩ + 510 kΩ (config.h).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

(function () {
"use strict";

TPMS.CIRCUIT = {
  resistances: { R1: 270, R2: 100, R3: 100, R4: 100e3, R5: 100e3, R6: 150, R7: 150, R8: 1000, R9: 1e6,
                 R10: 100e3, R11: 1e6, R12: 2200 },
  pullupInterneOhm: 13000,         // nRF52840, 11 à 16 kΩ
  sortieForteOhm: 30,              // résistance équivalente d'une sortie « high drive »
  sortieStandardOhm: 300,          // sortie normale (≈ 0,5 mA pour 0,4 V de chute... ordre de grandeur)
  // Modèle de LED : VF(I) = n·Vt·ln(1 + I/Is) + Rs·I, calé sur un point (VF à IRef).
  leds: {
    LED1: { vfRefV: 1.85, iRefA: 0.005, n: 2.0, rsOhm: 8 },    // rouge 3 mm
    LED2: { vfRefV: 2.95, iRefA: 0.005, n: 3.5, rsOhm: 12 },   // blanche 3 mm
    LED3: { vfRefV: 2.95, iRefA: 0.005, n: 3.5, rsOhm: 12 }
  },
  // MOSFET : RDS(on) = rInf + k / (VGS − VTH) ; saturation à g·(VGS − VTH)².
  mosfet: { vthV: 1.05, rInfOhm: 0.018, kOhmV: 0.03, fuiteA: 1e-8, gAV2: 8 },
  buzzer: { resistanceOhm: 132, tensionMiniV: 2.0 },
  schottky: { isA: 1e-6, n: 1.05, rsOhm: 0.08 },           // D2 = SS14
  diodeVbusV: 0.3,                 // HYPOTHÈSE : diode de la carte entre VBUS et le régulateur
  regulateur: { sortieV: 3.3, chuteMiniV: 0.01, resistanceChuteOhm: 1.5, courantReposA: 1e-6 },
  pont: { hautOhm: 1e6, basOhm: 510e3 },
  // nRF52840 : courants calés pour retrouver logique/energie.js
  // (veille 5 µA et repos 20 µA en comptant l'e-paper, le régulateur et le pont).
  nrf: {
    offA: 0.6e-6,                  // System OFF + détection de broche (réveil par le reed)
    reposA: 15.7e-6,               // System ON, boucle toutes les 10 ms, CPU en attente (WFE)
    receptionA: 5.0e-3,            // RX 4,6 mA + traitement des annonces 0,4 mA
    calculA: 3.3e-3,               // CPU à 100 % (entrees.cpuCalcul)
    liaisonMoyenneA: 0.25e-3,      // téléphone connecté, intervalle 100 ms (moyenne)
    annoncesMoyenneA: 0.015e-3,    // annonces vers le téléphone, non connecté (10-20 µA)
    emissionCreteA: 5.2e-3,        // TX 0 dBm 4,8 mA + CPU : courant pendant une salve
    tensionMiniV: 1.7              // en dessous : remise à zéro (POR / brownout)
  },
  epaper: { veilleA: 0.8e-6, rafraichissementA: 3e-3, tensionMiniV: 2.2 },
  ledChargeA: 1e-3,                // HYPOTHÈSE : LED de charge de la carte, alimentée par VBUS
  barometre: { sommeilA: 0.1e-6, moyenneA: 0.4e-6 },   // U3 BMP280 (sommeil + 1 mesure / 10 s)
  interrupteur: { ronOhm: 0.052, reposPassantA: 8e-6, reposBloqueA: 0.5e-6 },   // U4 TPS22918
  vtV: 0.02569                     // tension thermique kT/q à 25 °C
};

var P;   // jeu de composants utilisé pendant un calcul

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------

// Dichotomie : trouve x dans [a, b] tel que f(x) = 0, si f(a) et f(b)
// sont de signes opposés. 44 itérations : précision ≈ (b − a) / 10^13.
function dichotomie(f, a, b) {
  var fa = f(a);
  for (var i = 0; i < 44; i++) {
    var m = (a + b) / 2, fm = f(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

// Tension aux bornes d'une diode (LED ou Schottky) traversée par I.
function tensionDiode(d, I) {
  if (I <= 0) return 0;
  var nvt = d.n * P.vtV;
  if (d.isA === undefined) {
    // Courant de saturation Is déduit du point de référence (VF à IRef).
    d.isA = d.iRefA / (Math.exp((d.vfRefV - d.rsOhm * d.iRefA) / nvt) - 1);
  }
  return nvt * Math.log(1 + I / d.isA) + d.rsOhm * I;
}

// Courant dans « résistance R + diode » sous la tension U : on cherche I
// tel que R·I + VF(I) = U. Méthode de Newton (rapide), gardée dans un
// encadrement [bas, haut] : si un pas de Newton en sort, on prend le
// milieu (dichotomie). Converge en 5 à 10 pas au lieu de 44.
function courantBrancheDiode(d, R, U) {
  if (U <= 0) return 0;
  var bas = 0, haut = U / R, I = haut / 2;
  tensionDiode(d, 1e-3);                       // calcule Is si besoin
  var nvt = d.n * P.vtV;
  for (var k = 0; k < 40; k++) {
    var f = I * R + tensionDiode(d, I) - U;
    if (f > 0) haut = I; else bas = I;
    var derivee = R + d.rsOhm + nvt / (d.isA + I);
    var suivant = I - f / derivee;
    if (!(suivant > bas && suivant < haut)) suivant = (bas + haut) / 2;
    if (Math.abs(suivant - I) < 1e-13) return suivant;
    I = suivant;
  }
  return I;
}

// État du MOSFET selon VGS : bloqué, ou passant avec RDS(on) et courant max.
function mosfet(vgs) {
  var m = P.mosfet;
  if (vgs <= m.vthV) return { passant: false, rdsOhm: Infinity, isatA: 0 };
  var ex = vgs - m.vthV;
  return { passant: true, rdsOhm: m.rInfOhm + m.kOhmV / ex, isatA: m.gAV2 * ex * ex };
}

// Courant de drain pour une tension drain-source donnée.
function courantDrain(q, vds) {
  if (vds <= 0) return 0;
  if (!q.passant) return P.mosfet.fuiteA * Math.min(1, vds / 0.1);
  return Math.min(vds / q.rdsOhm, q.isatA);
}

// Copie d'un jeu de composants avec la dispersion de fabrication :
// résistances ±1 % (série E96) ou ±5 % (100 kΩ), VF des LED ±50 mV,
// VTH du MOSFET ±0,15 V, pull-up interne 11-16 kΩ. Même graine = mêmes composants.
TPMS.circuitTirerComposants = function (graine) {
  var c = JSON.parse(JSON.stringify(TPMS.CIRCUIT));
  if (!TPMS.creerAleaNomme) return c;
  var a = TPMS.creerAleaNomme(graine >>> 0, "composants");
  function disp(v, rel) { return v * (1 + rel * TPMS.aleaNormal(a) / 2); }   // ±rel ≈ 2 écarts-types
  Object.keys(c.resistances).forEach(function (k) {
    c.resistances[k] = disp(c.resistances[k], c.resistances[k] >= 100e3 ? 0.05 : 0.01);
  });
  Object.keys(c.leds).forEach(function (k) { c.leds[k].vfRefV += 0.025 * TPMS.aleaNormal(a); });
  c.mosfet.vthV += 0.075 * TPMS.aleaNormal(a);
  c.pullupInterneOhm = Math.min(16000, Math.max(11000, disp(13000, 0.15)));
  return c;
};

// ---------------------------------------------------------------------
// Charges du montage pour une tension 3V3 et une tension VBAT données
// ---------------------------------------------------------------------
function charges(e, v3, vbat) {
  var R = P.resistances;
  var c = {}, t = {}, s = {};
  var nrfOk = v3 >= P.nrf.tensionMiniV;
  var eveille = nrfOk && !e.veille;
  s.nrfAlimente = nrfOk;
  s.epaperOk = v3 >= P.epaper.tensionMiniV;

  // nRF52840 (U1)
  var iNrf = 0;
  if (nrfOk) {
    if (e.veille) iNrf = P.nrf.offA;
    else {
      iNrf = P.nrf.reposA;
      if (e.radioReception) iNrf += P.nrf.receptionA;
      if (e.appConnectee) iNrf += P.nrf.liaisonMoyenneA;
      else if (e.radioEmission) iNrf += P.nrf.annoncesMoyenneA;
      if (e.cpuCalcul) iNrf += P.nrf.calculA;
    }
  }
  c.U1 = iNrf;

  // E-paper (U2) : alimenté en permanence par 3V3.
  var ecranActif = eveille && (e.ecran === "partiel" || e.ecran === "complet");
  c.U2 = v3 > 0.5 ? (ecranActif ? P.epaper.rafraichissementA : P.epaper.veilleA) : 0;
  s.spiActif = ecranActif;
  s.ecranRafraichit = ecranActif;

  // Broches de l'écran et du baromètre (bus SPI partagé). Le fil BUSY de
  // l'écran est supprimé : D0 sélectionne le baromètre (CS du BMP280).
  t.D0 = eveille ? v3 : 0;                     // CS du baromètre, inactif à 1
  t.D1 = eveille ? v3 : 0;                     // RST de l'écran, inactif à 1
  t.D2 = ecranActif ? v3 : 0;                  // DC : données
  t.D3 = eveille ? v3 : 0;                     // CS de l'écran, inactif à 1
  t.D8 = 0; t.D10 = 0;                         // SCK et MOSI au repos
  t.D9 = null;                                 // MISO = SDO du BMP280 : en l'air hors lecture
  // Baromètre U3 (alimenté par 3V3, en sommeil entre deux mesures)
  c.U3 = v3 > 1.7 ? (eveille ? P.barometre.moyenneA : P.barometre.sommeilA) : 0;

  // Coupure de la recharge : D6 → grille de Q3 (R11 vers GND). Q3 passant
  // tire EN de U4 à la masse : l'interrupteur U4 coupe le 5 V du chargeur.
  var d6 = eveille && !!e.coupureCharge;
  t.D6 = d6 ? v3 : 0;
  t.G3 = t.D6;
  c.R11 = t.G3 / R.R11;
  s.q3Passant = t.G3 > 2.5;                    // 2N7002 : VGS(th) ≤ 2,5 V

  // LED d'alerte : D7 (sortie forte) → R1 → LED1 → GND
  var d7 = nrfOk && e.ledAlerte;
  var iLed1 = d7 ? courantBrancheDiode(P.leds.LED1, R.R1 + P.sortieForteOhm, v3) : 0;
  c.LED1 = c.R1 = iLed1;
  t.D7 = d7 ? v3 - iLed1 * P.sortieForteOhm : 0;
  t.LED1A = d7 ? t.D7 - iLed1 * R.R1 : 0;
  s.ledAlerteAllumee = iLed1 > 0.5e-3;

  // Buzzer : NFC1 → R2 → grille Q1 (R4 vers GND) ; +3V3 → BZ1 → Q1 → GND
  var nfc1 = nrfOk && e.buzzer;
  var iG1 = nfc1 ? v3 / (P.sortieStandardOhm + R.R2 + R.R4) : 0;
  t.NFC1 = nfc1 ? v3 - iG1 * P.sortieStandardOhm : 0;
  t.G1 = iG1 * R.R4;
  c.R2 = c.R4 = iG1;
  var q1 = mosfet(t.G1);
  var iBz = q1.passant ? Math.min(v3 / (P.buzzer.resistanceOhm + q1.rdsOhm), q1.isatA)
                       : courantDrain(q1, v3);
  c.BZ1 = c.Q1 = iBz;
  t.DQ1 = v3 - iBz * P.buzzer.resistanceOhm;
  s.q1Passant = q1.passant;
  s.buzzerSonne = q1.passant && (v3 - t.DQ1) >= P.buzzer.tensionMiniV;
  c.D1 = 0;                        // bloquée en régime établi (ne conduit qu'à la coupure)
  c.C2 = 0;

  // Éclairage : NFC2 → R3 → grille Q2 (R5) ; +VBAT → R6/R7 → LED2/LED3 → Q2 → GND
  var nfc2 = nrfOk && e.eclairage;
  var iG2 = nfc2 ? v3 / (P.sortieStandardOhm + R.R3 + R.R5) : 0;
  t.NFC2 = nfc2 ? v3 - iG2 * P.sortieStandardOhm : 0;
  t.G2 = iG2 * R.R5;
  c.R3 = c.R5 = iG2;
  var q2 = mosfet(t.G2);
  var vd = 0;
  if (vbat > 0 && !q2.passant) {
    // MOSFET bloqué : seul un courant de fuite (≈ 10 nA) traverse les LED.
    // Calcul direct (pas besoin de dichotomie) : chaque LED prend la moitié.
    var iFuite = P.mosfet.fuiteA / 2;
    vd = Math.max(0, vbat - iFuite * R.R6 - tensionDiode(P.leds.LED2, iFuite));
  } else if (vbat > 0) {
    // Tension de drain : la somme des courants des 2 LED = courant du MOSFET.
    // MOSFET bien passant : VDS = RDS(on) × (I2 + I3), quelques mV ; on
    // l'obtient en 3 ou 4 tours (point fixe). Sinon (MOSFET saturé, grille
    // trop basse) : dichotomie sur VDS.
    for (var n = 0; n < 6; n++) {
      var iLeds = courantBrancheDiode(P.leds.LED2, R.R6, vbat - vd) + courantBrancheDiode(P.leds.LED3, R.R7, vbat - vd);
      var vdSuivant = iLeds * q2.rdsOhm;
      if (Math.abs(vdSuivant - vd) < 1e-9) { vd = vdSuivant; break; }
      vd = vdSuivant;
    }
    if (iLeds > q2.isatA) vd = dichotomie(function (v) {
      return courantBrancheDiode(P.leds.LED2, R.R6, vbat - v) +
             courantBrancheDiode(P.leds.LED3, R.R7, vbat - v) - courantDrain(q2, v);
    }, 0, vbat);
  }
  if (vbat > 0 && !q2.passant) {
    c.LED2 = c.R6 = c.LED3 = c.R7 = courantDrain(q2, vd) / 2;
  } else {
    c.LED2 = c.R6 = vbat > 0 ? courantBrancheDiode(P.leds.LED2, R.R6, vbat - vd) : 0;
    c.LED3 = c.R7 = vbat > 0 ? courantBrancheDiode(P.leds.LED3, R.R7, vbat - vd) : 0;
  }
  c.Q2 = c.LED2 + c.LED3;
  t.DQ2 = vd;
  t.LED2A = vbat - c.LED2 * R.R6;
  t.LED3A = vbat - c.LED3 * R.R7;
  s.q2Passant = q2.passant;
  s.eclairageAllume = c.Q2 > 1e-3;

  // Reed : D4 (pull-up interne et/ou R9) → R8 → J2 → S1 → GND
  var pullup = e.reedPullupActif !== false;        // actif par défaut
  var gHaut = (pullup ? 1 / P.pullupInterneOhm : 0) + (e.optionReedExterne ? 1 / R.R9 : 0);
  var iReed = 0;
  if (e.reedFerme && gHaut > 0 && v3 > 0) {
    iReed = v3 / (1 / gHaut + R.R8);
    t.D4 = iReed * R.R8;
  } else if (e.reedFerme) {
    t.D4 = 0;                                      // tiré à la masse par le reed
  } else {
    t.D4 = gHaut > 0 ? v3 : null;                  // sans tirage : broche en l'air
  }
  t.J2 = e.reedFerme ? 0 : t.D4;
  c.S1 = c.J2 = c.R8 = iReed;
  c.R9 = e.optionReedExterne ? Math.max(0, (v3 - (t.D4 || 0)) / R.R9) : 0;
  c.C1 = 0;
  s.reedFerme = !!e.reedFerme;

  // Boutons : tous deux sur D5 (pull-up interne, actif aussi en System
  // OFF pour le réveil). SW1 tire D5 à 0 V ; SW2 passe par R12 (2,2 kΩ)
  // et donne ≈ 0,48 V, que le convertisseur analogique distingue (boutons.js).
  c.SW1 = e.bouton1 && v3 > 0 ? v3 / P.pullupInterneOhm : 0;
  c.SW2 = c.R12 = e.bouton2 && !e.bouton1 && v3 > 0 ? v3 / (P.pullupInterneOhm + R.R12) : 0;
  c.D5 = c.SW1 + c.SW2;                           // courant dans le fil de D5 (schéma)
  t.D5 = e.bouton1 ? 0 : (e.bouton2 ? c.SW2 * R.R12 : v3);

  c.C3 = 0;
  // Tout ce que fournit le régulateur 3,3 V
  c["U1.3V3"] = c.U2 + c.U3 + c.BZ1 + c.R9;      // sortie par la broche 3V3
  var i3v3 = iNrf + c["U1.3V3"] + iLed1 + iG1 + iG2 + c.R11 + iReed - c.R9 + c.SW1 + c.SW2;
  // (iReed contient déjà la part qui passe par R9 : on ne la compte qu'une fois)
  return { c: c, t: t, s: s, i3v3: i3v3, iVbatDirect: c.Q2 };
}

// Régulateur 3,3 V : sortie limitée par la tension d'entrée moins la
// tension de déchet, qui augmente avec le courant.
function sortieRegulateur(vin, i) {
  var r = P.regulateur;
  if (vin <= 0) return 0;
  return Math.max(0, Math.min(r.sortieV, vin - r.chuteMiniV - r.resistanceChuteOhm * i));
}

// ---------------------------------------------------------------------
// Résolution complète
// ---------------------------------------------------------------------
TPMS.circuitResoudre = function (entrees, lipo, composants) {
  P = composants || TPMS.CIRCUIT;
  var e = entrees || {};
  var v5 = e.vbusV > 0 ? e.vbusV : 0;
  var batterieCoupee = !!(lipo && lipo.coupee && lipo.raisonCoupure === "surdecharge");
  var temperatureC = lipo ? lipo.temperatureC : 25;

  var ibat = 0, iD2 = 0, i3v3 = 0, chg = { courantA: 0, courantBatterieA: 0, phase: "absent" };
  var r, vbat = 0, vbus = 0, v3 = 0, vin = 0, sourceVbus = false, iVbatSys = 0, iVbusSys = 0, regEntree = 0;
  var iPont = 0, iLedCharge = 0, v5d = 0, coupeU4 = false, iU4 = 0, iR10 = 0;
  for (var it = 0; it < 30; it++) {
    // J1 → diode D2 (SS14) → interrupteur U4 → broche 5V du XIAO.
    v5d = v5 > 0 ? Math.max(0, v5 - tensionDiode(P.schottky, iD2)) : 0;
    vbus = (v5d > 0 && !coupeU4) ? Math.max(0, v5d - P.interrupteur.ronOhm * iVbusSys) : 0;
    // Batterie : la protection relâche dès qu'un chargeur la recharge.
    var reliee = !batterieCoupee || chg.courantA > 0;
    if (!lipo) vbat = e.vbatV || 3.8;
    else vbat = reliee ? Math.max(0, TPMS.lipoTensionSousCourantV(lipo, ibat)) : 0;
    // Entrée du régulateur : la plus haute de VBUS (moins une diode) et VBAT.
    var vinVbus = vbus > 0 ? vbus - P.diodeVbusV : 0;
    sourceVbus = vinVbus > vbat;
    vin = Math.max(vinVbus, vbat);
    // Point fixe interne : 3V3 dépend du courant, qui dépend de 3V3.
    for (var k = 0; k < 8; k++) {
      var v3Avant = v3;
      v3 = sortieRegulateur(vin, i3v3);
      r = charges(e, v3, vbat);
      i3v3 = r.i3v3;
      if (k > 0 && Math.abs(v3 - v3Avant) < 1e-7) break;
    }
    regEntree = i3v3 + (vin > 0 ? P.regulateur.courantReposA : 0);
    iPont = vbat > 0 ? vbat / (P.pont.hautOhm + P.pont.basOhm) : 0;
    iVbatSys = r.iVbatDirect + iPont + (sourceVbus ? 0 : regEntree);
    chg = lipo ? TPMS.chargeurCalculer(lipo, vbus, iVbatSys) : chg;
    var enCharge = chg.phase === "precharge" || chg.phase === "cc" || chg.phase === "cv";
    iLedCharge = enCharge ? P.ledChargeA : 0;
    iVbusSys = (sourceVbus ? regEntree : 0) + chg.courantA + iLedCharge;
    var nouveauIbat = iVbatSys - chg.courantA;
    // U4 : passant tant que R10 tire sa broche EN au 5 V ; bloqué quand Q3
    // (commandé par D6) la tire à la masse. R10 consomme alors 50 µA, pris
    // sur le chargeur et non sur la batterie.
    var coupeAvant = coupeU4;
    coupeU4 = r.s.q3Passant;
    iU4 = v5d > 0 ? (coupeU4 ? P.interrupteur.reposBloqueA : P.interrupteur.reposPassantA) : 0;
    iR10 = (v5d > 0 && coupeU4) ? v5d / P.resistances.R10 : 0;
    var nouveauID2 = v5 > 0 ? iVbusSys + iU4 + iR10 : 0;
    var ecart = Math.abs(nouveauIbat - ibat) + Math.abs(nouveauID2 - iD2) + (coupeAvant !== coupeU4 ? 1 : 0);
    ibat = nouveauIbat;
    iD2 = nouveauID2;
    if (it > 0 && ecart < 1e-10) break;
  }
  if (lipo && !reliee) { ibat = 0; }

  // Le chargeur garde sa phase en mémoire (fin de charge, recharge).
  if (lipo) lipo.chargeur = { phase: chg.phase, courantA: chg.courantA };

  var c = r.c, t = r.t, s = r.s;
  c.BT1 = ibat;
  c.D2 = c.J1 = iD2;
  c.U4 = iU4;
  c.R10 = c.Q3 = iR10;
  c["U1.5V"] = iVbusSys;
  c["U1.BAT"] = (sourceVbus ? 0 : regEntree) + iPont - chg.courantA;
  c["U1.regulateur"] = vin > 0 ? P.regulateur.courantReposA : 0;
  c["U1.pont"] = iPont;
  c["U1.chargeur"] = chg.courantA;
  c["U1.ledCharge"] = iLedCharge;

  t.VBAT = vbat; t.V3V3 = v3; t.VBUS = vbus; t.V5EXT = v5; t.V5D = v5d; t.GND = 0;
  t.EN4 = v5d > 0 && !coupeU4 ? v5d : 0;        // EN de U4 (0 = recharge coupée)
  s.rechargeCoupee = v5d > 0 && coupeU4;

  s.batterieCoupee = batterieCoupee && !(chg.courantA > 0);
  s.sourceRegulateur = vin <= 0 ? "aucune" : (sourceVbus ? "VBUS" : "batterie");
  s.regulateurEnDechet = vin > 0 && v3 < P.regulateur.sortieV - 0.005;
  s.chargeurPhase = chg.phase;
  s.enCharge = chg.phase === "precharge" || chg.phase === "cc" || chg.phase === "cv";
  s.noeudsFlottants = Object.keys(t).filter(function (n) { return t[n] === null; });

  // Alertes, de la plus grave à la moins grave
  var alertes = [];
  function v(x) { return x.toFixed(2).replace(".", ",") + " V"; }
  if (s.batterieCoupee) alertes.push("Batterie coupée par sa protection (surdécharge) : plus de VBAT, boîtier éteint jusqu'à la recharge");
  if (vin > 0 && v3 < P.nrf.tensionMiniV) alertes.push("Brownout : 3V3 = " + v(v3) + " < 1,7 V, le nRF52840 est remis à zéro");
  else if (vin <= 0) alertes.push("Brownout : aucune alimentation, 3V3 = 0 V");
  else if (v3 < P.epaper.tensionMiniV) alertes.push("Brownout de l'e-paper : 3V3 = " + v(v3) + " < 2,2 V, rafraîchissement impossible");
  if (lipo && !s.batterieCoupee && vbat > 0 && vbat < 3.3 && !s.enCharge) alertes.push("Batterie faible : VBAT = " + v(vbat));
  if (s.regulateurEnDechet && v3 >= P.nrf.tensionMiniV) alertes.push("Régulateur en déchet : 3V3 = " + v(v3) + " suit la batterie");
  if (e.eclairage && nrfOkFinal(v3) && c.Q2 < 2e-3) alertes.push("Éclairage faible : " + (c.Q2 * 1000).toFixed(1).replace(".", ",") + " mA, VBAT trop basse pour les LED blanches");
  if (e.buzzer && s.q1Passant && !s.buzzerSonne) alertes.push("Buzzer sous-alimenté : il ne sonne plus");
  if (v5 > TPMS.CHARGEUR.surtensionEntreeV) alertes.push("Surtension sur l'entrée de recharge : le chargeur se protège");
  if (s.enCharge && (temperatureC < 0 || temperatureC > 45)) alertes.push("Recharge hors de 0-45 °C : dangereux pour une LiPo (le BQ25101 du XIAO ne surveille pas la température ; c'est le boîtier qui doit la couper)");
  // En roulant, le reed se ferme une fois par tour : c'est normal. En veille,
  // un reed fermé veut dire que l'aimant s'est arrêté devant (le piège).
  if (e.veille && e.reedFerme && c.S1 > 50e-6) alertes.push("Aimant arrêté devant le reed : " + (c.S1 * 1000).toFixed(2).replace(".", ",") + " mA permanents dans le tirage");

  var puissanceW = (ibat > 0 ? vbat * ibat : 0) + v5 * iD2;
  return {
    tensions: t,
    courants: c,
    etats: s,
    courantBatterieA: ibat,
    courantChargeA: chg.courantA,
    chargeurPhase: chg.phase,
    puissanceW: puissanceW,
    puissances: {
      regulateurW: Math.max(0, vin - v3) * i3v3,        // chaleur dans le LDO
      diodeD2W: (v5 - v5d) * iD2,
      ledsBlanchesW: (vbat - t.DQ2) * c.Q2
    },
    alertes: alertes
  };
};

function nrfOkFinal(v3) { return v3 >= P.nrf.tensionMiniV; }

// Courant moyen consommé sur la batterie pour une situation « type »
// (sert aux tests et au document). lipo facultative.
TPMS.circuitCourantBatterieMa = function (entrees, lipo) {
  return TPMS.circuitResoudre(entrees, lipo).courantBatterieA * 1000;
};
})();
