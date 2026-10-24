// =====================================================================
// boutons.h — Les deux boutons sur une seule broche (D5, entrée AIN3)
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/boutons.js (schéma et calculs là-bas).
// LOGIQUE PURE : aucun appel Arduino. La lecture analogique est dans
// materiel/entrees.cpp.
//
//   aucun bouton : D5 = VDD    SW1 : 0 V    SW2 (à travers 2,2 kΩ) : 12 à 17 % de VDD
// =====================================================================
#ifndef BOUTONS_H
#define BOUTONS_H

const float BOUTON_SEUIL_SW1 = 0.06f;   // sous 6 % de VDD : SW1
const float BOUTON_SEUIL_SW2 = 0.45f;   // de 6 à 45 % : SW2 ; au-dessus : aucun

// Retourne 0 (aucun), 1 ou 2.
int boutonDepuisTension(float tensionV, float vddV);

#endif
