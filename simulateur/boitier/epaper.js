// =====================================================================
// epaper.js — Mémoire d'image de l'écran e-paper 200×200 et dessin
// ---------------------------------------------------------------------
// L'écran WeAct 1,54" (contrôleur SSD1681) est noir et blanc :
// chaque pixel vaut 0 (blanc) ou 1 (noir). Le microcontrôleur prépare
// l'image dans sa mémoire, puis l'envoie à l'écran en SPI.
//
// Ici on garde un octet par pixel pour rester lisible. Le firmware
// rangera 8 pixels par octet : 200 × 200 / 8 = 5 000 octets.
//
// Les fonctions de dessin ont les mêmes noms que celles de la
// bibliothèque Adafruit GFX utilisée dans le firmware :
//   ecranRectPlein  ↔ fillRect      ecranLigneH ↔ drawFastHLine
//   ecranCadre      ↔ drawRect      ecranLigneV ↔ drawFastVLine
//   ecranTexte      ↔ setTextSize + setCursor + print
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.ECRAN_LARGEUR = 200;
TPMS.ECRAN_HAUTEUR = 200;
TPMS.BLANC = 0;
TPMS.NOIR = 1;

TPMS.creerEcran = function () {
  return {
    largeur: TPMS.ECRAN_LARGEUR,
    hauteur: TPMS.ECRAN_HAUTEUR,
    pixels: new Uint8Array(TPMS.ECRAN_LARGEUR * TPMS.ECRAN_HAUTEUR)
  };
};

TPMS.ecranEffacer = function (e) {
  e.pixels.fill(TPMS.BLANC);
};

// Les pixels hors de l'écran sont simplement ignorés.
TPMS.ecranPixel = function (e, x, y, couleur) {
  if (x < 0 || y < 0 || x >= e.largeur || y >= e.hauteur) return;
  e.pixels[y * e.largeur + x] = couleur;
};

TPMS.ecranLirePixel = function (e, x, y) {
  return e.pixels[y * e.largeur + x];
};

TPMS.ecranRectPlein = function (e, x, y, l, h, couleur) {
  for (var j = y; j < y + h; j++) {
    for (var i = x; i < x + l; i++) TPMS.ecranPixel(e, i, j, couleur);
  }
};

TPMS.ecranLigneH = function (e, x, y, l, couleur) {
  TPMS.ecranRectPlein(e, x, y, l, 1, couleur);
};

TPMS.ecranLigneV = function (e, x, y, h, couleur) {
  TPMS.ecranRectPlein(e, x, y, 1, h, couleur);
};

TPMS.ecranCadre = function (e, x, y, l, h, couleur) {
  TPMS.ecranLigneH(e, x, y, l, couleur);
  TPMS.ecranLigneH(e, x, y + h - 1, l, couleur);
  TPMS.ecranLigneV(e, x, y, h, couleur);
  TPMS.ecranLigneV(e, x + l - 1, y, h, couleur);
};

// Inverse une zone (noir ↔ blanc) : sert à mettre une roue en alerte
// en "négatif", très visible même d'un coup d'œil sur le guidon.
TPMS.ecranInverser = function (e, x, y, l, h) {
  for (var j = y; j < y + h; j++) {
    for (var i = x; i < x + l; i++) {
      if (i < 0 || j < 0 || i >= e.largeur || j >= e.hauteur) continue;
      var k = j * e.largeur + i;
      e.pixels[k] = 1 - e.pixels[k];
    }
  }
};

// Dessine un caractère. "taille" agrandit chaque pixel en un carré
// taille × taille (comme setTextSize d'Adafruit GFX).
TPMS.ecranCaractere = function (e, x, y, caractere, taille, couleur) {
  var colonnes = TPMS.glyphe(caractere);
  for (var col = 0; col < 5; col++) {
    var octet = colonnes[col];
    for (var ligne = 0; ligne < 7; ligne++) {
      if (octet & (1 << ligne)) {
        TPMS.ecranRectPlein(e, x + col * taille, y + ligne * taille, taille, taille, couleur);
      }
    }
  }
};

// Chaque caractère avance de 6 pixels (5 + 1 d'espace) × taille.
// Exception : le point décimal n'occupe que 2 colonnes (les colonnes 1
// et 2 de son glyphe). On le décale d'une colonne vers la gauche et il
// n'avance que de 3 pixels. Sinon « 2.19 » en grand occupe presque
// toute la demi-largeur de l'écran.
TPMS.avanceCaractere = function (caractere) {
  return caractere === "." ? 3 : 6;
};

TPMS.ecranTexte = function (e, x, y, texte, taille, couleur) {
  for (var i = 0; i < texte.length; i++) {
    var decalage = texte[i] === "." ? -taille : 0;
    TPMS.ecranCaractere(e, x + decalage, y, texte[i], taille, couleur);
    x += TPMS.avanceCaractere(texte[i]) * taille;
  }
};

// Largeur occupée par un texte, sans l'espace après le dernier caractère.
TPMS.largeurTexte = function (texte, taille) {
  if (texte.length === 0) return 0;
  var total = 0;
  for (var i = 0; i < texte.length; i++) total += TPMS.avanceCaractere(texte[i]);
  return (total - 1) * taille;
};

TPMS.ecranTexteCentre = function (e, xCentre, y, texte, taille, couleur) {
  var x = xCentre - Math.floor(TPMS.largeurTexte(texte, taille) / 2);
  TPMS.ecranTexte(e, x, y, texte, taille, couleur);
};

TPMS.ecranTexteDroite = function (e, xFin, y, texte, taille, couleur) {
  TPMS.ecranTexte(e, xFin - TPMS.largeurTexte(texte, taille), y, texte, taille, couleur);
};

// Compare deux images : on ne rafraîchit l'écran que si elles diffèrent.
// Un rafraîchissement e-paper coûte de l'énergie, alors qu'une image
// affichée n'en consomme plus du tout.
// En C : memcmp(nouvelle, ancienne, 5000) != 0
TPMS.ecransDifferents = function (a, b) {
  for (var i = 0; i < a.pixels.length; i++) {
    if (a.pixels[i] !== b.pixels[i]) return true;
  }
  return false;
};

TPMS.ecranCopier = function (destination, source) {
  destination.pixels.set(source.pixels);
};
