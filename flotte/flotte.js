// =====================================================================
// flotte.js — Simulation d'une flotte de 20 vélos de location à Lyon
// ---------------------------------------------------------------------
// MODÈLE DU MONDE (simulation), utilisable dans le navigateur ET dans
// Node. Le temps est passé en paramètre : on peut simuler plusieurs
// semaines en quelques secondes.
// Nécessite : logique/trame.js, fuite.js, alertes.js, securite.js,
//   simulateur/monde/alea.js, atmosphere.js, pneu.js, capteur.js,
//   flotte/flotte-logique.js, flotte/registre.js.
//
// Ce qui est simulé :
//   - 6 stations, 20 vélos ; des locations au hasard (graine) avec des
//     heures de pointe le matin et le soir, moins le week-end ;
//   - chaque pneu avec le modèle physique du simulateur (pneu.js : gaz
//     parfait, chaleur du soleil et du roulement, perméation du butyle,
//     écoulement par les trous). Chaque vélo a sa « valve qui suinte »
//     plus ou moins (fuite naturelle différente), quelques vélos ont une
//     fuite lente, et des crevaisons arrivent en roulant ;
//   - les capteurs TPMS produisent de vraies trames de 18 octets
//     (logique/trame.js), que le boîtier décode, filtre (liste blanche,
//     vraisemblance) et évalue (logique/alertes.js) comme le vrai ;
//   - le boîtier envoie ses mesures par lots (toutes les 30 min par
//     défaut) : au registre en mémoire (mode démo) et, si demandé, à un
//     serveur (serveur/flotte-vers-serveur.js) ;
//   - un technicien passe chaque matin (sauf le dimanche) : il suit la
//     liste de priorité de la supervision, regonfle, change les chambres
//     qui fuient, recharge les boîtiers.
//
// Simplification assumée : un pas de 60 s (au lieu de 50 ms dans le
// simulateur d'un vélo). La thermique du pneu est calculée exactement
// sur le pas (exponentielle) et les trous ont leurs propres sous-pas
// (pneu.js) : ce pas plus long ne change pas le résultat physique.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.FLOTTE_SIM = {
  pasS: 60,                       // pas de simulation
  periodeMesureMs: 10 * 60000,    // le boîtier garde une mesure toutes les 10 min
  lotMsDefaut: 30 * 60000,        // et envoie ses mesures toutes les 30 min
  largeurPneuMm: 40,              // 700×40 : pneus de vélo de ville
  vitesseKmh: 15, vitesseEcartKmh: 2.5,
  detour: 1.3,                    // la rue est 30 % plus longue que la ligne droite
  // Hypothèses (ordre de grandeur pour des vélos de ville) :
  crevaisonParKm: 1 / 1500,       // une crevaison franche tous les 1500 km
  fuiteLenteParKm: 1 / 800,       // une petite épine qui reste plantée tous les 800 km
  fuiteLenteMinMm: 0.004,         // micro-trou de 4 à 7 µm : −0,15 à −0,5 bar/jour
  fuiteLenteMaxMm: 0.007,
  suintementMaxMm: 0.0012,        // valve qui suinte : jusqu'à ≈ −0,03 bar/jour en plus
  batterieParJourPct: 3.5,        // LiPo 500 mAh : environ 4 semaines d'autonomie
  pileParJourPct: 0.02,           // CR1632 des capteurs : plusieurs années
  heureTournee: 9,                // le technicien passe à 9 h
  seuilChangementBar: 0.05        // le capteur annonce tout de suite un changement brusque
};

// Locations par vélo et par heure (jour ouvré, puis week-end) : pointes
// à 8 h et 18 h en semaine, après-midi plus chargé le week-end.
TPMS.FLOTTE_TAUX_SEMAINE = [0.01, 0.01, 0.01, 0.01, 0.01, 0.03, 0.08, 0.25, 0.40, 0.20, 0.10, 0.10,
                            0.18, 0.15, 0.10, 0.10, 0.15, 0.30, 0.38, 0.22, 0.12, 0.08, 0.05, 0.02];
TPMS.FLOTTE_TAUX_WEEKEND = [0.02, 0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.04, 0.08, 0.12, 0.18, 0.22,
                            0.22, 0.22, 0.25, 0.25, 0.25, 0.22, 0.18, 0.15, 0.12, 0.10, 0.06, 0.04];

// Météo d'octobre à Lyon (ordre de grandeur Météo-France).
TPMS.FLOTTE_METEO = {
  temperatureMinC: 7, temperatureMaxC: 17, heureMaxH: 15, ensoleillementMax: 0.75,
  pluie: false, ventMs: 3, ventDirDeg: 340, leverH: 7.75, coucherH: 18.75
};

// ---------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------
// options = {
//   graine (42), debutMs (1er octobre 2026, minuit à Lyon), nbVelos (20),
//   lotMs (30 min), garderLots (false : true pour les envoyer à un serveur),
//   technicien (true), fuitesInitiales : [{ id: "V05", roue: "AR", diametreMm }]
//     (sinon 3 vélos tirés au hasard ont une fuite lente au départ) }
TPMS.creerFlotte = function (options) {
  var o = options || {};
  var graine = o.graine === undefined ? 42 : o.graine;
  var debut = o.debutMs === undefined ? Date.UTC(2026, 8, 30, 22, 0, 0) : o.debutMs;
  var nb = o.nbVelos || 20;
  var f = {
    graine: graine,
    debutMs: debut,
    tMs: debut,
    alea: TPMS.creerAleaNomme(graine, "flotte"),
    meteo: TPMS.creerMeteo(Object.assign({ graine: graine }, TPMS.FLOTTE_METEO)),
    lotMs: o.lotMs || TPMS.FLOTTE_SIM.lotMsDefaut,
    garderLots: !!o.garderLots,
    technicien: o.technicien !== false,
    seuils: TPMS.flotteSeuils(),
    velos: [],
    parId: {},
    lotsSortants: [],             // lots à envoyer au serveur : [{ veloId, mesures }]
    interventions: [],            // journal du technicien
    prochaineTourneeMs: null,
    compteurs: { locations: 0, crevaisons: 0, fuitesLentes: 0, kmTotal: 0 },
    meteoInstant: null
  };
  for (var i = 1; i <= nb; i++) {
    var v = creerVeloFlotte(f, i);
    f.velos.push(v);
    f.parId[v.id] = v;
  }
  f.registre = TPMS.creerRegistre(f.velos.map(function (v) { return { id: v.id, nom: v.nom }; }));

  // Fuites lentes présentes dès le départ
  var fuites = o.fuitesInitiales;
  if (!fuites) {
    fuites = [];
    var choisis = {};
    while (fuites.length < Math.min(3, nb)) {
      var n = 1 + Math.floor(f.alea() * nb);
      if (choisis[n]) continue;
      choisis[n] = true;
      fuites.push({ id: idVelo(n), roue: f.alea() < 0.5 ? "AV" : "AR",
        diametreMm: TPMS.aleaEntre(f.alea, TPMS.FLOTTE_SIM.fuiteLenteMinMm, TPMS.FLOTTE_SIM.fuiteLenteMaxMm) });
    }
  }
  fuites.forEach(function (fu) {
    var v = f.parId[fu.id];
    if (v) ajouterFuiteLente(f, v, fu.roue, fu.diametreMm, debut);
  });

  f.prochaineTourneeMs = prochaineTournee(debut);
  f.meteoInstant = meteoA(f, debut);
  return f;
};

function idVelo(n) { return "V" + (n < 10 ? "0" : "") + n; }

function creerVeloFlotte(f, n) {
  var S = TPMS.FLOTTE_SIM;
  var id = idVelo(n);
  var alea = TPMS.creerAleaNomme(f.graine, id);
  var station = TPMS.FLOTTE_STATIONS[(n - 1) % TPMS.FLOTTE_STATIONS.length];
  var meteo = TPMS.meteoInstant(f.meteo, TPMS.flotteHeureLocale(f.tMs).heure);
  var v = {
    id: id, nom: "Vélo " + id.slice(1), alea: alea,
    station: station, lat: station.lat, lon: station.lon, altitudeM: station.altitudeM,
    trajet: null,
    pneus: {}, capteurs: {}, defauts: [],
    boitier: {
      allume: true,
      batteriePct: TPMS.aleaEntre(alea, 35, 100),
      km: Math.round(TPMS.aleaEntre(alea, 200, 3000)),
      appairage: {},
      roues: {},
      reveilMs: f.tMs,
      prochaineMesureMs: f.tMs + Math.floor(alea() * S.periodeMesureMs),
      prochainEnvoiMs: f.tMs + f.lotMs,
      derniereMesure: null,
      tampon: []
    }
  };
  ["AV", "AR"].forEach(function (roue, k) {
    var nominal = TPMS.FLOTTE.nominalBar[roue];
    v.pneus[roue] = TPMS.creerPneu({
      nom: id + " " + roue, largeurMm: S.largeurPneuMm, chambre: "butyle",
      // Gonflé il y a plus ou moins longtemps : entre 88 % et 100 % du nominal
      pressionRelBar: nominal * TPMS.aleaEntre(alea, 0.88, 1.0),
      temperatureC: meteo.temperatureC, altitudeM: station.altitudeM
    });
    ajouterSuintement(v, roue);
    // Capteur : adresse propre au vélo, défaut d'étalonnage tiré une fois
    var adresse = [0xEA, 0xCA, 0x10 + n, roue === "AV" ? 0x01 : 0x02, n];
    v.capteurs[roue] = {
      numero: k + 1,
      adresse: adresse,
      decalageBar: TPMS.CAPTEUR.decalageEcartTypeBar * TPMS.aleaNormal(alea),
      decalageTempC: TPMS.CAPTEUR.decalageTemperatureEcartTypeC * TPMS.aleaNormal(alea),
      plageMaxBar: 3.5,
      pilePct: TPMS.aleaEntre(alea, 60, 100),
      temperatureC: meteo.temperatureC,
      derniereTrameMs: -Infinity,
      dernierePressionBar: null,
      trameRefusee: false
    };
    v.boitier.appairage[roue] = TPMS.adresseEnTexte(adresse);
    v.boitier.roues[roue] = {
      mesure: null, dernierRecuMs: -1, penteBarH: 0, intrusionJusquaMs: 0,
      verification: TPMS.creerVerification(), historique: TPMS.creerHistorique(), etat: TPMS.ETAT.ATTENTE
    };
  });
  return v;
}

// Valve qui suinte : un trou minuscule, différent pour chaque chambre.
function ajouterSuintement(v, roue) {
  var d = TPMS.aleaEntre(v.alea, 0, TPMS.FLOTTE_SIM.suintementMaxMm);
  if (d > 0) TPMS.pneuFuiteLente(v.pneus[roue], d);
}

function ajouterFuiteLente(f, v, roue, diametreMm, tMs) {
  TPMS.pneuFuiteLente(v.pneus[roue], diametreMm);
  v.defauts.push({ type: "fuite lente", roue: roue, diametreMm: diametreMm, depuisMs: tMs });
  f.compteurs.fuitesLentes++;
}

// Prochaine tournée du technicien : 9 h, du lundi au samedi.
function prochaineTournee(tMs) {
  var t = tMs;
  for (var k = 0; k < 9 * 24; k++) {
    var h = TPMS.flotteHeureLocale(t);
    var debutHeure = t - (h.heure - Math.floor(h.heure)) * 3600000;
    t = Math.round(debutHeure + 3600000);   // heure pleine suivante
    var h2 = TPMS.flotteHeureLocale(t);
    if (Math.round(h2.heure) === TPMS.FLOTTE_SIM.heureTournee && h2.jourSemaine !== 0) return t;
  }
  return tMs + 86400000;
}

// Météo à l'instant t : cycle jour/nuit d'octobre, une douceur ou une
// fraîcheur qui varie lentement d'un jour à l'autre (±4 °C), et des
// jours de pluie (1 sur 4) : moins de soleil, 3 °C de moins.
function meteoA(f, tMs) {
  var h = TPMS.flotteHeureLocale(tMs);
  var heureAbs = h.jour * 24 + h.heure;
  var m = TPMS.meteoInstant(f.meteo, heureAbs);
  var pluie = TPMS.creerAleaNomme(f.graine, "pluie" + h.jour)() < 0.25;
  var temperature = m.temperatureC + 4 * TPMS.meteoBruitLisse(f.graine, "saison", heureAbs, 48);
  if (pluie) temperature -= 3;
  return {
    temperatureC: temperature,
    ensoleillement: pluie ? m.ensoleillement * TPMS.METEO_SOLEIL_SOUS_PLUIE : m.ensoleillement,
    pluie: pluie,
    heure: h
  };
}

// ---------------------------------------------------------------------
// Faire avancer la flotte de dureeS secondes
// ---------------------------------------------------------------------
TPMS.flotteAvancer = function (f, dureeS) {
  var restant = dureeS;
  while (restant > 1e-9) {
    var pas = Math.min(TPMS.FLOTTE_SIM.pasS, restant);
    flotteUnPas(f, pas);
    restant -= pas;
  }
  return f;
};

// Avance jusqu'à un instant donné (ms).
TPMS.flotteAvancerJusqua = function (f, tMs) {
  if (tMs > f.tMs) TPMS.flotteAvancer(f, (tMs - f.tMs) / 1000);
  return f;
};

function flotteUnPas(f, dtS) {
  var t = f.tMs + dtS * 1000;
  f.tMs = t;
  var meteo = meteoA(f, t);
  f.meteoInstant = meteo;

  // Tournée du technicien
  if (t >= f.prochaineTourneeMs) {
    if (f.technicien) tournee(f, t, meteo);
    f.prochaineTourneeMs = prochaineTournee(t);
  }

  for (var i = 0; i < f.velos.length; i++) {
    var v = f.velos[i];
    deplacer(f, v, t, dtS, meteo);
    physique(v, dtS, meteo);
    boitier(f, v, t, dtS);
  }
}

// ---------------------------------------------------------------------
// Locations et déplacements
// ---------------------------------------------------------------------
function immobilise(v) {
  return v.pneus.AV.aPlat || v.pneus.AR.aPlat ||
    v.boitier.roues.AV.etat === TPMS.ETAT.CREVAISON || v.boitier.roues.AR.etat === TPMS.ETAT.CREVAISON;
}

function deplacer(f, v, t, dtS, meteo) {
  var S = TPMS.FLOTTE_SIM;
  if (v.trajet) {
    var tr = v.trajet;
    var dKm = tr.vitesseKmh * dtS / 3600;
    if (v.boitier.allume) v.boitier.km += dKm;      // compteur de l'aimant de rayon
    f.compteurs.kmTotal += dKm;
    // Mauvaises surprises sur la route (probabilité proportionnelle aux km)
    var roue = v.alea() < 0.5 ? "AV" : "AR";
    if (v.alea() < dKm * S.crevaisonParKm) {
      TPMS.pneuPercer(v.pneus[roue], { type: "epine" });
      v.defauts.push({ type: "crevaison", roue: roue, depuisMs: t });
      f.compteurs.crevaisons++;
    } else if (v.alea() < dKm * S.fuiteLenteParKm) {
      ajouterFuiteLente(f, v, roue, TPMS.aleaEntre(v.alea, S.fuiteLenteMinMm, S.fuiteLenteMaxMm), t);
    }
    if (t >= tr.finMs) {
      v.station = tr.arrivee;
      v.lat = tr.arrivee.lat; v.lon = tr.arrivee.lon; v.altitudeM = tr.arrivee.altitudeM;
      v.trajet = null;
    } else {
      var x = (t - tr.debutMs) / (tr.finMs - tr.debutMs);
      v.lat = tr.depart.lat + (tr.arrivee.lat - tr.depart.lat) * x;
      v.lon = tr.depart.lon + (tr.arrivee.lon - tr.depart.lon) * x;
      v.altitudeM = tr.depart.altitudeM + (tr.arrivee.altitudeM - tr.depart.altitudeM) * x;
    }
    return;
  }
  // À la station : un client le loue-t-il pendant ce pas ?
  if (immobilise(v)) return;          // personne ne prend un vélo à plat
  var taux = (meteo.heure.jourSemaine === 0 || meteo.heure.jourSemaine === 6)
    ? TPMS.FLOTTE_TAUX_WEEKEND : TPMS.FLOTTE_TAUX_SEMAINE;
  var parHeure = taux[Math.floor(meteo.heure.heure) % 24] * (meteo.pluie ? 0.5 : 1);
  if (v.alea() >= parHeure * dtS / 3600) return;

  var autres = TPMS.FLOTTE_STATIONS.filter(function (s) { return s !== v.station; });
  var arrivee = autres[Math.floor(v.alea() * autres.length)];
  var distanceKm = TPMS.flotteDistanceKm(v.station.lat, v.station.lon, arrivee.lat, arrivee.lon) * S.detour;
  var vitesse = Math.max(10, Math.min(22, S.vitesseKmh + S.vitesseEcartKmh * TPMS.aleaNormal(v.alea)));
  v.trajet = {
    depart: v.station, arrivee: arrivee, vitesseKmh: vitesse, distanceKm: distanceKm,
    debutMs: t, finMs: t + Math.round(distanceKm / vitesse * 3600000)
  };
  f.compteurs.locations++;
}

// ---------------------------------------------------------------------
// Physique : pneus (pneu.js) et température des capteurs (capteur.js)
// ---------------------------------------------------------------------
function physique(v, dtS, meteo) {
  var vitesseMs = v.trajet ? v.trajet.vitesseKmh / 3.6 : 0;
  var ctx = {
    temperatureAmbianteC: meteo.temperatureC, ensoleillement: meteo.ensoleillement,
    vitesseMs: vitesseMs, altitudeM: v.altitudeM, pluie: meteo.pluie, freinage: 0
  };
  var th = TPMS.THERMIQUE_CAPTEUR;
  var ventilation = 1 + vitesseMs / th.ventilationMs;
  ["AV", "AR"].forEach(function (roue) {
    var pneu = v.pneus[roue];
    TPMS.pneuUnPas(pneu, dtS, ctx);         // pas unique (voir l'en-tête)
    TPMS.pneuMettreAJour(pneu);
    // Le capteur, dans son bouchon de valve, suit l'air extérieur et un
    // peu le pneu : sa température ne compense qu'en partie la chaleur.
    var c = v.capteurs[roue];
    var tEq = meteo.temperatureC + th.soleilC * meteo.ensoleillement / ventilation +
      th.conductionValve * (pneu.temperatureAirC - meteo.temperatureC);
    c.temperatureC += (tEq - c.temperatureC) * (1 - Math.exp(-dtS / (th.constanteTempsS / ventilation)));
    c.pilePct = Math.max(0, c.pilePct - TPMS.FLOTTE_SIM.pileParJourPct * dtS / 86400);
  });
}

// ---------------------------------------------------------------------
// Boîtier : trames des capteurs, état des roues, mesures, envoi par lots
// ---------------------------------------------------------------------
// Le capteur mesure la pression ABSOLUE et retire 1013,25 hPa fixes ;
// il ajoute son défaut d'étalonnage et son bruit ; il sature à sa plage.
function trameCapteur(v, roue) {
  var c = v.capteurs[roue];
  var pneu = v.pneus[roue];
  var p = (TPMS.pneuPressionAbsoluePa(pneu) - TPMS.CAPTEUR.pressionReferencePa) / TPMS.PA_PAR_BAR;
  p += c.decalageBar + 0.005 * TPMS.aleaNormal(v.alea);
  p = Math.max(0, Math.min(c.plageMaxBar, Math.round(p * 100) / 100));
  var temp = c.temperatureC + c.decalageTempC + TPMS.CAPTEUR.bruitTemperatureC * TPMS.aleaNormal(v.alea);
  return TPMS.encoderTrame({
    numero: c.numero, adresse: c.adresse,
    pressionBar: p, temperatureC: Math.round(temp * 10) / 10,
    batteriePct: c.pilePct, alarme: p < TPMS.CAPTEUR.seuilSansPressionBar ? 0x01 : 0x00
  });
}

// Ce que fait le boîtier à chaque trame reçue (mêmes fonctions que le vrai).
function recevoirTrame(v, octets, tMs) {
  var d = TPMS.decoderTrame(octets);
  if (!d) return;
  var position = TPMS.positionCapteur(v.boitier.appairage, d.adresse);   // liste blanche
  if (!position) return;
  var roue = v.boitier.roues[position];
  var verdict = TPMS.verifierVraisemblance(roue.verification, roue.mesure, roue.dernierRecuMs, d, tMs, true);
  if (verdict === "hors-limites" || verdict === "suspecte") return false;
  roue.mesure = d;
  roue.dernierRecuMs = tMs;
  TPMS.historiqueAjouter(roue.historique, tMs, TPMS.pressionCompenseeBar(d.pressionBar, d.temperatureC));
  roue.penteBarH = TPMS.historiquePenteBarH(roue.historique);
  return true;
}

function boitier(f, v, t, dtS) {
  var S = TPMS.FLOTTE_SIM;
  var b = v.boitier;
  if (b.allume) {
    b.batteriePct -= S.batterieParJourPct * dtS / 86400;
    if (b.batteriePct <= 0) { b.batteriePct = 0; b.allume = false; }
  }
  if (!b.allume) return;

  var enMouvement = !!v.trajet;
  var etatChange = false;
  ["AV", "AR"].forEach(function (roue) {
    var c = v.capteurs[roue];
    var pRel = v.pneus[roue].pressionRelBar;
    // Le capteur annonce : souvent en roulant ; à l'arrêt, toutes les
    // 10 min environ, ou tout de suite si la pression change brusquement.
    // Après un changement brusque (crevaison, regonflage), le capteur
    // émet toutes les 3 s : on rejoue ces 3 trames dans le pas, ce qui
    // laisse au contrôle de vraisemblance ses 3 confirmations.
    var brusque = c.dernierePressionBar !== null && Math.abs(pRel - c.dernierePressionBar) > S.seuilChangementBar;
    var rafale = brusque || c.trameRefusee;
    if (enMouvement || rafale || t - c.derniereTrameMs >= S.periodeMesureMs) {
      var acceptee = false;
      for (var k = rafale ? 2 : 0; k >= 0; k--) {
        acceptee = recevoirTrame(v, trameCapteur(v, roue), t - k * 3000);
      }
      c.trameRefusee = !acceptee;
      c.derniereTrameMs = t;
      c.dernierePressionBar = pRel;
    }
    var r = b.roues[roue];
    var etat = TPMS.evaluerRoue(r, roue, f.seuils, t, b.reveilMs, enMouvement);
    if (etat !== r.etat) etatChange = true;
    r.etat = etat;
  });

  // Une mesure toutes les 10 min, et à chaque changement d'état (alerte)
  if (t >= b.prochaineMesureMs || etatChange) {
    var m = mesureBoitier(v, t);
    if (!b.derniereMesure || m.t > b.derniereMesure.t) {
      b.tampon.push(m);
      b.derniereMesure = m;
    }
    while (b.prochaineMesureMs <= t) b.prochaineMesureMs += S.periodeMesureMs;
  }
  // Envoi du lot
  if (t >= b.prochainEnvoiMs) {
    if (b.tampon.length > 0) {
      TPMS.registreAjouterLot(f.registre, v.id, b.tampon);
      if (f.garderLots) f.lotsSortants.push({ veloId: v.id, mesures: b.tampon });
      b.tampon = [];
    }
    while (b.prochainEnvoiMs <= t) b.prochainEnvoiMs += f.lotMs;
  }
}

function arrondir(x, n) {
  var k = Math.pow(10, n);
  return Math.round(x * k) / k;
}

// Mesure au format de l'API (flotte-logique.js, FLOTTE_CHAMPS).
function mesureBoitier(v, t) {
  var b = v.boitier;
  var m = { t: Math.round(t) };
  ["AV", "AR"].forEach(function (roue) {
    var r = b.roues[roue];
    var mes = r.mesure;
    m[TPMS.flotteChamp("p", roue)] = mes ? arrondir(mes.pressionBar, 3) : null;
    m[TPMS.flotteChamp("t", roue)] = mes ? arrondir(mes.temperatureC, 2) : null;
    m[TPMS.flotteChamp("pile", roue)] = mes ? mes.batteriePct : null;
  });
  m.batterie = Math.round(b.batteriePct);
  // RGPD (flotte-logique.js, flotteMinimiserPosition) : pendant une
  // location, la position est celle du client. Le boîtier ne l'envoie
  // pas : les champs lat et lon sont tout simplement absents du lot.
  if (!v.trajet) {
    m.lat = arrondir(v.lat, 5);
    m.lon = arrondir(v.lon, 5);
  }
  m.km = arrondir(b.km, 2);
  m.etatAv = b.roues.AV.etat;
  m.etatAr = b.roues.AR.etat;
  m.enLocation = !!v.trajet;
  return m;
}

// ---------------------------------------------------------------------
// Le technicien
// ---------------------------------------------------------------------
// Chaque matin il prend la liste de la supervision (mêmes résumés que la
// page), et passe voir les vélos à regonfler ou à réparer. Ce qu'il voit
// de ses yeux : un pneu à plat. Ce qu'il ne voit pas : une fuite lente.
// Il ne change la chambre que si la supervision l'a signalée.
function tournee(f, t, meteo) {
  var resumes = TPMS.registreVelos(f.registre, t).velos;
  resumes.forEach(function (r) {
    var v = f.parId[r.id];
    if (v.trajet) return;                         // en location : ce sera pour demain
    var bientot = r.prochainRegonflageMs !== null && r.prochainRegonflageMs - t < 1.5 * 86400000;
    var aVoir = r.statut === "immobilise" || r.statut === "urgent" || r.statut === "regonfler" ||
      r.statut === "muet" || bientot || (r.batterie !== null && r.batterie < TPMS.FLOTTE.batterieFaiblePct) ||
      v.pneus.AV.aPlat || v.pneus.AR.aPlat;
    if (!aVoir) return;

    var actions = [];
    ["AV", "AR"].forEach(function (roue) {
      var pneu = v.pneus[roue];
      var signalee = r[TPMS.flotteChamp("fuite", roue)];
      var visible = pneu.aPlat || pneu.orifices.some(function (o) { return o.type !== "micro"; });
      if (signalee || visible) {
        TPMS.pneuReparer(pneu);                  // chambre neuve (valve comprise)
        ajouterSuintement(v, roue);
        v.defauts = v.defauts.filter(function (d) { return d.roue !== roue; });
        actions.push("chambre " + roue + " changée" + (signalee && !visible ? " (fuite lente signalée)" : ""));
      }
      var nominal = TPMS.FLOTTE.nominalBar[roue];
      if (pneu.pressionRelBar < nominal * 0.97) {
        var avant = pneu.pressionRelBar;
        TPMS.pneuGonflerJusqua(pneu, nominal, v.altitudeM, meteo.temperatureC);
        actions.push(roue + " regonflé " + avant.toFixed(2).replace(".", ",") + " → " +
          pneu.pressionRelBar.toFixed(2).replace(".", ",") + " bar");
      }
    });
    if (!v.boitier.allume || v.boitier.batteriePct < 50) {
      v.boitier.batteriePct = 100;
      if (!v.boitier.allume) { v.boitier.allume = true; v.boitier.reveilMs = t; }
      actions.push("boîtier rechargé");
    }
    if (actions.length > 0) f.interventions.push({ t: t, veloId: v.id, actions: actions });
  });
}

// ---------------------------------------------------------------------
// Pour l'affichage
// ---------------------------------------------------------------------
// Vérité de la simulation (ce que le serveur ne sait pas) : défauts réels.
TPMS.flotteVerite = function (f, id) {
  var v = f.parId[id];
  if (!v) return null;
  return {
    defauts: v.defauts.slice(),
    pressionReelleBar: { AV: v.pneus.AV.pressionRelBar, AR: v.pneus.AR.pressionRelBar },
    trajet: v.trajet ? { depart: v.trajet.depart.nom, arrivee: v.trajet.arrivee.nom, finMs: v.trajet.finMs } : null
  };
};

// Récupère (et vide) les lots à envoyer au serveur.
TPMS.flotteLotsAEnvoyer = function (f) {
  var lots = f.lotsSortants;
  f.lotsSortants = [];
  return lots;
};
