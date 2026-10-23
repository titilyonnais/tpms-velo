// =====================================================================
// registre.js — Registre de la flotte EN MÉMOIRE
// ---------------------------------------------------------------------
// C'est le « serveur » du mode démo : quand la page de supervision ne
// trouve pas le vrai serveur (GitHub Pages, fichier ouvert directement),
// elle garde les mesures ici, dans des tableaux JavaScript.
//
// Il fait EXACTEMENT ce que fait le serveur avec sa base SQLite
// (serveur/base.js) et renvoie les mêmes réponses que l'API REST :
// mêmes règles (flotte-logique.js), seul le stockage change. Les tests
// vérifient que les deux donnent les mêmes statistiques.
//
// Le registre fait confiance aux lots reçus (ils viennent de la
// simulation, dans la même page) : la validation et la signature sont
// le travail du vrai serveur. Les règles RGPD, elles, s'appliquent ici
// aussi : pas de position pendant une location, mesures effacées après
// 30 jours (flotte-logique.js, FLOTTE_CONSERVATION).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// velos = [{ id, nom }]
TPMS.creerRegistre = function (velos) {
  var r = { ordre: [], fiches: {}, mesures: {}, alertes: [], regonflages: [], nbMesures: 0,
    plusRecenteMs: -Infinity };   // instant de la mesure la plus récente reçue (pour la purge)
  velos.forEach(function (v) {
    r.ordre.push(v.id);
    r.fiches[v.id] = { id: v.id, nom: v.nom, derniere: null, tendance: { AV: null, AR: null },
      // Points gardés pour les tendances : une mesure par demi-heure (voir
      // flotteTendance), pour ne pas tout reparcourir à chaque lot.
      points: { AV: [], AR: [] } };
    r.mesures[v.id] = [];
  });
  return r;
};

// Équivalent de POST /api/mesures (après validation).
// Retourne { acceptees, ignorees, alertes, regonflages, purgees }.
TPMS.registreAjouterLot = function (r, id, mesures) {
  var liste = r.mesures[id];
  var fiche = r.fiches[id];
  var bilan = { acceptees: 0, ignorees: 0, alertes: 0, regonflages: 0, purgees: 0 };
  if (!liste) return bilan;
  var precedente = liste.length > 0 ? liste[liste.length - 1] : null;

  mesures.forEach(function (recue) {
    // RGPD : pas de position pendant une location (même règle que le serveur).
    var m = TPMS.flotteMinimiserPosition(recue);
    // Règle commune avec le serveur : seules les mesures plus récentes
    // que la dernière reçue sont gardées (un lot renvoyé est ignoré).
    if (precedente && m.t <= precedente.t) { bilan.ignorees++; return; }
    liste.push(m);
    if (m.t > r.plusRecenteMs) r.plusRecenteMs = m.t;
    r.nbMesures++;
    garderPoint(fiche, m);
    bilan.acceptees++;
    TPMS.flotteEvenements(precedente, m).forEach(function (ev) {
      if (ev.type === "regonflage") {
        r.regonflages.push({ veloId: id, t: m.t, roue: ev.roue, avant: ev.avant, apres: ev.apres });
        bilan.regonflages++;
      } else {
        r.alertes.push({ veloId: id, t: m.t, roue: ev.roue, type: ev.alerte, pression: ev.pression, source: ev.source });
        bilan.alertes++;
      }
    });
    precedente = m;
  });

  if (bilan.acceptees > 0) {
    fiche.derniere = precedente;
    // Tendances sur plusieurs jours, recalculées après chaque lot.
    ["AV", "AR"].forEach(function (roue) {
      var points = TPMS.registrePoints(r, id, roue, precedente.t - TPMS.FLOTTE.tendanceFenetreMs);
      var avant = fiche.tendance[roue];
      var apres = TPMS.flotteTendance(points, roue);
      if (TPMS.flotteNouvelleFuite(avant, apres)) {
        r.alertes.push({ veloId: id, t: precedente.t, roue: roue, type: "FUITE_LENTE", pression: apres.pressionBar, source: "serveur" });
        bilan.alertes++;
      }
      fiche.tendance[roue] = apres;
    });
    bilan.purgees = TPMS.registrePurger(r, TPMS.flotteLimiteConservation(r.plusRecenteMs));
  }
  return bilan;
};

// RGPD : efface les mesures et les alertes plus anciennes que limiteMs
// (équivalent des DELETE de serveur/base.js). Les regonflages restent :
// ils servent aux statistiques agrégées et ne décrivent aucun trajet.
TPMS.registrePurger = function (r, limiteMs) {
  var effacees = 0;
  r.ordre.forEach(function (id) {
    var liste = r.mesures[id], fiche = r.fiches[id];
    // Mesures rangées de la plus ancienne à la plus récente : on retire le début.
    var n = 0;
    while (n < liste.length && liste[n].t < limiteMs) n++;
    if (n > 0) {
      liste.splice(0, n);
      effacees += n;
      if (liste.length === 0) fiche.derniere = null;      // plus aucune donnée sur ce vélo
    }
    ["AV", "AR"].forEach(function (roue) {
      var points = fiche.points[roue];
      while (points.length > 0 && points[0].t < limiteMs) points.shift();
    });
  });
  r.nbMesures -= effacees;
  if (r.alertes.some(function (a) { return a.t < limiteMs; })) {
    r.alertes = r.alertes.filter(function (a) { return a.t >= limiteMs; });
  }
  return effacees;
};

function garderPoint(fiche, m) {
  ["AV", "AR"].forEach(function (roue) {
    var p = m[TPMS.flotteChamp("p", roue)], temp = m[TPMS.flotteChamp("t", roue)];
    if (p === null || temp === null) return;
    var liste = fiche.points[roue];
    var point = { t: m.t, p: p, temp: temp };
    var n = liste.length;
    if (n > 0 && Math.floor(liste[n - 1].t / TPMS.FLOTTE_TRANCHE_MS) === Math.floor(m.t / TPMS.FLOTTE_TRANCHE_MS)) {
      liste[n - 1] = point;             // même demi-heure : on garde la dernière
    } else {
      liste.push(point);
    }
    // On oublie ce qui sort de la fenêtre de 14 jours
    while (liste.length > 0 && liste[0].t < m.t - TPMS.FLOTTE.tendanceFenetreMs) liste.shift();
  });
}

// Points { t, p, temp } d'une roue depuis depuisMs (plus ancien d'abord).
TPMS.registrePoints = function (r, id, roue, depuisMs) {
  var liste = r.fiches[id].points[roue];
  var debut = liste.length;
  while (debut > 0 && liste[debut - 1].t >= depuisMs) debut--;
  return liste.slice(debut);
};

// Équivalent de GET /api/velos
TPMS.registreVelos = function (r, maintenantMs) {
  return {
    maintenantMs: maintenantMs,
    velos: r.ordre.map(function (id) { return TPMS.flotteResume(r.fiches[id], maintenantMs); })
  };
};

// Équivalent de GET /api/velos/:id/historique?jours=...
TPMS.registreHistorique = function (r, id, jours, maintenantMs) {
  var fiche = r.fiches[id];
  if (!fiche) return null;
  var depuis = maintenantMs - jours * 86400000;
  var mesures = r.mesures[id].filter(function (m) { return m.t >= depuis; });
  return {
    id: id, nom: fiche.nom, maintenantMs: maintenantMs,
    mesures: mesures,
    regonflages: r.regonflages.filter(function (g) { return g.veloId === id && g.t >= depuis; }),
    tendance: fiche.tendance,
    resume: TPMS.flotteResume(fiche, maintenantMs)
  };
};

// Équivalent de GET /api/alertes?limite=... (les plus récentes d'abord)
TPMS.registreAlertes = function (r, limite) {
  return { alertes: r.alertes.slice(-limite).reverse() };
};

// Équivalent de GET /api/statistiques
TPMS.registreStatistiques = function (r, maintenantMs) {
  var depuis7j = maintenantMs - 7 * 86400000;
  var depuis24h = maintenantMs - 86400000;
  var resumes = TPMS.registreVelos(r, maintenantMs).velos;

  var parType = {};
  r.alertes.forEach(function (a) {
    if (a.t >= depuis7j) parType[a.type] = (parType[a.type] || 0) + 1;
  });
  var alertesParType = Object.keys(parType).map(function (type) { return { type: type, n: parType[type] }; })
    .sort(function (a, b) { return b.n - a.n || (a.type < b.type ? -1 : 1); });

  var mesures24h = 0, km7j = 0;
  r.ordre.forEach(function (id) {
    var kmMin = Infinity, kmMax = -Infinity;
    r.mesures[id].forEach(function (m) {
      if (m.t >= depuis24h) mesures24h++;
      if (m.t >= depuis7j) { kmMin = Math.min(kmMin, m.km); kmMax = Math.max(kmMax, m.km); }
    });
    if (kmMax >= kmMin) km7j += kmMax - kmMin;
  });

  return {
    maintenantMs: maintenantMs,
    indicateurs: TPMS.flotteIndicateurs(resumes),
    mesures: { total: r.nbMesures, dernieres24h: mesures24h },
    alertesParType7j: alertesParType,
    regonflages: {
      total: r.regonflages.length,
      derniers7j: r.regonflages.filter(function (g) { return g.t >= depuis7j; }).length,
      tempsMoyenEntreJ: TPMS.flotteTempsMoyenEntreRegonflagesJ(r.regonflages)
    },
    km7j: km7j,
    securite: null    // pas de réseau en mode démo : rien à refuser
  };
};
