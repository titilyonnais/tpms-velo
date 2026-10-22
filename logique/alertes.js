// =====================================================================
// alertes.js — État de chaque pneu à partir des mesures reçues
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++ dans le firmware.
//
// Les états sont classés du plus grave au moins grave. On retourne le
// premier qui s'applique : un pneu crevé est aussi "bas", mais on veut
// afficher "CREVAISON".
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.ETAT = {
  ATTENTE:   "ATTENTE",    // aucune trame reçue depuis l'allumage
  INTRUSION: "INTRUSION",  // deux émetteurs utilisent l'adresse du capteur
  PERDU:     "PERDU",      // plus de trame depuis trop longtemps
  CREVAISON: "CREVAISON",  // pression quasi nulle
  BASSE:     "BASSE",      // sous le seuil bas
  HAUTE:     "HAUTE",      // au-dessus du seuil haut
  FUITE:     "FUITE",      // pression correcte mais qui baisse
  OK:        "OK"
};

// Seuils par défaut (réglables plus tard depuis l'application).
// L'arrière porte plus de poids : on le gonfle un peu plus.
TPMS.seuilsParDefaut = function () {
  return {
    AV: { basBar: 1.8, hautBar: 3.2 },
    AR: { basBar: 2.0, hautBar: 3.4 },
    crevaisonBar: 0.5,
    fuiteBarH: -0.15,       // pente en dessous de laquelle on alerte
    delaiPerteMs: 60000     // 1 min sans trame = capteur perdu
  };
};

// roue = { mesure, dernierRecuMs, penteBarH, intrusionJusquaMs } (voir boitier.js)
// position = "AV" ou "AR"
// ecouteDepuisMs = instant où le boîtier s'est remis à écouter (réveil).
//   On ne reproche pas au capteur de s'être tu pendant que le boîtier
//   dormait : le délai de perte ne compte qu'à partir du réveil.
TPMS.evaluerRoue = function (roue, position, seuils, maintenantMs, ecouteDepuisMs) {
  if (roue.intrusionJusquaMs > maintenantMs) return TPMS.ETAT.INTRUSION;
  if (roue.mesure === null) return TPMS.ETAT.ATTENTE;
  var silenceMs = maintenantMs - Math.max(roue.dernierRecuMs, ecouteDepuisMs);
  if (silenceMs > seuils.delaiPerteMs) return TPMS.ETAT.PERDU;

  var p = roue.mesure.pressionBar;
  if (p < seuils.crevaisonBar || roue.mesure.alarme === 0x01) return TPMS.ETAT.CREVAISON;
  if (p < seuils[position].basBar) return TPMS.ETAT.BASSE;
  if (p > seuils[position].hautBar) return TPMS.ETAT.HAUTE;
  if (roue.penteBarH < seuils.fuiteBarH) return TPMS.ETAT.FUITE;
  return TPMS.ETAT.OK;
};

// Les états qui déclenchent bip + LED.
TPMS.estAlerte = function (etat) {
  return etat !== TPMS.ETAT.OK && etat !== TPMS.ETAT.ATTENTE;
};

// Texte court affiché sous la pression (écran sans accents).
TPMS.texteEtat = function (etat) {
  switch (etat) {
    case TPMS.ETAT.ATTENTE:   return "EN ATTENTE";
    case TPMS.ETAT.INTRUSION: return "SIGNAL SUSPECT";
    case TPMS.ETAT.PERDU:     return "CAPTEUR PERDU";
    case TPMS.ETAT.CREVAISON: return "CREVAISON";
    case TPMS.ETAT.BASSE:     return "PRESSION BASSE";
    case TPMS.ETAT.HAUTE:     return "PRESSION HAUTE";
    case TPMS.ETAT.FUITE:     return "FUITE LENTE";
    default:                  return "OK";
  }
};
