// =====================================================================
// barometre_bmp280.h — Lecture du baromètre BMP280 (bus SPI)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : lit la pression et la température, puis la boucle
// principale les donne à la logique (boitierBarometre), comme le fait le
// simulateur avec son baromètre simulé (simulateur/monde/barometre.js).
// =====================================================================
#ifndef BAROMETRE_BMP280_H
#define BAROMETRE_BMP280_H

// Démarre le BMP280. Retourne false s'il ne répond pas (la logique se
// comporte alors comme sans baromètre).
bool barometreDemarrer();

// Une mesure « à la demande » (≈ 10 ms). Retourne false en cas d'échec.
bool barometreLire(float* pressionHpa, float* temperatureC);

#endif
