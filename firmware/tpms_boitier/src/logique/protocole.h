// =====================================================================
// protocole.h — Liaison BLE entre le boîtier et l'application
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/protocole.js
// LOGIQUE PURE : aucun appel Arduino. La partie radio (service GATT de
// Bluefruit) est dans materiel/liaison_ble.cpp.
//
// Le boîtier expose UN service BLE avec trois « caractéristiques »
// (des cases mémoire que le téléphone peut lire, écrire ou écouter) :
//
//   MESURES   (lecture + notification) : 20 octets toutes les 5 s, CHIFFRÉ et APPAIRÉ
//   REGLAGES  (lecture + écriture)     : 23 octets, CHIFFRÉ et APPAIRÉ
//   COMMANDE  (écriture)               : 1 octet,   CHIFFRÉ et APPAIRÉ
//
// MESURES est chiffrée elle aussi : la pression n'est pas secrète, mais
// la position (vitesse, distance) et les habitudes de sortie le sont.
// REGLAGES dépasse 20 octets : il faut une MTU négociée plus grande
// (le firmware la demande, voir materiel/liaison_ble.cpp). À VÉRIFIER.
//
// Contrairement aux capteurs TPMS, cette liaison est maîtrisée : elle
// utilise BLE Secure Connections (appairage par code à 6 chiffres affiché
// sur l'écran du boîtier). Une fois appairé, tout est chiffré en AES-CCM ;
// le compteur de paquets de la couche liaison empêche le rejeu.
//
// Tous les nombres sont en little-endian, comme dans les trames TPMS.
//
// Seules les fonctions utiles au BOÎTIER sont traduites :
// decoderMesures (utile seulement à l'application) ne l'est pas.
// =====================================================================
#ifndef PROTOCOLE_H
#define PROTOCOLE_H

#include <stdint.h>
#include "alertes.h"
#include "securite.h"
#include "vue.h"

// UUID 128 bits tirés au hasard pour ce projet (mêmes textes qu'en JS).
#define UUID_SERVICE  "6e7a0001-5a1e-4b8f-9c3d-2f1e0a9b8c7d"
#define UUID_MESURES  "6e7a0002-5a1e-4b8f-9c3d-2f1e0a9b8c7d"
#define UUID_REGLAGES "6e7a0003-5a1e-4b8f-9c3d-2f1e0a9b8c7d"
#define UUID_COMMANDE "6e7a0004-5a1e-4b8f-9c3d-2f1e0a9b8c7d"

const int TAILLE_MESURES = 20;
const int TAILLE_REGLAGES = 23;
const int32_t PERIODE_MESURES_MS = 5000;   // une notification MESURES toutes les 5 s

const uint8_t COMMANDE_RAZ_TRAJET = 0x01;
const uint8_t COMMANDE_ACQUITTER = 0x02;

const uint16_t PRESSION_INCONNUE = 0xFFFF;

// ---------------------------------------------------------------------
// Les réglages du boîtier (voir creerBoitier dans boitier.js).
// La structure est décrite ici parce que c'est elle que transporte la
// caractéristique REGLAGES ; boitier.h l'utilise.
// ---------------------------------------------------------------------
struct Reglages {
  Appairage appairage;
  Protections protections;
  Seuils seuils;
  uint16_t circonferenceMm;
  int32_t ecoutePeriodeMs;    // la radio s'allume toutes les 5 s...
  int32_t ecouteFenetreMs;    // ... et écoute pendant 3 s (60 % du temps)
  int32_t delaiVeilleMs;      // veille après 5 min sans rouler
  int32_t periodeEcranMs;     // en roulant, au plus un rafraîchissement toutes les 2 s
};

// Le contenu de la notification MESURES (en JS : un objet).
struct MesuresApp {
  VueRoue roues[NB_ROUES];
  float vitesseKmh;
  float distanceKm;
  float batterieBoitierPct;
  bool veille;
  bool enCharge;
  bool eclairage;
  uint16_t sequence;
};

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------
uint16_t lireUint16LE(const uint8_t* o, int i);
void ecrireUint16LE(uint8_t* o, int i, uint32_t valeur);

// "EA:CA:3F:1B:07" → { 0xEA, 0xCA, 0x3F, 0x1B, 0x07 }
void adresseDepuisTexte(const char* texte, uint8_t* octets);

// "6e7a0001-5a1e-..." → 16 octets, dans l'ordre attendu par Bluefruit :
// à l'ENVERS (octet de poids faible en premier), comme les nombres
// little-endian. Retourne false si le texte est mal formé.
// Pas d'équivalent en JS : Web Bluetooth accepte directement le texte.
bool uuidDepuisTexte(const char* texte, uint8_t* uuid16octets);

// ---------------------------------------------------------------------
// MESURES (20 octets)
//   0-1   pression AV en mbar (0xFFFF = inconnue)
//   2-3   pression AR en mbar
//   4     température AV en °C (signée)
//   5     température AR en °C
//   6     pile capteur AV en %
//   7     pile capteur AR en %
//   8     état AV (numéro de l'enum Etat = index dans CODES_ETAT)
//   9     état AR
//   10-11 vitesse en 0,1 km/h
//   12-15 distance du trajet en mètres
//   16    batterie du boîtier en %
//   17    drapeaux : bit 0 veille, bit 1 en charge, bit 2 éclairage
//   18-19 numéro de séquence (détecte les notifications perdues)
// ---------------------------------------------------------------------
void encoderMesures(const MesuresApp* m, uint8_t* o);

// ---------------------------------------------------------------------
// REGLAGES (23 octets)
//   0-1   circonférence de roue en mm
//   2-3   seuil bas AV en mbar      4-5  seuil haut AV
//   6-7   seuil bas AR en mbar      8-9  seuil haut AR
//   10-11 délai avant veille en secondes
//   12    protections : bit 0 liste blanche, bit 1 vraisemblance, bit 2 rythme
//   13-17 adresse du capteur AV
//   18-22 adresse du capteur AR
// ---------------------------------------------------------------------
void encoderReglages(const Reglages* r, uint8_t* o);

// Ne remplit QUE les champs transportés (circonférence, seuils AV/AR,
// délai de veille, protections, adresses). Les autres champs de "r"
// gardent leur valeur : on part d'une copie des réglages du boîtier.
// Retourne false si la longueur est fausse (en JS : null).
bool decoderReglages(const uint8_t* o, int longueur, Reglages* r);

// Le boîtier ne fait pas confiance aveuglément à ce qu'on lui écrit,
// même chiffré : il vérifie que les réglages ont du sens.
// Retourne "" si tout va bien, sinon la raison du refus.
const char* verifierReglages(const Reglages* r);

#endif
