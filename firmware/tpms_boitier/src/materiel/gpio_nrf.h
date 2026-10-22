// =====================================================================
// gpio_nrf.h — Accès direct aux broches du nRF52840
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
//
// Les fonctions Arduino (pinMode, digitalWrite) suffisent pour D0 à D10.
// Mais certaines choses ne sont pas prévues par Arduino :
//   - piloter les plots NFC (P0.09, P0.10) et les broches internes du
//     XIAO (P0.13, P0.14, P0.17), qui n'ont pas de numéro D ;
//   - choisir une sortie « forte » (jusqu'à ~10 mA au lieu de ~2 mA) ;
//   - régler le « SENSE » d'une broche : c'est lui qui réveille le
//     microcontrôleur endormi en System OFF.
// On écrit donc directement dans les registres du port GPIO, décrits
// dans la fiche technique du nRF52840 (chapitre GPIO, registre PIN_CNF).
//
// Numéro nRF d'une broche = port × 32 + numéro : P0.09 → 9, P1.11 → 43.
// =====================================================================
#ifndef GPIO_NRF_H
#define GPIO_NRF_H

#include <Arduino.h>

enum Tirage { TIRAGE_AUCUN, TIRAGE_HAUT, TIRAGE_BAS };   // pull-up / pull-down

// Le port (P0 ou P1) et le numéro dans le port.
inline NRF_GPIO_Type* gpioPort(uint32_t gpio) { return (gpio >= 32) ? NRF_P1 : NRF_P0; }
inline uint32_t gpioNumero(uint32_t gpio) { return gpio & 31; }

// Numéro nRF d'une broche Arduino (D0 → 2, D6 → 43...), grâce à la table
// du cœur Arduino. À VÉRIFIER : g_ADigitalPinMap est bien déclarée par
// le variant.h du cœur Seeed nRF52 (c'est le cas du cœur Adafruit).
inline uint32_t gpioDepuisArduino(uint32_t brocheArduino) { return g_ADigitalPinMap[brocheArduino]; }

inline uint32_t gpioValeurTirage(Tirage t) {
  if (t == TIRAGE_HAUT) return GPIO_PIN_CNF_PULL_Pullup;
  if (t == TIRAGE_BAS) return GPIO_PIN_CNF_PULL_Pulldown;
  return GPIO_PIN_CNF_PULL_Disabled;
}

// Niveau d'une sortie. OUTSET / OUTCLR changent UN bit sans toucher aux
// autres : deux tâches peuvent piloter deux broches sans se gêner.
inline void gpioEcrire(uint32_t gpio, bool haut) {
  if (haut) gpioPort(gpio)->OUTSET = (1UL << gpioNumero(gpio));
  else      gpioPort(gpio)->OUTCLR = (1UL << gpioNumero(gpio));
}

// Sortie. forte = true : mode "high drive" H0H1 (pour alimenter une LED).
inline void gpioSortie(uint32_t gpio, bool forte) {
  gpioPort(gpio)->PIN_CNF[gpioNumero(gpio)] =
      (GPIO_PIN_CNF_DIR_Output << GPIO_PIN_CNF_DIR_Pos)
    | (GPIO_PIN_CNF_INPUT_Disconnect << GPIO_PIN_CNF_INPUT_Pos)
    | (GPIO_PIN_CNF_PULL_Disabled << GPIO_PIN_CNF_PULL_Pos)
    | ((forte ? GPIO_PIN_CNF_DRIVE_H0H1 : GPIO_PIN_CNF_DRIVE_S0S1) << GPIO_PIN_CNF_DRIVE_Pos)
    | (GPIO_PIN_CNF_SENSE_Disabled << GPIO_PIN_CNF_SENSE_Pos);
}

// Entrée, avec ou sans résistance de tirage interne.
inline void gpioEntree(uint32_t gpio, Tirage tirage) {
  gpioPort(gpio)->PIN_CNF[gpioNumero(gpio)] =
      (GPIO_PIN_CNF_DIR_Input << GPIO_PIN_CNF_DIR_Pos)
    | (GPIO_PIN_CNF_INPUT_Connect << GPIO_PIN_CNF_INPUT_Pos)
    | (gpioValeurTirage(tirage) << GPIO_PIN_CNF_PULL_Pos)
    | (GPIO_PIN_CNF_DRIVE_S0S1 << GPIO_PIN_CNF_DRIVE_Pos)
    | (GPIO_PIN_CNF_SENSE_Disabled << GPIO_PIN_CNF_SENSE_Pos);
}

inline bool gpioLire(uint32_t gpio) {
  return ((gpioPort(gpio)->IN >> gpioNumero(gpio)) & 1UL) != 0;
}

// Entrée qui RÉVEILLE le microcontrôleur en System OFF quand elle passe
// au niveau choisi (bas si surNiveauBas, haut sinon).
inline void gpioReveil(uint32_t gpio, Tirage tirage, bool surNiveauBas) {
  gpioPort(gpio)->PIN_CNF[gpioNumero(gpio)] =
      (GPIO_PIN_CNF_DIR_Input << GPIO_PIN_CNF_DIR_Pos)
    | (GPIO_PIN_CNF_INPUT_Connect << GPIO_PIN_CNF_INPUT_Pos)
    | (gpioValeurTirage(tirage) << GPIO_PIN_CNF_PULL_Pos)
    | (GPIO_PIN_CNF_DRIVE_S0S1 << GPIO_PIN_CNF_DRIVE_Pos)
    | ((surNiveauBas ? GPIO_PIN_CNF_SENSE_Low : GPIO_PIN_CNF_SENSE_High) << GPIO_PIN_CNF_SENSE_Pos);
}

// Broche complètement débranchée (entrée déconnectée, sans tirage) :
// elle ne consomme plus rien, même si elle « flotte ».
inline void gpioDeconnecter(uint32_t gpio) {
  gpioPort(gpio)->PIN_CNF[gpioNumero(gpio)] =
      (GPIO_PIN_CNF_DIR_Input << GPIO_PIN_CNF_DIR_Pos)
    | (GPIO_PIN_CNF_INPUT_Disconnect << GPIO_PIN_CNF_INPUT_Pos)
    | (GPIO_PIN_CNF_PULL_Disabled << GPIO_PIN_CNF_PULL_Pos)
    | (GPIO_PIN_CNF_DRIVE_S0S1 << GPIO_PIN_CNF_DRIVE_Pos)
    | (GPIO_PIN_CNF_SENSE_Disabled << GPIO_PIN_CNF_SENSE_Pos);
}

#endif
