// =====================================================================
// radio.js — La radio Bluetooth Low Energy du monde simulé
// ---------------------------------------------------------------------
// MODÈLE DU MONDE (pas de la logique du boîtier) : il décide si une
// annonce BLE émise par un capteur arrive au boîtier, avec quel niveau
// (RSSI), et sinon pourquoi elle est perdue.
//
// Le chemin d'une trame, du capteur au boîtier :
//
//   capteur ──► puissance d'émission + gain d'antenne
//           ──► affaiblissement du trajet (distance, environnement)
//           ──► ombrage (obstacles qui passent : voitures, arbres...)
//           ──► masquage (jante, corps du cycliste : fourni par le moteur)
//           ──► évanouissement rapide (échos qui s'additionnent ou s'annulent)
//           ──► gain d'antenne du boîtier = puissance reçue (RSSI)
//
// Puis, côté récepteur :
//   1. le boîtier écoutait-il CE canal à CET instant ?   sinon « hors-ecoute »
//   2. le niveau dépasse-t-il la sensibilité (−95 dBm) ? sinon « trop-faible »
//   3. un autre paquet est-il arrivé en même temps ?     sinon « collision »
//   4. le bruit + les interférences ont-ils abîmé un bit ? « erreur-paquet »
//      (ou « brouillee » si c'est le brouilleur du pirate qui domine)
//
// Unités : dBm = puissance en décibels par rapport à 1 mW
//          (0 dBm = 1 mW, −30 dBm = 1 µW, −90 dBm = 1 picowatt).
//          dB = rapport de puissances (+3 dB = ×2, +10 dB = ×10).
//          On additionne des dB quand on multiplie des puissances,
//          mais pour ADDITIONNER deux puissances (bruit + interférence)
//          il faut repasser en milliwatts (voir dbmEnMw / mwEnDbm).
//
// Hasard : uniquement le générateur reproductible de alea.js. Chaque
// tirage est « nommé » par ce qu'il concerne (quel lien, quel instant,
// quel canal) : le résultat ne dépend donc ni de l'ordre des émissions
// ni de la fréquence à laquelle l'interface interroge la radio.
//
// Sources principales :
//   [BT]   Bluetooth Core Specification v5.4, Vol 6 (Low Energy Controller)
//   [NRF]  Nordic nRF52840 Product Specification v1.x, chapitre RADIO
//   [RAP]  T. S. Rappaport, Wireless Communications, 2e éd. (ch. 4 et 5)
//   [GUD]  M. Gudmundson, « Correlation model for shadow fading in mobile
//          radio systems », Electronics Letters, 1991
//   [PRO]  J. Proakis, Digital Communications (FSK non cohérente)
//   [ITU]  Recommandation ITU-R P.1238 (propagation à l'intérieur)
//   [WEI]  Modèle de Weissberger (affaiblissement par la végétation)
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// ---------------------------------------------------------------------
// Constantes du Bluetooth Low Energy
// ---------------------------------------------------------------------

// Canaux d'annonce et leur fréquence centrale [BT Vol 6 Part B §1.4.1].
// Ils ont été placés exprès entre les canaux Wi-Fi 1, 6 et 11 les plus
// utilisés... mais 37 et 38 restent au bord de ces canaux Wi-Fi, et
// 39 tombe dans le canal Wi-Fi 13, autorisé en Europe.
TPMS.BLE_CANAUX_ANNONCE = [37, 38, 39];
TPMS.BLE_FREQUENCE_MHZ = { 37: 2402, 38: 2426, 39: 2480 };

// Débit de la modulation GFSK « LE 1M » : 1 Mbit/s, donc 1 bit = 1 µs.
TPMS.BLE_DEBIT_BITS_PAR_US = 1;

// Structure d'un paquet sur l'air [BT Vol 6 Part B §2.1 et §2.3] :
//   préambule (1 o) | adresse d'accès (4 o) | en-tête PDU (2 o)
//   | adresse de l'annonceur AdvA (6 o) | données d'annonce | CRC (3 o)
// Les données d'annonce contiennent notre champ « manufacturer data »,
// précédé de 2 octets : sa longueur et son type (0xFF).
// Hypothèse : le capteur n'envoie que ce champ (pas de champ « flags »,
// facultatif pour une annonce non connectable).
TPMS.BLE_OCTETS_PREAMBULE = 1;
TPMS.BLE_OCTETS_ADRESSE_ACCES = 4;
TPMS.BLE_OCTETS_ENTETE_PDU = 2;
TPMS.BLE_OCTETS_ADRESSE_ANNONCEUR = 6;
TPMS.BLE_OCTETS_ENTETE_CHAMP = 2;
TPMS.BLE_OCTETS_CRC = 3;

// Écart entre la fin d'un paquet et le début du suivant dans un même
// événement d'annonce (le temps que la radio change de fréquence).
// La norme impose seulement < 10 ms entre deux débuts de paquets
// [BT Vol 6 Part B §4.4.2.1] ; les puces Nordic enchaînent les 3 paquets
// en un peu plus d'une milliseconde. Hypothèse : 0,2 ms.
TPMS.BLE_ECART_PAQUETS_MS = 0.2;

// advDelay : retard aléatoire de 0 à 10 ms ajouté à CHAQUE événement
// d'annonce [BT Vol 6 Part B §4.4.2.2.1]. Il évite que deux appareils
// qui émettent au même rythme se percutent à chaque fois.
TPMS.BLE_ADV_DELAY_MAX_MS = 10;

// ---------------------------------------------------------------------
// Constantes du récepteur (nRF52840 du boîtier)
// ---------------------------------------------------------------------

// Sensibilité : −95 dBm en BLE 1 Mbit/s [NRF, « RX sensitivity »].
// La norme définit la sensibilité comme le niveau qui donne un taux
// d'erreur binaire (TEB) de 0,1 % [BT Vol 6 Part A §4.1].
TPMS.RADIO_SENSIBILITE_DBM = -95;

// Rapport signal/bruit nécessaire pour ce TEB de 0,1 %.
// Pour une modulation de fréquence détectée sans cohérence (le GFSK du
// BLE est un cas de FSK), le TEB vaut [PRO] :
//        TEB = ½ · exp(−RSB / 2)       (RSB en rapport, pas en dB)
// TEB = 0,001  ⇒  RSB = 2 · ln(500) ≈ 12,4  soit ≈ 10,9 dB.
// On en déduit le bruit propre du récepteur : sensibilité − 10,9 dB,
// soit ≈ −105,9 dBm. Vérification : bruit thermique sur 1 MHz =
// −174 + 60 = −114 dBm, + facteur de bruit ≈ 8 dB : cohérent.
TPMS.RADIO_RSB_REFERENCE_DB = 10 * Math.log10(2 * Math.log(500));

// Effet de capture : quand deux paquets se chevauchent sur le même
// canal, le plus fort est quand même compris s'il dépasse l'autre
// d'au moins 6 dB. La norme exige seulement que le récepteur tolère un
// brouilleur 21 dB plus faible [BT Vol 6 Part A §4.2, C/I co-canal] ;
// les puces récentes font nettement mieux. Hypothèse : 6 dB.
TPMS.RADIO_CAPTURE_DB = 6;

// RSSI : le nRF52840 le donne au dB près (précision ±2 dB) [NRF].
TPMS.RADIO_RSSI_RESOLUTION_DB = 1;

// ---------------------------------------------------------------------
// Les environnements
// ---------------------------------------------------------------------
// Modèle « log-distance » [RAP §4.9] :
//
//     Perte(d) = PL0 + 10 · n · log10(d / 1 m)
//
//   PL0 : perte à 1 m. En espace libre (formule de Friis) elle vaut
//         20·log10(4π·f/c) = 40,2 dB à 2440 MHz. Les mesures BLE avec de
//         petits appareils donnent plutôt 45 à 50 dB : antennes proches
//         du sol, du cadre ou du corps, désadaptation. Hypothèse 46-48 dB.
//   n   : exposant d'affaiblissement. n = 2 en espace libre ; plus il y
//         a d'obstacles, plus le signal décroît vite [RAP table 4.2 :
//         zone urbaine 2,7 à 3,5 ; bâtiment avec obstacles 4 à 6].
//
// Ombrage (« shadowing ») : écart lent autour de la moyenne, de loi
// log-normale (gaussien en dB), d'écart-type sigma [RAP §4.9.2].
// Il varie quand le décor change : quand on se déplace (distance de
// décorrélation dcorr [GUD]) ou quand le décor bouge (voitures,
// passants, feuillage au vent : temps de corrélation tau, hypothèse).
//
// Évanouissement rapide : dans un lien en vue directe, un trajet fort
// domine et les échos le font peu varier (loi de Rice, facteur K =
// rapport trajet direct / échos). Si le lien est obstrué, il ne reste
// que des échos (loi de Rayleigh, K = 0) : creux de −10 dB ou plus
// assez fréquents [RAP §5.6].
//
// Bruit ambiant : bruit radio fabriqué par l'homme (moteurs, lampes,
// appareils), hypothèse ; il s'ajoute au bruit propre du récepteur.
//
// Wi-Fi : sur chaque canal d'annonce, part du temps occupée par des
// trames Wi-Fi (« occupation ») et niveau moyen reçu (hypothèses ;
// canal 37 au bord du Wi-Fi 1, 38 entre Wi-Fi 1 et 6, 39 dans le
// Wi-Fi 13, rare).
TPMS.RADIO_ENVIRONNEMENTS = {
  campagne: {
    nom: "Campagne (terrain dégagé)",
    n: 2.4,                 // un peu plus que 2 : réflexion sur le sol
    pl0Db: 46,
    sigmaDb: 3,             // peu d'obstacles
    tauS: 30,               // décor presque immobile
    dcorrM: 25,
    kRiceDb: 10,            // trajet direct dominant
    dVueDirecteM: 300,
    bruitAmbiantDbm: -118,
    wifi: { 37: { occupation: 0.01, moyenneDbm: -98 },
            38: { occupation: 0.01, moyenneDbm: -98 },
            39: { occupation: 0.00, moyenneDbm: -100 } }
  },
  ville: {
    nom: "Ville",
    n: 3.2,                 // [RAP] urbain 2,7 à 3,5
    pl0Db: 47,
    sigmaDb: 6,             // [RAP] 4 à 8 dB en ville
    tauS: 8,                // voitures et passants
    dcorrM: 10,             // [GUD] ordre de grandeur en milieu urbain
    kRiceDb: 9,
    dVueDirecteM: 30,       // au-delà, un obstacle est presque sûr
    bruitAmbiantDbm: -106,
    wifi: { 37: { occupation: 0.20, moyenneDbm: -85 },
            38: { occupation: 0.12, moyenneDbm: -88 },
            39: { occupation: 0.04, moyenneDbm: -92 } }
  },
  foret: {
    nom: "Forêt",
    n: 3.0,                 // [WEI] le feuillage absorbe fortement à 2,4 GHz
    pl0Db: 48,
    sigmaDb: 7,
    tauS: 15,               // feuillage agité par le vent
    dcorrM: 5,              // troncs rapprochés
    kRiceDb: 4,
    dVueDirecteM: 10,
    bruitAmbiantDbm: -116,
    wifi: { 37: { occupation: 0, moyenneDbm: -100 },
            38: { occupation: 0, moyenneDbm: -100 },
            39: { occupation: 0, moyenneDbm: -100 } }
  },
  interieur: {
    nom: "Intérieur (garage, appartement)",
    n: 3.0,                 // [ITU] coefficient N ≈ 28 à 30 à 2,4 GHz
    pl0Db: 47,
    sigmaDb: 7,
    tauS: 5,                // personnes qui bougent
    dcorrM: 3,
    kRiceDb: 7,
    dVueDirecteM: 8,
    bruitAmbiantDbm: -108,
    wifi: { 37: { occupation: 0.30, moyenneDbm: -80 },
            38: { occupation: 0.20, moyenneDbm: -84 },
            39: { occupation: 0.06, moyenneDbm: -90 } }
  }
};

// Fréquence de référence du modèle (milieu de la bande 2,4 GHz).
TPMS.RADIO_FREQUENCE_REFERENCE_MHZ = 2440;

// Ombrage : distance à laquelle il atteint la moitié de son écart-type
// (voir radioSigmaOmbrageDb). Hypothèse.
TPMS.RADIO_OMBRAGE_DEMI_DISTANCE_M = 3;

// Ombrage : nombre de sinusoïdes de la méthode « somme de sinusoïdes »
// et pulsation maximale gardée (voir creerOmbrageLien).
TPMS.RADIO_OMBRAGE_NB_SINUS = 24;
TPMS.RADIO_OMBRAGE_PULSATION_MAX = 4;

// Écart-type du niveau des trames Wi-Fi autour de leur moyenne (hypothèse).
TPMS.RADIO_WIFI_ECART_TYPE_DB = 6;

// ---------------------------------------------------------------------
// Petits outils de conversion
// ---------------------------------------------------------------------

// dBm → mW : P(mW) = 10^(P(dBm) / 10).   Ex. : −30 dBm → 0,001 mW.
TPMS.dbmEnMw = function (dbm) {
  return Math.pow(10, dbm / 10);
};

// mW → dBm : P(dBm) = 10 · log10(P(mW)).
TPMS.mwEnDbm = function (mw) {
  return 10 * Math.log10(Math.max(mw, 1e-30));
};

// Somme de puissances exprimées en dBm (on repasse par les mW).
// Ex. : −100 dBm + −100 dBm = −97 dBm (deux fois plus de puissance).
TPMS.radioSommeDbm = function (listeDbm) {
  var mw = 0;
  for (var i = 0; i < listeDbm.length; i++) mw += TPMS.dbmEnMw(listeDbm[i]);
  return TPMS.mwEnDbm(mw);
};

// Distance entre deux positions {x, y, z} (théorème de Pythagore en 3D).
TPMS.radioDistanceM = function (a, b) {
  var dx = (a.x || 0) - (b.x || 0);
  var dy = (a.y || 0) - (b.y || 0);
  var dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Instant en texte au microseconde près, pour nommer un tirage au hasard.
function cleInstant(tMs) {
  return String(Math.round(tMs * 1000));
}

// Clé d'un lien radio. Elle est la même dans les deux sens (A→B = B→A) :
// la propagation est réciproque, l'ombrage aussi.
function cleLien(idA, idB) {
  var a = String(idA), b = String(idB);
  return a < b ? a + "~" + b : b + "~" + a;
}

// ---------------------------------------------------------------------
// Création du canal radio (l'« air » partagé par tous les appareils)
// ---------------------------------------------------------------------
// options = {
//   environnement : "ville" | "campagne" | "foret" | "interieur" (défaut "ville")
//   graine        : nombre, pour un hasard reproductible (défaut 1)
//   wifi          : false pour couper les interférences Wi-Fi (défaut true)
//   advDelay      : false pour ne pas ajouter le retard aléatoire de la
//                   norme (défaut true)
//   bruitAmbiantDbm : pour remplacer la valeur de l'environnement
// }
TPMS.creerCanalRadio = function (options) {
  options = options || {};
  var nomEnv = options.environnement || "ville";
  var modele = TPMS.RADIO_ENVIRONNEMENTS[nomEnv];
  if (!modele) throw new Error("Environnement radio inconnu : " + nomEnv);
  var params = JSON.parse(JSON.stringify(modele));   // copie modifiable
  if (typeof options.bruitAmbiantDbm === "number") params.bruitAmbiantDbm = options.bruitAmbiantDbm;
  return {
    environnement: nomEnv,
    params: params,
    graine: (options.graine === undefined ? 1 : options.graine) >>> 0,
    wifi: options.wifi !== false,
    advDelay: options.advDelay !== false,
    captureDb: TPMS.RADIO_CAPTURE_DB,
    liens: {}            // état de l'ombrage de chaque lien
  };
};

// ---------------------------------------------------------------------
// 1. Affaiblissement moyen du trajet (log-distance)
// ---------------------------------------------------------------------
// freqMHz est facultatif : la perte augmente un peu avec la fréquence
// (+20·log10(f/f0), Friis) : 0,14 dB de plus sur le canal 39 que sur la
// fréquence de référence. Sous 1 m, on garde la pente de l'espace
// libre (n = 2) : les obstacles n'ont pas le temps d'agir.
TPMS.radioPerteTrajetDb = function (canal, distanceM, freqMHz) {
  var p = canal.params;
  var d = Math.max(distanceM, 0.05);
  var perte = d >= 1
    ? p.pl0Db + 10 * p.n * Math.log10(d)
    : p.pl0Db + 20 * Math.log10(d);
  if (freqMHz) perte += 20 * Math.log10(freqMHz / TPMS.RADIO_FREQUENCE_REFERENCE_MHZ);
  return perte;
};

// ---------------------------------------------------------------------
// 2. Ombrage corrélé dans le temps
// ---------------------------------------------------------------------
// L'écart-type de l'ombrage grandit avec la distance : à 1 m du boîtier
// il n'y a presque rien entre le capteur et lui (le masquage par la
// jante et le corps est fourni à part par le moteur), à 50 m il y a des
// voitures, des murs... Hypothèse :
//     sigma(d) = sigma_env · d / (d + 3 m)
// → 25 % de sigma à 1 m, 50 % à 3 m, 94 % à 50 m.
TPMS.radioSigmaOmbrageDb = function (canal, distanceM) {
  var d = Math.max(distanceM, 0);
  return canal.params.sigmaDb * d / (d + TPMS.RADIO_OMBRAGE_DEMI_DISTANCE_M);
};

// L'ombrage d'un lien est une valeur gaussienne z (moyenne 0, écart-type 1)
// qui évolue en fonction d'une « coordonnée de décor » u :
//     u = t / tau  +  distance parcourue / dcorr
// Deux instants dont les u diffèrent de 1 ont une corrélation d'environ
// e^−1 ≈ 0,37 (corrélation exponentielle de Gudmundson [GUD]).
//
// Méthode de la somme de sinusoïdes : z(u) = √(2/M) · Σ cos(ωk·u + φk),
// avec M = 24 sinusoïdes de phases φk au hasard et de pulsations ωk
// tirées selon la loi de Cauchy (c'est le spectre d'une corrélation
// exponentielle). On écarte les pulsations > 4 : la courbe reste lisse,
// elle ne « saute » pas d'une trame à l'autre.
// Avantage : z ne dépend QUE de u. L'interface peut interroger la radio
// aussi souvent qu'elle veut sans changer la suite de la simulation.
function creerOmbrageLien(canal, cle) {
  var alea = TPMS.creerAleaNomme(canal.graine, "radio-ombrage|" + cle);
  var omegas = [], phases = [];
  for (var k = 0; k < TPMS.RADIO_OMBRAGE_NB_SINUS; k++) {
    var w;
    do {
      w = Math.tan(Math.PI * (alea() - 0.5));   // loi de Cauchy
    } while (Math.abs(w) > TPMS.RADIO_OMBRAGE_PULSATION_MAX);
    omegas.push(w);
    phases.push(2 * Math.PI * alea());
  }
  return { omegas: omegas, phases: phases, parcoursM: 0, tDernierMs: null, posA: null, posB: null };
}

function copiePosition(p) {
  return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
}

// Valeur normalisée z de l'ombrage du lien à l'instant tMs.
// La distance parcourue n'avance que si le temps avance : interroger le
// passé (ou le même instant) ne modifie rien.
TPMS.radioOmbrageNormalise = function (canal, emetteur, recepteur, tMs) {
  var cle = cleLien(emetteur.id, recepteur.id);
  var lien = canal.liens[cle];
  if (!lien) lien = canal.liens[cle] = creerOmbrageLien(canal, cle);
  var posA = String(emetteur.id) < String(recepteur.id) ? emetteur.position : recepteur.position;
  var posB = posA === emetteur.position ? recepteur.position : emetteur.position;
  if (lien.tDernierMs === null) {
    lien.tDernierMs = tMs;
    lien.posA = copiePosition(posA);
    lien.posB = copiePosition(posB);
  } else if (tMs > lien.tDernierMs) {
    // Le décor change autant que bouge l'extrémité qui bouge le plus.
    lien.parcoursM += Math.max(TPMS.radioDistanceM(posA, lien.posA),
                               TPMS.radioDistanceM(posB, lien.posB));
    lien.tDernierMs = tMs;
    lien.posA = copiePosition(posA);
    lien.posB = copiePosition(posB);
  }
  var p = canal.params;
  var u = (lien.tDernierMs !== null && tMs < lien.tDernierMs ? lien.tDernierMs : tMs) / 1000 / p.tauS
        + lien.parcoursM / p.dcorrM;
  var z = 0;
  for (var k = 0; k < lien.omegas.length; k++) z += Math.cos(lien.omegas[k] * u + lien.phases[k]);
  return z * Math.sqrt(2 / lien.omegas.length);
};

// ---------------------------------------------------------------------
// 3. Masquage par la jante (aide pour le moteur)
// ---------------------------------------------------------------------
// angleValveDeg : position de la valve sur la roue, 0° = valve du côté
// du boîtier (rien entre eux), 180° = valve à l'opposé (la jante en
// aluminium, le pneu et le moyeu sont sur le trajet).
//   - de 0° à 60° : la valve « voit » le boîtier → 0 dB ;
//   - de 60° à 120° : le signal contourne le bord de la jante
//     (diffraction) → la perte monte progressivement ;
//   - au-delà de 120° : derrière la jante → perte maximale.
// Hypothèse 12 dB : pour les TPMS automobiles on mesure 10 à 20 dB de
// variation sur un tour de roue ; une jante de vélo est plus étroite et
// les rayons laissent passer une partie du signal.
TPMS.RADIO_PERTE_JANTE_MAX_DB = 12;
TPMS.RADIO_JANTE_DEBUT_DEG = 60;
TPMS.RADIO_JANTE_FIN_DEG = 120;

TPMS.radioPerteJanteDb = function (angleValveDeg) {
  var a = ((angleValveDeg % 360) + 360) % 360;   // ramène dans [0, 360)
  if (a > 180) a = 360 - a;                      // symétrie : 270° = 90°
  if (a <= TPMS.RADIO_JANTE_DEBUT_DEG) return 0;
  if (a >= TPMS.RADIO_JANTE_FIN_DEG) return TPMS.RADIO_PERTE_JANTE_MAX_DB;
  // Transition en « S » (demi-période de cosinus) entre 60° et 120°.
  var x = (a - TPMS.RADIO_JANTE_DEBUT_DEG) / (TPMS.RADIO_JANTE_FIN_DEG - TPMS.RADIO_JANTE_DEBUT_DEG);
  return TPMS.RADIO_PERTE_JANTE_MAX_DB * (1 - Math.cos(Math.PI * x)) / 2;
};

// ---------------------------------------------------------------------
// 4. Bilan de liaison
// ---------------------------------------------------------------------
// Détail des pertes LENTES d'un lien à l'instant tMs (sans
// l'évanouissement rapide, qui change à chaque paquet).
TPMS.radioLien = function (canal, emetteur, recepteur, extraPerteDb, tMs, freqMHz) {
  var d = TPMS.radioDistanceM(emetteur.position, recepteur.position);
  var extra = extraPerteDb || 0;
  var perteTrajet = TPMS.radioPerteTrajetDb(canal, d, freqMHz);
  var ombrage = TPMS.radioSigmaOmbrageDb(canal, d) *
                TPMS.radioOmbrageNormalise(canal, emetteur, recepteur, tMs);
  var total = perteTrajet + ombrage + extra;
  // Vue directe : pas de gros masquage et distance courte pour l'environnement.
  var vueDirecte = extra < 6 && d <= canal.params.dVueDirecteM;
  return {
    distanceM: d,
    perteTrajetDb: perteTrajet,
    ombrageDb: ombrage,
    extraPerteDb: extra,
    totalDb: total,
    vueDirecte: vueDirecte,
    // Puissance reçue moyenne (avant évanouissement rapide) :
    //   P_reçue = P_émise + G_émetteur + G_récepteur − affaiblissement
    puissanceRecueDbm: (emetteur.puissanceDbm || 0) + (emetteur.gainAntenneDbi || 0)
                     + (recepteur.gainAntenneDbi || 0) - total
  };
};

// Affaiblissement total (lent) du lien, en dB : trajet + ombrage + extra.
TPMS.radioAttenuationDb = function (canal, emetteur, recepteur, extraPerteDb, tMs) {
  return TPMS.radioLien(canal, emetteur, recepteur, extraPerteDb, tMs).totalDb;
};

// ---------------------------------------------------------------------
// 5. Évanouissement rapide (Rice / Rayleigh)
// ---------------------------------------------------------------------
// Le signal reçu est la somme d'un trajet direct (amplitude fixe s) et
// d'une foule d'échos (partie aléatoire gaussienne en phase et en
// quadrature). Le facteur K = s² / puissance des échos.
//   K grand → presque constant ; K = 0 → Rayleigh, creux profonds.
// On normalise pour que la puissance MOYENNE vaille 1 (0 dB) : le
// modèle log-distance donne déjà la moyenne.
// kRiceDb = null pour Rayleigh. Retourne le gain en dB (souvent négatif).
TPMS.radioEvanouissementDb = function (alea, kRiceDb) {
  var K = kRiceDb === null || kRiceDb === undefined ? 0 : Math.pow(10, kRiceDb / 10);
  var s = Math.sqrt(K / (K + 1));               // trajet direct
  var ecart = Math.sqrt(1 / (2 * (K + 1)));     // échos, par composante
  var x = s + ecart * TPMS.aleaNormal(alea);
  var y = ecart * TPMS.aleaNormal(alea);
  return Math.max(-40, 10 * Math.log10(Math.max(x * x + y * y, 1e-12)));
};

// ---------------------------------------------------------------------
// 6. Paquets et taux d'erreur
// ---------------------------------------------------------------------

// Nombre total d'octets sur l'air pour nbOctetsDonnees de « manufacturer data ».
TPMS.radioOctetsPaquet = function (nbOctetsDonnees) {
  return TPMS.BLE_OCTETS_PREAMBULE + TPMS.BLE_OCTETS_ADRESSE_ACCES + TPMS.BLE_OCTETS_ENTETE_PDU
       + TPMS.BLE_OCTETS_ADRESSE_ANNONCEUR + TPMS.BLE_OCTETS_ENTETE_CHAMP + nbOctetsDonnees
       + TPMS.BLE_OCTETS_CRC;
};

// Durée d'un paquet en µs : bits / débit. Pour nos 18 octets :
// (1 + 4 + 2 + 6 + 2 + 18 + 3) = 36 octets = 288 bits = 288 µs.
TPMS.radioDureePaquetUs = function (nbOctetsDonnees) {
  return 8 * TPMS.radioOctetsPaquet(nbOctetsDonnees) / TPMS.BLE_DEBIT_BITS_PAR_US;
};

// Taux d'erreur binaire d'une modulation FSK non cohérente [PRO] :
//     TEB = ½ · exp(−RSB/2)
TPMS.radioTauxErreurBinaire = function (rsbDb) {
  return 0.5 * Math.exp(-Math.pow(10, rsbDb / 10) / 2);
};

// Taux d'erreur paquet : le paquet est perdu si UN SEUL bit est faux
// (le CRC le détecte). Chaque bit est juste avec la probabilité (1 − TEB) :
//     TEP = 1 − (1 − TEB)^nbBits
// Le préambule ne compte pas (il sert seulement à se caler).
// Ex. : à la sensibilité (TEB = 0,1 %), un paquet de 280 bits est perdu
// une fois sur quatre : 1 − 0,999^280 ≈ 0,24.
TPMS.radioTauxErreurPaquet = function (rsbDb, nbBits) {
  var teb = TPMS.radioTauxErreurBinaire(rsbDb);
  return 1 - Math.pow(1 - teb, nbBits);
};

// Plancher de bruit du récepteur dans cet environnement :
// bruit propre (déduit de la sensibilité) + bruit ambiant, en mW.
// Ex. en ville : −105,9 dBm ⊕ −106 dBm ≈ −102,9 dBm.
TPMS.radioPlancherBruitDbm = function (canal, sensibiliteDbm) {
  var sens = sensibiliteDbm === undefined ? TPMS.RADIO_SENSIBILITE_DBM : sensibiliteDbm;
  return TPMS.radioSommeDbm([sens - TPMS.RADIO_RSB_REFERENCE_DB, canal.params.bruitAmbiantDbm]);
};

// Canal écouté par le scanner à l'instant tMs : il change à chaque
// intervalle de scan, 37 → 38 → 39 → 37...
// recepteur.scanOrigineMs (facultatif) décale le début du cycle.
TPMS.radioCanalScanner = function (recepteur, tMs) {
  var intervalle = recepteur.scanIntervalMs || 100;
  var t = tMs - (recepteur.scanOrigineMs || 0);
  var rang = Math.floor(t / intervalle) % 3;
  if (rang < 0) rang += 3;
  return TPMS.BLE_CANAUX_ANNONCE[rang];
};

// Les 3 paquets d'un événement d'annonce : même contenu, envoyé sur
// 37, puis 38, puis 39, l'un juste après l'autre.
// emission.advDelayMs (facultatif) impose le retard au lieu de le tirer.
TPMS.radioPaquetsAnnonce = function (canal, emission) {
  var nbOctets = emission.octets ? emission.octets.length : 0;
  var dureeMs = TPMS.radioDureePaquetUs(nbOctets) / 1000;
  var retard = 0;
  if (typeof emission.advDelayMs === "number") {
    retard = emission.advDelayMs;
  } else if (canal.advDelay) {
    var alea = TPMS.creerAleaNomme(canal.graine,
      "radio-advdelay|" + emission.emetteur.id + "|" + cleInstant(emission.tMs));
    retard = alea() * TPMS.BLE_ADV_DELAY_MAX_MS;
  }
  var paquets = [];
  var debut = emission.tMs + retard;
  for (var i = 0; i < TPMS.BLE_CANAUX_ANNONCE.length; i++) {
    paquets.push({ canalBle: TPMS.BLE_CANAUX_ANNONCE[i], debutMs: debut, finMs: debut + dureeMs });
    debut += dureeMs + TPMS.BLE_ECART_PAQUETS_MS;
  }
  return paquets;
};

// ---------------------------------------------------------------------
// 7. Résolution d'un pas de simulation
// ---------------------------------------------------------------------
// emissions = [{ id, tMs, octets, emetteur, extraPerteDb, type: "annonce"|"brouillage",
//                advDelayMs (facultatif), dureeMs (facultatif, brouillage) }]
// recepteur = { node, ecoute: function (tMs) → bool, scanIntervalMs, sensibiliteDbm }
//
// Retourne, dans le même ordre que emissions :
//   { id, recu, rssiDbm, canalBle, raison,
//     tRecuMs,            instant de fin du paquet reçu (ou null)
//     copies,             nombre de paquets de l'événement reçus (0 à 3 :
//                         plusieurs si le scanner change de canal pendant
//                         l'événement — le boîtier doit ignorer les doublons)
//     puissanceRecueDbm,  valeur exacte, avant arrondi du RSSI
//     rsbDb,              rapport signal / (bruit + interférences) du paquet retenu
//     paquets: [{ canalBle, debutMs, finMs, rssiDbm, raison }] }
//
// Pour une émission de type "brouillage" : recu = false,
// raison = "brouillage", rssiDbm = niveau du brouillage reçu.
//
// Limite connue : seules les émissions de ce pas sont comparées entre
// elles pour les collisions (un paquet dure 0,3 ms, les chevauchements
// entre deux pas sont négligeables).
TPMS.radioResoudre = function (canal, emissions, recepteur) {
  var rx = recepteur.node;
  var sens = recepteur.sensibiliteDbm === undefined ? TPMS.RADIO_SENSIBILITE_DBM : recepteur.sensibiliteDbm;
  var plancherMw = TPMS.dbmEnMw(TPMS.radioPlancherBruitDbm(canal, sens));
  var p = canal.params;

  // a) Ordre chronologique (puis par id) : l'ombrage avance dans le temps.
  var ordre = emissions.map(function (e, i) { return i; });
  ordre.sort(function (i, j) {
    var a = emissions[i], b = emissions[j];
    if (a.tMs !== b.tMs) return a.tMs - b.tMs;
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : i - j);
  });

  // b) Tous les paquets dans l'air, avec leur puissance reçue.
  var paquets = [];        // paquets d'annonce
  var brouilleurs = [];    // émissions continues du pirate
  var parEmission = [];    // index → liste de paquets
  for (var o = 0; o < ordre.length; o++) {
    var idx = ordre[o];
    var e = emissions[idx];
    var lien = TPMS.radioLien(canal, e.emetteur, rx, e.extraPerteDb, e.tMs);

    if (e.type === "brouillage") {
      // Émission continue sur les 3 canaux (hypothèse : toute la
      // puissance sur chacun). Pas d'évanouissement rapide : sur une
      // émission continue, il se moyenne.
      var parCanal = {};
      for (var c = 0; c < TPMS.BLE_CANAUX_ANNONCE.length; c++) {
        var cb = TPMS.BLE_CANAUX_ANNONCE[c];
        parCanal[cb] = lien.puissanceRecueDbm
          - 20 * Math.log10(TPMS.BLE_FREQUENCE_MHZ[cb] / TPMS.RADIO_FREQUENCE_REFERENCE_MHZ);
      }
      brouilleurs.push({
        index: idx,
        debutMs: typeof e.dureeMs === "number" ? e.tMs : -Infinity,
        finMs: typeof e.dureeMs === "number" ? e.tMs + e.dureeMs : Infinity,
        dbmParCanal: parCanal,
        dbm: lien.puissanceRecueDbm
      });
      parEmission[idx] = null;
      continue;
    }

    var nbBits = 8 * (TPMS.radioOctetsPaquet(e.octets ? e.octets.length : 0) - TPMS.BLE_OCTETS_PREAMBULE);
    var liste = TPMS.radioPaquetsAnnonce(canal, e);
    var cle = cleLien(e.emetteur.id, rx.id);
    for (var k = 0; k < liste.length; k++) {
      var pq = liste[k];
      // Un tirage au hasard propre à ce paquet : lien + instant + canal.
      var alea = TPMS.creerAleaNomme(canal.graine,
        "radio-paquet|" + cle + "|" + cleInstant(pq.debutMs) + "|" + pq.canalBle);
      var evan = TPMS.radioEvanouissementDb(alea, lien.vueDirecte ? p.kRiceDb : null);
      pq.index = idx;
      pq.nbBits = nbBits;
      pq.alea = alea;
      pq.dbm = lien.puissanceRecueDbm + evan
        - 20 * Math.log10(TPMS.BLE_FREQUENCE_MHZ[pq.canalBle] / TPMS.RADIO_FREQUENCE_REFERENCE_MHZ);
      paquets.push(pq);
    }
    parEmission[idx] = liste;
  }

  // c) Sort de chaque paquet au récepteur.
  for (var a = 0; a < paquets.length; a++) {
    evaluerPaquet(canal, paquets[a], paquets, brouilleurs, recepteur, sens, plancherMw);
  }

  // d) Bilan par émission, dans l'ordre d'origine.
  var resultats = [];
  for (var i = 0; i < emissions.length; i++) {
    var em = emissions[i];
    if (parEmission[i] === null) {
      var b = brouilleurs.filter(function (x) { return x.index === i; })[0];
      resultats.push({ id: em.id, recu: false, rssiDbm: arrondirRssi(b.dbm), canalBle: null,
        raison: "brouillage", tRecuMs: null, copies: 0, puissanceRecueDbm: b.dbm,
        rsbDb: null, paquets: [] });
      continue;
    }
    resultats.push(bilanEmission(em, parEmission[i]));
  }
  return resultats;
};

function arrondirRssi(dbm) {
  return Math.round(dbm / TPMS.RADIO_RSSI_RESOLUTION_DB) * TPMS.RADIO_RSSI_RESOLUTION_DB;
}

// Décide du sort d'un paquet : remplit pq.raison et pq.rsbDb.
function evaluerPaquet(canal, pq, tous, brouilleurs, recepteur, sens, plancherMw) {
  // 1. Le scanner écoute-t-il ce canal pendant TOUT le paquet ?
  var ecoute = recepteur.ecoute(pq.debutMs) && recepteur.ecoute(pq.finMs)
    && TPMS.radioCanalScanner(recepteur, pq.debutMs) === pq.canalBle
    && TPMS.radioCanalScanner(recepteur, pq.finMs) === pq.canalBle;
  // Les tirages sont toujours faits dans le même ordre, quel que soit
  // le résultat : ajouter une condition ne décale pas le hasard.
  var tirageErreur = pq.alea();
  var tirageWifi = TPMS.creerAleaNomme(canal.graine,
    "radio-wifi|" + recepteur.node.id + "|" + pq.canalBle + "|" + cleInstant(pq.debutMs));
  var wifiPresent = canal.wifi && tirageWifi() < canal.params.wifi[pq.canalBle].occupation;
  var wifiDbm = canal.params.wifi[pq.canalBle].moyenneDbm
    + TPMS.RADIO_WIFI_ECART_TYPE_DB * TPMS.aleaNormal(tirageWifi);

  pq.rsbDb = null;
  pq.wifi = wifiPresent;
  if (!ecoute) { pq.raison = "hors-ecoute"; return; }

  // 2. Assez fort pour être détecté ?
  if (pq.dbm < sens) { pq.raison = "trop-faible"; return; }

  // 3. Collision : autres paquets sur le même canal qui se chevauchent.
  //    Deux intervalles [a1, b1] et [a2, b2] se chevauchent si a1 < b2 et a2 < b1.
  var chevauchementMw = 0;
  for (var j = 0; j < tous.length; j++) {
    var q = tous[j];
    if (q === pq || q.index === pq.index || q.canalBle !== pq.canalBle) continue;
    if (q.debutMs < pq.finMs && pq.debutMs < q.finMs) chevauchementMw += TPMS.dbmEnMw(q.dbm);
  }
  // Effet de capture : on survit si l'on dépasse l'ensemble des autres de 6 dB.
  if (chevauchementMw > 0 && pq.dbm - TPMS.mwEnDbm(chevauchementMw) < canal.captureDb) {
    pq.raison = "collision";
    return;
  }

  // 4. Bruit + interférences → taux d'erreur paquet.
  var brouillageMw = 0;
  for (var k = 0; k < brouilleurs.length; k++) {
    var br = brouilleurs[k];
    if (br.debutMs < pq.finMs && pq.debutMs < br.finMs) brouillageMw += TPMS.dbmEnMw(br.dbmParCanal[pq.canalBle]);
  }
  var wifiMw = wifiPresent ? TPMS.dbmEnMw(wifiDbm) : 0;
  var autresMw = plancherMw + chevauchementMw + wifiMw;
  // RSB = signal / (bruit + interférences), en dB = différence des dBm.
  pq.rsbDb = pq.dbm - TPMS.mwEnDbm(autresMw + brouillageMw);
  var tep = TPMS.radioTauxErreurPaquet(pq.rsbDb, pq.nbBits);
  if (tirageErreur < tep) {
    // Qui est responsable ? Le brouilleur s'il domine le reste.
    pq.raison = brouillageMw > autresMw ? "brouillee" : "erreur-paquet";
  } else {
    pq.raison = "ok";
  }
}

// Classement des raisons d'échec : on retient le paquet qui est allé
// le plus loin dans la chaîne de réception.
var RANG_RAISON = { "hors-ecoute": 0, "trop-faible": 1, "collision": 2, "erreur-paquet": 3, "brouillee": 3 };

function bilanEmission(em, paquets) {
  var detail = paquets.map(function (pq) {
    return { canalBle: pq.canalBle, debutMs: pq.debutMs, finMs: pq.finMs,
             rssiDbm: arrondirRssi(pq.dbm), raison: pq.raison, wifi: pq.wifi };
  });
  var recus = paquets.filter(function (pq) { return pq.raison === "ok"; });
  if (recus.length > 0) {
    var premier = recus[0];
    return { id: em.id, recu: true, rssiDbm: arrondirRssi(premier.dbm), canalBle: premier.canalBle,
      raison: "ok", tRecuMs: premier.finMs, copies: recus.length, puissanceRecueDbm: premier.dbm,
      rsbDb: premier.rsbDb, paquets: detail };
  }
  var retenu = paquets[0];
  for (var i = 1; i < paquets.length; i++) {
    if (RANG_RAISON[paquets[i].raison] > RANG_RAISON[retenu.raison]) retenu = paquets[i];
  }
  // Hors écoute : le boîtier n'a rien mesuré. On donne quand même le
  // niveau qu'il aurait reçu (premier paquet), utile pour l'affichage.
  return { id: em.id, recu: false, rssiDbm: arrondirRssi(retenu.dbm),
    canalBle: retenu.raison === "hors-ecoute" ? null : retenu.canalBle,
    raison: retenu.raison, tRecuMs: null, copies: 0, puissanceRecueDbm: retenu.dbm,
    rsbDb: retenu.rsbDb, paquets: detail };
}

// ---------------------------------------------------------------------
// 8. Portée moyenne (pour l'interface)
// ---------------------------------------------------------------------
// puissanceDbm : puissance rayonnée = puissance d'émission + gains des
// deux antennes. On cherche la distance où la puissance reçue moyenne
// tombe au seuil utile :
//     seuil = max(sensibilité, plancher de bruit + 10,9 dB)
// (en ville, le bruit ambiant rend le seuil utile plus haut que −95).
// On inverse le modèle log-distance :
//     P − seuil = PL0 + 10·n·log10(d)  ⇒  d = 10^((P − seuil − PL0) / (10·n))
// C'est une portée MOYENNE : à cette distance, une trame sur deux
// environ passe, selon l'ombrage et les évanouissements.
TPMS.radioPorteeM = function (canal, puissanceDbm, sensibiliteDbm) {
  var sens = sensibiliteDbm === undefined ? TPMS.RADIO_SENSIBILITE_DBM : sensibiliteDbm;
  var seuil = Math.max(sens, TPMS.radioPlancherBruitDbm(canal, sens) + TPMS.RADIO_RSB_REFERENCE_DB);
  var budget = puissanceDbm - seuil;
  var p = canal.params;
  if (budget <= p.pl0Db) return Math.pow(10, (budget - p.pl0Db) / 20);   // moins d'1 m
  return Math.pow(10, (budget - p.pl0Db) / (10 * p.n));
};

// ---------------------------------------------------------------------
// 9. Statistiques (pour l'interface)
// ---------------------------------------------------------------------
TPMS.creerStatsRadio = function () {
  return {
    emises: 0, recues: 0,
    raisons: { "ok": 0, "hors-ecoute": 0, "trop-faible": 0, "collision": 0,
               "erreur-paquet": 0, "brouillee": 0 },
    rssiMinDbm: null, rssiMaxDbm: null, sommeRssiDbm: 0
  };
};

// Ajoute les résultats d'un pas aux statistiques (les émissions du
// brouilleur ne sont pas des trames : elles ne sont pas comptées).
TPMS.radioCompter = function (stats, resultats) {
  for (var i = 0; i < resultats.length; i++) {
    var r = resultats[i];
    if (r.raison === "brouillage") continue;
    stats.emises++;
    stats.raisons[r.raison] = (stats.raisons[r.raison] || 0) + 1;
    if (r.recu) {
      stats.recues++;
      stats.sommeRssiDbm += r.rssiDbm;
      if (stats.rssiMinDbm === null || r.rssiDbm < stats.rssiMinDbm) stats.rssiMinDbm = r.rssiDbm;
      if (stats.rssiMaxDbm === null || r.rssiDbm > stats.rssiMaxDbm) stats.rssiMaxDbm = r.rssiDbm;
    }
  }
  return stats;
};
