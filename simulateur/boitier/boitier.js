// =====================================================================
// boitier.js — Le « cerveau » du boîtier de guidon
// ---------------------------------------------------------------------
// C'est l'équivalent de la boucle loop() du firmware. Le boîtier :
//   - écoute la radio BLE par fenêtres (pas en continu, pour économiser) ;
//   - décode les trames des capteurs appairés ;
//   - compte les tours de roue (vitesse, distance) ;
//   - évalue l'état des pneus et déclenche bip + LED ;
//   - redessine l'écran, seulement si l'image a changé ;
//   - se met en veille quand le vélo ne roule plus.
//
// Le temps lui est toujours donné en paramètre (maintenantMs) : dans
// le simulateur c'est l'horloge simulée, dans le firmware ce sera millis().
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Un rafraîchissement complet (écran qui clignote noir/blanc) toutes les
// 20 mises à jour partielles, pour effacer les traces ("ghosting").
TPMS.PARTIELS_AVANT_COMPLET = 20;

TPMS.creerRoue = function () {
  return {
    mesure: null,                 // dernière trame décodée
    dernierRecuMs: -1,
    nbTrames: 0,
    historique: TPMS.creerHistorique(),
    penteBarH: 0,
    etat: TPMS.ETAT.ATTENTE,
    acquittee: false              // alerte acquittée par appui long
  };
};

TPMS.creerBoitier = function () {
  var circonference = 2105;   // 700×25C, valeur par défaut
  return {
    reglages: {
      appairage: { AV: "EA:CA:3F:1B:07", AR: "EA:CA:3F:1B:08" },
      seuils: TPMS.seuilsParDefaut(),
      circonferenceMm: circonference,
      ecoutePeriodeMs: 5000,      // la radio s'allume toutes les 5 s...
      ecouteFenetreMs: 2000,      // ... et écoute pendant 2 s (40 % du temps)
      delaiVeilleMs: 5 * 60000    // veille après 5 min sans rouler
    },
    roues: { AV: TPMS.creerRoue(), AR: TPMS.creerRoue() },
    compteur: TPMS.creerCompteur(circonference),
    page: 0,
    eclairage: false,
    veille: false,
    dernierMouvementMs: 0,
    ecouteDepuisMs: 0,
    batteriePct: 100,
    enCharge: false,
    bipDemande: false,
    ecran: TPMS.creerEcran(),         // image en préparation
    ecranAffiche: TPMS.creerEcran(),  // image réellement sur l'écran
    partielsDepuisComplet: 0,
    stats: {
      tramesAcceptees: 0,
      tramesInconnues: 0,
      tramesInvalides: 0,
      tramesManquees: 0,
      rafraichissementsPartiels: 0,
      rafraichissementsComplets: 0
    },
    journal: []   // messages pour le simulateur (en C : Serial.println)
  };
};

TPMS.boitierJournal = function (b, maintenantMs, texte) {
  b.journal.push({ tMs: maintenantMs, texte: texte });
};

// La radio écoute-t-elle à cet instant ?
// Elle est allumée pendant les fenetreMs premières millisecondes de
// chaque période, et coupée en veille.
TPMS.boitierEcoute = function (b, maintenantMs) {
  if (b.veille) return false;
  return (maintenantMs % b.reglages.ecoutePeriodeMs) < b.reglages.ecouteFenetreMs;
};

// Une annonce BLE passe dans l'air.
// Retourne ce qu'il en est advenu : "acceptee", "radio-coupee",
// "invalide" ou "inconnue".
TPMS.boitierRecevoirTrame = function (b, octets, maintenantMs) {
  // Dans la réalité, une trame émise radio coupée n'est jamais vue.
  // Le simulateur la compte quand même, pour la montrer.
  if (!TPMS.boitierEcoute(b, maintenantMs)) {
    b.stats.tramesManquees++;
    return "radio-coupee";
  }

  var mesure = TPMS.decoderTrame(octets);
  if (mesure === null) {
    b.stats.tramesInvalides++;
    return "invalide";
  }

  var position = TPMS.positionCapteur(b.reglages.appairage, mesure.adresse);
  if (position === null) {
    b.stats.tramesInconnues++;
    return "inconnue";
  }

  var roue = b.roues[position];
  roue.mesure = mesure;
  roue.dernierRecuMs = maintenantMs;
  roue.nbTrames++;
  TPMS.historiqueAjouter(roue.historique, maintenantMs, mesure.pressionBar);
  roue.penteBarH = TPMS.historiquePenteBarH(roue.historique);
  b.stats.tramesAcceptees++;
  return "acceptee";
};

TPMS.boitierReveiller = function (b, maintenantMs, raison) {
  if (!b.veille) return;
  b.veille = false;
  b.ecouteDepuisMs = maintenantMs;
  TPMS.boitierJournal(b, maintenantMs, "Réveil (" + raison + ")");
};

// L'aimant passe devant le reed (en C : routine d'interruption).
TPMS.boitierTopRoue = function (b, maintenantMs) {
  var accepte = TPMS.compteurTop(b.compteur, maintenantMs);
  if (accepte) {
    b.dernierMouvementMs = maintenantMs;
    TPMS.boitierReveiller(b, maintenantMs, "la roue tourne");
  }
  return accepte;
};

// Boutons :
//   bouton 1 court : changer de page    | long : remise à zéro du trajet
//   bouton 2 court : éclairage on/off   | long : acquitter les alertes
// En veille, un appui ne fait que réveiller le boîtier.
TPMS.boitierBouton = function (b, numero, appuiLong, maintenantMs) {
  b.dernierMouvementMs = maintenantMs;
  if (b.veille) {
    TPMS.boitierReveiller(b, maintenantMs, "bouton " + numero);
    return;
  }
  if (numero === 1 && !appuiLong) {
    b.page = (b.page + 1) % 2;
  } else if (numero === 1 && appuiLong) {
    TPMS.compteurRemiseAZero(b.compteur);
    TPMS.boitierJournal(b, maintenantMs, "Trajet remis à zéro");
  } else if (numero === 2 && !appuiLong) {
    b.eclairage = !b.eclairage;
  } else if (numero === 2 && appuiLong) {
    var positions = ["AV", "AR"];
    for (var i = 0; i < positions.length; i++) {
      var roue = b.roues[positions[i]];
      if (TPMS.estAlerte(roue.etat) && !roue.acquittee) {
        roue.acquittee = true;
        TPMS.boitierJournal(b, maintenantMs, positions[i] + " : alerte acquittée");
      }
    }
  }
};

// Les valeurs à afficher, préparées pour ecran.js.
TPMS.boitierVue = function (b, maintenantMs) {
  var c = b.compteur;
  return {
    page: b.page,
    veille: b.veille,
    eclairage: b.eclairage && !b.veille,
    enCharge: b.enCharge,
    batterieBoitierPct: b.batteriePct,
    roues: { AV: TPMS.vueRoue(b.roues.AV), AR: TPMS.vueRoue(b.roues.AR) },
    vitesseKmh: b.veille ? 0 : TPMS.compteurVitesseKmh(c, maintenantMs),
    distanceKm: TPMS.compteurDistanceKm(c),
    moyenneKmh: TPMS.compteurMoyenneKmh(c),
    maxKmh: c.vitesseMaxKmh,
    dureeRoulageS: c.tempsRoulageMs / 1000
  };
};

TPMS.vueRoue = function (roue) {
  if (roue.mesure === null) {
    return { etat: roue.etat, pressionBar: null };
  }
  return {
    etat: roue.etat,
    pressionBar: roue.mesure.pressionBar,
    temperatureC: roue.mesure.temperatureC,
    batteriePct: roue.mesure.batteriePct
  };
};

// Appelée une fois par seconde.
// Retourne les sorties à piloter : LED d'alerte, bip, LED d'éclairage,
// et le type de rafraîchissement d'écran effectué.
TPMS.boitierMiseAJour = function (b, maintenantMs) {
  // 1. Veille si le vélo ne roule plus depuis longtemps.
  if (!b.veille && maintenantMs - b.dernierMouvementMs > b.reglages.delaiVeilleMs) {
    b.veille = true;
    TPMS.boitierJournal(b, maintenantMs, "Mise en veille (vélo immobile)");
  }

  // 2. État de chaque pneu (pas en veille : la radio est coupée).
  var alerteEnCours = false;
  var alerteNonAcquittee = false;
  var positions = ["AV", "AR"];
  for (var i = 0; i < positions.length; i++) {
    var pos = positions[i];
    var roue = b.roues[pos];
    if (!b.veille) {
      var etat = TPMS.evaluerRoue(roue, pos, b.reglages.seuils, maintenantMs, b.ecouteDepuisMs);
      if (etat !== roue.etat) {
        roue.etat = etat;
        roue.acquittee = false;
        TPMS.boitierJournal(b, maintenantMs, pos + " : " + TPMS.texteEtat(etat));
        if (TPMS.estAlerte(etat)) b.bipDemande = true;
      }
    }
    if (TPMS.estAlerte(roue.etat)) {
      alerteEnCours = true;
      if (!roue.acquittee) alerteNonAcquittee = true;
    }
  }

  // 3. Sorties : la LED clignote tant qu'une alerte n'est pas acquittée,
  //    puis reste allumée tant que le problème dure.
  var sorties = {
    ledAlerte: alerteNonAcquittee ? "clignote" : (alerteEnCours ? "fixe" : "eteinte"),
    bip: b.bipDemande,
    ledsEclairage: b.eclairage && !b.veille,
    radio: TPMS.boitierEcoute(b, maintenantMs),
    rafraichissement: "aucun"
  };
  b.bipDemande = false;
  if (b.veille) sorties.ledAlerte = "eteinte";

  // 4. Écran : on dessine la nouvelle image, et on ne l'envoie à
  //    l'écran que si elle est différente de celle déjà affichée.
  TPMS.dessinerEcran(b.ecran, TPMS.boitierVue(b, maintenantMs));
  if (TPMS.ecransDifferents(b.ecran, b.ecranAffiche)) {
    TPMS.ecranCopier(b.ecranAffiche, b.ecran);
    if (b.partielsDepuisComplet >= TPMS.PARTIELS_AVANT_COMPLET) {
      b.partielsDepuisComplet = 0;
      b.stats.rafraichissementsComplets++;
      sorties.rafraichissement = "complet";
    } else {
      b.partielsDepuisComplet++;
      b.stats.rafraichissementsPartiels++;
      sorties.rafraichissement = "partiel";
    }
  }
  return sorties;
};
