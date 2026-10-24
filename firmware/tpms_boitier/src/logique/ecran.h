// =====================================================================
// ecran.h — Mise en page de l'écran du boîtier (200 × 200 pixels)
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/ecran.js
// LOGIQUE PURE : aucun appel Arduino.
//
// Une fonction principale : dessinerEcran(e, vue). Elle transforme une
// "vue" (les valeurs à afficher) en pixels. Elle ne décide de rien :
// c'est boitier.cpp qui prépare la vue.
//
//   y = 0   ┌──────────────────────────────┐
//           │ TPMS  ECLAIRAGE     87% [▮▮ ]│  barre d'état
//   y = 14  ├──────────────┬───────────────┤
//           │    AVANT     │    ARRIERE    │
//           │    2.10      │     2.35      │  gros chiffres (taille 4)
//           │     bar      │      bar      │
//           │ 21°C PILE 95%│ 21°C PILE 94% │
//           │      OK      │ PRESSION BASSE│  ← colonne en négatif si alerte
//   y = 120 ├──────────────┴───────────────┤
//           │        23.4 km/h             │  page 1 : vitesse + distance
//           │ DIST  12.34 km               │  page 2 : stats du trajet
//   y = 199 └──────────────────────────────┘
// =====================================================================
#ifndef ECRAN_H
#define ECRAN_H

#include "epaper.h"
#include "vue.h"

void dessinerEcran(Ecran* e, const Vue* vue);

// Fenêtre au centre de l'écran avec le code à taper sur le téléphone.
void dessinerCodeAppairage(Ecran* e, const char* code);

// Fenêtre au centre de l'écran : ce que l'app veut changer (masque
// SENSIBLE_..., voir protocole.h) et comment répondre.
void dessinerConfirmation(Ecran* e, uint8_t masque);

// Pourcentage + petite pile dessinée, en haut à droite.
// blocage = "FROID" ou "CHAUD" quand la recharge est coupée, "" sinon.
void dessinerBatterie(Ecran* e, float pct, bool enCharge, const char* blocage);

// Une colonne : nom, pression en gros, température, pile du capteur, état.
void dessinerRoue(Ecran* e, int x0, int largeur, const char* nom, const VueRoue* roue);

void dessinerPageVitesse(Ecran* e, const Vue* vue);
void dessinerPageTrajet(Ecran* e, const Vue* vue);

// 4 965 s → "1:22:45" ("texte" d'au moins 16 cases).
void dureeEnTexte(float secondes, char* texte);

#endif
