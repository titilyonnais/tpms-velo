// =====================================================================
// fuite.js — Détection de fuite lente
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++ dans le firmware et dans l'application.
//
// Une fuite lente se voit mal sur une seule mesure : la pression baisse
// de quelques centièmes de bar par heure, noyés dans le bruit du capteur.
// On garde donc un historique de mesures espacées (une toutes les 30 s)
// et on calcule la PENTE de la droite qui passe au mieux par ces points
// (régression linéaire, méthode des moindres carrés).
//
//   pente < 0  → la pression baisse
//   pente en bar/heure, comparée à un seuil (ex. -0,15 bar/h)
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.HISTO_TAILLE = 40;            // 40 points × 30 s = 20 minutes
TPMS.HISTO_ECART_MS = 30000;       // une mesure gardée toutes les 30 s
TPMS.HISTO_DUREE_MIN_MS = 300000;  // au moins 5 min de données pour conclure
TPMS.HISTO_SAUT_REGONFLAGE = 0.2;  // hausse brusque de 0,2 bar = regonflage

// En C : deux tableaux de taille fixe et un compteur.
TPMS.creerHistorique = function () {
  return { tMs: [], pression: [] };
};

TPMS.historiqueVider = function (h) {
  h.tMs = [];
  h.pression = [];
};

// Ajoute une mesure si la précédente date d'au moins 30 s.
// Retourne true si la mesure a été gardée.
TPMS.historiqueAjouter = function (h, tMs, pressionBar) {
  var n = h.tMs.length;
  if (n > 0) {
    if (tMs - h.tMs[n - 1] < TPMS.HISTO_ECART_MS) return false;
    // Une forte hausse veut dire que le cycliste a regonflé :
    // l'ancienne courbe n'a plus de sens, on repart de zéro.
    if (pressionBar - h.pression[n - 1] > TPMS.HISTO_SAUT_REGONFLAGE) {
      TPMS.historiqueVider(h);
    }
  }
  h.tMs.push(tMs);
  h.pression.push(pressionBar);
  if (h.tMs.length > TPMS.HISTO_TAILLE) {   // on oublie la plus ancienne
    h.tMs.shift();
    h.pression.shift();
  }
  return true;
};

// Pente de la droite des moindres carrés, en bar par heure.
// Retourne 0 tant qu'il n'y a pas assez de données.
//
//   pente = Σ (t - tMoyen)(p - pMoyen) / Σ (t - tMoyen)²
TPMS.historiquePenteBarH = function (h) {
  var n = h.tMs.length;
  if (n < 5) return 0;
  if (h.tMs[n - 1] - h.tMs[0] < TPMS.HISTO_DUREE_MIN_MS) return 0;
  return TPMS.penteMoindresCarresParHeure(h.tMs, h.pression);
};

// Calcul de la pente proprement dit (réutilisé par l'application, qui
// cherche des fuites beaucoup plus lentes sur plusieurs jours).
// tMs : instants en millisecondes ; valeurs : mesures correspondantes.
// Retourne la pente en unité de mesure par heure.
TPMS.penteMoindresCarresParHeure = function (tMs, valeurs) {
  var n = tMs.length;
  if (n < 2) return 0;

  // On travaille en heures, comptées depuis le premier point.
  // Cela évite de manipuler de très grands nombres
  // (important en C avec des float).
  var t0 = tMs[0];
  var sommeT = 0, sommeP = 0;
  for (var i = 0; i < n; i++) {
    sommeT += (tMs[i] - t0) / 3600000;
    sommeP += valeurs[i];
  }
  var tMoyen = sommeT / n;
  var pMoyen = sommeP / n;

  var numerateur = 0, denominateur = 0;
  for (var j = 0; j < n; j++) {
    var dt = (tMs[j] - t0) / 3600000 - tMoyen;
    numerateur += dt * (valeurs[j] - pMoyen);
    denominateur += dt * dt;
  }
  if (denominateur === 0) return 0;
  return numerateur / denominateur;
};
