// =====================================================================
// veille.h — Mise en veille profonde (System OFF) et réveil
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
// =====================================================================
#ifndef VEILLE_H
#define VEILLE_H

#include "../logique/boitier.h"

// Lit pourquoi la carte vient de démarrer (mise sous tension, réveil
// par la roue ou un bouton...). À appeler au début de setup(), AVANT
// Bluefruit.begin(). Remplit "texte" (au moins 48 cases).
// Retourne true si c'est un réveil après une veille.
bool veilleRaisonDemarrage(char* texte);

// Sauvegarde, éteint tout et passe en System OFF. NE REVIENT JAMAIS :
// le réveil (reed ou bouton) redémarre la carte depuis setup().
void veilleEntrer(Boitier* b);

#endif
