// =====================================================================
// trame.h — Codage et décodage des trames BLE des capteurs TPMS
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/trame.js
// LOGIQUE PURE : aucun appel Arduino, le firmware et les tests
// l'utilisent tels quels.
//
// Format SUPPOSÉ (18 octets de "manufacturer data"), d'après
// github.com/schlumpf2009/TPMS — à confirmer à la réception des capteurs :
//
//   octets 0-1   identifiant fabricant
//   octet  2     numéro du capteur (0x80 = capteur 1, 0x81 = capteur 2...)
//   octets 3-4   préfixe d'adresse
//   octets 5-7   adresse du capteur
//   octets 8-11  pression en Pa (pascals), little-endian
//   octets 12-15 température en centièmes de °C, little-endian, signée
//   octet  16    niveau de pile en %
//   octet  17    alarme (0x00 = OK, 0x01 = pas de pression)
//
// "Little-endian" = l'octet de poids faible est écrit en premier.
// Exemple : 210000 Pa = 0x00033450 s'écrit 50 34 03 00.
//
// À VÉRIFIER : tout ce format reste une hypothèse. À la réception des
// capteurs, passer MODE_DECOUVERTE à 1 dans config.h pour afficher les
// vraies trames sur le moniteur série, et corriger ce fichier si besoin.
// =====================================================================
#ifndef TRAME_H
#define TRAME_H

#include <stdint.h>

const int TAILLE_TRAME = 18;
const uint8_t ID_FABRICANT[2] = {0x00, 0x01};   // valeur supposée, À VÉRIFIER
const float PA_PAR_BAR = 100000.0f;             // 1 bar = 100 000 Pa

// L'adresse d'un capteur occupe 5 octets (octets 3 à 7 de la trame).
const int TAILLE_ADRESSE = 5;
// En texte : "EA:CA:3F:1B:07" = 14 caractères + le '\0' final du C.
const int TAILLE_ADRESSE_TEXTE = 15;

// Une trame décodée. En JS c'est un objet { numero, adresse, ... } ;
// en C, une structure.
// Différence avec le JS : l'adresse est gardée en 5 octets et non en
// texte. Comparer 5 octets (memcmp) revient exactement à comparer les
// deux textes "EA:CA:3F:1B:07", mais c'est plus simple en C.
struct Mesure {
  uint8_t numero;                   // 1 = capteur 1, 2 = capteur 2...
  uint8_t adresse[TAILLE_ADRESSE];
  float pressionBar;
  float temperatureC;
  uint8_t batteriePct;
  uint8_t alarme;                   // 0x00 OK, 0x01 pas de pression
};

// Lit un entier 32 bits signé, little-endian, à partir de l'octet i.
int32_t lireInt32LE(const uint8_t* o, int i);

// Écrit un entier 32 bits, little-endian, à partir de l'octet i.
void ecrireInt32LE(uint8_t* o, int i, int32_t valeur);

// Un octet en 2 chiffres hexadécimaux : 0x0A → "0A" (+ '\0', donc 3 cases).
void octetEnHexa(uint8_t octet, char* texte);

// 5 octets d'adresse → "EA:CA:3F:1B:07" (texte de TAILLE_ADRESSE_TEXTE cases).
void adresseEnTexte(const uint8_t* octets, char* texte);

// Une trame complète en hexadécimal : "00 01 80 EA ...".
// "texte" doit contenir au moins 3 × n cases.
void trameEnHexa(const uint8_t* octets, int n, char* texte);

// CODAGE : ce que fait le capteur. Sert seulement aux tests sur la carte
// (dans le simulateur, c'est le capteur virtuel qui l'utilise).
// "o" doit contenir TAILLE_TRAME octets.
void encoderTrame(const Mesure* mesure, uint8_t* o);

// DÉCODAGE : ce que fait le boîtier à chaque annonce BLE reçue.
// Retourne false si la trame n'a pas le bon format (en JS : null).
bool decoderTrame(const uint8_t* o, int longueur, Mesure* mesure);

#endif
