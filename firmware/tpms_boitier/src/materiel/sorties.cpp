// =====================================================================
// sorties.cpp — Buzzer, LED d'alerte, LED d'éclairage
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
//
// Câblage (voir README) :
//   LED d'alerte rouge : D7 → 270 Ω → LED → GND. ≈ 5 mA : la broche est
//     mise en sortie « forte » (une sortie normale du nRF52840 ne
//     fournit que ~2 mA sans que sa tension s'effondre).
//   Buzzer actif 3 V (~25 mA) : trop pour une broche. Plot NFC1 (P0.09)
//     → 100 Ω → grille d'un MOSFET canal N (AO3400 ou 2N7002), 100 kΩ
//     grille-GND ; buzzer entre 3V3 et le drain ; diode 1N4148 en
//     parallèle sur le buzzer.
//   2 LED blanches (5 mA chacune) : plot NFC2 (P0.10) → même montage à
//     MOSFET ; chaque LED a sa résistance de 150 Ω et est alimentée par
//     la batterie (BAT+, 3,7 à 4,2 V) car une LED blanche demande ~3 V :
//     les 3,3 V de la carte ne laissent pas assez de marge.
//   Une seule broche pour les 2 LED : elles s'allument toujours ensemble.
//
// POURQUOI UNE TÂCHE DE FOND ?
//   Le clignotement (500 ms) et les 3 bips de 120 ms demandent un
//   minutage précis. Or loop() peut rester bloquée jusqu'à 2 s pendant
//   un rafraîchissement complet de l'e-paper : le buzzer resterait
//   allumé tout ce temps ! On confie donc ces animations à une petite
//   tâche FreeRTOS (le système multitâche intégré au cœur Adafruit nRF52)
//   qui tourne en parallèle de loop() et se réveille toutes les 10 ms.
//   loop() se contente de lui dire QUOI faire (mode de la LED, bip).
// =====================================================================
#include "sorties.h"
#include "gpio_nrf.h"
#include "../../config.h"

// Consignes partagées entre loop() et la tâche de fond.
// Ce sont des valeurs de 32 bits au plus : sur ce processeur, leur
// lecture/écriture se fait en une seule instruction, sans risque d'être
// coupée en deux par l'autre tâche.
static volatile LedAlerte modeLed = LED_ETEINTE;
static volatile int32_t bipDebutMs = -1;     // -1 = pas de bip en cours
static uint32_t gpioLedAlerte = 0;

// ---------------------------------------------------------------------
// Plots NFC → broches ordinaires
// ---------------------------------------------------------------------
// Par défaut, P0.09 et P0.10 sont réservés à l'antenne NFC. Un registre
// de configuration permanent (UICR.NFCPINS, en mémoire flash) les rend
// utilisables comme GPIO. On l'écrit une seule fois, puis la carte
// redémarre (le réglage n'est lu qu'au démarrage). Aux démarrages
// suivants, le bit est déjà à 0 et on ne fait rien.
// Il faut le faire AVANT Bluefruit.begin() : ensuite, la pile radio
// interdit l'accès direct à la mémoire flash.
// (Avec PlatformIO, l'option -DCONFIG_NFCT_PINS_AS_GPIOS fait la même
// chose automatiquement au démarrage.)
// À VÉRIFIER : sur le XIAO, les plots NFC1/NFC2 sont-ils bien reliés
// directement à P0.09/P0.10, sans condensateur d'accord ?
void nfcLibererBroches() {
  if ((NRF_UICR->NFCPINS & UICR_NFCPINS_PROTECT_Msk) ==
      (UICR_NFCPINS_PROTECT_NFC << UICR_NFCPINS_PROTECT_Pos)) {
    NRF_NVMC->CONFIG = NVMC_CONFIG_WEN_Wen << NVMC_CONFIG_WEN_Pos;     // écriture autorisée
    while (NRF_NVMC->READY == NVMC_READY_READY_Busy) {}
    NRF_UICR->NFCPINS &= ~UICR_NFCPINS_PROTECT_Msk;                    // bit à 0 : GPIO
    while (NRF_NVMC->READY == NVMC_READY_READY_Busy) {}
    NRF_NVMC->CONFIG = NVMC_CONFIG_WEN_Ren << NVMC_CONFIG_WEN_Pos;     // retour en lecture seule
    while (NRF_NVMC->READY == NVMC_READY_READY_Busy) {}
    NVIC_SystemReset();                                                // redémarrage
  }
}

// ---------------------------------------------------------------------
// Tâche de fond : clignotement et bips
// ---------------------------------------------------------------------
static void tacheSorties(void* parametre) {
  (void)parametre;
  for (;;) {
    int32_t t = (int32_t)millis();

    // LED d'alerte : éteinte, fixe, ou clignotante (500 ms / 500 ms).
    LedAlerte mode = modeLed;
    bool ledAllumee = (mode == LED_FIXE) ||
                      (mode == LED_CLIGNOTE && (t % LED_CLIGNOTEMENT_MS) < LED_CLIGNOTEMENT_MS / 2);
    gpioEcrire(gpioLedAlerte, ledAllumee);

    // Buzzer : 3 bips de 120 ms séparés de 120 ms.
    //   temps écoulé : 0   120  240  360  480  600  720
    //   buzzer       : ON  off  ON   off  ON   off  fin
    bool buzzer = false;
    int32_t debut = bipDebutMs;
    if (debut >= 0) {
      int32_t ecoule = t - debut;
      if (ecoule >= BIP_NOMBRE * 2 * BIP_DUREE_MS) {
        bipDebutMs = -1;                                // séquence terminée
      } else {
        buzzer = ((ecoule / BIP_DUREE_MS) % 2) == 0;
      }
    }
    gpioEcrire(GPIO_BUZZER, buzzer);

    delay(10);   // dans le cœur Adafruit, delay() endort la tâche (économie d'énergie)
  }
}

void sortiesDemarrer() {
  gpioLedAlerte = gpioDepuisArduino(BROCHE_LED_ALERTE);

  // On fixe le niveau AVANT de passer en sortie, pour éviter une
  // impulsion parasite (un petit bip au démarrage).
  gpioEcrire(gpioLedAlerte, false);
  gpioSortie(gpioLedAlerte, true);         // sortie forte : la LED tire 5 mA
  gpioEcrire(GPIO_BUZZER, false);
  gpioSortie(GPIO_BUZZER, false);          // commande une grille de MOSFET : pas de courant
  gpioEcrire(GPIO_ECLAIRAGE, false);
  gpioSortie(GPIO_ECLAIRAGE, false);

  // Tâche FreeRTOS : fonction, nom, pile (en mots de 4 octets),
  // paramètre, priorité, identifiant (inutile ici).
  // À VÉRIFIER : priorité égale à celle de loop() (TASK_PRIO_LOW = 1
  // dans le cœur Adafruit) ; FreeRTOS partage alors le temps entre les deux.
  xTaskCreate(tacheSorties, "sorties", 256, NULL, tskIDLE_PRIORITY + 1, NULL);
}

void sortiesAppliquer(const Sorties* s, int32_t maintenantMs) {
  modeLed = s->ledAlerte;
  if (s->bip) bipDebutMs = maintenantMs;
  gpioEcrire(GPIO_ECLAIRAGE, s->ledsEclairage);
}

void sortiesEteindre() {
  modeLed = LED_ETEINTE;
  bipDebutMs = -1;
  delay(20);   // laisse la tâche de fond prendre en compte les consignes
  gpioEcrire(gpioLedAlerte, false);
  gpioEcrire(GPIO_BUZZER, false);
  gpioEcrire(GPIO_ECLAIRAGE, false);
}
