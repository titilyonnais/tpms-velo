// =====================================================================
// boutons.cpp — Quel bouton est appuyé, d'après la tension de D5
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/boutons.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "boutons.h"

int boutonDepuisTension(float tensionV, float vddV) {
  float rapport = tensionV / vddV;
  if (rapport < BOUTON_SEUIL_SW1) return 1;
  if (rapport < BOUTON_SEUIL_SW2) return 2;
  return 0;
}
