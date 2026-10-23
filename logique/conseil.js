// =====================================================================
// conseil.js — Pression conseillée selon le cycliste et le pneu
// ---------------------------------------------------------------------
// LOGIQUE PURE, utilisée par le simulateur et l'application.
//
// Principe (Frank Berto, revue Bicycling, fin des années 1980) : un pneu
// bien gonflé s'écrase d'environ 15 % de sa hauteur sous la charge. Le
// pneu porte la charge grâce à l'air : charge ≈ pression × surface de
// contact. Pour garder le même écrasement, la pression doit donc être à
// peu près PROPORTIONNELLE à la charge que porte la roue.
//
// Ce que fait ce fichier :
//   1. une pression de référence selon la largeur du pneu, pour une
//      charge de référence de 50 kg sur la roue (roue arrière d'un
//      cycliste de 75 kg sur un vélo de route de 8,5 kg, 60 % à l'arrière) ;
//   2. une règle de trois avec la vraie charge de chaque roue.
//
// HYPOTHÈSE assumée : la courbe de référence est celle du simulateur
// (6,5 bar pour un pneu de 25 mm, plus bas pour un pneu plus large). C'est
// un ordre de grandeur, pas la recommandation d'un fabricant : il faut
// toujours rester dans la plage écrite sur le flanc du pneu.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.CHARGE_REFERENCE_KG = 50;   // charge de la roue pour la courbe de référence

// Pression de référence (bar) pour 50 kg sur la roue, selon la largeur.
// 25 mm → 6,5 bar ; 38 mm → 3,9 bar ; 57 mm → 2,4 bar.
TPMS.pressionReferenceBar = function (largeurPneuMm) {
  return 6.5 * Math.pow(25 / largeurPneuMm, 1.2);
};

// o = { masseCyclisteKg, masseVeloKg, largeurPneuMm, repartitionAV }
// repartitionAV : part du poids sur la roue avant (0,35 à 0,45).
// Retourne { AV, AR } en bar, arrondis au dixième.
TPMS.pressionConseillee = function (o) {
  var total = o.masseCyclisteKg + o.masseVeloKg;
  var reference = TPMS.pressionReferenceBar(o.largeurPneuMm);
  function pour(chargeKg) {
    var p = reference * chargeKg / TPMS.CHARGE_REFERENCE_KG;
    p = Math.min(Math.max(p, 1.0), 9.0);   // garde-fous : jamais < 1 bar ni > 9 bar
    return Math.round(p * 10) / 10;
  }
  return {
    AV: pour(total * o.repartitionAV),
    AR: pour(total * (1 - o.repartitionAV))
  };
};
