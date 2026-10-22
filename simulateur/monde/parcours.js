// =====================================================================
// parcours.js — Les parcours de la simulation (région lyonnaise)
// ---------------------------------------------------------------------
// MONDE SIMULÉ (pas de DOM, pas d'horloge) : à partir d'une distance
// parcourue, on sait où est le vélo, à quelle altitude, sur quelle
// pente, dans quelle direction et sur quel revêtement.
//
// Les données sont APPROCHÉES : les points de passage ont été relevés
// à la main sur une carte (OpenStreetMap) et les altitudes arrondies
// d'après les cartes IGN, à quelques mètres / dizaines de mètres près.
// Pour garder un fichier compact, on ne saisit que les points de passage
// (carrefours, virages, sommets) ; le programme ajoute ensuite des
// points intermédiaires en ligne droite tous les 100 m au plus.
//
// Dépend de : monde/alea.js (position et réglage des feux tricolores).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Rayon moyen de la Terre (valeur de l'UGGI, 6 371 km).
TPMS.RAYON_TERRE_M = 6371000;

// Écart maximal entre deux points du tracé après densification.
TPMS.PARCOURS_PAS_POINTS_M = 100;

// La pente est calculée entre 40 m avant et 40 m après le vélo.
// Hypothèse : le tracé est fait de segments droits, donc l'altitude
// varie « par morceaux » ; faire la différence sur une fenêtre de 80 m
// arrondit les cassures et évite une pente en marches d'escalier.
TPMS.PARCOURS_DEMI_FENETRE_PENTE_M = 40;

// Longueur sur laquelle on suppose qu'un virage est « étalé ».
// Hypothèse : à un angle du tracé, la route réelle tourne sur ~20 m
// (rayon d'un carrefour de ville ≈ 10-15 m pour un virage à 90°).
TPMS.PARCOURS_LONGUEUR_VIRAGE_M = 20;

// Distance à laquelle le cycliste regarde devant lui (virages, feux).
TPMS.PARCOURS_HORIZON_M = 150;

// ---------------------------------------------------------------------
// Géométrie sur la sphère terrestre
// ---------------------------------------------------------------------
function enRadians(deg) { return deg * Math.PI / 180; }

// Distance entre deux points GPS par la formule de haversine.
// hav(θ) = sin²(θ/2) ; on calcule l'angle au centre de la Terre entre
// les deux points, puis distance = rayon × angle. C'est la distance
// HORIZONTALE (sur la carte), sans tenir compte de l'altitude.
TPMS.distanceHaversineM = function (lat1, lon1, lat2, lon2) {
  var p1 = enRadians(lat1), p2 = enRadians(lat2);
  var dp = p2 - p1, dl = enRadians(lon2 - lon1);
  var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
          Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * TPMS.RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Cap (direction) pour aller du point 1 au point 2, en degrés :
// 0 = nord, 90 = est, 180 = sud, 270 = ouest.
TPMS.capEntreDeg = function (lat1, lon1, lat2, lon2) {
  var p1 = enRadians(lat1), p2 = enRadians(lat2), dl = enRadians(lon2 - lon1);
  var y = Math.sin(dl) * Math.cos(p2);
  var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  var cap = Math.atan2(y, x) * 180 / Math.PI;
  return (cap + 360) % 360;
};

// Différence entre deux caps, ramenée dans [-180, 180] degrés.
function ecartCapDeg(a, b) {
  var d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ---------------------------------------------------------------------
// Construction d'un parcours à partir de ses points de passage
// ---------------------------------------------------------------------
// passages : [[lat, lon, altitudeM], ...] ; un 4e élément facultatif
// indique le revêtement qui commence à ce point ("pave", "terre"...).
// On ajoute des points intermédiaires (interpolation linéaire) pour
// qu'il y ait au plus PARCOURS_PAS_POINTS_M entre deux points.
TPMS.parcoursDepuisPassages = function (def) {
  var pas = TPMS.PARCOURS_PAS_POINTS_M;
  var p = def.passages;
  var points = [];
  var revetements = [];
  var cumul = 0;
  for (var i = 0; i < p.length; i++) {
    if (p[i][3]) revetements.push([Math.round(cumul), p[i][3]]);
    if (i === p.length - 1) { points.push([p[i][0], p[i][1], p[i][2]]); break; }
    var d = TPMS.distanceHaversineM(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
    var n = Math.max(1, Math.ceil(d / pas));
    for (var k = 0; k < n; k++) {
      var f = k / n;
      points.push([
        +(p[i][0] + f * (p[i + 1][0] - p[i][0])).toFixed(6),
        +(p[i][1] + f * (p[i + 1][1] - p[i][1])).toFixed(6),
        +(p[i][2] + f * (p[i + 1][2] - p[i][2])).toFixed(1)
      ]);
    }
    cumul += d;
  }
  def.points = points;
  def.revetements = revetements;
  return def;
};

// ---------------------------------------------------------------------
// Les parcours
// ---------------------------------------------------------------------
TPMS.PARCOURS = [

  TPMS.parcoursDepuisPassages({
    id: "lyon-ville",
    nom: "Boucle des berges du Rhône (Lyon)",
    description: "Boucle plate en ville : place Bellecour, pont de la Guillotière, berges du Rhône, " +
                 "parc de la Tête d'Or, Cité internationale, retour par la Presqu'île. " +
                 "Nombreux feux tricolores.",
    type: "ville",
    environnementRadio: "ville",
    boucle: true,
    feuxParKm: 2.5,           // hypothèse : un feu tous les 400 m en centre-ville
    revetementParDefaut: "asphalte",
    passages: [
      [45.7578, 4.8320, 168, "gravier"],  // place Bellecour (gravier rose)
      [45.7568, 4.8338, 168, "asphalte"], // rue de la Barre
      [45.7558, 4.8372, 166],             // pont de la Guillotière
      [45.7562, 4.8398, 163],             // quai Claude-Bernard (berges)
      [45.7604, 4.8418, 163],             // pont Wilson
      [45.7641, 4.8438, 164],             // pont Lafayette
      [45.7697, 4.8443, 165],             // place Maréchal-Lyautey
      [45.7742, 4.8460, 166],             // pont De-Lattre-de-Tassigny
      [45.7762, 4.8486, 168],             // porte des Enfants-du-Rhône
      [45.7792, 4.8528, 170],             // bord du lac du parc
      [45.7828, 4.8558, 171],             // nord du parc de la Tête d'Or
      [45.7858, 4.8546, 168],             // Cité internationale
      [45.7822, 4.8502, 166],             // quai Charles-de-Gaulle
      [45.7787, 4.8462, 165],             // pont Winston-Churchill (rive gauche)
      [45.7790, 4.8418, 165],             // pont Winston-Churchill (rive droite)
      [45.7741, 4.8400, 166],             // quai Saint-Clair
      [45.7701, 4.8393, 166],             // pont Morand (rive droite)
      [45.7676, 4.8362, 168],             // place de la Comédie
      [45.7631, 4.8355, 168],             // Cordeliers
      [45.7600, 4.8340, 168],             // rue de la République
      [45.7586, 4.8328, 168, "gravier"]   // retour sur la place Bellecour
    ]
  }),

  TPMS.parcoursDepuisPassages({
    id: "col-luere",
    nom: "Sortie route : col de la Luère (714 m)",
    description: "Départ de Gorge-de-Loup (Lyon 9e), Tassin, Craponne, Grézieu, " +
                 "Vaugneray, montée du col de la Luère, descente sur Pollionnay, " +
                 "retour par Sainte-Consorce, Marcy-l'Étoile et Charbonnières.",
    type: "route",
    environnementRadio: "campagne",
    boucle: false,            // une sortie : on s'arrête en rentrant
    feuxParKm: 0,
    revetementParDefaut: "asphalte",
    passages: [
      [45.7662, 4.8045, 182, "asphalte"], // Gorge-de-Loup
      [45.7652, 4.7960, 200],             // avenue Barthélemy-Buyer
      [45.7641, 4.7860, 222],             // Ménival
      [45.7636, 4.7725, 243],
      [45.7633, 4.7595, 256],             // Tassin-la-Demi-Lune
      [45.7585, 4.7495, 268],
      [45.7530, 4.7380, 280],
      [45.7452, 4.7255, 294],             // Craponne
      [45.7462, 4.7080, 312],
      [45.7480, 4.6905, 335],             // Grézieu-la-Varenne
      [45.7432, 4.6725, 368],
      [45.7382, 4.6562, 402],             // Vaugneray : début du col
      [45.7395, 4.6470, 445],
      [45.7440, 4.6435, 485],             // lacet
      [45.7465, 4.6495, 514],             // lacet
      [45.7498, 4.6455, 548],
      [45.7505, 4.6390, 576],
      [45.7535, 4.6345, 610],             // lacet
      [45.7560, 4.6395, 637],             // lacet
      [45.7585, 4.6350, 667],
      [45.7590, 4.6290, 694],
      [45.7617, 4.6278, 714],             // col de la Luère
      [45.7645, 4.6300, 688],             // début de la descente
      [45.7672, 4.6360, 648],
      [45.7655, 4.6420, 610],             // virage serré
      [45.7690, 4.6460, 575],             // virage serré
      [45.7670, 4.6530, 537],             // virage serré
      [45.7655, 4.6575, 503],
      [45.7647, 4.6614, 480],             // Pollionnay
      [45.7700, 4.6752, 404],
      [45.7760, 4.6900, 372],             // Sainte-Consorce
      [45.7800, 4.7020, 334],
      [45.7838, 4.7132, 304],             // Marcy-l'Étoile
      [45.7830, 4.7290, 272],
      [45.7810, 4.7450, 242],             // Charbonnières-les-Bains
      [45.7722, 4.7620, 232],             // Écully / Tassin
      [45.7700, 4.7800, 216],
      [45.7680, 4.7950, 196],
      [45.7662, 4.8045, 182]              // retour à Gorge-de-Loup
    ]
  }),

  TPMS.parcoursDepuisPassages({
    id: "monts-d-or-vtt",
    nom: "VTT dans les monts d'Or",
    description: "Boucle VTT au nord de Lyon : Saint-Cyr-au-Mont-d'Or, mont Cindre, " +
                 "mont Thou (609 m), tour du mont Verdun, Poleymieux, bois de Limonest, " +
                 "Saint-Didier. Chemins de terre et pentes fortes.",
    type: "vtt",
    environnementRadio: "foret",
    boucle: false,
    feuxParKm: 0,
    revetementParDefaut: "terre",
    passages: [
      [45.8172, 4.8183, 290, "asphalte"], // Saint-Cyr-au-Mont-d'Or
      [45.8190, 4.8205, 318, "terre"],    // entrée du chemin
      [45.8205, 4.8175, 352],             // lacet
      [45.8200, 4.8135, 388],             // lacet
      [45.8222, 4.8130, 426],
      [45.8235, 4.8160, 467],             // mont Cindre
      [45.8262, 4.8185, 500, "gravier"],  // route forestière du mont Thou
      [45.8290, 4.8215, 538],
      [45.8318, 4.8205, 574],
      [45.8340, 4.8240, 609, "terre"],    // mont Thou
      [45.8365, 4.8195, 586],
      [45.8390, 4.8155, 560],             // croix de Rampau
      [45.8420, 4.8090, 574],             // flanc sud du mont Verdun
      [45.8455, 4.8020, 600],             // tour du fort
      [45.8500, 4.7990, 560],
      [45.8540, 4.8010, 505],
      [45.8570, 4.8005, 470, "asphalte"], // Poleymieux-au-Mont-d'Or
      [45.8555, 4.7950, 455, "terre"],
      [45.8540, 4.7900, 440],             // bois
      [45.8510, 4.7865, 448],
      [45.8480, 4.7830, 430],
      [45.8420, 4.7790, 420],
      [45.8370, 4.7760, 395, "asphalte"], // Limonest
      [45.8335, 4.7795, 415, "terre"],    // bois de Limonest
      [45.8310, 4.7820, 410],
      [45.8250, 4.7870, 380],
      [45.8190, 4.7920, 330, "gravier"],
      [45.8140, 4.7985, 290, "asphalte"], // Saint-Didier-au-Mont-d'Or
      [45.8150, 4.8080, 286, "terre"],    // chemin du retour
      [45.8172, 4.8183, 290]              // retour à Saint-Cyr
    ]
  }),

  TPMS.parcoursDepuisPassages({
    id: "domicile-travail",
    nom: "Trajet domicile – travail (Villeurbanne → Croix-Rousse)",
    description: "Trajet quotidien de Villeurbanne (Flachet) à l'hôpital de la Croix-Rousse : " +
                 "cours Émile-Zola, Charpennes, pont Morand, puis la montée pavée " +
                 "Saint-Sébastien (environ 11 %).",
    type: "trajet",
    environnementRadio: "ville",
    boucle: false,
    feuxParKm: 2,             // hypothèse : un feu tous les 500 m
    revetementParDefaut: "asphalte",
    passages: [
      [45.7680, 4.8920, 172, "asphalte"], // domicile : Villeurbanne, Flachet
      [45.7693, 4.8800, 171],             // Gratte-Ciel
      [45.7700, 4.8700, 170],             // cours Émile-Zola
      [45.7706, 4.8630, 169],             // Charpennes
      [45.7700, 4.8560, 168],             // cours Vitton
      [45.7697, 4.8443, 166],             // place Maréchal-Lyautey
      [45.7701, 4.8393, 166],             // pont Morand
      [45.7704, 4.8362, 172],             // place Croix-Paquet
      [45.7712, 4.8352, 186, "pave"],     // montée Saint-Sébastien (pavés)
      [45.7722, 4.8360, 200],             // lacet
      [45.7732, 4.8345, 218],
      [45.7742, 4.8333, 236],
      [45.7748, 4.8322, 246, "asphalte"], // boulevard de la Croix-Rousse
      [45.7775, 4.8312, 252],             // Grande-Rue de la Croix-Rousse
      [45.7810, 4.8298, 255],
      [45.7840, 4.8278, 256]              // travail : hôpital de la Croix-Rousse
    ]
  })
];

// Recherche d'un parcours par son identifiant.
TPMS.parcoursParId = function (id) {
  for (var i = 0; i < TPMS.PARCOURS.length; i++) {
    if (TPMS.PARCOURS[i].id === id) return TPMS.PARCOURS[i];
  }
  return null;
};

// ---------------------------------------------------------------------
// Feux tricolores
// ---------------------------------------------------------------------
// Chaque feu a un cycle fixe : vert pendant vertS secondes, puis rouge
// (orange compris : un cycliste prudent s'arrête à l'orange) jusqu'à la
// fin du cycle. Le décalage (phaseS) fait que les feux ne sont pas
// synchronisés. Cycle de 60 à 100 s : ordre de grandeur des carrefours
// urbains (le CEREMA recommande des cycles de 60 à 120 s).
TPMS.feuEstRouge = function (feu, tS) {
  var t = ((tS + feu.phaseS) % feu.cycleS + feu.cycleS) % feu.cycleS;
  return t >= feu.vertS;
};

// Temps (s) avant que le feu repasse au vert (0 s'il est déjà vert).
TPMS.feuAttenteS = function (feu, tS) {
  var t = ((tS + feu.phaseS) % feu.cycleS + feu.cycleS) % feu.cycleS;
  return t >= feu.vertS ? feu.cycleS - t : 0;
};

// Place les feux le long du parcours, avec un hasard reproductible :
// même parcours + même graine = mêmes feux, aux mêmes endroits.
function placerFeux(parcours, longueurM, graine) {
  var feux = [];
  if (!parcours.feuxParKm) return feux;
  var alea = TPMS.creerAleaNomme(graine >>> 0, "feux-" + parcours.id);
  var ecartMoyenM = 1000 / parcours.feuxParKm;
  var d = 150 + alea() * ecartMoyenM;   // pas de feu dans les 150 premiers mètres
  while (d < longueurM - 100) {
    var cycle = TPMS.aleaEntre(alea, 60, 100);
    feux.push({
      id: feux.length,
      distanceM: d,
      cycleS: cycle,
      vertS: cycle * TPMS.aleaEntre(alea, 0.40, 0.55),
      phaseS: alea() * cycle
    });
    // Écart entre deux feux : entre 40 % et 160 % de l'écart moyen.
    d += ecartMoyenM * TPMS.aleaEntre(alea, 0.4, 1.6);
  }
  return feux;
}

// ---------------------------------------------------------------------
// Préparation : calculs faits une seule fois avant de rouler
// ---------------------------------------------------------------------
// graine (facultative) : change la position et le réglage des feux.
TPMS.parcoursPreparer = function (parcours, graine) {
  var pts = parcours.points.slice();
  // Boucle : si le dernier point n'est pas le premier, on referme.
  if (parcours.boucle) {
    var a = pts[0], z = pts[pts.length - 1];
    if (TPMS.distanceHaversineM(a[0], a[1], z[0], z[1]) > 1) pts.push(a.slice());
  }
  var n = pts.length;
  var cumul = [0], caps = [];
  var dPlus = 0, dMoins = 0;
  var altMin = pts[0][2], altMax = pts[0][2];
  for (var i = 1; i < n; i++) {
    var p = pts[i - 1], q = pts[i];
    cumul.push(cumul[i - 1] + TPMS.distanceHaversineM(p[0], p[1], q[0], q[1]));
    caps.push(TPMS.capEntreDeg(p[0], p[1], q[0], q[1]));
    var dz = q[2] - p[2];
    if (dz > 0) dPlus += dz; else dMoins -= dz;
    if (q[2] < altMin) altMin = q[2];
    if (q[2] > altMax) altMax = q[2];
  }
  var longueur = cumul[n - 1];

  // Virages : à chaque point, on compare le cap avant et après.
  // Si le tracé tourne d'un angle Δ (radians) sur une longueur L, le
  // rayon du virage vaut R = L / Δ (longueur d'un arc de cercle = R × angle).
  var virages = [];
  for (var j = 1; j < n - 1 || (parcours.boucle && j === n - 1); j++) {
    var capAvant = caps[j - 1];
    var capApres = (j < n - 1) ? caps[j] : caps[0];          // boucle : on repart
    var lAvant = cumul[j] - cumul[j - 1];
    var lApres = (j < n - 1) ? cumul[j + 1] - cumul[j] : cumul[1];
    var delta = Math.abs(ecartCapDeg(capAvant, capApres)) * Math.PI / 180;
    if (delta < 1e-3) continue;
    var L = Math.min(lAvant, lApres, TPMS.PARCOURS_LONGUEUR_VIRAGE_M);
    var rayon = L / delta;
    if (rayon < 300) {      // au-delà, le virage ne gêne personne
      virages.push({ distanceM: (j < n - 1) ? cumul[j] : 0, rayonM: rayon,
                     angleDeg: Math.round(delta * 180 / Math.PI) });
    }
  }
  virages.sort(function (u, v) { return u.distanceM - v.distanceM; });

  var revs = (parcours.revetements || []).slice().sort(function (u, v) { return u[0] - v[0]; });

  return {
    parcours: parcours,
    id: parcours.id,
    boucle: !!parcours.boucle,
    points: pts,
    cumulM: cumul,
    capsDeg: caps,
    longueurM: longueur,
    denivelePositifM: dPlus,
    deniveleNegatifM: dMoins,
    altitudeMinM: altMin,
    altitudeMaxM: altMax,
    virages: virages,
    revetements: revs,
    revetementParDefaut: parcours.revetementParDefaut || "asphalte",
    feux: placerFeux(parcours, longueur, graine || 0)
  };
};

// ---------------------------------------------------------------------
// Où est-on ? (interpolation sur le tracé)
// ---------------------------------------------------------------------
// Ramène une distance sur le parcours : en boucle on fait des tours,
// sinon on reste entre le départ et l'arrivée.
function ramener(prep, d) {
  if (prep.boucle) {
    d = d % prep.longueurM;
    if (d < 0) d += prep.longueurM;
    return d;
  }
  return Math.max(0, Math.min(prep.longueurM, d));
}

// Indice du segment qui contient la distance d (recherche dichotomique :
// on coupe l'intervalle en deux à chaque étape, ~10 étapes pour 1000 points).
function segmentA(prep, d) {
  var c = prep.cumulM, bas = 0, haut = c.length - 2;
  while (bas < haut) {
    var milieu = (bas + haut + 1) >> 1;
    if (c[milieu] <= d) bas = milieu; else haut = milieu - 1;
  }
  return bas;
}

// Altitude à une distance donnée (interpolation linéaire entre 2 points).
TPMS.parcoursAltitudeM = function (prep, distanceM) {
  var d = ramener(prep, distanceM);
  var i = segmentA(prep, d);
  var l = prep.cumulM[i + 1] - prep.cumulM[i];
  var f = l > 0 ? (d - prep.cumulM[i]) / l : 0;
  return prep.points[i][2] + f * (prep.points[i + 1][2] - prep.points[i][2]);
};

function revetementA(prep, d) {
  var r = prep.revetementParDefaut;
  for (var i = 0; i < prep.revetements.length; i++) {
    if (prep.revetements[i][0] <= d) r = prep.revetements[i][1]; else break;
  }
  return r;
}

// distanceM : distance parcourue depuis le départ (peut dépasser la
// longueur : en boucle on enchaîne les tours).
TPMS.parcoursPoint = function (prep, distanceM) {
  var L = prep.longueurM;
  var tour = prep.boucle ? Math.floor(distanceM / L) : 0;
  var fini = !prep.boucle && distanceM >= L;
  var d = ramener(prep, distanceM);

  // Position : interpolation linéaire sur le segment courant.
  var i = segmentA(prep, d);
  var p = prep.points[i], q = prep.points[i + 1];
  var l = prep.cumulM[i + 1] - prep.cumulM[i];
  var f = l > 0 ? (d - prep.cumulM[i]) / l : 0;

  // Pente lissée : différence d'altitude entre d - W et d + W.
  // pente = Δaltitude / Δdistance horizontale, angle = atan(pente).
  var W = TPMS.PARCOURS_DEMI_FENETRE_PENTE_M;
  var dAvant = d - W, dApres = d + W;
  if (!prep.boucle) { dAvant = Math.max(0, dAvant); dApres = Math.min(L, dApres); }
  var base = dApres - dAvant;
  var pente = base > 0 ?
    (TPMS.parcoursAltitudeM(prep, dApres) - TPMS.parcoursAltitudeM(prep, dAvant)) / base : 0;

  // Virages à venir dans l'horizon du cycliste.
  var virages = [];
  var H = TPMS.PARCOURS_HORIZON_M;
  for (var k = 0; k < prep.virages.length; k++) {
    var dv = prep.virages[k].distanceM - d;
    if (prep.boucle && dv < 0) dv += L;           // virage du tour suivant
    if (dv >= 0 && dv <= H) virages.push({ distanceM: dv, rayonM: prep.virages[k].rayonM });
  }

  // Prochain feu tricolore devant le vélo.
  var prochainFeu = null, prochainFeuM = Infinity, cleFeu = null;
  for (var m = 0; m < prep.feux.length; m++) {
    var df = prep.feux[m].distanceM - d;
    var tourFeu = tour;
    if (prep.boucle && df < 0) { df += L; tourFeu = tour + 1; }
    if (df >= 0 && df < prochainFeuM) {
      prochainFeuM = df; prochainFeu = prep.feux[m];
      cleFeu = prep.feux[m].id + "-" + tourFeu;   // un même feu, à chaque tour
    }
  }

  return {
    lat: p[0] + f * (q[0] - p[0]),
    lon: p[1] + f * (q[1] - p[1]),
    altitudeM: p[2] + f * (q[2] - p[2]),
    penteRad: Math.atan(pente),
    pentePct: pente * 100,
    capDeg: prep.capsDeg[i],
    revetement: revetementA(prep, d),
    fini: fini,
    // Champs supplémentaires utiles au cycliste et à l'affichage :
    distanceSurParcoursM: d,
    tour: tour,
    resteM: prep.boucle ? Infinity : L - d,
    virages: virages,
    prochainFeu: prochainFeu,
    prochainFeuM: prochainFeuM,
    prochainFeuCle: cleFeu
  };
};
