// =====================================================================
// capteur-simule.js — Un capteur TPMS virtuel
// ---------------------------------------------------------------------
// SOURCE DE DONNÉES simulée : elle remplace le vrai capteur vissé sur
// la valve. Elle produit exactement les mêmes trames de 18 octets.
// Le boîtier ne fait pas la différence : quand le matériel arrivera,
// on branchera les vraies trames BLE à la place de celles-ci.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Vitesse à laquelle un pneu crevé se vide (bar par seconde).
TPMS.VITESSE_CREVAISON_BAR_S = 0.15;

TPMS.creerCapteurSimule = function (numero, adresse, pressionBar) {
  return {
    numero: numero,
    adresse: adresse,             // 5 octets
    pressionBar: pressionBar,
    temperatureC: 20,
    batteriePct: 95,
    actif: true,                  // false = capteur retiré ou pile morte
    fuiteBarH: 0,                 // fuite lente en bar/heure (0 = aucune)
    crevaison: false,
    bruitBar: 0.01,               // imprécision de la mesure
    intervalleMs: 3000,           // une annonce BLE toutes les 3 s
    prochaineEmissionMs: 0
  };
};

// Fait évoluer la pression pendant dtMs millisecondes.
TPMS.capteurAvancer = function (c, dtMs) {
  if (c.fuiteBarH > 0) {
    c.pressionBar -= c.fuiteBarH * dtMs / 3600000;
  }
  if (c.crevaison) {
    c.pressionBar -= TPMS.VITESSE_CREVAISON_BAR_S * dtMs / 1000;
  }
  if (c.pressionBar < 0) c.pressionBar = 0;
};

// Construit la trame que le capteur diffuse à cet instant.
TPMS.capteurTrame = function (c) {
  var bruit = (Math.random() * 2 - 1) * c.bruitBar;
  var mesuree = Math.max(0, c.pressionBar + bruit);
  return TPMS.encoderTrame({
    numero: c.numero,
    adresse: c.adresse,
    pressionBar: mesuree,
    temperatureC: c.temperatureC,
    batteriePct: c.batteriePct,
    alarme: mesuree < 0.05 ? 0x01 : 0x00
  });
};
