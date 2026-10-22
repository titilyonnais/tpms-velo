// =====================================================================
// entrees.h — Reed (capteur de roue) et boutons
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : lit les broches et appelle la logique
// (boitierTopRoue, boitierBouton), comme le fait le simulateur quand on
// clique sur un bouton ou que la roue virtuelle fait un tour.
// =====================================================================
#ifndef ENTREES_H
#define ENTREES_H

#include <stdint.h>
#include "../logique/boitier.h"

// Configure le reed (interruption) et les boutons.
void entreesDemarrer();

// À appeler à chaque tour de loop() :
//   - transmet à la logique les tops de roue notés par l'interruption ;
//   - surveille le reed « collé » (aimant arrêté devant) ;
//   - lit les boutons (anti-rebond, appui court / appui long).
void entreesTraiter(Boitier* b, int32_t maintenantMs);

// Les deux boutons sont-ils enfoncés en ce moment ? (utilisé au
// démarrage pour « oublier les téléphones appairés »)
bool entreesDeuxBoutonsAppuyes();

// Juste avant le System OFF : règle les broches qui réveilleront la
// carte (reed et boutons). Voir veille.cpp.
void entreesPreparerReveil();

#endif
