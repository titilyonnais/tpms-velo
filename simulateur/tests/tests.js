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

  // Même attaque, mais avec l'écoute par fenêtres du boîtier (2 s toutes
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
// Énergie
// ---------------------------------------------------------------------
(function () {
  var profil = {
    heuresRoulage: 1, sortiesParJour: 2, heuresEclairage: 0.25, heuresApp: 0.1, alertesParJour: 0,
    fenetreMs: 2000, periodeMs: 5000, periodeEcranMs: 2000, delaiVeilleMs: 300000
  };
  var bilan = TPMS.bilanJournee(profil);
  verifier("énergie : autonomie supérieure à 1 semaine (cahier des charges)",
    bilan.autonomieJours >= 7, bilan.autonomieJours.toFixed(1) + " jours");
  var radio = bilan.postes[2].mAhJour;
  // 1 h de roulage + 2 × 5 min = 1,167 h éveillé × 40 % × 5 mA = 2,33 mAh
  verifier("énergie : poste radio", proche(radio, 1.1667 * 0.4 * 5, 0.01), radio);
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
