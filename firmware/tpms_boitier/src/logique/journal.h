// =====================================================================
// journal.h — Journal de sécurité chaîné
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/journal.js
//   empreinte(n) = SHA256( "n|instant|texte|empreinte(n−1)" )
// Une ligne modifiée ne correspond plus à son empreinte : ça se voit.
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#ifndef JOURNAL_H
#define JOURNAL_H

#include <stdint.h>

const int JOURNAL_TAILLE = 64;        // lignes gardées en mémoire
const int JOURNAL_TEXTE_MAX = 96;     // caractères par ligne

struct LigneJournal {
  uint32_t n;
  int32_t tMs;
  char texte[JOURNAL_TEXTE_MAX];
  char precedente[65];                // empreinte de la ligne d'avant (hexa)
  char empreinte[65];
};
// Mémoire : 64 × (4 + 4 + 96 + 65 + 65) ≈ 15 Ko (le nRF52840 a 256 Ko).

struct JournalSecurise {
  LigneJournal lignes[JOURNAL_TAILLE];
  int nb;
  uint32_t suivant;
  char ancre[65];                     // empreinte de la dernière ligne oubliée
};

void creerJournalSecurise(JournalSecurise* j);
void journalAjouter(JournalSecurise* j, int32_t tMs, const char* texte);
// -1 si tout est intact, sinon l'indice de la première ligne fausse.
int journalVerifier(const JournalSecurise* j);

#endif
