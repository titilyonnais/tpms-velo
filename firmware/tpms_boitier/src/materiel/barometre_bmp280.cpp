// =====================================================================
// barometre_bmp280.cpp — Lecture du baromètre BMP280 (bus SPI)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE. Bibliothèque : « Adafruit BMP280 Library », à
// installer depuis le gestionnaire de bibliothèques de l'Arduino IDE
// (elle installe aussi Adafruit Unified Sensor).
//
// Câblage (bus SPI partagé avec l'écran, chacun sa broche CS) :
//   CSB = D0, SCL = D8 (SCK), SDA = D10 (MOSI), SDO = D9 (MISO),
//   VCC = 3V3, GND = GND. La carte GY-BMP280 est collée au-dessus de
//   l'évent à membrane ePTFE (boitier-3d/README.md) : elle mesure l'air
//   extérieur, pas l'air piégé du boîtier.
//
// Mode « forcé » : le capteur dort (0,1 µA), fait UNE mesure quand on le
// lui demande, puis se rendort. Une mesure toutes les 10 s coûte moins de
// 1 µA en moyenne (fiche Bosch : 2,74 µA pour une mesure par seconde).
// =====================================================================
#include "barometre_bmp280.h"
#include "../../config.h"
#include <Adafruit_BMP280.h>

// Constructeur « SPI matériel » : seule la broche CS est donnée.
static Adafruit_BMP280 bmp(BROCHE_BARO_CS);
static bool present = false;

bool barometreDemarrer() {
  // begin() lit l'identifiant de la puce (0x58) et ses coefficients
  // d'étalonnage, propres à chaque exemplaire.
  present = bmp.begin();
  if (!present) return false;
  // Suréchantillonnage : ×1 pour la température, ×4 pour la pression
  // (bruit ≈ 0,03 hPa, largement assez : 1 hPa = 0,001 bar). Pas de
  // filtre : une mesure toutes les 10 s seulement.
  bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::SAMPLING_X4,
                  Adafruit_BMP280::FILTER_OFF,
                  Adafruit_BMP280::STANDBY_MS_1);
  return true;
}

bool barometreLire(float* pressionHpa, float* temperatureC) {
  if (!present) return false;
  // À VÉRIFIER : selon la version de la bibliothèque, takeForcedMeasurement()
  // retourne bool (true = mesure faite) ou rien.
  if (!bmp.takeForcedMeasurement()) return false;
  *temperatureC = bmp.readTemperature();
  *pressionHpa = bmp.readPressure() / 100.0f;   // Pa → hPa
  return true;
}
