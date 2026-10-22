// =====================================================================
// trame.cpp — Codage et décodage des trames TPMS
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/trame.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "trame.h"
#include "outils.h"
#include <math.h>
#include <string.h>

int32_t lireInt32LE(const uint8_t* o, int i) {
  // On assemble les 4 octets dans un entier NON signé (les décalages
  // sur des entiers signés sont piégeux en C), puis on le relit signé.
  uint32_t v = (uint32_t)o[i]
             | ((uint32_t)o[i + 1] << 8)
             | ((uint32_t)o[i + 2] << 16)
             | ((uint32_t)o[i + 3] << 24);
  return (int32_t)v;
}

void ecrireInt32LE(uint8_t* o, int i, int32_t valeur) {
  uint32_t v = (uint32_t)valeur;
  o[i]     = v & 0xFF;
  o[i + 1] = (v >> 8) & 0xFF;
  o[i + 2] = (v >> 16) & 0xFF;
  o[i + 3] = (v >> 24) & 0xFF;
}

void octetEnHexa(uint8_t octet, char* texte) {
  const char* CHIFFRES = "0123456789ABCDEF";
  texte[0] = CHIFFRES[octet >> 4];      // les 4 bits de poids fort
  texte[1] = CHIFFRES[octet & 0x0F];    // les 4 bits de poids faible
  texte[2] = '\0';
}

void adresseEnTexte(const uint8_t* octets, char* texte) {
  // Chaque octet prend 3 cases : 2 chiffres + ':' (ou '\0' pour le dernier).
  for (int i = 0; i < TAILLE_ADRESSE; i++) {
    octetEnHexa(octets[i], texte + i * 3);
    if (i < TAILLE_ADRESSE - 1) texte[i * 3 + 2] = ':';
  }
}

void trameEnHexa(const uint8_t* octets, int n, char* texte) {
  texte[0] = '\0';
  for (int i = 0; i < n; i++) {
    octetEnHexa(octets[i], texte + i * 3);
    if (i < n - 1) texte[i * 3 + 2] = ' ';
  }
}

// ---------------------------------------------------------------------
// CODAGE (capteur) — utilisé par les tests sur la carte.
// ---------------------------------------------------------------------
void encoderTrame(const Mesure* mesure, uint8_t* o) {
  memset(o, 0, TAILLE_TRAME);

  o[0] = ID_FABRICANT[0];
  o[1] = ID_FABRICANT[1];
  o[2] = 0x80 + (mesure->numero - 1);
  for (int i = 0; i < TAILLE_ADRESSE; i++) {
    o[3 + i] = mesure->adresse[i];
  }

  int32_t pressionPa = arrondi(fmaxf(0.0f, mesure->pressionBar) * PA_PAR_BAR);
  ecrireInt32LE(o, 8, pressionPa);

  int32_t temperatureCentiemes = arrondi(mesure->temperatureC * 100.0f);
  ecrireInt32LE(o, 12, temperatureCentiemes);

  int32_t pile = mesure->batteriePct;
  if (pile < 0) pile = 0;
  if (pile > 100) pile = 100;
  o[16] = (uint8_t)pile;
  o[17] = mesure->alarme ? 0x01 : 0x00;
}

// ---------------------------------------------------------------------
// DÉCODAGE (boîtier) — appelé pour chaque annonce BLE reçue.
// ---------------------------------------------------------------------
bool decoderTrame(const uint8_t* o, int longueur, Mesure* mesure) {
  if (o == 0 || longueur != TAILLE_TRAME) return false;
  if (o[0] != ID_FABRICANT[0] || o[1] != ID_FABRICANT[1]) return false;
  if (o[2] < 0x80) return false;

  mesure->numero = o[2] - 0x80 + 1;
  memcpy(mesure->adresse, o + 3, TAILLE_ADRESSE);
  mesure->pressionBar = lireInt32LE(o, 8) / PA_PAR_BAR;
  mesure->temperatureC = lireInt32LE(o, 12) / 100.0f;
  mesure->batteriePct = o[16];
  mesure->alarme = o[17];
  return true;
}
