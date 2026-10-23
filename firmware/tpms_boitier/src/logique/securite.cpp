// =====================================================================
// securite.cpp — Protections contre les faux capteurs
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/securite.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "securite.h"
#include <math.h>
#include <string.h>

const char* const NOM_POSITION[NB_ROUES] = { "AV", "AR" };

void protectionsParDefaut(Protections* p) {
  p->listeBlanche = true;
  p->vraisemblance = true;
  p->rythme = true;
}

// ---------------------------------------------------------------------
// 1. Liste blanche
// ---------------------------------------------------------------------
Position positionCapteur(const Appairage* appairage, const uint8_t* adresse) {
  // memcmp compare deux zones mémoire octet par octet : 0 = identiques.
  if (memcmp(appairage->adresse[POS_AV], adresse, TAILLE_ADRESSE) == 0) return POS_AV;
  if (memcmp(appairage->adresse[POS_AR], adresse, TAILLE_ADRESSE) == 0) return POS_AR;
  return POSITION_AUCUNE;
}

Position positionParNumero(uint8_t numero) {
  if (numero == 1) return POS_AV;
  if (numero == 2) return POS_AR;
  return POSITION_AUCUNE;
}

// ---------------------------------------------------------------------
// 2. Vraisemblance
// ---------------------------------------------------------------------
void creerVerification(Verification* v) {
  v->candidatBar = 0.0f;
  v->nbConfirmations = 0;
}

Verdict verifierVraisemblance(Verification* v, const Mesure* ancienne, int32_t ancienneMs,
                              const Mesure* nouvelle, int32_t maintenantMs,
                              bool confirmationPermise) {
  if (nouvelle->pressionBar > PRESSION_MAX_BAR ||
      nouvelle->temperatureC < TEMPERATURE_MIN_C ||
      nouvelle->temperatureC > TEMPERATURE_MAX_C) {
    return VERDICT_HORS_LIMITES;
  }
  if (ancienne == 0) return VERDICT_OK;   // rien à comparer

  // En cas de doute sur l'émetteur, seules les valeurs quasi identiques
  // à la dernière valeur de confiance passent.
  if (!confirmationPermise &&
      fabsf(nouvelle->pressionBar - ancienne->pressionBar) > ECART_CONFIRMATION_BAR) {
    return VERDICT_SUSPECTE;
  }

  // On divise l'écart par le temps écoulé, compris entre 1 s et 5 s.
  // Pourquoi un plafond ? Avec l'écoute par fenêtres, la radio reste
  // coupée 3 s sur 5 : sans plafond, le silence « dilue » l'écart, et un
  // pirate qui annonce 0,3 bar juste après ce silence passe pour une
  // baisse lente. Avec le plafond, un grand écart doit toujours être
  // confirmé par 3 trames, ce qui laisse au contrôle du rythme le temps
  // de détecter le second émetteur.
  float dtS = fminf(VARIATION_DT_MAX_S, fmaxf(1.0f, (maintenantMs - ancienneMs) / 1000.0f));
  float vitessePression = fabsf(nouvelle->pressionBar - ancienne->pressionBar) / dtS;
  float vitesseTemperature = fabsf(nouvelle->temperatureC - ancienne->temperatureC) / dtS;

  if (vitessePression <= VARIATION_MAX_BAR_S && vitesseTemperature <= VARIATION_MAX_C_S) {
    v->nbConfirmations = 0;
    return VERDICT_OK;
  }

  // Changement brutal : on attend une confirmation.
  if (v->nbConfirmations > 0 &&
      fabsf(nouvelle->pressionBar - v->candidatBar) < ECART_CONFIRMATION_BAR) {
    v->nbConfirmations++;
  } else {
    v->candidatBar = nouvelle->pressionBar;
    v->nbConfirmations = 1;
  }
  if (v->nbConfirmations >= CONFIRMATIONS && confirmationPermise) {
    v->nbConfirmations = 0;
    return VERDICT_CONFIRMEE;
  }
  return VERDICT_SUSPECTE;
}

// ---------------------------------------------------------------------
// 3. Rythme
// ---------------------------------------------------------------------
void creerRythme(Rythme* r) {
  r->dernierMs = -1;
  r->dernierePressionBar = -1.0f;
  r->nbAnomalies = 0;
}

// Enlève la plus ancienne anomalie (équivalent de shift() en JS).
static void rythmeOublierPlusAncienne(Rythme* r) {
  for (int i = 0; i < r->nbAnomalies - 1; i++) {
    r->anomaliesMs[i] = r->anomaliesMs[i + 1];
  }
  r->nbAnomalies--;
}

bool controlerRythme(Rythme* r, int32_t maintenantMs, float pressionBar) {
  bool connue = pressionBar >= 0.0f && r->dernierePressionBar >= 0.0f;
  bool descente = connue && pressionBar < r->dernierePressionBar - RYTHME_DESCENTE_BAR;
  if (r->dernierMs >= 0 && maintenantMs - r->dernierMs < RYTHME_MIN_MS && !descente) {
    // Le tableau est vidé dès qu'il est plein (voir plus bas) : il
    // reste donc toujours de la place. Le test est une simple sécurité.
    if (r->nbAnomalies < RYTHME_ANOMALIES_MAX) {
      r->anomaliesMs[r->nbAnomalies] = maintenantMs;
      r->nbAnomalies++;
    }
  }
  r->dernierMs = maintenantMs;
  if (pressionBar >= 0.0f) r->dernierePressionBar = pressionBar;
  // On oublie les anomalies de plus d'une minute.
  while (r->nbAnomalies > 0 && maintenantMs - r->anomaliesMs[0] > RYTHME_FENETRE_MS) {
    rythmeOublierPlusAncienne(r);
  }
  if (r->nbAnomalies >= RYTHME_ANOMALIES_MAX) {
    r->nbAnomalies = 0;
    return true;
  }
  return false;
}

bool rythmeDouteux(const Rythme* r) {
  return r->nbAnomalies > 0;
}
