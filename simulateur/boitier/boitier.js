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
    releves: TPMS.creerReleves(),   // un relevé par sortie, pour prévoir le regonflage
    etat: TPMS.ETAT.ATTENTE,
    acquittee: false,             // alerte acquittée par appui long
    verification: TPMS.creerVerification(),   // protection « vraisemblance »
    rythme: TPMS.creerRythme(),               // protection « rythme »
    intrusionJusquaMs: -1,        // fin du « signal suspect »
    dernierCompteur: -1,          // capteurs v2 : dernier compteur accepté (anti-rejeu)
    dernierRefusJournalMs: -Infinity
  };
};

// Au-dessus de cette vitesse, on est sûr que les capteurs sont en mode
// roulage (une annonce toutes les 3 s). Hypothèse prudente : le seuil
// réel de leur accéléromètre est inconnu (4,4 km/h dans le simulateur).
TPMS.VITESSE_ROULAGE_SURE_KMH = 10;

TPMS.creerBoitier = function () {
  var circonference = 2105;   // 700×25C, valeur par défaut
  return {
    reglages: {
      appairage: { AV: "EA:CA:3F:1B:07", AR: "EA:CA:3F:1B:08" },
      clesV2: null,               // capteurs v2 : { AV: clé 16 octets, AR: clé } (null = capteurs du commerce)
      protections: TPMS.protectionsParDefaut(),
      seuils: TPMS.seuilsParDefaut(),
      circonferenceMm: circonference,
      ecoutePeriodeMs: 5000,      // la radio s'allume toutes les 5 s...
      ecouteFenetreMs: 3000,      // ... et écoute pendant 3 s (60 % du temps)
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
    ecouteContinueJusquaMs: -1,   // écoute renforcée après une trame douteuse
    inconnuesSeconde: 0,          // annonces inconnues reçues depuis la dernière seconde
    secondesSaturees: 0,
    secondesCalmes: 0,
    radioSaturee: false,          // inondation d'annonces détectée
    journalSecurise: TPMS.creerJournalSecurise(),   // journal chaîné (journal.js)
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
      signaturesFausses: 0,       // capteurs v2 : trame mal signée
      rejeux: 0,                  // capteurs v2 : compteur déjà vu
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
  TPMS.journalAjouter(b.journalSecurise, maintenantMs, texte);   // copie chaînée, infalsifiable
};

// Inondation d'annonces : au-delà de 50 annonces inconnues par seconde
// pendant 5 s, le boîtier signale une radio saturée. Ce n'est qu'une
// INFORMATION (pas de bip) : dans une rue très fréquentée, beaucoup
// d'objets Bluetooth émettent, et une fausse alerte sonore serait pénible.
TPMS.SEUIL_INONDATION_PAR_S = 50;
TPMS.DUREE_INONDATION_S = 5;
TPMS.DUREE_RETOUR_CALME_S = 10;

// Appelée une fois par seconde par boitierMiseAJour.
TPMS.boitierSurveillerSaturation = function (b, maintenantMs) {
  var n = b.inconnuesSeconde;
  b.inconnuesSeconde = 0;
  if (n > TPMS.SEUIL_INONDATION_PAR_S) {
    b.secondesSaturees++;
    b.secondesCalmes = 0;
    if (!b.radioSaturee && b.secondesSaturees >= TPMS.DUREE_INONDATION_S) {
      b.radioSaturee = true;
      b.ecranUrgent = true;
      TPMS.boitierJournal(b, maintenantMs, "Radio saturée : " + n + " annonces inconnues par seconde (inondation ?)");
    }
  } else {
    b.secondesSaturees = 0;
    if (b.radioSaturee && ++b.secondesCalmes >= TPMS.DUREE_RETOUR_CALME_S) {
      b.radioSaturee = false;
      b.ecranUrgent = true;
      TPMS.boitierJournal(b, maintenantMs, "Radio redevenue normale");
    }
  }
};

// Capteurs v2 : à quelle roue appartient cette adresse privée ?
TPMS.positionCapteurV2 = function (cles, adresse) {
  if (TPMS.adresseResolue(cles.AV, adresse)) return "AV";
  if (TPMS.adresseResolue(cles.AR, adresse)) return "AR";
  return null;
};

// Journal d'un refus, au plus une fois par minute et par roue.
TPMS.boitierJournalRefus = function (b, roue, maintenantMs, texte) {
  if (maintenantMs - roue.dernierRefusJournalMs < 60000) return;
  roue.dernierRefusJournalMs = maintenantMs;
  TPMS.boitierJournal(b, maintenantMs, texte);
};

// La radio écoute-t-elle à cet instant ?
// Elle est allumée pendant les fenetreMs premières millisecondes de
// chaque période, et coupée en veille.
// La position de la fenêtre dans chaque période change d'une période à
// l'autre (pseudo-hasard calculé à partir du numéro de période). Sans cela,
// un capteur qui annonce toutes les 60 s (multiple des 5 s de la période)
// tombe toujours au même moment du cycle : s'il tombe hors de la fenêtre,
// il n'est JAMAIS entendu (verrouillage de phase, défaut révélé par la
// simulation d'une semaine).
TPMS.boitierEcoute = function (b, maintenantMs) {
  if (b.veille) return false;
  if (maintenantMs < b.ecouteContinueJusquaMs) return true;   // écoute renforcée
  var periode = b.reglages.ecoutePeriodeMs, fenetre = b.reglages.ecouteFenetreMs;
  if (fenetre >= periode) return true;
  var cycle = Math.floor(maintenantMs / periode);
  var decalage = TPMS.melangerEntier(cycle) % (periode - fenetre);
  var dansCycle = maintenantMs - cycle * periode;
  return dansCycle >= decalage && dansCycle < decalage + fenetre;
};

// Écoute renforcée : dès qu'une trame sème le doute (changement brutal à
// confirmer, deux émetteurs), la radio reste allumée en continu pendant
// ECOUTE_RENFORCEE_MS. Les trames de confirmation ne peuvent plus tomber
// hors fenêtre : une vraie crevaison est confirmée en quelques secondes
// au lieu de plusieurs dizaines. Coût : quelques secondes de radio en plus,
// seulement quand il se passe quelque chose.
TPMS.ECOUTE_RENFORCEE_MS = 15000;

TPMS.boitierEcouteRenforcee = function (b, maintenantMs) {
  b.ecouteContinueJusquaMs = Math.max(b.ecouteContinueJusquaMs, maintenantMs + TPMS.ECOUTE_RENFORCEE_MS);
};

// Mélange un entier (hachage simple, même résultat en C avec uint32_t).
TPMS.melangerEntier = function (n) {
  var x = (n | 0) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
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

  var mesure, position, roue, authentifiee = false;
  if (b.reglages.clesV2) {
    // Capteurs v2 : seules les trames signées par NOS capteurs comptent.
    mesure = TPMS.decoderTrameV2(octets);
    position = mesure === null ? null : TPMS.positionCapteurV2(b.reglages.clesV2, mesure.adresseOctets);
    if (position === null) {
      b.stats.tramesInconnues++;
      b.inconnuesSeconde++;
      return "inconnue";
    }
    roue = b.roues[position];
    if (!TPMS.signatureValide(b.reglages.clesV2[position], octets)) {
      b.stats.signaturesFausses++;
      TPMS.boitierJournalRefus(b, roue, maintenantMs, position + " : trame mal signée refusée (usurpation ?)");
      return "signature-fausse";
    }
    if (mesure.compteur <= roue.dernierCompteur) {
      b.stats.rejeux++;
      TPMS.boitierJournalRefus(b, roue, maintenantMs, position + " : trame rejouée refusée (compteur déjà vu)");
      return "rejeu";
    }
    roue.dernierCompteur = mesure.compteur;
    authentifiee = true;   // signée par notre capteur : pas besoin du contrôle du rythme
  } else {
    mesure = TPMS.decoderTrame(octets);
    if (mesure === null) {
      b.stats.tramesInvalides++;
      b.inconnuesSeconde++;
      return "invalide";
    }
    // 1. De quelle roue s'agit-il ?
    position = protections.listeBlanche
      ? TPMS.positionCapteur(b.reglages.appairage, mesure.adresse)
      : TPMS.positionParNumero(mesure.numero);
    if (position === null) {
      b.stats.tramesInconnues++;
      b.inconnuesSeconde++;
      return "inconnue";
    }
    roue = b.roues[position];
  }

  // 2. Rythme : deux émetteurs avec la même identité ?
  if (protections.rythme && !authentifiee) {
    if (TPMS.controlerRythme(roue.rythme, maintenantMs, mesure.pressionBar)) {
      if (roue.intrusionJusquaMs <= maintenantMs) {
        b.stats.intrusions++;
        TPMS.boitierJournal(b, maintenantMs,
          position + " : trames trop rapprochées, deux émetteurs → SIGNAL SUSPECT");
      }
      roue.intrusionJusquaMs = maintenantMs + TPMS.QUARANTAINE_MS;
      TPMS.boitierEcouteRenforcee(b, maintenantMs);
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
      if (verdict === "suspecte") TPMS.boitierEcouteRenforcee(b, maintenantMs);
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
  var compensee = TPMS.pressionCompenseeBar(mesure.pressionBar, mesure.temperatureC);
  TPMS.historiqueAjouter(roue.historique, maintenantMs, compensee);
  TPMS.relevesAjouter(roue.releves, maintenantMs, compensee);
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
    radioSaturee: b.radioSaturee,
    roues: { AV: TPMS.vueRoue(b.roues.AV, b.reglages.seuils.AV.basBar),
             AR: TPMS.vueRoue(b.roues.AR, b.reglages.seuils.AR.basBar) },
    vitesseKmh: b.veille ? 0 : TPMS.compteurVitesseKmh(c, maintenantMs),
    distanceKm: TPMS.compteurDistanceKm(c),
    moyenneKmh: TPMS.compteurMoyenneKmh(c),
    maxKmh: c.vitesseMaxKmh,
    dureeRoulageS: c.tempsRoulageMs / 1000
  };
};

TPMS.vueRoue = function (roue, seuilBasBar) {
  // Signal suspect : la dernière valeur a peut-être été fabriquée par le
  // pirate. On n'affiche plus de pression plutôt qu'une valeur douteuse.
  if (roue.mesure === null || roue.etat === TPMS.ETAT.INTRUSION) {
    return { etat: roue.etat, pressionBar: null, joursRegonflage: null };
  }
  return {
    etat: roue.etat,
    pressionBar: roue.pressionAffichee,
    temperatureC: roue.mesure.temperatureC,
    batteriePct: roue.mesure.batteriePct,
    joursRegonflage: TPMS.predireRegonflage(roue.releves, seuilBasBar)   // null = pas encore de prévision
  };
};

// Appelée une fois par seconde.
// Retourne les sorties à piloter : LED d'alerte, bip, LED d'éclairage,
// et le type de rafraîchissement d'écran effectué.
TPMS.boitierMiseAJour = function (b, maintenantMs) {
  if (!b.veille) TPMS.boitierSurveillerSaturation(b, maintenantMs);
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
      // « En mouvement » pour le délai de perte : seulement au-dessus de
      // 10 km/h. Plus lentement (montée raide), le capteur peut ne pas
      // sentir la rotation et n'émettre qu'une fois par minute : avec le
      // délai de 60 s, fausses alertes « capteur perdu » (défaut révélé par
      // la semaine type, montée de la Croix-Rousse à 4 km/h).
      var enMouvement = TPMS.compteurVitesseKmh(b.compteur, maintenantMs) > TPMS.VITESSE_ROULAGE_SURE_KMH;
      var etat = TPMS.evaluerRoue(roue, pos, b.reglages.seuils, maintenantMs, b.ecouteDepuisMs, enMouvement);
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
  //    En veille, le processeur dort : on ne redessine que sur urgence
  //    (réveil, alerte). À l'arrêt, une image toutes les 10 s suffit.
  var periodeMs = b.reglages.periodeEcranMs;
  if (TPMS.compteurVitesseKmh(b.compteur, maintenantMs) === 0) periodeMs = 10000;
  if (!b.ecranUrgent && (b.veille || maintenantMs - b.dernierDessinMs < periodeMs)) {
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
