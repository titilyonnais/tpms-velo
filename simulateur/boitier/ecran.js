// =====================================================================
// ecran.js — Mise en page de l'écran du boîtier (200 × 200 pixels)
// ---------------------------------------------------------------------
// Une seule fonction : dessinerEcran(e, vue). Elle transforme une "vue"
// (les valeurs à afficher) en pixels. Elle ne décide de rien : c'est
// boitier.js qui prépare la vue. Cette fonction sera copiée telle quelle
// dans le firmware.
//
//   y = 0   ┌──────────────────────────────┐
//           │ TPMS  ECLAIRAGE     87% [▮▮ ]│  barre d'état
//   y = 14  ├──────────────┬───────────────┤
//           │    AVANT     │    ARRIERE    │
//           │    2.10      │     2.35      │  gros chiffres (taille 4)
//           │     bar      │      bar      │
//           │ 21°C PILE 95%│ 21°C PILE 94% │
//           │      OK      │ PRESSION BASSE│  ← colonne en négatif si alerte
//   y = 120 ├──────────────┴───────────────┤
//           │        23.4 km/h             │  page 1 : vitesse + distance
//           │ DIST  12.34 km               │  page 2 : stats du trajet
//           │                              │  + prochain regonflage prévu
//   y = 199 └──────────────────────────────┘
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.dessinerEcran = function (e, vue) {
  var N = TPMS.NOIR;
  TPMS.ecranEffacer(e);

  // ---- Barre d'état ----
  TPMS.ecranTexte(e, 3, 3, "TPMS", 1, N);
  if (vue.radioSaturee) {
    TPMS.ecranTexte(e, 34, 3, "SATURE", 1, N);   // inondation d'annonces
  } else if (vue.veille) {
    TPMS.ecranTexte(e, 34, 3, "VEILLE", 1, N);
  } else if (vue.eclairage) {
    TPMS.ecranTexte(e, 34, 3, "ECLAIRAGE", 1, N);
  }
  if (vue.appConnectee) TPMS.ecranTexte(e, 94, 3, "APP", 1, N);
  TPMS.dessinerBatterie(e, vue.batterieBoitierPct, vue.enCharge, vue.blocageCharge);
  TPMS.ecranLigneH(e, 0, 14, 200, N);

  // ---- Les deux roues ----
  TPMS.dessinerRoue(e, 0, 100, "AVANT", vue.roues.AV);
  TPMS.ecranLigneV(e, 100, 15, 105, N);
  TPMS.dessinerRoue(e, 101, 99, "ARRIERE", vue.roues.AR);
  TPMS.ecranLigneH(e, 0, 120, 200, N);

  // ---- Bas de l'écran : deux pages au choix (bouton 1) ----
  if (vue.page === 0) {
    TPMS.dessinerPageVitesse(e, vue);
  } else {
    TPMS.dessinerPageTrajet(e, vue);
  }

  // ---- Code d'appairage, par-dessus tout le reste ----
  if (vue.codeAppairage) TPMS.dessinerCodeAppairage(e, vue.codeAppairage);

  // ---- Changement sensible demandé par l'app, à confirmer ----
  if (vue.confirmation) TPMS.dessinerConfirmation(e, vue.confirmation);
};

// Fenêtre au centre de l'écran : ce que l'app veut changer, et comment
// répondre. Le cycliste voit exactement ce qu'il accepte.
TPMS.dessinerConfirmation = function (e, masque) {
  var N = TPMS.NOIR;
  TPMS.ecranRectPlein(e, 10, 40, 180, 120, TPMS.BLANC);
  TPMS.ecranCadre(e, 10, 40, 180, 120, N);
  TPMS.ecranCadre(e, 12, 42, 176, 116, N);
  TPMS.ecranTexteCentre(e, 100, 50, "CONFIRMER ?", 2, N);
  var lignes = TPMS.lignesSensibles(masque);
  for (var i = 0; i < lignes.length; i++) {
    TPMS.ecranTexteCentre(e, 100, 72 + 10 * i, lignes[i], 1, N);
  }
  TPMS.ecranTexteCentre(e, 100, 130, "APPUI LONG BOUTON 2 : OUI", 1, N);
  TPMS.ecranTexteCentre(e, 100, 142, "AUTRE BOUTON : NON", 1, N);
};

// Fenêtre au centre de l'écran avec le code à taper sur le téléphone.
TPMS.dessinerCodeAppairage = function (e, code) {
  var N = TPMS.NOIR;
  TPMS.ecranRectPlein(e, 14, 52, 172, 96, TPMS.BLANC);
  TPMS.ecranCadre(e, 14, 52, 172, 96, N);
  TPMS.ecranCadre(e, 16, 54, 168, 92, N);
  TPMS.ecranTexteCentre(e, 100, 64, "APPAIRAGE", 2, N);
  TPMS.ecranTexteCentre(e, 100, 90, code, 3, N);
  TPMS.ecranTexteCentre(e, 100, 126, "A SAISIR SUR LE TELEPHONE", 1, N);
};

// Pourcentage + petite pile dessinée, en haut à droite.
// blocage = "FROID" ou "CHAUD" quand la recharge est coupée (barometre.js).
TPMS.dessinerBatterie = function (e, pct, enCharge, blocage) {
  var N = TPMS.NOIR;
  var prefixe = blocage ? blocage + " " : (enCharge ? "CHG " : "");
  var texte = prefixe + Math.round(pct) + "%";
  TPMS.ecranTexteDroite(e, 172, 3, texte, 1, N);
  TPMS.ecranCadre(e, 176, 3, 18, 9, N);
  TPMS.ecranRectPlein(e, 194, 5, 2, 5, N);              // le "téton" de la pile
  TPMS.ecranRectPlein(e, 178, 5, Math.round(14 * pct / 100), 5, N);
};

// Une colonne : nom, pression en gros, température, pile du capteur, état.
TPMS.dessinerRoue = function (e, x0, largeur, nom, roue) {
  var N = TPMS.NOIR;
  var centre = x0 + Math.floor(largeur / 2);

  TPMS.ecranTexteCentre(e, centre, 20, nom, 2, N);

  var pression = roue.pressionBar === null ? "-.--" : roue.pressionBar.toFixed(2);
  TPMS.ecranTexteCentre(e, centre, 40, pression, 4, N);
  TPMS.ecranTexteCentre(e, centre, 72, "bar", 1, N);

  if (roue.pressionBar !== null) {
    TPMS.ecranTexte(e, x0 + 5, 86, Math.round(roue.temperatureC) + "°C", 1, N);
    TPMS.ecranTexteDroite(e, x0 + largeur - 5, 86, "PILE " + roue.batteriePct + "%", 1, N);
  }

  TPMS.ecranTexteCentre(e, centre, 102, TPMS.texteEtat(roue.etat), 1, N);

  // En alerte, toute la colonne passe en négatif (fond noir, texte blanc).
  if (TPMS.estAlerte(roue.etat)) {
    TPMS.ecranInverser(e, x0, 15, largeur, 105);
  }
};

TPMS.dessinerPageVitesse = function (e, vue) {
  var N = TPMS.NOIR;
  TPMS.ecranTexteDroite(e, 100, 128, vue.vitesseKmh.toFixed(1), 4, N);
  TPMS.ecranTexte(e, 108, 142, "km/h", 2, N);

  var distance = vue.distanceKm < 100 ? vue.distanceKm.toFixed(2) : vue.distanceKm.toFixed(1);
  TPMS.ecranTexte(e, 4, 177, "DIST", 1, N);
  TPMS.ecranTexteDroite(e, 100, 172, distance, 2, N);
  TPMS.ecranTexte(e, 108, 172, "km", 2, N);
};

TPMS.dessinerPageTrajet = function (e, vue) {
  var N = TPMS.NOIR;
  TPMS.ecranTexte(e, 4, 126, "MOY", 2, N);
  TPMS.ecranTexteDroite(e, 130, 126, vue.moyenneKmh.toFixed(1), 2, N);
  TPMS.ecranTexte(e, 136, 133, "km/h", 1, N);

  TPMS.ecranTexte(e, 4, 146, "MAX", 2, N);
  TPMS.ecranTexteDroite(e, 130, 146, vue.maxKmh.toFixed(1), 2, N);
  TPMS.ecranTexte(e, 136, 153, "km/h", 1, N);

  TPMS.ecranTexte(e, 4, 166, "TPS", 2, N);
  TPMS.ecranTexteDroite(e, 130, 166, TPMS.dureeEnTexte(vue.dureeRoulageS), 2, N);

  TPMS.ecranTexte(e, 4, 182, "DISTANCE " + vue.distanceKm.toFixed(2) + " km", 1, N);
  // Prévision : dans combien de jours chaque pneu passera sous son seuil bas.
  TPMS.ecranTexte(e, 4, 192, "REGONFLER AV " + TPMS.texteJours(vue.roues.AV.joursRegonflage) +
    "  AR " + TPMS.texteJours(vue.roues.AR.joursRegonflage), 1, N);
};

// 4 965 s → "1:22:45"
TPMS.dureeEnTexte = function (secondes) {
  var s = Math.floor(secondes);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = s % 60;
  return h + ":" + (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
};
