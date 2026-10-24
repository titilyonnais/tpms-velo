// =====================================================================
// config.h — Broches et constantes matérielles du boîtier
// ---------------------------------------------------------------------
// Carte : Seeed XIAO nRF52840 (cœur Arduino « Seeed nRF52 Boards »,
// basé sur Adafruit nRF52 / Bluefruit — PAS la version « mbed »).
//
// Le XIAO n'a que 11 broches D0 à D10. Il en faudrait 15 :
//   e-paper (SCK, MOSI, CS, DC, RST, BUSY) = 6, baromètre (CS, MISO) = 2,
//   reed = 1, boutons = 2, coupure de recharge = 1, buzzer = 1,
//   LED d'alerte = 1, LED d'éclairage = 1 (les 2 LED sur un seul transistor).
// Solutions retenues :
//   - les 2 plots NFC sous la carte (P0.09 et P0.10) deviennent des
//     sorties ordinaires (voir sorties.cpp) : buzzer et éclairage, deux
//     sorties « tout ou rien » à 0 au repos (voir README) ;
//   - le baromètre BMP280 partage le bus SPI de l'écran ; sa sortie SDO
//     arrive sur D9 (MISO), qui était réservée mais inutilisée ;
//   - le fil BUSY de l'écran est supprimé : le programme attend une
//     durée fixe, plus longue par temps froid (logique/barometre.h).
//     D0 sélectionne alors le baromètre ;
//   - les 2 boutons partagent D5, lue en analogique (logique/boutons.h) :
//     D6 commande la coupure de la recharge par grand froid.
//
//   Broche XIAO   GPIO nRF   Rôle
//   D0            P0.02      CSB du baromètre BMP280 (sortie, 1 au repos)
//   D1            P0.03      e-paper RST
//   D2            P0.28      e-paper DC
//   D3            P0.29      e-paper CS
//   D4            P0.04      reed (interrupteur de roue) → GND
//   D5            P0.05      boutons : SW1 → GND, SW2 → 2,2 kΩ → GND (AIN3)
//   D6            P1.11      coupure de recharge : 1 = Q3 passant, U4 coupé
//   D7            P1.12      LED d'alerte rouge (+ 270 Ω)
//   D8            P1.13      SPI SCK  → e-paper CLK et BMP280 SCL
//   D9            P1.14      SPI MISO ← BMP280 SDO
//   D10           P1.15      SPI MOSI → e-paper DIN et BMP280 SDA
//   plot NFC1     P0.09      buzzer (via transistor MOSFET)
//   plot NFC2     P0.10      2 LED d'éclairage (via transistor MOSFET)
//   (interne)     P0.14      active le pont diviseur de la batterie (à 0)
//   (interne)     P0.31      mesure de la tension batterie (AIN7)
//   (interne)     P0.17      état de charge (0 = en charge)
//   (interne)     P0.13      courant de charge (0 = 100 mA)
// =====================================================================
#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ---------------------------------------------------------------------
// Broches « Arduino » (numéros D0 à D10 du XIAO)
// ---------------------------------------------------------------------
#define BROCHE_BARO_CS     0    // D0 (était le BUSY de l'écran)
#define BROCHE_EPD_BUSY    -1   // non câblée : GxEPD2 attend une durée fixe
#define BROCHE_EPD_RST     1    // D1
#define BROCHE_EPD_DC      2    // D2
#define BROCHE_EPD_CS      3    // D3
#define BROCHE_REED        4    // D4
#define BROCHE_BOUTONS     5    // D5 = A5 (AIN3) : les deux boutons
#define BROCHE_COUPURE_CHARGE 6 // D6 : commande de Q3 (R11 la tire à 0)
#define BROCHE_LED_ALERTE  7    // D7
// D8 (SCK), D9 (MISO) et D10 (MOSI) : bus SPI par défaut du XIAO,
// partagé par l'écran et le baromètre (chacun a sa broche CS).

// ---------------------------------------------------------------------
// Broches pilotées directement par leur numéro nRF (port × 32 + n°),
// sans passer par la numérotation Arduino.
// ---------------------------------------------------------------------
#define GPIO_BUZZER        9    // P0.09 = plot NFC1
#define GPIO_ECLAIRAGE     10   // P0.10 = plot NFC2
#define GPIO_VBAT_ENABLE   14   // P0.14 : à 0 → pont diviseur de la batterie actif
#define GPIO_CHARGE        17   // P0.17 : 0 = batterie en charge (À VÉRIFIER)
#define GPIO_HICHG         13   // P0.13 : 0 = charge à 100 mA, 1 = 50 mA (À VÉRIFIER)

// Mesure de la batterie : P0.31. Le cœur Seeed définit normalement
// PIN_VBAT ; sinon on prend 32. À VÉRIFIER dans variant.h du cœur Seeed.
#ifndef PIN_VBAT
#define PIN_VBAT 32
#endif

// ---------------------------------------------------------------------
// Rythme de la boucle
// ---------------------------------------------------------------------
const int32_t PERIODE_BOUCLE_MS = 10;       // loop() tourne toutes les 10 ms
const int32_t PERIODE_MAJ_MS = 1000;        // boitierMiseAJour une fois par seconde
const int32_t PERIODE_BATTERIE_MS = 30000;  // mesure de la batterie toutes les 30 s
// Baromètre : PERIODE_BAROMETRE_MS (10 s) dans logique/boitier.h.

// ---------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------
const int32_t APPUI_LONG_MS = 700;          // au-delà : appui long
const int32_t ANTI_REBOND_BOUTON_MS = 30;   // un appui doit durer 30 ms pour compter
// Oublier les téléphones appairés : bouton 1 maintenu 5 s au démarrage.
// (Avant le 24/10/2026 : les deux boutons ensemble. Sur une seule broche,
// « les deux » se lit comme « bouton 1 » : le geste a changé.)
const int32_t OUBLI_APPUI_MS = 5000;

// ---------------------------------------------------------------------
// Reed (interrupteur de roue)
// ---------------------------------------------------------------------
// true  : pull-up INTERNE du nRF52840 (≈ 13 kΩ), aucun composant en plus.
//         Si l'aimant s'arrête pile devant le reed, 3,3 V / 13 kΩ = 0,25 mA
//         circulent en permanence (12 fois la consommation au repos !).
//         Parade logicielle : au bout de 3 s fermé, on coupe le pull-up et
//         on vérifie une fois par seconde si le reed s'est rouvert.
// false : pull-up EXTERNE de 1 MΩ (+ condensateur 10 nF vers GND).
//         Aimant arrêté devant le reed : 3,3 µA seulement, rien à faire.
const bool REED_PULLUP_INTERNE = true;
const int32_t REED_DELAI_COLLE_MS = 3000;   // fermé plus longtemps = aimant arrêté devant
const int32_t REED_SONDAGE_MS = 1000;       // vérification de réouverture

// ---------------------------------------------------------------------
// Sorties
// ---------------------------------------------------------------------
const int32_t LED_CLIGNOTEMENT_MS = 1000;   // période : 500 ms allumée, 500 ms éteinte
const int32_t BIP_DUREE_MS = 120;           // 3 bips de 120 ms (voir energie.js)
const int BIP_NOMBRE = 3;

// ---------------------------------------------------------------------
// Batterie (LiPo 500 mAh)
// ---------------------------------------------------------------------
// Pont diviseur du XIAO : 1 MΩ en haut, 510 kΩ en bas (À VÉRIFIER sur
// le schéma Seeed). Tension batterie = tension mesurée × 1510 / 510.
const float BATTERIE_RAPPORT_PONT = 1510.0f / 510.0f;
// Correction à régler une fois avec un multimètre (À VÉRIFIER) :
// correction = tension lue au multimètre / tension affichée sur le port série.
const float BATTERIE_CORRECTION = 1.0f;

// ---------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------
// 0, 1, 2 ou 3 (quarts de tour) selon le sens de montage dans le boîtier.
const uint8_t ECRAN_ROTATION = 0;

// ---------------------------------------------------------------------
// Bluetooth
// ---------------------------------------------------------------------
#define NOM_BLE "TPMS Velo"
// Puissance d'émission en dBm (-40, -20, -16, -12, -8, -4, 0, +4, +8).
const int8_t PUISSANCE_BLE_DBM = 0;
// Copies d'une même annonce (3 canaux) : ignorées si reçues à moins de 100 ms.
const int32_t COPIE_IGNOREE_MS = 100;

// ---------------------------------------------------------------------
// Mise au point (moniteur série à 115200 bauds)
// ---------------------------------------------------------------------
// 1 = au démarrage, rejoue sur la carte les tests du simulateur
//     (attend 2 s que le moniteur série soit ouvert). Mettre 0 ensuite.
#define AUTOTEST 1
// 1 = écrit chaque trame TPMS reçue (hexadécimal + verdict du boîtier).
#define JOURNAL_TRAMES 1
// 1 = MODE DÉCOUVERTE : écrit TOUTES les annonces BLE qui contiennent des
//     "manufacturer data", quelle que soit leur longueur. À utiliser à la
//     réception des capteurs pour découvrir leur vrai format et leurs
//     adresses (le format de trame.h n'est qu'une hypothèse).
#define MODE_DECOUVERTE 0

#endif
