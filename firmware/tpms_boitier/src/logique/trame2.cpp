// =====================================================================
// trame2.cpp — Trame d'un capteur « version 2 » : privée et signée
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/trame2.js
// =====================================================================
#include "trame2.h"
#include "sha256.h"
#include <string.h>

void adressePrivee(const uint8_t* cle, uint8_t alea0, uint8_t alea1, uint8_t adresse[5]) {
  uint8_t message[3] = {0x01, alea0, alea1};
  uint8_t h[32];
  hmacSha256(cle, TAILLE_CLE_V2, message, 3, h);
  adresse[0] = alea0;
  adresse[1] = alea1;
  adresse[2] = h[0];
  adresse[3] = h[1];
  adresse[4] = h[2];
}

bool adresseResolue(const uint8_t* cle, const uint8_t* adresse) {
  uint8_t attendue[5];
  adressePrivee(cle, adresse[0], adresse[1], attendue);
  return attendue[2] == adresse[2] && attendue[3] == adresse[3] && attendue[4] == adresse[4];
}

// Signature des 22 premiers octets (précédés de 0x02).
static void signatureTrame(const uint8_t* cle, const uint8_t* o, uint8_t signature[4]) {
  uint8_t message[23];
  message[0] = 0x02;
  memcpy(message + 1, o, 22);
  uint8_t h[32];
  hmacSha256(cle, TAILLE_CLE_V2, message, 23, h);
  memcpy(signature, h, 4);
}

void encoderTrameV2(const Mesure* mesure, const uint8_t* cle, const uint8_t* adresse, uint32_t compteur, uint8_t* o) {
  Mesure m = *mesure;
  memcpy(m.adresse, adresse, TAILLE_ADRESSE);
  encoderTrame(&m, o);               // octets 0 à 17
  o[2] = 0xC0 + (mesure->numero - 1);
  ecrireInt32LE(o, 18, (int32_t)compteur);
  signatureTrame(cle, o, o + 22);
}

bool decoderTrameV2(const uint8_t* o, int longueur, MesureV2* m) {
  if (longueur != TAILLE_TRAME_V2) return false;
  if (o[0] != ID_FABRICANT[0] || o[1] != ID_FABRICANT[1]) return false;
  if (o[2] < 0xC0) return false;
  m->mesure.numero = o[2] - 0xC0 + 1;
  memcpy(m->mesure.adresse, o + 3, TAILLE_ADRESSE);
  m->mesure.pressionBar = lireInt32LE(o, 8) / 100000.0f;
  m->mesure.temperatureC = lireInt32LE(o, 12) / 100.0f;
  m->mesure.batteriePct = o[16];
  m->mesure.alarme = o[17];
  m->compteur = (uint32_t)lireInt32LE(o, 18);
  return true;
}

bool signatureValide(const uint8_t* cle, const uint8_t* o) {
  uint8_t s[4];
  signatureTrame(cle, o, s);
  return s[0] == o[22] && s[1] == o[23] && s[2] == o[24] && s[3] == o[25];
}
