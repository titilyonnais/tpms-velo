// =====================================================================
// outils.h — Petites fonctions que le JavaScript fournit tout faites
// ---------------------------------------------------------------------
// LOGIQUE PURE : aucun appel Arduino, seulement du C/C++ standard.
//
// Pas de fichier JS correspondant : ce sont des fonctions du langage
// JavaScript lui-même (Math.round, nombre.toFixed) que le C n'a pas
// sous la même forme. On les réécrit pour obtenir EXACTEMENT les mêmes
// arrondis et les mêmes textes que le simulateur (donc le même écran).
// =====================================================================
#ifndef OUTILS_H
#define OUTILS_H

#include <stdint.h>

// Équivalent de Math.round(x) : entier le plus proche, et un « ,5 »
// est arrondi vers le haut (Math.round(2.5) = 3, Math.round(-2.5) = -2).
// Attention : la fonction C lroundf() arrondit -2,5 à -3, d'où cette
// version à nous.
int32_t arrondi(float x);

// Équivalent de nombre.toFixed(decimales) : écrit x avec un nombre fixe
// de chiffres après le point. Exemple : 2.1 avec 2 décimales → "2.10".
// "texte" doit pouvoir contenir au moins 16 caractères.
//
// Pourquoi ne pas utiliser snprintf("%.2f") ? Sur la carte, la
// bibliothèque C allégée (newlib-nano) ne sait souvent pas écrire les
// nombres à virgule avec printf, sauf option de compilation spéciale.
void nombreEnTexte(float x, int decimales, char* texte);

#endif
