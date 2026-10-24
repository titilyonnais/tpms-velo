// =====================================================================
// boutons.js — Les deux boutons sur une seule broche
// ---------------------------------------------------------------------
// LOGIQUE PURE, traduite en C++ dans le firmware (boutons.cpp).
//
// Pour libérer une broche (la commande de la coupure de recharge), les
// deux boutons partagent la broche D5, lue par le convertisseur
// analogique (entrée AIN3) :
//
//   +3,3 V ── tirage interne 13 kΩ (11 à 16 kΩ) ──┬── D5
//                                                  ├── SW1 ──────────── GND
//                                                  └── SW2 ── R12 2,2 kΩ ── GND
//
//   aucun bouton : D5 = 3,3 V
//   SW1 appuyé   : D5 = 0 V
//   SW2 appuyé   : D5 = 3,3 × 2,2 / (2,2 + 13) ≈ 0,48 V
//                  (0,40 à 0,55 V selon le tirage réel, soit 12 à 17 % de 3,3 V)
//   les deux     : D5 = 0 V → compté comme SW1
//
// Le réveil de veille se fait toujours sur un niveau BAS de D5 : il faut
// que SW2 descende sous 30 % de VDD (seuil logique du nRF52840). Avec
// 2,2 kΩ, il reste ≤ 17 % : marge confortable. Avec 3,3 kΩ, on aurait
// jusqu'à 23 %, trop près du seuil.
//
// Les seuils de décision sont pris au milieu des intervalles possibles,
// en proportion de VDD (la tension de la batterie varie).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.BOUTON_SEUIL_SW1 = 0.06;   // sous 6 % de VDD : SW1 (0 V, résistance du contact comprise)
TPMS.BOUTON_SEUIL_SW2 = 0.45;   // de 6 à 45 % : SW2 ; au-dessus : aucun

// Retourne 0 (aucun), 1 ou 2.
TPMS.boutonDepuisTension = function (tensionV, vddV) {
  var rapport = tensionV / vddV;
  if (rapport < TPMS.BOUTON_SEUIL_SW1) return 1;
  if (rapport < TPMS.BOUTON_SEUIL_SW2) return 2;
  return 0;
};
