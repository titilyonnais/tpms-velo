// =====================================================================
// chariots.js — Simulation d'un entrepôt : chariots, pneus, capteurs,
// et ce qu'entend chaque passerelle
// ---------------------------------------------------------------------
// MODÈLE DU MONDE (simulation), utilisable dans Node ET dans le
// navigateur. Le temps est passé en paramètre.
// Nécessite : logique/trame.js, simulateur/monde/alea.js, atmosphere.js,
//   pneu.js, capteur.js (constantes TPMS.CAPTEUR).
//
// Dans la maquette, UN conteneur « monde » (entrepot/monde.js) fait
// tourner cette simulation et diffuse chaque annonce, avec la position du
// chariot, sur un réseau à part qui représente l'AIR (la radio
// Bluetooth). Chaque passerelle calcule la puissance qu'elle reçoit
// (TPMS.entrepotRssi) et ne garde que ce qu'elle entend.
//
// Ce qui est simulé :
//   - un entrepôt de 120 m × 30 m : quais (où les chariots se garent et
//     se rechargent la nuit), allées de stockage, cour extérieure ;
//   - des chariots à 4 pneus gonflables (AVG, AVD, ARG, ARD) qui vont
//     d'un point à l'autre pendant les postes (6 h à 22 h) ;
//   - chaque pneu avec le modèle physique du simulateur (pneu.js) ;
//     quelques pneus ont une fuite lente, et un technicien regonfle chaque
//     matin à 7 h les pneus sous le seuil (maintenance) ;
//   - chaque capteur TPMS « poids lourd » (plage 0 à 13 bar) annonce une
//     vraie trame de 18 octets (logique/trame.js) : toutes les 3 s quand
//     le chariot roule, toutes les 60 s à l'arrêt ;
//   - la radio : puissance reçue = puissance à 1 m − 10 × n × log10(d),
//     plus un bruit ; en dessous du seuil de réception, la passerelle
//     n'entend rien. Un entrepôt plein de racks métalliques atténue plus
//     que l'air libre : n = 2,4 (HYPOTHÈSE, à mesurer avec le démonstrateur),
//     soit une portée d'environ 24 m pour un seuil de −92 dBm.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.ENTREPOT = {
  largeurM: 120, profondeurM: 30,
  zones: [
    { id: "quais", nom: "Quais", x0: 0, x1: 40 },
    { id: "allees", nom: "Allées de stockage", x0: 40, x1: 80 },
    { id: "cour", nom: "Cour extérieure", x0: 80, x1: 120, exterieur: true }
  ],
  passerelles: [
    { id: 1, zone: "quais", x: 20, y: 15 },
    { id: 2, zone: "allees", x: 60, y: 15 },
    { id: 3, zone: "cour", x: 100, y: 15 }
  ],
  radio: { puissance1mDbm: -59, exposant: 2.4, bruitDb: 4, seuilDbm: -92 },
  // Pneus : 6.50-10 gonflable, pression constructeur 8,5 bar (HYPOTHÈSE,
  // à lire sur la plaque du chariot) ; capteur « poids lourd » 0-13 bar.
  pressionNominaleBar: 8.5, seuilRegonflageBar: 8.0, volumePneuL: 20, largeurPneuMm: 165,
  plageCapteurBar: 13,
  vitesseMs: 2.2,                  // ≈ 8 km/h en roulant
  posteDebutH: 6, posteFinH: 22,   // chariots en service
  heureMaintenance: 7,             // le technicien regonfle à 7 h
  fuiteLenteMinMm: 0.006, fuiteLenteMaxMm: 0.012,
  intervalleRoulageMs: 3000, intervalleArretMs: 60000,
  temperatureInterieureC: 16
};

TPMS.POSITIONS_PNEU = ["AVG", "AVD", "ARG", "ARD"];

// Adresse du capteur : C4:10:<n° du chariot>:00:<n° de la roue>.
TPMS.adresseCapteurChariot = function (numeroChariot, indexRoue) {
  return [0xC4, 0x10, numeroChariot, 0x00, indexRoue + 1];
};

// options = { graine, nbChariots, debutMs, chariotsAvecFuite }
TPMS.creerEntrepot = function (options) {
  var o = options || {};
  var E = TPMS.ENTREPOT;
  var graine = (o.graine || 2026) >>> 0;
  var monde = { graine: graine, tMs: o.debutMs || 0, chariots: [], aleaMonde: TPMS.creerAleaNomme(graine, "entrepot") };
  var n = o.nbChariots || 8;
  for (var i = 0; i < n; i++) {
    var numero = i + 1;
    var alea = TPMS.creerAleaNomme(graine, "chariot" + numero);
    var c = {
      id: "C" + (numero < 10 ? "0" : "") + numero, numero: numero, alea: alea,
      x: 5 + 30 * alea(), y: 3 + 24 * alea(), cible: null, attenteJusquaMs: monde.tMs,
      pneus: {}, capteurs: {}
    };
    TPMS.POSITIONS_PNEU.forEach(function (pos, k) {
      c.pneus[pos] = TPMS.creerPneu({
        nom: pos, volumeL: E.volumePneuL, largeurMm: E.largeurPneuMm, chambre: "industriel",
        pressionRelBar: E.pressionNominaleBar - 0.3 * alea(), temperatureC: E.temperatureInterieureC, graine: graine + numero * 10 + k
      });
      c.capteurs[pos] = {
        numero: k + 1, adresse: TPMS.adresseCapteurChariot(numero, k),
        decalageBar: 0.03 * TPMS.aleaNormal(alea), pilePct: 70 + Math.round(30 * alea()),
        prochaineAnnonceMs: monde.tMs + Math.floor(alea() * E.intervalleArretMs)
      };
    });
    monde.chariots.push(c);
  }
  // Fuites lentes : par défaut les chariots 3 et 6 (une roue chacun), pour la démonstration.
  (o.chariotsAvecFuite || [3, 6]).forEach(function (numero) {
    var c = monde.chariots[numero - 1];
    if (!c) return;
    var pos = TPMS.POSITIONS_PNEU[Math.floor(c.alea() * 4)];
    TPMS.pneuFuiteLente(c.pneus[pos], E.fuiteLenteMinMm + (E.fuiteLenteMaxMm - E.fuiteLenteMinMm) * c.alea());
  });
  return monde;
};

// Liste blanche, telle que le service maintenance l'enregistre à la pose
// des capteurs : adresse → chariot et position.
TPMS.entrepotRegistreCapteurs = function (monde) {
  var liste = [];
  monde.chariots.forEach(function (c) {
    TPMS.POSITIONS_PNEU.forEach(function (pos) {
      liste.push({ adresse: TPMS.adresseEnTexte(c.capteurs[pos].adresse), chariot: c.id, position: pos });
    });
  });
  return liste;
};

// Gonflage à la station d'air comprimé de l'atelier : on ajoute de l'air
// jusqu'à la pression voulue (quantité d'air × rapport des pressions
// absolues ; quelques tours, car la carcasse s'étire et change le volume).
TPMS.regonflerPneu = function (pneu, pressionRelBar) {
  for (var k = 0; k < 8 && Math.abs(pneu.pressionRelBar - pressionRelBar) > 0.001; k++) {
    var cible = pressionRelBar * TPMS.PA_PAR_BAR + TPMS.pressionAtmospheriquePa(pneu.altitudeM);
    pneu.nMol *= cible / TPMS.pneuPressionAbsoluePa(pneu);
    TPMS.pneuMettreAJour(pneu);
  }
};

// Heure locale (fuseau de la machine : TZ=Europe/Paris dans la maquette,
// identique sur toutes les passerelles).
function heureDuJour(tMs) { var d = new Date(tMs); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }

// Température de l'air autour du chariot : 16 °C dedans, plus froid et
// plus variable dehors (cycle jour-nuit simple, HYPOTHÈSE).
function temperatureAir(x, tMs) {
  var E = TPMS.ENTREPOT;
  if (x < E.zones[2].x0) return E.temperatureInterieureC;
  return 9 + 6 * Math.sin((heureDuJour(tMs) - 9) / 24 * 2 * Math.PI);
}

function deplacer(monde, c, dtS) {
  var E = TPMS.ENTREPOT;
  var h = heureDuJour(monde.tMs);
  var enService = h >= E.posteDebutH && h < E.posteFinH;
  if (!enService) {
    // Hors poste : retour aux quais pour la recharge, puis on n'en bouge plus.
    if (c.x > 38 && (!c.cible || c.cible.x > 38)) c.cible = { x: 5 + 30 * c.alea(), y: 3 + 24 * c.alea() };
  } else if (!c.cible && monde.tMs >= c.attenteJusquaMs) {
    c.cible = { x: 2 + (E.largeurM - 4) * c.alea(), y: 2 + (E.profondeurM - 4) * c.alea() };
  }
  if (!c.cible) return 0;
  var dx = c.cible.x - c.x, dy = c.cible.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
  var pas = E.vitesseMs * dtS;
  if (d <= pas) {
    c.x = c.cible.x; c.y = c.cible.y; c.cible = null;
    c.attenteJusquaMs = monde.tMs + (30 + 240 * c.alea()) * 1000;   // chargement, déchargement
    return d / dtS;
  }
  c.x += dx / d * pas; c.y += dy / d * pas;
  return E.vitesseMs;
}

function trameDuCapteur(monde, c, pos) {
  var E = TPMS.ENTREPOT;
  var capteur = c.capteurs[pos], pneu = c.pneus[pos];
  var p = (TPMS.pneuPressionAbsoluePa(pneu) - TPMS.CAPTEUR.pressionReferencePa) / TPMS.PA_PAR_BAR;
  p += capteur.decalageBar + 0.005 * TPMS.aleaNormal(c.alea);
  p = Math.max(0, Math.min(E.plageCapteurBar, Math.round(p * 100) / 100));
  return TPMS.encoderTrame({
    numero: capteur.numero, adresse: capteur.adresse, pressionBar: p,
    temperatureC: Math.round(pneu.temperatureAirC * 10) / 10, batteriePct: capteur.pilePct,
    alarme: p < TPMS.CAPTEUR.seuilSansPressionBar ? 0x01 : 0x00
  });
}

// Avance le monde jusqu'à jusquaMs, par pas de dtS secondes.
// Retourne les annonces émises : [{ tMs, chariot, position, x, y, octets }].
TPMS.entrepotAvancer = function (monde, jusquaMs, dtS) {
  var E = TPMS.ENTREPOT;
  var pas = dtS || 1;
  var annonces = [];
  while (monde.tMs + pas * 1000 <= jusquaMs) {
    monde.tMs += pas * 1000;
    var h = heureDuJour(monde.tMs);
    var maintenance = h >= E.heureMaintenance && h < E.heureMaintenance + pas / 3600;
    monde.chariots.forEach(function (c) {
      var vitesseMs = deplacer(monde, c, pas);
      var tAir = temperatureAir(c.x, monde.tMs);
      TPMS.POSITIONS_PNEU.forEach(function (pos) {
        var pneu = c.pneus[pos];
        TPMS.pneuUnPas(pneu, pas, { temperatureAmbianteC: tAir, ensoleillement: 0, vitesseMs: vitesseMs, altitudeM: 170, pluie: false, freinage: 0 });
        TPMS.pneuMettreAJour(pneu);
        if (maintenance && pneu.pressionRelBar < E.seuilRegonflageBar) {
          TPMS.regonflerPneu(pneu, E.pressionNominaleBar);   // le technicien regonfle
        }
        var capteur = c.capteurs[pos];
        if (monde.tMs >= capteur.prochaineAnnonceMs) {
          annonces.push({ tMs: monde.tMs, chariot: c.id, position: pos, x: c.x, y: c.y, octets: trameDuCapteur(monde, c, pos) });
          var intervalle = vitesseMs > 0.5 ? E.intervalleRoulageMs : E.intervalleArretMs;
          capteur.prochaineAnnonceMs = monde.tMs + intervalle + Math.floor(c.alea() * 10);   // advDelay
        }
      });
    });
  }
  return annonces;
};

// Puissance reçue par une passerelle (dBm), ou null si elle n'entend rien.
// alea : propre à la passerelle (chacune a son bruit radio).
TPMS.entrepotRssi = function (passerelle, x, y, alea) {
  var R = TPMS.ENTREPOT.radio;
  var dx = x - passerelle.x, dy = y - passerelle.y;
  var d = Math.max(1, Math.sqrt(dx * dx + dy * dy + 36));   // la passerelle est au plafond, à 6 m
  var rssi = R.puissance1mDbm - 10 * R.exposant * Math.log10(d) + R.bruitDb * TPMS.aleaNormal(alea);
  return rssi < R.seuilDbm ? null : Math.round(rssi);
};

TPMS.entrepotZone = function (x) {
  var zones = TPMS.ENTREPOT.zones;
  for (var i = 0; i < zones.length; i++) if (x < zones[i].x1) return zones[i].id;
  return zones[zones.length - 1].id;
};
