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

// Pression ramenée à 20 °C (loi des gaz à volume constant) : évite de
// prendre un pneu qui refroidit pour une fuite.
float pressionCompenseeBar(float pressionRelBar, float temperatureC);

// ---------------------------------------------------------------------
// Prévision du prochain regonflage (sur plusieurs jours)
// ---------------------------------------------------------------------
// Un relevé au plus toutes les 3 h (en pratique : un par sortie), compensé
// en température ; on prolonge la droite des moindres carrés jusqu'au
// seuil bas :  jours restants = (pression − seuil bas) / perte par jour.
const int RELEVES_TAILLE = 30;                    // ≈ 2 semaines à 2 sorties par jour
const int32_t RELEVE_ECART_MS = 3L * 3600000L;    // au plus un relevé toutes les 3 h
const int32_t RELEVES_DUREE_MIN_MS = 2L * 86400000L;  // au moins 2 jours de recul
const int RELEVES_NB_MIN = 4;                     // et au moins 4 relevés
const float PENTE_STABLE_BAR_JOUR = -0.005f;      // au-dessus : pression stable
const int PREVISION_MAX_JOURS = 60;               // au-delà : ">60J"
const float JOURS_INCONNU = -1.0f;                // en JS : null (pas encore de prévision)

// Mémoire : 30 × (4 + 4) = 240 octets par roue.
struct Releves {
  int32_t tMs[RELEVES_TAILLE];
  float pression[RELEVES_TAILLE];
  int n;
};

void creerReleves(Releves* r);
// Ajoute un relevé si le précédent date d'au moins 3 h ; un regonflage
// (hausse de plus de 0,2 bar) efface les anciens relevés.
bool relevesAjouter(Releves* r, int32_t tMs, float pressionBar);
// Jours avant le seuil bas à perte constante (INFINITY si stable, 0 si dépassé).
float joursAvantSeuil(float pressionBar, float penteBarJour, float seuilBasBar);
// Prévision ; JOURS_INCONNU tant qu'il n'y a pas assez de recul.
// Le seuil bas (pression manomètre) est ramené dans l'unité des relevés
// (pression du capteur à 20 °C) avec la correction d'altitude et la
// température actuelle du capteur ; le temps écoulé depuis le dernier
// relevé est retranché (jamais sous 0).
float predireRegonflage(const Releves* r, float seuilBasBar, float correctionBar,
                        float temperatureC, int32_t maintenantMs);
// Texte court pour l'écran : "--", "12J", ">60J" (texte : 8 octets au moins).
void texteJours(float jours, char* texte);

#endif
