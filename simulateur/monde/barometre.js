// =====================================================================
// barometre.js — Le baromètre BMP280 du boîtier, et l'air autour de lui
// ---------------------------------------------------------------------
// MONDE SIMULÉ (logique pure, pas de DOM). Le moteur appelle :
//   TPMS.barometreAvancer(baro, dtS, pressionAirPa, temperatureBoitierC)
//   TPMS.barometreMesurer(baro, temperatureBoitierC) → { pressionHpa, temperatureC } ou null
//
// Le BMP280 est DANS le boîtier étanche. Ce qu'il mesure dépend de l'évent :
//   "evente"     (notre choix) : une membrane ePTFE laisse passer l'air.
//                 L'air du boîtier suit l'air extérieur en quelques
//                 secondes (constante de temps τ ≈ 5 s, HYPOTHÈSE : à
//                 mesurer, elle dépend de la membrane et du volume d'air).
//   "sans-event" : boîtier fermé hermétiquement. L'air enfermé à la
//                 fermeture garde sa quantité : sa pression ne suit que la
//                 température (loi des gaz à volume constant), JAMAIS
//                 l'altitude. Ce mode montre pourquoi il faut l'évent.
//   "aucun"      : pas de baromètre (le boîtier d'avant le 24/10/2026).
//
// Sources (fiche Bosch BMP280, HYPOTHÈSES tant que rien n'est mesuré) :
//   précision absolue ±1 hPa (0 à 65 °C), température ±1 °C ;
//   bruit en mode « haute résolution » ≈ 0,02 hPa et 0,01 °C.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.BAROMETRE = {
  tauEventS: 5,            // l'air du boîtier suit l'extérieur en ≈ 5 s (HYPOTHÈSE)
  bruitHpa: 0.02,
  bruitC: 0.01,
  decalageMaxHpa: 1,       // erreur propre à chaque exemplaire (fiche : ±1 hPa)
  decalageMaxC: 1          // (fiche : ±1 °C)
};

// options = { mode, graine, pressionAirPa, temperatureC } (état à la fermeture)
TPMS.creerBarometre = function (options) {
  var alea = TPMS.creerAleaNomme(options.graine || 1, "barometre");
  var B = TPMS.BAROMETRE;
  return {
    mode: options.mode || "evente",
    alea: alea,
    pressionInterieurePa: options.pressionAirPa,
    // Air enfermé à la fermeture du boîtier (mode "sans-event").
    fermeturePa: options.pressionAirPa,
    fermetureK: options.temperatureC + 273.15,
    decalageHpa: (alea() * 2 - 1) * B.decalageMaxHpa,
    decalageC: (alea() * 2 - 1) * B.decalageMaxC
  };
};

// Fait évoluer la pression de l'air DANS le boîtier pendant dtS secondes.
TPMS.barometreAvancer = function (baro, dtS, pressionAirPa, temperatureBoitierC) {
  if (baro.mode === "sans-event") {
    // P / T constant : l'air piégé ne voit pas l'altitude.
    baro.pressionInterieurePa = baro.fermeturePa * (temperatureBoitierC + 273.15) / baro.fermetureK;
    return;
  }
  // Évent : rattrapage exponentiel de la pression extérieure.
  var k = 1 - Math.exp(-dtS / TPMS.BAROMETRE.tauEventS);
  baro.pressionInterieurePa += (pressionAirPa - baro.pressionInterieurePa) * k;
};

// Une mesure, comme le firmware la lira (pression en hPa, température en °C).
TPMS.barometreMesurer = function (baro, temperatureBoitierC) {
  if (baro.mode === "aucun") return null;
  var B = TPMS.BAROMETRE;
  return {
    pressionHpa: baro.pressionInterieurePa / 100 + baro.decalageHpa + TPMS.aleaNormal(baro.alea) * B.bruitHpa,
    temperatureC: temperatureBoitierC + baro.decalageC + TPMS.aleaNormal(baro.alea) * B.bruitC
  };
};
