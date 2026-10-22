// =====================================================================
// sorties.h — Buzzer, LED d'alerte, LED d'éclairage
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : applique les "Sorties" calculées par
// boitierMiseAJour (comme appliquerSorties() dans simulateur/app.js).
// =====================================================================
#ifndef SORTIES_H
#define SORTIES_H

#include <stdint.h>
#include "../logique/boitier.h"

// Transforme les plots NFC (P0.09, P0.10) en broches ordinaires.
// À appeler EN PREMIER dans setup() : la première fois, la carte
// redémarre une fois toute seule (voir sorties.cpp).
void nfcLibererBroches();

// Configure les sorties et lance la tâche de fond qui fait clignoter la
// LED et biper le buzzer.
void sortiesDemarrer();

// Applique les sorties demandées par la logique.
void sortiesAppliquer(const Sorties* s, int32_t maintenantMs);

// Tout éteindre (avant la veille).
void sortiesEteindre();

#endif
