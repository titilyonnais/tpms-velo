// =====================================================================
// outils.cpp — Équivalents de Math.round et toFixed (voir outils.h)
// ---------------------------------------------------------------------
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "outils.h"
#include <math.h>
#include <stdio.h>

int32_t arrondi(float x) {
  // floor(x + 0,5) : c'est la définition exacte de Math.round.
  return (int32_t)floorf(x + 0.5f);
}

void nombreEnTexte(float x, int decimales, char* texte) {
  // 10 puissance "decimales" : 1, 10, 100...
  int32_t facteur = 1;
  for (int i = 0; i < decimales; i++) facteur *= 10;

  bool negatif = (x < 0);
  if (negatif) x = -x;

  // On arrondit une seule fois, sur un entier : 2,1 × 100 → 210.
  int32_t n = arrondi(x * facteur);
  int32_t partieEntiere = n / facteur;
  int32_t partieDecimale = n % facteur;

  // Partie entière (snprintf sait écrire les entiers, même en newlib-nano).
  int longueur = snprintf(texte, 16, "%s%ld", negatif ? "-" : "", (long)partieEntiere);

  // Partie décimale, chiffre par chiffre, en gardant les zéros : 2.05.
  if (decimales > 0) {
    texte[longueur++] = '.';
    int32_t diviseur = facteur / 10;
    for (int i = 0; i < decimales; i++) {
      texte[longueur++] = (char)('0' + (partieDecimale / diviseur) % 10);
      diviseur /= 10;
    }
    texte[longueur] = '\0';
  }
}
