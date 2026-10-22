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
// =====================================================================
#include "entrees.h"
#include "gpio_nrf.h"
#include "../../config.h"

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
// Boutons
// ---------------------------------------------------------------------
struct Bouton {
  uint8_t broche;
  int numero;                 // 1 ou 2, comme dans boitierBouton
  bool appuye;                // état stable (après anti-rebond)
  bool brutPrecedent;         // dernière lecture brute
  int32_t changementMs;       // instant du dernier changement brut
  int32_t debutAppuiMs;
  bool longSignale;           // l'appui long a déjà été transmis
  bool ignorer;               // appui en cours à ne pas compter (celui du réveil)
};

static Bouton boutons[2];

static bool boutonEnfonce(const Bouton* bt) {
  return digitalRead(bt->broche) == LOW;
}

static void boutonDemarrer(Bouton* bt, uint8_t broche, int numero) {
  bt->broche = broche;
  bt->numero = numero;
  pinMode(broche, INPUT_PULLUP);
  delayMicroseconds(50);
  bool enfonce = boutonEnfonce(bt);
  bt->appuye = enfonce;
  bt->brutPrecedent = enfonce;
  bt->changementMs = 0;
  bt->debutAppuiMs = 0;
  bt->longSignale = false;
  // Le bouton est déjà enfoncé au démarrage : c'est l'appui qui a
  // réveillé la carte. Comme dans le simulateur (« en veille, un appui
  // ne fait que réveiller »), on ne le compte pas.
  bt->ignorer = enfonce;
}

static void boutonLire(Bouton* bt, Boitier* b, int32_t maintenantMs) {
  bool brut = boutonEnfonce(bt);
  if (brut != bt->brutPrecedent) {
    bt->brutPrecedent = brut;
    bt->changementMs = maintenantMs;
  }

  // Anti-rebond : on n'accepte le nouvel état que s'il dure 30 ms.
  if (brut != bt->appuye && maintenantMs - bt->changementMs >= ANTI_REBOND_BOUTON_MS) {
    bt->appuye = brut;
    if (brut) {
      bt->debutAppuiMs = maintenantMs;          // début d'un appui
      bt->longSignale = false;
    } else {
      // Relâché : c'était un appui court, sauf si le long a déjà été signalé.
      if (!bt->ignorer && !bt->longSignale) {
        boitierBouton(b, bt->numero, false, maintenantMs);
      }
      bt->ignorer = false;
    }
  }

  // Appui long : signalé dès 700 ms, sans attendre qu'on relâche.
  if (bt->appuye && !bt->ignorer && !bt->longSignale &&
      maintenantMs - bt->debutAppuiMs >= APPUI_LONG_MS) {
    bt->longSignale = true;
    boitierBouton(b, bt->numero, true, maintenantMs);
  }
}

// ---------------------------------------------------------------------
void entreesDemarrer() {
  reedModeNormal();
  boutonDemarrer(&boutons[0], BROCHE_BOUTON1, 1);
  boutonDemarrer(&boutons[1], BROCHE_BOUTON2, 2);
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
  boutonLire(&boutons[0], b, maintenantMs);
  boutonLire(&boutons[1], b, maintenantMs);
}

bool entreesDeuxBoutonsAppuyes() {
  return boutonEnfonce(&boutons[0]) && boutonEnfonce(&boutons[1]);
}

void entreesPreparerReveil() {
  // Boutons : réveil quand on appuie (niveau bas), pull-up interne.
  gpioReveil(gpioDepuisArduino(BROCHE_BOUTON1), TIRAGE_HAUT, true);
  gpioReveil(gpioDepuisArduino(BROCHE_BOUTON2), TIRAGE_HAUT, true);

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
