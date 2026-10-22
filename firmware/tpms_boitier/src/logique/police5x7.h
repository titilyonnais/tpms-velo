// =====================================================================
// police5x7.h — Police bitmap de l'écran e-paper
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/police5x7.js
// LOGIQUE PURE : aucun appel Arduino.
//
// Police 5×7 classique, de la même famille que la police par défaut de
// la bibliothèque Adafruit GFX. On n'utilise PAS la police d'Adafruit
// GFX : on dessine avec CETTE table, la même que le simulateur, pour que
// l'écran réel soit identique au simulateur au pixel près.
//
// Chaque caractère occupe 5 colonnes. Chaque colonne est un octet :
// le bit 0 correspond au pixel du haut, le bit 6 au pixel du bas.
//
// Exemple, la lettre "A" = 7E 11 11 11 7E :
//   colonne 0 : 0x7E = 0111 1110 → pixels allumés sur les lignes 1 à 6
//   colonnes 1 à 3 : 0x11 = 0001 0001 → lignes 0 et 4 (haut et barre du A)
// =====================================================================
#ifndef POLICE5X7_H
#define POLICE5X7_H

#include <stdint.h>

// Caractères ASCII 32 (espace) à 126 (~) : 95 caractères de 5 colonnes.
extern const uint8_t POLICE_5X7[95][5];

// Le symbole degré (°).
extern const uint8_t GLYPHE_DEGRE[5];

// En JS, "°" est un caractère comme un autre. En C, dans un fichier
// enregistré en UTF-8, "°" occupe DEUX octets (0xC2 0xB0) : il
// s'afficherait "??". On lui réserve donc le code 127, inutilisé par
// l'ASCII affichable. Pour l'écrire dans un texte : "21" DEGRE "C".
const char CARACTERE_DEGRE = 0x7F;
#define DEGRE "\x7F"

// Retourne les 5 colonnes d'un caractère (un "?" s'il est inconnu).
const uint8_t* glyphe(char caractere);

#endif
