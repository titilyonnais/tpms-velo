// =====================================================================
// journal.cpp — Journal de sécurité chaîné
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/journal.js
// =====================================================================
#include "journal.h"
#include "sha256.h"
#include <stdio.h>
#include <string.h>

static const char EMPREINTE_ZERO[] = "0000000000000000000000000000000000000000000000000000000000000000";

static void empreinteLigne(uint32_t n, int32_t tMs, const char* texte, const char* precedente, char* sortie) {
  char message[256];
  int longueur = snprintf(message, sizeof(message), "%lu|%ld|%s|%s", (unsigned long)n, (long)tMs, texte, precedente);
  if (longueur > (int)sizeof(message) - 1) longueur = sizeof(message) - 1;
  uint8_t h[32];
  sha256((const uint8_t*)message, longueur, h);
  enHexa(h, 32, sortie);
}

void creerJournalSecurise(JournalSecurise* j) {
  j->nb = 0;
  j->suivant = 0;
  strcpy(j->ancre, EMPREINTE_ZERO);
}

void journalAjouter(JournalSecurise* j, int32_t tMs, const char* texte) {
  // Mémoire pleine : on oublie la plus ancienne, en gardant son empreinte.
  if (j->nb >= JOURNAL_TAILLE) {
    strcpy(j->ancre, j->lignes[0].empreinte);
    memmove(&j->lignes[0], &j->lignes[1], sizeof(LigneJournal) * (JOURNAL_TAILLE - 1));
    j->nb--;
  }
  LigneJournal* l = &j->lignes[j->nb];
  l->n = j->suivant++;
  l->tMs = tMs;
  strncpy(l->texte, texte, JOURNAL_TEXTE_MAX - 1);
  l->texte[JOURNAL_TEXTE_MAX - 1] = '\0';
  strcpy(l->precedente, j->nb > 0 ? j->lignes[j->nb - 1].empreinte : j->ancre);
  empreinteLigne(l->n, l->tMs, l->texte, l->precedente, l->empreinte);
  j->nb++;
}

int journalVerifier(const JournalSecurise* j) {
  const char* attendue = j->ancre;
  char calcul[65];
  for (int i = 0; i < j->nb; i++) {
    const LigneJournal* l = &j->lignes[i];
    if (strcmp(l->precedente, attendue) != 0) return i;
    empreinteLigne(l->n, l->tMs, l->texte, l->precedente, calcul);
    if (strcmp(calcul, l->empreinte) != 0) return i;
    attendue = l->empreinte;
  }
  return -1;
}
