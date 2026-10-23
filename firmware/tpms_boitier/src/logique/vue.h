// =====================================================================
// vue.h — Les valeurs à afficher (et à envoyer à l'application)
// ---------------------------------------------------------------------
// Traduction en C++ des objets retournés par boitierVue() et vueRoue()
// dans simulateur/boitier/boitier.js.
// LOGIQUE PURE : aucun appel Arduino.
//
// En JS ces objets sont créés à la volée ; en C il faut décrire leur
// forme à l'avance. On les range dans ce petit fichier parce que trois
// modules s'en servent : boitier (qui les remplit), ecran (qui les
// dessine) et protocole (qui les envoie à l'application).
// =====================================================================
#ifndef VUE_H
#define VUE_H

#include <stdint.h>
#include "alertes.h"

// Ce qu'on sait d'une roue, prêt à afficher.
// En JS, pressionBar vaut null quand aucune trame n'a été reçue ;
// en C, c'est le booléen "connue" qui le dit.
struct VueRoue {
  Etat etat;
  bool connue;            // false = aucune mesure (en JS : pressionBar null)
  float pressionBar;      // pression AFFICHÉE (avec hystérésis)
  float temperatureC;
  uint8_t batteriePct;
  float joursRegonflage;  // prévision ; JOURS_INCONNU (-1) = pas encore (en JS : null)
};

struct Vue {
  int page;
  bool veille;
  bool eclairage;
  bool enCharge;
  float batterieBoitierPct;
  bool appConnectee;
  bool radioSaturee;      // inondation d'annonces détectée
  char codeAppairage[7];  // "" = pas de code (en JS : null)
  VueRoue roues[NB_ROUES];
  float vitesseKmh;
  float distanceKm;
  float moyenneKmh;
  float maxKmh;
  float dureeRoulageS;
};

#endif
