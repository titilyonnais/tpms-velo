// =====================================================================
// statistiques.js — Bilan par jour et par semaine
// ---------------------------------------------------------------------
// LOGIQUE PURE, utilisée par le simulateur (page Données) et réutilisable
// par l'application. Le boîtier, lui, n'en a pas besoin : il n'a ni la
// place ni l'utilité de garder des semaines de mesures.
//
// Valoriser la donnée, c'est transformer des milliers de points bruts
// (un par seconde en roulant) en quelques chiffres qui servent à décider :
// combien je roule, à quelle pression, combien de fois j'ai dû regonfler,
// combien de temps j'ai roulé en alerte.
//
// Chaque point doit contenir :
//   { tMs, jour, vitesseKmh, distanceKm, pAV, pAR, etatAV, etatAR, soc }
//   distanceKm : compteur de la sortie en cours (repart de 0 à chaque sortie)
//   pAV, pAR   : pression des pneus (bar)
//   soc        : état de charge de la batterie du boîtier (0 à 1)
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.STATS_ECART_MAX_MS = 60000;      // un trou plus long n'est pas compté comme du temps
TPMS.STATS_VITESSE_ROULAGE_KMH = 1;   // au-dessus : le vélo roule
TPMS.STATS_SAUT_REGONFLAGE_BAR = 0.2; // même règle que logique/fuite.js

TPMS.creerStatJour = function (jour) {
  return {
    jour: jour,
    km: 0,
    minutesRoulage: 0,
    minutesAlerte: 0,
    regonflages: 0,
    mAhConsommes: 0,
    // Pour la moyenne des pressions en roulant : somme pondérée par le temps
    sommePAV: 0, sommePAR: 0, dureePMs: 0,
    pMinAV: Infinity, pMinAR: Infinity
  };
};

// Parcourt les points dans l'ordre et remplit une case par jour.
// capaciteMah : capacité de la batterie du boîtier (500 mAh).
TPMS.statistiquesParJour = function (points, capaciteMah) {
  var jours = [];
  for (var i = 1; i < points.length; i++) {
    var avant = points[i - 1], p = points[i];
    var s = jours[p.jour] || (jours[p.jour] = TPMS.creerStatJour(p.jour));
    var dtMs = p.tMs - avant.tMs;
    var dtCompte = dtMs <= TPMS.STATS_ECART_MAX_MS ? dtMs : 0;

    // Distance : le compteur repart de 0 à chaque sortie.
    s.km += p.distanceKm >= avant.distanceKm ? p.distanceKm - avant.distanceKm : p.distanceKm;

    if (p.vitesseKmh > TPMS.STATS_VITESSE_ROULAGE_KMH) {
      s.minutesRoulage += dtCompte / 60000;
      s.sommePAV += p.pAV * dtCompte;
      s.sommePAR += p.pAR * dtCompte;
      s.dureePMs += dtCompte;
      if (p.pAV < s.pMinAV) s.pMinAV = p.pAV;
      if (p.pAR < s.pMinAR) s.pMinAR = p.pAR;
    }
    if (TPMS.estAlerte(p.etatAV) || TPMS.estAlerte(p.etatAR)) s.minutesAlerte += dtCompte / 60000;

    // Une hausse brusque de pression = le cycliste a regonflé.
    if (p.pAV - avant.pAV > TPMS.STATS_SAUT_REGONFLAGE_BAR) s.regonflages++;
    if (p.pAR - avant.pAR > TPMS.STATS_SAUT_REGONFLAGE_BAR) s.regonflages++;

    // Énergie : seules les baisses de charge comptent (pas la recharge).
    if (p.soc < avant.soc) s.mAhConsommes += (avant.soc - p.soc) * capaciteMah;
  }
  // Jours sans aucun point (cas rare) : case vide plutôt que trou dans le tableau.
  for (var j = 0; j < jours.length; j++) if (!jours[j]) jours[j] = TPMS.creerStatJour(j);
  return jours.map(TPMS.terminerStat);
};

// Calcule les moyennes à partir des sommes.
TPMS.terminerStat = function (s) {
  return {
    jour: s.jour,
    km: s.km,
    minutesRoulage: s.minutesRoulage,
    minutesAlerte: s.minutesAlerte,
    regonflages: s.regonflages,
    mAhConsommes: s.mAhConsommes,
    pMoyAV: s.dureePMs > 0 ? s.sommePAV / s.dureePMs : null,
    pMoyAR: s.dureePMs > 0 ? s.sommePAR / s.dureePMs : null,
    pMinAV: s.pMinAV === Infinity ? null : s.pMinAV,
    pMinAR: s.pMinAR === Infinity ? null : s.pMinAR,
    // gardés pour regrouper les jours en semaines
    sommePAV: s.sommePAV, sommePAR: s.sommePAR, dureePMs: s.dureePMs
  };
};

// Regroupe les jours par semaines de 7 jours (le jour 0 est un lundi).
TPMS.statistiquesParSemaine = function (jours) {
  var semaines = [];
  jours.forEach(function (j) {
    var n = Math.floor(j.jour / 7);
    var s = semaines[n] || (semaines[n] = TPMS.creerStatJour(n));
    s.km += j.km;
    s.minutesRoulage += j.minutesRoulage;
    s.minutesAlerte += j.minutesAlerte;
    s.regonflages += j.regonflages;
    s.mAhConsommes += j.mAhConsommes;
    s.sommePAV += j.sommePAV;
    s.sommePAR += j.sommePAR;
    s.dureePMs += j.dureePMs;
    if (j.pMinAV !== null && j.pMinAV < s.pMinAV) s.pMinAV = j.pMinAV;
    if (j.pMinAR !== null && j.pMinAR < s.pMinAR) s.pMinAR = j.pMinAR;
  });
  for (var k = 0; k < semaines.length; k++) if (!semaines[k]) semaines[k] = TPMS.creerStatJour(k);
  return semaines.map(TPMS.terminerStat);
};
