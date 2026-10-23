// =====================================================================
// trame2.h — Trame d'un capteur « version 2 » : privée et signée
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/trame2.js (voir les explications là-bas)
//   octets 0-17  comme la trame v1 (octet 2 = 0xC0 + numéro − 1,
//                octets 3-7 = adresse privée qui change toutes les 15 min)
//   octets 18-21 compteur (anti-rejeu), 22-25 signature HMAC tronquée
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#ifndef TRAME2_H
#define TRAME2_H

#include <stdint.h>
#include "trame.h"

const int TAILLE_TRAME_V2 = 26;
const int TAILLE_CLE_V2 = 16;

struct MesureV2 {
  Mesure mesure;          // pression, température… (adresse = adresse privée)
  uint32_t compteur;
};

void adressePrivee(const uint8_t* cle, uint8_t alea0, uint8_t alea1, uint8_t adresse[5]);
bool adresseResolue(const uint8_t* cle, const uint8_t* adresse);
// "o" : 26 octets. compteur : +1 à chaque trame.
void encoderTrameV2(const Mesure* mesure, const uint8_t* cle, const uint8_t* adresse, uint32_t compteur, uint8_t* o);
bool decoderTrameV2(const uint8_t* o, int longueur, MesureV2* m);
bool signatureValide(const uint8_t* cle, const uint8_t* o);

#endif
