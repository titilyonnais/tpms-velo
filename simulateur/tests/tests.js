// =====================================================================
// tests.js — Vérifications automatiques de la logique
// ---------------------------------------------------------------------
// Se lance :
//   - en ligne de commande : node simulateur/tests/tests.js
//   - dans le navigateur   : ouvrir simulateur/tests/tests.html
// Chaque test compare un résultat calculé à la valeur attendue.
// =====================================================================

// Sous Node, on charge nous-mêmes les fichiers (dans le navigateur,
// c'est tests.html qui s'en charge avec des balises <script>).
if (typeof require !== "undefined") {
  var fichiers = [
    "../../logique/trame.js", "../../logique/vitesse.js", "../../logique/fuite.js",
    "../../logique/alertes.js", "../../logique/securite.js",
    "../../logique/protocole.js", "../../logique/energie.js",
    "../../logique/statistiques.js", "../../logique/conseil.js",
    "../../logique/sha256.js", "../../logique/journal.js", "../../logique/trame2.js",
    "../boitier/police5x7.js", "../boitier/epaper.js",
    "../boitier/ecran.js", "../boitier/liaison.js", "../boitier/boitier.js",
    "../sources/pirate.js"
  ];
  fichiers.forEach(function (f) { require(require("path").join(__dirname, f)); });
}

var resultats = { reussis: 0, rates: 0, lignes: [] };

function verifier(nom, condition, detail) {
  if (condition) {
    resultats.reussis++;
    resultats.lignes.push("OK     " + nom);
  } else {
    resultats.rates++;
    resultats.lignes.push("ÉCHEC  " + nom + (detail !== undefined ? "  → obtenu : " + detail : ""));
  }
}

function proche(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

// ---------------------------------------------------------------------
// Trames
// ---------------------------------------------------------------------
(function () {
  var trame = TPMS.encoderTrame({
    numero: 1, adresse: [0xEA, 0xCA, 0x3F, 0x1B, 0x07],
    pressionBar: 2.1, temperatureC: 20.5, batteriePct: 95, alarme: 0
  });
  verifier("trame : 18 octets", trame.length === 18, trame.length);
  // 2,1 bar = 210 000 Pa = 0x00033450 → 50 34 03 00
  verifier("trame : pression en Pa little-endian",
    TPMS.trameEnHexa(trame.slice(8, 12)) === "50 34 03 00", TPMS.trameEnHexa(trame.slice(8, 12)));
  // 20,5 °C = 2050 centièmes = 0x0802 → 02 08 00 00
  verifier("trame : température en centièmes",
    TPMS.trameEnHexa(trame.slice(12, 16)) === "02 08 00 00", TPMS.trameEnHexa(trame.slice(12, 16)));
  verifier("trame : octet capteur 1 = 0x80", trame[2] === 0x80);

  var m = TPMS.decoderTrame(trame);
  verifier("décodage : pression", proche(m.pressionBar, 2.1, 1e-9), m.pressionBar);
  verifier("décodage : température", proche(m.temperatureC, 20.5, 1e-9), m.temperatureC);
  verifier("décodage : adresse", m.adresse === "EA:CA:3F:1B:07", m.adresse);
  verifier("décodage : numéro", m.numero === 1, m.numero);
  verifier("décodage : pile", m.batteriePct === 95, m.batteriePct);

  // Température négative : -5,25 °C = -525 = 0xFFFFFDF3 → F3 FD FF FF
  var froide = TPMS.encoderTrame({
    numero: 2, adresse: [0xEA, 0xCA, 0, 0, 1],
    pressionBar: 2, temperatureC: -5.25, batteriePct: 50, alarme: 0
  });
  verifier("trame : température négative codée",
    TPMS.trameEnHexa(froide.slice(12, 16)) === "F3 FD FF FF", TPMS.trameEnHexa(froide.slice(12, 16)));
  verifier("décodage : température négative",
    TPMS.decoderTrame(froide).temperatureC === -5.25, TPMS.decoderTrame(froide).temperatureC);
  verifier("décodage : capteur 2", TPMS.decoderTrame(froide).numero === 2);

  verifier("décodage : trame trop courte refusée", TPMS.decoderTrame(new Uint8Array(10)) === null);
  var autreFabricant = trame.slice();
  autreFabricant[0] = 0x4C;
  verifier("décodage : autre fabricant refusé", TPMS.decoderTrame(autreFabricant) === null);
})();

// ---------------------------------------------------------------------
// Vitesse et distance
// ---------------------------------------------------------------------
(function () {
  var c = TPMS.creerCompteur(2100);
  for (var i = 0; i < 10; i++) TPMS.compteurTop(c, i * 300);
  // 2100 mm en 300 ms = 7 m/s = 25,2 km/h
  verifier("vitesse : 25,2 km/h", proche(TPMS.compteurVitesseKmh(c, 2700), 25.2, 1e-9),
    TPMS.compteurVitesseKmh(c, 2700));
  // 10 tops = 9 tours complets (le premier top ne fait que démarrer la mesure)
  verifier("distance : 10 tops = 9 tours = 18,9 m", c.distanceMm === 18900, c.distanceMm);
  verifier("rebond ignoré", TPMS.compteurTop(c, 2710) === false);
  // 600 ms après le dernier top, sans nouveau top : la vitesse affichée baisse
  verifier("ralentissement : 12,6 km/h", proche(TPMS.compteurVitesseKmh(c, 3300), 12.6, 1e-9),
    TPMS.compteurVitesseKmh(c, 3300));
  verifier("arrêt après 3 s", TPMS.compteurVitesseKmh(c, 2700 + 3001) === 0);
  verifier("moyenne : 25,2 km/h", proche(TPMS.compteurMoyenneKmh(c), 25.2, 1e-9), TPMS.compteurMoyenneKmh(c));

  TPMS.compteurRemiseAZero(c);
  verifier("remise à zéro : distance nulle", c.distanceMm === 0);
  verifier("remise à zéro : circonférence gardée", c.circonferenceMm === 2100);
})();

// ---------------------------------------------------------------------
// Fuite lente
// ---------------------------------------------------------------------
(function () {
  // 20 minutes de mesures, la pression perd 0,3 bar/h, avec du bruit.
  var h = TPMS.creerHistorique();
  for (var s = 0; s <= 1200; s += 30) {
    var bruit = ((s * 7919) % 11 - 5) / 1000;   // bruit fixe de ±0,005 bar
    TPMS.historiqueAjouter(h, s * 1000, 2.2 - 0.3 * s / 3600 + bruit);
  }
  var pente = TPMS.historiquePenteBarH(h);
  verifier("fuite : pente ≈ -0,3 bar/h", proche(pente, -0.3, 0.03), pente);

  var stable = TPMS.creerHistorique();
  for (var t = 0; t <= 1200; t += 30) TPMS.historiqueAjouter(stable, t * 1000, 2.2);
  verifier("pneu stable : pente nulle", proche(TPMS.historiquePenteBarH(stable), 0, 1e-9));

  var court = TPMS.creerHistorique();
  for (var u = 0; u <= 120; u += 30) TPMS.historiqueAjouter(court, u * 1000, 2.2 - u / 100);
  verifier("moins de 10 min : pas de conclusion", TPMS.historiquePenteBarH(court) === 0);

  TPMS.historiqueAjouter(h, 1230 * 1000, 2.5);
  verifier("regonflage : historique remis à zéro", h.tMs.length === 1, h.tMs.length);
})();

// ---------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------
(function () {
  var seuils = TPMS.seuilsParDefaut();
  function roue(p, pente) {
    return { mesure: { pressionBar: p, alarme: 0 }, dernierRecuMs: 0, penteBarH: pente || 0 };
  }
  verifier("alerte : OK", TPMS.evaluerRoue(roue(2.2), "AV", seuils, 1000, 0) === "OK");
  verifier("alerte : basse", TPMS.evaluerRoue(roue(1.5), "AV", seuils, 1000, 0) === "BASSE");
  verifier("alerte : haute", TPMS.evaluerRoue(roue(3.5), "AV", seuils, 1000, 0) === "HAUTE");
  verifier("alerte : crevaison", TPMS.evaluerRoue(roue(0.2), "AV", seuils, 1000, 0) === "CREVAISON");
  verifier("alerte : fuite", TPMS.evaluerRoue(roue(2.2, -0.3), "AV", seuils, 1000, 0) === "FUITE");
  verifier("alerte : seuil arrière différent", TPMS.evaluerRoue(roue(1.9), "AR", seuils, 1000, 0) === "BASSE");
  verifier("alerte : capteur perdu", TPMS.evaluerRoue(roue(2.2), "AV", seuils, 61000, 0) === "PERDU");
  verifier("alerte : pas perdu juste après un réveil",
    TPMS.evaluerRoue(roue(2.2), "AV", seuils, 61000, 60000) === "OK");
  verifier("alerte : en attente",
    TPMS.evaluerRoue({ mesure: null }, "AV", seuils, 0, 0) === "ATTENTE");
})();

// ---------------------------------------------------------------------
// Boîtier complet
// ---------------------------------------------------------------------
(function () {
  var b = TPMS.creerBoitier();
  var trameAV = TPMS.encoderTrame({
    numero: 1, adresse: [0xEA, 0xCA, 0x3F, 0x1B, 0x07],
    pressionBar: 1.2, temperatureC: 18, batteriePct: 90, alarme: 0
  });
  var trameInconnue = TPMS.encoderTrame({
    numero: 1, adresse: [0xEA, 0xCA, 0x00, 0x00, 0x99],
    pressionBar: 2.2, temperatureC: 18, batteriePct: 90, alarme: 0
  });
  verifier("boîtier : radio coupée hors fenêtre", TPMS.boitierRecevoirTrame(b, trameAV, 3000) === "radio-coupee");
  verifier("boîtier : capteur inconnu ignoré", TPMS.boitierRecevoirTrame(b, trameInconnue, 1000) === "inconnue");
  verifier("boîtier : capteur appairé accepté", TPMS.boitierRecevoirTrame(b, trameAV, 1000) === "acceptee");

  var sorties = TPMS.boitierMiseAJour(b, 1000);
  verifier("boîtier : AV en pression basse", b.roues.AV.etat === "BASSE", b.roues.AV.etat);
  verifier("boîtier : bip demandé", sorties.bip === true);
  verifier("boîtier : LED clignote", sorties.ledAlerte === "clignote", sorties.ledAlerte);
  verifier("boîtier : premier écran affiché", sorties.rafraichissement === "partiel", sorties.rafraichissement);

  TPMS.boitierBouton(b, 2, true, 1500);
  sorties = TPMS.boitierMiseAJour(b, 2000);
  verifier("boîtier : alerte acquittée → LED fixe", sorties.ledAlerte === "fixe", sorties.ledAlerte);
  verifier("boîtier : pas de bip répété", sorties.bip === false);
  verifier("boîtier : écran inchangé → pas de rafraîchissement",
    sorties.rafraichissement === "aucun", sorties.rafraichissement);

  TPMS.boitierMiseAJour(b, 2000 + b.reglages.delaiVeilleMs);
  verifier("boîtier : veille après 5 min immobile", b.veille === true);
  TPMS.boitierTopRoue(b, 2000 + b.reglages.delaiVeilleMs + 1000);
  verifier("boîtier : réveil par la roue", b.veille === false);
})();

// ---------------------------------------------------------------------
// Sécurité
// ---------------------------------------------------------------------
(function () {
  var ADRESSE_AV = [0xEA, 0xCA, 0x3F, 0x1B, 0x07];
  function trameAV(pression) {
    return TPMS.encoderTrame({
      numero: 1, adresse: ADRESSE_AV,
      pressionBar: pression, temperatureC: 20, batteriePct: 90, alarme: 0
    });
  }
  function mesure(pression) { return { pressionBar: pression, temperatureC: 20 }; }
  var ref = mesure(2.2);

  // Liste blanche
  verifier("sans liste blanche : le capteur n°1 devient l'avant", TPMS.positionParNumero(1) === "AV");
  verifier("sans liste blanche : numéro inconnu", TPMS.positionParNumero(7) === null);

  // Vraisemblance
  var v = TPMS.creerVerification();
  verifier("vraisemblance : petite baisse acceptée",
    TPMS.verifierVraisemblance(v, ref, 0, mesure(2.1), 3000) === "ok");
  verifier("vraisemblance : chute brutale suspecte",
    TPMS.verifierVraisemblance(v, ref, 0, mesure(0.3), 1000) === "suspecte");
  verifier("vraisemblance : 2e trame identique encore suspecte",
    TPMS.verifierVraisemblance(v, ref, 0, mesure(0.32), 1500) === "suspecte");
  verifier("vraisemblance : confirmée par la 3e trame",
    TPMS.verifierVraisemblance(v, ref, 0, mesure(0.31), 2000) === "confirmee");

  var v2 = TPMS.creerVerification();
  TPMS.verifierVraisemblance(v2, ref, 0, mesure(0.3), 1000);
  TPMS.verifierVraisemblance(v2, ref, 0, mesure(1.0), 1500);   // autre valeur : on recommence
  verifier("vraisemblance : valeurs contradictoires jamais confirmées",
    TPMS.verifierVraisemblance(v2, ref, 0, mesure(0.3), 2000) === "suspecte");

  verifier("vraisemblance : hors limites",
    TPMS.verifierVraisemblance(TPMS.creerVerification(), ref, 0, mesure(9), 3000) === "hors-limites");
  verifier("vraisemblance : grand écart après 1 h d'absence accepté",
    TPMS.verifierVraisemblance(TPMS.creerVerification(), ref, 0, mesure(3.0), 3600000) === "ok");

  // Rythme
  var normal = TPMS.creerRythme();
  var alerte = false;
  for (var t = 0; t <= 60000; t += 3000) alerte = TPMS.controlerRythme(normal, t) || alerte;
  verifier("rythme : un capteur toutes les 3 s → pas d'alerte", alerte === false);

  var double = TPMS.creerRythme();
  var detections = [];
  [0, 1000, 2000, 3000].forEach(function (t) { detections.push(TPMS.controlerRythme(double, t)); });
  verifier("rythme : 3 trames trop rapprochées → intrusion",
    detections.join() === "false,false,false,true", detections.join());

  // Scénario complet : le vrai capteur annonce 2,2 bar toutes les 3 s,
  // un pirate annonce 0,3 bar avec la même identité toutes les secondes.
  function scenario(protections) {
    var b = TPMS.creerBoitier();
    b.reglages.ecouteFenetreMs = b.reglages.ecoutePeriodeMs;   // radio toujours allumée
    b.reglages.protections = protections;
    var faussesAcceptees = 0;
    for (var t = 0; t <= 30000; t += 500) {
      if (t % 3000 === 0) TPMS.boitierRecevoirTrame(b, trameAV(2.2), t);
      if (t % 1000 === 500 && TPMS.boitierRecevoirTrame(b, trameAV(0.3), t) === "acceptee") faussesAcceptees++;
      if (t % 1000 === 0) TPMS.boitierMiseAJour(b, t);
    }
    return { boitier: b, faussesAcceptees: faussesAcceptees };
  }
  var sans = scenario({ listeBlanche: true, vraisemblance: false, rythme: false });
  verifier("pirate sans protection : fausses trames acceptées", sans.faussesAcceptees > 0, sans.faussesAcceptees);

  var vraisemblanceSeule = scenario({ listeBlanche: true, vraisemblance: true, rythme: false });
  // LIMITE CONNUE : le pirate émet 3 fois entre deux vraies trames, ce qui
  // suffit à « confirmer » sa fausse valeur. D'où la protection « rythme ».
  verifier("pirate + vraisemblance seule : le pirate rapide finit par passer",
    vraisemblanceSeule.faussesAcceptees > 0, vraisemblanceSeule.faussesAcceptees);

  var avec = scenario(TPMS.protectionsParDefaut());
  verifier("pirate + toutes protections : SIGNAL SUSPECT",
    avec.boitier.roues.AV.etat === "INTRUSION", avec.boitier.roues.AV.etat);
  verifier("pirate + toutes protections : fausse pression jamais acceptée",
    avec.faussesAcceptees === 0, avec.faussesAcceptees);
  verifier("pirate + toutes protections : dernière valeur de confiance gardée",
    proche(avec.boitier.roues.AV.mesure.pressionBar, 2.2, 1e-9), avec.boitier.roues.AV.mesure.pressionBar);

  // Même attaque, mais avec l'écoute par fenêtres du boîtier (3 s toutes
  // les 5 s) et le pirate décalé de 0 à 2,9 s par rapport au vrai capteur.
  // Faille trouvée lors de la relecture : le silence radio permettait au
  // pirate de « confirmer » sa valeur avant la détection du rythme.
  function scenarioFenetres(decalageMs) {
    var b = TPMS.creerBoitier();
    var faussesAcceptees = 0;
    for (var t = 0; t <= 90000; t += 10) {
      if (t % 3000 === 0) TPMS.boitierRecevoirTrame(b, trameAV(2.2), t);
      if (t >= 30000 && (t - decalageMs) % 1000 === 0 &&
          TPMS.boitierRecevoirTrame(b, trameAV(0.3), t) === "acceptee") faussesAcceptees++;
      if (t % 1000 === 0) TPMS.boitierMiseAJour(b, t);
    }
    return faussesAcceptees;
  }
  var decalagesTrompes = 0;
  for (var d = 0; d < 3000; d += 100) if (scenarioFenetres(d) > 0) decalagesTrompes++;
  verifier("pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier",
    decalagesTrompes === 0, decalagesTrompes + " décalages sur 30");

  // Attaque la plus dangereuse : le pneu crève vraiment et le pirate
  // rejoue 2,2 bar pour masquer la crevaison. Le cycliste doit être
  // prévenu (CREVAISON, BASSE ou SIGNAL SUSPECT) en moins de 10 s.
  function delaiAlerteMasquage(phaseMs) {
    var b = TPMS.creerBoitier();
    for (var t = 0; t <= 120000; t += 10) {
      var reelle = t < 30000 ? 2.2 : Math.max(0, 2.2 - 0.15 * (t - 30000) / 1000);
      if ((t + phaseMs) % 3000 === 0) TPMS.boitierRecevoirTrame(b, trameAV(reelle), t);
      if (t >= 30000 && (t - 400) % 1000 === 0) TPMS.boitierRecevoirTrame(b, trameAV(2.2), t);
      if (t % 1000 === 0) {
        TPMS.boitierMiseAJour(b, t);
        if (t > 30000 && TPMS.estAlerte(b.roues.AV.etat)) return t - 30000;
      }
    }
    return Infinity;
  }
  var pireDelai = 0;
  for (var ph = 0; ph < 3000; ph += 200) pireDelai = Math.max(pireDelai, delaiAlerteMasquage(ph));
  verifier("rejeu pour masquer une vraie crevaison : alerte en moins de 10 s",
    pireDelai < 10000, pireDelai / 1000 + " s");

  // Un vrai regonflage (1,2 → 2,2 bar d'un coup) finit par être accepté.
  var b = TPMS.creerBoitier();
  b.reglages.ecouteFenetreMs = b.reglages.ecoutePeriodeMs;
  TPMS.boitierRecevoirTrame(b, trameAV(1.2), 0);
  var resultats = [3000, 6000, 9000].map(function (t) { return TPMS.boitierRecevoirTrame(b, trameAV(2.2), t); });
  // La 1re trame est suspecte (+1 bar en 3 s) ; ensuite le temps écoulé
  // depuis la dernière valeur acceptée grandit et l'écart devient plausible.
  verifier("regonflage réel : suspect puis accepté",
    resultats[0] === "suspecte" && resultats[2] === "acceptee", resultats.join());

  // Pirate en rejeu : il renvoie des trames enregistrées, octet pour octet.
  var pirate = TPMS.creerPirate();
  pirate.attaque = "rejeu";
  pirate.enregistre = true;
  TPMS.pirateEcouter(pirate, "AV", trameAV(2.2));
  TPMS.pirateEcouter(pirate, "AR", trameAV(9.9));    // pas la cible : ignorée
  verifier("pirate : n'enregistre que la cible", pirate.enregistrement.length === 1);
  verifier("pirate : rejoue la trame à l'identique",
    TPMS.trameEnHexa(TPMS.pirateTrame(pirate, null)) === TPMS.trameEnHexa(trameAV(2.2)));
})();

// ---------------------------------------------------------------------
// Protocole boîtier ↔ application
// ---------------------------------------------------------------------
(function () {
  var mesures = {
    AV: { pressionBar: 2.15, temperatureC: -3, batteriePct: 80, etat: "BASSE" },
    AR: { pressionBar: null, etat: "ATTENTE" },
    vitesseKmh: 23.4, distanceKm: 12.345, batterieBoitierPct: 76,
    veille: false, enCharge: true, eclairage: true, sequence: 65535
  };
  var o = TPMS.encoderMesures(mesures);
  var m = TPMS.decoderMesures(o);
  verifier("MESURES : 20 octets", o.length === 20);
  verifier("MESURES : pression en mbar", m.AV.pressionBar === 2.15, m.AV.pressionBar);
  verifier("MESURES : température négative", m.AV.temperatureC === -3, m.AV.temperatureC);
  verifier("MESURES : pression inconnue", m.AR.pressionBar === null);
  verifier("MESURES : état", m.AV.etat === "BASSE" && m.AR.etat === "ATTENTE");
  verifier("MESURES : vitesse et distance", m.vitesseKmh === 23.4 && m.distanceKm === 12.345,
    m.vitesseKmh + " " + m.distanceKm);
  verifier("MESURES : drapeaux", !m.veille && m.enCharge && m.eclairage);
  verifier("MESURES : séquence", m.sequence === 65535);

  var b = TPMS.creerBoitier();
  var r = TPMS.decoderReglages(TPMS.encoderReglages(b.reglages));
  verifier("REGLAGES : aller-retour circonférence", r.circonferenceMm === 2105);
  verifier("REGLAGES : aller-retour seuils", r.seuils.AR.basBar === 2 && r.seuils.AV.hautBar === 3.2);
  verifier("REGLAGES : aller-retour appairage", r.appairage.AV === "EA:CA:3F:1B:07", r.appairage.AV);
  verifier("REGLAGES : aller-retour protections", r.protections.rythme === true);
  r.seuils.AV.basBar = 4;
  verifier("REGLAGES : seuil bas > seuil haut refusé", TPMS.verifierReglages(r) !== "");
})();

// ---------------------------------------------------------------------
// Liaison (appairage par code)
// ---------------------------------------------------------------------
(function () {
  var b = TPMS.creerBoitier();
  var reglages = TPMS.encoderReglages(b.reglages);
  verifier("liaison : réglages refusés sans appairage", TPMS.liaisonEcrireReglages(b, reglages, 0) === "refuse");
  verifier("liaison : premier contact → code requis", TPMS.liaisonConnexion(b, 0) === "code-requis");
  verifier("liaison : code affiché à l'écran", TPMS.boitierVue(b, 0).codeAppairage === b.liaison.code);
  verifier("liaison : mauvais code", TPMS.liaisonSaisirCode(b, "000000" === b.liaison.code ? "111111" : "000000", 0) === "faux");
  verifier("liaison : bon code", TPMS.liaisonSaisirCode(b, b.liaison.code, 0) === "ok");
  verifier("liaison : mesures disponibles", TPMS.liaisonMesures(b, 0).length === 20);

  var modifies = TPMS.decoderReglages(reglages);
  modifies.circonferenceMm = 2288;
  verifier("liaison : réglages acceptés une fois appairé",
    TPMS.liaisonEcrireReglages(b, TPMS.encoderReglages(modifies), 0) === "ok");
  verifier("liaison : circonférence appliquée au compteur", b.compteur.circonferenceMm === 2288);

  TPMS.liaisonDeconnexion(b, 0);
  verifier("liaison : reconnexion directe d'un téléphone appairé", TPMS.liaisonConnexion(b, 1000) === "connecte");

  var b2 = TPMS.creerBoitier();
  TPMS.liaisonConnexion(b2, 0);
  var faux = b2.liaison.code === "000000" ? "111111" : "000000";
  TPMS.liaisonSaisirCode(b2, faux, 0);
  TPMS.liaisonSaisirCode(b2, faux, 0);
  verifier("liaison : 3 codes faux → bloqué", TPMS.liaisonSaisirCode(b2, faux, 0) === "bloque");
  verifier("liaison : toujours bloqué 30 s après", TPMS.liaisonConnexion(b2, 30000) === "bloque");
})();

// ---------------------------------------------------------------------
// Confirmation par bouton des changements sensibles
// ---------------------------------------------------------------------
(function () {
  // Un boîtier appairé à un téléphone, prêt à recevoir des réglages.
  function boitierAppaire() {
    var b = TPMS.creerBoitier();
    TPMS.liaisonConnexion(b, 0);
    TPMS.liaisonSaisirCode(b, b.liaison.code, 0);
    return b;
  }
  function sansListeBlanche(b) {
    var r = TPMS.decoderReglages(TPMS.encoderReglages(b.reglages));
    r.protections.listeBlanche = false;
    return TPMS.encoderReglages(r);
  }
  var ref = TPMS.creerBoitier().reglages;
  var copie = TPMS.decoderReglages(TPMS.encoderReglages(ref));

  verifier("sensible : réglages identiques → rien", TPMS.changementSensible(ref, copie) === 0);
  copie.seuils.AV.basBar = 1.5;
  copie.circonferenceMm = 2200;
  verifier("sensible : seuils et circonférence ne sont pas sensibles", TPMS.changementSensible(ref, copie) === 0);
  copie.protections.rythme = false;
  copie.appairage.AR = "11:22:33:44:55";
  verifier("sensible : rythme coupé + capteur AR changé",
    TPMS.changementSensible(ref, copie) === (TPMS.SENSIBLE.SANS_RYTHME | TPMS.SENSIBLE.CAPTEUR_AR),
    TPMS.changementSensible(ref, copie));
  verifier("sensible : réactiver une protection n'est pas sensible",
    TPMS.changementSensible(copie, ref) === TPMS.SENSIBLE.CAPTEUR_AR, TPMS.changementSensible(copie, ref));
  verifier("sensible : lignes de l'écran",
    TPMS.lignesSensibles(TPMS.SENSIBLE.SANS_RYTHME | TPMS.SENSIBLE.CAPTEUR_AR).join("/") === "COUPER RYTHME/NOUVEAU CAPTEUR AR");

  // 1. Changement ordinaire : appliqué tout de suite, comme avant.
  var b = boitierAppaire();
  var r = TPMS.decoderReglages(TPMS.encoderReglages(b.reglages));
  r.seuils.AV.basBar = 1.6;
  verifier("confirmation : seuil changé → appliqué sans bouton",
    TPMS.liaisonEcrireReglages(b, TPMS.encoderReglages(r), 0) === "ok" && b.reglages.seuils.AV.basBar === 1.6);

  // 2. Protection coupée : en attente, rien n'a changé.
  verifier("confirmation : liste blanche coupée → attente du bouton",
    TPMS.liaisonEcrireReglages(b, sansListeBlanche(b), 1000) === "attente-bouton");
  verifier("confirmation : rien n'est appliqué avant le bouton", b.reglages.protections.listeBlanche === true);
  verifier("confirmation : demande affichée à l'écran",
    TPMS.boitierVue(b, 1000).confirmation === TPMS.SENSIBLE.SANS_LISTE_BLANCHE);
  verifier("confirmation : l'app est prévenue (drapeau de MESURES)",
    TPMS.decoderMesures(TPMS.liaisonMesures(b, 1000)).attenteConfirmation === true);

  // 3. La commande ACQUITTER de l'app (= appui long bouton 2) ne confirme pas.
  TPMS.liaisonCommande(b, TPMS.COMMANDE.ACQUITTER, 2000);
  verifier("confirmation : la commande ACQUITTER de l'app ne confirme pas",
    b.reglages.protections.listeBlanche === true && b.liaison.enAttente !== null);

  // 4. Appui long sur le vrai bouton 2 : appliqué.
  TPMS.boitierBouton(b, 2, true, 3000);
  verifier("confirmation : appui long bouton 2 → appliqué",
    b.reglages.protections.listeBlanche === false && b.liaison.enAttente === null);
  verifier("confirmation : drapeau retombé",
    TPMS.decoderMesures(TPMS.liaisonMesures(b, 3000)).attenteConfirmation === false);
  verifier("confirmation : l'appui de confirmation n'a pas d'autre effet", b.eclairage === false && b.page === 0);

  // 5. Autre bouton : refusé.
  var b2 = boitierAppaire();
  TPMS.liaisonEcrireReglages(b2, sansListeBlanche(b2), 0);
  TPMS.boitierBouton(b2, 1, false, 1000);
  verifier("confirmation : autre bouton → refusé",
    b2.reglages.protections.listeBlanche === true && b2.liaison.enAttente === null && b2.page === 0);

  // 6. Pas de réponse : abandon après 30 s.
  var b3 = boitierAppaire();
  TPMS.liaisonEcrireReglages(b3, sansListeBlanche(b3), 0);
  TPMS.boitierMiseAJour(b3, 29000);
  verifier("confirmation : toujours en attente à 29 s", b3.liaison.enAttente !== null);
  TPMS.boitierMiseAJour(b3, 31000);
  verifier("confirmation : abandon après 30 s",
    b3.liaison.enAttente === null && b3.reglages.protections.listeBlanche === true);
  TPMS.boitierBouton(b3, 2, true, 32000);
  verifier("confirmation : un appui tardif ne confirme plus rien", b3.reglages.protections.listeBlanche === true);

  // 7. Déconnexion du téléphone : abandon.
  var b4 = boitierAppaire();
  TPMS.liaisonEcrireReglages(b4, sansListeBlanche(b4), 0);
  TPMS.liaisonDeconnexion(b4, 1000);
  verifier("confirmation : déconnexion → abandon", b4.liaison.enAttente === null);

  // 8. Le journal chaîné garde la trace de la demande et de la réponse.
  var textes = b.journal.map(function (l) { return l.texte; }).join(" | ");
  verifier("confirmation : demande et confirmation au journal",
    textes.indexOf("App demande : COUPER LISTE BLANCHE (à confirmer)") >= 0 && textes.indexOf("confirmé sur le boîtier") >= 0);
})();

// ---------------------------------------------------------------------
// Énergie
// ---------------------------------------------------------------------
(function () {
  var profil = {
    heuresRoulage: 1, sortiesParJour: 2, heuresEclairage: 0.25, heuresApp: 0.1, alertesParJour: 0,
    fenetreMs: 3000, periodeMs: 5000, periodeEcranMs: 2000, delaiVeilleMs: 300000
  };
  var bilan = TPMS.bilanJournee(profil);
  verifier("énergie : autonomie supérieure à 1 semaine (cahier des charges)",
    bilan.autonomieJours >= 7, bilan.autonomieJours.toFixed(1) + " jours");
  var radio = bilan.postes[2].mAhJour;
  // 1 h de roulage + 2 × 5 min = 1,167 h éveillé × 60 % × 5 mA = 3,5 mAh
  verifier("énergie : poste radio", proche(radio, 1.1667 * 0.6 * 5, 0.01), radio);
  profil.fenetreMs = 5000;   // radio allumée en permanence
  verifier("énergie : écoute continue → autonomie plus courte",
    TPMS.bilanJournee(profil).autonomieJours < bilan.autonomieJours);
  var pile = TPMS.dureeViePileCapteurJours(3000);
  verifier("énergie : pile CR1632 de capteur > 1 an", pile > 365, Math.round(pile) + " jours");
  verifier("énergie : courant en veille = 5 µA",
    TPMS.consoInstantaneeMa({ veille: true }) === 0.005);
})();

// ---------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------
(function () {
  var e = TPMS.creerEcran();
  TPMS.ecranTexte(e, 0, 0, "A", 1, TPMS.NOIR);
  // Colonne 0 du "A" = 0x7E : ligne 0 éteinte, lignes 1 à 6 allumées
  verifier("écran : pixel (0,0) du A blanc", TPMS.ecranLirePixel(e, 0, 0) === 0);
  verifier("écran : pixel (0,1) du A noir", TPMS.ecranLirePixel(e, 0, 1) === 1);
  // 3 chiffres × 6 + point × 3 − 1 = 20 colonnes × 4 = 80 px
  verifier("écran : largeur de \"2.10\" taille 4 = 80 px", TPMS.largeurTexte("2.10", 4) === 80, TPMS.largeurTexte("2.10", 4));
  TPMS.ecranPixel(e, 500, 500, TPMS.NOIR);   // ne doit pas planter
  verifier("écran : pixel hors écran ignoré", true);
  verifier("durée en texte", TPMS.dureeEnTexte(4965) === "1:22:45", TPMS.dureeEnTexte(4965));
})();

// Hystérésis des alertes : une pression qui oscille autour du seuil bas
// ne rallume pas l alerte en boucle.
(function () {
  var seuils = TPMS.seuilsParDefaut();   // AV : bas 1,8 bar
  var roue = { mesure: { pressionBar: 1.78, alarme: 0 }, dernierRecuMs: 0, penteBarH: 0, intrusionJusquaMs: -1, etat: "OK" };
  roue.etat = TPMS.evaluerRoue(roue, "AV", seuils, 1000, 0, true);
  verifier("hystérésis : 1,78 bar → BASSE", roue.etat === "BASSE", roue.etat);
  roue.mesure.pressionBar = 1.82;
  verifier("hystérésis : 1,82 bar reste BASSE (il faut 1,85)", TPMS.evaluerRoue(roue, "AV", seuils, 2000, 0, true) === "BASSE");
  roue.mesure.pressionBar = 1.86;
  verifier("hystérésis : 1,86 bar → OK", TPMS.evaluerRoue(roue, "AV", seuils, 3000, 0, true) === "OK");
})();

// Délai de perte selon la vitesse : en montée lente (5 km/h), le capteur
// peut se croire à l'arrêt et n'annoncer qu'une fois par minute. Le boîtier
// ne crie « capteur perdu » après 60 s qu'au-dessus de 10 km/h.
(function () {
  function silenceApres(vitesseKmh) {
    var b = TPMS.creerBoitier();
    b.reglages.ecouteFenetreMs = b.reglages.ecoutePeriodeMs;
    var trameAV = TPMS.encoderTrame({ numero: 1, adresse: [0xEA, 0xCA, 0x3F, 0x1B, 0x07], pressionBar: 2.2, temperatureC: 20, batteriePct: 90, alarme: 0 });
    TPMS.boitierRecevoirTrame(b, trameAV, 0);
    var periodeTopMs = b.reglages.circonferenceMm / (vitesseKmh / 3.6);   // un tour de roue
    for (var t = periodeTopMs; t <= 90000; t += periodeTopMs) TPMS.boitierTopRoue(b, Math.round(t));
    TPMS.boitierMiseAJour(b, 90000);
    return b.roues.AV.etat;
  }
  verifier("perte : 90 s sans trame à 5 km/h (montée lente) → pas « capteur perdu »", silenceApres(5) !== "PERDU", silenceApres(5));
  verifier("perte : 90 s sans trame à 20 km/h → « capteur perdu »", silenceApres(20) === "PERDU", silenceApres(20));
})();

// ---------------------------------------------------------------------
// Prévision du prochain regonflage
// ---------------------------------------------------------------------
(function () {
  var JOUR = 86400000;
  // Butyle : −0,03 bar par jour, un relevé toutes les 12 h.
  var r = TPMS.creerReleves();
  for (var k = 0; k <= 8; k++) TPMS.relevesAjouter(r, k * JOUR / 2, 2.2 - 0.03 * k / 2);
  // Après 4 jours : 2,08 bar ; seuil 1,8 → (2,08 − 1,8) / 0,03 = 9,33 jours
  var jours = TPMS.predireRegonflage(r, 1.8);
  verifier("prévision : perte de 0,03 bar/j → seuil bas dans 9,3 jours", proche(jours, 9.333, 0.01), jours);
  verifier("prévision : texte écran « 9J »", TPMS.texteJours(jours) === "9J", TPMS.texteJours(jours));

  var court = TPMS.creerReleves();
  for (var i = 0; i < 4; i++) TPMS.relevesAjouter(court, i * 4 * 3600000, 2.2 - 0.01 * i);
  verifier("prévision : moins de 2 jours de recul → pas de prévision", TPMS.predireRegonflage(court, 1.8) === null);
  verifier("prévision : texte écran « -- » sans prévision", TPMS.texteJours(null) === "--");

  var stable = TPMS.creerReleves();
  for (var j = 0; j <= 6; j++) TPMS.relevesAjouter(stable, j * JOUR / 2, 2.2 + (j % 2 ? 0.005 : -0.005));
  var js = TPMS.predireRegonflage(stable, 1.8);
  verifier("prévision : pression stable → infini, texte « >60J »", js === Infinity && TPMS.texteJours(js) === ">60J", js);

  verifier("prévision : un relevé à moins de 3 h du précédent est ignoré",
    TPMS.relevesAjouter(r, 4 * JOUR + 3600000, 2.07) === false);
  TPMS.relevesAjouter(r, 5 * JOUR, 2.5);   // regonflage
  verifier("prévision : un regonflage efface les anciens relevés", r.tMs.length === 1, r.tMs.length);
  verifier("prévision : déjà sous le seuil → 0 jour", TPMS.joursAvantSeuil(1.7, -0.03, 1.8) === 0);

  // Dans le boîtier : les trames acceptées alimentent les relevés.
  var b = TPMS.creerBoitier();
  b.reglages.ecouteFenetreMs = b.reglages.ecoutePeriodeMs;
  for (var d = 0; d < 6; d++) {
    var t = d * JOUR / 2;
    TPMS.boitierRecevoirTrame(b, TPMS.encoderTrame({ numero: 1, adresse: [0xEA, 0xCA, 0x3F, 0x1B, 0x07],
      pressionBar: 2.2 - 0.03 * d / 2, temperatureC: 20, batteriePct: 90, alarme: 0 }), t);
  }
  var vue = TPMS.boitierVue(b, 3 * JOUR);
  verifier("prévision : le boîtier prévoit le regonflage de la roue avant (≈ 10,8 j)",
    vue.roues.AV.joursRegonflage !== null && proche(vue.roues.AV.joursRegonflage, 10.83, 0.2), vue.roues.AV.joursRegonflage);
})();

// ---------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------
(function () {
  // Deux jours : une sortie de 10 min à 18 km/h le jour 0, un regonflage
  // de l'arrière et une sortie avec 2 min d'alerte le jour 1.
  var points = [], t = 0;
  function point(jour, v, d, pAV, pAR, etat, soc) {
    points.push({ tMs: t, jour: jour, vitesseKmh: v, distanceKm: d, pAV: pAV, pAR: pAR, etatAV: etat, etatAR: "OK", soc: soc });
  }
  for (var s = 0; s <= 600; s++) { point(0, 18, 18 * s / 3600, 2.2, 2.4, "OK", 1 - s / 600 * 0.01); t += 1000; }
  t = 86400000;
  point(1, 0, 0, 2.1, 2.3, "OK", 0.99); t += 60000;
  point(1, 0, 0, 2.1, 2.8, "OK", 0.99); t += 1000;   // regonflage arrière
  for (var s2 = 0; s2 <= 300; s2++) { point(1, 20, 20 * s2 / 3600, 2.1, 2.8, s2 < 120 ? "BASSE" : "OK", 0.99); t += 1000; }
  var jours = TPMS.statistiquesParJour(points, 500);
  verifier("stats : 2 jours", jours.length === 2, jours.length);
  verifier("stats : jour 1 = 3 km en 10 min", proche(jours[0].km, 3, 0.01) && proche(jours[0].minutesRoulage, 10, 0.05),
    jours[0].km + " km, " + jours[0].minutesRoulage + " min");
  verifier("stats : pression moyenne avant en roulant = 2,2 bar", proche(jours[0].pMoyAV, 2.2, 1e-9), jours[0].pMoyAV);
  verifier("stats : 5 mAh consommés (1 % de 500 mAh)", proche(jours[0].mAhConsommes, 5, 0.01), jours[0].mAhConsommes);
  verifier("stats : nouvelle sortie le jour 2, compteur reparti de 0 → 1,67 km", proche(jours[1].km, 1.667, 0.01), jours[1].km);
  verifier("stats : 1 regonflage repéré le jour 2", jours[1].regonflages === 1, jours[1].regonflages);
  verifier("stats : 2 min en alerte le jour 2", proche(jours[1].minutesAlerte, 2, 0.05), jours[1].minutesAlerte);
  var semaines = TPMS.statistiquesParSemaine(jours);
  verifier("stats : la semaine additionne les jours (4,67 km, 1 regonflage)",
    semaines.length === 1 && proche(semaines[0].km, 4.667, 0.01) && semaines[0].regonflages === 1, semaines[0].km);
})();

// ---------------------------------------------------------------------
// Pression conseillée
// ---------------------------------------------------------------------
(function () {
  var route = TPMS.pressionConseillee({ masseCyclisteKg: 75, masseVeloKg: 8.5, largeurPneuMm: 25, repartitionAV: 0.4 });
  // 83,5 kg × 60 % = 50,1 kg sur l'arrière ≈ la charge de référence → 6,5 bar
  verifier("conseil : route 25 mm, 75 kg → 6,5 bar à l'arrière", route.AR === 6.5, route.AR);
  verifier("conseil : l'avant, moins chargé, est moins gonflé", route.AV < route.AR, route.AV);
  var lourd = TPMS.pressionConseillee({ masseCyclisteKg: 100, masseVeloKg: 8.5, largeurPneuMm: 25, repartitionAV: 0.4 });
  verifier("conseil : un cycliste plus lourd gonfle plus", lourd.AR > route.AR, lourd.AR);
  var vtt = TPMS.pressionConseillee({ masseCyclisteKg: 75, masseVeloKg: 13.5, largeurPneuMm: 57, repartitionAV: 0.4 });
  verifier("conseil : un pneu large de VTT se gonfle bien moins (< 3 bar)", vtt.AR < 3 && vtt.AV < 3, vtt.AV + " / " + vtt.AR);
  var enfant = TPMS.pressionConseillee({ masseCyclisteKg: 20, masseVeloKg: 8, largeurPneuMm: 57, repartitionAV: 0.4 });
  verifier("conseil : jamais moins de 1 bar", enfant.AV === 1, enfant.AV);
})();

// ---------------------------------------------------------------------
// SHA-256, HMAC et journal chaîné
// ---------------------------------------------------------------------
(function () {
  function h(t) { return TPMS.enHexa(TPMS.sha256(TPMS.texteEnOctets(t))); }
  // Vecteurs de test officiels (FIPS 180-4)
  verifier("sha256 : message vide", h("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", h(""));
  verifier("sha256 : « abc »", h("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h("abc"));
  var long = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  verifier("sha256 : message de 2 blocs", h(long) === "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", h(long));
  // RFC 4231, cas n° 2
  var mac = TPMS.enHexa(TPMS.hmacSha256(TPMS.texteEnOctets("Jefe"), TPMS.texteEnOctets("what do ya want for nothing?")));
  verifier("hmac-sha256 : vecteur RFC 4231", mac === "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", mac);
  verifier("utf-8 : « é » = 2 octets", TPMS.texteEnOctets("é").length === 2);

  var j = TPMS.creerJournalSecurise();
  ["Réveil", "AV : SIGNAL SUSPECT", "Code d'appairage faux (1/3)", "Mise en veille"].forEach(function (t, i) { TPMS.journalAjouter(j, i * 1000, t); });
  verifier("journal : chaîne intacte", TPMS.journalVerifier(j) === -1);
  j.lignes[1].texte = "Rien à signaler";   // on efface la trace de l'attaque
  verifier("journal : ligne modifiée repérée (n° 1)", TPMS.journalVerifier(j) === 1, TPMS.journalVerifier(j));
  var j2 = TPMS.creerJournalSecurise();
  for (var k = 0; k < TPMS.JOURNAL_TAILLE + 10; k++) TPMS.journalAjouter(j2, k, "événement " + k);
  verifier("journal : mémoire pleine, la chaîne se vérifie encore (ancre)", j2.lignes.length === TPMS.JOURNAL_TAILLE && TPMS.journalVerifier(j2) === -1);
  var copie = TPMS.journalDerniereEmpreinte(j2);
  j2.lignes.forEach(function (l, i) {   // réécriture complète, empreintes recalculées
    l.texte = "faux " + i;
    l.precedente = i === 0 ? j2.ancre : j2.lignes[i - 1].empreinte;
    l.empreinte = TPMS.empreinteLigne(l.n, l.tMs, l.texte, l.precedente);
  });
  verifier("journal : réécriture complète invisible à la vérification seule (limite)", TPMS.journalVerifier(j2) === -1);
  verifier("journal : … mais l'empreinte copiée sur le téléphone ne correspond plus", TPMS.journalDerniereEmpreinte(j2) !== copie);
})();

// ---------------------------------------------------------------------
// Capteurs v2 : adresse privée, signature, compteur
// ---------------------------------------------------------------------
(function () {
  var cle = new Uint8Array(16), autre = new Uint8Array(16);
  for (var i = 0; i < 16; i++) { cle[i] = i * 17; autre[i] = 255 - i; }
  var adr = TPMS.adressePrivee(cle, 0x12, 0x34);
  verifier("v2 : le boîtier reconnaît l'adresse privée de son capteur", TPMS.adresseResolue(cle, adr));
  verifier("v2 : une autre clé ne la reconnaît pas", !TPMS.adresseResolue(autre, adr));
  var adr2 = TPMS.adressePrivee(cle, 0x9a, 0x01);
  verifier("v2 : deux adresses du même capteur n'ont rien en commun", adr[2] !== adr2[2] || adr[3] !== adr2[3]);
  var mesure = { numero: 1, pressionBar: 2.2, temperatureC: 20, batteriePct: 90, alarme: 0 };
  var o = TPMS.encoderTrameV2(mesure, cle, adr, 41);
  var d = TPMS.decoderTrameV2(o);
  verifier("v2 : trame de 26 octets décodée (pression, compteur)", o.length === 26 && Math.abs(d.pressionBar - 2.2) < 1e-9 && d.compteur === 41);
  verifier("v2 : signature valide", TPMS.signatureValide(cle, o));
  var trafiquee = o.slice(); trafiquee[8] ^= 0x01;   // un bit de pression changé
  verifier("v2 : un bit changé → signature fausse", !TPMS.signatureValide(cle, trafiquee));
  verifier("v2 : une trame v1 n'est pas une trame v2", TPMS.decoderTrameV2(TPMS.encoderTrame({ numero: 1, adresse: [1, 2, 3, 4, 5], pressionBar: 2, temperatureC: 20, batteriePct: 90, alarme: 0 })) === null);

  // Dans le boîtier
  var b = TPMS.creerBoitier();
  b.reglages.ecouteFenetreMs = b.reglages.ecoutePeriodeMs;
  b.reglages.clesV2 = { AV: cle, AR: autre };
  verifier("v2 boîtier : trame signée acceptée", TPMS.boitierRecevoirTrame(b, o, 0) === "acceptee");
  verifier("v2 boîtier : la même trame rejouée est refusée", TPMS.boitierRecevoirTrame(b, o, 3000) === "rejeu");
  verifier("v2 boîtier : trame mal signée refusée", TPMS.boitierRecevoirTrame(b, trafiquee.map(function (x, i) { return i >= 18 && i < 22 ? (i === 18 ? 99 : 0) : x; }), 6000) === "signature-fausse");
  var pirate = TPMS.encoderTrame({ numero: 1, adresse: TPMS.adresseDepuisTexte("EA:CA:3F:1B:07"), pressionBar: 0.3, temperatureC: 20, batteriePct: 90, alarme: 0 });
  verifier("v2 boîtier : trame en clair du pirate ignorée", TPMS.boitierRecevoirTrame(b, pirate, 9000) === "inconnue");
  verifier("v2 boîtier : compteur suivant accepté", TPMS.boitierRecevoirTrame(b, TPMS.encoderTrameV2(mesure, cle, adr2, 42), 12000) === "acceptee");
})();

// ---------------------------------------------------------------------
// Rythme : rafale d'une vraie crevaison, inondation, homme du milieu
// ---------------------------------------------------------------------
(function () {
  var r = TPMS.creerRythme(), intrusion = false;
  // Vraie crevaison : une trame par seconde, pression qui ne fait que baisser.
  for (var k = 0; k < 10; k++) intrusion = TPMS.controlerRythme(r, k * 1000, 2.2 - 0.25 * k) || intrusion;
  verifier("rythme : la rafale d'une vraie crevaison n'est pas une intrusion", !intrusion);
  var r2 = TPMS.creerRythme(), intrusion2 = false;
  // Pirate mêlé au vrai capteur : 2,2 puis 0,3 puis 2,2… toutes les 0,5 s.
  for (var q = 0; q < 10; q++) intrusion2 = TPMS.controlerRythme(r2, q * 500, q % 2 ? 0.3 : 2.2) || intrusion2;
  verifier("rythme : pirate mêlé au vrai capteur toujours détecté", intrusion2);

  var b = TPMS.creerBoitier();
  b.reglages.ecouteFenetreMs = b.reglages.ecoutePeriodeMs;
  for (var s = 0; s < 8; s++) {
    for (var n = 0; n < 80; n++) {
      TPMS.boitierRecevoirTrame(b, TPMS.encoderTrame({ numero: 1, adresse: [n, s, 7, 7, 7], pressionBar: 2, temperatureC: 20, batteriePct: 90, alarme: 0 }), s * 1000 + n * 10);
    }
    TPMS.boitierMiseAJour(b, s * 1000 + 999);
  }
  verifier("inondation : 80 annonces inconnues/s pendant 5 s → radio saturée", b.radioSaturee);
  verifier("inondation : affichée sur l'écran (SATURE)", TPMS.boitierVue(b, 8000).radioSaturee === true);
  for (var c = 0; c < 12; c++) TPMS.boitierMiseAJour(b, 9000 + c * 1000);
  verifier("inondation : retour au calme après 10 s", !b.radioSaturee);

  var essais = 0;
  function tirer() { essais++; return "000000"; }
  var b1 = TPMS.creerBoitier();
  var sans = TPMS.liaisonAttaqueHommeDuMilieu(b1, "sans-code", 0, tirer);
  verifier("homme du milieu sans code : réussi, seuils changés", sans.reussie && b1.reglages.seuils.AV.basBar === 0.5);
  var b2 = TPMS.creerBoitier();
  b2.liaison.code = "123456"; b2.liaison.codeJusquaMs = 60000;   // code affiché, inconnu du pirate
  var avec = TPMS.liaisonAttaqueHommeDuMilieu(b2, "code", 0, tirer);
  verifier("homme du milieu avec code : échec après 3 essais, appairage bloqué",
    !avec.reussie && essais === 3 && b2.liaison.bloqueJusquaMs > 0 && b2.reglages.seuils.AV.basBar === 1.8);
})();

// ---------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------
resultats.lignes.push("");
resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
if (typeof document !== "undefined") {
  document.getElementById("resultats").textContent = resultats.lignes.join("\n");
  document.title = (resultats.rates === 0 ? "✔ " : "✘ ") + "Tests TPMS";
} else {
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
}
