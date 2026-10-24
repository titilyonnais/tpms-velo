// =====================================================================
// protocole.cpp — Codage des caractéristiques MESURES et REGLAGES
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/protocole.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "protocole.h"
#include "outils.h"
#include "trame.h"
#include <string.h>

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------
uint16_t lireUint16LE(const uint8_t* o, int i) {
  return (uint16_t)(o[i] | (o[i + 1] << 8));
}

void ecrireUint16LE(uint8_t* o, int i, uint32_t valeur) {
  o[i] = valeur & 0xFF;
  o[i + 1] = (valeur >> 8) & 0xFF;
}

// Valeur d'un chiffre hexadécimal ('A' → 10), ou -1 si ce n'en est pas un.
static int valeurHexa(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

void adresseDepuisTexte(const char* texte, uint8_t* octets) {
  // Comme parseInt(morceau, 16) || 0 en JS : on lit les chiffres
  // hexadécimaux de chaque morceau jusqu'au ':' suivant.
  const char* p = texte;
  for (int i = 0; i < TAILLE_ADRESSE; i++) {
    int valeur = 0;
    bool lisible = true;
    while (*p != '\0' && *p != ':') {
      int chiffre = valeurHexa(*p);
      if (chiffre < 0) lisible = false;          // on arrête de lire ce morceau
      if (lisible) valeur = valeur * 16 + chiffre;
      p++;
    }
    octets[i] = (uint8_t)valeur;
    if (*p == ':') p++;
  }
}

bool uuidDepuisTexte(const char* texte, uint8_t* uuid16octets) {
  uint8_t octets[16];
  int nbChiffres = 0;
  for (const char* p = texte; *p != '\0'; p++) {
    if (*p == '-') continue;                  // les tirets ne servent qu'à la lecture
    int v = valeurHexa(*p);
    if (v < 0 || nbChiffres >= 32) return false;
    if (nbChiffres % 2 == 0) octets[nbChiffres / 2] = (uint8_t)(v << 4);
    else                     octets[nbChiffres / 2] |= (uint8_t)v;
    nbChiffres++;
  }
  if (nbChiffres != 32) return false;
  // Le texte s'écrit octet de poids fort en premier ; Bluefruit veut
  // l'inverse (little-endian). On recopie donc à l'envers.
  for (int i = 0; i < 16; i++) uuid16octets[i] = octets[15 - i];
  return true;
}

// Un entier signé sur 1 octet (-128 à 127), pour la température.
static uint8_t versInt8(float valeur) {
  int32_t v = arrondi(valeur);
  if (v < -128) v = -128;
  if (v > 127) v = 127;
  return (uint8_t)(v & 0xFF);
}

// ---------------------------------------------------------------------
// MESURES
// ---------------------------------------------------------------------
void encoderMesures(const MesuresApp* m, uint8_t* o) {
  for (int k = 0; k < TAILLE_MESURES; k++) o[k] = 0;

  for (int i = 0; i < NB_ROUES; i++) {
    const VueRoue* r = &m->roues[i];
    bool connue = r->connue;
    ecrireUint16LE(o, i * 2, connue ? (uint32_t)arrondi(r->pressionBar * 1000.0f) : PRESSION_INCONNUE);
    o[4 + i] = connue ? versInt8(r->temperatureC) : 0;
    o[6 + i] = connue ? r->batteriePct : 0;
    o[8 + i] = (uint8_t)r->etat;   // le numéro de l'état = index dans CODES_ETAT
  }
  ecrireUint16LE(o, 10, (uint32_t)arrondi(m->vitesseKmh * 10.0f));
  ecrireInt32LE(o, 12, arrondi(m->distanceKm * 1000.0f));
  o[16] = (uint8_t)arrondi(m->batterieBoitierPct);
  o[17] = (m->veille ? 1 : 0) | (m->enCharge ? 2 : 0) | (m->eclairage ? 4 : 0) |
          (m->attenteConfirmation ? 8 : 0) | (m->chargeCoupee ? 16 : 0);
  o[18] = (uint8_t)(m->sequence & 0xFF);
  o[19] = versInt8(m->correctionBar * 250.0f);   // 1 pas = 4 mbar = 0,004 bar
}

// ---------------------------------------------------------------------
// REGLAGES
// ---------------------------------------------------------------------
void encoderReglages(const Reglages* r, uint8_t* o) {
  ecrireUint16LE(o, 0, r->circonferenceMm);
  ecrireUint16LE(o, 2, (uint32_t)arrondi(r->seuils.roue[POS_AV].basBar * 1000.0f));
  ecrireUint16LE(o, 4, (uint32_t)arrondi(r->seuils.roue[POS_AV].hautBar * 1000.0f));
  ecrireUint16LE(o, 6, (uint32_t)arrondi(r->seuils.roue[POS_AR].basBar * 1000.0f));
  ecrireUint16LE(o, 8, (uint32_t)arrondi(r->seuils.roue[POS_AR].hautBar * 1000.0f));
  ecrireUint16LE(o, 10, (uint32_t)arrondi(r->delaiVeilleMs / 1000.0f));
  o[12] = (r->protections.listeBlanche ? 1 : 0) |
          (r->protections.vraisemblance ? 2 : 0) |
          (r->protections.rythme ? 4 : 0);
  for (int i = 0; i < TAILLE_ADRESSE; i++) {
    o[13 + i] = r->appairage.adresse[POS_AV][i];
    o[18 + i] = r->appairage.adresse[POS_AR][i];
  }
}

bool decoderReglages(const uint8_t* o, int longueur, Reglages* r) {
  if (o == 0 || longueur != TAILLE_REGLAGES) return false;
  r->circonferenceMm = lireUint16LE(o, 0);
  r->seuils.roue[POS_AV].basBar = lireUint16LE(o, 2) / 1000.0f;
  r->seuils.roue[POS_AV].hautBar = lireUint16LE(o, 4) / 1000.0f;
  r->seuils.roue[POS_AR].basBar = lireUint16LE(o, 6) / 1000.0f;
  r->seuils.roue[POS_AR].hautBar = lireUint16LE(o, 8) / 1000.0f;
  r->delaiVeilleMs = (int32_t)lireUint16LE(o, 10) * 1000;
  r->protections.listeBlanche = (o[12] & 1) != 0;
  r->protections.vraisemblance = (o[12] & 2) != 0;
  r->protections.rythme = (o[12] & 4) != 0;
  for (int i = 0; i < TAILLE_ADRESSE; i++) {
    r->appairage.adresse[POS_AV][i] = o[13 + i];
    r->appairage.adresse[POS_AR][i] = o[18 + i];
  }
  return true;
}

const char* verifierReglages(const Reglages* r) {
  if (r->circonferenceMm < 1000 || r->circonferenceMm > 3000) {
    return "circonférence hors plage (1000 à 3000 mm)";
  }
  for (int i = 0; i < NB_ROUES; i++) {
    const SeuilsRoue* s = &r->seuils.roue[i];
    if (s->basBar < 0.5f || s->hautBar > 6.0f) return "seuils hors plage (0,5 à 6 bar)";
    if (s->basBar >= s->hautBar) return "seuil bas supérieur au seuil haut";
  }
  if (r->delaiVeilleMs < 10000 || r->delaiVeilleMs > 3600000) {
    return "délai de veille hors plage (10 s à 1 h)";
  }
  return "";
}

// ---------------------------------------------------------------------
// Changements sensibles
// ---------------------------------------------------------------------
const char* const TEXTES_SENSIBLES[NB_RAISONS_SENSIBLES] = {
  "COUPER LISTE BLANCHE",   // SENSIBLE_SANS_LISTE_BLANCHE
  "COUPER VRAISEMBLANCE",   // SENSIBLE_SANS_VRAISEMBLANCE
  "COUPER RYTHME",          // SENSIBLE_SANS_RYTHME
  "NOUVEAU CAPTEUR AV",     // SENSIBLE_CAPTEUR_AV
  "NOUVEAU CAPTEUR AR"      // SENSIBLE_CAPTEUR_AR
};

uint8_t changementSensible(const Reglages* ancien, const Reglages* nouveau) {
  uint8_t masque = 0;
  if (ancien->protections.listeBlanche && !nouveau->protections.listeBlanche) masque |= SENSIBLE_SANS_LISTE_BLANCHE;
  if (ancien->protections.vraisemblance && !nouveau->protections.vraisemblance) masque |= SENSIBLE_SANS_VRAISEMBLANCE;
  if (ancien->protections.rythme && !nouveau->protections.rythme) masque |= SENSIBLE_SANS_RYTHME;
  if (memcmp(ancien->appairage.adresse[POS_AV], nouveau->appairage.adresse[POS_AV], TAILLE_ADRESSE) != 0) masque |= SENSIBLE_CAPTEUR_AV;
  if (memcmp(ancien->appairage.adresse[POS_AR], nouveau->appairage.adresse[POS_AR], TAILLE_ADRESSE) != 0) masque |= SENSIBLE_CAPTEUR_AR;
  return masque;
}
