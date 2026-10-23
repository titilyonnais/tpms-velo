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
// Au moins 10 min de données pour conclure. Avec 5 min, le bruit du
// capteur (±0,01 bar) donnait environ 1 fausse alerte pour 100 sorties.
TPMS.HISTO_DUREE_MIN_MS = 600000;
TPMS.HISTO_SAUT_REGONFLAGE = 0.2;  // hausse brusque de 0,2 bar = regonflage

// Compensation en température. Un pneu chauffé au soleil puis refroidi
// en roulant perd 0,3 bar sans perdre d'air : sans correction, le boîtier
// croyait à une fuite (défaut révélé par la simulation d'une semaine).
// Loi des gaz à volume constant : P / T est constant si l'air ne fuit pas.
// On ramène donc chaque mesure à 20 °C : P20 = P × 293,15 / (T + 273,15),
// en pression ABSOLUE (on ajoute puis on retire 1,013 bar).
// T est la température du capteur (dans le bouchon de valve) : elle suit
// l'air du pneu imparfaitement, la correction est donc partielle.
TPMS.pressionCompenseeBar = function (pressionRelBar, temperatureC) {
  var absolue = pressionRelBar + 1.01325;
  return absolue * 293.15 / (temperatureC + 273.15) - 1.01325;
};

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

// ---------------------------------------------------------------------
// Prévision du prochain regonflage (sur plusieurs jours)
// ---------------------------------------------------------------------
// Même une chambre à air en bon état perd de l'air : environ 0,03 bar
// par jour pour du butyle. L'historique ci-dessus ne couvre que 20 min ;
// pour prévoir QUAND la pression passera sous le seuil bas, on garde en
// plus un « relevé » au plus toutes les 3 h (en pratique : un par sortie),
// compensé en température, et on prolonge la droite des moindres carrés.
//
//   jours restants = (pression actuelle − seuil bas) / perte par jour
TPMS.RELEVES_TAILLE = 30;                  // ≈ 2 semaines à 2 sorties par jour
TPMS.RELEVE_ECART_MS = 3 * 3600000;        // au plus un relevé toutes les 3 h
TPMS.RELEVES_DUREE_MIN_MS = 2 * 86400000;  // au moins 2 jours de recul
TPMS.RELEVES_NB_MIN = 4;                   // et au moins 4 relevés
// Au-dessus de −0,005 bar/jour, la baisse est noyée dans le bruit du
// capteur (±0,01 bar) : on considère la pression comme stable.
TPMS.PENTE_STABLE_BAR_JOUR = -0.005;
TPMS.PREVISION_MAX_JOURS = 60;             // au-delà, on affiche « >60J »

TPMS.creerReleves = function () {
  return { tMs: [], pression: [] };
};

// Ajoute un relevé si le précédent date d'au moins 3 h.
// Un regonflage (hausse de plus de 0,2 bar) efface les anciens relevés.
TPMS.relevesAjouter = function (r, tMs, pressionBar) {
  var n = r.tMs.length;
  if (n > 0) {
    if (tMs - r.tMs[n - 1] < TPMS.RELEVE_ECART_MS) return false;
    if (pressionBar - r.pression[n - 1] > TPMS.HISTO_SAUT_REGONFLAGE) {
      r.tMs = [];
      r.pression = [];
    }
  }
  r.tMs.push(tMs);
  r.pression.push(pressionBar);
  if (r.tMs.length > TPMS.RELEVES_TAILLE) {
    r.tMs.shift();
    r.pression.shift();
  }
  return true;
};

// Jours avant d'atteindre le seuil bas, à perte constante.
// Infinity si la pression est stable, 0 si le seuil est déjà dépassé.
// (Aussi utilisée par l'application, avec son propre historique.)
TPMS.joursAvantSeuil = function (pressionBar, penteBarJour, seuilBasBar) {
  if (penteBarJour > TPMS.PENTE_STABLE_BAR_JOUR) return Infinity;
  var jours = (pressionBar - seuilBasBar) / -penteBarJour;
  return jours < 0 ? 0 : jours;
};

// Prévision à partir des relevés du boîtier.
// Retourne null tant qu'il n'y a pas assez de recul.
TPMS.predireRegonflage = function (r, seuilBasBar) {
  var n = r.tMs.length;
  if (n < TPMS.RELEVES_NB_MIN) return null;
  if (r.tMs[n - 1] - r.tMs[0] < TPMS.RELEVES_DUREE_MIN_MS) return null;
  var penteJour = TPMS.penteMoindresCarresParHeure(r.tMs, r.pression) * 24;
  return TPMS.joursAvantSeuil(r.pression[n - 1], penteJour, seuilBasBar);
};

// Texte court pour l'écran : "--" (pas encore de prévision), "12J", ">60J".
TPMS.texteJours = function (jours) {
  if (jours === null) return "--";
  if (jours > TPMS.PREVISION_MAX_JOURS) return ">" + TPMS.PREVISION_MAX_JOURS + "J";
  return Math.floor(jours) + "J";
};
