// =====================================================================
// fuite.cpp — Détection de fuite lente
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/fuite.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "fuite.h"

void creerHistorique(Historique* h) {
  historiqueVider(h);
}

void historiqueVider(Historique* h) {
  h->n = 0;
}

// En JS, "shift()" enlève la première case d'un tableau.
// En C, on décale toutes les cases d'un cran vers le début.
static void historiqueOublierPlusAncienne(Historique* h) {
  for (int i = 0; i < h->n - 1; i++) {
    h->tMs[i] = h->tMs[i + 1];
    h->pression[i] = h->pression[i + 1];
  }
  h->n--;
}

bool historiqueAjouter(Historique* h, int32_t tMs, float pressionBar) {
  int n = h->n;
  if (n > 0) {
    if (tMs - h->tMs[n - 1] < HISTO_ECART_MS) return false;
    // Une forte hausse veut dire que le cycliste a regonflé :
    // l'ancienne courbe n'a plus de sens, on repart de zéro.
    if (pressionBar - h->pression[n - 1] > HISTO_SAUT_REGONFLAGE) {
      historiqueVider(h);
    }
  }
  // Le JS ajoute puis enlève la plus ancienne s'il y en a 41.
  // En C le tableau ne peut pas dépasser 40 cases : on fait de la
  // place AVANT d'ajouter. Le résultat est le même.
  if (h->n >= HISTO_TAILLE) {
    historiqueOublierPlusAncienne(h);
  }
  h->tMs[h->n] = tMs;
  h->pression[h->n] = pressionBar;
  h->n++;
  return true;
}

//   pente = Σ (t - tMoyen)(p - pMoyen) / Σ (t - tMoyen)²
float historiquePenteBarH(const Historique* h) {
  int n = h->n;
  if (n < 5) return 0.0f;
  if (h->tMs[n - 1] - h->tMs[0] < HISTO_DUREE_MIN_MS) return 0.0f;
  return penteMoindresCarresParHeure(h->tMs, h->pression, n);
}

float penteMoindresCarresParHeure(const int32_t* tMs, const float* valeurs, int n) {
  if (n < 2) return 0.0f;

  // On travaille en heures, comptées depuis le premier point.
  // Cela évite de manipuler de très grands nombres : un float n'a que
  // 7 chiffres significatifs environ.
  int32_t t0 = tMs[0];
  float sommeT = 0.0f, sommeP = 0.0f;
  for (int i = 0; i < n; i++) {
    sommeT += (tMs[i] - t0) / 3600000.0f;
    sommeP += valeurs[i];
  }
  float tMoyen = sommeT / n;
  float pMoyen = sommeP / n;

  float numerateur = 0.0f, denominateur = 0.0f;
  for (int j = 0; j < n; j++) {
    float dt = (tMs[j] - t0) / 3600000.0f - tMoyen;
    numerateur += dt * (valeurs[j] - pMoyen);
    denominateur += dt * dt;
  }
  if (denominateur == 0.0f) return 0.0f;
  return numerateur / denominateur;
}

// Traduction de TPMS.pressionCompenseeBar (logique/fuite.js).
float pressionCompenseeBar(float pressionRelBar, float temperatureC) {
  float absolue = pressionRelBar + 1.01325f;
  return absolue * 293.15f / (temperatureC + 273.15f) - 1.01325f;
}
