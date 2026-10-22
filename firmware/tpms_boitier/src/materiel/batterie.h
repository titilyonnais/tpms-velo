// =====================================================================
// batterie.h — Niveau de la LiPo du boîtier et état de charge
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : mesure la tension et remplit b->batteriePct et
// b->enCharge (dans le simulateur, ce sont un curseur et une case à cocher).
// =====================================================================
#ifndef BATTERIE_H
#define BATTERIE_H

#include <stdint.h>
#include "../logique/boitier.h"

void batterieDemarrer();

// Tension de la batterie en volts.
float batterieTension();

// Pourcentage estimé d'après la tension (courbe typique d'une LiPo).
float batteriePourcentage(float tension);

bool batterieEnCharge();

// Met à jour b->batteriePct et b->enCharge.
// "premiere" = true au démarrage (pas de filtrage).
void batterieLire(Boitier* b, bool premiere);

#endif
