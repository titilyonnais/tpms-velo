// =====================================================================
// liaison.cpp — Côté boîtier de la liaison avec l'application
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/liaison.js
// (sans la partie « pile BLE simulée », remplacée par la vraie pile
// Bluefruit : voir la correspondance dans liaison.h)
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "liaison.h"
#include "boitier.h"
#include <stdio.h>
#include <string.h>

void creerLiaison(Liaison* l) {
  l->connecte = false;
  l->appaire = false;
  l->code[0] = '\0';
  l->codeJusquaMs = 0;
  l->essais = 0;
  l->bloqueJusquaMs = 0;
  l->sequence = 0;
}

bool liaisonBloquee(const Boitier* b, int32_t maintenantMs) {
  return maintenantMs < b->liaison.bloqueJusquaMs;
}

bool liaisonDemandeCode(Boitier* b, const char* code6chiffres, int32_t maintenantMs) {
  Liaison* l = &b->liaison;
  if (liaisonBloquee(b, maintenantMs)) return false;
  // Dans le simulateur, le code est tiré par Math.random. Ici, c'est la
  // pile BLE du nRF52840 qui le tire avec son générateur aléatoire matériel.
  memcpy(l->code, code6chiffres, 6);
  l->code[6] = '\0';
  l->codeJusquaMs = maintenantMs + CODE_DUREE_MS;
  b->ecranUrgent = true;
  boitierJournal(b, maintenantMs, "Demande d'appairage : code affiché à l'écran");
  return true;
}

bool liaisonEchecAppairage(Boitier* b, int32_t maintenantMs) {
  Liaison* l = &b->liaison;
  char texte[64];
  l->essais++;
  snprintf(texte, sizeof(texte), "Code d'appairage faux (%u/%u)",
           (unsigned)l->essais, (unsigned)CODE_ESSAIS_MAX);
  boitierJournal(b, maintenantMs, texte);
  // La tentative est terminée : le code affiché ne sert plus.
  l->code[0] = '\0';
  b->ecranUrgent = true;
  if (l->essais >= CODE_ESSAIS_MAX) {
    l->bloqueJusquaMs = maintenantMs + CODE_BLOCAGE_MS;
    l->essais = 0;
    boitierJournal(b, maintenantMs, "Appairage bloqué 1 min (trop d'essais)");
    return true;
  }
  return false;
}

void liaisonSecurisee(Boitier* b, int32_t maintenantMs) {
  Liaison* l = &b->liaison;
  // Si un code était affiché, c'est un NOUVEL appairage ; sinon c'est un
  // téléphone déjà appairé qui revient (la pile a retrouvé sa clé).
  bool nouvelAppairage = (l->code[0] != '\0');
  l->code[0] = '\0';
  l->essais = 0;
  l->appaire = true;
  l->connecte = true;
  b->ecranUrgent = true;
  boitierJournal(b, maintenantMs,
    nouvelAppairage ? "Téléphone appairé, lien chiffré" : "App connectée (lien chiffré)");
}

void liaisonDeconnexion(Boitier* b, int32_t maintenantMs) {
  // Une déconnexion pendant l'appairage rend le code inutile.
  if (b->liaison.code[0] != '\0') {
    b->liaison.code[0] = '\0';
    b->ecranUrgent = true;
  }
  if (!b->liaison.connecte) return;
  b->liaison.connecte = false;
  b->ecranUrgent = true;
  boitierJournal(b, maintenantMs, "App déconnectée");
}

void liaisonOublier(Boitier* b, int32_t maintenantMs) {
  b->liaison.appaire = false;
  liaisonDeconnexion(b, maintenantMs);
}

bool liaisonMesures(Boitier* b, int32_t maintenantMs, uint8_t* o) {
  if (!b->liaison.connecte) return false;
  Vue vue;
  boitierVue(b, maintenantMs, &vue);
  MesuresApp mesures;
  mesures.roues[POS_AV] = vue.roues[POS_AV];
  mesures.roues[POS_AR] = vue.roues[POS_AR];
  mesures.vitesseKmh = vue.vitesseKmh;
  mesures.distanceKm = vue.distanceKm;
  mesures.batterieBoitierPct = vue.batterieBoitierPct;
  mesures.veille = vue.veille;
  mesures.enCharge = vue.enCharge;
  mesures.eclairage = vue.eclairage;
  mesures.sequence = b->liaison.sequence;
  b->liaison.sequence = (uint16_t)(b->liaison.sequence + 1);   // repasse à 0 après 65535
  encoderMesures(&mesures, o);
  return true;
}

bool liaisonLireReglages(const Boitier* b, uint8_t* o) {
  if (!b->liaison.connecte || !b->liaison.appaire) return false;
  encoderReglages(&b->reglages, o);
  return true;
}

const char* liaisonEcrireReglages(Boitier* b, const uint8_t* octets, int longueur, int32_t maintenantMs) {
  if (!b->liaison.connecte || !b->liaison.appaire) return "refuse";

  // On décode dans une COPIE des réglages : rien n'est modifié tant que
  // tout n'a pas été vérifié.
  Reglages r = b->reglages;
  if (!decoderReglages(octets, longueur, &r)) return "format invalide";
  const char* probleme = verifierReglages(&r);
  if (probleme[0] != '\0') {
    char texte[96];
    snprintf(texte, sizeof(texte), "Réglages refusés : %s", probleme);
    boitierJournal(b, maintenantMs, texte);
    return probleme;
  }
  // Si on change de capteur, on oublie tout ce qu'on savait de l'ancien.
  for (int i = 0; i < NB_ROUES; i++) {
    if (memcmp(r.appairage.adresse[i], b->reglages.appairage.adresse[i], TAILLE_ADRESSE) != 0) {
      creerRoue(&b->roues[i]);
    }
  }
  b->reglages.circonferenceMm = r.circonferenceMm;
  b->compteur.circonferenceMm = r.circonferenceMm;
  b->reglages.seuils.roue[POS_AV] = r.seuils.roue[POS_AV];
  b->reglages.seuils.roue[POS_AR] = r.seuils.roue[POS_AR];
  b->reglages.delaiVeilleMs = r.delaiVeilleMs;
  b->reglages.protections = r.protections;
  b->reglages.appairage = r.appairage;
  b->ecranUrgent = true;
  boitierJournal(b, maintenantMs, "Réglages reçus de l'app");
  return "ok";
}

const char* liaisonCommande(Boitier* b, uint8_t octet, int32_t maintenantMs) {
  if (!b->liaison.connecte || !b->liaison.appaire) return "refuse";
  if (octet == COMMANDE_RAZ_TRAJET) {
    boitierBouton(b, 1, true, maintenantMs);
    return "ok";
  }
  if (octet == COMMANDE_ACQUITTER) {
    boitierBouton(b, 2, true, maintenantMs);
    return "ok";
  }
  return "commande inconnue";
}
