// =====================================================================
// ecran_epaper.cpp — Envoi de l'image à l'écran e-paper (SPI)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE. Bibliothèque : GxEPD2 (Jean-Marc Zingg), à
// installer depuis le gestionnaire de bibliothèques de l'Arduino IDE
// (elle installe aussi Adafruit GFX).
//
// Écran : WeAct 1,54" 200×200, contrôleur SSD1681 → classe GxEPD2_154_D67.
// Câblage : CS = D3, DC = D2, RST = D1, CLK = D8 (SCK),
//           DIN = D10 (MOSI), VCC = 3V3, GND = GND.
// BUSY n'est PAS câblée (D0 sert au baromètre) : avec la broche -1,
// GxEPD2 attend une durée fixe tirée de sa table au lieu de lire BUSY,
// et ecranEnvoyer ajoute une attente de sécurité, plus longue au froid
// (logique/barometre.h). À VÉRIFIER avant de couper le fil : durée réelle
// de BUSY à l'oscilloscope à 20 °C, au réfrigérateur et au congélateur.
//
// On n'utilise PAS le texte d'Adafruit GFX : l'image complète est déjà
// dessinée par notre logique (même police que le simulateur). On la
// recopie simplement dans la mémoire de GxEPD2 avec drawBitmap, qui a le
// même rangement des bits que notre image (8 pixels par octet, bit de
// poids fort à gauche, 1 = pixel dessiné en noir).
// =====================================================================
#include "ecran_epaper.h"
#include "../../config.h"
#include <GxEPD2_BW.h>

// GxEPD2_BW<classe de l'écran, hauteur de la mémoire d'image>.
// La hauteur complète (200) réserve 5 000 octets : l'image entière tient
// en mémoire, c'est le plus simple.
static GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> afficheur(
  GxEPD2_154_D67(BROCHE_EPD_CS, BROCHE_EPD_DC, BROCHE_EPD_RST, BROCHE_EPD_BUSY));

void ecranDemarrer() {
  // init(débit série pour les messages de GxEPD2 (0 = aucun message),
  //      premier démarrage, durée de l'impulsion de reset en ms,
  //      mode de reset).
  // 2 ms de reset : valeur conseillée par GxEPD2 pour les modules
  // Waveshare/WeAct avec circuit de reset intégré. À VÉRIFIER.
  // "true" (premier démarrage) : le PREMIER rafraîchissement après
  // l'allumage sera complet, même si la logique demande un partiel :
  // le contrôleur a perdu l'image précédente en s'éteignant.
  afficheur.init(0, true, 2, false);
  afficheur.setRotation(ECRAN_ROTATION);
  afficheur.setFullWindow();
}

void ecranEnvoyer(const Ecran* e, bool complet, int32_t attenteMs) {
  afficheur.setFullWindow();
  afficheur.fillScreen(GxEPD_WHITE);
  afficheur.drawBitmap(0, 0, e->pixels, ECRAN_LARGEUR, ECRAN_HAUTEUR, GxEPD_BLACK);
  // display(true) = rafraîchissement partiel, display(false) = complet.
  // Sans fil BUSY, cet appel attend la durée fixe de GxEPD2 ; on ajoute
  // l'attente de sécurité calculée par la logique (2,5 s ou 0,6 s, ×1,5 sous
  // 10 °C, ×2 sous 0 °C). delay() endort le processeur pendant ce temps.
  afficheur.display(!complet);
  delay(attenteMs);
  // Coupe le générateur haute tension de l'écran entre deux images.
  // À VÉRIFIER : consommation réelle entre deux images (powerOff contre
  // hibernate) et qualité des partiels suivants.
  afficheur.powerOff();
}

void ecranHiberner() {
  afficheur.hibernate();
}
