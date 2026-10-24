// =====================================================================
// radio.tests.js — Vérifications automatiques de la radio BLE simulée
// ---------------------------------------------------------------------
// Se lance en ligne de commande : node simulateur/tests/radio.tests.js
// Les tests statistiques utilisent une graine fixe : le résultat est
// toujours le même d'un lancement à l'autre.
// =====================================================================

if (typeof require !== "undefined") {
  ["../monde/alea.js", "../monde/radio.js"].forEach(function (f) {
    require(require("path").join(__dirname, f));
  });
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

function arrondi(x, n) {
  var f = Math.pow(10, n === undefined ? 1 : n);
  return Math.round(x * f) / f;
}

// --- Petits outils pour fabriquer une scène --------------------------

// Nœud radio. Gains d'antenne (hypothèses) : bouchon de valve TPMS
// −2 dBi (antenne minuscule), boîtier XIAO −1 dBi (antenne puce).
function noeud(id, x, y, puissanceDbm, gainDbi) {
  return { id: id, position: { x: x, y: y, z: 1 }, puissanceDbm: puissanceDbm || 0,
           gainAntenneDbi: gainDbi === undefined ? 0 : gainDbi };
}

var TRAME = [];
for (var i = 0; i < 18; i++) TRAME.push(i);

// Scanner qui écoute tout le temps, toujours sur le canal 37
// (intervalle de scan très long).
function scannerFixe37(node) {
  return { node: node, ecoute: function () { return true; }, scanIntervalMs: 1e9, sensibiliteDbm: -95 };
}

function annonce(id, tMs, emetteur, extra, advDelayMs) {
  var e = { id: id, tMs: tMs, octets: TRAME, emetteur: emetteur, extraPerteDb: extra || 0, type: "annonce" };
  if (advDelayMs !== undefined) e.advDelayMs = advDelayMs;
  return e;
}

// Taux de réception d'un lien sur nb événements espacés de 3 s.
function tauxReception(canal, emetteur, recepteur, nb, extra) {
  var recus = 0;
  for (var k = 0; k < nb; k++) {
    var r = TPMS.radioResoudre(canal, [annonce("e" + k, k * 3000, emetteur, extra)], recepteur);
    if (r[0].recu) recus++;
  }
  return recus / nb;
}

// ---------------------------------------------------------------------
// Bilan de liaison
// ---------------------------------------------------------------------
(function () {
  var envs = ["campagne", "ville", "foret", "interieur"];
  var ok = true, detail = [];
  envs.forEach(function (env) {
    var pl1 = TPMS.radioPerteTrajetDb(TPMS.creerCanalRadio({ environnement: env }), 1);
    detail.push(env + "=" + pl1);
    if (pl1 < 45 || pl1 > 60) ok = false;
  });
  verifier("perte à 1 m entre 45 et 60 dB dans tous les environnements", ok, detail.join(" "));

  // RSSI moyen à 1 m, 0 dBm, antennes réalistes, en campagne.
  var canal = TPMS.creerCanalRadio({ environnement: "campagne", graine: 7 });
  var capteur = noeud("capteur", 0, 0, 0, -2);
  var boitier = noeud("boitier", 1, 0, 0, -1);
  var somme = 0, n = 0;
  for (var k = 0; k < 200; k++) {
    var r = TPMS.radioResoudre(canal, [annonce("a" + k, k * 3000, capteur)], scannerFixe37(boitier))[0];
    if (r.recu) { somme += r.rssiDbm; n++; }
  }
  var moyenne = somme / n;
  verifier("RSSI moyen à 1 m pour 0 dBm entre −60 et −45 dBm", moyenne >= -60 && moyenne <= -45, arrondi(moyenne));

  // Décroissance : 10·n dB par décade de distance.
  var ville = TPMS.creerCanalRadio({ environnement: "ville" });
  var pl1v = TPMS.radioPerteTrajetDb(ville, 1), pl10 = TPMS.radioPerteTrajetDb(ville, 10),
      pl100 = TPMS.radioPerteTrajetDb(ville, 100);
  verifier("ville : la perte augmente de 10·n = 32 dB de 1 m à 10 m",
    Math.abs(pl10 - pl1v - 32) < 1e-9, pl10 - pl1v);
  verifier("perte croissante avec la distance (1 m < 10 m < 100 m)", pl1v < pl10 && pl10 < pl100);
  verifier("sous 1 m, pente de l'espace libre (−6 dB à 50 cm)",
    Math.abs(TPMS.radioPerteTrajetDb(ville, 0.5) - (pl1v - 6.02)) < 0.01);

  // RSSI mesuré qui décroît avec la distance (moyenne sur 100 trames).
  var campagne = TPMS.creerCanalRadio({ environnement: "campagne", graine: 3 });
  var moyennes = [1, 10, 50].map(function (d) {
    var b = noeud("b" + d, d, 0, 0, 0), s = 0, c = 0;
    for (var k = 0; k < 100; k++) {
      var r = TPMS.radioResoudre(campagne, [annonce("x", k * 3000, noeud("c", 0, 0, 0, 0))], scannerFixe37(b))[0];
      s += r.puissanceRecueDbm; c++;
    }
    return s / c;
  });
  verifier("RSSI mesuré décroissant : 1 m > 10 m > 50 m",
    moyennes[0] > moyennes[1] && moyennes[1] > moyennes[2], moyennes.map(function (x) { return arrondi(x); }).join(" / "));

  // Gains d'antenne et extraPerteDb s'appliquent dB pour dB.
  var c2 = TPMS.creerCanalRadio({ environnement: "ville", graine: 5 });
  var e1 = noeud("e", 0, 0, 0, 0), r1 = noeud("r", 3, 0, 0, 0);
  var l0 = TPMS.radioLien(c2, e1, r1, 0, 1000);
  var l12 = TPMS.radioLien(c2, e1, r1, 12, 1000);
  verifier("extraPerteDb = 12 → puissance reçue 12 dB plus faible",
    Math.abs(l0.puissanceRecueDbm - l12.puissanceRecueDbm - 12) < 1e-9);
  verifier("radioAttenuationDb = trajet + ombrage + extra",
    Math.abs(TPMS.radioAttenuationDb(c2, e1, r1, 12, 1000) - l12.totalDb) < 1e-9);
})();

// ---------------------------------------------------------------------
// Portée
// ---------------------------------------------------------------------
(function () {
  var pVille = TPMS.radioPorteeM(TPMS.creerCanalRadio({ environnement: "ville" }), 0, -95);
  var pCamp = TPMS.radioPorteeM(TPMS.creerCanalRadio({ environnement: "campagne" }), 0, -95);
  var pForet = TPMS.radioPorteeM(TPMS.creerCanalRadio({ environnement: "foret" }), 0, -95);
  var pInt = TPMS.radioPorteeM(TPMS.creerCanalRadio({ environnement: "interieur" }), 0, -95);
  verifier("portée en ville : quelques dizaines de mètres (15 à 80 m)", pVille >= 15 && pVille <= 80, arrondi(pVille));
  verifier("portée en campagne plus grande qu'en ville et > 80 m", pCamp > pVille && pCamp > 80, arrondi(pCamp));
  verifier("portée en forêt plus courte qu'en campagne", pForet < pCamp, arrondi(pForet));
  verifier("portée en intérieur entre 10 et 60 m", pInt >= 10 && pInt <= 60, arrondi(pInt));
  var pPirate = TPMS.radioPorteeM(TPMS.creerCanalRadio({ environnement: "ville" }), 8 + 2, -95);
  verifier("un pirate à +10 dBm porte plus loin qu'un capteur à 0 dBm", pPirate > pVille, arrondi(pPirate));
  verifier("plancher de bruit en ville ≈ −100 dBm (−105 à −98)",
    (function (b) { return b > -105 && b < -98; })(TPMS.radioPlancherBruitDbm(TPMS.creerCanalRadio({ environnement: "ville" }), -95)),
    arrondi(TPMS.radioPlancherBruitDbm(TPMS.creerCanalRadio({ environnement: "ville" }), -95)));

  // Vérification « terrain » : à mi-portée on reçoit presque tout,
  // à 3 fois la portée presque rien.
  var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: 11 });
  var e = noeud("cap", 0, 0, 0, 0);
  var proche = tauxReception(canal, e, scannerFixe37(noeud("bp", pVille / 2, 0, 0, 0)), 150);
  var loin = tauxReception(canal, e, scannerFixe37(noeud("bl", pVille * 3, 0, 0, 0)), 150);
  verifier("ville : à mi-portée > 80 % des trames reçues", proche > 0.8, arrondi(proche, 2));
  verifier("ville : à 3 × la portée < 15 % des trames reçues", loin < 0.15, arrondi(loin, 2));
})();

// ---------------------------------------------------------------------
// Masquage par la jante
// ---------------------------------------------------------------------
(function () {
  verifier("jante : valve du côté du boîtier → 0 dB", TPMS.radioPerteJanteDb(0) === 0);
  var dos = TPMS.radioPerteJanteDb(180);
  verifier("jante : valve derrière la jante → entre 10 et 15 dB", dos >= 10 && dos <= 15, dos);
  var mi = TPMS.radioPerteJanteDb(90);
  verifier("jante : 90° entre les deux", mi > 0 && mi < dos, mi);
  verifier("jante : symétrique (270° = 90°, −90° = 90°)",
    Math.abs(TPMS.radioPerteJanteDb(270) - mi) < 1e-9 && Math.abs(TPMS.radioPerteJanteDb(-90) - mi) < 1e-9);
  var monotone = true;
  for (var a = 0; a < 180; a += 5) {
    if (TPMS.radioPerteJanteDb(a + 5) < TPMS.radioPerteJanteDb(a)) monotone = false;
  }
  verifier("jante : la perte ne diminue jamais de 0° à 180°", monotone);

  // Effet mesurable : RSSI moyen plus faible valve derrière la jante.
  var canal = TPMS.creerCanalRadio({ environnement: "campagne", graine: 21, wifi: false });
  var cap = noeud("cap", 0, 0, 0, -2), boi = noeud("boi", 1, 0, 0, -1);
  function rssiMoyen(extra) {
    var s = 0, n = 0;
    for (var k = 0; k < 200; k++) {
      var r = TPMS.radioResoudre(canal, [annonce("j", k * 3000, cap, extra)], scannerFixe37(boi))[0];
      s += r.puissanceRecueDbm; n++;
    }
    return s / n;
  }
  var ecart = rssiMoyen(0) - rssiMoyen(TPMS.radioPerteJanteDb(180));
  // Plus de 12 dB : derrière la jante le lien n'est plus en vue directe,
  // l'évanouissement de Rayleigh fait perdre en moyenne ~2,5 dB de plus en dB.
  verifier("jante : RSSI moyen 12 à 16 dB plus faible valve derrière la jante",
    ecart >= 12 && ecart <= 16, arrondi(ecart));
})();

// ---------------------------------------------------------------------
// Paquets d'annonce et scanner
// ---------------------------------------------------------------------
(function () {
  verifier("paquet de 18 octets de données : 288 µs (36 octets à 1 Mbit/s)",
    TPMS.radioDureePaquetUs(18) === 288, TPMS.radioDureePaquetUs(18));

  var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: 4 });
  var pq = TPMS.radioPaquetsAnnonce(canal, annonce("p", 1000, noeud("c", 0, 0)));
  verifier("événement : 3 paquets sur 37, 38, 39 dans cet ordre",
    pq.length === 3 && pq[0].canalBle === 37 && pq[1].canalBle === 38 && pq[2].canalBle === 39);
  verifier("événement : paquets successifs sans chevauchement",
    pq[0].finMs <= pq[1].debutMs && pq[1].finMs <= pq[2].debutMs);
  // Par défaut, la radio n'ajoute PAS d'advDelay : le capteur l'a déjà
  // tiré en programmant son annonce (monde/capteur.js). Sinon il compterait double.
  verifier("advDelay : pas ajouté une 2e fois par la radio (déjà dans l'horaire du capteur)", pq[0].debutMs === 1000, pq[0].debutMs);
  var canalDelay = TPMS.creerCanalRadio({ environnement: "ville", graine: 4, advDelay: true });
  var retard = TPMS.radioPaquetsAnnonce(canalDelay, annonce("p", 1000, noeud("c", 0, 0)))[0].debutMs - 1000;
  verifier("advDelay (émetteur qui ne le tire pas lui-même) : entre 0 et 10 ms", retard >= 0 && retard < 10, retard);
  verifier("événement complet en moins de 2 ms", pq[2].finMs - pq[0].debutMs < 2, pq[2].finMs - pq[0].debutMs);

  var sc = { node: noeud("b", 1, 0), ecoute: function () { return true; }, scanIntervalMs: 100 };
  verifier("scanner : 37 → 38 → 39 → 37 à chaque intervalle de scan",
    TPMS.radioCanalScanner(sc, 50) === 37 && TPMS.radioCanalScanner(sc, 150) === 38 &&
    TPMS.radioCanalScanner(sc, 250) === 39 && TPMS.radioCanalScanner(sc, 350) === 37);

  // Fenêtre fermée → jamais reçu, raison « hors-ecoute ».
  var ferme = { node: noeud("b", 1, 0), ecoute: function () { return false; }, scanIntervalMs: 100, sensibiliteDbm: -95 };
  var tous = true;
  for (var k = 0; k < 50; k++) {
    var r = TPMS.radioResoudre(canal, [annonce("h" + k, k * 3000, noeud("c", 0, 0))], ferme)[0];
    if (r.recu || r.raison !== "hors-ecoute" || r.canalBle !== null) tous = false;
  }
  verifier("scanner fenêtre fermée : rien reçu, raison « hors-ecoute »", tous);

  // Fenêtre ouverte seulement de 0 à 2 s dans chaque période de 5 s
  // (comme TPMS.boitierEcoute) : une trame à 3,5 s est perdue.
  var fenetre = { node: noeud("b", 1, 0), scanIntervalMs: 1e9, sensibiliteDbm: -95,
    ecoute: function (t) { return (t % 5000) < 2000; } };
  var dans = TPMS.radioResoudre(canal, [annonce("d", 1000, noeud("c", 0, 0), 0, 0)], fenetre)[0];
  var hors = TPMS.radioResoudre(canal, [annonce("o", 3500, noeud("c", 0, 0), 0, 0)], fenetre)[0];
  verifier("fenêtre d'écoute : reçu dedans, perdu dehors",
    dans.recu && dans.canalBle === 37 && !hors.recu && hors.raison === "hors-ecoute", dans.raison + "/" + hors.raison);

  // Le scanner sur 38 reçoit le 2e paquet.
  var sur38 = { node: noeud("b", 1, 0), ecoute: function () { return true; }, scanIntervalMs: 1e9, scanOrigineMs: -1e9 };
  var r38 = TPMS.radioResoudre(canal, [annonce("q", 500, noeud("c", 0, 0), 0, 0)], sur38)[0];
  verifier("scanner sur le canal 38 : trame reçue sur 38", r38.recu && r38.canalBle === 38, r38.canalBle);

  // Paquet coupé par un changement de canal du scanner → perdu.
  var bascule = { node: noeud("b", 1, 0), ecoute: function () { return true; }, scanIntervalMs: 100 };
  // Paquet 37 de 99,9 à 100,188 ms : le scanner passe à 38 à 100 ms.
  var coupe = TPMS.radioResoudre(canal, [annonce("z", 99.9, noeud("c", 0, 0), 0, 0)], bascule)[0];
  verifier("paquet à cheval sur un changement de canal : ce paquet est perdu",
    coupe.paquets[0].raison === "hors-ecoute", coupe.paquets[0].raison);
  verifier("... mais le paquet suivant (38) est reçu", coupe.recu && coupe.canalBle === 38, coupe.canalBle);

  // Résultats dans le même ordre que les émissions données.
  var em = [annonce("C", 9000, noeud("c3", 0, 0)), annonce("A", 1000, noeud("c1", 0, 0)),
            annonce("B", 5000, noeud("c2", 0, 0))];
  var res = TPMS.radioResoudre(canal, em, scannerFixe37(noeud("b", 1, 0)));
  verifier("résultats dans l'ordre des émissions", res.length === 3 && res[0].id === "C" && res[1].id === "A" && res[2].id === "B");
})();

// ---------------------------------------------------------------------
// Collisions et effet de capture
// ---------------------------------------------------------------------
(function () {
  var canal = TPMS.creerCanalRadio({ environnement: "campagne", graine: 9, wifi: false });
  var boitier = noeud("boitier", 0, 0);
  var sc = scannerFixe37(boitier);

  // Deux capteurs à 1 m, symétriques, même instant, sans advDelay.
  var c1 = noeud("c1", 1, 0), c2 = noeud("c2", -1, 0);
  var r = TPMS.radioResoudre(canal, [annonce("A", 1000, c1, 0, 0), annonce("B", 1000, c2, 0, 0)], sc);
  // Niveaux proches (< 6 dB d'écart) : les deux sont perdus.
  var ecart = Math.abs(r[0].puissanceRecueDbm - r[1].puissanceRecueDbm);
  verifier("collision : deux annonces simultanées de même niveau → perdues toutes les deux",
    ecart < 6 && r[0].raison === "collision" && r[1].raison === "collision",
    r[0].raison + "/" + r[1].raison + " écart " + arrondi(ecart));

  // Capture : l'un à 1 m, l'autre à 40 m (bien plus faible).
  var loin = noeud("c3", 40, 0);
  var rc = TPMS.radioResoudre(canal, [annonce("fort", 2000, c1, 0, 0), annonce("faible", 2000, loin, 0, 0)], sc);
  verifier("effet de capture : le plus fort (≥ 6 dB) est reçu",
    rc[0].recu && rc[0].raison === "ok", rc[0].raison);
  verifier("effet de capture : le plus faible est perdu par collision", rc[1].raison === "collision", rc[1].raison);

  // Capture réussie avec un interférent seulement 6 à 12 dB plus faible
  // (à 2-3 m) : le paquet capturé est reçu, l'interférent ne compte plus
  // dans le bruit (sinon un RSB de 6 dB rendait la capture inutile).
  var captures = 0, recusApresCapture = 0;
  [2, 3].forEach(function (dist) {
    for (var k = 0; k < 150; k++) {
      var rk = TPMS.radioResoudre(canal, [annonce("F" + dist + "-" + k, 10000 + k * 1000, c1, 0, 0),
        annonce("f" + dist + "-" + k, 10000 + k * 1000, noeud("c4", dist, 0), 0, 0)], sc);
      var p0 = rk[0].paquets[0];
      if (p0.raison !== "collision") { captures++; if (p0.raison === "ok") recusApresCapture++; }
    }
  });
  verifier("effet de capture (≥ 6 dB) : le paquet capturé est reçu (≥ 95 %)",
    captures > 100 && recusApresCapture / captures >= 0.95, recusApresCapture + "/" + captures);

  // Décalés de 5 ms : plus de chevauchement, les deux passent.
  var rd = TPMS.radioResoudre(canal, [annonce("A", 3000, c1, 0, 0), annonce("B", 3005, c2, 0, 0)], sc);
  verifier("annonces décalées de 5 ms : pas de collision", rd[0].recu && rd[1].recu, rd[0].raison + "/" + rd[1].raison);

  // Avec l'advDelay de la norme, deux capteurs réglés au même instant
  // ne se percutent presque jamais.
  var canalAvecDelay = TPMS.creerCanalRadio({ environnement: "campagne", graine: 9, wifi: false, advDelay: true });
  var collisions = 0;
  for (var k = 0; k < 200; k++) {
    var rr = TPMS.radioResoudre(canalAvecDelay, [annonce("A" + k, k * 3000, c1), annonce("B" + k, k * 3000, c2)], sc);
    if (rr[0].raison === "collision" || rr[1].raison === "collision") collisions++;
  }
  verifier("avec advDelay (0-10 ms), collisions rares (< 10 %)", collisions / 200 < 0.1, collisions + "/200");
})();

// ---------------------------------------------------------------------
// Brouillage
// ---------------------------------------------------------------------
(function () {
  var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: 13 });
  var boitier = noeud("boitier", 0, 0, 0, -1);
  var capteur = noeud("capteur", 1, 0, 0, -2);
  var pirate = noeud("pirate", 3, 0, 8, 2);     // ESP32 à +8 dBm, à 3 m
  var sc = scannerFixe37(boitier);
  var recus = 0, brouillees = 0;
  for (var k = 0; k < 100; k++) {
    var r = TPMS.radioResoudre(canal, [
      annonce("t" + k, k * 3000, capteur),
      { id: "j" + k, tMs: k * 3000, octets: null, emetteur: pirate, extraPerteDb: 0, type: "brouillage" }
    ], sc);
    if (r[0].recu) recus++;
    if (r[0].raison === "brouillee") brouillees++;
    if (k === 0) {
      verifier("brouillage : résultat du brouilleur non reçu, raison « brouillage »",
        r[1].recu === false && r[1].raison === "brouillage" && typeof r[1].rssiDbm === "number");
    }
  }
  verifier("brouillage à 3 m : (presque) plus aucune trame reçue", recus <= 5, recus + "/100");
  verifier("brouillage : la raison est « brouillee »", brouillees >= 90, brouillees + "/100");

  var loin = noeud("pirateLoin", 2000, 0, 8, 2);
  var recusLoin = 0;
  for (var j = 0; j < 100; j++) {
    var rl = TPMS.radioResoudre(canal, [
      annonce("u" + j, j * 3000, capteur),
      { id: "k" + j, tMs: j * 3000, octets: null, emetteur: loin, extraPerteDb: 0, type: "brouillage" }
    ], sc);
    if (rl[0].recu) recusLoin++;
  }
  verifier("brouilleur à 2 km : sans effet (> 90 % reçues)", recusLoin > 90, recusLoin + "/100");
})();

// ---------------------------------------------------------------------
// Taux d'erreur
// ---------------------------------------------------------------------
(function () {
  var tep = TPMS.radioTauxErreurPaquet(TPMS.RADIO_RSB_REFERENCE_DB, 280);
  verifier("à la sensibilité (TEB 0,1 %), paquet de 280 bits perdu ≈ 1 fois sur 4",
    tep > 0.2 && tep < 0.3, arrondi(tep, 3));
  verifier("TEB = 0,1 % au RSB de référence",
    Math.abs(TPMS.radioTauxErreurBinaire(TPMS.RADIO_RSB_REFERENCE_DB) - 0.001) < 1e-9);
  verifier("RSB 20 dB → paquet quasi toujours bon", TPMS.radioTauxErreurPaquet(20, 280) < 1e-6);
  verifier("RSB 3 dB → paquet quasi toujours perdu", TPMS.radioTauxErreurPaquet(3, 280) > 0.999);

  // Trop faible : capteur à 500 m en ville.
  var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: 2 });
  var r = TPMS.radioResoudre(canal, [annonce("f", 0, noeud("c", 500, 0))], scannerFixe37(noeud("b", 0, 0)))[0];
  verifier("capteur à 500 m en ville : « trop-faible »", !r.recu && r.raison === "trop-faible", r.raison + " " + r.rssiDbm);
})();

// ---------------------------------------------------------------------
// Évanouissement rapide : Rice (vue directe) et Rayleigh (obstrué)
// ---------------------------------------------------------------------
(function () {
  var alea = TPMS.creerAlea(123);
  var N = 20000, moyRay = 0, moyRice = 0, creuxRay = 0, creuxRice = 0;
  for (var k = 0; k < N; k++) {
    var ray = TPMS.radioEvanouissementDb(alea, null);
    var ric = TPMS.radioEvanouissementDb(alea, 9);
    moyRay += Math.pow(10, ray / 10);
    moyRice += Math.pow(10, ric / 10);
    if (ray < -10) creuxRay++;
    if (ric < -10) creuxRice++;
  }
  verifier("évanouissement : puissance moyenne = 1 (0 dB) pour Rayleigh et Rice",
    Math.abs(moyRay / N - 1) < 0.03 && Math.abs(moyRice / N - 1) < 0.03,
    arrondi(moyRay / N, 3) + " / " + arrondi(moyRice / N, 3));
  // Rayleigh : P(creux < −10 dB) = 1 − e^(−0,1) ≈ 9,5 %.
  verifier("Rayleigh : ≈ 9,5 % de creux sous −10 dB", Math.abs(creuxRay / N - 0.095) < 0.01, arrondi(creuxRay / N, 3));
  verifier("Rice (K = 9 dB) : creux profonds bien plus rares (< 1 %)", creuxRice / N < 0.01, arrondi(creuxRice / N, 4));
})();

// ---------------------------------------------------------------------
// Ombrage corrélé dans le temps
// ---------------------------------------------------------------------
(function () {
  var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: 31 });
  var e = noeud("e", 0, 0), r = noeud("r", 50, 0);
  // Immobile, échantillonné toutes les 100 ms pendant 10 min.
  var precedent = null, sautMax = 0, valeurs = [];
  for (var t = 0; t <= 600000; t += 100) {
    var o = TPMS.radioLien(canal, e, r, 0, t).ombrageDb;
    if (precedent !== null) sautMax = Math.max(sautMax, Math.abs(o - precedent));
    precedent = o;
    valeurs.push(o);
  }
  verifier("ombrage immobile : variation < 0,6 dB en 100 ms", sautMax < 0.6, arrondi(sautMax, 3));
  var moy = valeurs.reduce(function (a, b) { return a + b; }, 0) / valeurs.length;
  var ecartType = Math.sqrt(valeurs.reduce(function (a, b) { return a + (b - moy) * (b - moy); }, 0) / valeurs.length);
  var sigma = TPMS.radioSigmaOmbrageDb(canal, 50);
  verifier("ombrage sur 10 min : écart-type du même ordre que sigma (0,4 à 1,6 sigma)",
    ecartType > 0.4 * sigma && ecartType < 1.6 * sigma, arrondi(ecartType) + " dB pour sigma " + arrondi(sigma));

  // En roulant à 5 m/s (18 km/h), ça varie plus vite, mais sans sauter.
  var c2 = TPMS.creerCanalRadio({ environnement: "ville", graine: 31 });
  var em = noeud("e", 0, 0), rm = noeud("r", 50, 0);
  var prec = null, sautMob = 0, debut = null, fin = null;
  for (var t2 = 0; t2 <= 60000; t2 += 100) {
    em.position.x = 5 * t2 / 1000; rm.position.x = 50 + 5 * t2 / 1000;   // les deux avancent
    var om = TPMS.radioLien(c2, em, rm, 0, t2).ombrageDb;
    if (prec !== null) sautMob = Math.max(sautMob, Math.abs(om - prec));
    if (debut === null) debut = om;
    fin = om;
    prec = om;
  }
  verifier("ombrage en mouvement (5 m/s) : variation < 2,5 dB en 100 ms (0,5 m parcouru)", sautMob < 2.5, arrondi(sautMob, 3));

  // Interroger plus souvent ne change pas la valeur (indépendant de l'interface).
  var ca = TPMS.creerCanalRadio({ environnement: "ville", graine: 31 });
  var cb = TPMS.creerCanalRadio({ environnement: "ville", graine: 31 });
  for (var t3 = 0; t3 <= 10000; t3 += 10) TPMS.radioLien(ca, e, r, 0, t3);
  var va = TPMS.radioLien(ca, e, r, 0, 10000).ombrageDb;
  var vb = TPMS.radioLien(cb, e, r, 0, 10000).ombrageDb;
  verifier("ombrage identique qu'on l'interroge 1 000 fois ou 1 fois", Math.abs(va - vb) < 1e-9, va + " / " + vb);
  verifier("ombrage réciproque (A→B = B→A)",
    Math.abs(TPMS.radioLien(cb, r, e, 0, 10000).ombrageDb - vb) < 1e-9);
})();

// ---------------------------------------------------------------------
// Reproductibilité
// ---------------------------------------------------------------------
(function () {
  function scenario(graine, melanger) {
    var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: graine });
    var boitier = noeud("boitier", 0, 0, 0, -1);
    var sc = { node: boitier, ecoute: function (t) { return (t % 5000) < 2000; }, scanIntervalMs: 100, sensibiliteDbm: -95 };
    var sortie = [];
    for (var pas = 0; pas < 60; pas++) {
      var t = pas * 1000;
      var em = [
        annonce("av" + pas, t + 10, noeud("AV", 0.6, 0, 0, -2), TPMS.radioPerteJanteDb(pas * 47)),
        annonce("ar" + pas, t + 400, noeud("AR", -0.5, 0, 0, -2), TPMS.radioPerteJanteDb(pas * 61)),
        annonce("pi" + pas, t + 15, noeud("pirate", 8, 3, 8, 2))
      ];
      if (melanger) em.reverse();
      var res = TPMS.radioResoudre(canal, em, sc);
      res.forEach(function (x) { sortie.push(x.id + ":" + x.recu + ":" + x.raison + ":" + x.rssiDbm + ":" + x.canalBle); });
    }
    sortie.sort();
    return sortie.join("|");
  }
  var a = scenario(42, false), b = scenario(42, false), c = scenario(43, false), d = scenario(42, true);
  verifier("même graine → exactement les mêmes résultats", a === b);
  verifier("autre graine → résultats différents", a !== c);
  verifier("ordre des émissions sans effet sur le résultat", a === d);
})();

// ---------------------------------------------------------------------
// Scène réaliste : le vélo en ville
// ---------------------------------------------------------------------
(function () {
  var canal = TPMS.creerCanalRadio({ environnement: "ville", graine: 77 });
  var boitier = noeud("boitier", 0, 0, 0, -1);
  var sc = scannerFixe37(boitier);
  var stats = TPMS.creerStatsRadio();
  for (var k = 0; k < 300; k++) {
    var res = TPMS.radioResoudre(canal, [
      annonce("av" + k, k * 3000, noeud("AV", 0.6, 0, 0, -2), TPMS.radioPerteJanteDb(k * 73)),
      annonce("ar" + k, k * 3000 + 1500, noeud("AR", 0.5, 0, 0, -2), TPMS.radioPerteJanteDb(k * 59) + 6)
    ], sc);
    TPMS.radioCompter(stats, res);
  }
  var taux = stats.recues / stats.emises;
  verifier("vélo en ville, capteurs à < 1 m : > 95 % des trames reçues", taux > 0.95, arrondi(taux, 3));
  verifier("statistiques : total des raisons = trames émises",
    Object.keys(stats.raisons).reduce(function (s, r) { return s + stats.raisons[r]; }, 0) === stats.emises);
  // Moyenne réaliste ; les extrêmes vont plus bas (valve derrière la
  // jante + creux de Rayleigh : −85 dBm possible même à 60 cm).
  var moyenne = stats.sommeRssiDbm / stats.recues;
  verifier("statistiques : RSSI moyen entre −75 et −45 dBm, max ≤ −40 dBm",
    moyenne >= -75 && moyenne <= -45 && stats.rssiMaxDbm <= -40,
    arrondi(moyenne) + " (" + stats.rssiMinDbm + " … " + stats.rssiMaxDbm + ")");
})();

// ---------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------
resultats.lignes.push("");
resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
if (typeof document !== "undefined") {
  document.getElementById("resultats").textContent = resultats.lignes.join("\n");
} else {
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
}
