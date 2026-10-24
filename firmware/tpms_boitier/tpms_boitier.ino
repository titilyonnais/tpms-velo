// =====================================================================
// tpms_boitier.ino — Programme du boîtier de guidon (XIAO nRF52840)
// ---------------------------------------------------------------------
// Projet BTS CIEL – Capteur de pression des pneus de vélo (TPMS)
// Thibault MORRETTON – Épreuve E6
//
// Même organisation que le simulateur :
//   src/logique/  la logique PURE, traduite fidèlement des fichiers JS
//                 testés dans le simulateur (aucun appel Arduino dedans) ;
//   src/materiel/ les « sources de données » et les « sorties » réelles :
//                 radio BLE, écran, reed, boutons, LED, buzzer, batterie,
//                 veille, mémoire flash.
// Ce fichier ne fait que relier les deux, comme simulateur/app.js relie
// la logique aux curseurs et au dessin de la page web.
//
// Une boucle loop() toutes les 10 ms :
//   1. transmettre à la logique ce qui est arrivé (tops de roue, boutons,
//      trames des capteurs, événements de l'application) ;
//   2. ouvrir ou fermer la fenêtre d'écoute radio ;
//   3. une fois par seconde, boitierMiseAJour → LED, bip, écran ;
//   4. toutes les 5 s, notification MESURES vers l'application ;
//   5. si la logique a décidé la veille : System OFF.
// =====================================================================
#include "config.h"
#include "src/logique/boitier.h"
#include "src/logique/ecran.h"
#include "src/logique/tests_logique.h"
#include "src/materiel/batterie.h"
#include "src/materiel/capteurs_ble.h"
#include "src/materiel/barometre_bmp280.h"
#include "src/materiel/ecran_epaper.h"
#include "src/materiel/entrees.h"
#include "src/materiel/liaison_ble.h"
#include "src/materiel/sorties.h"
#include "src/materiel/stockage.h"
#include "src/materiel/veille.h"

// Tout l'état du boîtier (≈ 11 Ko), réservé une fois pour toutes :
// aucune allocation de mémoire pendant le fonctionnement.
Boitier b;

int32_t derniereMajMs = 0;
int32_t dernieresMesuresMs = 0;
int32_t derniereBatterieMs = 0;
int32_t dernierBaroMs = 0;
bool vbusPrecedent = false;   // le 5 V du chargeur était-il là au tour précédent ?

// Mesure du baromètre, transmise à la logique.
void lireBarometre(int32_t t) {
  float pressionHpa = 0.0f, temperatureC = 0.0f;
  bool ok = barometreLire(&pressionHpa, &temperatureC);
  boitierBarometre(&b, ok, pressionHpa, temperatureC, t);
}

// Le 5 V du chargeur est-il présent sur la carte (VBUS du nRF52840) ?
// Avec la pile radio active, le registre se lit par le SoftDevice.
bool vbusPresent() {
  uint32_t etat = 0;
  sd_power_usbregstatus_get(&etat);
  return (etat & POWER_USBREGSTATUS_VBUSDETECT_Msk) != 0;
}

// L'heure en ms depuis le démarrage, en entier signé (voir vitesse.h).
int32_t maintenant() {
  return (int32_t)millis();
}

// Journal de la logique → moniteur série. Exemple :
//   T+ 0:12:05  AV : PRESSION BASSE
void journalSerie(int32_t tMs, const char* texte) {
  char duree[16];
  dureeEnTexte(tMs / 1000.0f, duree);
  Serial.print("T+ ");
  Serial.print(duree);
  Serial.print("  ");
  Serial.println(texte);
}

void afficherLigne(const char* ligne) {
  Serial.println(ligne);
}

void setup() {
  // Plots NFC → broches ordinaires. La toute première fois, la carte
  // redémarre ici une fois toute seule (c'est normal).
  nfcLibererBroches();

  Serial.begin(115200);

  // Cause du démarrage : à lire AVANT Bluefruit.begin().
  char raison[48];
  bool parChargeur = false;
  veilleRaisonDemarrage(raison, &parChargeur);

#if AUTOTEST
  // On laisse 2 s au moniteur série pour s'ouvrir, puis on rejoue les
  // tests du simulateur sur la carte.
  while (!Serial && millis() < 2000) delay(10);
  Serial.println("=== Tests de la logique (traduction de simulateur/tests/tests.js) ===");
  lancerTestsLogique(afficherLigne);
#endif

  // L'état de départ, puis les réglages et le trajet sauvegardés.
  creerBoitier(&b);
  b.journal = journalSerie;
  boitierJournal(&b, maintenant(), raison);
  stockageDemarrer();
  if (stockageCharger(&b)) {
    boitierJournal(&b, maintenant(), "Réglages et trajet relus en mémoire flash");
  } else {
    boitierJournal(&b, maintenant(), "Pas de sauvegarde : réglages par défaut");
  }

  sortiesDemarrer();
  entreesDemarrer();
  batterieDemarrer();
  batterieLire(&b, true);
  ecranDemarrer();
  if (!barometreDemarrer()) boitierJournal(&b, maintenant(), "BMP280 absent : pas de correction d'altitude");
  liaisonBleDemarrer(&b);   // Bluefruit.begin() est appelé ici
  capteursDemarrer();

  // Bouton 1 tenu 5 s au démarrage : on oublie les téléphones appairés
  // (par exemple avant de prêter ou vendre le vélo).
  if (entreesOubliDemande()) {
    liaisonBleOublierTelephones(&b, maintenant());
  }

  // Comme après un réveil dans le simulateur : la veille est finie,
  // on recommence à compter l'immobilité à partir de maintenant.
  int32_t t = maintenant();
  b.dernierMouvementMs = t;
  b.ecouteDepuisMs = t;
  derniereMajMs = t - PERIODE_MAJ_MS;   // première mise à jour tout de suite
  dernieresMesuresMs = t;
  derniereBatterieMs = t;
  // Première mesure du baromètre tout de suite : la correction d'altitude
  // et l'autorisation de recharge sont connues avant la 1re trame.
  lireBarometre(t);
  dernierBaroMs = t;
  vbusPrecedent = vbusPresent();
  if (parChargeur) boitierChargeurBranche(&b, t);
}

void loop() {
  int32_t t = maintenant();

  // 1. Ce qui est arrivé depuis le dernier tour.
  entreesTraiter(&b, t);         // tops de roue, reed collé, boutons
  capteursTraiter(&b);           // trames TPMS → boitierRecevoirTrame
  liaisonBleTraiter(&b, t);      // connexion, code, réglages, commandes

  // 2. Fenêtre d'écoute radio (2 s toutes les 5 s).
  capteursFenetre(boitierEcoute(&b, t));

  // Baromètre, toutes les 10 s (correction d'altitude, recharge à froid).
  if (t - dernierBaroMs >= PERIODE_BAROMETRE_MS) {
    dernierBaroMs = t;
    lireBarometre(t);
  }

  // Le 5 V du chargeur vient d'apparaître : comme dans le simulateur.
  bool vbus = vbusPresent();
  if (vbus && !vbusPrecedent) boitierChargeurBranche(&b, t);
  vbusPrecedent = vbus;

  // Batterie, toutes les 30 s.
  if (t - derniereBatterieMs >= PERIODE_BATTERIE_MS) {
    derniereBatterieMs = t;
    batterieLire(&b, false);
  }

  // 3. Mise à jour du boîtier, une fois par seconde.
  if (t - derniereMajMs >= PERIODE_MAJ_MS) {
    derniereMajMs = t;
    Sorties s = boitierMiseAJour(&b, t);
    sortiesAppliquer(&s, t);
    if (s.rafraichissement != RAFRAICHISSEMENT_AUCUN) {
      // Peut durer jusqu'à 5 s au froid (pas de fil BUSY, attente fixe) :
      // pendant ce temps, l'interruption du reed,
      // la radio et la tâche des sorties continuent de fonctionner.
      bool complet = s.rafraichissement == RAFRAICHISSEMENT_COMPLET;
      ecranEnvoyer(&b.ecranAffiche, complet, attenteEcranMs(complet, b.baroConnu, b.baroTemperatureC));
    }
    // 5. Veille décidée par la logique : l'écran affiche déjà « VEILLE ».
    if (b.veille) {
      veilleEntrer(&b);          // ne revient jamais (redémarrage au réveil)
    }
  }

  // 4. Notification MESURES pour l'application, toutes les 5 s.
  if (t - dernieresMesuresMs >= PERIODE_MESURES_MS) {
    dernieresMesuresMs = t;
    liaisonBleEnvoyerMesures(&b, t);
  }

  // Dans le cœur Adafruit nRF52, delay() endort le processeur : c'est
  // ce qui ramène la consommation à ~20 µA entre deux tours de boucle.
  delay(PERIODE_BOUCLE_MS);
}
