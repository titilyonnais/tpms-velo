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
    "../logique/trame.js", "../logique/vitesse.js", "../logique/fuite.js",
    "../logique/alertes.js", "../logique/securite.js",
    "../boitier/police5x7.js", "../boitier/epaper.js",
    "../boitier/ecran.js", "../boitier/boitier.js"
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
  verifier("moins de 5 min : pas de conclusion", TPMS.historiquePenteBarH(court) === 0);

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
// Écran
// ---------------------------------------------------------------------
(function () {
  var e = TPMS.creerEcran();
  TPMS.ecranTexte(e, 0, 0, "A", 1, TPMS.NOIR);
  // Colonne 0 du "A" = 0x7E : ligne 0 éteinte, lignes 1 à 6 allumées
  verifier("écran : pixel (0,0) du A blanc", TPMS.ecranLirePixel(e, 0, 0) === 0);
  verifier("écran : pixel (0,1) du A noir", TPMS.ecranLirePixel(e, 0, 1) === 1);
  verifier("écran : largeur de \"2.10\" taille 4 = 92 px", TPMS.largeurTexte("2.10", 4) === 92);
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
