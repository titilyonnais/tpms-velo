// =====================================================================
// schema.js — Schéma électrique du boîtier, dessiné en SVG et animé
// ---------------------------------------------------------------------
// UN SEUL code de dessin pour deux usages :
//   - dans le navigateur : TPMS.schemaSvg() donne le SVG à insérer dans
//     la page, puis TPMS.schemaMettreAJour(svg, etat) l'anime avec le
//     résultat de TPMS.circuitResoudre (simulateur/monde/circuit.js) ;
//   - avec node : docs/schema/genere-schema.js appelle TPMS.schemaSvg()
//     et écrit docs/schema/schema-boitier.svg pour le dossier.
//
// Repères (les mêmes que dans circuit.js et docs/schema-electrique.md) :
//   composant  <g id="comp-R1">          valeur affichée  <text id="val-R1">
//   nœud       <text id="tension-VBAT">  fil              <g id="fil-led1" data-courant="LED1">
// Chaque fil parcouru par un courant porte data-courant="<clé de
// etat.courants>". Il est dessiné DANS LE SENS du courant conventionnel
// (du + vers le −) : l'animation fait défiler les pointillés dans ce sens,
// et à l'envers si le courant est négatif (batterie en charge).
//
// Symboles au format IEC (résistance = rectangle), comme en France.
// Style « fiche technique » : fond blanc, encre #1a1a18, repères rouges #c8361e.
// Toutes les classes CSS commencent par « sch- » et toutes les règles
// sont limitées à #schema-tpms : le style du schéma ne déborde pas sur la page.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

(function () {
"use strict";

var L = 1480, H = 1046;          // format A3 paysage (rapport 1,414)
var ENCRE = "#1a1a18", ROUGE = "#c8361e";
var elements;                    // morceaux de SVG en cours d'assemblage
var courant = null;              // clé du courant porté par les fils dessinés en ce moment
var signal = null;               // nom du signal logique (bus SPI) porté par les fils

function ajouter(s) { elements.push(s); }

// ---------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------
function attributsFil() {
  var a = "";
  if (courant) a += ' data-courant="' + courant + '"';
  if (signal) a += ' data-signal="' + signal + '"';
  return a;
}
// Fil : polyligne. Les fils ordinaires (classe par défaut, câble, non
// monté) prennent le courant en cours ; les traits de symbole non.
function fil(points, classe) {
  var c = classe || "sch-fil";
  var porteCourant = c === "sch-fil" || c === "sch-cable" || c === "sch-dnp";
  ajouter('<polyline class="' + c + (porteCourant && (courant || signal) ? " sch-conducteur" : "") + '"' +
    (porteCourant ? attributsFil() : "") + ' points="' +
    points.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '"/>');
}
function trait(points, classe) { fil(points, classe || "sch-armature"); }
function noeud(x, y) { ajouter('<circle class="sch-noeud" cx="' + x + '" cy="' + y + '" r="3.2"/>'); }
function echapper(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function texte(x, y, t, classe, ancre, id) {
  ajouter('<text' + (id ? ' id="' + id + '"' : "") + ' x="' + x + '" y="' + y + '" class="' + (classe || "") +
    '" text-anchor="' + (ancre || "start") + '">' + echapper(t) + "</text>");
}
function rect(x, y, l, h, classe, id) {
  ajouter('<rect' + (id ? ' id="' + id + '"' : "") + ' x="' + x + '" y="' + y + '" width="' + l + '" height="' + h +
    '" class="' + (classe || "sch-corps") + '"/>');
}
// Emplacement d'une valeur calculée (vide dans le document imprimé).
function mesure(x, y, id, ancre) { texte(x, y, "", "sch-mesure", ancre || "start", id); }
function tension(x, y, nom, ancre) { texte(x, y, "", "sch-mesure sch-tension", ancre || "start", "tension-" + nom); }

// Groupe d'un composant : <g id="comp-REF">…</g>
function composant(ref, dessin, classe) {
  ajouter('<g id="comp-' + ref + '" class="sch-composant' + (classe ? " " + classe : "") + '">');
  dessin();
  ajouter("</g>");
}
// Groupe d'une branche de circuit : tous les fils dessinés dedans portent
// le même courant (clé de etat.courants).
function branche(nom, cleCourant, dessin) {
  var avant = courant;
  courant = cleCourant;
  ajouter('<g id="fil-' + nom + '"' + (cleCourant ? ' data-courant="' + cleCourant + '"' : "") + ">");
  dessin();
  ajouter("</g>");
  courant = avant;
}
// suffixe : pour un deuxième morceau du même bus (les id doivent rester uniques).
function busSignal(nom, dessin, suffixe) {
  var avant = signal;
  signal = nom;
  ajouter('<g id="fil-' + nom + (suffixe ? "-" + suffixe : "") + '" data-signal="' + nom + '">');
  dessin();
  ajouter("</g>");
  signal = avant;
}

// ---------------------------------------------------------------------
// Symboles (chacun dessine ses pattes dans le sens du courant)
// ---------------------------------------------------------------------

// Résistance horizontale de x1 vers x2 (corps 40 × 14 au milieu).
function resistanceH(x1, x2, y, ref, valeur, dnp) {
  var m = (x1 + x2) / 2, s = Math.sign(x2 - x1);
  composant(ref, function () {
    fil([[x1, y], [m - 20 * s, y]], dnp ? "sch-dnp" : null);
    rect(m - 20, y - 7, 40, 14, dnp ? "sch-corps sch-dnp-corps" : "sch-corps");
    fil([[m + 20 * s, y], [x2, y]], dnp ? "sch-dnp" : null);
    texte(m, y - 13, ref, "sch-ref", "middle");
    texte(m, y + 24, valeur, "sch-val", "middle");
  });
}

// Résistance verticale de y1 vers y2. Textes à droite (ou à gauche).
function resistanceV(x, y1, y2, ref, valeur, dnp, gauche) {
  var m = (y1 + y2) / 2, s = Math.sign(y2 - y1);
  composant(ref, function () {
    fil([[x, y1], [x, m - 20 * s]], dnp ? "sch-dnp" : null);
    rect(x - 7, m - 20, 14, 40, dnp ? "sch-corps sch-dnp-corps" : "sch-corps");
    fil([[x, m + 20 * s], [x, y2]], dnp ? "sch-dnp" : null);
    var tx = gauche ? x - 13 : x + 13, a = gauche ? "end" : "start";
    texte(tx, m - 3, ref, "sch-ref", a);
    texte(tx, m + 12, valeur, "sch-val", a);
  });
}

// Condensateur vertical de y1 vers y2 (polarisé : « + » en haut).
function condensateurV(x, y1, y2, ref, valeur, polarise, dnp) {
  var m = (y1 + y2) / 2;
  composant(ref, function () {
    fil([[x, y1], [x, m - 4]], dnp ? "sch-dnp" : null);
    trait([[x - 13, m - 4], [x + 13, m - 4]], "sch-armature" + (dnp ? " sch-pointille" : ""));
    trait([[x - 13, m + 4], [x + 13, m + 4]], "sch-armature" + (dnp ? " sch-pointille" : ""));
    fil([[x, m + 4], [x, y2]], dnp ? "sch-dnp" : null);
    if (polarise) texte(x - 18, m - 8, "+", "sch-petit", "middle");
    texte(x + 18, m - 3, ref, "sch-ref");
    texte(x + 18, m + 12, valeur, "sch-val");
  });
}

// Diode de l'anode (xa, ya) vers la cathode (xk, yk), horizontale ou verticale.
// type : "" (signal), "schottky" ou "led" (alors halo et flèches de lumière).
function diode(xa, ya, xk, yk, ref, valeur, type, options) {
  var o = options || {};
  var horizontal = ya === yk;
  var mx = (xa + xk) / 2, my = (ya + yk) / 2;
  var s = horizontal ? Math.sign(xk - xa) : Math.sign(yk - ya);
  composant(ref, function () {
    if (type === "led") {
      ajouter('<circle id="lueur-' + ref + '" class="sch-lueur ' + (o.couleur || "") + '" cx="' + mx + '" cy="' + my + '" r="19"/>');
    }
    var t;
    if (horizontal) {
      fil([[xa, ya], [mx - 9 * s, my]]);
      t = [[mx - 9 * s, my - 10], [mx - 9 * s, my + 10], [mx + 9 * s, my]];
      ajouter('<polygon class="sch-corps sch-triangle" points="' + t.map(function (p) { return p.join(","); }).join(" ") + '"/>');
      if (type === "schottky") {
        trait([[mx + 9 * s + 4 * s, my - 14], [mx + 9 * s, my - 14], [mx + 9 * s, my + 14], [mx + 9 * s - 4 * s, my + 14]]);
      } else {
        trait([[mx + 9 * s, my - 10], [mx + 9 * s, my + 10]]);
      }
      fil([[mx + 9 * s, my], [xk, yk]]);
    } else {
      fil([[xa, ya], [mx, my - 9 * s]]);
      t = [[mx - 10, my - 9 * s], [mx + 10, my - 9 * s], [mx, my + 9 * s]];
      ajouter('<polygon class="sch-corps sch-triangle" points="' + t.map(function (p) { return p.join(","); }).join(" ") + '"/>');
      trait([[mx - 10, my + 9 * s], [mx + 10, my + 9 * s]]);
      fil([[mx, my + 9 * s], [xk, yk]]);
    }
    if (type === "led") {
      // Deux flèches : la lumière sort de la diode.
      for (var i = 0; i < 2; i++) {
        var x0, y0, x1, y1;
        if (horizontal) { x0 = mx - 4 + i * 8; y0 = my - 13; x1 = x0 + 7; y1 = y0 - 10; }
        else { x0 = mx - 13; y0 = my - 6 + i * 8; x1 = x0 - 11; y1 = y0 - 7; }
        trait([[x0, y0], [x1, y1]], "sch-fleche");
        var dx = x1 - x0, dy = y1 - y0, n = Math.sqrt(dx * dx + dy * dy);
        var ux = dx / n, uy = dy / n;
        ajouter('<polygon class="sch-noeud" points="' + x1 + "," + y1 + " " +
          (x1 - 6 * ux - 3 * uy).toFixed(1) + "," + (y1 - 6 * uy + 3 * ux).toFixed(1) + " " +
          (x1 - 6 * ux + 3 * uy).toFixed(1) + "," + (y1 - 6 * uy - 3 * ux).toFixed(1) + '"/>');
      }
    }
    if (horizontal) {
      var yRef = o.textesDessous ? my + 28 : my - 22;
      texte(mx, yRef, ref, "sch-ref", "middle");
      texte(mx, o.textesDessous ? my + 43 : my + 30, valeur, "sch-val", "middle");
    } else {
      texte(mx + 16, my - 3, ref, "sch-ref");
      texte(mx + 16, my + 12, valeur, "sch-val");
    }
  });
}

// MOSFET canal N à enrichissement. (xg, yg) = extrémité de la grille.
// Drain en haut (yg − 40), source en bas (yg + 40). Le courant descend.
function mosfetN(xg, yg, ref, valeur) {
  var xp = xg + 22, xc = xg + 29, xd = xg + 50;
  composant(ref, function () {
    ajouter('<circle class="sch-contour" cx="' + (xc + 6) + '" cy="' + yg + '" r="27"/>');
    var c0 = courant; courant = null;
    fil([[xg, yg], [xp, yg]]);                                 // grille (pas de courant continu)
    courant = c0;
    trait([[xp, yg - 16], [xp, yg + 16]]);
    // Canal en 3 segments (enrichissement : interrompu quand le MOSFET est bloqué)
    [[-18, -8], [-5, 5], [8, 18]].forEach(function (seg) { trait([[xc, yg + seg[0]], [xc, yg + seg[1]]]); });
    // Canal formé : trait continu affiché seulement quand le MOSFET conduit
    ajouter('<polyline class="sch-canal" points="' + xc + "," + (yg - 18) + " " + xc + "," + (yg + 18) + '"/>');
    fil([[xd, yg - 40], [xd, yg - 13], [xc, yg - 13]]);       // drain
    fil([[xc, yg + 13], [xd, yg + 13], [xd, yg + 40]]);       // source
    var c1 = courant; courant = null;
    fil([[xc, yg], [xd, yg], [xd, yg + 13]]);                  // substrat relié à la source
    courant = c1;
    ajouter('<polygon class="sch-noeud" points="' + (xc + 1) + "," + yg + " " + (xc + 10) + "," + (yg - 5) + " " + (xc + 10) + "," + (yg + 5) + '"/>');
    texte(xd + 18, yg - 3, ref, "sch-ref");
    texte(xd + 18, yg + 12, valeur, "sch-val");
  });
  return { drain: [xd, yg - 40], source: [xd, yg + 40] };
}

// Bouton poussoir vertical (contact travail) de y1 vers y2.
// Le poussoir est à gauche ; il se déplace vers la droite à l'appui.
function boutonV(x, y1, y2, ref, valeur) {
  var c1 = y1 + 16, c2 = y2 - 16, m = (y1 + y2) / 2;
  composant(ref, function () {
    fil([[x, y1], [x, c1]]);
    fil([[x, c2], [x, y2]]);
    ajouter('<circle class="sch-borne" cx="' + x + '" cy="' + c1 + '" r="2.6"/>');
    ajouter('<circle class="sch-borne" cx="' + x + '" cy="' + c2 + '" r="2.6"/>');
    ajouter('<g class="sch-poussoir">');
    trait([[x - 10, c1 - 2], [x - 10, c2 + 2]]);              // pièce mobile
    trait([[x - 10, m], [x - 20, m]], "sch-fil-symbole");
    trait([[x - 20, m - 8], [x - 20, m + 8]]);                 // poussoir
    ajouter("</g>");
    texte(x + 14, m - 3, ref, "sch-ref");
    texte(x + 14, m + 12, valeur, "sch-val");
  });
}

// Interrupteur à lame souple (ILS / reed) horizontal, de x1 vers x2.
// Deux lames mobiles dessinées : ouverte (par défaut) et fermée.
function reed(x1, x2, y, ref, valeur, xTexte, yTexte) {
  var s = Math.sign(x2 - x1);
  var c1 = x1 + 16 * s, c2 = x2 - 16 * s, m = (x1 + x2) / 2;
  composant(ref, function () {
    fil([[x1, y], [c1, y]], "sch-cable");
    ajouter('<rect class="sch-ampoule" x="' + (Math.min(c1, c2) - 6) + '" y="' + (y - 15) + '" width="' + (Math.abs(c2 - c1) + 12) + '" height="26" rx="13"/>');
    fil([[c1, y], [m - 6 * s, y]]);                             // lame mobile, partie fixe
    trait([[m - 6 * s, y], [m + 10 * s, y - 9]], "sch-armature sch-lame-ouverte");
    trait([[m - 6 * s, y], [m + 10 * s, y]], "sch-armature sch-lame-fermee");
    fil([[m + 4 * s, y], [c2, y]]);                             // lame fixe
    fil([[c2, y], [x2, y]], "sch-cable");
    texte(xTexte, yTexte, ref + "  " + valeur, "sch-ref", "middle");
  });
}

// Buzzer actif vertical : + en y1 (haut), − en y2.
function buzzer(x, y1, y2, ref, valeur) {
  var m = (y1 + y2) / 2;
  composant(ref, function () {
    fil([[x, y1], [x, m - 12]]);
    fil([[x, m + 12], [x, y2]]);
    ajouter('<g class="sch-vibreur">');
    rect(x - 14, m - 12, 28, 24);
    ajouter('<path class="sch-trait" d="M ' + (x - 8) + " " + (m + 6) + " A 8 8 0 0 1 " + (x + 8) + " " + (m + 6) + ' Z"/>');
    ajouter("</g>");
    // Ondes sonores (visibles quand le buzzer sonne)
    ajouter('<g class="sch-ondes">' +
      '<path d="M ' + (x + 20) + " " + (m - 8) + " Q " + (x + 26) + " " + m + " " + (x + 20) + " " + (m + 8) + '"/>' +
      '<path d="M ' + (x + 27) + " " + (m - 13) + " Q " + (x + 36) + " " + m + " " + (x + 27) + " " + (m + 13) + '"/>' +
      '<path d="M ' + (x + 34) + " " + (m - 18) + " Q " + (x + 46) + " " + m + " " + (x + 34) + " " + (m + 18) + '"/></g>');
    texte(x - 20, m - 12, "+", "sch-petit", "middle");
    texte(x - 22, m + 4, ref, "sch-ref", "end");
    texte(x - 22, m + 19, valeur, "sch-val", "end");
  });
}

// Batterie verticale, + en haut (y1). En décharge, le courant sort par le +.
function batterie(x, y1, y2, ref, valeurs) {
  var m = (y1 + y2) / 2;
  composant(ref, function () {
    fil([[x, m - 10], [x, y1]]);
    trait([[x - 18, m - 10], [x + 18, m - 10]]);
    trait([[x - 9, m - 4], [x + 9, m - 4]], "sch-armature sch-epais");
    trait([[x - 18, m + 4], [x + 18, m + 4]]);
    trait([[x - 9, m + 10], [x + 9, m + 10]], "sch-armature sch-epais");
    fil([[x, y2], [x, m + 10]]);
    texte(x + 24, m - 14, "+", "sch-petit", "middle");
    texte(x - 26, m - 6, ref, "sch-ref", "end");
    valeurs.forEach(function (v, i) { texte(x - 26, m + 9 + 15 * i, v, "sch-val", "end"); });
  });
}

// Symbole de masse.
function masse(x, y) {
  var c0 = courant; courant = null;
  fil([[x, y], [x, y + 10]]);
  courant = c0;
  trait([[x - 11, y + 10], [x + 11, y + 10]]);
  trait([[x - 7, y + 14], [x + 7, y + 14]]);
  trait([[x - 3, y + 18], [x + 3, y + 18]]);
}

// Étiquette de liaison : deux étiquettes de même nom sont reliées.
// sens = "droite" (le fil arrive par la gauche) ou "gauche".
function etiquette(x, y, nom, sens) {
  var l = nom.length * 7.4 + 14;
  var pts = sens === "gauche"
    ? [[x, y], [x - 8, y - 9], [x - l, y - 9], [x - l, y + 9], [x - 8, y + 9]]
    : [[x, y], [x + 8, y - 9], [x + l, y - 9], [x + l, y + 9], [x + 8, y + 9]];
  ajouter('<polygon class="sch-etiquette" points="' + pts.map(function (p) { return p.join(","); }).join(" ") + '"/>');
  texte(sens === "gauche" ? x - l / 2 - 4 : x + l / 2 + 4, y + 4, nom, "sch-net", "middle");
}

// Broche non connectée.
function nonConnectee(x, y) {
  trait([[x - 6, y - 6], [x + 6, y + 6]], "sch-croix");
  trait([[x - 6, y + 6], [x + 6, y - 6]], "sch-croix");
}

// ---------------------------------------------------------------------
// Le schéma
// ---------------------------------------------------------------------
var U = { x: 560, y: 200, l: 220, h: 410 };
var Y = [240, 290, 340, 390, 440, 490, 540];          // 7 broches par côté, pas de 50
var XG = U.x - 30, XD = U.x + U.l + 30;               // extrémités des broches (530 et 810)
var YP = U.y + U.h + 30;                              // extrémité des plots du dessous (640)

function dessiner() {
  elements = [];
  courant = null; signal = null;

  // ---- Cadre, titre, notes ----------------------------------------
  ajouter('<rect x="0" y="0" width="' + L + '" height="' + H + '" class="sch-fond"/>');
  ajouter('<rect x="16" y="16" width="' + (L - 32) + '" height="' + (H - 32) + '" class="sch-cadre"/>');
  texte(40, 58, "Boîtier de guidon — schéma électrique", "sch-titre");
  texte(40, 80, "Kit TPMS vélo · câblage de firmware/tpms_boitier/config.h · symboles IEC · détails : docs/schema-electrique.md", "sch-note");
  [
    "Déjà sur la carte XIAO : chargeur LiPo BQ25101 (USB-C et broche 5V), régulateur 3,3 V,",
    "pont de mesure de la batterie 1 MΩ / 510 kΩ (P0.31, activé par P0.14 à 0), LED de charge.",
    "D4, D5 : tirage (pull-up) interne ≈ 13 kΩ vers 3V3 ; SW1 et SW2 partagent D5 (lue en analogique). D7 en sortie forte.",
    "NFC1/NFC2 deviennent des GPIO au premier démarrage (UICR.NFCPINS) ; tous deux à 0 au repos.",
    "Fil BUSY de l'écran supprimé (attente fixe) : D0 sélectionne le baromètre U3. D6 coupe la recharge (U4) par grand froid."
  ].forEach(function (n, k) { texte(40, 112 + k * 15, n, "sch-note"); });
  // Zone d'état (remplie par schemaMettreAJour)
  texte(L - 30, 52, "", "sch-resume", "end", "mesure-resume");
  ajouter('<text id="alertes" class="sch-alertes" x="' + (L - 30) + '" y="72" text-anchor="end"></text>');

  // ---- U1 : Seeed XIAO nRF52840 ------------------------------------
  var gauche = [["D0", "P0.02"], ["D1", "P0.03"], ["D2", "P0.28"], ["D3", "P0.29"], ["D4", "P0.04"], ["D5", "P0.05"], ["D6", "P1.11"]];
  var droite = [["5V", "VBUS"], ["GND", ""], ["3V3", "sortie"], ["D10", "P1.15"], ["D9", "P1.14"], ["D8", "P1.13"], ["D7", "P1.12"]];
  // Courant (ou signal) porté par chaque patte, dans le sens du courant.
  var patteG = [["spi"], ["spi"], ["spi"], ["spi"], ["S1"], ["D5"], ["R11"]];
  var patteD = [["U1.5V", true], [null], ["U1.3V3"], ["spi"], ["spi"], ["spi"], ["LED1"]];
  composant("U1", function () {
    rect(U.x, U.y, U.l, U.h, "sch-corps sch-circuit");
    texte(U.x, U.y - 16, "U1", "sch-ref");
    texte(U.x + 26, U.y - 16, "Seeed XIAO nRF52840", "sch-val");
    for (var i = 0; i < 7; i++) {
      var g = patteG[i][0];
      if (g === "spi") { signal = "spi"; fil([[U.x, Y[i]], [XG, Y[i]]]); signal = null; }
      else { courant = g; fil([[U.x, Y[i]], [XG, Y[i]]]); courant = null; }
      texte(U.x + 10, Y[i] + 4, gauche[i][0], "sch-broche");
      texte(U.x + 46, Y[i] + 4, gauche[i][1], "sch-broche sch-discret");
      var d = patteD[i];
      if (d[0] === "spi") signal = "spi"; else courant = d[0];
      fil(d[1] ? [[XD, Y[i]], [U.x + U.l, Y[i]]] : [[U.x + U.l, Y[i]], [XD, Y[i]]]);
      signal = null; courant = null;
      texte(U.x + U.l - 10, Y[i] + 4, droite[i][0], "sch-broche", "end");
      if (droite[i][1]) texte(U.x + U.l - 52, Y[i] + 4, droite[i][1], "sch-broche sch-discret", "end");
    }
    // Plots au dos : BAT+ (courant entrant en décharge), BAT−, NFC1, NFC2.
    courant = "U1.BAT"; fil([[600, YP], [600, U.y + U.h]]); courant = null;
    fil([[650, U.y + U.h], [650, YP]]);
    courant = "R2"; fil([[710, U.y + U.h], [710, YP]]); courant = null;
    courant = "R3"; fil([[760, U.y + U.h], [760, YP]]); courant = null;
    [["BAT+", 600], ["BAT−", 650], ["NFC1", 710], ["NFC2", 760]].forEach(function (p) {
      texte(p[1], U.y + U.h - 10, p[0], "sch-broche", "middle");
    });
    texte(U.x + U.l / 2, U.y + U.h - 44, "plots au dos :", "sch-broche sch-discret", "middle");
    texte(U.x + U.l / 2, U.y + U.h - 30, "NFC1 = P0.09 · NFC2 = P0.10", "sch-broche sch-discret", "middle");
    mesure(U.x + U.l / 2, 522, "val-U1", "middle");
  });
  // Tensions des broches
  for (var i = 0; i < 7; i++) tension(XG - 4, Y[i] - 6, "D" + i, "end");
  tension(XD + 4, Y[0] - 6, "VBUS");
  tension(XD + 4, Y[1] - 6, "GND");
  tension(XD + 4, Y[2] - 6, "V3V3");
  tension(XD + 58, Y[3] + 4, "D10");
  tension(996, Y[4] + 4, "D9");
  tension(XD + 58, Y[5] + 4, "D8");
  tension(XD + 4, Y[6] - 6, "D7");
  tension(704, 660, "NFC1", "end");
  tension(766, 660, "NFC2");

  // ---- U2 : écran e-paper WeAct 1,54″ (SSD1681) ---------------------
  var E = { x: 190, y: 215, l: 160, h: 187 };
  composant("U2", function () {
    rect(E.x, E.y, E.l, E.h, "sch-corps sch-circuit");
    texte(E.x, E.y - 14, "U2", "sch-ref");
    texte(E.x + 26, E.y - 14, "e-paper WeAct 1,54″ SSD1681 (SPI)", "sch-val");
    ["BUSY", "RES", "DC", "CS"].forEach(function (n, k) { texte(E.x + E.l - 10, Y[k] + 4, n, "sch-broche", "end"); });
    ["VCC", "GND", "SDA", "SCL"].forEach(function (n, k) { texte(E.x + 10, Y[k] + 4, n, "sch-broche"); });
    mesure(E.x + E.l / 2, 318, "val-U2", "middle");
  });
  // Liaisons U2 ↔ U1 : RES/DC/CS sortent du nRF. BUSY n'est plus câblée :
  // le programme attend une durée fixe (logique/barometre.js) ; D0 va au
  // CS du baromètre U3.
  fil([[E.x + E.l, Y[0]], [E.x + E.l + 16, Y[0]]]);
  nonConnectee(E.x + E.l + 16, Y[0]);
  texte(E.x + E.l + 26, Y[0] - 8, "NC", "sch-note");
  busSignal("spi", function () {
    fil([[XG, Y[0]], [442, Y[0]]]);
    for (var k = 1; k < 4; k++) fil([[XG, Y[k]], [E.x + E.l, Y[k]]]);
    fil([[E.x - 25, Y[2]], [E.x, Y[2]]]);
    fil([[E.x - 25, Y[3]], [E.x, Y[3]]]);
  });
  etiquette(442, Y[0], "CSB", "gauche");
  etiquette(E.x - 25, Y[2], "MOSI", "gauche");
  etiquette(E.x - 25, Y[3], "SCK", "gauche");
  branche("epaper-vcc", "U2", function () {
    fil([[E.x - 25, Y[0]], [E.x, Y[0]]]);
    fil([[E.x, Y[1]], [E.x - 40, Y[1]]]);
    masse(E.x - 40, Y[1]);
  });
  etiquette(E.x - 25, Y[0], "+3V3", "gauche");

  // ---- Reed (sur la fourche), connecteur J2, R8 ----------------------
  ajouter('<rect x="96" y="410" width="189" height="132" class="sch-encadre"/>');
  texte(190, 518, "sur la fourche · câble 2 fils", "sch-note", "middle");
  branche("reed", "S1", function () {
    fil([[XG, Y[4]], [490, Y[4]]]);
    resistanceH(490, 410, Y[4], "R8", "1 kΩ");
    fil([[410, Y[4]], [310, Y[4]]]);
    composant("J2", function () {
      rect(302, 426, 16, 68, "sch-corps");
      ajouter('<circle class="sch-borne" cx="310" cy="' + Y[4] + '" r="4"/>');
      ajouter('<circle class="sch-borne" cx="310" cy="480" r="4"/>');
      texte(310, 418, "J2", "sch-ref", "middle");
    });
    fil([[310, Y[4]], [265, Y[4]]], "sch-cable");
    reed(265, 175, Y[4], "S1", "ILS PS-3150", 190, 502);
    fil([[175, Y[4]], [150, Y[4]], [150, 480], [310, 480]], "sch-cable");
    fil([[310, 480], [340, 480], [340, 500]]);
    masse(340, 500);
  });
  // Aimant de rayon (se place sous le reed quand celui-ci est fermé)
  ajouter('<g id="aimant" class="sch-aimant"><rect x="195" y="456" width="25" height="12" class="sch-pole-n"/>' +
    '<rect x="220" y="456" width="25" height="12" class="sch-pole-s"/>' +
    '<text x="207.5" y="465.5" class="sch-pole" text-anchor="middle">N</text>' +
    '<text x="232.5" y="465.5" class="sch-pole" text-anchor="middle">S</text></g>');
  mesure(190, 534, "val-S1", "middle");
  mesure(318, 466, "val-J2");
  mesure(450, 479, "val-R8", "middle");
  tension(360, 434, "J2", "middle");

  // ---- Boutons : tous deux sur D5 (SW2 à travers R12) -----------------
  branche("boutons", "D5", function () { fil([[XG, Y[5]], [470, Y[5]]]); });
  noeud(470, Y[5]);
  branche("sw1", "SW1", function () {
    fil([[470, Y[5]], [370, Y[5]], [370, 600]]);
    boutonV(370, 600, 660, "SW1", "bouton 1");
    fil([[370, 660], [370, 680]]);
    masse(370, 680);
  });
  branche("sw2", "SW2", function () {
    resistanceV(470, Y[5], 590, "R12", "2,2 kΩ", false, true);
    boutonV(470, 590, 650, "SW2", "bouton 2");
    fil([[470, 650], [470, 670]]);
    masse(470, 670);
  });
  mesure(384, 657, "val-SW1");
  mesure(484, 647, "val-SW2");
  mesure(457, 572, "val-R12", "end");
  // D6 : commande de la coupure de recharge (vers Q3, à droite)
  fil([[XG, Y[6]], [518, Y[6]]]);
  etiquette(518, Y[6], "D6", "gauche");

  // ---- Recharge : J1 → D2 (Schottky) → U4 (interrupteur) → broche 5V ---
  // U4 est passant tant que R10 tire sa broche EN au 5 V. Par grand froid,
  // D6 rend Q3 passant : EN tombe à 0, U4 coupe le 5 V du chargeur. Carte
  // éteinte, R11 bloque Q3 : la recharge reste toujours possible.
  var u4 = { x: 1040, y: 214, l: 80, h: 56 };
  branche("recharge", "D2", function () {
    fil([[1300, Y[0]], [1260, Y[0]]]);
    diode(1260, Y[0], 1180, Y[0], "D2", "SS14 Schottky", "schottky");
    fil([[1180, Y[0]], [u4.x + u4.l, Y[0]]]);
  });
  noeud(1150, Y[0]);
  composant("U4", function () {
    rect(u4.x, u4.y, u4.l, u4.h, "sch-corps sch-circuit");
    texte(u4.x, u4.y - 10, "U4", "sch-ref");
    texte(u4.x + 24, u4.y - 10, "TPS22918", "sch-val");
    texte(u4.x + u4.l - 6, Y[0] + 4, "IN", "sch-broche", "end");
    texte(u4.x + 6, Y[0] + 4, "OUT", "sch-broche");
    texte(u4.x + u4.l / 2, u4.y + u4.h - 6, "EN", "sch-broche", "middle");
  });
  branche("vbus-xiao", "U1.5V", function () { fil([[u4.x, Y[0]], [XD, Y[0]]]); });
  branche("tirage-en", "R10", function () {
    resistanceV(1150, Y[0], 345, "R10", "100 kΩ");
    fil([[1150, 345], [1080, 345]]);
  });
  noeud(1080, 345);
  fil([[1080, u4.y + u4.h], [1080, 345]]);
  var q3;
  branche("coupure", "R10", function () {
    fil([[1080, 345], [1080, 390]]);
    q3 = mosfetN(1030, 430, "Q3", "2N7002");
    masse(q3.source[0], q3.source[1]);
  });
  branche("grille-q3", "R11", function () {
    fil([[990, 430], [1030, 430]]);
    resistanceV(1005, 430, 492, "R11", "100 kΩ", false, true);
    masse(1005, 492);
  });
  noeud(1005, 430);
  etiquette(990, 430, "D6", "gauche");
  composant("J1", function () {
    rect(1300, Y[0] - 20, 40, 90, "sch-corps sch-circuit");
    ajouter('<circle class="sch-borne" cx="1300" cy="' + Y[0] + '" r="4"/>');
    ajouter('<circle class="sch-borne" cx="1300" cy="' + Y[1] + '" r="4"/>');
    texte(1320, Y[0] + 4, "1", "sch-broche", "middle");
    texte(1320, Y[1] + 4, "2", "sch-broche", "middle");
    texte(1352, Y[0] - 4, "J1", "sch-ref");
    texte(1352, Y[0] + 12, "connecteur", "sch-val");
    texte(1352, Y[0] + 27, "magnétique", "sch-val");
    texte(1352, Y[0] + 42, "recharge 5 V", "sch-val");
  });
  branche("recharge-retour", "J1", function () {
    masse(1260, Y[1] + 10);
    fil([[1260, Y[1] + 10], [1260, Y[1]], [1300, Y[1]]]);
  });
  tension(1280, Y[0] - 6, "V5EXT", "middle");
  tension(1150, Y[0] - 6, "V5D", "middle");
  tension(1074, 335, "EN4", "end");
  tension(1026, 420, "G3", "end");
  mesure(1220, 286, "val-D2", "middle");
  mesure(1352, Y[0] + 60, "val-J1");
  mesure(1080, 290, "val-U4", "middle");
  mesure(1163, 316, "val-R10");
  mesure(1098, 458, "val-Q3");
  mesure(992, 470, "val-R11", "end");

  // ---- GND, 3V3, bus SPI côté U1 --------------------------------------
  fil([[XD, Y[1]], [850, Y[1]]]);
  masse(850, Y[1]);
  branche("sortie-3v3", "U1.3V3", function () { fil([[XD, Y[2]], [1000, Y[2]]]); });
  noeud(960, Y[2]);
  condensateurV(960, Y[2], Y[2] + 56, "C3", "100 nF");
  masse(960, Y[2] + 56);
  etiquette(1000, Y[2], "+3V3", "droite");
  mesure(978, 395, "val-C3");
  etiquette(XD, Y[3], "MOSI", "droite");
  etiquette(XD, Y[4], "MISO", "droite");
  etiquette(XD, Y[5], "SCK", "droite");

  // ---- LED d'alerte : D7 → R1 → LED1 → GND ----------------------------
  branche("led1", "LED1", function () {
    fil([[XD, Y[6]], [850, Y[6]]]);
    resistanceH(850, 930, Y[6], "R1", "270 Ω");
    fil([[930, Y[6]], [980, Y[6]]]);
    diode(980, Y[6], 1040, Y[6], "LED1", "rouge, alerte", "led", { couleur: "sch-lueur-rouge", textesDessous: true });
    fil([[1040, Y[6]], [1080, Y[6]], [1080, Y[6] + 16]]);
    masse(1080, Y[6] + 16);
  });
  tension(955, Y[6] - 8, "LED1A", "middle");
  mesure(890, 580, "val-R1", "middle");
  mesure(1010, 600, "val-LED1", "middle");

  // ---- Batterie -------------------------------------------------------
  branche("batterie", "BT1", function () {
    batterie(560, 700, 790, "BT1", ["LiPo 500 mAh", "3,7 V · 503035", "protection DW01"]);
    fil([[560, 700], [600, 700]]);
    masse(560, 790);
  });
  branche("bat-xiao", "U1.BAT", function () { fil([[600, 700], [600, YP]]); });
  noeud(600, 700);
  branche("vbat-eclairage", "Q2", function () { fil([[600, 700], [624, 700]]); });
  etiquette(624, 700, "+VBAT", "droite");
  masse(650, YP);
  tension(606, 724, "VBAT");
  mesure(580, 760, "val-BT1");

  // ---- Buzzer : NFC1 → R2 → Q1 ; +3V3 → BZ1 → Q1 → GND -----------------
  var yG1 = 900;
  branche("grille-q1", "R2", function () {
    fil([[710, YP], [710, yG1], [730, yG1]]);
    resistanceH(730, 810, yG1, "R2", "100 Ω");
    fil([[810, yG1], [845, yG1]]);
    resistanceV(845, yG1, yG1 + 70, "R4", "100 kΩ");
    masse(845, yG1 + 70);
  });
  noeud(845, yG1);
  fil([[845, yG1], [880, yG1]]);
  var q1;
  branche("buzzer", "BZ1", function () {
    fil([[800, 760], [930, 760]]);
    buzzer(930, 760, 860, "BZ1", "buzzer actif 3 V");
    q1 = mosfetN(880, yG1, "Q1", "AO3400A");
    masse(q1.source[0], q1.source[1]);
  });
  etiquette(800, 760, "+3V3", "gauche");
  noeud(930, 760);
  noeud(930, 860);
  branche("roue-libre", "D1", function () {
    fil([[930, 860], [1010, 860]]);
    diode(1010, 860, 1010, 760, "D1", "1N4148", "");
  });
  noeud(1010, 760);
  branche("decouplage-buzzer", "C2", function () {
    fil([[930, 760], [1080, 760]]);
    condensateurV(1080, 760, 820, "C2", "10 µF", true);
    masse(1080, 820);
  });
  tension(842, 888, "G1", "end");
  tension(924, 872, "DQ1", "end");
  mesure(770, 940, "val-R2", "middle");
  mesure(858, 962, "val-R4");
  mesure(908, 840, "val-BZ1", "end");
  mesure(948, 927, "val-Q1");
  mesure(1026, 837, "val-D1");
  mesure(1098, 820, "val-C2");

  // ---- Éclairage : NFC2 → R3 → Q2 ; +VBAT → R6/R7 → LED2/LED3 → Q2 ---
  var yG2 = 680;
  branche("grille-q2", "R3", function () {
    fil([[760, YP], [760, yG2], [1080, yG2]]);
    resistanceH(1080, 1160, yG2, "R3", "100 Ω");
    fil([[1160, yG2], [1190, yG2]]);
    resistanceV(1190, yG2, yG2 + 70, "R5", "100 kΩ");
    masse(1190, yG2 + 70);
  });
  noeud(1190, yG2);
  fil([[1190, yG2], [1220, yG2]]);
  var xA = 1270, xB = 1370, yHaut = 460;
  branche("eclairage", "Q2", function () {
    fil([[1320, 440], [1320, yHaut]]);
    var q2 = mosfetN(1220, yG2, "Q2", "AO3400A");
    fil([[xA, 620], [xA, q2.drain[1]]]);
    masse(q2.source[0], q2.source[1]);
  });
  etiquette(1320, 440, "+VBAT", "droite");
  noeud(1320, yHaut);
  branche("led2", "LED2", function () {
    fil([[1320, yHaut], [xA, yHaut], [xA, 480]]);
    resistanceV(xA, 480, 560, "R6", "150 Ω");
    diode(xA, 560, xA, 620, "LED2", "blanche", "led", { couleur: "sch-lueur-blanche" });
  });
  branche("led3", "LED3", function () {
    fil([[1320, yHaut], [xB, yHaut], [xB, 480]]);
    resistanceV(xB, 480, 560, "R7", "150 Ω");
    diode(xB, 560, xB, 620, "LED3", "blanche", "led", { couleur: "sch-lueur-blanche" });
    fil([[xB, 620], [xA, 620]]);
  });
  noeud(xA, 620);
  texte(1320, 790, "éclairage latéral : 2 LED blanches", "sch-note", "middle");
  texte(1320, 805, "alimentées par la batterie", "sch-note", "middle");
  tension(1187, 668, "G2", "end");
  tension(1276, 636, "DQ2");
  tension(1262, 556, "LED2A", "end");
  tension(1362, 556, "LED3A", "end");
  mesure(1120, 720, "val-R3", "middle");
  mesure(1203, 742, "val-R5");
  mesure(1283, 547, "val-R6");
  mesure(1383, 547, "val-R7");
  mesure(1228, 600, "val-LED2", "end");
  mesure(1386, 617, "val-LED3");
  mesure(1288, 707, "val-Q2");

  // ---- U3 : baromètre BMP280, sur le bus SPI de l'écran ----------------
  // SDO (sa sortie de données) arrive sur D9, la broche MISO jusqu'ici
  // inutilisée ; CSB (sélection) sur D0, libérée par le fil BUSY.
  var B = { x: 470, y: 856, l: 140, h: 150 };
  var yB = [880, 915, 950, 985];
  composant("U3", function () {
    rect(B.x, B.y, B.l, B.h, "sch-corps sch-circuit");
    texte(B.x, B.y - 12, "U3", "sch-ref");
    texte(B.x + 26, B.y - 12, "baromètre BMP280 (SPI)", "sch-val");
    ["VCC", "GND", "SCL", "SDA"].forEach(function (n, k) { texte(B.x + 10, yB[k] + 4, n, "sch-broche"); });
    ["CSB", "SDO"].forEach(function (n, k) { texte(B.x + B.l - 10, yB[k] + 4, n, "sch-broche", "end"); });
    texte(B.x + B.l - 10, yB[3] + 4, "sous l'évent", "sch-broche sch-discret", "end");
    mesure(B.x + B.l - 10, yB[2] + 4, "val-U3", "end");
  });
  branche("barometre-vcc", "U3", function () {
    fil([[440, yB[0]], [B.x, yB[0]]]);
    fil([[B.x, yB[1]], [445, yB[1]]]);
    masse(445, yB[1]);
  });
  etiquette(440, yB[0], "+3V3", "gauche");
  busSignal("spi", function () {
    fil([[440, yB[2]], [B.x, yB[2]]]);
    fil([[440, yB[3]], [B.x, yB[3]]]);
    fil([[650, yB[0]], [B.x + B.l, yB[0]]]);
    fil([[B.x + B.l, yB[1]], [650, yB[1]]]);
  }, "barometre");
  etiquette(440, yB[2], "SCK", "gauche");
  etiquette(440, yB[3], "MOSI", "gauche");
  etiquette(650, yB[0], "CSB", "droite");
  etiquette(650, yB[1], "MISO", "droite");

  // ---- Option : tirage externe du reed (non monté) ---------------------
  var oX = 40, oY = 836;
  ajouter('<rect x="' + oX + '" y="' + oY + '" width="300" height="180" class="sch-encadre"/>');
  texte(oX + 12, oY + 22, "Option reed (non montée par défaut)", "sch-ref");
  branche("option-reed", "R9", function () {
    fil([[oX + 70, oY + 48], [oX + 110, oY + 48]], "sch-dnp");
    resistanceV(oX + 110, oY + 48, oY + 108, "R9", "1 MΩ", true);
    fil([[oX + 110, oY + 108], [oX + 230, oY + 108]], "sch-dnp");
  });
  etiquette(oX + 70, oY + 48, "+3V3", "gauche");
  noeud(oX + 170, oY + 108);
  branche("option-c1", "C1", function () {
    condensateurV(oX + 170, oY + 108, oY + 138, "C1", "10 nF", false, true);
    masse(oX + 170, oY + 138);
  });
  etiquette(oX + 230, oY + 108, "D4", "droite");
  texte(oX + 12, oY + 172, "si montée : REED_PULLUP_INTERNE = false", "sch-note");
  mesure(oX + 98, oY + 84, "val-R9", "end");
  mesure(oX + 188, oY + 152, "val-C1");

  // ---- Cartouche ------------------------------------------------------
  var cX = L - 470, cY = H - 120;
  ajouter('<rect x="' + cX + '" y="' + cY + '" width="454" height="104" class="sch-cadre"/>');
  trait([[cX, cY + 36], [cX + 454, cY + 36]], "sch-cadre-trait");
  trait([[cX + 310, cY], [cX + 310, cY + 104]], "sch-cadre-trait");
  texte(cX + 12, cY + 24, "Boîtier de guidon TPMS-01", "sch-ref");
  texte(cX + 12, cY + 60, "BTS CIEL IR · épreuve E6", "sch-val");
  texte(cX + 12, cY + 82, "Thibault MORRETTON", "sch-val");
  texte(cX + 322, cY + 24, "RÉV. C", "sch-ref");
  texte(cX + 322, cY + 60, "24/10/2026", "sch-val");
  texte(cX + 322, cY + 82, "feuille 1/1", "sch-val");

  return elements.join("\n");
}

// ---------------------------------------------------------------------
// Feuille de style (limitée à #schema-tpms)
// ---------------------------------------------------------------------
function feuilleDeStyle() {
  var r = [
    ".sch-fond{fill:#fff}",
    ".sch-cadre{fill:none;stroke:" + ENCRE + ";stroke-width:1.5}",
    ".sch-cadre-trait{fill:none;stroke:" + ENCRE + ";stroke-width:1}",
    ".sch-encadre{fill:none;stroke:#8c887d;stroke-width:1;stroke-dasharray:4 3}",
    ".sch-fil,.sch-cable,.sch-fleche,.sch-fil-symbole,.sch-trait{fill:none;stroke:" + ENCRE + ";stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}",
    ".sch-cable{stroke-dasharray:9 3}",
    ".sch-dnp{fill:none;stroke:" + ENCRE + ";stroke-width:1.4;stroke-dasharray:5 4}",
    ".sch-fleche{stroke-width:1.2}",
    ".sch-armature{fill:none;stroke:" + ENCRE + ";stroke-width:2.6;stroke-linecap:butt}",
    ".sch-pointille{stroke-dasharray:4 3}",
    ".sch-epais{stroke-width:4.5}",
    ".sch-corps{fill:#fff;stroke:" + ENCRE + ";stroke-width:1.6}",
    ".sch-dnp-corps{stroke-dasharray:5 4}",
    ".sch-circuit{fill:#f7f5ef}",
    ".sch-contour,.sch-ampoule{fill:none;stroke:" + ENCRE + ";stroke-width:1.2}",
    ".sch-borne{fill:#fff;stroke:" + ENCRE + ";stroke-width:1.4}",
    ".sch-noeud{fill:" + ENCRE + "}",
    ".sch-croix{fill:none;stroke:" + ROUGE + ";stroke-width:2}",
    ".sch-etiquette{fill:#fff;stroke:" + ROUGE + ";stroke-width:1.3}",
    "text{font-family:'IBM Plex Mono',Consolas,'Courier New',monospace;font-size:12px;fill:" + ENCRE + "}",
    ".sch-titre{font-family:'IBM Plex Sans Condensed','Arial Narrow',sans-serif;font-size:24px;font-weight:600}",
    ".sch-ref{font-weight:600}",
    ".sch-val{fill:#5e5b53}",
    ".sch-discret{fill:#8c887d;font-size:10.5px}",
    ".sch-net{fill:" + ROUGE + ";font-size:11px;font-weight:600}",
    ".sch-note{fill:#5e5b53;font-size:11px}",
    ".sch-petit{font-size:13px;font-weight:600}",
    ".sch-pole{font-size:9px;font-weight:600}",
    ".sch-pole-n{fill:#e9b6aa;stroke:" + ENCRE + ";stroke-width:1}",
    ".sch-pole-s{fill:#fff;stroke:" + ENCRE + ";stroke-width:1}",
    ".sch-mesure{font-size:10.5px;fill:" + ROUGE + ";font-weight:600}",
    ".sch-tension{fill:#2b5c8a}",
    ".sch-resume{font-size:12px;font-weight:600;fill:" + ENCRE + "}",
    ".sch-alertes{font-size:11px;fill:" + ROUGE + ";font-weight:600}",
    // États par défaut (document imprimé : tout au repos)
    ".sch-lueur{opacity:0;stroke:none}",
    ".sch-lueur-rouge{fill:#ff6a4d}",
    ".sch-lueur-blanche{fill:#ffe27a}",
    ".sch-canal{display:none;fill:none;stroke:" + ROUGE + ";stroke-width:2.6}",
    ".sch-lame-fermee{display:none}",
    ".sch-ondes{display:none}",
    ".sch-ondes path{fill:none;stroke:" + ROUGE + ";stroke-width:1.4}",
    ".sch-aimant{transform:translateX(-40px);transition:transform .12s linear}",
    ".sch-poussoir{transition:transform .08s}",
    // Animation (ajoutée par schemaMettreAJour)
    ".sch-conducteur.sch-parcouru{stroke:" + ROUGE + ";stroke-width:var(--epaisseur,2.2px);opacity:var(--opacite,1);" +
      "stroke-dasharray:7 5;animation:sch-defile var(--duree,1s) linear infinite}",
    ".sch-conducteur.sch-parcouru.sch-cable{stroke-dasharray:7 5}",
    ".sch-conducteur.sch-parcouru.sch-inverse{animation-direction:reverse}",
    ".sch-conducteur.sch-signal-actif{stroke:#2b5c8a;stroke-dasharray:2 4;animation:sch-defile .5s linear infinite}",
    "@keyframes sch-defile{to{stroke-dashoffset:-12}}",
    ".sch-passant .sch-canal{display:inline}",
    ".sch-passant .sch-contour{stroke:" + ROUGE + ";stroke-width:1.8}",
    ".sch-ferme .sch-lame-fermee{display:inline;stroke:" + ROUGE + "}",
    ".sch-ferme .sch-lame-ouverte{display:none}",
    ".sch-aimant.sch-proche{transform:none}",
    ".sch-appuye .sch-poussoir{transform:translateX(10px)}",
    ".sch-appuye .sch-poussoir .sch-armature{stroke:" + ROUGE + "}",
    ".sch-sonne .sch-ondes{display:inline;animation:sch-clignote .25s steps(2) infinite}",
    ".sch-sonne .sch-vibreur{animation:sch-vibre .06s linear infinite}",
    "@keyframes sch-vibre{0%{transform:translate(-1px,0)}50%{transform:translate(1px,0)}100%{transform:translate(-1px,0)}}",
    "@keyframes sch-clignote{50%{opacity:.35}}",
    ".sch-allume .sch-triangle{fill:#fde3d9}",
    ".sch-rafraichit>rect.sch-circuit{fill:#fff4d6}",
    ".sch-en-charge>rect.sch-circuit{fill:#eaf2e3}",
    ".sch-hors-tension>rect.sch-circuit{fill:#e4e2dc}",
    "@media print{.sch-conducteur{animation:none!important}}",
    "@media (prefers-reduced-motion:reduce){.sch-conducteur,.sch-vibreur,.sch-ondes{animation:none!important}}"
  ];
  return r.map(function (regle) {
    if (regle.charAt(0) === "@") {
      // Règles @media : on préfixe les sélecteurs qu'elles contiennent ;
      // @keyframes reste tel quel.
      if (regle.indexOf("@media") === 0) return regle.replace(/\{(\.[^{]+)\{/, "{#schema-tpms $1{");
      return regle;
    }
    var i = regle.indexOf("{");
    var selecteurs = regle.slice(0, i).split(",").map(function (s) { return "#schema-tpms " + s; }).join(",");
    return selecteurs + regle.slice(i);
  }).join("");
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

// Thème sombre pour l'interface du simulateur : on remplace chaque
// couleur du thème clair (document imprimé) par son équivalent sombre.
var COULEURS_SOMBRES = [
  ["#fff4d6", "#3a2e10"], ["#eaf2e3", "#0f2e22"], ["#e4e2dc", "#26262b"], ["#fde3d9", "#3b2566"],
  ["#f7f5ef", "#16161a"], ["#e9b6aa", "#f87171"], ["#2b5c8a", "#60a5fa"],
  ["#8c887d", "#6b6b73"], ["#5e5b53", "#a1a1aa"],
  [ENCRE, "#d4d4d8"], [ROUGE, "#a78bfa"], ["#fff", "#0b0b0d"]
];
function themeSombre(css) {
  COULEURS_SOMBRES.forEach(function (c) { css = css.split(c[0]).join(c[1]); });
  return css.split("'IBM Plex Mono',Consolas").join("'JetBrains Mono','IBM Plex Mono',Consolas")
    .split("'IBM Plex Sans Condensed','Arial Narrow'").join("'Inter','Segoe UI'");
}

// Chaîne SVG complète du schéma. options.theme = "sombre" pour la page.
TPMS.schemaSvg = function (options) {
  var corps = dessiner();
  var css = feuilleDeStyle();
  if (options && options.theme === "sombre") css = themeSombre(css);
  return '<svg xmlns="http://www.w3.org/2000/svg" id="schema-tpms" viewBox="0 0 ' + L + " " + H +
    '" width="' + L + '" height="' + H + '" font-family="Consolas, monospace">' +
    "<title>Schéma électrique du boîtier de guidon TPMS</title><style>" + css + "</style>\n" +
    corps + "\n</svg>\n";
};

// Liste des repères du schéma (pour les tests et la documentation).
TPMS.SCHEMA_COMPOSANTS = ["U1", "U2", "U3", "U4", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9",
  "R10", "R11", "R12", "C1", "C2", "C3", "D1", "D2", "LED1", "LED2", "LED3", "Q1", "Q2", "Q3", "BZ1", "BT1",
  "SW1", "SW2", "S1", "J1", "J2"];
TPMS.SCHEMA_NOEUDS = {           // id de tension → nom de l'équipotentielle sur le schéma
  VBAT: "+VBAT", V3V3: "+3V3", VBUS: "5V (VBUS)", V5EXT: "J1 broche 1", V5D: "entrée de U4", GND: "GND",
  D0: "CSB (baromètre)", D1: "RES", D2: "DC", D3: "CS", D4: "reed (côté XIAO)", D5: "boutons 1 et 2", D6: "coupure de recharge",
  D7: "LED d'alerte", D8: "SCK", D9: "MISO (SDO du baromètre)", D10: "MOSI",
  NFC1: "commande buzzer", NFC2: "commande éclairage", G1: "grille Q1", G2: "grille Q2",
  G3: "grille Q3", EN4: "EN de U4 (0 = recharge coupée)",
  DQ1: "drain Q1 (− du buzzer)", DQ2: "drain Q2 (cathodes LED2/LED3)",
  LED1A: "anode LED1", LED2A: "anode LED2", LED3A: "anode LED3", J2: "J2 broche 1 (reed)"
};

// Mise en forme française d'un courant et d'une tension.
function virgule(x, d) { return x.toFixed(d).replace(".", ","); }
TPMS.schemaTexteCourant = function (a) {
  var v = Math.abs(a), signe = a < 0 ? "−" : "";
  if (v < 1e-9) return "0";
  if (v < 1e-6) return signe + virgule(v * 1e9, 0) + " nA";
  if (v < 1e-3) return signe + virgule(v * 1e6, v < 1e-5 ? 2 : 1) + " µA";
  return signe + virgule(v * 1e3, v < 1e-2 ? 2 : 1) + " mA";
};
TPMS.schemaTexteTension = function (v) {
  if (v === null || v === undefined || isNaN(v)) return "en l'air";
  if (Math.abs(v) < 0.001) return "0 V";
  if (Math.abs(v) < 0.1) return virgule(v * 1000, 1) + " mV";
  return virgule(v, 2) + " V";
};

// Aspect d'un fil parcouru par le courant I (A). Le courant varie de
// 1 µA (veille) à 100 mA (recharge) : 5 ordres de grandeur. Une échelle
// proportionnelle rendrait les petits courants invisibles ; on utilise
// donc une échelle LOGARITHMIQUE : chaque fois que le courant est
// multiplié par 10, les pointillés vont 14 px/s plus vite et le trait
// s'épaissit de 0,45 px. Retourne null si le courant est négligeable.
TPMS.schemaStyleCourant = function (I) {
  var a = Math.abs(I);
  if (!(a >= 0.3e-6)) return null;
  var decades = Math.max(0, Math.log(a / 1e-6) / Math.LN10);   // 0 à 1 µA, 3 à 1 mA, 5 à 100 mA
  var vitesse = 4 + 14 * decades;                              // px/s
  return {
    dureeS: 12 / vitesse,                                      // une période du pointillé = 12 px
    epaisseurPx: 1.6 + 0.45 * decades,
    opacite: Math.min(1, 0.45 + 0.15 * decades),
    inverse: I < 0
  };
};

function basculer(el, classe, oui) {
  if (!el) return;
  if (oui) el.classList.add(classe); else el.classList.remove(classe);
}

// Anime un schéma déjà inséré dans la page avec le résultat de
// TPMS.circuitResoudre. Appelée à chaque image : on garde en cache la
// liste des éléments à modifier.
TPMS.schemaMettreAJour = function (racine, etat) {
  if (!racine || !etat) return;
  var cache = racine.__tpmsCache;
  if (!cache) {
    cache = racine.__tpmsCache = {
      fils: Array.prototype.slice.call(racine.querySelectorAll(".sch-conducteur[data-courant]")),
      signaux: Array.prototype.slice.call(racine.querySelectorAll(".sch-conducteur[data-signal]")),
      par: {}
    };
  }
  function trouver(id) {
    if (!(id in cache.par)) cache.par[id] = racine.querySelector("#" + id.replace(/\./g, "\\."));
    return cache.par[id];
  }
  var c = etat.courants || {}, t = etat.tensions || {}, s = etat.etats || {};

  // 1. Fils parcourus par un courant
  cache.fils.forEach(function (f) {
    var cle = f.getAttribute("data-courant");
    var st = TPMS.schemaStyleCourant(c[cle] || 0);
    basculer(f, "sch-parcouru", !!st);
    if (st) {
      basculer(f, "sch-inverse", st.inverse);
      f.style.setProperty("--duree", st.dureeS.toFixed(3) + "s");
      f.style.setProperty("--epaisseur", st.epaisseurPx.toFixed(2) + "px");
      f.style.setProperty("--opacite", st.opacite.toFixed(2));
    }
  });
  // 2. Bus SPI de l'écran (signaux logiques, pas de puissance)
  cache.signaux.forEach(function (f) { basculer(f, "sch-signal-actif", !!s.spiActif); });

  // 3. Valeurs des composants et tensions des nœuds
  TPMS.SCHEMA_COMPOSANTS.forEach(function (ref) {
    var el = trouver("val-" + ref);
    if (el && ref in c) el.textContent = TPMS.schemaTexteCourant(c[ref]);
  });
  var bt = trouver("val-BT1");
  if (bt && "BT1" in c) {
    bt.textContent = (c.BT1 < 0 ? "charge " : "") + TPMS.schemaTexteCourant(Math.abs(c.BT1)) +
      (s.batterieCoupee ? " · coupée" : "");
  }
  Object.keys(TPMS.SCHEMA_NOEUDS).forEach(function (n) {
    var el = trouver("tension-" + n);
    if (el && n in t) el.textContent = TPMS.schemaTexteTension(t[n]);
  });
  var u1 = trouver("val-U1");
  if (u1) u1.textContent = "nRF " + TPMS.schemaTexteCourant(c.U1 || 0) +
    (s.chargeurPhase && s.chargeurPhase !== "absent" ? " · charge " + s.chargeurPhase.toUpperCase() : "");

  // 4. Composants qui changent d'aspect
  ["LED1", "LED2", "LED3"].forEach(function (ref) {
    var l = trouver("lueur-" + ref), i = c[ref] || 0;
    if (l) l.style.opacity = Math.min(0.85, i / 0.006).toFixed(2);
    basculer(trouver("comp-" + ref), "sch-allume", i > 0.3e-3);
  });
  basculer(trouver("comp-BZ1"), "sch-sonne", !!s.buzzerSonne);
  basculer(trouver("comp-Q1"), "sch-passant", !!s.q1Passant);
  basculer(trouver("comp-Q2"), "sch-passant", !!s.q2Passant);
  basculer(trouver("comp-Q3"), "sch-passant", !!s.q3Passant);
  basculer(trouver("comp-S1"), "sch-ferme", !!s.reedFerme);
  basculer(trouver("aimant"), "sch-proche", !!s.reedFerme);
  basculer(trouver("comp-SW1"), "sch-appuye", (c.SW1 || 0) > 0 || !!s.bouton1);
  basculer(trouver("comp-SW2"), "sch-appuye", (c.SW2 || 0) > 0 || !!s.bouton2);
  basculer(trouver("comp-U2"), "sch-rafraichit", !!s.ecranRafraichit);
  basculer(trouver("comp-U1"), "sch-en-charge", !!s.enCharge);
  basculer(trouver("comp-U1"), "sch-hors-tension", s.nrfAlimente === false);

  // 5. Résumé et alertes
  var resume = trouver("mesure-resume");
  if (resume) {
    resume.textContent = "VBAT " + TPMS.schemaTexteTension(t.VBAT) + " · 3V3 " + TPMS.schemaTexteTension(t.V3V3) +
      " · batterie " + (etat.courantBatterieA < 0 ? "en charge " : "") +
      TPMS.schemaTexteCourant(Math.abs(etat.courantBatterieA || 0)) +
      " · P = " + virgule((etat.puissanceW || 0) * 1000, 2) + " mW";
  }
  var zone = trouver("alertes");
  if (zone) {
    var cle = (etat.alertes || []).join("|");
    if (zone.__cle !== cle) {
      zone.__cle = cle;
      while (zone.firstChild) zone.removeChild(zone.firstChild);
      (etat.alertes || []).slice(0, 4).forEach(function (a, k) {
        var ts = zone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
        ts.setAttribute("x", String(L - 30));
        ts.setAttribute("dy", k === 0 ? "0" : "15");
        ts.textContent = "⚠ " + a;
        zone.appendChild(ts);
      });
    }
  }
};
})();
