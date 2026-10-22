// =====================================================================
// boitier.js — Le « cerveau » du boîtier de guidon
// ---------------------------------------------------------------------
// C'est l'équivalent de la boucle loop() du firmware. Le boîtier :
//   - écoute la radio BLE par fenêtres (pas en continu, pour économiser) ;
//   - décode les trames des capteurs appairés ;
//   - compte les tours de roue (vitesse, distance) ;
//   - évalue l'état des pneus et déclenche bip + LED ;
//   - redessine l'écran, seulement si l'image a changé ;
//   - dialogue avec l'application du téléphone (voir liaison.js) ;
//   - se met en veille quand le vélo ne roule plus.
//
// Le temps lui est toujours donné en paramètre (maintenantMs) : dans
// le simulateur c'est l'horloge simulée, dans le firmware ce sera millis().
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// Un rafraîchissement complet (écran qui clignote noir/blanc) toutes les
// 20 mises à jour partielles, pour effacer les traces ("ghosting").
TPMS.PARTIELS_AVANT_COMPLET = 20;

// La pression affichée ne change que si l'écart dépasse 0,03 bar.
// Sans cela, le bruit du capteur (±0,01 bar) ferait redessiner l'écran
// à chaque trame, pour rien.
TPMS.HYSTERESIS_AFFICHAGE_BAR = 0.03;

TPMS.creerRoue = function () {
  return {
    mesure: null,                 // dernière trame décodée
    pressionAffichee: null,       // valeur montrée à l'écran (avec hystérésis)
    dernierRecuMs: -1,
    nbTrames: 0,
    historique: TPMS.creerHistorique(),
    penteBarH: 0,
    etat: TPMS.ETAT.ATTENTE,
    acquittee: false,             // alerte acquittée par appui long
    verification: TPMS.creerVerification(),   // protection « vraisemblance »
    rythme: TPMS.creerRythme(),               // protection « rythme »
    intrusionJusquaMs: -1         // fin du « signal suspect »
  };
};

TPMS.creerBoitier = function () {
  var circonference = 2105;   // 700×25C, valeur par défaut
  return {
    reglages: {
      appairage: { AV: "EA:CA:3F:1B:07", AR: "EA:CA:3F:1B:08" },
      protections: TPMS.protectionsParDefaut(),
      seuils: TPMS.seuilsParDefaut(),
      circonferenceMm: circonference,
      ecoutePeriodeMs: 5000,      // la radio s'allume toutes les 5 s...
      ecouteFenetreMs: 2000,      // ... et écoute pendant 2 s (40 % du temps)
      delaiVeilleMs: 5 * 60000,   // veille après 5 min sans rouler
      periodeEcranMs: 2000        // en roulant, au plus un rafraîchissement toutes les 2 s
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
    dernierDessinMs: -1000000,
    ecranUrgent: true,                // redessiner sans attendre (bouton, alerte...)
    liaison: TPMS.creerLiaison(),     // dialogue avec l'application
    stats: {
      tramesAcceptees: 0,
      tramesInconnues: 0,
      tramesInvalides: 0,
      tramesManquees: 0,
      rejetsVraisemblance: 0,     // trames en attente de confirmation ou hors limites
      rejetsRythme: 0,            // trames reçues pendant un « signal suspect »
      intrusions: 0,
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

// Une annonce BLE passe dans l'air. Elle traverse les protections dans
// l'ordre ; la première qui la refuse l'arrête.
// Retourne ce qu'il en est advenu : "acceptee", "radio-coupee",
// "invalide", "inconnue", "intrusion", "hors-limites" ou "suspecte".
TPMS.boitierRecevoirTrame = function (b, octets, maintenantMs) {
  var protections = b.reglages.protections;

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

  // 1. De quelle roue s'agit-il ?
  var position = protections.listeBlanche
    ? TPMS.positionCapteur(b.reglages.appairage, mesure.adresse)
    : TPMS.positionParNumero(mesure.numero);
  if (position === null) {
    b.stats.tramesInconnues++;
    return "inconnue";
  }
  var roue = b.roues[position];

  // 2. Rythme : deux émetteurs avec la même identité ?
  if (protections.rythme) {
    if (TPMS.controlerRythme(roue.rythme, maintenantMs)) {
      if (roue.intrusionJusquaMs <= maintenantMs) {
        b.stats.intrusions++;
        TPMS.boitierJournal(b, maintenantMs,
          position + " : trames trop rapprochées, deux émetteurs → SIGNAL SUSPECT");
      }
      roue.intrusionJusquaMs = maintenantMs + TPMS.QUARANTAINE_MS;
    }
    // Pendant le signal suspect, on garde la dernière valeur de confiance.
    if (roue.intrusionJusquaMs > maintenantMs) {
      b.stats.rejetsRythme++;
      return "intrusion";
    }
  }

  // 3. Vraisemblance : la nouvelle valeur est-elle physiquement possible ?
  if (protections.vraisemblance) {
    var doute = protections.rythme && TPMS.rythmeDouteux(roue.rythme);
    var verdict = TPMS.verifierVraisemblance(roue.verification, roue.mesure,
      roue.dernierRecuMs, mesure, maintenantMs, !doute);
    if (verdict === "hors-limites" || verdict === "suspecte") {
      b.stats.rejetsVraisemblance++;
      return verdict;
    }
    if (verdict === "confirmee") {
      TPMS.boitierJournal(b, maintenantMs,
        position + " : changement brutal confirmé par " + TPMS.CONFIRMATIONS + " trames");
    }
  }

  roue.mesure = mesure;
  if (roue.pressionAffichee === null ||
      Math.abs(mesure.pressionBar - roue.pressionAffichee) >= TPMS.HYSTERESIS_AFFICHAGE_BAR) {
    roue.pressionAffichee = mesure.pressionBar;
  }
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
  b.ecranUrgent = true;
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
  b.ecranUrgent = true;
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
    appConnectee: b.liaison.connecte,
    codeAppairage: b.liaison.code,
    roues: { AV: TPMS.vueRoue(b.roues.AV), AR: TPMS.vueRoue(b.roues.AR) },
    vitesseKmh: b.veille ? 0 : TPMS.compteurVitesseKmh(c, maintenantMs),
    distanceKm: TPMS.compteurDistanceKm(c),
    moyenneKmh: TPMS.compteurMoyenneKmh(c),
    maxKmh: c.vitesseMaxKmh,
    dureeRoulageS: c.tempsRoulageMs / 1000
  };
};

TPMS.vueRoue = function (roue) {
  // Signal suspect : la dernière valeur a peut-être été fabriquée par le
  // pirate. On n'affiche plus de pression plutôt qu'une valeur douteuse.
  if (roue.mesure === null || roue.etat === TPMS.ETAT.INTRUSION) {
    return { etat: roue.etat, pressionBar: null };
  }
  return {
    etat: roue.etat,
    pressionBar: roue.pressionAffichee,
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
    b.ecranUrgent = true;
    TPMS.boitierJournal(b, maintenantMs, "Mise en veille (vélo immobile)");
  }
  // Le code d'appairage disparaît au bout d'une minute.
  if (b.liaison.code !== null && maintenantMs > b.liaison.codeJusquaMs) {
    b.liaison.code = null;
    b.ecranUrgent = true;
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
        b.ecranUrgent = true;
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
    appConnectee: b.liaison.connecte,
    rafraichissement: "aucun"
  };
  b.bipDemande = false;
  if (b.veille) sorties.ledAlerte = "eteinte";

  // 4. Écran : au plus un dessin toutes les periodeEcranMs, sauf urgence.
  //    On n'envoie l'image à l'écran que si elle a changé.
  if (!b.ecranUrgent && maintenantMs - b.dernierDessinMs < b.reglages.periodeEcranMs) {
    return sorties;
  }
  b.ecranUrgent = false;
  b.dernierDessinMs = maintenantMs;
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
