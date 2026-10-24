// =====================================================================
// veille.cpp — Mise en veille profonde (System OFF) et réveil
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
//
// Le nRF52840 a deux sommeils :
//   - « System ON » : le processeur dort entre deux tâches mais tout
//     reste prêt (c'est ce que fait delay() dans loop()) ;
//   - « System OFF » : presque tout est coupé, ~5 µA pour toute la carte
//     (valeur Seeed, À VÉRIFIER à l'oscilloscope avec une résistance de
//     10 Ω en série). Seules quelques broches surveillées peuvent le
//     réveiller, et le réveil est un REDÉMARRAGE complet.
//
// Quand la logique décide la veille (5 min sans rouler, boitierMiseAJour),
// l'écran affiche déjà « VEILLE » avec les dernières pressions : un
// e-paper garde son image sans courant. On sauvegarde ensuite les
// réglages et le trajet (stockage.cpp), on règle le réveil par le reed
// et les boutons (entrees.cpp), puis on éteint.
//
// Différence avec le simulateur : au réveil, les pressions sont
// redemandées aux capteurs (« EN ATTENTE » pendant 5 s au plus), car la
// RAM a été perdue. Le trajet et les réglages, eux, sont relus en flash.
// =====================================================================
#include "veille.h"
#include "capteurs_ble.h"
#include "ecran_epaper.h"
#include "entrees.h"
#include "gpio_nrf.h"
#include "liaison_ble.h"
#include "sorties.h"
#include "stockage.h"
#include "../../config.h"
#include <bluefruit.h>
#include <stdio.h>

bool veilleRaisonDemarrage(char* texte, bool* parChargeur) {
  *parChargeur = false;
  // Registre RESETREAS : un bit par cause de démarrage. Il se lit AVANT
  // Bluefruit.begin(), car ensuite la pile radio en interdit l'accès direct.
  // À VÉRIFIER : le cœur Arduino ne l'a-t-il pas déjà effacé au démarrage ?
  // (sinon on lit 0 et le message dit « mise sous tension »).
  uint32_t raison = NRF_POWER->RESETREAS;
  NRF_POWER->RESETREAS = raison;   // on efface en écrivant des 1

  // Réveil par le 5 V du chargeur (détection de VBUS) : branché, ou
  // coupure de recharge relâchée avant la veille alors qu'il est toujours là.
  if (raison & POWER_RESETREAS_VBUS_Msk) {
    *parChargeur = true;
    snprintf(texte, 48, "Réveil (chargeur branché)");
    return true;
  }
  if ((raison & POWER_RESETREAS_OFF_Msk) == 0) {
    snprintf(texte, 48, "Démarrage (code 0x%08lX)", (unsigned long)raison);
    return false;
  }

  // Réveil depuis System OFF par une broche. Le registre LATCH indique
  // quelles broches ont déclenché le réveil.
  // À VÉRIFIER : LATCH est-il conservé à travers le réveil ?
  uint32_t reed = gpioDepuisArduino(BROCHE_REED);
  uint32_t bt = gpioDepuisArduino(BROCHE_BOUTONS);
  const char* source = "broche inconnue";
  if (gpioPort(reed)->LATCH & (1UL << gpioNumero(reed))) source = "la roue tourne";
  else if (gpioPort(bt)->LATCH & (1UL << gpioNumero(bt))) source = "bouton";
  NRF_P0->LATCH = 0xFFFFFFFF;   // efface les indicateurs
  NRF_P1->LATCH = 0xFFFFFFFF;
  snprintf(texte, 48, "Réveil (%s)", source);
  return true;
}

void veilleEntrer(Boitier* b) {
  boitierJournal(b, (int32_t)millis(), "Extinction (System OFF) jusqu'au prochain tour de roue ou bouton");

  capteursFenetre(false);       // radio : plus d'écoute des capteurs
  liaisonBleArreter();          // plus d'annonces, téléphone déconnecté
  sortiesEteindre();            // LED et buzzer éteints
  stockageSauver(b);            // réglages + trajet en flash
  ecranHiberner();              // contrôleur de l'écran en sommeil profond
  entreesPreparerReveil();      // reed et boutons réveilleront la carte

  Serial.flush();
  delay(50);

  // Avec la pile radio active, il faut lui demander d'éteindre la carte.
  uint8_t piloteActif = 0;
  sd_softdevice_is_enabled(&piloteActif);
  if (piloteActif) {
    sd_power_system_off();
  } else {
    NRF_POWER->SYSTEMOFF = 1;
  }
  // On ne doit jamais arriver ici (sauf en débogage, où le System OFF est simulé).
  while (true) {}
}
