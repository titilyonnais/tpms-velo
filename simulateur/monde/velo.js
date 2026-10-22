// =====================================================================
// velo.js — Dynamique du vélo et comportement du cycliste
// ---------------------------------------------------------------------
// MONDE SIMULÉ (pas de DOM, pas d'horloge) : à chaque pas de temps dt,
// on fait le bilan des forces qui s'exercent sur l'ensemble
// vélo + cycliste, on en déduit l'accélération (2e loi de Newton :
// somme des forces = masse × accélération), puis la nouvelle vitesse
// et la distance parcourue (méthode d'Euler explicite).
//
// Forces prises en compte (positives vers l'avant) :
//   + propulsion   = puissance aux pédales × rendement / vitesse
//   - poids        = m × g × sin(pente)              (montée / descente)
//   - roulement    = Crr × m × g × cos(pente)        (dépend de la PRESSION)
//   - traînée air  = ½ × ρ × CdA × (vitesse + vent)² (vent de face > 0)
//   - freins       = freinage × force de freinage maximale
//
// Le vélo produit aussi les « tops » de l'aimant fixé sur la roue AVANT :
// les instants exacts où l'aimant passe devant l'interrupteur reed.
// C'est ce que le boîtier reçoit (voir logique/vitesse.js).
//
// Unités SI : m, s, kg, N, W, rad. Les pressions sont en bar (1 bar = 100 000 Pa).
// Dépend de : monde/alea.js, monde/parcours.js (feux) pour le cycliste.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Accélération de la pesanteur (valeur standard, m/s²).
TPMS.G_MS2 = 9.81;

// Masse volumique de l'air au niveau de la mer à 15 °C (atmosphère
// standard OACI). Le module météo fournit la vraie valeur (altitude, T).
TPMS.DENSITE_AIR_STANDARD = 1.225;

// Crr d'un pneu à plat : on roule presque sur la jante. Hypothèse :
// ordre de grandeur d'un pneu dans du sable (Crr ≈ 0,3, tableau de
// l'article « Rolling resistance » de Wikipédia).
TPMS.CRR_A_PLAT = 0.30;
TPMS.PRESSION_A_PLAT_BAR = 0.3;     // en dessous : pneu à plat
TPMS.PRESSION_DEBUT_PLAT_BAR = 0.5; // entre 0,3 et 0,5 bar : transition progressive

// Au démarrage, la vitesse est nulle et P / v serait infini. En réalité
// la force est limitée par ce que le cycliste peut appuyer sur les pédales.
// Hypothèse : ~250 N à la roue (environ 600 N sur la pédale en petit braquet).
TPMS.FORCE_PROPULSION_MAX_N = 250;
TPMS.VITESSE_MIN_PROPULSION_MS = 0.5;

// Le freinage maximal est limité par le basculement vers l'avant :
// environ 0,6 g pour un vélo classique (Wilson, « Bicycling Science », chap. 7).
TPMS.DECELERATION_FREIN_MAX_G = 0.6;

// ---------------------------------------------------------------------
// Revêtements
// ---------------------------------------------------------------------
// crrImpedance : résistance SUPPLÉMENTAIRE due aux bosses (le pneu se
// soulève et rebondit au lieu de « boire » les aspérités). Elle augmente
// avec la pression : sur mauvais revêtement, un pneu trop gonflé roule
// moins bien (essais de J. Heine / Silca sur pavés et gravier).
// Valeurs approchées, pour un pneu à sa pression nominale :
//   pavés +0,012 ; gravier +0,008 ; terre +0,006 (hypothèses calées pour
//   retrouver des Crr totaux de 0,01 à 0,02 cités pour le gravier et les pavés).
// vibrationGParMs : vibration au guidon (en g efficaces) par m/s de vitesse.
//   Hypothèse calée sur des mesures publiées d'accélération au guidon :
//   ~0,15 g sur bon asphalte à 25 km/h, ~1 g sur pavés.
// facteurConfort : le cycliste roule moins vite sur mauvais revêtement.
TPMS.REVETEMENTS = {
  asphalte: { crrImpedance: 0.000, vibrationGParMs: 0.02, facteurConfort: 1.00 },
  pave:     { crrImpedance: 0.012, vibrationGParMs: 0.15, facteurConfort: 0.75 },
  gravier:  { crrImpedance: 0.008, vibrationGParMs: 0.09, facteurConfort: 0.75 },
  terre:    { crrImpedance: 0.006, vibrationGParMs: 0.07, facteurConfort: 0.80 }
};

// ---------------------------------------------------------------------
// Types de vélos (valeurs par défaut)
// ---------------------------------------------------------------------
// masseVeloKg : vélo de route alu ~8,5 kg, vélo de ville équipé ~17 kg,
//   VTT semi-rigide ~13,5 kg (catalogues constructeurs).
// cdA (m²) : surface frontale × coefficient de traînée. Wilson,
//   « Bicycling Science » : ~0,32 en bas du cintre, ~0,40 mains sur les
//   cocottes, ~0,55 assis droit sur un vélo de ville, ~0,6 en VTT.
// rayonRoueM : jante 622 mm (700C / 29") + 2 × hauteur du pneu (≈ largeur).
// crrNominal : pneu à sa pression nominale sur asphalte, avec chambre à air.
//   bicyclerollingresistance.com mesure 9-14 W par pneu route à 29 km/h
//   (Crr ≈ 0,003-0,004 sur rouleau lisse) ; sur vraie route on ajoute
//   ~30 % → 0,005. Pneus de ville renforcés anti-crevaison ~0,0065,
//   pneus VTT à crampons sur asphalte ~0,008.
// repartitionAV : part du poids sur la roue avant (cycliste assis ~40 %).
// masseInertielleKg : les roues tournent ; les faire accélérer demande
//   de l'énergie en plus. Pour une jante, I ≈ m × r², ce qui revient à
//   ajouter la masse des jantes + pneus (hypothèse : ~0,8 kg par roue route).
TPMS.TYPES_VELO = {
  route: { masseVeloKg: 8.5, cdA: 0.40, largeurPneuMm: 25, crrNominal: 0.0050,
           repartitionAV: 0.40, masseInertielleKg: 1.6 },
  ville: { masseVeloKg: 17,  cdA: 0.55, largeurPneuMm: 38, crrNominal: 0.0065,
           repartitionAV: 0.35, masseInertielleKg: 2.2 },
  vtt:   { masseVeloKg: 13.5, cdA: 0.60, largeurPneuMm: 57, crrNominal: 0.0080,
           repartitionAV: 0.40, masseInertielleKg: 2.4 }
};

// Pression nominale conseillée selon la largeur du pneu (bar).
// Règle approchée tirée des tableaux de fabricants (Schwalbe, Michelin) :
// 25 mm → 6,5 bar ; 38 mm → 3,9 bar ; 57 mm → 2,4 bar.
TPMS.pressionNominaleBar = function (largeurPneuMm) {
  return 6.5 * Math.pow(25 / largeurPneuMm, 1.2);
};

function borner(x, min, max) { return Math.max(min, Math.min(max, x)); }

TPMS.creerVelo = function (options) {
  var o = options || {};
  var type = TPMS.TYPES_VELO[o.type] ? o.type : "ville";
  var t = TPMS.TYPES_VELO[type];
  var largeur = o.largeurPneuMm || t.largeurPneuMm;
  var masseVelo = o.masseVeloKg || t.masseVeloKg;
  var masseCycliste = o.masseCyclisteKg || 75;   // adulte moyen (hypothèse)
  var alea = TPMS.creerAleaNomme(o.graine || 0, "velo");
  var v = {
    type: type,
    masseCyclisteKg: masseCycliste,
    masseVeloKg: masseVelo,
    cdA: o.cdA || t.cdA,
    rayonRoueM: o.rayonRoueM || (622 + 2 * largeur) / 2000,
    largeurPneuMm: largeur,
    crrNominal: o.crrNominal || t.crrNominal,
    pressionNominaleBar: o.pressionNominaleBar || TPMS.pressionNominaleBar(largeur),
    repartitionAV: t.repartitionAV,
    masseInertielleKg: t.masseInertielleKg,
    // Rendement de la transmission (chaîne + dérailleur), ~95-98 % selon
    // Spicer et al. (2001) ; 96 % pour une chaîne d'usage courant.
    rendementTransmission: 0.96,
    freinMaxN: TPMS.DECELERATION_FREIN_MAX_G * TPMS.G_MS2 * (masseCycliste + masseVelo),
    alea: alea,
    // --- état qui évolue ---
    vitesseMs: 0,
    accelerationMs2: 0,
    distanceM: 0,
    tempsS: 0,
    // Position de départ des roues inconnue : tirée au hasard (reproductible).
    // reste...Tour = fraction de tour à faire avant le prochain passage à 0°.
    resteTourAV: alea(),
    resteTourAR: alea(),
    angleRoueAVDeg: 0,
    angleRoueARDeg: 0,
    topsAimant: [],
    nbTopsAimant: 0,
    vibrationG: 0,
    crrAV: 0, crrAR: 0,
    rayonRoulementAVM: 0, rayonRoulementARM: 0,
    puissanceW: 0,
    energieCyclisteJ: 0,
    vitesseMaxMs: 0,
    forces: { propulsionN: 0, poidsN: 0, roulementN: 0, aeroN: 0, freinN: 0 }
  };
  v.angleRoueAVDeg = angleDepuisReste(v.resteTourAV);
  v.angleRoueARDeg = angleDepuisReste(v.resteTourAR);
  return v;
};

// Angle de la roue (0 = aimant / repère devant le capteur) à partir de la
// fraction de tour restant avant le prochain passage.
function angleDepuisReste(reste) {
  var a = (1 - reste) * 360;
  return a >= 360 ? a - 360 : a;
}

// ---------------------------------------------------------------------
// Résistance au roulement d'UNE roue
// ---------------------------------------------------------------------
// 1) Hystérésis du pneu : un pneu moins gonflé s'écrase plus, se déforme
//    plus à chaque tour et chauffe : il perd plus d'énergie. Les mesures de
//    bicyclerollingresistance.com montrent qu'en divisant la pression par 2,
//    la perte augmente de ~45 % (GP5000 : 10 W à 8,3 bar, 14,5 W à 4,1 bar)
//    soit environ Crr ∝ 1/√pression.
// 2) Impédance du revêtement : sur bosses, elle augmente avec √pression.
// 3) Sous 0,5 bar : transition vers le roulage sur jante (pneu à plat).
TPMS.veloCrr = function (v, pressionBar, revetement) {
  var p = (pressionBar === undefined || pressionBar === null) ? v.pressionNominaleBar : pressionBar;
  var rev = TPMS.REVETEMENTS[revetement] || TPMS.REVETEMENTS.asphalte;
  var pNom = v.pressionNominaleBar;
  var pCalc = Math.max(p, TPMS.PRESSION_DEBUT_PLAT_BAR);
  var crrPneu = v.crrNominal * Math.sqrt(pNom / pCalc);
  // Un pneu large « avale » mieux les bosses (hypothèse : effet en √largeur,
  // référence 38 mm).
  var crrRoute = rev.crrImpedance * Math.sqrt(pCalc / pNom) * Math.sqrt(38 / v.largeurPneuMm);
  var crr = crrPneu + crrRoute;
  if (p < TPMS.PRESSION_DEBUT_PLAT_BAR) {
    // 0 à 0,3 bar : à plat ; 0,3 à 0,5 bar : mélange linéaire des deux.
    var f = borner((p - TPMS.PRESSION_A_PLAT_BAR) /
                   (TPMS.PRESSION_DEBUT_PLAT_BAR - TPMS.PRESSION_A_PLAT_BAR), 0, 1);
    crr = f * crr + (1 - f) * TPMS.CRR_A_PLAT;
  }
  return crr;
};

// ---------------------------------------------------------------------
// Rayon de roulement : le pneu s'écrase sous la charge
// ---------------------------------------------------------------------
// Pression × surface de contact = charge, donc surface = charge / pression.
// Pour un tore (le pneu) appuyé sur un plan, la surface de contact vaut
// environ 2π × δ × √(R × r) (δ = écrasement, R = rayon de roue,
// r = demi-largeur du pneu). D'où δ = charge / (pression × 2π × √(R r)).
// Le rayon « qui roule » vaut environ R − δ/3 (règle usuelle pour les
// pneumatiques, hypothèse). Un pneu sous-gonflé fait donc un tour sur une
// distance un peu plus courte : le compteur du boîtier surestime la vitesse.
TPMS.veloRayonRoulementM = function (v, pressionBar, chargeN) {
  var p = (pressionBar === undefined || pressionBar === null) ? v.pressionNominaleBar : pressionBar;
  var R = v.rayonRoueM, r = v.largeurPneuMm / 2000;
  var pPa = Math.max(p, 0.05) * 100000;
  var ecrasement = chargeN / (pPa * 2 * Math.PI * Math.sqrt(R * r));
  ecrasement = Math.min(ecrasement, 0.8 * 2 * r);   // butée : le pneu touche la jante
  return R - ecrasement / 3;
};

// Temps nécessaire (s) pour parcourir x mètres avec une vitesse initiale
// v0 et une accélération a constantes : on résout x = v0 t + ½ a t².
// Écriture t = 2x / (v0 + √(v0² + 2ax)) : même résultat que la formule
// habituelle, mais sans division par a (qui peut être nul).
function tempsPourDistance(x, v0, a) {
  var disc = Math.max(0, v0 * v0 + 2 * a * x);
  var den = v0 + Math.sqrt(disc);
  return den > 0 ? 2 * x / den : 0;
}

// ---------------------------------------------------------------------
// Un pas de simulation
// ---------------------------------------------------------------------
// entrees = { puissanceW, freinage (0..1), penteRad, ventFaceMs,
//             revetement, pressionAVBar, pressionARBar, densiteAir }
TPMS.veloAvancer = function (v, dtS, entrees) {
  var e = entrees || {};
  var g = TPMS.G_MS2;
  var P = Math.max(0, e.puissanceW || 0);
  var freinage = borner(e.freinage || 0, 0, 1);
  var pente = e.penteRad || 0;
  var vent = e.ventFaceMs || 0;
  var rho = e.densiteAir || TPMS.DENSITE_AIR_STANDARD;
  var rev = e.revetement || "asphalte";
  var pAV = (e.pressionAVBar === undefined) ? v.pressionNominaleBar : e.pressionAVBar;
  var pAR = (e.pressionARBar === undefined) ? v.pressionNominaleBar : e.pressionARBar;

  var m = v.masseCyclisteKg + v.masseVeloKg;
  var mEff = m + v.masseInertielleKg;       // masse « vue » par l'accélération
  var v0 = v.vitesseMs;

  // --- Bilan des forces (évaluées au début du pas : Euler explicite) ---
  var poids = m * g;
  var fPoids = poids * Math.sin(pente);                 // > 0 en montée : freine
  var normale = poids * Math.cos(pente);                // force qui écrase les pneus
  var chargeAV = normale * v.repartitionAV, chargeAR = normale - chargeAV;
  v.crrAV = TPMS.veloCrr(v, pAV, rev);
  v.crrAR = TPMS.veloCrr(v, pAR, rev);
  var fRoulement = v.crrAV * chargeAV + v.crrAR * chargeAR;
  var vAir = v0 + vent;                                 // vitesse de l'air vue par le cycliste
  var fAero = 0.5 * rho * v.cdA * vAir * Math.abs(vAir); // signe : vent arrière fort → pousse
  var fPropulsion = Math.min(P * v.rendementTransmission / Math.max(v0, TPMS.VITESSE_MIN_PROPULSION_MS),
                             TPMS.FORCE_PROPULSION_MAX_N);
  var fFrein = freinage * v.freinMaxN;

  // Forces « motrices » (peuvent pousser dans un sens ou dans l'autre)
  // et forces « de frottement » (s'opposent toujours au mouvement).
  var fMotrice = fPropulsion - fPoids - fAero;
  var fFrottement = fRoulement + fFrein;
  var a;
  if (v0 <= 1e-9) {
    // À l'arrêt, les frottements empêchent de partir mais ne font jamais
    // reculer. Si le vélo devait reculer (montée sans pédaler), on suppose
    // que le cycliste pose le pied : il reste immobile.
    a = fMotrice > fFrottement ? (fMotrice - fFrottement) / mEff : 0;
  } else {
    a = (fMotrice - fFrottement) / mEff;
  }

  // --- Intégration sur le pas : accélération supposée constante ---
  var v1, s, dureeMouvement;
  if (v0 + a * dtS < 0) {
    // Le vélo s'arrête AVANT la fin du pas : on ne le fait pas reculer.
    dureeMouvement = v0 / -a;
    s = v0 * dureeMouvement / 2;
    v1 = 0;
  } else {
    dureeMouvement = dtS;
    v1 = v0 + a * dtS;
    s = (v0 + v1) / 2 * dtS;          // aire du trapèze sous la courbe v(t)
  }

  // --- Tops de l'aimant (roue avant) ---
  // On connaît x(t) = v0 t + ½ a t² pendant le pas : on cherche les
  // instants exacts où la roue a fait un nombre entier de tours.
  v.rayonRoulementAVM = TPMS.veloRayonRoulementM(v, pAV, chargeAV);
  v.rayonRoulementARM = TPMS.veloRayonRoulementM(v, pAR, chargeAR);
  var circAV = 2 * Math.PI * v.rayonRoulementAVM;
  var circAR = 2 * Math.PI * v.rayonRoulementARM;
  var tours = s / circAV;
  var tops = [];
  if (s > 0) {
    while (v.resteTourAV < tours) {
      var t = tempsPourDistance(v.resteTourAV * circAV, v0, a);
      tops.push(Math.min(t, dureeMouvement, dtS * (1 - 1e-12)));
      v.resteTourAV += 1;
    }
    v.resteTourAV -= tours;
    var toursAR = s / circAR;
    v.resteTourAR = v.resteTourAR - toursAR;
    v.resteTourAR -= Math.floor(v.resteTourAR);       // ramené dans [0, 1[
  }
  v.topsAimant = tops;
  v.nbTopsAimant += tops.length;
  v.angleRoueAVDeg = angleDepuisReste(v.resteTourAV);
  v.angleRoueARDeg = angleDepuisReste(v.resteTourAR);

  // --- Vibrations au guidon ---
  // Proportionnelles à la vitesse et au revêtement ; un pneu plus gonflé
  // filtre moins (√pression) ; à plat, la jante tape : on double.
  var revInfo = TPMS.REVETEMENTS[rev] || TPMS.REVETEMENTS.asphalte;
  var vMoy = (v0 + v1) / 2;
  var pMoy = Math.max((pAV + pAR) / 2, 0.05);
  var vib = revInfo.vibrationGParMs * vMoy * Math.sqrt(pMoy / v.pressionNominaleBar);
  if (Math.min(pAV, pAR) < TPMS.PRESSION_DEBUT_PLAT_BAR) vib *= 2;
  var bruit = TPMS.aleaNormal(v.alea);                 // tiré à chaque pas : reproductible
  v.vibrationG = vMoy > 0.01 ? Math.max(0, vib * (1 + 0.15 * bruit)) : 0;

  // --- Mise à jour de l'état ---
  v.vitesseMs = v1;
  v.accelerationMs2 = (v1 - v0) / dtS;
  v.distanceM += s;
  v.tempsS += dtS;
  v.puissanceW = P;
  v.energieCyclisteJ += P * dtS;
  if (v1 > v.vitesseMaxMs) v.vitesseMaxMs = v1;
  v.forces = { propulsionN: fPropulsion, poidsN: fPoids, roulementN: fRoulement,
               aeroN: fAero, freinN: v0 > 0 ? fFrein : 0 };
  return v;
};

// =====================================================================
// LE CYCLISTE
// =====================================================================
// Le cycliste choisit à chaque instant une puissance de pédalage et un
// niveau de freinage, comme un vrai cycliste :
//   - il pédale à une fraction de sa FTP (puissance tenable 1 h) qui
//     augmente en montée et diminue en descente ;
//   - il ne dépasse pas une vitesse de confort, ralentit avant les
//     virages serrés, s'arrête aux feux rouges et à l'arrivée ;
//   - il se fatigue un peu ; sa puissance fluctue (on ne pédale jamais
//     parfaitement régulièrement) ;
//   - il s'arrête s'il sent qu'un pneu est à plat.
//
// Styles (valeurs par défaut, hypothèses) :
//   ftpW : ~2 W/kg pour un cycliste occasionnel, ~3,3 W/kg pour un
//     cycliste de club (profils de puissance de Coggan).
//   fractionPlat / fractionMontee : part de la FTP sur le plat / en côte
//     (une sortie d'endurance se roule à 55-75 % de la FTP).
//   vitesseConfortKmh : vitesse maximale acceptée (descentes).
//   vitesseRoueLibreKmh : au-delà, il ne peut plus pédaler utilement.
//   accLateraleMs2 : accélération latérale acceptée en virage
//     (2 m/s² ≈ 11° d'inclinaison, 3,5 m/s² ≈ 20°).
//   decelConfortMs2 : freinage « normal » (1,2 à 2 m/s²).
TPMS.STYLES_CYCLISTE = {
  tranquille: { ftpW: 150, puissanceMaxW: 450, fractionPlat: 0.55, fractionMontee: 0.85,
                vitesseConfortKmh: 30, vitesseRoueLibreKmh: 30, accLateraleMs2: 2.0,
                decelConfortMs2: 1.2 },
  sportif:    { ftpW: 250, puissanceMaxW: 900, fractionPlat: 0.62, fractionMontee: 0.88,
                vitesseConfortKmh: 55, vitesseRoueLibreKmh: 50, accLateraleMs2: 3.5,
                decelConfortMs2: 2.0 },
  vtt:        { ftpW: 220, puissanceMaxW: 800, fractionPlat: 0.60, fractionMontee: 0.90,
                vitesseConfortKmh: 35, vitesseRoueLibreKmh: 38, accLateraleMs2: 3.0,
                decelConfortMs2: 1.8 },
  trajet:     { ftpW: 180, puissanceMaxW: 600, fractionPlat: 0.60, fractionMontee: 0.85,
                vitesseConfortKmh: 32, vitesseRoueLibreKmh: 35, accLateraleMs2: 2.2,
                decelConfortMs2: 1.5 }
};

// Le cycliste s'arrête 2 m avant le feu (ligne d'arrêt).
TPMS.MARGE_FEU_M = 2;
// Au-delà de 3 m/s² nécessaires pour s'arrêter, il juge qu'il est trop
// tard et passe (feu passé à l'orange juste devant lui).
TPMS.DECEL_MAX_DECISION_FEU_MS2 = 3.0;
// Variabilité de la puissance : ±6 % autour de la consigne, constante de
// temps 8 s (processus d'Ornstein-Uhlenbeck, hypothèse).
TPMS.BRUIT_PUISSANCE = 0.06;
TPMS.BRUIT_PUISSANCE_TAU_S = 8;
// Fatigue : -1,5 % de puissance par tranche de 100 kJ dépensés, jusqu'à
// -25 % (hypothèse ; une sortie de 2 h à 150 W ≈ 1 080 kJ → -16 %).
TPMS.FATIGUE_PAR_100KJ = 0.015;

TPMS.creerCycliste = function (options) {
  var o = options || {};
  var style = TPMS.STYLES_CYCLISTE[o.style] ? o.style : "tranquille";
  var s = TPMS.STYLES_CYCLISTE[style];
  var alea = TPMS.creerAleaNomme(o.graine || 0, "cycliste");
  var profil = {};
  for (var cle in s) profil[cle] = s[cle];
  if (o.ftpW) profil.ftpW = o.ftpW;
  if (o.puissanceMaxW) profil.puissanceMaxW = o.puissanceMaxW;
  return {
    style: style,
    profil: profil,
    alea: alea,
    etat: "arret",             // "roule", "feu", "arret", "fini", "crevaison"
    attenteS: TPMS.aleaEntre(alea, 1, 3),   // temps avant le départ
    puissanceW: 0,             // puissance lissée réellement fournie
    bruit: 0,                  // écart aléatoire relatif de puissance
    forme: 1,                  // 1 = frais, diminue avec la fatigue
    energieJ: 0,
    feuCibleCle: null,         // feu rouge devant lequel il a décidé de s'arrêter
    feuLibereCle: null,        // feu qu'il a déjà franchi (ou décidé de passer)
    feuCourant: null,
    reactionS: null,           // temps de réaction restant au passage au vert
    delaiCrevaisonS: null,     // temps avant de « sentir » la crevaison
    vitesseAutoriseeMs: Infinity,
    contrainte: "",            // ce qui limite la vitesse (affichage)
    nbArretsFeu: 0
  };
};

// Met le cycliste en pause (photo, ravitaillement...) pendant dureeS.
TPMS.cyclistePause = function (cy, dureeS) {
  cy.etat = "arret";
  cy.attenteS = dureeS;
};

// Fraction de freinage pour obtenir une décélération donnée (m/s²).
function freinagePour(v, decelMs2) {
  var m = v.masseCyclisteKg + v.masseVeloKg + v.masseInertielleKg;
  return borner(decelMs2 * m / v.freinMaxN, 0, 1);
}

// Vitesse maximale à laquelle on peut rouler maintenant pour atteindre
// la vitesse vCible dans d mètres en freinant à aConf :
// v² = vCible² + 2 × a × d (équation du mouvement uniformément décéléré).
function vitesseAnticipee(vCible, d, aConf) {
  return Math.sqrt(vCible * vCible + 2 * aConf * Math.max(0, d));
}

function commandeArret(cy, v) {
  cy.puissanceW = 0;
  cy.vitesseAutoriseeMs = 0;
  // Freinage doux tant qu'il roule, puis freins serrés à l'arrêt.
  return { puissanceW: 0, freinage: v.vitesseMs > 0.3 ? freinagePour(v, cy.profil.decelConfortMs2) : 1 };
}

TPMS.cyclisteCommande = function (cy, v, point, tS, dtS) {
  var p = cy.profil;
  var vit = v.vitesseMs;

  // ---- 1. États où le cycliste ne pédale pas ----
  if (point.fini || (point.resteM < 0.5 && vit < 0.3)) {
    cy.etat = "fini"; cy.contrainte = "arrivée";
    return commandeArret(cy, v);
  }

  // Crevaison : il la « sent » après un temps de réaction de 1 à 4 s
  // (le vélo devient mou, la roue arrière chasse).
  if (point.pneuAPlat) {
    if (cy.etat !== "crevaison") {
      if (cy.delaiCrevaisonS === null) cy.delaiCrevaisonS = TPMS.aleaEntre(cy.alea, 1, 4);
      cy.delaiCrevaisonS -= dtS;
      if (cy.delaiCrevaisonS <= 0) cy.etat = "crevaison";
    }
  } else {
    cy.delaiCrevaisonS = null;
    if (cy.etat === "crevaison") cy.etat = "roule";   // pneu réparé / regonflé
  }
  if (cy.etat === "crevaison") { cy.contrainte = "crevaison"; return commandeArret(cy, v); }

  if (cy.etat === "arret") {
    cy.attenteS -= dtS;
    if (cy.attenteS > 0) { cy.contrainte = "pause"; return commandeArret(cy, v); }
    cy.etat = "roule";
  }

  if (cy.etat === "feu") {
    cy.contrainte = "feu rouge";
    if (TPMS.feuEstRouge(cy.feuCourant.feu, tS)) return commandeArret(cy, v);
    // Vert : il repart après un temps de réaction de 0,6 à 2 s.
    if (cy.reactionS === null) cy.reactionS = TPMS.aleaEntre(cy.alea, 0.6, 2.0);
    cy.reactionS -= dtS;
    if (cy.reactionS > 0) return commandeArret(cy, v);
    cy.reactionS = null;
    cy.feuLibereCle = cy.feuCourant.cle;
    cy.feuCibleCle = null;
    cy.etat = "roule";
  }

  // ---- 2. Vitesse autorisée (anticipation) ----
  var rev = TPMS.REVETEMENTS[point.revetement] || TPMS.REVETEMENTS.asphalte;
  var aConf = p.decelConfortMs2;
  var vMax = p.vitesseConfortKmh / 3.6 * rev.facteurConfort;
  var contrainte = "confort";
  var enApproche = false;    // true si la limite vient d'un obstacle encore devant
  function limiter(lim, d, nom) {
    if (lim < vMax) { vMax = lim; contrainte = nom; enApproche = d > 0.5; }
  }

  // Virages : vitesse telle que v² / R = accélération latérale acceptée.
  var virages = point.virages || [];
  for (var i = 0; i < virages.length; i++) {
    var vVirage = Math.sqrt(p.accLateraleMs2 * virages[i].rayonM);
    limiter(vitesseAnticipee(vVirage, virages[i].distanceM, aConf), virages[i].distanceM, "virage");
  }

  // Feu tricolore.
  if (point.prochainFeu && point.prochainFeuCle !== cy.feuLibereCle) {
    var dArret = point.prochainFeuM - TPMS.MARGE_FEU_M;
    var rouge = TPMS.feuEstRouge(point.prochainFeu, tS);
    if (rouge && cy.feuCibleCle !== point.prochainFeuCle) {
      // Décision : peut-il s'arrêter sans freinage brutal ?
      var besoin = vit * vit / (2 * Math.max(dArret, 0.1));
      if (dArret > -1 && besoin <= TPMS.DECEL_MAX_DECISION_FEU_MS2) {
        cy.feuCibleCle = point.prochainFeuCle;
      } else {
        cy.feuLibereCle = point.prochainFeuCle;     // trop tard : il passe
      }
    }
    if (!rouge && cy.feuCibleCle === point.prochainFeuCle) cy.feuCibleCle = null;  // vert : il continue
    if (rouge && cy.feuCibleCle === point.prochainFeuCle) {
      limiter(vitesseAnticipee(0, dArret, aConf), dArret, "feu rouge");
      if (vit < 0.3 && dArret < 4) {
        cy.etat = "feu";
        cy.nbArretsFeu++;
        cy.feuCourant = { feu: point.prochainFeu, cle: point.prochainFeuCle };
        cy.contrainte = "feu rouge";
        return commandeArret(cy, v);
      }
    }
  }

  // Arrivée (parcours non bouclé) : arrêt 1 m avant la fin.
  if (isFinite(point.resteM)) {
    limiter(vitesseAnticipee(0, point.resteM - 1, aConf), point.resteM - 1, "arrivée");
    if (point.resteM < 3 && vit < 0.3) {          // arrivé (à 3 m près)
      cy.etat = "fini"; cy.contrainte = "arrivée";
      return commandeArret(cy, v);
    }
  }
  cy.vitesseAutoriseeMs = vMax;
  cy.contrainte = contrainte;

  // ---- 3. Trop vite : il arrête de pédaler et freine ----
  if (vit > vMax) {
    // Décélération voulue : rattraper l'écart en ~0,5 s. Si un obstacle
    // approche (virage, feu, arrivée), la vitesse autorisée baisse
    // d'elle-même au rythme aConf : on freine donc en plus à aConf pour
    // la suivre sans retard. Les freins fournissent ce que la pente, le
    // roulement et l'air ne font pas déjà (forces du pas précédent, que
    // le cycliste « ressent »).
    var mEff = v.masseCyclisteKg + v.masseVeloKg + v.masseInertielleKg;
    var aVoulue = (vMax - vit) / 0.5 - (enApproche ? aConf : 0);   // négative
    var fNaturelle = -(v.forces.poidsN + v.forces.roulementN + v.forces.aeroN);
    var fFrein = fNaturelle - mEff * aVoulue;
    cy.puissanceW = 0;
    if (vMax < 0.2 && vit < 0.3) return { puissanceW: 0, freinage: 1 };
    return { puissanceW: 0, freinage: borner(fFrein / v.freinMaxN, 0, 1) };
  }

  // ---- 4. Puissance de pédalage ----
  var pente = Math.tan(point.penteRad || 0);
  var pPlat = p.fractionPlat * p.ftpW, pMontee = p.fractionMontee * p.ftpW;
  var consigne;
  if (pente >= 0) {
    // De 0 à 6 % : on passe progressivement de l'effort « plat » à l'effort « côte ».
    consigne = pPlat + (pMontee - pPlat) * Math.min(1, pente / 0.06);
  } else {
    // En descente, on pédale de moins en moins ; à -4 % : roue libre.
    consigne = pPlat * Math.max(0, 1 + pente / 0.04);
  }
  // Relance au démarrage (en danseuse) : jusqu'à 4 m/s (14 km/h).
  if (vit < 4) consigne = Math.max(consigne, Math.min(p.puissanceMaxW * 0.5, 1.6 * pPlat));
  // Trop vite pour pédaler (braquet trop petit) : roue libre.
  consigne *= borner((p.vitesseRoueLibreKmh / 3.6 - vit) / 2, 0, 1);
  // Près de la vitesse autorisée : il lève le pied progressivement.
  consigne *= borner((vMax - vit) / 1.5, 0, 1);

  // Fatigue légère.
  cy.forme = Math.max(0.75, 1 - TPMS.FATIGUE_PAR_100KJ * cy.energieJ / 100000);
  consigne *= cy.forme;

  // Fluctuation aléatoire reproductible (Ornstein-Uhlenbeck) :
  // x ← x − x·dt/τ + σ·√(2 dt/τ)·N(0,1)  (revient vers 0, écart-type σ).
  var tau = TPMS.BRUIT_PUISSANCE_TAU_S;
  cy.bruit += -cy.bruit * dtS / tau +
              TPMS.BRUIT_PUISSANCE * Math.sqrt(2 * dtS / tau) * TPMS.aleaNormal(cy.alea);
  consigne *= (1 + cy.bruit);
  consigne = borner(consigne, 0, p.puissanceMaxW);

  // Les jambes ne changent pas d'effort instantanément (constante ~1,5 s).
  cy.puissanceW += (consigne - cy.puissanceW) * Math.min(1, dtS / 1.5);
  cy.energieJ += cy.puissanceW * dtS;
  return { puissanceW: cy.puissanceW, freinage: 0 };
};

// ---------------------------------------------------------------------
// Aide : un pas complet « cycliste + vélo » sur un parcours
// ---------------------------------------------------------------------
// Exemple d'enchaînement pour le moteur (qui peut faire autrement).
// conditions = { ventFaceMs, densiteAir, pressionAVBar, pressionARBar, pneuAPlat }
// Renvoie le point du parcours où se trouve le vélo AVANT le pas.
TPMS.veloEtapeParcours = function (v, cy, prep, tS, dtS, conditions) {
  var c = conditions || {};
  var point = TPMS.parcoursPoint(prep, v.distanceM);
  point.pneuAPlat = !!c.pneuAPlat;
  var cmd = TPMS.cyclisteCommande(cy, v, point, tS, dtS);
  TPMS.veloAvancer(v, dtS, {
    puissanceW: cmd.puissanceW,
    freinage: cmd.freinage,
    penteRad: point.penteRad,
    ventFaceMs: c.ventFaceMs || 0,
    revetement: point.revetement,
    pressionAVBar: c.pressionAVBar,
    pressionARBar: c.pressionARBar,
    densiteAir: c.densiteAir
  });
  return point;
};
