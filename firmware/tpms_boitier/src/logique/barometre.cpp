// =====================================================================
// barometre.cpp — Correction d'altitude, recharge par grand froid, écran
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/barometre.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "barometre.h"

float correctionAltitudeBar(bool mesureConnue, float pressionAirHpa) {
  if (!mesureConnue) return 0.0f;
  if (!(pressionAirHpa >= BARO_MIN_HPA && pressionAirHpa <= BARO_MAX_HPA)) return 0.0f;
  return (PRESSION_REF_CAPTEUR_HPA - pressionAirHpa) / 1000.0f;
}

float pressionCorrigeeBar(float pressionCapteurBar, float correctionBar) {
  if (pressionCapteurBar <= 0.0f) return 0.0f;
  float p = pressionCapteurBar + correctionBar;
  return p > 0.0f ? p : 0.0f;
}

BlocageCharge blocageCharge(BlocageCharge avant, bool temperatureConnue, float temperatureC) {
  if (!temperatureConnue) return BLOCAGE_AUCUN;
  float min = CHARGE_MIN_C, max = CHARGE_MAX_C;
  if (avant == BLOCAGE_FROID) min += CHARGE_HYSTERESIS_C;   // il faut remonter franchement
  if (avant == BLOCAGE_CHAUD) max -= CHARGE_HYSTERESIS_C;
  if (temperatureC < min) return BLOCAGE_FROID;
  if (temperatureC > max) return BLOCAGE_CHAUD;
  return BLOCAGE_AUCUN;
}

const char* texteBlocage(BlocageCharge blocage) {
  if (blocage == BLOCAGE_FROID) return "FROID";
  if (blocage == BLOCAGE_CHAUD) return "CHAUD";
  return "";
}

int32_t attenteEcranMs(bool complet, bool temperatureConnue, float temperatureC) {
  int32_t base = complet ? ATTENTE_ECRAN_COMPLET_MS : ATTENTE_ECRAN_PARTIEL_MS;
  if (!temperatureConnue) return base * 2;   // inconnu : prudence
  if (temperatureC < 0.0f) return base * 2;
  if (temperatureC < 10.0f) return (base * 3) / 2;
  return base;
}
