// =====================================================================
// stockage.cpp — Sauvegarde des réglages et du trajet en mémoire flash
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE. Bibliothèque : InternalFileSystem (fournie avec le
// cœur Adafruit/Seeed nRF52), un petit système de fichiers LittleFS dans
// la flash interne du nRF52840. Bluefruit l'utilise déjà pour garder les
// clés d'appairage des téléphones.
//
// Le fichier contient une seule structure, écrite telle quelle (octet
// par octet). Pour ne pas relire n'importe quoi :
//   - un "nombre magique" (les lettres TPMS) en tête ;
//   - un numéro de version et la taille de la structure : si une
//     nouvelle version du firmware change la structure, l'ancienne
//     sauvegarde est ignorée ;
//   - une somme de contrôle sur tous les octets.
//
// La flash supporte environ 10 000 effacements par page : on sauvegarde
// seulement à la mise en veille et quand l'application change les
// réglages, soit quelques fois par jour.
// =====================================================================
#include "stockage.h"
#include <Adafruit_LittleFS.h>
#include <InternalFileSystem.h>
#include <stddef.h>   // offsetof
#include <string.h>

using namespace Adafruit_LittleFS_Namespace;

static const char* NOM_FICHIER = "/tpms.bin";
static const uint32_t MAGIQUE = 0x534D5054;   // "TPMS" lu en little-endian
static const uint16_t VERSION = 1;

struct Sauvegarde {
  uint32_t magique;
  uint16_t version;
  uint16_t taille;
  Reglages reglages;
  // Le trajet (sans dernierTopMs ni periodeMs, qui n'ont plus de sens
  // après un redémarrage : millis() repart de 0).
  uint32_t nbTours;
  uint32_t distanceMm;
  uint32_t tempsRoulageMs;
  float vitesseMaxKmh;
  uint32_t somme;            // somme de contrôle, toujours en dernier
};

// Somme de tous les octets avant le champ "somme".
static uint32_t calculerSomme(const Sauvegarde* s) {
  const uint8_t* octets = (const uint8_t*)s;
  uint32_t total = 0;
  for (size_t i = 0; i < offsetof(Sauvegarde, somme); i++) total += octets[i];
  return total;
}

bool stockageDemarrer() {
  return InternalFS.begin();
}

bool stockageSauver(const Boitier* b) {
  Sauvegarde s;
  memset(&s, 0, sizeof(s));   // octets de remplissage à 0 : somme reproductible
  s.magique = MAGIQUE;
  s.version = VERSION;
  s.taille = sizeof(Sauvegarde);
  s.reglages = b->reglages;
  s.nbTours = b->compteur.nbTours;
  s.distanceMm = b->compteur.distanceMm;
  s.tempsRoulageMs = b->compteur.tempsRoulageMs;
  s.vitesseMaxKmh = b->compteur.vitesseMaxKmh;
  s.somme = calculerSomme(&s);

  // On efface l'ancien fichier puis on écrit le nouveau.
  // À VÉRIFIER : avec FILE_O_WRITE, la bibliothèque écrit à la FIN d'un
  // fichier existant ; d'où l'effacement préalable.
  InternalFS.remove(NOM_FICHIER);
  File fichier = InternalFS.open(NOM_FICHIER, FILE_O_WRITE);
  if (!fichier) return false;
  size_t ecrits = fichier.write((const uint8_t*)&s, sizeof(s));
  fichier.close();
  return ecrits == sizeof(s);
}

bool stockageCharger(Boitier* b) {
  File fichier = InternalFS.open(NOM_FICHIER, FILE_O_READ);
  if (!fichier) return false;
  Sauvegarde s;
  int lus = fichier.read((void*)&s, sizeof(s));
  fichier.close();

  if (lus != (int)sizeof(s)) return false;
  if (s.magique != MAGIQUE || s.version != VERSION || s.taille != sizeof(Sauvegarde)) return false;
  if (s.somme != calculerSomme(&s)) return false;
  // Même vérification que pour des réglages reçus de l'application :
  // on ne fait confiance à rien de ce qui vient de l'extérieur du programme.
  if (verifierReglages(&s.reglages)[0] != '\0') return false;

  b->reglages = s.reglages;
  b->compteur.circonferenceMm = s.reglages.circonferenceMm;
  b->compteur.nbTours = s.nbTours;
  b->compteur.distanceMm = s.distanceMm;
  b->compteur.tempsRoulageMs = s.tempsRoulageMs;
  b->compteur.vitesseMaxKmh = s.vitesseMaxKmh;
  return true;
}
