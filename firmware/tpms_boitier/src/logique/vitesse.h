// =====================================================================
// vitesse.h — Vitesse et distance à partir de l'aimant de rayon
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/vitesse.js
// LOGIQUE PURE : aucun appel Arduino. Le temps est donné en paramètre
// (maintenantMs), c'est le programme principal qui lit millis().
//
// Principe : un aimant est fixé sur un rayon. À chaque tour de roue, il
// passe devant l'interrupteur reed (ILS) fixé sur la fourche, qui se
// ferme : c'est un "top". Le temps entre deux tops donne la vitesse :
//
//     vitesse (m/s) = circonférence (m) / durée d'un tour (s)
//     vitesse (km/h) = circonférence (mm) / durée (ms) × 3,6
//
// Toutes les durées sont en millisecondes, comme millis() sur Arduino.
//
// Pourquoi des int32_t (signés) pour le temps ? Pour garder la valeur
// -1 = "jamais", comme en JS. Limite : 2^31 ms = 24,8 jours sans
// redémarrer. Impossible en pratique : le boîtier s'éteint (System OFF)
// après 5 min immobile, et chaque réveil redémarre millis() à 0.
// =====================================================================
#ifndef VITESSE_H
#define VITESSE_H

#include <stdint.h>

// Un contact reed "rebondit" : il peut se fermer plusieurs fois en
// quelques millisecondes. On ignore les tops trop rapprochés.
// 40 ms par tour avec une roue de 2,1 m correspond à 189 km/h : aucun
// vélo n'atteint cette vitesse, donc ce filtre ne fait jamais perdre de vrai top.
const int32_t ANTI_REBOND_MS = 40;

// Sans top depuis 3 s, on considère le vélo arrêté
// (cela correspond à moins de 2,5 km/h avec une roue de 2,1 m).
const int32_t DELAI_ARRET_MS = 3000;

struct Compteur {
  uint16_t circonferenceMm;
  int32_t dernierTopMs;     // -1 = aucun top reçu pour l'instant
  int32_t periodeMs;        // durée du dernier tour complet
  uint32_t nbTours;
  uint32_t distanceMm;      // uint32_t : 4 294 km maximum
  uint32_t tempsRoulageMs;  // pour la vitesse moyenne
  float vitesseMaxKmh;
};

// En JS, creerCompteur() RETOURNE un nouvel objet. En C, on évite de
// réserver de la mémoire pendant le fonctionnement : on remplit une
// structure qui existe déjà. Même principe pour tous les "creerXxx".
void creerCompteur(Compteur* c, uint16_t circonferenceMm);

// Appelée à chaque fermeture du reed.
// Retourne true si le top est pris en compte, false si c'est un rebond.
bool compteurTop(Compteur* c, int32_t maintenantMs);

// Vitesse instantanée en km/h.
float compteurVitesseKmh(const Compteur* c, int32_t maintenantMs);

float compteurDistanceKm(const Compteur* c);
float compteurMoyenneKmh(const Compteur* c);

// Bouton "remise à zéro du trajet". La circonférence est conservée.
void compteurRemiseAZero(Compteur* c);

#endif
