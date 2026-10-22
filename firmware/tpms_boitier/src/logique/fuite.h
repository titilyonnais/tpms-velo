// =====================================================================
// fuite.h — Détection de fuite lente
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/fuite.js
// LOGIQUE PURE : aucun appel Arduino.
//
// Une fuite lente se voit mal sur une seule mesure : la pression baisse
// de quelques centièmes de bar par heure, noyés dans le bruit du capteur.
// On garde donc un historique de mesures espacées (une toutes les 30 s)
// et on calcule la PENTE de la droite qui passe au mieux par ces points
// (régression linéaire, méthode des moindres carrés).
//
//   pente < 0  → la pression baisse
//   pente en bar/heure, comparée à un seuil (ex. -0,15 bar/h)
// =====================================================================
#ifndef FUITE_H
#define FUITE_H

#include <stdint.h>

const int HISTO_TAILLE = 40;                 // 40 points × 30 s = 20 minutes
const int32_t HISTO_ECART_MS = 30000;        // une mesure gardée toutes les 30 s
// Au moins 10 min de données pour conclure. Avec 5 min, le bruit du
// capteur (±0,01 bar) donnait environ 1 fausse alerte pour 100 sorties.
const int32_t HISTO_DUREE_MIN_MS = 600000;
const float HISTO_SAUT_REGONFLAGE = 0.2f;    // hausse brusque de 0,2 bar = regonflage

// En JS : deux tableaux qui grandissent (push/shift).
// En C : deux tableaux de taille fixe et un compteur "n".
// Mémoire : 40 × (4 + 4) = 320 octets par roue.
struct Historique {
  int32_t tMs[HISTO_TAILLE];
  float pression[HISTO_TAILLE];
  int n;                        // nombre de points remplis
};

void creerHistorique(Historique* h);
void historiqueVider(Historique* h);

// Ajoute une mesure si la précédente date d'au moins 30 s.
// Retourne true si la mesure a été gardée.
bool historiqueAjouter(Historique* h, int32_t tMs, float pressionBar);

// Pente de la droite des moindres carrés, en bar par heure.
// Retourne 0 tant qu'il n'y a pas assez de données.
float historiquePenteBarH(const Historique* h);

// Calcul de la pente proprement dit (aussi utilisé par l'application).
// tMs : instants en ms ; valeurs : mesures ; n : nombre de points.
float penteMoindresCarresParHeure(const int32_t* tMs, const float* valeurs, int n);

#endif
