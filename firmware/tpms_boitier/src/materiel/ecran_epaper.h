// =====================================================================
// ecran_epaper.h — Envoi de l'image à l'écran e-paper (SPI)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : la logique (ecran.cpp, epaper.cpp) dessine dans
// une image en mémoire ; ce module l'envoie au vrai écran.
// =====================================================================
#ifndef ECRAN_EPAPER_H
#define ECRAN_EPAPER_H

#include "../logique/epaper.h"

void ecranDemarrer();

// Envoie l'image et rafraîchit l'écran : partiel (rapide, ~0,5 s, sans
// clignotement) ou complet (~2 s, l'écran clignote mais les traces
// des images précédentes disparaissent).
void ecranEnvoyer(const Ecran* e, bool complet);

// Met le contrôleur de l'écran en sommeil profond (avant la veille).
// L'image reste affichée : un e-paper n'a pas besoin de courant pour ça.
void ecranHiberner();

#endif
