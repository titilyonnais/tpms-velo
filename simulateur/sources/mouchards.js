// =====================================================================
// mouchards.js — Un réseau d'espions Bluetooth dans la ville
// ---------------------------------------------------------------------
// SOURCE DE DONNÉES simulée, pour l'analyse de risques « vie privée ».
//
// L'attaque ne demande AUCUNE compétence en piratage : il suffit de poser
// quelques récepteurs Bluetooth (un Raspberry Pi à environ 40 € dans une
// vitrine, un abribus, une voiture garée) et de noter tout ce qui passe.
// Les capteurs TPMS du commerce émettent toutes les 3 s, en clair, avec
// une adresse qui ne change JAMAIS : chaque passage du vélo devant un
// récepteur est noté avec l'heure. En recoupant, on reconstitue les
// trajets, les horaires, et même le quartier où le vélo dort la nuit.
//
// Avec les capteurs « v2 » (logique/trame2.js), l'adresse change tous les
// quarts d'heure : l'espion voit passer des inconnus, qu'il ne peut pas
// relier entre eux.
//
// Ce fichier joue l'ATTAQUANT : il écoute (mouchardsEcouter) puis exploite
// ce qu'il a entendu (mouchardsAnalyser). Le boîtier n'y est pour rien.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.MOUCHARDS_ECART_M = 700;          // un récepteur tous les 700 m environ
TPMS.MOUCHARDS_DISTANCE_MIN_M = 300;   // jamais deux récepteurs à moins de 300 m
TPMS.MOUCHARD_GAIN_DBI = 5;            // petite antenne directive
TPMS.MOUCHARD_SENSIBILITE_DBM = -98;   // bon récepteur, alimenté sur secteur
TPMS.MOUCHARD_FUSION_MS = 120000;      // annonces à moins de 2 min = un même passage
TPMS.TRAJET_COUPURE_MS = 30 * 60000;   // plus de 30 min sans passage = nouveau trajet

// Distance approximative entre deux points GPS (m).
function distanceGpsM(a, b) {
  var dy = (b.lat - a.lat) * 110540;
  var dx = (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

// Les récepteurs sont posés en ville, le long des rues fréquentées :
// sur les parcours de type « ville » et « trajet ».
TPMS.creerReseauMouchards = function (graine) {
  var mouchards = [];
  TPMS.PARCOURS.forEach(function (p) {
    if (p.type !== "ville" && p.type !== "trajet") return;
    var prep = TPMS.parcoursPreparer(p);
    for (var d = 150; d < prep.longueurM; d += TPMS.MOUCHARDS_ECART_M) {
      var pt = TPMS.parcoursPoint(prep, d);
      var place = { lat: pt.lat + 0.0001, lon: pt.lon };   // à une dizaine de mètres de la rue
      var tropPres = mouchards.some(function (mm) { return distanceGpsM(mm, place) < TPMS.MOUCHARDS_DISTANCE_MIN_M; });
      if (!tropPres) mouchards.push({ id: "M" + (mouchards.length + 1), lat: place.lat, lon: place.lon });
    }
  });
  return {
    mouchards: mouchards,
    passages: [],          // { mouchard, adresse, debutMs, finMs, annonces }
    annoncesEntendues: 0,
    alea: TPMS.creerAleaNomme(graine, "mouchards")
  };
};

// Les récepteurs entendent-ils les annonces de NOS capteurs pendant ce pas ?
// annonces : [{ tMs, octets, position: {x, y, z}, extraPerteDb }]
// versMetres(lat, lon) → {x, y} dans le même repère que les positions.
TPMS.mouchardsEcouter = function (reseau, annonces, versMetres, canal) {
  if (annonces.length === 0) return;
  reseau.mouchards.forEach(function (mo) {
    var p = versMetres(mo.lat, mo.lon);
    annonces.forEach(function (a) {
      var dx = a.position.x - p.x, dy = a.position.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 200) return;
      // Bilan de liaison : 0 dBm émis, −2 dBi pour l'antenne du capteur,
      // +5 dBi pour celle du récepteur, moins la perte du trajet et la jante.
      var rssi = 0 - 2 + TPMS.MOUCHARD_GAIN_DBI - TPMS.radioPerteTrajetDb(canal, d, 2426) - a.extraPerteDb;
      if (rssi < TPMS.MOUCHARD_SENSIBILITE_DBM) return;
      // Près du seuil, une partie des annonces se perd (bruit, collisions).
      var chance = rssi > TPMS.MOUCHARD_SENSIBILITE_DBM + 8 ? 0.95 : 0.5;
      if (reseau.alea() > chance) return;
      var dec = TPMS.decoderTrame(a.octets) || TPMS.decoderTrameV2(a.octets);
      if (!dec) return;
      reseau.annoncesEntendues++;
      TPMS.mouchardsNoter(reseau, mo.id, dec.adresse, a.tMs);
    });
  });
};

// Fusionne les annonces d'un même passage devant un même récepteur.
TPMS.mouchardsNoter = function (reseau, mouchard, adresse, tMs) {
  for (var i = reseau.passages.length - 1; i >= 0 && i >= reseau.passages.length - 20; i--) {
    var p = reseau.passages[i];
    if (p.mouchard === mouchard && p.adresse === adresse && tMs - p.finMs < TPMS.MOUCHARD_FUSION_MS) {
      p.finMs = tMs;
      p.annonces++;
      return;
    }
  }
  reseau.passages.push({ mouchard: mouchard, adresse: adresse, debutMs: tMs, finMs: tMs, annonces: 1 });
};

// ---------------------------------------------------------------------
// Ce que l'espion tire de ses notes
// ---------------------------------------------------------------------
// heureDepartH : heure de la simulation à t = 0 (pour dater les passages).
// Retourne, pour chaque adresse vue, ses trajets reconstitués et ce qu'on
// en déduit. Les adresses sont triées : la plus suivie en premier.
TPMS.mouchardsAnalyser = function (reseau, heureDepartH) {
  var parAdresse = {};
  reseau.passages.forEach(function (p) {
    (parAdresse[p.adresse] = parAdresse[p.adresse] || []).push(p);
  });
  var resultats = Object.keys(parAdresse).map(function (adresse) {
    var passages = parAdresse[adresse].slice().sort(function (a, b) { return a.debutMs - b.debutMs; });
    // Découpage en trajets : un trou de plus de 30 min sépare deux trajets.
    var trajets = [], courant = null;
    passages.forEach(function (p) {
      if (!courant || p.debutMs - courant[courant.length - 1].finMs > TPMS.TRAJET_COUPURE_MS) {
        courant = [];
        trajets.push(courant);
      }
      courant.push(p);
    });
    // Où commencent les trajets du matin ? Le premier récepteur croisé
    // le plus souvent indique le quartier de départ (le domicile, en général).
    var departs = {}, jours = {}, heures = [];
    trajets.forEach(function (t) {
      var h = heureDepartH + t[0].debutMs / 3600000;
      jours[Math.floor(h / 24)] = true;
      heures.push(h % 24);
      if (h % 24 < 11) departs[t[0].mouchard] = (departs[t[0].mouchard] || 0) + 1;
    });
    var departHabituel = null, max = 0;
    Object.keys(departs).forEach(function (k) { if (departs[k] > max) { max = departs[k]; departHabituel = k; } });
    return {
      adresse: adresse,
      passages: passages.length,
      trajets: trajets,
      jours: Object.keys(jours).length,
      heures: heures,
      departHabituel: departHabituel,
      departsHabituels: max
    };
  });
  resultats.sort(function (a, b) { return b.passages - a.passages; });
  return resultats;
};
