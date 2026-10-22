// =====================================================================
// alertes.cpp — État de chaque pneu
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/alertes.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "alertes.h"
#include "boitier.h"    // pour connaître le contenu de la structure Roue

void seuilsParDefaut(Seuils* s) {
  s->roue[POS_AV].basBar = 1.8f;
  s->roue[POS_AV].hautBar = 3.2f;
  s->roue[POS_AR].basBar = 2.0f;
  s->roue[POS_AR].hautBar = 3.4f;
  s->crevaisonBar = 0.5f;
  s->fuiteBarH = -0.15f;
  s->delaiPerteMs = 60000;   // en roulant : 1 min sans trame = capteur perdu
  // À l'arrêt, un capteur n'annonce plus qu'une fois par minute et le
  // boîtier n'écoute que 40 % du temps : 1 min donnait de fausses alertes
  // (défaut révélé par la simulation). 4 min à l'arrêt.
  s->delaiPerteArretMs = 240000;
}

Etat evaluerRoue(const Roue* roue, Position position, const Seuils* seuils,
                 int32_t maintenantMs, int32_t ecouteDepuisMs, bool enMouvement) {
  if (roue->intrusionJusquaMs > maintenantMs) return ETAT_INTRUSION;
  if (!roue->aMesure) return ETAT_ATTENTE;

  // Math.max(roue.dernierRecuMs, ecouteDepuisMs)
  int32_t depuisMs = (roue->dernierRecuMs > ecouteDepuisMs) ? roue->dernierRecuMs : ecouteDepuisMs;
  int32_t silenceMs = maintenantMs - depuisMs;
  int32_t delaiPerte = enMouvement ? seuils->delaiPerteMs : seuils->delaiPerteArretMs;
  if (silenceMs > delaiPerte) return ETAT_PERDU;

  float p = roue->mesure.pressionBar;
  if (p < seuils->crevaisonBar || roue->mesure.alarme == 0x01) return ETAT_CREVAISON;
  if (p < seuils->roue[position].basBar) return ETAT_BASSE;
  if (p > seuils->roue[position].hautBar) return ETAT_HAUTE;
  if (roue->penteBarH < seuils->fuiteBarH) return ETAT_FUITE;
  return ETAT_OK;
}

bool estAlerte(Etat etat) {
  return etat != ETAT_OK && etat != ETAT_ATTENTE;
}

const char* texteEtat(Etat etat) {
  switch (etat) {
    case ETAT_ATTENTE:   return "EN ATTENTE";
    case ETAT_INTRUSION: return "SIGNAL SUSPECT";
    case ETAT_PERDU:     return "CAPTEUR PERDU";
    case ETAT_CREVAISON: return "CREVAISON";
    case ETAT_BASSE:     return "PRESSION BASSE";
    case ETAT_HAUTE:     return "PRESSION HAUTE";
    case ETAT_FUITE:     return "FUITE LENTE";
    default:             return "OK";
  }
}
