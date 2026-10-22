// =====================================================================
// epaper.h — Mémoire d'image de l'écran e-paper 200×200 et dessin
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/epaper.js
// LOGIQUE PURE : aucun appel Arduino. L'envoi de l'image à l'écran
// (SPI, bibliothèque GxEPD2) est dans materiel/ecran_epaper.cpp.
//
// L'écran WeAct 1,54" (contrôleur SSD1681) est noir et blanc :
// chaque pixel vaut 0 (blanc) ou 1 (noir). Le microcontrôleur prépare
// l'image dans sa mémoire, puis l'envoie à l'écran en SPI.
//
// DIFFÉRENCE AVEC LE JS : le simulateur garde UN OCTET PAR PIXEL
// (40 000 octets) pour rester lisible. Ici on range 8 pixels par octet,
// comme l'écran lui-même : 200 × 200 / 8 = 5 000 octets. Le boîtier
// garde deux images (en préparation + affichée), soit 10 000 octets sur
// les 256 Ko de RAM du nRF52840.
//
// Rangement des bits (le même que l'écran et qu'Adafruit GFX) :
//   ligne après ligne, 25 octets par ligne ;
//   dans un octet, le bit de poids fort (0x80) est le pixel de GAUCHE.
//   Pixel (x, y) → octet y × 25 + x / 8, bit 7 - (x % 8).
//
// Les fonctions de dessin ont les mêmes rôles que celles d'Adafruit GFX :
//   ecranRectPlein  ↔ fillRect      ecranLigneH ↔ drawFastHLine
//   ecranCadre      ↔ drawRect      ecranLigneV ↔ drawFastVLine
//   ecranTexte      ↔ setTextSize + setCursor + print
// =====================================================================
#ifndef EPAPER_H
#define EPAPER_H

#include <stdint.h>

const int ECRAN_LARGEUR = 200;
const int ECRAN_HAUTEUR = 200;
const int ECRAN_OCTETS_PAR_LIGNE = ECRAN_LARGEUR / 8;               // 25
const int ECRAN_OCTETS = ECRAN_OCTETS_PAR_LIGNE * ECRAN_HAUTEUR;    // 5000
const uint8_t BLANC = 0;
const uint8_t NOIR = 1;

struct Ecran {
  uint8_t pixels[ECRAN_OCTETS];   // 1 bit par pixel, 1 = noir
};

void creerEcran(Ecran* e);
void ecranEffacer(Ecran* e);

// Les pixels hors de l'écran sont simplement ignorés.
void ecranPixel(Ecran* e, int x, int y, uint8_t couleur);
uint8_t ecranLirePixel(const Ecran* e, int x, int y);

void ecranRectPlein(Ecran* e, int x, int y, int l, int h, uint8_t couleur);
void ecranLigneH(Ecran* e, int x, int y, int l, uint8_t couleur);
void ecranLigneV(Ecran* e, int x, int y, int h, uint8_t couleur);
void ecranCadre(Ecran* e, int x, int y, int l, int h, uint8_t couleur);

// Inverse une zone (noir ↔ blanc) : sert à mettre une roue en alerte
// en "négatif", très visible même d'un coup d'œil sur le guidon.
void ecranInverser(Ecran* e, int x, int y, int l, int h);

// Dessine un caractère. "taille" agrandit chaque pixel en un carré
// taille × taille (comme setTextSize d'Adafruit GFX).
void ecranCaractere(Ecran* e, int x, int y, char caractere, int taille, uint8_t couleur);

// Avance (en pixels, taille 1) après un caractère : 6 en général
// (5 colonnes + 1 d'espace), 3 seulement pour le point décimal.
int avanceCaractere(char caractere);

void ecranTexte(Ecran* e, int x, int y, const char* texte, int taille, uint8_t couleur);

// Largeur occupée par un texte, sans l'espace après le dernier caractère.
int largeurTexte(const char* texte, int taille);

void ecranTexteCentre(Ecran* e, int xCentre, int y, const char* texte, int taille, uint8_t couleur);
void ecranTexteDroite(Ecran* e, int xFin, int y, const char* texte, int taille, uint8_t couleur);

// Compare deux images : on ne rafraîchit l'écran que si elles diffèrent.
// Un rafraîchissement e-paper coûte de l'énergie, alors qu'une image
// affichée n'en consomme plus du tout.
bool ecransDifferents(const Ecran* a, const Ecran* b);
void ecranCopier(Ecran* destination, const Ecran* source);

#endif
