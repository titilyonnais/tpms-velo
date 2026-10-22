// =====================================================================
// epaper.cpp — Mémoire d'image 1 bit par pixel et primitives de dessin
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/epaper.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "epaper.h"
#include "police5x7.h"
#include <string.h>

void creerEcran(Ecran* e) {
  ecranEffacer(e);
}

void ecranEffacer(Ecran* e) {
  memset(e->pixels, 0, ECRAN_OCTETS);   // tous les bits à 0 = blanc
}

// Masque du bit d'un pixel dans son octet : 0x80 pour x = 0, 0x40 pour x = 1...
static uint8_t masquePixel(int x) {
  return (uint8_t)(0x80 >> (x % 8));
}

void ecranPixel(Ecran* e, int x, int y, uint8_t couleur) {
  if (x < 0 || y < 0 || x >= ECRAN_LARGEUR || y >= ECRAN_HAUTEUR) return;
  int k = y * ECRAN_OCTETS_PAR_LIGNE + x / 8;
  if (couleur == NOIR) {
    e->pixels[k] |= masquePixel(x);              // met le bit à 1
  } else {
    e->pixels[k] &= (uint8_t)~masquePixel(x);    // met le bit à 0
  }
}

uint8_t ecranLirePixel(const Ecran* e, int x, int y) {
  int k = y * ECRAN_OCTETS_PAR_LIGNE + x / 8;
  return (e->pixels[k] & masquePixel(x)) ? NOIR : BLANC;
}

void ecranRectPlein(Ecran* e, int x, int y, int l, int h, uint8_t couleur) {
  for (int j = y; j < y + h; j++) {
    for (int i = x; i < x + l; i++) ecranPixel(e, i, j, couleur);
  }
}

void ecranLigneH(Ecran* e, int x, int y, int l, uint8_t couleur) {
  ecranRectPlein(e, x, y, l, 1, couleur);
}

void ecranLigneV(Ecran* e, int x, int y, int h, uint8_t couleur) {
  ecranRectPlein(e, x, y, 1, h, couleur);
}

void ecranCadre(Ecran* e, int x, int y, int l, int h, uint8_t couleur) {
  ecranLigneH(e, x, y, l, couleur);
  ecranLigneH(e, x, y + h - 1, l, couleur);
  ecranLigneV(e, x, y, h, couleur);
  ecranLigneV(e, x + l - 1, y, h, couleur);
}

void ecranInverser(Ecran* e, int x, int y, int l, int h) {
  for (int j = y; j < y + h; j++) {
    for (int i = x; i < x + l; i++) {
      if (i < 0 || j < 0 || i >= ECRAN_LARGEUR || j >= ECRAN_HAUTEUR) continue;
      // Le OU exclusif (^) avec le masque bascule le bit : 0 ↔ 1.
      e->pixels[j * ECRAN_OCTETS_PAR_LIGNE + i / 8] ^= masquePixel(i);
    }
  }
}

void ecranCaractere(Ecran* e, int x, int y, char caractere, int taille, uint8_t couleur) {
  const uint8_t* colonnes = glyphe(caractere);
  for (int col = 0; col < 5; col++) {
    uint8_t octet = colonnes[col];
    for (int ligne = 0; ligne < 7; ligne++) {
      if (octet & (1 << ligne)) {
        ecranRectPlein(e, x + col * taille, y + ligne * taille, taille, taille, couleur);
      }
    }
  }
}

// Chaque caractère avance de 6 pixels (5 + 1 d'espace) × taille.
// Exception : le point décimal n'occupe que 2 colonnes (les colonnes 1
// et 2 de son glyphe). On le décale d'une colonne vers la gauche et il
// n'avance que de 3 pixels. Sinon « 2.19 » en grand occupe presque
// toute la demi-largeur de l'écran.
int avanceCaractere(char caractere) {
  return caractere == '.' ? 3 : 6;
}

void ecranTexte(Ecran* e, int x, int y, const char* texte, int taille, uint8_t couleur) {
  for (int i = 0; texte[i] != '\0'; i++) {
    int decalage = (texte[i] == '.') ? -taille : 0;
    ecranCaractere(e, x + decalage, y, texte[i], taille, couleur);
    x += avanceCaractere(texte[i]) * taille;
  }
}

int largeurTexte(const char* texte, int taille) {
  if (texte[0] == '\0') return 0;
  int total = 0;
  for (int i = 0; texte[i] != '\0'; i++) total += avanceCaractere(texte[i]);
  return (total - 1) * taille;
}

void ecranTexteCentre(Ecran* e, int xCentre, int y, const char* texte, int taille, uint8_t couleur) {
  // Math.floor(largeur / 2) : la largeur est positive, la division
  // entière du C donne le même résultat.
  int x = xCentre - largeurTexte(texte, taille) / 2;
  ecranTexte(e, x, y, texte, taille, couleur);
}

void ecranTexteDroite(Ecran* e, int xFin, int y, const char* texte, int taille, uint8_t couleur) {
  ecranTexte(e, xFin - largeurTexte(texte, taille), y, texte, taille, couleur);
}

bool ecransDifferents(const Ecran* a, const Ecran* b) {
  // memcmp compare les 5 000 octets d'un coup : 0 = identiques.
  return memcmp(a->pixels, b->pixels, ECRAN_OCTETS) != 0;
}

void ecranCopier(Ecran* destination, const Ecran* source) {
  memcpy(destination->pixels, source->pixels, ECRAN_OCTETS);
}
