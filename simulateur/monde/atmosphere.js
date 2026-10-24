// =====================================================================
// atmosphere.js — L'air autour du vélo : pression selon l'altitude, météo
// ---------------------------------------------------------------------
// MODÈLE DU MONDE (simulation) : pas de page web, pas d'horloge. L'heure
// est toujours passée en paramètre.
//
// Deux choses ici :
//   1. la pression atmosphérique, qui baisse quand on monte : c'est elle
//      qu'on soustrait pour obtenir la pression RELATIVE d'un pneu (celle
//      qu'affiche un manomètre de pompe) ;
//   2. une météo de journée : température (cycle jour/nuit), soleil, vent,
//      pluie, avec de petites variations reproductibles (alea.js).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// ---------------------------------------------------------------------
// 1. Pression atmosphérique — atmosphère standard (OACI / ISO 2533)
// ---------------------------------------------------------------------
TPMS.P_ATM_MER_PA = 101325;        // pression au niveau de la mer (Pa), atmosphère standard
TPMS.T_MER_STANDARD_K = 288.15;    // 15 °C au niveau de la mer, atmosphère standard
TPMS.GRADIENT_THERMIQUE = 0.0065;  // la température baisse de 6,5 °C par km (troposphère, ISO 2533)
TPMS.G = 9.80665;                  // pesanteur normale (m/s²)
TPMS.R_GAZ = 8.314462618;          // constante des gaz parfaits (J/(mol·K)), CODATA
TPMS.M_AIR = 0.0289644;            // masse molaire de l'air sec (kg/mol), atmosphère standard
TPMS.PA_PAR_BAR = TPMS.PA_PAR_BAR || 100000;   // 1 bar = 100 000 Pa (aussi défini dans trame.js)

// Formule du nivellement barométrique (valable jusqu'à 11 km) :
//   P(h) = P0 × (1 − L·h / T0) ^ (g·M / (R·L))
// L'exposant vaut environ 5,256. Ordres de grandeur :
//   0 m → 1013 hPa ; 1500 m → 846 hPa ; 3000 m → 701 hPa.
// Petite mémoire : la fonction est appelée des milliers de fois par
// seconde ; on arrondit l'altitude au décimètre (1 dm ≈ 1,2 Pa, soit
// 0,00001 bar : invisible) et on ne refait le calcul que si elle change.
var memoAltitude = NaN, memoPression = 0;
TPMS.pressionAtmospheriquePa = function (altitudeM) {
  var h = Math.round((altitudeM || 0) * 10) / 10;
  if (h === memoAltitude) return memoPression;
  memoAltitude = h;
  memoPression = pressionSansMemo(h);
  return memoPression;
};
function pressionSansMemo(h) {
  var exposant = TPMS.G * TPMS.M_AIR / (TPMS.R_GAZ * TPMS.GRADIENT_THERMIQUE);
  var base = 1 - TPMS.GRADIENT_THERMIQUE * h / TPMS.T_MER_STANDARD_K;
  return TPMS.P_ATM_MER_PA * Math.pow(base, exposant);
}

// Densité de l'air (kg/m³), loi des gaz parfaits : ρ = P / (R_air × T),
// avec R_air = R / M_air ≈ 287,05 J/(kg·K) (air sec) et T en kelvins.
// 1,225 kg/m³ à 15 °C au niveau de la mer ; 1,15 par 35 °C : l'air chaud,
// moins dense, freine un peu moins le cycliste.
TPMS.densiteAir = function (pressionPa, temperatureC) {
  return pressionPa / (TPMS.R_GAZ / TPMS.M_AIR * (temperatureC + 273.15));
};

// Température à une altitude, connaissant celle d'en bas (même gradient
// de −6,5 °C/km). Utile pour un col : 20 °C en bas → 10 °C à 1500 m de plus.
TPMS.temperatureAltitudeC = function (temperatureBasC, deniveleM) {
  return temperatureBasC - TPMS.GRADIENT_THERMIQUE * deniveleM;
};

// ---------------------------------------------------------------------
// 2. Météo d'une journée
// ---------------------------------------------------------------------
// Ampleur des petites variations (hypothèses, ordre de grandeur observé) :
TPMS.METEO_VARIATION_TEMPERATURE_C = 0.6;  // la température « hésite » de ±0,6 °C
TPMS.METEO_VARIATION_NUAGES = 0.35;        // un nuage peut masquer jusqu'à 35 % du soleil
TPMS.METEO_VARIATION_VENT = 0.35;          // rafales : ±35 % autour du vent moyen
TPMS.METEO_VARIATION_DIRECTION_DEG = 20;   // la direction du vent tourne de ±20°
TPMS.METEO_SOLEIL_SOUS_PLUIE = 0.15;       // sous la pluie il ne reste que 15 % du soleil

// options = { temperatureMinC, temperatureMaxC, heureMaxH, ensoleillementMax,
//             pluie, ventMs, ventDirDeg, graine, leverH, coucherH }
// leverH / coucherH sont facultatifs (par défaut 6,5 h et 20,5 h).
TPMS.creerMeteo = function (options) {
  var o = options || {};
  function val(v, defaut) { return v === undefined ? defaut : v; }
  return {
    temperatureMinC: val(o.temperatureMinC, 10),
    temperatureMaxC: val(o.temperatureMaxC, 20),
    heureMaxH: val(o.heureMaxH, 15),         // le plus chaud : milieu d'après-midi
    ensoleillementMax: val(o.ensoleillementMax, 0.8),
    pluie: !!o.pluie,
    ventMs: val(o.ventMs, 3),
    ventDirDeg: val(o.ventDirDeg, 270),      // d'où vient le vent (270 = ouest)
    leverH: val(o.leverH, 6.5),              // le plus froid : vers le lever du soleil
    coucherH: val(o.coucherH, 20.5),
    graine: val(o.graine, 1)
  };
};

// Bruit « lisse » reproductible : une valeur au hasard dans [−1, 1] tous
// les periodeH heures, et une transition douce entre deux valeurs.
// La valeur ne dépend QUE de l'heure et de la graine : on peut demander
// la météo de 14 h avant celle de 9 h, le résultat est le même.
TPMS.meteoBruitLisse = function (graine, nom, heure, periodeH) {
  var x = heure / periodeH;
  var k = Math.floor(x);
  var f = x - k;
  var a = TPMS.creerAleaNomme(graine, nom + k)() * 2 - 1;
  var b = TPMS.creerAleaNomme(graine, nom + (k + 1))() * 2 - 1;
  var douceur = f * f * (3 - 2 * f);     // courbe en S : pas de cassure
  return a + (b - a) * douceur;
};

// Température « idéale » (sans variations) à l'heure h (0..24).
// Deux demi-cosinus :
//   - du lever (minimum) jusqu'à heureMax : la température monte ;
//   - d'heureMax jusqu'au lever du lendemain : elle redescend.
TPMS.meteoCycleTemperature = function (m, h) {
  var ecart = m.temperatureMaxC - m.temperatureMinC;
  var phase;
  if (h >= m.leverH && h <= m.heureMaxH) {
    phase = (h - m.leverH) / (m.heureMaxH - m.leverH);
    return m.temperatureMinC + ecart * (1 - Math.cos(Math.PI * phase)) / 2;
  }
  var depuisMax = (h - m.heureMaxH + 24) % 24;
  var dureeDescente = m.leverH + 24 - m.heureMaxH;
  phase = depuisMax / dureeDescente;
  return m.temperatureMaxC - ecart * (1 - Math.cos(Math.PI * phase)) / 2;
};

// Ensoleillement (0..1) : 0 la nuit, courbe en arche (sinus) entre le
// lever et le coucher, maximale au milieu de la journée.
TPMS.meteoCycleSoleil = function (m, h) {
  if (h <= m.leverH || h >= m.coucherH) return 0;
  return Math.sin(Math.PI * (h - m.leverH) / (m.coucherH - m.leverH));
};

// Météo à une heure donnée. heureDuJourH peut dépasser 24 pour une sortie
// de plusieurs jours (25 h = 1 h du lendemain) : le cycle se répète, mais
// les petites variations, elles, changent d'un jour à l'autre.
TPMS.meteoInstant = function (meteo, heureDuJourH) {
  var m = meteo;
  var heure = heureDuJourH;
  var h = ((heure % 24) + 24) % 24;

  // Température : cycle + petite hésitation (période 2 h)
  var temperature = TPMS.meteoCycleTemperature(m, h) +
    TPMS.METEO_VARIATION_TEMPERATURE_C * TPMS.meteoBruitLisse(m.graine, "temp", heure, 2);

  // Soleil : courbe solaire × maximum du jour × passages nuageux (période 40 min)
  var nuage = (TPMS.meteoBruitLisse(m.graine, "nuage", heure, 0.67) + 1) / 2;   // 0..1
  var soleil = TPMS.meteoCycleSoleil(m, h) * m.ensoleillementMax *
    (1 - TPMS.METEO_VARIATION_NUAGES * nuage);
  if (m.pluie) soleil *= TPMS.METEO_SOLEIL_SOUS_PLUIE;

  // Vent : rafales (période 15 min) et direction qui tourne (période 1 h)
  var vent = m.ventMs * (1 + TPMS.METEO_VARIATION_VENT * TPMS.meteoBruitLisse(m.graine, "vent", heure, 0.25));
  var direction = m.ventDirDeg + TPMS.METEO_VARIATION_DIRECTION_DEG *
    TPMS.meteoBruitLisse(m.graine, "dir", heure, 1);

  return {
    temperatureC: temperature,
    ensoleillement: Math.max(0, Math.min(1, soleil)),
    ventMs: Math.max(0, vent),
    ventDirDeg: ((direction % 360) + 360) % 360,
    pluie: m.pluie
  };
};

// ---------------------------------------------------------------------
// Préréglages (options pour TPMS.creerMeteo). Valeurs typiques de la
// région lyonnaise (ordres de grandeur Météo-France), à ajuster.
// ---------------------------------------------------------------------
TPMS.METEOS = {
  printemps: {
    temperatureMinC: 8, temperatureMaxC: 19, heureMaxH: 15, ensoleillementMax: 0.75,
    pluie: false, ventMs: 3, ventDirDeg: 340, leverH: 6.75, coucherH: 20.5, graine: 11
  },
  ete_canicule: {
    temperatureMinC: 22, temperatureMaxC: 37, heureMaxH: 16, ensoleillementMax: 1,
    pluie: false, ventMs: 1.5, ventDirDeg: 180, leverH: 6, coucherH: 21.5, graine: 22
  },
  hiver_gel: {
    temperatureMinC: -6, temperatureMaxC: 3, heureMaxH: 14, ensoleillementMax: 0.45,
    pluie: false, ventMs: 4, ventDirDeg: 20, leverH: 8.25, coucherH: 17.25, graine: 33
  },
  automne_pluie: {
    temperatureMinC: 9, temperatureMaxC: 13, heureMaxH: 14.5, ensoleillementMax: 0.3,
    pluie: true, ventMs: 7, ventDirDeg: 200, leverH: 7.5, coucherH: 18.5, graine: 44
  }
};
