// =====================================================================
// barometre.js — Ce que le boîtier tire de son baromètre BMP280
// ---------------------------------------------------------------------
// LOGIQUE PURE, traduite en C++ dans le firmware (barometre.cpp).
//
// Le BMP280 (Bosch) mesure la pression de l'air et la température. Il
// est dans le boîtier, derrière un ÉVENT à membrane ePTFE (l'air passe,
// l'eau non) : sans évent, il mesurerait l'air piégé à la fermeture et
// ne verrait jamais l'altitude (voir boitier-3d/README.md).
//
// Il sert à trois choses :
//   1. corriger l'erreur d'altitude des capteurs de pneu ;
//   2. refuser la recharge de la LiPo par grand froid (ou grosse chaleur) ;
//   3. allonger l'attente de fin de rafraîchissement de l'écran par
//      temps froid (le fil BUSY de l'écran a été supprimé pour libérer
//      la broche du baromètre).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// ---------------------------------------------------------------------
// 1. Correction d'altitude
// ---------------------------------------------------------------------
// Un capteur TPMS mesure la pression ABSOLUE de l'air du pneu et lui
// retire une pression atmosphérique FIXE de 1013,25 hPa (il ne connaît
// pas l'altitude). Un manomètre, lui, retire la VRAIE pression de l'air.
// À 1 500 m (846 hPa), le capteur annonce donc 0,17 bar de moins que le
// manomètre. Le baromètre mesure l'air réel (altitude ET météo comprises) :
//
//   pression du manomètre = pression du capteur + (1013,25 − air) / 1000
//
// Exemple : capteur 2,00 bar, air 846 hPa → 2,00 + 0,167 = 2,17 bar.
TPMS.PRESSION_REF_CAPTEUR_HPA = 1013.25;
TPMS.BARO_MIN_HPA = 300;    // plage de mesure du BMP280 (fiche Bosch) :
TPMS.BARO_MAX_HPA = 1100;   // une valeur hors plage = capteur en panne

// Retourne la correction en bar, 0 si la mesure est absente ou absurde
// (le boîtier se comporte alors comme sans baromètre).
TPMS.correctionAltitudeBar = function (pressionAirHpa) {
  if (pressionAirHpa === null || pressionAirHpa === undefined) return 0;
  if (!(pressionAirHpa >= TPMS.BARO_MIN_HPA && pressionAirHpa <= TPMS.BARO_MAX_HPA)) return 0;
  return (TPMS.PRESSION_REF_CAPTEUR_HPA - pressionAirHpa) / 1000;
};

// Pression « manomètre » à partir de celle du capteur.
// Le capteur n'annonce rien sous 0 (pression absolue inférieure à
// 1013,25 hPa) : une trame à 0 bar veut dire « pneu vide ou presque »,
// on affiche alors 0, sans ajouter la correction.
TPMS.pressionCorrigeeBar = function (pressionCapteurBar, correctionBar) {
  if (pressionCapteurBar <= 0) return 0;
  return Math.max(0, pressionCapteurBar + correctionBar);
};

// ---------------------------------------------------------------------
// 2. Recharge refusée hors de 0-45 °C
// ---------------------------------------------------------------------
// Une LiPo ne se recharge qu'entre 0 et 45 °C (fiches des cellules) : en
// dessous, le lithium se dépose en métal sur l'électrode (« plaquage »),
// la batterie perd de la capacité et peut se mettre en court-circuit
// interne. Le chargeur BQ25101 du XIAO ne surveille pas la température :
// c'est le boîtier qui coupe l'entrée de recharge (interrupteur U4
// TPS22918, commandé par le MOSFET Q3).
// Marges : BMP280 précis à ±1 °C, et la batterie peut être un peu plus
// froide que l'air du boîtier → 2 °C au lieu de 0, 43 °C au lieu de 45.
// Hystérésis de 3 °C : la recharge ne repart qu'à 5 °C (ou sous 40 °C),
// sinon elle s'allumerait et s'éteindrait sans cesse autour du seuil.
TPMS.CHARGE_MIN_C = 2;
TPMS.CHARGE_MAX_C = 43;
TPMS.CHARGE_HYSTERESIS_C = 3;

// blocageAvant : "" (recharge permise), "FROID" ou "CHAUD".
// Retourne le nouvel état. Sans mesure (pas de baromètre), on ne bloque
// rien : c'est le comportement de la carte seule.
TPMS.blocageCharge = function (blocageAvant, temperatureC) {
  if (temperatureC === null || temperatureC === undefined) return "";
  var min = TPMS.CHARGE_MIN_C, max = TPMS.CHARGE_MAX_C, h = TPMS.CHARGE_HYSTERESIS_C;
  if (blocageAvant === "FROID") min += h;   // il faut remonter franchement
  if (blocageAvant === "CHAUD") max -= h;
  if (temperatureC < min) return "FROID";
  if (temperatureC > max) return "CHAUD";
  return "";
};

// ---------------------------------------------------------------------
// 3. Attente de fin de rafraîchissement de l'écran (sans fil BUSY)
// ---------------------------------------------------------------------
// L'écran signalait la fin de son rafraîchissement par sa broche BUSY.
// Elle est libérée pour le baromètre : le programme attend donc une durée
// fixe, choisie plus longue que le vrai rafraîchissement. Par temps
// froid, le contrôleur SSD1681 choisit des formes d'onde plus lentes :
// on allonge l'attente.
// HYPOTHÈSES à mesurer AVANT de couper le fil : BUSY à l'oscilloscope,
// à 20 °C puis au réfrigérateur et au congélateur (protocole dans
// firmware/README.md). La dalle n'est garantie qu'entre 0 et 50 °C.
TPMS.ATTENTE_ECRAN_MS = { complet: 2500, partiel: 600 };

TPMS.attenteEcranMs = function (type, temperatureC) {
  var base = TPMS.ATTENTE_ECRAN_MS[type];
  if (temperatureC === null || temperatureC === undefined) return base * 2;   // inconnu : prudence
  if (temperatureC < 0) return base * 2;
  if (temperatureC < 10) return Math.round(base * 1.5);
  return base;
};
