// =====================================================================
// tests_logique.h — Les tests du simulateur, rejoués SUR LA CARTE
// ---------------------------------------------------------------------
// Traduction en C++ d'une partie de : simulateur/tests/tests.js
// LOGIQUE PURE : aucun appel Arduino.
//
// But : prouver que la traduction C++ donne les MÊMES résultats que la
// logique JavaScript testée dans le simulateur. Si AUTOTEST vaut 1 dans
// config.h, ces tests sont lancés au démarrage et le résultat s'affiche
// sur le moniteur série (115200 bauds).
//
// Les nombres à virgule sont des "float" sur la carte (7 chiffres
// significatifs) et des "double" en JS (16 chiffres) : les tolérances
// des comparaisons sont donc un peu plus larges qu'en JS.
// =====================================================================
#ifndef TESTS_LOGIQUE_H
#define TESTS_LOGIQUE_H

// "afficher" écrit une ligne de résultat (fournie par le .ino : Serial.println).
// Retourne le nombre de tests en échec (0 = tout va bien).
int lancerTestsLogique(void (*afficher)(const char* ligne));

#endif
