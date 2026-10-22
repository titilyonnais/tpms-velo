// =====================================================================
// vitesse.cpp — Vitesse et distance à partir de l'aimant de rayon
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/vitesse.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "vitesse.h"

void creerCompteur(Compteur* c, uint16_t circonferenceMm) {
  c->circonferenceMm = circonferenceMm;
  c->dernierTopMs = -1;
  c->periodeMs = 0;
  c->nbTours = 0;
  c->distanceMm = 0;
  c->tempsRoulageMs = 0;
  c->vitesseMaxKmh = 0.0f;
}

bool compteurTop(Compteur* c, int32_t maintenantMs) {
  if (c->dernierTopMs >= 0) {
    int32_t ecartMs = maintenantMs - c->dernierTopMs;
    if (ecartMs < ANTI_REBOND_MS) return false;   // rebond : ignoré

    if (ecartMs < DELAI_ARRET_MS) {
      // Le vélo roulait : un tour complet vient d'être fait.
      // Il compte pour la vitesse, la distance et le temps de roulage.
      c->periodeMs = ecartMs;
      c->tempsRoulageMs += ecartMs;
      c->nbTours++;
      c->distanceMm += c->circonferenceMm;
      float vitesse = (float)c->circonferenceMm / (float)ecartMs * 3.6f;
      if (vitesse > c->vitesseMaxKmh) c->vitesseMaxKmh = vitesse;
    } else {
      // Premier tour après un arrêt : on ne connaît pas encore la vitesse.
      c->periodeMs = 0;
    }
  }
  // Le tout premier top après un arrêt ne compte pas de distance : on ne
  // sait pas quelle fraction de tour a été faite avant. L'erreur est donc
  // d'au plus un tour par démarrage, soit environ 2 m.
  c->dernierTopMs = maintenantMs;
  return true;
}

// Quand le vélo ralentit, le dernier tour mesuré est "trop rapide" :
// si le temps écoulé depuis le dernier top dépasse déjà la période,
// on utilise ce temps à la place. Ainsi l'affichage descend en douceur
// au lieu de rester figé jusqu'au top suivant.
float compteurVitesseKmh(const Compteur* c, int32_t maintenantMs) {
  if (c->dernierTopMs < 0 || c->periodeMs == 0) return 0.0f;
  int32_t depuisDernierTop = maintenantMs - c->dernierTopMs;
  if (depuisDernierTop > DELAI_ARRET_MS) return 0.0f;
  int32_t dureeMs = (c->periodeMs > depuisDernierTop) ? c->periodeMs : depuisDernierTop;
  return (float)c->circonferenceMm / (float)dureeMs * 3.6f;
}

float compteurDistanceKm(const Compteur* c) {
  return c->distanceMm / 1000000.0f;
}

float compteurMoyenneKmh(const Compteur* c) {
  if (c->tempsRoulageMs == 0) return 0.0f;
  return (float)c->distanceMm / (float)c->tempsRoulageMs * 3.6f;
}

void compteurRemiseAZero(Compteur* c) {
  uint16_t circonference = c->circonferenceMm;
  creerCompteur(c, circonference);
}
