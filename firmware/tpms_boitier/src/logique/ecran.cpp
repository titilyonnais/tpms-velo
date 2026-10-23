// =====================================================================
// ecran.cpp — Mise en page de l'écran du boîtier
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/ecran.js
// LOGIQUE PURE : aucun appel Arduino.
//
// En JS, on fabrique les textes en les additionnant :
//     Math.round(t) + "°C"
// En C, on les écrit dans un petit tableau de caractères avec snprintf
// (pour les entiers) ou nombreEnTexte (pour les nombres à virgule,
// équivalent de toFixed, voir outils.h).
// =====================================================================
#include "ecran.h"
#include "alertes.h"
#include "fuite.h"
#include "outils.h"
#include "police5x7.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

void dessinerEcran(Ecran* e, const Vue* vue) {
  ecranEffacer(e);

  // ---- Barre d'état ----
  ecranTexte(e, 3, 3, "TPMS", 1, NOIR);
  if (vue->veille) {
    ecranTexte(e, 34, 3, "VEILLE", 1, NOIR);
  } else if (vue->eclairage) {
    ecranTexte(e, 34, 3, "ECLAIRAGE", 1, NOIR);
  }
  if (vue->appConnectee) ecranTexte(e, 94, 3, "APP", 1, NOIR);
  dessinerBatterie(e, vue->batterieBoitierPct, vue->enCharge);
  ecranLigneH(e, 0, 14, 200, NOIR);

  // ---- Les deux roues ----
  dessinerRoue(e, 0, 100, "AVANT", &vue->roues[POS_AV]);
  ecranLigneV(e, 100, 15, 105, NOIR);
  dessinerRoue(e, 101, 99, "ARRIERE", &vue->roues[POS_AR]);
  ecranLigneH(e, 0, 120, 200, NOIR);

  // ---- Bas de l'écran : deux pages au choix (bouton 1) ----
  if (vue->page == 0) {
    dessinerPageVitesse(e, vue);
  } else {
    dessinerPageTrajet(e, vue);
  }

  // ---- Code d'appairage, par-dessus tout le reste ----
  if (vue->codeAppairage[0] != '\0') dessinerCodeAppairage(e, vue->codeAppairage);
}

void dessinerCodeAppairage(Ecran* e, const char* code) {
  ecranRectPlein(e, 14, 52, 172, 96, BLANC);
  ecranCadre(e, 14, 52, 172, 96, NOIR);
  ecranCadre(e, 16, 54, 168, 92, NOIR);
  ecranTexteCentre(e, 100, 64, "APPAIRAGE", 2, NOIR);
  ecranTexteCentre(e, 100, 90, code, 3, NOIR);
  ecranTexteCentre(e, 100, 126, "A SAISIR SUR LE TELEPHONE", 1, NOIR);
}

void dessinerBatterie(Ecran* e, float pct, bool enCharge) {
  char texte[16];
  snprintf(texte, sizeof(texte), "%s%ld%%", enCharge ? "CHG " : "", (long)arrondi(pct));
  ecranTexteDroite(e, 172, 3, texte, 1, NOIR);
  ecranCadre(e, 176, 3, 18, 9, NOIR);
  ecranRectPlein(e, 194, 5, 2, 5, NOIR);              // le "téton" de la pile
  ecranRectPlein(e, 178, 5, arrondi(14.0f * pct / 100.0f), 5, NOIR);
}

void dessinerRoue(Ecran* e, int x0, int largeur, const char* nom, const VueRoue* roue) {
  int centre = x0 + largeur / 2;

  ecranTexteCentre(e, centre, 20, nom, 2, NOIR);

  char pression[16];
  if (!roue->connue) {
    strcpy(pression, "-.--");
  } else {
    nombreEnTexte(roue->pressionBar, 2, pression);
  }
  ecranTexteCentre(e, centre, 40, pression, 4, NOIR);
  ecranTexteCentre(e, centre, 72, "bar", 1, NOIR);

  if (roue->connue) {
    char texte[24];
    // DEGRE est le caractère 127 (voir police5x7.h) : "21" DEGRE "C" → 21°C
    snprintf(texte, sizeof(texte), "%ld" DEGRE "C", (long)arrondi(roue->temperatureC));
    ecranTexte(e, x0 + 5, 86, texte, 1, NOIR);
    snprintf(texte, sizeof(texte), "PILE %u%%", (unsigned)roue->batteriePct);
    ecranTexteDroite(e, x0 + largeur - 5, 86, texte, 1, NOIR);
  }

  ecranTexteCentre(e, centre, 102, texteEtat(roue->etat), 1, NOIR);

  // En alerte, toute la colonne passe en négatif (fond noir, texte blanc).
  if (estAlerte(roue->etat)) {
    ecranInverser(e, x0, 15, largeur, 105);
  }
}

void dessinerPageVitesse(Ecran* e, const Vue* vue) {
  char texte[16];
  nombreEnTexte(vue->vitesseKmh, 1, texte);
  ecranTexteDroite(e, 100, 128, texte, 4, NOIR);
  ecranTexte(e, 108, 142, "km/h", 2, NOIR);

  nombreEnTexte(vue->distanceKm, vue->distanceKm < 100.0f ? 2 : 1, texte);
  ecranTexte(e, 4, 177, "DIST", 1, NOIR);
  ecranTexteDroite(e, 100, 172, texte, 2, NOIR);
  ecranTexte(e, 108, 172, "km", 2, NOIR);
}

void dessinerPageTrajet(Ecran* e, const Vue* vue) {
  char texte[32];
  ecranTexte(e, 4, 126, "MOY", 2, NOIR);
  nombreEnTexte(vue->moyenneKmh, 1, texte);
  ecranTexteDroite(e, 130, 126, texte, 2, NOIR);
  ecranTexte(e, 136, 133, "km/h", 1, NOIR);

  ecranTexte(e, 4, 146, "MAX", 2, NOIR);
  nombreEnTexte(vue->maxKmh, 1, texte);
  ecranTexteDroite(e, 130, 146, texte, 2, NOIR);
  ecranTexte(e, 136, 153, "km/h", 1, NOIR);

  ecranTexte(e, 4, 166, "TPS", 2, NOIR);
  dureeEnTexte(vue->dureeRoulageS, texte);
  ecranTexteDroite(e, 130, 166, texte, 2, NOIR);

  char distance[16];
  nombreEnTexte(vue->distanceKm, 2, distance);
  snprintf(texte, sizeof(texte), "DISTANCE %s km", distance);
  ecranTexte(e, 4, 182, texte, 1, NOIR);

  // Prévision : dans combien de jours chaque pneu passera sous son seuil bas.
  char av[8], ar[8];
  texteJours(vue->roues[POS_AV].joursRegonflage, av);
  texteJours(vue->roues[POS_AR].joursRegonflage, ar);
  snprintf(texte, sizeof(texte), "REGONFLER AV %s  AR %s", av, ar);
  ecranTexte(e, 4, 192, texte, 1, NOIR);
}

void dureeEnTexte(float secondes, char* texte) {
  long s = (long)floorf(secondes);
  long h = s / 3600;
  long m = (s % 3600) / 60;
  long r = s % 60;
  // %02ld : au moins 2 chiffres, complétés par un zéro (comme le JS).
  snprintf(texte, 16, "%ld:%02ld:%02ld", h, m, r);
}
