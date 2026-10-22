// =====================================================================
// capteurs_ble.h — Écoute radio des capteurs TPMS (scan BLE)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : c'est la « vraie » source de données qui remplace
// capteur-simule.js. Elle fournit à la logique exactement la même chose :
// 18 octets de "manufacturer data" et l'heure de réception.
// =====================================================================
#ifndef CAPTEURS_BLE_H
#define CAPTEURS_BLE_H

#include <stdint.h>
#include "../logique/boitier.h"

// Configure le scanner Bluefruit (à appeler APRÈS Bluefruit.begin()).
void capteursDemarrer();

// Ouvre ou ferme la fenêtre d'écoute (d'après boitierEcoute()).
void capteursFenetre(bool ecouter);

// Transmet à la logique les trames reçues depuis le dernier appel.
void capteursTraiter(Boitier* b);

#endif
