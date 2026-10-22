// =====================================================================
// alea.js — Hasard reproductible pour la simulation du monde
// ---------------------------------------------------------------------
// Math.random() donne un résultat différent à chaque fois : impossible
// de rejouer une sortie à l'identique. On utilise donc un générateur
// pseudo-aléatoire initialisé par une « graine » (mulberry32) : même
// graine = même suite de nombres = même sortie, au bruit près.
//
// Chaque modèle (pneu, radio, cycliste...) reçoit SON générateur, créé
// à partir de la graine de la sortie et d'un nom. Ainsi, ajouter un
// tirage dans la radio ne change pas le bruit du capteur de pression.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Générateur : renvoie une fonction qui donne un nombre dans [0, 1).
TPMS.creerAlea = function (graine) {
  var etat = graine >>> 0;
  return function () {
    etat = (etat + 0x6D2B79F5) >>> 0;
    var t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Générateur dérivé : graine de la sortie + nom du modèle.
TPMS.creerAleaNomme = function (graine, nom) {
  var h = graine >>> 0;
  for (var i = 0; i < nom.length; i++) {
    h = Math.imul(h ^ nom.charCodeAt(i), 2654435761) >>> 0;
  }
  return TPMS.creerAlea(h);
};

// Nombre au hasard selon une loi normale (moyenne 0, écart-type 1),
// méthode de Box-Muller.
TPMS.aleaNormal = function (alea) {
  var u = 1 - alea();   // évite log(0)
  var v = alea();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Nombre au hasard dans [min, max).
TPMS.aleaEntre = function (alea, min, max) {
  return min + (max - min) * alea();
};
