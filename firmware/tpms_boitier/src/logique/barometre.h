// =====================================================================
// barometre.h — Ce que le boîtier tire de son baromètre BMP280
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/barometre.js
// LOGIQUE PURE : aucun appel Arduino. La lecture du BMP280 (bus SPI)
// est dans materiel/barometre_bmp280.cpp.
//
// Trois usages :
//   1. corriger l'erreur d'altitude des capteurs de pneu ;
//   2. couper la recharge de la LiPo hors de 2-43 °C ;
//   3. allonger l'attente de fin de rafraîchissement de l'écran par
//      temps froid (le fil BUSY de l'écran est supprimé).
// =====================================================================
#ifndef BAROMETRE_H
#define BAROMETRE_H

#include <stdint.h>

// 1. Correction d'altitude (voir barometre.js pour l'explication)
const float PRESSION_REF_CAPTEUR_HPA = 1013.25f;   // retirée par le capteur TPMS
const float BARO_MIN_HPA = 300.0f;                 // plage du BMP280 :
const float BARO_MAX_HPA = 1100.0f;                // hors plage = en panne

// Correction en bar ; 0 si la mesure est absente ou hors plage
// (en JS : pressionAirHpa === null).
float correctionAltitudeBar(bool mesureConnue, float pressionAirHpa);

// Pression « manomètre » ; une trame à 0 bar reste à 0 (pneu vide).
float pressionCorrigeeBar(float pressionCapteurBar, float correctionBar);

// 2. Recharge coupée trop froid ou trop chaud
const float CHARGE_MIN_C = 2.0f;
const float CHARGE_MAX_C = 43.0f;
const float CHARGE_HYSTERESIS_C = 3.0f;

// En JS : "", "FROID", "CHAUD".
enum BlocageCharge { BLOCAGE_AUCUN, BLOCAGE_FROID, BLOCAGE_CHAUD };

// Sans mesure de température : jamais de blocage.
BlocageCharge blocageCharge(BlocageCharge avant, bool temperatureConnue, float temperatureC);

// Texte affiché à l'écran : "", "FROID" ou "CHAUD".
const char* texteBlocage(BlocageCharge blocage);

// 3. Attente de fin de rafraîchissement de l'écran (sans fil BUSY)
// HYPOTHÈSES à mesurer à l'oscilloscope avant de couper le fil BUSY.
const int32_t ATTENTE_ECRAN_COMPLET_MS = 2500;
const int32_t ATTENTE_ECRAN_PARTIEL_MS = 600;

int32_t attenteEcranMs(bool complet, bool temperatureConnue, float temperatureC);

#endif
