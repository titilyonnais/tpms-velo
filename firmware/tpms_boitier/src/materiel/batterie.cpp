// =====================================================================
// batterie.cpp — Niveau de la LiPo du boîtier et état de charge
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
//
// Le XIAO nRF52840 a, sur la carte :
//   - un pont diviseur (1 MΩ / 510 kΩ) entre la batterie et P0.31, car
//     la tension de la LiPo (jusqu'à 4,2 V) dépasse ce que supporte une
//     entrée analogique (3,3 V au plus). Le bas du pont est relié à P0.14 :
//     P0.14 à 0 → le pont fonctionne (≈ 2,8 µA consommés en permanence).
//     ATTENTION (doc Seeed) : ne jamais mettre P0.14 à 1, la tension de
//     la batterie arriverait alors presque entière sur P0.31. On la laisse
//     donc toujours à 0, même en veille.
//   - un chargeur (BQ25101) dont la sortie « en charge » est sur P0.17
//     (0 = en charge) et dont le courant se règle avec P0.13
//     (0 = 100 mA, adapté à notre LiPo de 500 mAh).
// À VÉRIFIER sur le schéma Seeed : valeurs du pont, polarités de P0.17 et P0.13.
// =====================================================================
#include "batterie.h"
#include "gpio_nrf.h"
#include "../../config.h"
#include <math.h>

void batterieDemarrer() {
  // Pont diviseur actif en permanence (voir l'avertissement ci-dessus).
  gpioEcrire(GPIO_VBAT_ENABLE, false);
  gpioSortie(GPIO_VBAT_ENABLE, false);

  // Courant de charge : 100 mA.
  gpioEcrire(GPIO_HICHG, false);
  gpioSortie(GPIO_HICHG, false);

  // Sortie « en charge » du chargeur : collecteur ouvert → pull-up.
  gpioEntree(GPIO_CHARGE, TIRAGE_HAUT);

  // Convertisseur analogique-numérique : 12 bits (0 à 4095), référence
  // interne de 2,4 V. Avec le pont, 4,2 V de batterie donnent 1,42 V :
  // une pleine échelle de 2,4 V donne une meilleure précision que 3,6 V.
  // À VÉRIFIER : AR_INTERNAL_2_4 existe bien dans le cœur Seeed/Adafruit.
  analogReference(AR_INTERNAL_2_4);
  analogReadResolution(12);
}

float batterieTension() {
  // Le pont a une forte résistance (≈ 340 kΩ vu de l'entrée) : la
  // première conversion est souvent fausse. On en jette une, puis on
  // fait la moyenne de 8 mesures.
  // À VÉRIFIER : le temps d'acquisition du convertisseur réglé par le
  // cœur Arduino est peut-être trop court pour une source de 340 kΩ ;
  // si la tension lue est trop basse, régler BATTERIE_CORRECTION.
  // La lecture des boutons change la référence (AR_VDD4) : on la remet.
  analogReference(AR_INTERNAL_2_4);
  analogReadResolution(12);
  analogRead(PIN_VBAT);
  uint32_t somme = 0;
  for (int i = 0; i < 8; i++) somme += analogRead(PIN_VBAT);
  float brut = somme / 8.0f;
  float tensionBroche = brut * 2.4f / 4096.0f;
  return tensionBroche * BATTERIE_RAPPORT_PONT * BATTERIE_CORRECTION;
}

// Courbe de décharge typique d'une LiPo à faible courant :
// la tension baisse vite au début et à la fin, lentement au milieu.
// Entre deux points du tableau, on interpole en ligne droite.
float batteriePourcentage(float tension) {
  static const float TENSIONS[] = {3.30f, 3.50f, 3.60f, 3.65f, 3.70f, 3.75f, 3.80f, 3.90f, 4.00f, 4.10f, 4.20f};
  static const float POURCENTS[] = {0.0f, 5.0f, 10.0f, 20.0f, 30.0f, 40.0f, 50.0f, 65.0f, 80.0f, 90.0f, 100.0f};
  const int N = 11;
  if (tension <= TENSIONS[0]) return 0.0f;
  if (tension >= TENSIONS[N - 1]) return 100.0f;
  for (int i = 1; i < N; i++) {
    if (tension < TENSIONS[i]) {
      float part = (tension - TENSIONS[i - 1]) / (TENSIONS[i] - TENSIONS[i - 1]);
      return POURCENTS[i - 1] + part * (POURCENTS[i] - POURCENTS[i - 1]);
    }
  }
  return 100.0f;
}

bool batterieEnCharge() {
  return gpioLire(GPIO_CHARGE) == false;   // 0 = en charge
}

void batterieLire(Boitier* b, bool premiere) {
  float pct = (float)floorf(batteriePourcentage(batterieTension()));
  bool enCharge = batterieEnCharge();
  // La tension varie un peu selon ce que consomme la carte (radio
  // allumée ou non). Pour ne pas redessiner l'écran pour 1 %, on ne
  // change l'affichage que pour un écart d'au moins 2 %.
  if (premiere || fabsf(pct - b->batteriePct) >= 2.0f || enCharge != b->enCharge) {
    b->batteriePct = pct;
  }
  b->enCharge = enCharge;
}
