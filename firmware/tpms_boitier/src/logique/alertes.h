// =====================================================================
// alertes.h — État de chaque pneu à partir des mesures reçues
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/alertes.js
// LOGIQUE PURE : aucun appel Arduino.
//
// Les états sont classés du plus grave au moins grave. On retourne le
// premier qui s'applique : un pneu crevé est aussi "bas", mais on veut
// afficher "CREVAISON".
// =====================================================================
#ifndef ALERTES_H
#define ALERTES_H

#include <stdint.h>
#include "securite.h"

// En JS, un état est un texte ("BASSE"...). En C, un numéro (enum).
// L'ORDRE est celui de CODES_ETAT dans protocole.js : le numéro de
// l'état est directement l'octet envoyé à l'application.
enum Etat {
  ETAT_ATTENTE = 0,   // aucune trame reçue depuis l'allumage
  ETAT_INTRUSION,     // deux émetteurs utilisent l'adresse du capteur
  ETAT_PERDU,         // plus de trame depuis trop longtemps
  ETAT_CREVAISON,     // pression quasi nulle
  ETAT_BASSE,         // sous le seuil bas
  ETAT_HAUTE,         // au-dessus du seuil haut
  ETAT_FUITE,         // pression correcte mais qui baisse
  ETAT_OK
};

struct SeuilsRoue {
  float basBar;
  float hautBar;
};

// En JS : seuils.AV.basBar ; en C : seuils.roue[POS_AV].basBar
struct Seuils {
  SeuilsRoue roue[NB_ROUES];
  float crevaisonBar;
  float fuiteBarH;          // pente en dessous de laquelle on alerte
  int32_t delaiPerteMs;     // sans trame pendant ce délai = capteur perdu
};

// Seuils par défaut (réglables depuis l'application).
// L'arrière porte plus de poids : on le gonfle un peu plus.
void seuilsParDefaut(Seuils* s);

// La structure Roue est décrite dans boitier.h (comme dans boitier.js).
// On l'annonce seulement ici ("déclaration anticipée") pour éviter que
// les deux fichiers .h s'incluent l'un l'autre.
struct Roue;

// position       : POS_AV ou POS_AR
// ecouteDepuisMs : instant où le boîtier s'est remis à écouter (réveil).
//   On ne reproche pas au capteur de s'être tu pendant que le boîtier
//   dormait : le délai de perte ne compte qu'à partir du réveil.
Etat evaluerRoue(const Roue* roue, Position position, const Seuils* seuils,
                 int32_t maintenantMs, int32_t ecouteDepuisMs);

// Les états qui déclenchent bip + LED.
bool estAlerte(Etat etat);

// Texte court affiché sous la pression (écran sans accents).
const char* texteEtat(Etat etat);

#endif
