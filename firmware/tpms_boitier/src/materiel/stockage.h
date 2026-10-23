// =====================================================================
// stockage.h — Sauvegarde des réglages et du trajet en mémoire flash
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
//
// Pourquoi ? En veille, le boîtier s'éteint presque complètement
// (System OFF) et son réveil est un REDÉMARRAGE : toute la RAM est
// perdue. Dans le simulateur, la veille garde tout en mémoire ; pour
// obtenir le même comportement, on sauvegarde en flash ce qui doit
// survivre : les réglages (reçus de l'application), le trajet en cours,
// le dernier compteur accepté des capteurs v2 (sinon la première trame
// REJOUÉE après un réveil serait acceptée) et le journal de sécurité
// chaîné (sinon il repartirait de zéro à chaque veille, et effacer une
// trace deviendrait aussi simple qu'attendre la mise en veille).
// =====================================================================
#ifndef STOCKAGE_H
#define STOCKAGE_H

#include "../logique/boitier.h"

// Prépare le système de fichiers (LittleFS dans la flash interne).
bool stockageDemarrer();

// Écrit les réglages, le trajet, les compteurs v2 et le journal chaîné.
bool stockageSauver(const Boitier* b);

// Relit la sauvegarde. Retourne false s'il n'y en a pas (premier
// démarrage) ou si elle est illisible : on garde alors les valeurs par défaut.
bool stockageCharger(Boitier* b);

#endif
