// =====================================================================
// entrees.cpp — Reed (capteur de roue) et boutons
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE.
//
// Câblage : reed et boutons entre la broche et GND. Au repos, la
// résistance de tirage (pull-up) maintient la broche à 1 ; un appui ou
// le passage de l'aimant la met à 0.
//
// LE REED, PAR INTERRUPTION
//   À 40 km/h, l'aimant ne reste devant le reed que quelques
//   millisecondes : on ne peut pas se contenter de lire la broche de
//   temps en temps. Une INTERRUPTION se déclenche sur le front
//   descendant (passage de 1 à 0) et note l'heure (millis) du top.
//   La routine d'interruption ne fait RIEN d'autre : elle range l'heure
//   dans une petite file d'attente. C'est loop() qui appelle ensuite
//   boitierTopRoue(). Pourquoi ? La logique modifie le compteur pendant
//   que loop() le lit pour dessiner l'écran : si l'interruption le
//   modifiait au milieu d'un calcul, on pourrait lire une valeur à moitié
//   mise à jour. Avec la file, une seule partie du programme touche à la
//   logique. L'anti-rebond (40 ms) reste fait par la logique (vitesse.cpp).
//
// LE REED « COLLÉ » (aimant arrêté pile devant)
//   Le reed reste fermé : le courant traverse le pull-up interne en
//   permanence (3,3 V / 13 kΩ = 0,25 mA, voir reedColleMa dans
//   energie.js). Parade : après 3 s fermé, on débranche la broche
//   (plus de pull-up, plus d'interruption) ; une fois par seconde on
//   rebranche le pull-up 50 µs pour voir si le reed s'est rouvert.
//
// LES BOUTONS, PAR SCRUTATION (lecture toutes les 10 ms)
//   Un appui humain dure au moins 50 ms : une lecture toutes les 10 ms
//   suffit, pas besoin d'interruption. Anti-rebond : l'état doit rester
//   stable 30 ms. Appui long : 700 ms, signalé SANS attendre le relâché.
//   Les deux boutons sont sur la même broche D5 (échelle de résistances,
//   voir logique/boutons.h) ; « les deux à la fois » se lit « bouton 1 ».
// =====================================================================
#include "entrees.h"
#include "gpio_nrf.h"
#include "../../config.h"
#include "../logique/boutons.h"

// ---------------------------------------------------------------------
// Reed
// ---------------------------------------------------------------------

// File d'attente circulaire remplie par l'interruption, vidée par loop().
// "volatile" : la variable peut changer à tout moment (dans l'interruption),
// le compilateur doit la relire en mémoire à chaque fois.
// Les indices sont des uint8_t qui font le tour (255 + 1 = 0) : la
// différence écrits - lus donne toujours le nombre de tops en attente.
static const uint8_t TAILLE_FILE_TOPS = 32;
static volatile int32_t topsMs[TAILLE_FILE_TOPS];
static volatile uint8_t topsEcrits = 0;
static volatile uint8_t topsLus = 0;

static bool reedColle = false;          // aimant arrêté devant le reed
static int32_t reedFermeDepuisMs = -1;  // -1 = reed ouvert
static int32_t reedDernierSondageMs = 0;

// Routine d'interruption : la plus courte possible.
static void interruptionReed() {
  if ((uint8_t)(topsEcrits - topsLus) >= TAILLE_FILE_TOPS) return;   // file pleine
  topsMs[topsEcrits % TAILLE_FILE_TOPS] = (int32_t)millis();
  topsEcrits = topsEcrits + 1;
}

static void reedModeNormal() {
  pinMode(BROCHE_REED, REED_PULLUP_INTERNE ? INPUT_PULLUP : INPUT);
  attachInterrupt(digitalPinToInterrupt(BROCHE_REED), interruptionReed, FALLING);
  reedColle = false;
  reedFermeDepuisMs = -1;
}

static void reedModeColle(Boitier* b, int32_t maintenantMs) {
  detachInterrupt(digitalPinToInterrupt(BROCHE_REED));
  // Broche débranchée : le pull-up est coupé, plus aucun courant.
  gpioDeconnecter(gpioDepuisArduino(BROCHE_REED));
  reedColle = true;
  reedDernierSondageMs = maintenantMs;
  boitierJournal(b, maintenantMs, "Aimant arrêté devant le reed : pull-up coupé");
}

// Lit le reed en branchant le pull-up un court instant.
static bool reedFermeAvecSondage() {
  pinMode(BROCHE_REED, INPUT_PULLUP);
  delayMicroseconds(50);                 // le temps que la broche remonte
  return digitalRead(BROCHE_REED) == LOW;
}

static void reedSurveiller(Boitier* b, int32_t maintenantMs) {
  if (!REED_PULLUP_INTERNE) return;      // pull-up externe de 1 MΩ : rien à faire

  if (!reedColle) {
    if (digitalRead(BROCHE_REED) == LOW) {
      if (reedFermeDepuisMs < 0) {
        reedFermeDepuisMs = maintenantMs;
      } else if (maintenantMs - reedFermeDepuisMs >= REED_DELAI_COLLE_MS) {
        reedModeColle(b, maintenantMs);
      }
    } else {
      reedFermeDepuisMs = -1;
    }
    return;
  }

  // Reed collé : une vérification par seconde.
  if (maintenantMs - reedDernierSondageMs < REED_SONDAGE_MS) return;
  reedDernierSondageMs = maintenantMs;
  if (reedFermeAvecSondage()) {
    gpioDeconnecter(gpioDepuisArduino(BROCHE_REED));   // toujours collé
  } else {
    reedModeNormal();                                  // l'aimant est parti : la roue tourne
    boitierJournal(b, maintenantMs, "Reed rouvert : retour au mode normal");
  }
}

// ---------------------------------------------------------------------
// Boutons : les deux sur D5 (logique/boutons.h)
// ---------------------------------------------------------------------
// Au repos, D5 est à 1 (tirage interne). Un appui la tire vers 0 : SW1
// directement (0 V), SW2 à travers R12 (≈ 0,5 V). La lecture numérique
// suffit pour savoir s'il y a un appui ; le convertisseur analogique ne
// sert qu'à savoir LEQUEL, et seulement pendant un appui (il consomme
// ≈ 0,7 mA pendant ses quelques dizaines de µs de conversion).
struct Boutons {
  int appuye;                 // bouton appuyé après anti-rebond : 0, 1 ou 2
  int brutPrecedent;          // dernière lecture brute
  int32_t changementMs;       // instant du dernier changement brut
  int32_t debutAppuiMs;
  bool longSignale;           // l'appui long a déjà été transmis
  bool ignorer;               // appui en cours à ne pas compter (celui du réveil)
};

static Boutons boutons;

// 0 (aucun), 1 ou 2.
static int lireBoutons() {
  if (digitalRead(BROCHE_BOUTONS) == HIGH) return 0;
  // Référence = VDD / 4 avec un gain de 1/4 : la pleine échelle vaut VDD,
  // le résultat est donc directement la fraction de VDD (même quand la
  // batterie faiblit et que 3V3 suit VBAT).
  // À VÉRIFIER : AR_VDD4 dans le cœur Seeed/Adafruit, et que analogRead()
  // garde le tirage interne (on le remet par prudence).
  analogReference(AR_VDD4);
  analogReadResolution(12);
  int brut = analogRead(BROCHE_BOUTONS);
  pinMode(BROCHE_BOUTONS, INPUT_PULLUP);
  return boutonDepuisTension(brut / 4095.0f, 1.0f);
}

static void boutonsDemarrer() {
  pinMode(BROCHE_BOUTONS, INPUT_PULLUP);
  delayMicroseconds(50);
  int enfonce = lireBoutons();
  boutons.appuye = enfonce;
  boutons.brutPrecedent = enfonce;
  boutons.changementMs = 0;
  boutons.debutAppuiMs = 0;
  boutons.longSignale = false;
  // Un bouton est déjà enfoncé au démarrage : c'est l'appui qui a
  // réveillé la carte. Comme dans le simulateur (« en veille, un appui
  // ne fait que réveiller »), on ne le compte pas.
  boutons.ignorer = enfonce != 0;
}

static void boutonsLire(Boitier* b, int32_t maintenantMs) {
  int brut = lireBoutons();
  if (brut != boutons.brutPrecedent) {
    boutons.brutPrecedent = brut;
    boutons.changementMs = maintenantMs;
  }

  // Anti-rebond : on n'accepte le nouvel état que s'il dure 30 ms.
  if (brut != boutons.appuye && maintenantMs - boutons.changementMs >= ANTI_REBOND_BOUTON_MS) {
    // Relâché (ou passage direct d'un bouton à l'autre) : appui court,
    // sauf si le long a déjà été signalé.
    if (boutons.appuye != 0 && !boutons.ignorer && !boutons.longSignale) {
      boitierBouton(b, boutons.appuye, false, maintenantMs);
    }
    if (boutons.appuye != 0) boutons.ignorer = false;
    boutons.appuye = brut;
    if (brut != 0) {
      boutons.debutAppuiMs = maintenantMs;      // début d'un appui
      boutons.longSignale = false;
    }
  }

  // Appui long : signalé dès 700 ms, sans attendre qu'on relâche.
  if (boutons.appuye != 0 && !boutons.ignorer && !boutons.longSignale &&
      maintenantMs - boutons.debutAppuiMs >= APPUI_LONG_MS) {
    boutons.longSignale = true;
    boitierBouton(b, boutons.appuye, true, maintenantMs);
  }
}

// ---------------------------------------------------------------------
void entreesDemarrer() {
  reedModeNormal();
  boutonsDemarrer();
}

void entreesTraiter(Boitier* b, int32_t maintenantMs) {
  // 1. Les tops notés par l'interruption, dans l'ordre.
  while (topsLus != topsEcrits) {
    int32_t tTop = topsMs[topsLus % TAILLE_FILE_TOPS];
    topsLus = topsLus + 1;
    boitierTopRoue(b, tTop);
  }
  // 2. Le reed collé.
  reedSurveiller(b, maintenantMs);
  // 3. Les boutons.
  boutonsLire(b, maintenantMs);
}

bool entreesOubliDemande() {
  // Bouton 1 enfoncé dès le démarrage et tenu OUBLI_APPUI_MS.
  int32_t debut = (int32_t)millis();
  while (lireBoutons() == 1) {
    if ((int32_t)millis() - debut >= OUBLI_APPUI_MS) return true;
    delay(20);
  }
  return false;
}

void entreesPreparerReveil() {
  // Boutons : réveil quand on appuie (niveau bas sur D5), pull-up interne.
  // SW2 ne descend qu'à 12-17 % de VDD, sous le seuil de 30 % : il réveille
  // aussi (marge calculée dans logique/boutons.js).
  gpioReveil(gpioDepuisArduino(BROCHE_BOUTONS), TIRAGE_HAUT, true);

  // Reed : on regarde d'abord s'il est ouvert ou fermé.
  // ATTENTION : si une broche est DÉJÀ au niveau qui réveille, la carte
  // se réveille aussitôt. Il ne faut donc pas demander « réveil sur
  // niveau bas » quand l'aimant est arrêté devant le reed.
  detachInterrupt(digitalPinToInterrupt(BROCHE_REED));
  bool ferme = reedFermeAvecSondage();
  uint32_t gpioReed = gpioDepuisArduino(BROCHE_REED);
  Tirage tirage = REED_PULLUP_INTERNE ? TIRAGE_HAUT : TIRAGE_AUCUN;

  if (!ferme) {
    // Cas normal : réveil quand l'aimant passe (le reed se ferme).
    gpioReveil(gpioReed, tirage, true);
  } else if (!REED_PULLUP_INTERNE) {
    // Pull-up externe de 1 MΩ : réveil quand l'aimant s'éloigne (le
    // reed se rouvre), pour 3,3 µA seulement pendant la veille.
    gpioReveil(gpioReed, TIRAGE_AUCUN, false);
  } else {
    // Pull-up interne et aimant arrêté devant : garder le réveil par la
    // roue coûterait 0,25 mA pendant toute la veille (50 fois la veille
    // normale). On choisit d'économiser : broche débranchée, c'est un
    // bouton qui réveillera le boîtier. Cas rare : la zone sensible du
    // reed fait environ 1 % du tour de roue.
    gpioDeconnecter(gpioReed);
  }
}
