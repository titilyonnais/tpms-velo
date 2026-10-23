// =====================================================================
// main.cpp — Lance les tests de la logique C++ sur un ordinateur
// ---------------------------------------------------------------------
// La logique du boîtier (src/logique/) n'utilise que du C++ standard :
// on peut donc la compiler et la tester sur un PC, sans la carte XIAO.
// Sur la carte, c'est le .ino qui appelle lancerTestsLogique() avec
// Serial.println ; ici on affiche simplement avec puts.
//
// Compiler et lancer (Linux, ou GitHub Actions) :
//   g++ -std=c++11 -Wall -I../tpms_boitier/src/logique main.cpp
//       ../tpms_boitier/src/logique/*.cpp -o tests_pc   puis   ./tests_pc
// =====================================================================
#include <stdio.h>
#include "tests_logique.h"

static void afficher(const char* ligne) { puts(ligne); }

int main() {
  int rates = lancerTestsLogique(afficher);
  return rates == 0 ? 0 : 1;   // code de sortie 1 si un test échoue
}
