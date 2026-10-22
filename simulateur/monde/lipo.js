// =====================================================================
// lipo.js — Batterie LiPo 500 mAh du boîtier et son chargeur
// ---------------------------------------------------------------------
// MONDE SIMULÉ (logique pure, pas de DOM). Le moteur appelle :
//   e = TPMS.circuitResoudre(entrees, lipo)        → courant demandé
//   TPMS.lipoAvancer(lipo, dtS, e.courantBatterieA, temperatureC)
//
// Modèle de la cellule (modèle « de Thévenin » du premier ordre, le
// plus utilisé pour simuler une batterie) :
//
//        R0          R1
//   ┌──/\/\/──┬────/\/\/───┐
//   │         └─────||─────┤        tension aux bornes :
//  (OCV)            C1     ├── +    U = OCV − R0·I − Up
//   │                      │
//   └──────────────────────┴── −    Up : tension de « polarisation »
//                                    (diffusion des ions), qui suit
//   OCV : tension à vide, fonction    R1·I avec un retard τ = R1·C1.
//   de l'état de charge.
//
// Convention de signe : courant > 0 = DÉCHARGE, courant < 0 = CHARGE.
//
// Ce qui est modélisé :
//   - courbe de tension à vide réaliste (4,2 V plein, plateau 3,7-3,8 V,
//     chute rapide sous 3,5 V) ;
//   - résistance interne et polarisation (la tension remonte un peu
//     quand on arrête de tirer du courant, comme en vrai) ;
//   - effet du froid : résistance plus grande et une partie de la charge
//     devient inaccessible (elle revient quand la batterie se réchauffe) ;
//   - autodécharge et courant du circuit de protection ;
//   - protection intégrée (circuit « PCM » soudé sur la cellule) :
//     coupure en surdécharge et en surcharge ;
//   - chargeur BQ25101 du XIAO : précharge, courant constant (CC),
//     tension constante (CV), fin de charge, recharge automatique.
//
// Sources des valeurs (toutes à vérifier sur le vrai matériel) :
//   - courbe OCV : courbes publiées pour les cellules LiCoO2 / polymère
//     à 25 °C et faible courant (fiches de cellules 503035 génériques,
//     tableaux Adafruit / Battery University) ; HYPOTHÈSE à ±30 mV ;
//   - résistance interne : 503035 500 mAh neuve, 0,1 à 0,2 Ω protection
//     comprise (les deux MOSFET du PCM ≈ 50 mΩ) ; HYPOTHÈSE 0,18 Ω ;
//   - protection : circuit DW01A + double MOSFET FS8205A, le plus courant
//     sur ces cellules (fiche DW01A : courant de fonctionnement ≈ 3 µA,
//     surcharge 4,25 V, retour 4,05-4,10 V). Le seuil de surdécharge du
//     DW01A est 2,4 V, mais beaucoup de cellules vendues pour l'IoT
//     coupent entre 2,5 et 3,0 V ; on retient 3,0 V (cas prudent,
//     HYPOTHÈSE, réglable dans TPMS.LIPO.seuilSurdechargeV) ;
//   - chargeur : fiche TI BQ25101 (VREG = 4,20 V, fin de charge à 10 %
//     du courant de charge, précharge à 20 % sous ≈ 3,0 V, recharge
//     automatique sous ≈ VREG − 0,1 V) et wiki Seeed du XIAO nRF52840
//     (courant de charge 50 ou 100 mA selon la broche P0.13).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Tout est dans une fonction : les fonctions internes ne deviennent pas
// des variables globales de la page (pas de conflit avec les autres fichiers).
(function () {
"use strict";

TPMS.LIPO = {
  // Tension à vide (V) selon l'état de charge (0 = vide, 1 = plein), à 25 °C.
  // Le « 0 % » est pris à 3,0 V, seuil de coupure retenu.
  courbeOcv: [
    [0.00, 3.00], [0.02, 3.30], [0.05, 3.55], [0.10, 3.67], [0.15, 3.71],
    [0.20, 3.73], [0.30, 3.77], [0.40, 3.80], [0.50, 3.84], [0.60, 3.87],
    [0.70, 3.94], [0.80, 4.01], [0.90, 4.09], [1.00, 4.20]
  ],
  // Part de la charge accessible selon la température (HYPOTHÈSE, allure
  // des courbes « capacité / température » des fiches de cellules LiPo).
  capaciteSelonTemperature: [
    [-20, 0.60], [-10, 0.75], [0, 0.88], [10, 0.95], [20, 1.00], [60, 1.00]
  ],
  resistanceInterneOhm: 0.18,      // R0 à 25 °C, protection comprise
  resistancePolarisationOhm: 0.08, // R1 à 25 °C
  constantePolarisationS: 30,      // τ = R1·C1 (quelques dizaines de secondes)
  seuilSurdechargeV: 3.0,          // coupure (voir en-tête)
  seuilSurchargeV: 4.25,           // coupure de la charge (DW01A)
  retourSurchargeV: 4.10,          // la charge est de nouveau permise sous ce seuil
  autodechargeParMois: 0.03,       // 3 %/mois à 25 °C, doublée tous les +10 °C
  courantProtectionA: 3e-6,        // DW01A en fonctionnement (≈ 3 µA)
  courantProtectionCoupeeA: 0.1e-6,// DW01A en « power-down » après une surdécharge
  rendementCoulomb: 0.995          // 0,5 % de la charge reçue est perdue
};

TPMS.CHARGEUR = {
  courantChargeA: 0.100,           // XIAO : P0.13 à 0 → 100 mA (sinon 50 mA)
  tensionRegulationV: 4.20,        // VREG du BQ25101
  fractionFinCharge: 0.10,         // fin de charge quand le courant < 10 % de ICHG
  seuilPrechargeV: 3.0,            // sous ce seuil : précharge
  fractionPrecharge: 0.20,         // précharge à 20 % de ICHG
  seuilRechargeV: 4.10,            // recharge automatique sous ≈ VREG − 0,1 V
  entreeMiniV: 3.5,                // HYPOTHÈSE : seuil de sous-tension d'entrée
  margeEntreeV: 0.10,              // il faut VIN > VBAT + marge (mode sommeil sinon)
  surtensionEntreeV: 6.5           // HYPOTHÈSE : protection de surtension d'entrée
};

// Interpolation linéaire dans un tableau [[x, y], ...] trié par x croissant.
TPMS.interpoler = function (table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (var i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      var a = table[i - 1], b = table[i];
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return table[table.length - 1][1];
};

function temperatureParDefaut(t) { return (t === undefined || t === null || isNaN(t)) ? 25 : t; }

// Part de la charge accessible à cette température (1 au-dessus de 20 °C).
TPMS.lipoFacteurFroid = function (temperatureC) {
  return TPMS.interpoler(TPMS.LIPO.capaciteSelonTemperature, temperatureParDefaut(temperatureC));
};

// Tension à vide (V). Le froid rend inaccessible le bas de la batterie :
// on « décale » l'état de charge vu par la courbe. Exemple à 0 °C
// (88 % accessible) : avec 12 % de charge réelle, la cellule est déjà à
// 3,0 V. Le modèle est simplifié mais donne le comportement observé :
// une batterie « vide » par grand froid se « recharge » en se réchauffant.
TPMS.lipoTensionVideV = function (etatCharge, temperatureC) {
  var f = TPMS.lipoFacteurFroid(temperatureC);
  var socVu = 1 - (1 - etatCharge) / f;
  if (socVu >= 0) return TPMS.interpoler(TPMS.LIPO.courbeOcv, socVu);
  // En dessous de 3,0 V la tension s'effondre (pente raide, borne à 2,5 V).
  return Math.max(2.5, 3.0 + 4 * socVu);
};

// Résistance interne R0 selon la température : elle double environ tous
// les 20 °C de froid (HYPOTHÈSE, ordre de grandeur des fiches LiPo).
TPMS.lipoResistanceOhm = function (l, temperatureC) {
  var t = temperatureParDefaut(temperatureC !== undefined ? temperatureC : l.temperatureC);
  var k = t < 25 ? Math.pow(2, (25 - t) / 20) : Math.max(0.8, 1 - 0.01 * (t - 25));
  return l.resistanceInterneOhm * k;
};

function resistancePolarisation(l, t) {
  return l.resistancePolarisationOhm * TPMS.lipoResistanceOhm(l, t) / l.resistanceInterneOhm;
}

// Crée une batterie. La graine tire la dispersion de fabrication
// (capacité réelle ±3 %, résistance ±10 %) : deux cellules du même lot
// ne sont jamais identiques.
TPMS.creerLipo = function (o) {
  o = o || {};
  var p = TPMS.LIPO;
  var dispCap = 1, dispR = 1;
  if (o.graine !== undefined && TPMS.creerAleaNomme) {
    var alea = TPMS.creerAleaNomme(o.graine, "lipo");
    dispCap = 1 + 0.03 * TPMS.aleaNormal(alea);
    dispR = 1 + 0.10 * TPMS.aleaNormal(alea);
  }
  var l = {
    capaciteNominaleMAh: o.capaciteMAh || 500,
    capaciteMAh: (o.capaciteMAh || 500) * dispCap,          // capacité réelle de CETTE cellule
    etatCharge: o.etatCharge !== undefined ? o.etatCharge : 1.0,
    resistanceInterneOhm: (o.resistanceInterneOhm || p.resistanceInterneOhm) * dispR,
    resistancePolarisationOhm: p.resistancePolarisationOhm * dispR,
    temperatureC: temperatureParDefaut(o.temperatureC),
    tensionPolarisationV: 0,
    courantA: 0,
    coupee: false,
    raisonCoupure: null,             // "surdecharge" ou "surcharge"
    chargeur: { phase: "absent", courantA: 0 },
    dechargeMAh: 0,                  // compteurs (statistiques)
    chargeMAh: 0,
    tempsS: 0
  };
  l.tensionVideV = TPMS.lipoTensionVideV(l.etatCharge, l.temperatureC);
  l.tensionCelluleV = l.tensionVideV;
  l.tensionV = l.tensionVideV;
  return l;
};

// Tension de la cellule (avant la protection) si elle débite courantA,
// sans faire avancer le temps. Sert au circuit pour trouver le point
// de fonctionnement.
TPMS.lipoTensionSousCourantV = function (l, courantA) {
  var ocv = TPMS.lipoTensionVideV(l.etatCharge, l.temperatureC);
  return ocv - courantA * TPMS.lipoResistanceOhm(l) - l.tensionPolarisationV;
};

// Fait avancer la batterie de dtS secondes avec un courant constant.
TPMS.lipoAvancer = function (l, dtS, courantA, temperatureC) {
  var p = TPMS.LIPO;
  if (temperatureC !== undefined && temperatureC !== null && !isNaN(temperatureC)) l.temperatureC = temperatureC;
  var I = courantA || 0;

  // 1. La protection décide si le courant peut passer.
  if (l.coupee && l.raisonCoupure === "surdecharge") {
    // Le DW01A ne se réarme que si un chargeur est branché.
    if (I < 0) { l.coupee = false; l.raisonCoupure = null; } else I = 0;
  }
  if (l.coupee && l.raisonCoupure === "surcharge" && I < 0) I = 0;   // la charge est bloquée

  // 2. Bilan de charge (comptage de coulombs).
  var capaciteAs = l.capaciteMAh * 3.6;                 // 1 mAh = 3,6 A·s
  var dq = I > 0 ? I * dtS : I * dtS * p.rendementCoulomb;
  var iProtection = (l.coupee && l.raisonCoupure === "surdecharge") ? p.courantProtectionCoupeeA : p.courantProtectionA;
  var tauxAuto = p.autodechargeParMois / (30 * 86400) * Math.pow(2, (l.temperatureC - 25) / 10);
  l.etatCharge -= (dq + iProtection * dtS) / capaciteAs + tauxAuto * l.etatCharge * dtS;
  if (l.etatCharge < 0) l.etatCharge = 0;
  if (l.etatCharge > 1) l.etatCharge = 1;
  if (I > 0) l.dechargeMAh += I * dtS / 3.6; else l.chargeMAh += -I * dtS / 3.6;
  l.tempsS += dtS;

  // 3. Polarisation : Up tend vers R1·I avec la constante de temps τ.
  //    Solution exacte sur le pas de temps, stable même pour un grand dtS.
  var cible = I * resistancePolarisation(l, l.temperatureC);
  l.tensionPolarisationV = cible + (l.tensionPolarisationV - cible) * Math.exp(-dtS / p.constantePolarisationS);

  // 4. Tensions.
  l.courantA = I;
  l.tensionVideV = TPMS.lipoTensionVideV(l.etatCharge, l.temperatureC);
  l.tensionCelluleV = l.tensionVideV - I * TPMS.lipoResistanceOhm(l) - l.tensionPolarisationV;

  // 5. Surveillance par la protection.
  if (!l.coupee && I >= 0 && l.tensionCelluleV <= p.seuilSurdechargeV) {
    l.coupee = true; l.raisonCoupure = "surdecharge";
  } else if (!l.coupee && l.tensionCelluleV >= p.seuilSurchargeV) {
    l.coupee = true; l.raisonCoupure = "surcharge";
  } else if (l.coupee && l.raisonCoupure === "surcharge" && l.tensionCelluleV < p.retourSurchargeV) {
    l.coupee = false; l.raisonCoupure = null;
  }

  // Tension vue par le XIAO : 0 quand les MOSFET de la protection sont
  // ouverts côté surdécharge (plus rien ne relie la cellule au circuit).
  l.tensionV = (l.coupee && l.raisonCoupure === "surdecharge") ? 0 : l.tensionCelluleV;
  return l;
};

// ---------------------------------------------------------------------
// Chargeur BQ25101 (sur la carte XIAO)
// ---------------------------------------------------------------------
// Calcul SANS modifier la batterie. courantSystemeA = courant pris sur le
// nœud VBAT par le reste du montage (LED blanches, pont de mesure...) :
// le chargeur alimente aussi ces charges, puisqu'il n'a pas de « power
// path » (sa sortie est reliée directement à la batterie).
// Retourne { courantA : courant total fourni par le chargeur,
//            courantBatterieA : part qui entre dans la batterie,
//            phase : "absent" | "sommeil" | "surtension" | "precharge" | "cc" | "cv" | "termine" | "protection" }
TPMS.chargeurCalculer = function (l, vbusV, courantSystemeA, options) {
  var c = TPMS.CHARGEUR;
  var o = options || {};
  var icc = o.courantChargeA || c.courantChargeA;
  var isys = Math.max(0, courantSystemeA || 0);
  var ocv = TPMS.lipoTensionVideV(l.etatCharge, l.temperatureC);
  var vbat = l.tensionCelluleV !== undefined ? l.tensionCelluleV : ocv;
  function res(i, phase, ibat) { return { courantA: i, courantBatterieA: ibat !== undefined ? ibat : 0, phase: phase }; }

  if (!vbusV || vbusV < c.entreeMiniV) return res(0, "absent");
  if (vbusV > c.surtensionEntreeV) return res(0, "surtension");
  if (vbusV < vbat + c.margeEntreeV) return res(0, "sommeil");
  if (l.coupee && l.raisonCoupure === "surcharge") return res(0, "protection");

  var dejaTermine = l.chargeur && l.chargeur.phase === "termine";
  if (dejaTermine && ocv > c.seuilRechargeV) {
    // Charge finie : le chargeur ne débite plus, le système vit sur la batterie.
    return res(0, "termine");
  }
  var ibat, phase;
  if (ocv < c.seuilPrechargeV) {
    ibat = c.fractionPrecharge * icc; phase = "precharge";
    return res(ibat + isys > icc ? icc : ibat + isys, phase, Math.min(ibat, icc - isys));
  }
  // Courant qui amènerait la cellule exactement à VREG (régime établi,
  // polarisation comprise) : c'est ce que fait la boucle de tension.
  var rTotal = TPMS.lipoResistanceOhm(l) + resistancePolarisation(l, l.temperatureC);
  var icv = (c.tensionRegulationV - ocv) / rTotal;
  if (icv + isys >= icc) {
    // Courant constant : le chargeur régule SON courant de sortie à ICHG.
    return res(icc, "cc", icc - isys);
  }
  ibat = Math.max(0, icv);
  var sortie = ibat + isys;
  // Fin de charge : courant de sortie sous 10 % de ICHG en phase CV.
  if (sortie < c.fractionFinCharge * icc) return res(0, "termine");
  return res(sortie, "cv", ibat);
};

// Version qui mémorise la phase dans la batterie (fin de charge, recharge).
// Retourne le courant (A, positif) fourni par le chargeur.
TPMS.chargeurCourantA = function (l, vbusV, courantSystemeA, options) {
  var r = TPMS.chargeurCalculer(l, vbusV, courantSystemeA, options);
  l.chargeur = { phase: r.phase, courantA: r.courantA };
  return r.courantA;
};
})();
