// =====================================================================
// capteur.js — Électronique d'un capteur TPMS « bouchon de valve »
// ---------------------------------------------------------------------
// MODÈLE DU MONDE (simulation) : ce fichier remplace le vrai capteur
// vissé sur la valve. Il produit les mêmes trames de 18 octets
// (TPMS.encoderTrame, logique/trame.js), au même rythme qu'un vrai.
// Nécessite : trame.js, alea.js, atmosphere.js, pneu.js
// (et energie.js pour les consommations ; sinon valeurs par défaut).
//
// Ce que fait un vrai capteur, et donc ce modèle :
//   - il dort presque tout le temps (≈ 2 µA) ;
//   - il se réveille toutes les secondes pour MESURER la pression ;
//   - il ANNONCE (émission BLE) toutes les 3 s si la roue tourne, toutes
//     les 60 s si elle est arrêtée, et tout de suite si la pression a
//     brusquement changé (crevaison) ;
//   - il est alimenté par une pile bouton CR1632 qui s'use et n'aime pas
//     le froid.
//
// LIMITE IMPORTANTE (réaliste) : le capteur mesure la pression ABSOLUE
// et lui soustrait une pression atmosphérique FIXE de 1013,25 hPa, car il
// ne connaît pas l'altitude. En montagne, l'air extérieur pèse moins :
// à 1500 m (846 hPa) le capteur annonce ≈ 0,17 bar de MOINS que ce que
// lirait un manomètre sur place. Le boîtier pourrait corriger avec un
// baromètre... qu'il n'a pas.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.CAPTEUR = {
  pressionReferencePa: 101325,   // pression soustraite par le capteur (1013,25 hPa, fixe)
  periodeMesureMs: 1000,         // une mesure de pression par seconde (hypothèse)
  // Détection de rotation : la valve tourne à r ≈ 0,30 m du moyeu, la
  // force centrifuge vaut v²/r. Hypothèse : l'accéléromètre déclenche
  // au-delà de 0,5 g, soit v > √(0,5 × 9,81 × 0,30) ≈ 1,2 m/s (4,4 km/h).
  rayonValveM: 0.30,
  seuilRotationG: 0.5,
  // Reste en « mode roulage » 60 s après le dernier mouvement, pour ne
  // pas basculer à chaque feu rouge (hypothèse, inspiré des TPMS auto).
  delaiArretMs: 60000,
  // advDelay : la norme BLE ajoute 0 à 10 ms au hasard à chaque annonce,
  // pour que deux émetteurs ne se percutent pas toujours
  // (Bluetooth Core Spec, Vol 6, Part B, § 4.4.2.2.1).
  advDelayMaxMs: 10,
  // Sans pression (capteur dévissé ou pneu à plat), immobile pendant
  // 5 min : le capteur se met en sommeil profond et se tait jusqu'à ce
  // qu'il sente à nouveau une pression (hypothèse, économie de pile).
  veilleSansPressionMs: 300000,
  seuilSansPressionBar: 0.1,     // en dessous : alarme « pas de pression » (octet 17 = 0x01)
  seuilRetourPressionBar: 0.2,   // au-dessus : il se réveille
  // Précision : décalage d'étalonnage propre à chaque capteur, tiré au
  // hasard une fois (écart-type 0,02 bar ; les fabricants annoncent
  // ±0,1 bar), + bruit à chaque mesure (bruitBar, écart-type).
  decalageEcartTypeBar: 0.02,
  decalageTemperatureEcartTypeC: 0.5,
  bruitTemperatureC: 0.1,
  resolutionTemperatureC: 0.1
};

// Thermique du BOÎTIER du capteur (bouchon de ≈ 10 g, à l'extérieur du
// pneu) : il suit l'air ambiant et le soleil, pas l'air du pneu.
TPMS.THERMIQUE_CAPTEUR = {
  constanteTempsS: 240,          // ≈ 4 min à l'arrêt (petite pièce), plus court en roulant
  ventilationMs: 3,              // échange multiplié par (1 + v/3)
  soleilC: 8,                    // en plein soleil, à l'arrêt : ≈ +8 °C (hypothèse)
  conductionValve: 0.15          // la tige de valve lui transmet 15 % de l'écart pneu/ambiant
};

// ---------------------------------------------------------------------
// Pile CR1632 (lithium / dioxyde de manganèse, 3 V nominal)
// ---------------------------------------------------------------------
// Tension à vide selon la part de charge restante : un long plateau
// vers 2,9-3,0 V puis une chute rapide en fin de vie. Points relevés sur
// l'allure des courbes de décharge des fiches techniques CR (Energizer,
// Panasonic, Renata) ; interpolation linéaire entre les points.
TPMS.PILE_COURBE = [
  // [part restante, tension (V)]
  [1.00, 3.10],
  [0.90, 3.00],
  [0.50, 2.95],
  [0.20, 2.88],
  [0.10, 2.80],
  [0.05, 2.65],
  [0.02, 2.40],
  [0.00, 2.00]
];
TPMS.PILE = {
  // Le froid baisse la tension à vide : ≈ −3 mV par °C sous 20 °C (hypothèse).
  froidVParC: 0.003,
  // Résistance interne ≈ 20 Ω à 20 °C (ordre de grandeur des piles
  // bouton CR16xx) ; elle augmente fortement au froid : +6 % par °C sous
  // 20 °C (×3,4 à −20 °C, allure des fiches Energizer).
  resistanceInterneOhm: 20,
  resistanceFroidParC: 0.06,
  courantEmissionMa: 6,          // pic de courant pendant l'émission radio (≈ 6 mA à 0 dBm)
  tensionMinV: 2.0,              // sous cette tension EN CHARGE, le capteur redémarre sans cesse : muet
  // Pourcentage annoncé : le capteur ne connaît que sa tension, il la
  // convertit linéairement entre 2,2 V (0 %) et 3,0 V (100 %).
  // Conséquence réaliste : il affiche ≈ 95 % pendant la moitié de la vie
  // de la pile, puis le pourcentage s'effondre.
  tensionVidePct: 2.2,
  tensionPleinePct: 3.0,
  autoDechargeParAn: 0.01        // ≈ 1 % par an (fiches CR)
};

// Consommation : on reprend celles du bilan énergétique (energie.js).
// Les mesures d'une seconde sont comprises dans le courant de sommeil.
TPMS.capteurConso = function () {
  return TPMS.CONSO_CAPTEUR || { sommeilMa: 0.002, annonceMas: 0.025 };
};

// Tension à vide de la pile (V), selon la part restante et la température.
TPMS.pileTensionVideV = function (partRestante, temperatureC) {
  var f = Math.max(0, Math.min(1, partRestante));
  var courbe = TPMS.PILE_COURBE;
  var v = courbe[courbe.length - 1][1];
  for (var i = 0; i < courbe.length - 1; i++) {
    var haut = courbe[i], bas = courbe[i + 1];
    if (f <= haut[0] && f >= bas[0]) {
      v = bas[1] + (haut[1] - bas[1]) * (f - bas[0]) / (haut[0] - bas[0]);
      break;
    }
  }
  var froid = Math.max(0, 20 - temperatureC);
  return v - TPMS.PILE.froidVParC * froid;
};

// Tension pendant l'émission : tension à vide − R_interne × I (loi d'Ohm).
TPMS.pileTensionEnChargeV = function (tensionVideV, temperatureC) {
  var froid = Math.max(0, 20 - temperatureC);
  var r = TPMS.PILE.resistanceInterneOhm * (1 + TPMS.PILE.resistanceFroidParC * froid);
  return tensionVideV - r * TPMS.PILE.courantEmissionMa / 1000;
};

// Pourcentage annoncé dans la trame, déduit de la seule tension.
TPMS.pilePourcentage = function (tensionV) {
  var k = TPMS.PILE;
  var pct = (tensionV - k.tensionVidePct) / (k.tensionPleinePct - k.tensionVidePct) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

// ---------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------
// options = { numero, adresse: [5 octets], graine, intervalleRoulageMs,
//   intervalleArretMs, seuilVariationRapideBar, resolutionBar, bruitBar,
//   pile: { capaciteMAh, restanteMAh }, decalageBar }
TPMS.creerCapteurTPMS = function (options) {
  var o = options || {};
  function val(v, defaut) { return v === undefined ? defaut : v; }
  var numero = val(o.numero, 1);
  var alea = TPMS.creerAleaNomme(val(o.graine, 1), "capteur" + numero);
  var pile = o.pile || {};
  var capacite = val(pile.capaciteMAh, TPMS.CR1632_MAH || 130);
  var k = TPMS.CAPTEUR;

  var c = {
    numero: numero,
    adresse: o.adresse || [0xEA, 0xCA, 0x00, 0x00, numero],
    alea: alea,
    intervalleRoulageMs: val(o.intervalleRoulageMs, 3000),
    intervalleArretMs: val(o.intervalleArretMs, 60000),
    seuilVariationRapideBar: val(o.seuilVariationRapideBar, 0.15),
    resolutionBar: val(o.resolutionBar, 0.01),
    bruitBar: val(o.bruitBar, 0.005),
    plageMaxBar: val(o.plageMaxBar, 3.5),
    // Défauts de fabrication, tirés une fois pour toutes
    decalageBar: val(o.decalageBar, k.decalageEcartTypeBar * TPMS.aleaNormal(alea)),
    decalageTemperatureC: k.decalageTemperatureEcartTypeC * TPMS.aleaNormal(alea),

    // Pile
    pileCapaciteMAh: capacite,
    pileRestanteMAh: val(pile.restanteMAh, capacite),
    pileTensionV: 0,             // tension à vide (V)
    pileTensionChargeV: 0,       // tension pendant une émission (V)
    pilePct: 100,                // pourcentage annoncé

    // État
    monte: true,                 // false = dévissé de la valve
    actif: true,                 // true = le capteur émet (pile assez forte, pas en sommeil profond)
    sommeilProfond: false,
    enRoulage: false,
    dernierMouvementMs: -Infinity,
    debutSansPressionMs: null,
    temperatureCapteurC: null,   // température physique du boîtier (initialisée au 1er appel)

    // Horaires
    prochaineMesureMs: null,
    prochaineAnnonceMs: null,
    derniereAnnonceMs: null,
    derniereAnnoncePressionBar: null,
    derniereMesure: null,        // { pressionBar, temperatureC, alarme }
    nbAnnonces: 0
  };
  TPMS.capteurTPMSMettreAJourPile(c);
  return c;
};

TPMS.capteurTPMSRetirer = function (c) { c.monte = false; return c; };
TPMS.capteurTPMSRemettre = function (c) { c.monte = true; return c; };

TPMS.capteurTPMSMettreAJourPile = function (c) {
  var t = c.temperatureCapteurC === null ? 20 : c.temperatureCapteurC;
  c.pileTensionV = TPMS.pileTensionVideV(c.pileRestanteMAh / c.pileCapaciteMAh, t);
  c.pileTensionChargeV = TPMS.pileTensionEnChargeV(c.pileTensionV, t);
  c.pilePct = TPMS.pilePourcentage(c.pileTensionV);
};

// Retire une charge (mA·s) de la pile.
TPMS.capteurTPMSConsommer = function (c, chargeMas) {
  c.pileRestanteMAh = Math.max(0, c.pileRestanteMAh - chargeMas / 3600);
};

// ---------------------------------------------------------------------
// Une mesure : ce que le capteur « voit » à cet instant.
// ---------------------------------------------------------------------
TPMS.capteurTPMSMesurer = function (c, pneu, ctx) {
  var k = TPMS.CAPTEUR;
  // Pression absolue au bout de la valve : celle du pneu si le capteur
  // est vissé, sinon celle de l'air (vraie pression locale).
  var pAbs = (c.monte && pneu) ? TPMS.pneuPressionAbsoluePa(pneu)
                               : TPMS.pressionAtmospheriquePa(ctx.altitudeM || 0);
  var relative = (pAbs - k.pressionReferencePa) / TPMS.PA_PAR_BAR;   // erreur d'altitude ici
  relative += c.decalageBar + c.bruitBar * TPMS.aleaNormal(c.alea);
  relative = Math.max(0, Math.round(relative / c.resolutionBar) * c.resolutionBar);
  // Plage de mesure du capteur : au-delà, il sature (il annonce son
  // maximum). Les TPMS vélo bon marché plafonnent vers 3,5 bar
  // (hypothèse du cahier des charges, à vérifier) : un pneu de route
  // gonflé à 6 bar s'affiche alors 3,50, ce qui est faux.
  relative = Math.min(relative, c.plageMaxBar);
  relative = Math.round(relative * 10000) / 10000;   // évite 2.2100000000000004

  var t = c.temperatureCapteurC + c.decalageTemperatureC + k.bruitTemperatureC * TPMS.aleaNormal(c.alea);
  t = Math.round(t / k.resolutionTemperatureC) * k.resolutionTemperatureC;
  t = Math.round(t * 100) / 100;

  c.derniereMesure = {
    pressionBar: relative,
    temperatureC: t,
    alarme: relative < k.seuilSansPressionBar ? 0x01 : 0x00
  };
  return c.derniereMesure;
};

// Émet une annonce à l'instant t (la mesure doit être à jour).
TPMS.capteurTPMSAnnoncer = function (c, t, emissions) {
  var m = c.derniereMesure;
  TPMS.capteurTPMSConsommer(c, TPMS.capteurConso().annonceMas);
  var mesure = {
    numero: c.numero,
    adresse: c.adresse,
    pressionBar: m.pressionBar,
    temperatureC: m.temperatureC,
    batteriePct: c.pilePct,
    alarme: m.alarme
  };
  var octets;
  if (c.cleV2) {
    // Capteur v2 : nouvelle adresse privée tous les quarts d'heure,
    // compteur +1 et signature à chaque trame (logique/trame2.js).
    if (!c.adresseV2 || t - c.rotationAdresseMs >= TPMS.ROTATION_ADRESSE_MS) {
      c.adresseV2 = TPMS.adressePrivee(c.cleV2, Math.floor(c.alea() * 256), Math.floor(c.alea() * 256));
      c.rotationAdresseMs = t;
    }
    c.compteurV2 = (c.compteurV2 || 0) + 1;
    octets = TPMS.encoderTrameV2(mesure, c.cleV2, c.adresseV2, c.compteurV2);
  } else {
    octets = TPMS.encoderTrame(mesure);
  }
  emissions.push({ tMs: t, octets: octets });
  c.nbAnnonces++;
  c.derniereAnnonceMs = t;
  c.derniereAnnoncePressionBar = m.pressionBar;
  var intervalle = c.enRoulage ? c.intervalleRoulageMs : c.intervalleArretMs;
  c.prochaineAnnonceMs = t + intervalle + c.alea() * TPMS.CAPTEUR.advDelayMaxMs;
};

// ---------------------------------------------------------------------
// Faire vivre le capteur pendant l'intervalle ]tMs − dtS·1000, tMs].
// ctx = { altitudeM, vitesseMs, temperatureAmbianteC, ensoleillement }
// Retourne le tableau des émissions [{ tMs, octets }] de l'intervalle.
// ---------------------------------------------------------------------
TPMS.capteurTPMSAvancer = function (c, tMs, dtS, pneu, ctx) {
  ctx = ctx || {};
  var k = TPMS.CAPTEUR;
  var th = TPMS.THERMIQUE_CAPTEUR;
  var tDebut = tMs - dtS * 1000;
  var emissions = [];
  var tAmb = ctx.temperatureAmbianteC === undefined ? 20 : ctx.temperatureAmbianteC;
  var v = Math.max(0, ctx.vitesseMs || 0);

  // 1. Température du boîtier du capteur (premier ordre, comme le pneu).
  if (c.temperatureCapteurC === null) c.temperatureCapteurC = tAmb;
  var ventilation = 1 + v / th.ventilationMs;
  var tEq = tAmb + th.soleilC * (ctx.ensoleillement || 0) / ventilation;
  if (c.monte && pneu) tEq += th.conductionValve * (pneu.temperatureAirC - tAmb);
  var tau = th.constanteTempsS / ventilation;
  c.temperatureCapteurC += (tEq - c.temperatureCapteurC) * (1 - Math.exp(-dtS / tau));

  // 2. Pile : sommeil (mesures comprises) + auto-décharge.
  TPMS.capteurTPMSConsommer(c, TPMS.capteurConso().sommeilMa * dtS);
  c.pileRestanteMAh = Math.max(0, c.pileRestanteMAh -
    c.pileCapaciteMAh * TPMS.PILE.autoDechargeParAn * dtS / (365 * 86400));
  TPMS.capteurTPMSMettreAJourPile(c);

  // 3. Mouvement : la roue tourne-t-elle ? (force centrifuge v²/r)
  var acceleration = (c.monte ? v * v / k.rayonValveM : 0) / 9.81;   // en g
  if (acceleration > k.seuilRotationG) c.dernierMouvementMs = tMs;
  var etaitEnRoulage = c.enRoulage;
  c.enRoulage = (tMs - c.dernierMouvementMs) <= k.delaiArretMs;

  // 4. Pile trop faible : la tension s'écroule à chaque émission, le
  //    capteur redémarre sans cesse et n'émet plus rien (il peut revivre
  //    si la pile se réchauffe).
  var pileOk = c.pileTensionChargeV >= TPMS.PILE.tensionMinV;

  // Premier appel : mesure immédiate, première annonce à un instant au
  // hasard (deux capteurs allumés ensemble ne parlent pas en même temps).
  if (c.prochaineMesureMs === null) {
    c.prochaineMesureMs = tDebut + 1;
    c.prochaineAnnonceMs = tDebut + 1 + c.alea() * c.intervalleRoulageMs;
  }
  if (!pileOk) {
    c.actif = false;
    // Rien ne se passe ; on recale l'horaire pour repartir proprement.
    c.prochaineMesureMs = Math.max(c.prochaineMesureMs, tMs + 1);
    c.prochaineAnnonceMs = Math.max(c.prochaineAnnonceMs, tMs + 1);
    return emissions;
  }
  // La roue se met à tourner : on n'attend pas la fin des 60 s.
  if (c.enRoulage && !etaitEnRoulage && c.derniereAnnonceMs !== null) {
    c.prochaineAnnonceMs = Math.min(c.prochaineAnnonceMs,
      Math.max(c.derniereAnnonceMs + c.intervalleRoulageMs, tDebut + 1));
  }

  // 5. Événements de l'intervalle, dans l'ordre chronologique.
  var garde = 0;
  while (garde++ < 1e6) {
    var t = Math.min(c.prochaineMesureMs, c.prochaineAnnonceMs);
    if (t > tMs) break;
    var cEstUneAnnonce = c.prochaineAnnonceMs <= c.prochaineMesureMs;
    var m = TPMS.capteurTPMSMesurer(c, pneu, ctx);

    // Sommeil profond quand il n'y a plus de pression depuis longtemps.
    if (m.alarme && !c.enRoulage) {
      if (c.debutSansPressionMs === null) c.debutSansPressionMs = t;
      if (k.veilleSansPressionMs !== null && t - c.debutSansPressionMs >= k.veilleSansPressionMs) {
        c.sommeilProfond = true;
      }
    } else if (!m.alarme) {
      c.debutSansPressionMs = null;
    }
    if (c.sommeilProfond && m.pressionBar >= k.seuilRetourPressionBar) {
      c.sommeilProfond = false;              // de nouveau de la pression : réveil
      c.derniereAnnoncePressionBar = null;
      c.prochaineAnnonceMs = t;              // annonce tout de suite
      cEstUneAnnonce = true;
    }

    if (cEstUneAnnonce) {
      if (c.sommeilProfond) {
        c.prochaineAnnonceMs = t + c.intervalleArretMs;
      } else {
        TPMS.capteurTPMSAnnoncer(c, t, emissions);
      }
    } else {
      c.prochaineMesureMs = t + k.periodeMesureMs;
      // Variation rapide (crevaison, capteur dévissé) : annonce immédiate.
      if (!c.sommeilProfond && c.derniereAnnoncePressionBar !== null &&
          Math.abs(m.pressionBar - c.derniereAnnoncePressionBar) > c.seuilVariationRapideBar) {
        TPMS.capteurTPMSAnnoncer(c, t, emissions);
      }
    }
    if (cEstUneAnnonce && c.prochaineMesureMs <= t) c.prochaineMesureMs = t + k.periodeMesureMs;
  }
  c.actif = !c.sommeilProfond;
  return emissions;
};
