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
//     d'un point à l'autre pendant les postes (6 h à 22 h, heure de Paris),
//     souvent chargés (jusqu'à 2 t, portées surtout par l'essieu avant) ;
//   - chaque pneu avec le modèle physique du simulateur (pneu.js) : le
//     roulement chargé l'échauffe (HYPOTHÈSE : jusqu'à +14 °C à l'avant à
//     pleine charge et à 8 km/h, constante de temps 40 min) ;
//   - l'air : 16 °C dans l'entrepôt pendant le poste, 12 °C la nuit
//     (chauffage réduit) ; dans la cour, la météo de Lyon selon le mois
//     (moyennes Météo-France arrondies), le cycle du jour, le soleil sur
//     le caoutchouc noir et les jours de pluie (tirés au hasard, graine) ;
//   - quelques pneus ont une fuite lente ; un technicien regonfle à 5 h 30,
//     aux quais, les pneus sous le seuil (maintenance automatique, que le
//     simulateur de l'usine remplace par un technicien qui suit la
//     supervision) ;
//   - chaque capteur TPMS « poids lourd » (plage 0 à 13 bar) annonce une
//     vraie trame de 18 octets (logique/trame.js) : toutes les 3 s quand
//     le chariot roule (et encore 60 s après l'arrêt), toutes les 60 s à
//     l'arrêt ; il détecte le démarrage et annonce dans les 2 s ; sa pile
//     s'use un peu à chaque annonce ;
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
  heureMaintenance: 5.5,           // le technicien regonfle à 5 h 30, chariots garés aux quais
  fuiteLenteMinMm: 0.006, fuiteLenteMaxMm: 0.012,
  intervalleRoulageMs: 3000, intervalleArretMs: 60000,
  maintienRoulageMs: 60000,        // le capteur reste en mode rapide 60 s après l'arrêt
  temperatureInterieureC: 16, temperatureInterieureNuitC: 12,
  // Charge et échauffement (HYPOTHÈSES à mesurer) : capacité 2 t ; à 8 km/h,
  // +4 °C à vide, +10 °C de plus à pleine charge sur l'avant.
  chargeMaxKg: 2000, partChargee: 0.6, echauffementVideC: 4, echauffementChargeC: 10,
  constanteTempsPneuS: 2400,
  // Pile du capteur : 1 % pour 60 000 annonces (≈ 5 ans à l'arrêt, moins en roulant).
  annoncesParPourcentPile: 60000,
  // Températures moyennes à Lyon, mois par mois (°C, normales arrondies).
  meteoMoisC: [3.5, 4.8, 8.6, 11.5, 15.6, 19.4, 21.9, 21.4, 17.4, 13.1, 7.6, 4.3],
  amplitudeJourC: 8, ecartJourC: 3, joursDePluie: 0.3
};

// Heure de Paris (heure d'été du dernier dimanche de mars au dernier
// dimanche d'octobre, à 1 h UTC), quel que soit le fuseau de l'ordinateur.
// Retourne { annee, mois (0-11), jour, heure décimale, jourAn }.
TPMS.heureParis = function (tMs) {
  var d = new Date(tMs);
  var an = d.getUTCFullYear();
  function dernierDimanche(mois) { var fin = new Date(Date.UTC(an, mois + 1, 0, 1)); return fin.getTime() - fin.getUTCDay() * 86400000; }
  var ete = tMs >= dernierDimanche(2) && tMs < dernierDimanche(9);
  var p = new Date(tMs + (ete ? 2 : 1) * 3600000);
  var debutAn = Date.UTC(p.getUTCFullYear(), 0, 1);
  return { annee: p.getUTCFullYear(), mois: p.getUTCMonth(), jour: p.getUTCDate(),
    heure: p.getUTCHours() + p.getUTCMinutes() / 60 + p.getUTCSeconds() / 3600,
    jourAn: Math.floor((p.getTime() - debutAn) / 86400000), ete: ete };
};

// Météo de la cour pour un jour donné (même graine, même météo) :
// écart à la normale, nébulosité, pluie.
function meteoDuJour(monde, h) {
  var cle = h.annee * 1000 + h.jourAn;
  if (monde.meteo && monde.meteo.cle === cle) return monde.meteo;
  var a = TPMS.creerAleaNomme(monde.graine, "meteo-" + cle);
  monde.meteo = { cle: cle, ecartC: (a() * 2 - 1) * TPMS.ENTREPOT.ecartJourC, nuages: a(),
    pluie: a() < TPMS.ENTREPOT.joursDePluie, pluieDebutH: 6 + 12 * a(), pluieDureeH: 1 + 5 * a() };
  return monde.meteo;
}

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
  var monde = { graine: graine, tMs: o.debutMs || 0, chariots: [], aleaMonde: TPMS.creerAleaNomme(graine, "entrepot"),
    maintenanceAuto: o.maintenanceAuto !== false, meteo: null, regonflages: [] };
  var n = o.nbChariots || 8;
  for (var i = 0; i < n; i++) {
    var numero = i + 1;
    var alea = TPMS.creerAleaNomme(graine, "chariot" + numero);
    var c = {
      id: "C" + (numero < 10 ? "0" : "") + numero, numero: numero, alea: alea,
      x: 5 + 30 * alea(), y: 3 + 24 * alea(), cible: null, attenteJusquaMs: monde.tMs,
      chargeKg: 0, vitesseMs: 0, immobiliseJusquaMs: 0, distanceM: 0,
      pneus: {}, capteurs: {}
    };
    TPMS.POSITIONS_PNEU.forEach(function (pos, k) {
      c.pneus[pos] = TPMS.creerPneu({
        nom: pos, volumeL: E.volumePneuL, largeurMm: E.largeurPneuMm, chambre: "industriel",
        pressionRelBar: E.pressionNominaleBar - 0.3 * alea(), temperatureC: E.temperatureInterieureC, graine: graine + numero * 10 + k
      });
      c.pneus[pos].constanteTempsS = E.constanteTempsPneuS;
      c.capteurs[pos] = {
        numero: k + 1, adresse: TPMS.adresseCapteurChariot(numero, k),
        decalageBar: 0.03 * TPMS.aleaNormal(alea), pilePct: 70 + 30 * alea(),
        prochaineAnnonceMs: monde.tMs + Math.floor(alea() * E.intervalleArretMs),
        rapideJusquaMs: 0, arrache: false, annonces: 0
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

function heureDuJour(tMs) { return TPMS.heureParis(tMs).heure; }

// L'air autour du chariot (°C), le soleil sur le pneu (0 à 1) et la pluie.
// Dedans : 16 °C pendant le poste, 12 °C la nuit. Dehors : normale du
// mois, cycle du jour (minimum vers 6 h, maximum vers 15 h), écart du jour.
TPMS.entrepotAir = function (monde, x, tMs) {
  var E = TPMS.ENTREPOT, h = TPMS.heureParis(tMs);
  if (x < E.zones[2].x0) {
    var chauffe = h.heure >= E.posteDebutH - 1 && h.heure < E.posteFinH;
    return { temperatureC: chauffe ? E.temperatureInterieureC : E.temperatureInterieureNuitC, ensoleillement: 0, pluie: false, dehors: false };
  }
  var m = meteoDuJour(monde, h);
  var cycle = -Math.cos((h.heure - 3) / 24 * 2 * Math.PI) * 0.5;   // −0,5 vers 3 h, +0,5 vers 15 h
  var t = E.meteoMoisC[h.mois] + m.ecartC + E.amplitudeJourC * cycle;
  var pluie = m.pluie && h.heure >= m.pluieDebutH && h.heure < m.pluieDebutH + m.pluieDureeH;
  // Soleil : hauteur simple entre 7 h et 19 h, moins de nuages, pas de soleil sous la pluie.
  var jour = h.heure > 7 && h.heure < 19 ? Math.sin((h.heure - 7) / 12 * Math.PI) : 0;
  var soleil = pluie ? 0 : Math.max(0, jour * (1 - 0.9 * m.nuages));
  if (pluie) t -= 2;
  return { temperatureC: Math.round(t * 10) / 10, ensoleillement: soleil, pluie: pluie, dehors: true };
};

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
  if (!c.cible || monde.tMs < c.immobiliseJusquaMs) return 0;
  var dx = c.cible.x - c.x, dy = c.cible.y - c.y, d = Math.sqrt(dx * dx + dy * dy);
  var pas = E.vitesseMs * dtS;
  if (d <= pas) {
    c.x = c.cible.x; c.y = c.cible.y; c.cible = null;
    c.distanceM += d;
    c.attenteJusquaMs = monde.tMs + (30 + 240 * c.alea()) * 1000;   // chargement, déchargement
    // Au prochain trajet : chargé (palette) ou à vide.
    c.chargeKg = c.alea() < E.partChargee ? Math.round(300 + (E.chargeMaxKg - 300) * c.alea()) : 0;
    return d / dtS;
  }
  c.x += dx / d * pas; c.y += dy / d * pas;
  c.distanceM += pas;
  return E.vitesseMs;
}

// Échauffement à l'équilibre d'un pneu qui roule (°C) : déformation du
// caoutchouc, proportionnelle à la vitesse, et à la charge pour l'avant.
function echauffementRoulage(c, pos, vitesseMs) {
  var E = TPMS.ENTREPOT;
  var part = pos.charAt(1) === "V" ? c.chargeKg / E.chargeMaxKg : 0.15 * c.chargeKg / E.chargeMaxKg;
  return (E.echauffementVideC + E.echauffementChargeC * part) * vitesseMs / E.vitesseMs;
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
    var maintenance = monde.maintenanceAuto && h >= E.heureMaintenance && h < E.heureMaintenance + pas / 3600;
    monde.chariots.forEach(function (c) {
      var vitesseMs = deplacer(monde, c, pas);
      c.vitesseMs = vitesseMs;
      var air = TPMS.entrepotAir(monde, c.x, monde.tMs);
      TPMS.POSITIONS_PNEU.forEach(function (pos) {
        var pneu = c.pneus[pos];
        TPMS.pneuUnPas(pneu, pas, { temperatureAmbianteC: air.temperatureC, ensoleillement: air.ensoleillement, vitesseMs: vitesseMs,
          altitudeM: 170, pluie: air.pluie, freinage: 0, echauffementC: echauffementRoulage(c, pos, vitesseMs) });
        TPMS.pneuMettreAJour(pneu);
        if (maintenance && pneu.pressionRelBar < E.seuilRegonflageBar) {
          monde.regonflages.push({ tMs: monde.tMs, chariot: c.id, position: pos, avantBar: pneu.pressionRelBar });
          TPMS.regonflerPneu(pneu, E.pressionNominaleBar);   // le technicien regonfle
        }
        var capteur = c.capteurs[pos];
        if (capteur.arrache) return;                          // capteur arraché : plus rien
        // Le capteur sent la rotation : mode rapide, et première annonce
        // dans les 2 s quand le chariot démarre.
        if (vitesseMs > 0.5) {
          if (monde.tMs >= capteur.rapideJusquaMs) capteur.prochaineAnnonceMs = Math.min(capteur.prochaineAnnonceMs, monde.tMs + 1000 + Math.floor(c.alea() * 1000));
          capteur.rapideJusquaMs = monde.tMs + E.maintienRoulageMs;
        }
        if (monde.tMs >= capteur.prochaineAnnonceMs) {
          annonces.push({ tMs: monde.tMs, chariot: c.id, position: pos, x: c.x, y: c.y, octets: trameDuCapteur(monde, c, pos) });
          capteur.annonces++;
          capteur.pilePct = Math.max(0, capteur.pilePct - 1 / E.annoncesParPourcentPile);
          var intervalle = monde.tMs < capteur.rapideJusquaMs ? E.intervalleRoulageMs : E.intervalleArretMs;
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
