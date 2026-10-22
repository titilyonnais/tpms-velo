// =====================================================================
// vitesse.js — Vitesse et distance à partir de l'aimant de rayon
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++ dans le firmware.
//
// Principe : un aimant est fixé sur un rayon. À chaque tour de roue, il
// passe devant l'interrupteur reed (ILS) fixé sur la fourche, qui se
// ferme : c'est un "top". Le temps entre deux tops donne la vitesse :
//
//     vitesse (m/s) = circonférence (m) / durée d'un tour (s)
//     vitesse (km/h) = circonférence (mm) / durée (ms) × 3,6
//
// Toutes les durées sont en millisecondes, comme millis() sur Arduino.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Un contact reed "rebondit" : il peut se fermer plusieurs fois en
// quelques millisecondes. On ignore les tops trop rapprochés.
// 40 ms par tour avec une roue de 2,1 m correspond à 189 km/h : aucun
// vélo n'atteint cette vitesse, donc ce filtre ne fait jamais perdre de vrai top.
TPMS.ANTI_REBOND_MS = 40;

// Sans top depuis 3 s, on considère le vélo arrêté
// (cela correspond à moins de 2,5 km/h avec une roue de 2,1 m).
TPMS.DELAI_ARRET_MS = 3000;

TPMS.creerCompteur = function (circonferenceMm) {
  return {
    circonferenceMm: circonferenceMm,
    dernierTopMs: -1,     // -1 = aucun top reçu pour l'instant
    periodeMs: 0,         // durée du dernier tour complet
    nbTours: 0,
    distanceMm: 0,        // en C : uint32_t, soit 4 294 km maximum
    tempsRoulageMs: 0,    // pour la vitesse moyenne
    vitesseMaxKmh: 0
  };
};

// Appelée à chaque fermeture du reed (en C : dans l'interruption).
// Retourne true si le top est pris en compte, false si c'est un rebond.
TPMS.compteurTop = function (c, maintenantMs) {
  if (c.dernierTopMs >= 0) {
    var ecartMs = maintenantMs - c.dernierTopMs;
    if (ecartMs < TPMS.ANTI_REBOND_MS) return false;   // rebond : ignoré

    if (ecartMs < TPMS.DELAI_ARRET_MS) {
      // Le vélo roulait : un tour complet vient d'être fait.
      // Il compte pour la vitesse, la distance et le temps de roulage.
      c.periodeMs = ecartMs;
      c.tempsRoulageMs += ecartMs;
      c.nbTours++;
      c.distanceMm += c.circonferenceMm;
      var vitesse = c.circonferenceMm / ecartMs * 3.6;
      if (vitesse > c.vitesseMaxKmh) c.vitesseMaxKmh = vitesse;
    } else {
      // Premier tour après un arrêt : on ne connaît pas encore la vitesse.
      c.periodeMs = 0;
    }
  }
  // Le tout premier top après un arrêt ne compte pas de distance : on ne
  // sait pas quelle fraction de tour a été faite avant. L'erreur est donc
  // d'au plus un tour par démarrage, soit environ 2 m.
  c.dernierTopMs = maintenantMs;
  return true;
};

// Vitesse instantanée en km/h.
// Quand le vélo ralentit, le dernier tour mesuré est "trop rapide" :
// si le temps écoulé depuis le dernier top dépasse déjà la période,
// on utilise ce temps à la place. Ainsi l'affichage descend en douceur
// au lieu de rester figé jusqu'au top suivant.
TPMS.compteurVitesseKmh = function (c, maintenantMs) {
  if (c.dernierTopMs < 0 || c.periodeMs === 0) return 0;
  var depuisDernierTop = maintenantMs - c.dernierTopMs;
  if (depuisDernierTop > TPMS.DELAI_ARRET_MS) return 0;
  var dureeMs = Math.max(c.periodeMs, depuisDernierTop);
  return c.circonferenceMm / dureeMs * 3.6;
};

TPMS.compteurDistanceKm = function (c) {
  return c.distanceMm / 1000000;
};

TPMS.compteurMoyenneKmh = function (c) {
  if (c.tempsRoulageMs === 0) return 0;
  return c.distanceMm / c.tempsRoulageMs * 3.6;
};

// Bouton "remise à zéro du trajet". La circonférence est conservée.
TPMS.compteurRemiseAZero = function (c) {
  var circonference = c.circonferenceMm;
  var neuf = TPMS.creerCompteur(circonference);
  for (var cle in neuf) c[cle] = neuf[cle];
};
