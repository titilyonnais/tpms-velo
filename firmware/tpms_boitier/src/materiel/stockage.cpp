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
static const char* NOM_JOURNAL = "/journal.bin";
static const uint32_t MAGIQUE = 0x534D5054;   // "TPMS" lu en little-endian
// Version 2 : ajout des compteurs des capteurs v2. Une sauvegarde de
// version 1 est refusée : le boîtier repart des réglages par défaut.
static const uint16_t VERSION = 2;

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
  // Capteurs v2 : dernier compteur accepté de chaque roue (anti-rejeu).
  // 2 × (1 + 4) octets de plus par mise en veille.
  uint8_t compteurConnu[NB_ROUES];
  uint32_t dernierCompteur[NB_ROUES];
  uint32_t somme;            // somme de contrôle, toujours en dernier
};

// Le journal chaîné (≈ 15 Ko) va dans un fichier à part, avec sa propre
// somme de contrôle. Son intégrité réelle se vérifie de toute façon par
// la chaîne d'empreintes (journalVerifier).
struct EnteteJournal {
  uint32_t magique;
  uint16_t version;
  uint16_t taille;
  uint32_t somme;            // somme des octets du journal
};

static uint32_t sommeOctets(const uint8_t* octets, size_t n) {
  uint32_t total = 0;
  for (size_t i = 0; i < n; i++) total += octets[i];
  return total;
}

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
  for (int r = 0; r < NB_ROUES; r++) {
    s.compteurConnu[r] = b->roues[r].compteurConnu ? 1 : 0;
    s.dernierCompteur[r] = b->roues[r].dernierCompteur;
  }
  s.somme = calculerSomme(&s);

  // On efface l'ancien fichier puis on écrit le nouveau.
  // À VÉRIFIER : avec FILE_O_WRITE, la bibliothèque écrit à la FIN d'un
  // fichier existant ; d'où l'effacement préalable.
  InternalFS.remove(NOM_FICHIER);
  File fichier = InternalFS.open(NOM_FICHIER, FILE_O_WRITE);
  if (!fichier) return false;
  size_t ecrits = fichier.write((const uint8_t*)&s, sizeof(s));
  fichier.close();
  if (ecrits != sizeof(s)) return false;

  // Journal chaîné, dans son propre fichier.
  EnteteJournal e;
  memset(&e, 0, sizeof(e));
  e.magique = MAGIQUE;
  e.version = VERSION;
  e.taille = sizeof(JournalSecurise);
  e.somme = sommeOctets((const uint8_t*)&b->journalSecurise, sizeof(JournalSecurise));
  InternalFS.remove(NOM_JOURNAL);
  File journal = InternalFS.open(NOM_JOURNAL, FILE_O_WRITE);
  if (!journal) return false;
  size_t n = journal.write((const uint8_t*)&e, sizeof(e));
  n += journal.write((const uint8_t*)&b->journalSecurise, sizeof(JournalSecurise));
  journal.close();
  return n == sizeof(e) + sizeof(JournalSecurise);
}

// Relit le journal chaîné. S'il manque ou est abîmé, on garde un journal
// vide : la chaîne repart d'une ancre à zéro (et l'empreinte copiée sur le
// téléphone, elle, ne s'y retrouvera plus : c'est voulu, ça se voit).
static void chargerJournal(Boitier* b) {
  File journal = InternalFS.open(NOM_JOURNAL, FILE_O_READ);
  if (!journal) return;
  EnteteJournal e;
  int lus = journal.read((void*)&e, sizeof(e));
  if (lus != (int)sizeof(e) || e.magique != MAGIQUE || e.version != VERSION || e.taille != sizeof(JournalSecurise)) {
    journal.close();
    return;
  }
  // Lecture dans une zone temporaire : on ne remplace le journal en RAM
  // que si la somme de contrôle est bonne. "static" pour ne pas poser
  // 15 Ko sur la pile.
  static JournalSecurise lu;
  lus = journal.read((void*)&lu, sizeof(lu));
  journal.close();
  if (lus != (int)sizeof(lu)) return;
  if (sommeOctets((const uint8_t*)&lu, sizeof(lu)) != e.somme) return;
  if (lu.nb < 0 || lu.nb > JOURNAL_TAILLE) return;
  b->journalSecurise = lu;
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
  for (int r = 0; r < NB_ROUES; r++) {
    b->roues[r].compteurConnu = s.compteurConnu[r] != 0;
    b->roues[r].dernierCompteur = s.dernierCompteur[r];
  }
  chargerJournal(b);
  return true;
}
