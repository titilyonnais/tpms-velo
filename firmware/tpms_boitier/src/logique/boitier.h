// =====================================================================
// boitier.h — Le « cerveau » du boîtier de guidon
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/boitier.js
// LOGIQUE PURE : aucun appel Arduino. C'est tpms_boitier.ino qui lit
// l'heure (millis), reçoit la radio et pilote les sorties ; il appelle
// ces fonctions exactement comme le fait le simulateur.
//
// Le boîtier :
//   - écoute la radio BLE par fenêtres (pas en continu, pour économiser) ;
//   - décode les trames des capteurs appairés ;
//   - compte les tours de roue (vitesse, distance) ;
//   - évalue l'état des pneus et déclenche bip + LED ;
//   - redessine l'écran, seulement si l'image a changé ;
//   - dialogue avec l'application du téléphone (voir liaison.h) ;
//   - se met en veille quand le vélo ne roule plus.
//
// Le temps lui est toujours donné en paramètre (maintenantMs) : dans
// le simulateur c'est l'horloge simulée, dans le firmware c'est millis().
// =====================================================================
#ifndef BOITIER_H
#define BOITIER_H

#include <stdint.h>
#include "trame.h"
#include "vitesse.h"
#include "fuite.h"
#include "securite.h"
#include "alertes.h"
#include "protocole.h"
#include "vue.h"
#include "epaper.h"
#include "liaison.h"

// Un rafraîchissement complet (écran qui clignote noir/blanc) toutes les
// 20 mises à jour partielles, pour effacer les traces ("ghosting").
const int PARTIELS_AVANT_COMPLET = 20;

// La pression affichée ne change que si l'écart dépasse 0,03 bar.
// Sans cela, le bruit du capteur (±0,01 bar) ferait redessiner l'écran
// à chaque trame, pour rien.
const float HYSTERESIS_AFFICHAGE_BAR = 0.03f;

struct Roue {
  bool aMesure;                 // false = aucune trame (en JS : mesure null)
  Mesure mesure;                // dernière trame décodée
  bool pressionAfficheeConnue;  // (en JS : pressionAffichee null)
  float pressionAffichee;       // valeur montrée à l'écran (avec hystérésis)
  int32_t dernierRecuMs;        // -1 = jamais
  uint32_t nbTrames;
  Historique historique;
  float penteBarH;
  Etat etat;
  bool acquittee;               // alerte acquittée par appui long
  Verification verification;    // protection « vraisemblance »
  Rythme rythme;                // protection « rythme »
  int32_t intrusionJusquaMs;    // fin du « signal suspect » (-1 = aucun)
};

struct Stats {
  uint32_t tramesAcceptees;
  uint32_t tramesInconnues;
  uint32_t tramesInvalides;
  uint32_t tramesManquees;
  uint32_t rejetsVraisemblance;   // trames en attente de confirmation ou hors limites
  uint32_t rejetsRythme;          // trames reçues pendant un « signal suspect »
  uint32_t intrusions;
  uint32_t rafraichissementsPartiels;
  uint32_t rafraichissementsComplets;
};

// Les messages du journal. En JS ils sont rangés dans un tableau ; en C
// on appelle une fonction fournie par le programme principal, qui les
// écrit sur le port série (Serial.println). 0 = pas de journal.
typedef void (*FonctionJournal)(int32_t tMs, const char* texte);

struct Boitier {
  Reglages reglages;
  Roue roues[NB_ROUES];
  Compteur compteur;
  int page;
  bool eclairage;
  bool veille;
  int32_t dernierMouvementMs;
  int32_t ecouteDepuisMs;
  float batteriePct;
  bool enCharge;
  bool bipDemande;
  Ecran ecran;              // image en préparation
  Ecran ecranAffiche;       // image réellement sur l'écran
  int partielsDepuisComplet;
  int32_t dernierDessinMs;
  bool ecranUrgent;         // redessiner sans attendre (bouton, alerte...)
  Liaison liaison;          // dialogue avec l'application
  Stats stats;
  FonctionJournal journal;
};

// Ce qu'il est advenu d'une trame (en JS : un texte).
enum Resultat {
  RESULTAT_ACCEPTEE,       // "acceptee"
  RESULTAT_RADIO_COUPEE,   // "radio-coupee"
  RESULTAT_INVALIDE,       // "invalide"
  RESULTAT_INCONNUE,       // "inconnue"
  RESULTAT_INTRUSION,      // "intrusion"
  RESULTAT_HORS_LIMITES,   // "hors-limites"
  RESULTAT_SUSPECTE        // "suspecte"
};
const char* texteResultat(Resultat r);

enum LedAlerte { LED_ETEINTE, LED_CLIGNOTE, LED_FIXE };
enum Rafraichissement { RAFRAICHISSEMENT_AUCUN, RAFRAICHISSEMENT_PARTIEL, RAFRAICHISSEMENT_COMPLET };

// Les sorties à piloter, retournées par boitierMiseAJour.
struct Sorties {
  LedAlerte ledAlerte;
  bool bip;
  bool ledsEclairage;
  bool radio;
  bool appConnectee;
  Rafraichissement rafraichissement;
};

void creerRoue(Roue* roue);

// Remplit "b" avec l'état de départ (réglages par défaut).
void creerBoitier(Boitier* b);

void boitierJournal(Boitier* b, int32_t maintenantMs, const char* texte);

// La radio écoute-t-elle à cet instant ?
// Elle est allumée pendant les fenetreMs premières millisecondes de
// chaque période, et coupée en veille.
bool boitierEcoute(const Boitier* b, int32_t maintenantMs);

// Une annonce BLE a été reçue. Elle traverse les protections dans
// l'ordre ; la première qui la refuse l'arrête.
Resultat boitierRecevoirTrame(Boitier* b, const uint8_t* octets, int longueur, int32_t maintenantMs);

void boitierReveiller(Boitier* b, int32_t maintenantMs, const char* raison);

// L'aimant passe devant le reed.
bool boitierTopRoue(Boitier* b, int32_t maintenantMs);

// Boutons :
//   bouton 1 court : changer de page    | long : remise à zéro du trajet
//   bouton 2 court : éclairage on/off   | long : acquitter les alertes
// En veille, un appui ne fait que réveiller le boîtier.
void boitierBouton(Boitier* b, int numero, bool appuiLong, int32_t maintenantMs);

// Les valeurs à afficher, préparées pour ecran.cpp.
void boitierVue(const Boitier* b, int32_t maintenantMs, Vue* vue);
void vueRoue(const Roue* roue, VueRoue* vue);

// Appelée une fois par seconde.
// Retourne les sorties à piloter : LED d'alerte, bip, LED d'éclairage,
// et le type de rafraîchissement d'écran à effectuer.
Sorties boitierMiseAJour(Boitier* b, int32_t maintenantMs);

#endif
