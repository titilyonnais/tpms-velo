// =====================================================================
// moteur.js — Le monde simulé, pas à pas
// ---------------------------------------------------------------------
// Ce fichier assemble tous les modèles et les fait avancer ensemble :
//
//   météo, heure ──► cycliste ──► vélo (vitesse, roues, aimant)
//                                   │
//   pneus (gaz, chaleur, fuites) ◄──┘
//     │
//   capteurs TPMS (mesure, pile, annonces BLE)
//     │      vélos voisins, pirate
//     ▼          ▼
//   radio (distance, jante, collisions, brouillage)
//     │
//   boîtier (la logique du firmware : logique/ et boitier/)
//     │
//   électronique (courants, LiPo, chargeur) ──► batterie du boîtier
//
// Aucun dessin ici : la page (app.js) lit l'état du monde et l'affiche.
// Toutes les actions de l'utilisateur passent par mondeAction(), qui
// les note avec leur instant : une sortie peut ainsi être rejouée à
// l'identique (même graine + mêmes actions aux mêmes instants).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.PAS_ROULAGE_S = 0.05;     // pas de calcul quand il se passe des choses
TPMS.PAS_CALME_S = 1;          // vélo garé et boîtier en veille
TPMS.ENREG_ROULAGE_MS = 1000;  // un point d'enregistrement par seconde en roulant
TPMS.ENREG_CALME_MS = 60000;   // ... et par minute vélo garé

// Position des éléments sur le vélo, dans le repère du vélo
// (avant = +, haut = +), en mètres. Hypothèses d'un vélo de taille M.
TPMS.GEOMETRIE_VELO = {
  moyeuAV: { avant: 0.60, haut: 0.34 },
  moyeuAR: { avant: -0.42, haut: 0.34 },
  boitier: { avant: 0.45, haut: 1.00 },   // sur le cintre
  rayonValveM: 0.30                        // la valve est au bord de la jante
};

// ---------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------
// options = { graine, parcoursId, meteo (clé de TPMS.METEOS), heureDepartH,
//             jourDepart (0 = lundi), styleCycliste, chambre,
//             pressionAVBar, pressionARBar, volumePneuL, largeurPneuMm,
//             vehiculesVoisins (nombre de vélos équipés autour), planning,
//             masseCyclisteKg, capteursV2 (true = capteurs « version 2 »,
//             adresse changeante et trames signées, voir logique/trame2.js) }
TPMS.creerMonde = function (options) {
  var o = options;
  var graine = o.graine >>> 0;
  var parcours = TPMS.PARCOURS.filter(function (p) { return p.id === o.parcoursId; })[0] || TPMS.PARCOURS[0];
  var prep = TPMS.parcoursPreparer(parcours);
  var depart = TPMS.parcoursPoint(prep, 0);
  var meteoOptions = Object.assign({ graine: graine }, TPMS.METEOS[o.meteo] || TPMS.METEOS.printemps);
  var meteo = TPMS.creerMeteo(meteoOptions);
  var instant = TPMS.meteoInstant(meteo, o.heureDepartH);

  var m = {
    options: o,
    graine: graine,
    tMs: 0,
    heureDepartH: o.heureDepartH,
    parcours: parcours,
    prep: prep,
    origine: { lat: depart.lat, lon: depart.lon },
    meteo: meteo,
    instant: instant,
    point: depart,
    velo: TPMS.creerVelo({ type: veloSelonParcours(parcours.type), graine: graine, masseCyclisteKg: o.masseCyclisteKg }),
    cycliste: TPMS.creerCycliste({ style: o.styleCycliste || styleSelonParcours(parcours.type), graine: graine }),
    enSortie: false,                // false = vélo garé (entre deux sorties)
    departSortieM: 0,
    pneus: {},
    capteurs: {},
    voisins: [],
    pirate: TPMS.creerPirate(),
    pirateMonde: { distanceM: 8, cote: 1, puissanceDbm: 4, brouillage: false, suit: true, positionFixeM: 0 },
    canal: TPMS.creerCanalRadio({ environnement: parcours.environnementRadio, graine: graine }),
    boitier: TPMS.creerBoitier(),
    lipo: TPMS.creerLipo({ capaciteMAh: 500, etatCharge: 1, graine: graine }),
    vbusV: 0,                       // 5 V quand le câble magnétique est branché
    boutons: { 1: false, 2: false },
    electronique: null,             // dernier résultat de circuitResoudre
    ecranOccupeJusquaMs: 0,
    ecranMode: "repos",
    bipJusquaMs: 0,
    bipDebutMs: 0,
    ledAlerte: "eteinte",
    reed: { ferme: false, fermeDepuisMs: -1, pullup: true },
    boitierMort: false,
    prochaineMajMs: 0,
    prochainEnregMs: 0,
    sorties: { refresh: [], bips: 0 },
    stats: { radio: {}, emissions: 0, recues: 0 },
    trafic: [],                     // dernières trames (pour l'affichage)
    enregistrement: [],
    actions: [],                    // journal des actions (pour le rejeu)
    actionsAJouer: [],              // actions d'un rejeu, en attente
    planning: [],                   // sorties programmées (semaine type)
    reseauMouchards: TPMS.creerReseauMouchards(graine),   // espions Bluetooth en ville
    rafraichissementsEcran: [],     // événements pour la page
    bipsAJouer: 0
  };

  // Pneus et capteurs
  ["AV", "AR"].forEach(function (pos, i) {
    m.pneus[pos] = TPMS.creerPneu({
      nom: pos,
      volumeL: o.volumePneuL || volumeSelonParcours(parcours.type),
      pressionRelBar: pos === "AV" ? o.pressionAVBar : o.pressionARBar,
      temperatureC: instant.temperatureC,
      altitudeM: depart.altitudeM,
      chambre: o.chambre || "butyle",
      largeurMm: o.largeurPneuMm || m.velo.largeurPneuMm,
      graine: graine + i
    });
    m.capteurs[pos] = TPMS.creerCapteurTPMS({
      numero: i + 1,
      adresse: TPMS.adresseDepuisTexte(m.boitier.reglages.appairage[pos]),
      graine: graine + 10 + i,
      // Plage de mesure des capteurs : inconnue tant qu'ils ne sont pas
      // reçus (la fiche AliExpress ne la donne pas) ; 3,5 bar par défaut.
      plageMaxBar: o.plageCapteurBar || 3.5
    });
  });

  // Capteurs v2 : une clé secrète de 16 octets par capteur, partagée avec
  // le boîtier à l'appairage (QR code dans la boîte, par exemple).
  if (o.capteursV2) {
    var aleaCles = TPMS.creerAleaNomme(graine, "cles");
    var cles = {};
    ["AV", "AR"].forEach(function (pos) {
      var cle = new Uint8Array(16);
      for (var q = 0; q < 16; q++) cle[q] = Math.floor(aleaCles() * 256);
      cles[pos] = cle;
      m.capteurs[pos].cleV2 = cle;
    });
    m.boitier.reglages.clesV2 = cles;
  }

  // Vélos voisins équipés de capteurs TPMS (ils croisent notre route)
  var aleaVoisins = TPMS.creerAleaNomme(graine, "voisins");
  for (var k = 0; k < (o.vehiculesVoisins || 0); k++) {
    m.voisins.push({
      id: "voisin" + (k + 1),
      decalageM: TPMS.aleaEntre(aleaVoisins, 20, 400),
      vitesseMs: TPMS.aleaEntre(aleaVoisins, 3, 8),
      sens: aleaVoisins() < 0.5 ? -1 : 1,
      lateralM: TPMS.aleaEntre(aleaVoisins, 1.5, 6),
      capteur: TPMS.creerCapteurTPMS({
        numero: 1,
        adresse: [0xEA, 0xCA, 0x52, Math.floor(aleaVoisins() * 256), Math.floor(aleaVoisins() * 256)],
        graine: graine + 100 + k
      }),
      pneu: TPMS.creerPneu({ nom: "voisin", volumeL: 2.2, pressionRelBar: TPMS.aleaEntre(aleaVoisins, 1.8, 3), temperatureC: instant.temperatureC, altitudeM: depart.altitudeM, chambre: "butyle", largeurMm: 40, graine: graine + 200 + k })
    });
  }

  // Le cycliste a bien réglé son boîtier : circonférence mesurée de SA
  // roue avant (pneu gonflé, vélo chargé). On peut ensuite la dérégler
  // dans la configuration pour voir l'erreur de vitesse et de distance.
  var chargeAV = (m.velo.masseCyclisteKg + m.velo.masseVeloKg) * TPMS.G_MS2 * m.velo.repartitionAV;
  var circonference = Math.round(2 * Math.PI * TPMS.veloRayonRoulementM(m.velo, o.pressionAVBar, chargeAV) * 1000);
  m.boitier.reglages.circonferenceMm = circonference;
  m.boitier.compteur.circonferenceMm = circonference;
  // Seuils d'alerte réglés autour des pressions de gonflage choisies :
  // alerte sous 80 % et au-dessus de 125 % (à 0,1 bar près).
  ["AV", "AR"].forEach(function (pos) {
    var p = pos === "AV" ? o.pressionAVBar : o.pressionARBar;
    m.boitier.reglages.seuils[pos].basBar = Math.round(p * 0.8 * 10) / 10;
    m.boitier.reglages.seuils[pos].hautBar = Math.round(p * 1.25 * 10) / 10;
  });

  m.planning = TPMS.genererPlanning(o);
  m.boitier.dernierMouvementMs = 0;
  return m;
};

function veloSelonParcours(type) { return type === "route" ? "route" : (type === "vtt" ? "vtt" : "ville"); }
function styleSelonParcours(type) { return type === "route" ? "sportif" : (type === "vtt" ? "vtt" : (type === "trajet" ? "trajet" : "tranquille")); }
function volumeSelonParcours(type) { return type === "route" ? 0.9 : (type === "vtt" ? 3.2 : 2.0); }

// Heure du jour (en heures, 0 à 24) et numéro du jour.
TPMS.mondeHeure = function (m) {
  var h = m.heureDepartH + m.tMs / 3600000;
  return { jour: Math.floor(h / 24), heure: h % 24 };
};

// ---------------------------------------------------------------------
// Actions de l'utilisateur (notées pour le rejeu)
// ---------------------------------------------------------------------
TPMS.mondeAction = function (m, action) {
  m.actions.push({ tMs: m.tMs, action: JSON.parse(JSON.stringify(action)) });
  appliquerAction(m, action);
};

function appliquerAction(m, a) {
  var b = m.boitier;
  switch (a.type) {
    case "partir":         // le cycliste part (ou repart) sur le parcours
      m.enSortie = true;
      if (a.depuisDebut) m.velo.distanceM = 0;
      m.departSortieM = m.velo.distanceM;
      m.cycliste.etat = "roule";
      break;
    case "garer":
      m.enSortie = false;
      break;
    case "sortie":         // sortie programmée : on prend le vélo sur un autre parcours
      changerParcours(m, a.parcoursId);
      m.enSortie = true;
      m.velo.distanceM = 0;
      m.departSortieM = 0;
      m.cycliste.etat = "roule";
      break;
    case "percer": TPMS.pneuPercer(m.pneus[a.roue], { diametreMm: a.diametreMm, type: a.forme }); break;
    case "fuite": TPMS.pneuFuiteLente(m.pneus[a.roue], a.diametreMm); break;
    case "reparer": TPMS.pneuReparer(m.pneus[a.roue]); break;
    case "gonfler":
      TPMS.pneuGonflerJusqua(m.pneus[a.roue], a.pressionBar, m.point.altitudeM, m.instant.temperatureC);
      break;
    case "capteur": a.present ? TPMS.capteurTPMSRemettre(m.capteurs[a.roue]) : TPMS.capteurTPMSRetirer(m.capteurs[a.roue]); break;
    case "bouton":
      TPMS.boitierBouton(b, a.numero, a.long, m.tMs);
      appliquerSorties(m, TPMS.boitierMiseAJour(b, m.tMs));
      break;
    case "recharge": m.vbusV = a.branche ? 5 : 0; break;
    case "reglage": appliquerReglage(b, a.cle, a.valeur); break;
    case "protection": b.reglages.protections[a.cle] = a.valeur; break;
    case "mitm":   // attaque de l'appairage (démonstration)
      m.aleaMitm = m.aleaMitm || TPMS.creerAleaNomme(m.graine, "mitm");
      m.dernierMitm = TPMS.liaisonAttaqueHommeDuMilieu(b, a.mode, m.tMs, function () {
        return String(Math.floor(m.aleaMitm() * 1000000)).padStart(6, "0");
      });
      break;
    case "pirate":
      Object.assign(m.pirate, a.pirate || {});
      Object.assign(m.pirateMonde, a.monde || {});
      if (a.enregistrer) { m.pirate.enregistrement = []; m.pirate.indexRejeu = 0; m.pirate.enregistre = true; }
      break;
  }
}

function appliquerReglage(b, cle, valeur) {
  if (cle === "circonferenceMm") { b.reglages.circonferenceMm = valeur; b.compteur.circonferenceMm = valeur; }
  else if (cle === "ecoute") { b.reglages.ecouteFenetreMs = valeur[0]; b.reglages.ecoutePeriodeMs = valeur[1]; }
  else if (cle === "seuil") { b.reglages.seuils[valeur.roue][valeur.borne] = valeur.bar; }
  else b.reglages[cle] = valeur;
}

// ---------------------------------------------------------------------
// Planning : une semaine type, répétée
// ---------------------------------------------------------------------
// Le jour 0 est un lundi. Du lundi au vendredi : trajet domicile-travail
// le matin et le soir. Samedi et dimanche : une sortie sur le parcours
// choisi. Dimanche soir : boîtier mis en charge 3 h. Le planning est
// calculé à partir des options : un rejeu le refait à l'identique.
TPMS.JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
TPMS.genererPlanning = function (o) {
  if (o.planning !== "semaine") return [];
  var loisir = o.parcoursId === "domicile-travail" ? "lyon-ville" : o.parcoursId;
  var semaines = o.semaines || 4;
  var evenements = [];
  function ajouter(jour, heure, action, libelle) {
    var tMs = Math.round(((jour * 24 + heure) - o.heureDepartH) * 3600000);
    if (tMs >= 0) evenements.push({ tMs: tMs, action: action, libelle: libelle });
  }
  for (var s = 0; s < semaines; s++) {
    for (var j = 0; j < 7; j++) {
      var jour = s * 7 + j;
      if (j < 5) {
        ajouter(jour, 7.75, { type: "sortie", parcoursId: "domicile-travail" }, "Trajet vers le travail");
        ajouter(jour, 17.5, { type: "sortie", parcoursId: "domicile-travail" }, "Retour du travail");
      } else {
        ajouter(jour, j === 5 ? 10 : 9.5, { type: "sortie", parcoursId: loisir }, "Sortie du week-end");
      }
      if (j === 6) {
        ajouter(jour, 20, { type: "recharge", branche: true }, "Boîtier mis en charge");
        ajouter(jour, 23, { type: "recharge", branche: false }, "Chargeur débranché");
      }
    }
  }
  evenements.sort(function (a, b) { return a.tMs - b.tMs; });
  return evenements;
};

// Prochain événement du planning (pour l'affichage).
TPMS.mondeProchainEvenement = function (m) {
  return m.planning.length > 0 ? m.planning[0] : null;
};

function changerParcours(m, parcoursId) {
  if (m.parcours.id === parcoursId) return;
  var p = TPMS.parcoursParId(parcoursId);
  m.parcours = p;
  m.prep = TPMS.parcoursPreparer(p, m.graine);
  var depart = TPMS.parcoursPoint(m.prep, 0);
  m.origine = { lat: depart.lat, lon: depart.lon };
  m.point = depart;
  m.canal = TPMS.creerCanalRadio({ environnement: p.environnementRadio, graine: m.graine });
}

// Rejeu : on recrée le monde avec les mêmes options et on reprogramme
// les actions enregistrées à leurs instants.
TPMS.mondeRejeu = function (ancien) {
  var m = TPMS.creerMonde(ancien.options);
  m.actionsAJouer = ancien.actions.slice();
  return m;
};

// ---------------------------------------------------------------------
// Géométrie : du GPS au repère local en mètres
// ---------------------------------------------------------------------
TPMS.mondeVersMetres = function (m, lat, lon) {
  var cosLat = Math.cos(m.origine.lat * Math.PI / 180);
  return {
    x: (lon - m.origine.lon) * 111320 * cosLat,
    y: (lat - m.origine.lat) * 110540
  };
};

// Position d'un point du vélo (repère du vélo → monde).
function pointDuVelo(base, capDeg, avant, lateral, haut) {
  var cap = capDeg * Math.PI / 180;           // 0 = nord, sens horaire
  var ax = Math.sin(cap), ay = Math.cos(cap); // vecteur « avant »
  return { x: base.x + ax * avant + ay * lateral, y: base.y + ay * avant - ax * lateral, z: haut };
}

// Position de la valve d'une roue : elle tourne avec la roue.
function positionValve(base, capDeg, moyeu, angleDeg) {
  var a = angleDeg * Math.PI / 180;
  var r = TPMS.GEOMETRIE_VELO.rayonValveM;
  return pointDuVelo(base, capDeg, moyeu.avant + r * Math.sin(a), 0.05, moyeu.haut + r * Math.cos(a));
}

// Masquage par la jante : la valve est-elle du côté du boîtier ?
// Angle 0 = valve en haut (près du boîtier), 180 = en bas, derrière la jante.
function perteJante(angleDeg, estAvant) {
  var a = ((angleDeg % 360) + 360) % 360;
  // Pour la roue arrière, le boîtier est devant : la valve « voit » le
  // boîtier quand elle est en haut et vers l'avant.
  var vue = estAvant ? a : (a + 45) % 360;
  return TPMS.radioPerteJanteDb(vue);
}

// ---------------------------------------------------------------------
// Avancer
// ---------------------------------------------------------------------
// Fait avancer le monde de dureeMs millisecondes, par petits pas.
// Les pas ont toujours la même taille, quelle que soit la façon dont on
// découpe le temps demandé (images de la page, vitesse ×1 ou ×3600) : le
// reste est gardé pour la fois suivante (m.tempsEnAttenteMs). C'est ce qui
// rend le rejeu exact : mêmes pas, mêmes calculs, mêmes résultats.
TPMS.mondeAvancer = function (m, dureeMs) {
  m.tempsEnAttenteMs = (m.tempsEnAttenteMs || 0) + dureeMs;
  var garde = 0;
  while (garde++ < 400000) {
    // Actions d'un rejeu : appliquées à l'instant exact où elles avaient été faites.
    while (m.actionsAJouer.length > 0 && m.actionsAJouer[0].tMs <= m.tMs + 1e-6) {
      var act = m.actionsAJouer.shift();
      m.actions.push(act);
      appliquerAction(m, act.action);
    }
    // Planning : pas noté dans les actions (il est recalculé au rejeu).
    while (m.planning.length > 0 && m.planning[0].tMs <= m.tMs + 1e-6) {
      var ev = m.planning.shift();
      appliquerAction(m, ev.action);
      TPMS.boitierJournal(m.boitier, m.tMs, "Planning : " + ev.libelle.toLowerCase());
    }
    var calme = !m.enSortie && m.boitier.veille && m.velo.vitesseMs < 0.05;
    // Le choix du pas ne dépend que de l'état du monde : un rejeu refait
    // exactement les mêmes pas, et chaque action retombe pile sur un pas.
    var pasMs = (calme ? TPMS.PAS_CALME_S : TPMS.PAS_ROULAGE_S) * 1000;
    if (m.tempsEnAttenteMs < pasMs) break;
    m.tempsEnAttenteMs -= pasMs;
    unPas(m, pasMs / 1000);
  }
};

function unPas(m, dtS) {
  var t0 = m.tMs;
  var t = t0 + dtS * 1000;
  var b = m.boitier;

  // 1. Heure, météo, position sur le parcours
  var h = TPMS.mondeHeure(m);
  m.instant = TPMS.meteoInstant(m.meteo, h.heure);
  m.point = TPMS.parcoursPoint(m.prep, m.velo.distanceM);
  var pneuAPlat = m.pneus.AV.aPlat || m.pneus.AR.aPlat;
  m.point.pneuAPlat = pneuAPlat;
  // Fin de la sortie : au bout du parcours, ou après le nombre de tours
  // prévu sur une boucle (1 par défaut).
  var toursPrevus = m.options.tours || 1;
  if (m.enSortie && ((m.point.fini && !m.parcours.boucle) || m.cycliste.etat === "fini" ||
      (m.parcours.boucle && m.velo.distanceM - m.departSortieM >= toursPrevus * m.prep.longueurM))) {
    m.enSortie = false;
    m.cycliste.etat = "fini";
  }

  // 2. Cycliste et vélo
  var commande = m.enSortie
    ? TPMS.cyclisteCommande(m.cycliste, m.velo, m.point, t0 / 1000, dtS)
    : { puissanceW: 0, freinage: m.velo.vitesseMs > 0 ? 1 : 0 };
  m.commande = commande;
  var ventFace = m.instant.ventMs * Math.cos((m.instant.ventDirDeg - m.point.capDeg) * Math.PI / 180);
  // Vélo garé et arrêté : il est sur sa béquille, il ne bouge plus (sans
  // cela, garé dans une pente, il repartait seul et réveillait le boîtier
  // toutes les heures — défaut révélé par la simulation d'une semaine).
  var surBequille = !m.enSortie && m.velo.vitesseMs < 0.05;
  if (surBequille) { m.velo.vitesseMs = 0; m.velo.topsAimant = []; }
  else TPMS.veloAvancer(m.velo, dtS, {
    puissanceW: commande.puissanceW,
    freinage: commande.freinage,
    penteRad: m.point.penteRad,
    ventFaceMs: ventFace,
    revetement: m.point.revetement,
    pressionAVBar: m.pneus.AV.pressionRelBar,
    pressionARBar: m.pneus.AR.pressionRelBar,
    densiteAir: 1.225 * TPMS.pressionAtmospheriquePa(m.point.altitudeM) / TPMS.P_ATM_MER_PA
  });

  // 3. Pneus
  var ctxPneu = {
    temperatureAmbianteC: m.instant.temperatureC,
    ensoleillement: m.instant.ensoleillement,
    vitesseMs: m.velo.vitesseMs,
    altitudeM: m.point.altitudeM,
    // Un frein ne chauffe la jante que s'il dissipe de l'énergie : la
    // puissance de freinage vaut force × vitesse. À l'arrêt, freins
    // serrés, rien ne chauffe. Pleine chauffe à partir de 8 m/s (hypothèse).
    freinage: commande.freinage * Math.min(1, m.velo.vitesseMs / 8),
    pluie: m.instant.pluie
  };
  // L'air d'un pneu évolue lentement (minutes) : un calcul toutes les
  // 0,25 s suffit, sauf s'il est troué (il peut se vider en secondes).
  ["AV", "AR"].forEach(function (pos) {
    var pneu = m.pneus[pos];
    pneu.attenteS = (pneu.attenteS || 0) + dtS;
    if (pneu.orifices.length === 0 && pneu.attenteS < 0.25) return;
    TPMS.pneuAvancer(pneu, pneu.attenteS, ctxPneu);
    pneu.attenteS = 0;
  });

  // 4. Aimant de roue → reed → boîtier
  var reedFerme = Math.abs(((m.velo.angleRoueAVDeg + 180) % 360) - 180) < 4;
  m.velo.topsAimant.forEach(function (offsetS) {
    if (!m.boitierMort) TPMS.boitierTopRoue(b, Math.round(t0 + offsetS * 1000));
  });
  if (m.velo.topsAimant.length > 0) reedFerme = true;
  gererReed(m, reedFerme, t);

  // 5. Émissions radio de ce pas
  var base = TPMS.mondeVersMetres(m, m.point.lat, m.point.lon);
  var cap = m.point.capDeg;
  var g = TPMS.GEOMETRIE_VELO;
  var emissions = [];
  var positionsCapteurs = {};
  var ctxCapteur = {
    altitudeM: m.point.altitudeM,
    vitesseMs: m.velo.vitesseMs,
    temperatureAmbianteC: m.instant.temperatureC,
    ensoleillement: m.instant.ensoleillement
  };
  ["AV", "AR"].forEach(function (pos) {
    var angle = pos === "AV" ? m.velo.angleRoueAVDeg : m.velo.angleRoueARDeg;
    var annonces = TPMS.capteurTPMSAvancer(m.capteurs[pos], t, dtS, m.pneus[pos], ctxCapteur);
    positionsCapteurs[pos] = positionValve(base, cap, pos === "AV" ? g.moyeuAV : g.moyeuAR, angle);
    annonces.forEach(function (a) {
      emissions.push({
        id: pos + "@" + a.tMs, source: pos, tMs: a.tMs, octets: a.octets, type: "annonce",
        emetteur: { id: "capteur" + pos, position: positionValve(base, cap, pos === "AV" ? g.moyeuAV : g.moyeuAR, angle), puissanceDbm: 0, gainAntenneDbi: -2 },
        extraPerteDb: perteJante(angle, pos === "AV")
      });
    });
  });
  // Les espions postés en ville écoutent nos deux capteurs.
  var nosAnnonces = [];
  emissions.forEach(function (e) {
    nosAnnonces.push({ tMs: e.tMs, octets: e.octets, position: e.emetteur.position, extraPerteDb: e.extraPerteDb });
  });
  TPMS.mouchardsEcouter(m.reseauMouchards, nosAnnonces, function (lat, lon) { return TPMS.mondeVersMetres(m, lat, lon); }, m.canal);

  m.voisins.forEach(function (v) {
    v.decalageM += v.sens * v.vitesseMs * dtS;
    // Un flux de cyclistes : celui qui s'est éloigné de plus de 300 m est
    // remplacé par un autre qui arrive de l'autre côté.
    if (Math.abs(v.decalageM) > 300) v.decalageM = -Math.sign(v.decalageM) * 290;
    // Loin du boîtier, inutile de le calculer finement : une mise à jour
    // par seconde suffit (ses annonces ne peuvent de toute façon pas arriver).
    v.attenteS = (v.attenteS || 0) + dtS;
    if (Math.abs(v.decalageM) > 150 && v.attenteS < 1) return;
    var dtVoisinS = v.attenteS;
    v.attenteS = 0;
    var d = m.velo.distanceM + v.decalageM;
    var p = TPMS.parcoursPoint(m.prep, Math.max(0, d));
    var pos = TPMS.mondeVersMetres(m, p.lat, p.lon);
    TPMS.pneuAvancer(v.pneu, dtVoisinS, ctxPneu);
    var annonces = TPMS.capteurTPMSAvancer(v.capteur, t, dtVoisinS, v.pneu, { altitudeM: p.altitudeM, vitesseMs: v.vitesseMs, temperatureAmbianteC: m.instant.temperatureC, ensoleillement: m.instant.ensoleillement });
    // Au-delà de 150 m, ses annonces n'ont aucune chance d'arriver : on ne
    // les passe pas à la radio (gain de calcul, tableau de trafic lisible).
    if (Math.abs(v.decalageM) > 150) return;
    annonces.forEach(function (a) {
      emissions.push({
        id: v.id + "@" + a.tMs, source: "voisin", tMs: a.tMs, octets: a.octets, type: "annonce",
        emetteur: { id: v.id, position: { x: pos.x + v.lateralM, y: pos.y, z: 0.4 }, puissanceDbm: 0, gainAntenneDbi: -2 },
        extraPerteDb: 6   // corps et vélo du voisin entre les deux (hypothèse)
      });
    });
  });
  emissionsPirate(m, t, dtS, base, cap, emissions);

  // 6. Radio : que reçoit le boîtier ?
  var noeudBoitier = { id: "boitier", position: pointDuVelo(base, cap, g.boitier.avant, 0, g.boitier.haut), puissanceDbm: 0, gainAntenneDbi: 0 };
  m.positions = { base: base, cap: cap, boitier: noeudBoitier.position, capteurs: positionsCapteurs };
  if (emissions.length > 0) {
    var recepteur = {
      node: noeudBoitier,
      ecoute: function (tMs) { return !m.boitierMort && TPMS.boitierEcoute(b, tMs); },
      scanIntervalMs: 100,
      sensibiliteDbm: -95
    };
    emissions.sort(function (a, c) { return a.tMs - c.tMs; });
    // Boîtier endormi ou éteint : sa radio est coupée, inutile de calculer
    // la propagation (gros gain de calcul vélo garé).
    var radioCoupee = m.boitierMort || b.veille;
    var resultats = radioCoupee
      ? emissions.map(function (e) { return { id: e.id, recu: false, rssiDbm: null, canalBle: null, raison: "hors-ecoute" }; })
      : TPMS.radioResoudre(m.canal, emissions, recepteur);
    for (var i = 0; i < emissions.length; i++) {
      var e = emissions[i], r = resultats[i];
      if (e.type !== "annonce") continue;
      m.stats.emissions++;
      m.stats.radio[r.raison] = (m.stats.radio[r.raison] || 0) + 1;
      var verdict = r.raison;
      if (r.recu) {
        m.stats.recues++;
        // Le boîtier traite la trame quand son paquet a fini d'arriver.
        verdict = TPMS.boitierRecevoirTrame(b, e.octets, Math.round(r.tRecuMs || e.tMs));
      }
      noterTrafic(m, e, r, verdict);
    }
  }

  // 7. Boîtier : mise à jour une fois par seconde
  while (m.prochaineMajMs <= t) {
    if (!m.boitierMort) appliquerSorties(m, TPMS.boitierMiseAJour(b, m.prochaineMajMs));
    m.prochaineMajMs += 1000;
  }

  // 8. Électronique et batterie
  electronique(m, t, dtS);

  // 9. Enregistrement
  m.tMs = t;
  if (t >= m.prochainEnregMs) {
    enregistrer(m);
    m.prochainEnregMs = t + (m.enSortie || m.velo.vitesseMs > 0.1 ? TPMS.ENREG_ROULAGE_MS : TPMS.ENREG_CALME_MS);
  }
}

// Le pirate : il suit le cycliste (sur un autre vélo, en voiture) ou
// attend à un endroit du parcours. Il usurpe, rejoue ou brouille.
function emissionsPirate(m, t, dtS, base, cap, emissions) {
  var p = m.pirate, pm = m.pirateMonde;
  var pos;
  if (pm.suit) {
    pos = pointDuVelo(base, cap, -pm.distanceM, 2 * pm.cote, 1.0);
  } else {
    var pp = TPMS.parcoursPoint(m.prep, pm.positionFixeM);
    var xy = TPMS.mondeVersMetres(m, pp.lat, pp.lon);
    pos = { x: xy.x + 5, y: xy.y, z: 1.0 };
  }
  m.positionPirate = pos;
  var noeud = { id: "pirate", position: pos, puissanceDbm: pm.puissanceDbm, gainAntenneDbi: 2 };
  if (pm.brouillage && p.actif) {
    emissions.push({ id: "brouillage@" + t, source: "pirate", tMs: t - dtS * 500, octets: new Uint8Array(0), type: "brouillage", emetteur: noeud, extraPerteDb: 0 });
  }
  if (!p.actif || pm.brouillage) { p.prochaineEmissionMs = t; return; }
  var identite = {
    numero: m.capteurs[p.cible].numero || (p.cible === "AV" ? 1 : 2),
    adresse: TPMS.adresseDepuisTexte(m.boitier.reglages.appairage[p.cible]),
    temperatureC: m.capteurs[p.cible].temperatureCapteurC || m.instant.temperatureC,
    batteriePct: 90
  };

  // Pirate SYNCHRONISÉ (pire cas) : il a appris le rythme du capteur et
  // émet exactement en même temps que lui, plus fort. Par effet de
  // capture, le boîtier ne reçoit que la trame du pirate : le rythme
  // paraît normal et la vraie trame ne passe jamais.
  if (p.attaque === "synchro") {
    var visees = emissions.filter(function (e) { return e.source === p.cible && e.type === "annonce"; });
    visees.forEach(function (e) {
      var fausse = TPMS.pirateTrame(p, identite);
      if (fausse) emissions.push({ id: "pirate@" + e.tMs, source: "pirate", tMs: e.tMs + 0.01, octets: fausse, type: "annonce", emetteur: noeud, extraPerteDb: 0 });
    });
    p.prochaineEmissionMs = t;
    return;
  }

  // INONDATION : des centaines d'annonces par seconde, avec des adresses
  // tirées au hasard. Elles occupent la radio (collisions) et obligent le
  // boîtier à les examiner une à une.
  if (p.attaque === "inondation") {
    pm.alea = pm.alea || TPMS.creerAleaNomme(m.graine, "inondation");
    var nb = Math.round(TPMS.PIRATE_INONDATION_PAR_S * dtS);
    for (var q = 0; q < nb; q++) {
      var adresse = [];
      for (var k = 0; k < 5; k++) adresse.push(Math.floor(pm.alea() * 256));
      var tI = t - dtS * 1000 + (q + pm.alea()) * dtS * 1000 / nb;
      emissions.push({
        id: "inondation@" + tI, source: "pirate", tMs: tI, type: "annonce", emetteur: noeud, extraPerteDb: 0,
        octets: TPMS.encoderTrame({ numero: 1 + Math.floor(pm.alea() * 2), adresse: adresse, pressionBar: 0.5 + 3 * pm.alea(), temperatureC: 20, batteriePct: 90, alarme: 0 })
      });
    }
    p.prochaineEmissionMs = t;
    return;
  }

  while (p.prochaineEmissionMs <= t) {
    var tE = p.prochaineEmissionMs;
    p.prochaineEmissionMs += p.intervalleMs;
    var octets = TPMS.pirateTrame(p, identite);
    if (octets === null) continue;
    emissions.push({ id: "pirate@" + tE, source: "pirate", tMs: tE, octets: octets, type: "annonce", emetteur: noeud, extraPerteDb: 0 });
  }
}

function noterTrafic(m, e, r, verdict) {
  // Le pirate enregistre ce qu'il entend de sa cible.
  if (e.source === m.pirate.cible) TPMS.pirateEcouter(m.pirate, e.source, e.octets);
  var dec = TPMS.decoderTrame(e.octets) || TPMS.decoderTrameV2(e.octets);
  m.trafic.unshift({
    tMs: e.tMs, source: e.source, octets: e.octets,
    pressionBar: dec ? dec.pressionBar : null,
    rssiDbm: r.rssiDbm, canalBle: r.canalBle, raison: r.raison, verdict: verdict
  });
  if (m.trafic.length > 60) m.trafic.length = 60;
}

// Reed : fermé quand l'aimant est devant. Parade du firmware : fermé
// plus de 3 s → on coupe le pull-up (sinon 0,25 mA perdus en continu).
function gererReed(m, ferme, t) {
  var r = m.reed;
  if (ferme && !r.ferme) r.fermeDepuisMs = t;
  r.ferme = ferme;
  r.pullup = !(ferme && t - r.fermeDepuisMs > 3000);
}

function appliquerSorties(m, s) {
  var t = m.prochaineMajMs;
  if (s.rafraichissement !== "aucun") {
    m.ecranMode = s.rafraichissement;
    m.ecranOccupeJusquaMs = Math.max(m.tMs, t) + (s.rafraichissement === "complet" ? 2000 : 500);
    m.rafraichissementsEcran.push(s.rafraichissement);
  }
  if (s.bip) {
    m.bipDebutMs = m.tMs;
    m.bipJusquaMs = m.tMs + 3 * 250;
    m.bipsAJouer++;
  }
  m.ledAlerte = s.ledAlerte;
  m.ledsEclairage = s.ledsEclairage;
}

// L'électronique consomme ; la LiPo se vide ou se recharge.
function electronique(m, t, dtS) {
  var b = m.boitier;
  var phaseBip = t - m.bipDebutMs;
  var entrees = {
    veille: b.veille || m.boitierMort,
    cpuActif: !b.veille && !m.boitierMort,
    radioReception: !m.boitierMort && TPMS.boitierEcoute(b, t),
    radioEmission: !m.boitierMort && b.liaison.connecte,
    ecran: m.boitierMort ? "repos" : (t < m.ecranOccupeJusquaMs ? m.ecranMode : "repos"),
    ledAlerte: !m.boitierMort && (m.ledAlerte === "fixe" || (m.ledAlerte === "clignote" && (t % 1000) < 500)),
    eclairage: !m.boitierMort && b.eclairage && !b.veille,
    buzzer: !m.boitierMort && t < m.bipJusquaMs && (phaseBip % 250) < 120,
    reedFerme: m.reed.ferme,
    reedPullupActif: m.reed.pullup,
    bouton1: m.boutons[1],
    bouton2: m.boutons[2],
    vbusV: m.vbusV,
    appConnectee: b.liaison.connecte
  };
  // Le circuit ne change que si une entrée change (fenêtre radio, écran,
  // LED...) ou si la tension de la batterie bouge d'au moins 1 mV : sinon
  // on garde le résultat précédent (gros gain de calcul).
  var cle = entrees.veille + "|" + entrees.radioReception + "|" + entrees.radioEmission + "|" + entrees.ecran + "|" +
    entrees.ledAlerte + "|" + entrees.eclairage + "|" + entrees.buzzer + "|" + entrees.reedFerme + "|" +
    entrees.reedPullupActif + "|" + entrees.bouton1 + "|" + entrees.bouton2 + "|" + entrees.vbusV + "|" +
    m.lipo.coupee + "|" + Math.round(m.lipo.tensionV * 1000);
  var e = m.cleCircuit === cle ? m.electronique : TPMS.circuitResoudre(entrees, m.lipo);
  m.cleCircuit = cle;
  m.electronique = e;
  TPMS.lipoAvancer(m.lipo, dtS, e.courantBatterieA, m.instant.temperatureC);

  // Le boîtier ne connaît sa batterie que par la tension qu'il mesure
  // (une mesure par seconde, comme le firmware).
  if (!(t < m.prochaineJaugeMs)) {
    b.batteriePct = pourcentageDepuisTension(m.lipo.tensionV, m.instant.temperatureC);
    m.prochaineJaugeMs = t + 1000;
  }
  b.enCharge = m.vbusV > 0 && m.lipo.etatCharge < 0.995;

  // Batterie coupée par sa protection : le boîtier s'éteint. L'e-paper
  // garde sa dernière image (il n'a pas besoin de courant pour ça).
  var mort = m.lipo.coupee && m.vbusV === 0;
  if (mort && !m.boitierMort) TPMS.boitierJournal(b, t, "Batterie vide : boîtier éteint");
  if (!mort && m.boitierMort) TPMS.boitierJournal(b, t, "Alimentation revenue : redémarrage");
  m.boitierMort = mort;
}

// Jauge du boîtier : on retrouve l'état de charge qui donne cette
// tension à vide (recherche par dichotomie dans la courbe de la LiPo).
// La tension mesurée sous charge est un peu plus basse : la jauge sous-estime
// légèrement pendant les gros appels de courant, comme sur un vrai appareil.
function pourcentageDepuisTension(tensionV, temperatureC) {
  var bas = 0, haut = 1;
  for (var i = 0; i < 20; i++) {
    var milieu = (bas + haut) / 2;
    if (TPMS.lipoTensionVideV(milieu, temperatureC) < tensionV) bas = milieu; else haut = milieu;
  }
  return Math.round(((bas + haut) / 2) * 100);
}

function enregistrer(m) {
  var b = m.boitier;
  var h = TPMS.mondeHeure(m);
  var roueAV = b.roues.AV, roueAR = b.roues.AR;
  m.enregistrement.push({
    tMs: m.tMs,
    jour: h.jour,
    heure: h.heure,
    lat: m.point.lat, lon: m.point.lon, altitudeM: m.point.altitudeM,
    vitesseKmh: m.velo.vitesseMs * 3.6,
    distanceKm: m.velo.distanceM / 1000,
    temperatureC: m.instant.temperatureC,
    pAV: m.pneus.AV.pressionRelBar, pAR: m.pneus.AR.pressionRelBar,
    tAirAV: m.pneus.AV.temperatureAirC, tAirAR: m.pneus.AR.temperatureAirC,
    affAV: roueAV.mesure ? roueAV.mesure.pressionBar : null,
    affAR: roueAR.mesure ? roueAR.mesure.pressionBar : null,
    etatAV: roueAV.etat, etatAR: roueAR.etat,
    vbat: m.lipo.tensionV, soc: m.lipo.etatCharge,
    courantMa: m.electronique ? m.electronique.courantBatterieA * 1000 : 0,
    veille: b.veille,
    pileAV: m.capteurs.AV.pileTensionV, pileAR: m.capteurs.AR.pileTensionV
  });
  // Mémoire bornée : on garde au plus 200 000 points (plusieurs semaines).
  if (m.enregistrement.length > 200000) m.enregistrement.splice(0, 20000);
}

// Export CSV de l'enregistrement.
TPMS.mondeExportCsv = function (m) {
  var cols = ["tMs", "jour", "heure", "lat", "lon", "altitudeM", "vitesseKmh", "distanceKm", "temperatureC",
    "pAV", "pAR", "tAirAV", "tAirAR", "affAV", "affAR", "etatAV", "etatAR", "vbat", "soc", "courantMa", "veille", "pileAV", "pileAR"];
  var lignes = [cols.join(";")];
  m.enregistrement.forEach(function (p) {
    lignes.push(cols.map(function (c) {
      var v = p[c];
      if (typeof v === "number") return String(Math.round(v * 10000) / 10000);
      return v === null || v === undefined ? "" : String(v);
    }).join(";"));
  });
  return lignes.join("\n");
};
