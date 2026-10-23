// =====================================================================
// serveur.tests.js — Vérifications du serveur de flotte et de la
// simulation de la flotte.
// ---------------------------------------------------------------------
// Se lance en ligne de commande : node serveur/serveur.tests.js
// Chaque test démarre un serveur sur un port libre, avec une base EN
// MÉMOIRE (rien n'est écrit sur le disque), puis l'arrête.
// =====================================================================
var path = require("node:path");
var fs = require("node:fs");
var os = require("node:os");
var crypto = require("node:crypto");
var TPMS = require("../flotte/node.js");
var outils = require("./serveur.js");
var client = require("./flotte-vers-serveur.js");
var certificat = require("./generer-certificat.js");
var ouvrirBase = require("./base.js").ouvrirBase;

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

function proche(a, b, tolerance) { return Math.abs(a - b) <= tolerance; }

var CLES = outils.chargerCles(path.join(__dirname, "cles-demo.json"));
// Jetons des comptes de démo (en clair dans le fichier de démo).
var COMPTES_DEMO = JSON.parse(fs.readFileSync(path.join(__dirname, "cles-demo.json"), "utf8")).comptes;
var JETON_TECHNICIEN = COMPTES_DEMO.technicien.jeton;
var JETON_GESTIONNAIRE = COMPTES_DEMO.gestionnaire.jeton;

// Démarre un serveur de test ; renvoie { url, serveur, client }.
function demarrer(options) {
  var o = Object.assign({ cheminBase: ":memory:", cles: CLES, journal: false }, options || {});
  var serveur = outils.creerServeur(o);
  return new Promise(function (ok) {
    serveur.listen(0, "127.0.0.1", function () {
      var url = (o.tls ? "https" : "http") + "://127.0.0.1:" + serveur.address().port;
      ok({ url: url, serveur: serveur, client: client.creerClient(url, CLES, { ca: o.ca }) });
    });
  });
}
function arreter(s) {
  return new Promise(function (ok) { s.serveur.closeAllConnections(); s.serveur.close(ok); });
}
// Lecture de l'API. Par défaut avec le compte « gestionnaire » (tous les
// droits) ; jeton = null : sans en-tête Authorization ; ou un autre jeton.
async function lire(s, chemin, jeton) {
  var enTetes = {};
  var j = jeton === undefined ? JETON_GESTIONNAIRE : jeton;
  if (j !== null) enTetes.Authorization = j.indexOf(" ") >= 0 ? j : "Bearer " + j;
  var r = await fetch(s.url + chemin, { headers: enTetes });
  var json = null;
  try { json = await r.json(); } catch (e) { /* pas de JSON */ }
  return { statut: r.status, json: json, enTetes: r.headers };
}

// Une mesure valide, datée de « il y a ageMs ».
function mesure(ageMs, modifs) {
  var m = {
    t: Date.now() - (ageMs || 60000), pAv: 2.45, pAr: 2.65, tAv: 15.2, tAr: 15.4, pileAv: 95, pileAr: 93,
    batterie: 80, lat: 45.7578, lon: 4.832, km: 1234.5, etatAv: "OK", etatAr: "OK", enLocation: false
  };
  return Object.assign(m, modifs || {});
}

async function nbMesuresEnBase(s) {
  return s.serveur.base.db.prepare("SELECT COUNT(*) AS n FROM mesures").get().n;
}

// ---------------------------------------------------------------------
// 1. Authentification, anti-rejeu, validation
// ---------------------------------------------------------------------
async function testsSecurite() {
  var s = await demarrer();
  var c = s.client;

  // Signature valide
  var req = c.preparer("V01", [mesure(120000), mesure(60000)]);
  var r = await c.envoyer(req);
  verifier("signature valide : lot accepté (201)", r.statut === 201 && r.json.acceptees === 2, r.statut + " " + JSON.stringify(r.json));
  var velos = (await lire(s, "/api/velos")).json.velos;
  var v01 = velos.filter(function (v) { return v.id === "V01"; })[0];
  verifier("signature valide : la dernière mesure de V01 est visible", v01 && v01.pAv === 2.45 && v01.statut === "ok", v01 && v01.statut);

  // Rejeu exact de la même requête
  r = await c.envoyer(req);
  verifier("rejeu de la même requête : refusé (401 rejeu)", r.statut === 401 && r.json.motif === "rejeu", r.statut + " " + (r.json && r.json.motif));

  // Signature fausse : corps modifié après signature
  var avant = await nbMesuresEnBase(s);
  var falsifie = c.preparer("V01", [mesure(30000)]);
  falsifie.corps = falsifie.corps.replace("2.45", "3.10");
  r = await c.envoyer(falsifie);
  verifier("corps modifié après signature : refusé (401 signature)", r.statut === 401 && r.json.motif === "signature", r.statut);
  verifier("corps modifié : rien n'est enregistré", (await nbMesuresEnBase(s)) === avant);

  // Mauvaise clé (usurpation d'un vélo avec la clé d'un autre)
  r = await c.envoyer(c.preparer("V01", [mesure(30000)], { cleDe: "V02" }));
  verifier("signé avec la clé de V02 en se disant V01 : refusé", r.statut === 401 && r.json.motif === "signature", r.statut);

  // Signature au mauvais format
  var mauvaise = c.preparer("V01", [mesure(30000)]);
  mauvaise.enTetes["X-Signature"] = "zz";
  r = await c.envoyer(mauvaise);
  verifier("signature mal formée : refusée (400)", r.statut === 400 && r.json.motif === "en-tetes", r.statut);

  // Horodatage trop vieux / dans le futur (mais correctement signé)
  r = await c.envoyer(c.preparer("V01", [mesure(30000)], { horodatageMs: Date.now() - 120000 }));
  verifier("horodatage vieux de 2 min : refusé (401 horodatage)", r.statut === 401 && r.json.motif === "horodatage", r.statut);
  r = await c.envoyer(c.preparer("V01", [mesure(30000)], { horodatageMs: Date.now() + 120000 }));
  verifier("horodatage 2 min dans le futur : refusé", r.statut === 401 && r.json.motif === "horodatage", r.statut);

  // Séquence qui redescend (requête ancienne mais re-signée par un vélo mal réglé)
  var ancienne = c.preparer("V03", [mesure(30000)]);
  var recente = c.preparer("V03", [mesure(20000)]);
  r = await c.envoyer(recente);
  verifier("séquence récente acceptée", r.statut === 201, r.statut);
  r = await c.envoyer(ancienne);
  verifier("séquence plus petite que la dernière : refusée (rejeu)", r.statut === 401 && r.json.motif === "rejeu", r.statut);

  // Valeurs hors plage, champs inconnus, JSON invalide (requêtes bien signées)
  async function rejet(nom, mesures, attendu) {
    var rep = await c.envoyer(c.preparer("V04", mesures));
    verifier(nom, rep.statut === 400 && rep.json.motif === (attendu || "validation"), rep.statut + " " + (rep.json && rep.json.erreur));
  }
  await rejet("pression de 12 bar : refusée (400)", [mesure(30000, { pAv: 12 })]);
  await rejet("pression négative : refusée", [mesure(30000, { pAr: -0.5 })]);
  await rejet("température de 200 °C : refusée", [mesure(30000, { tAv: 200 })]);
  await rejet("pile à 150 % : refusée", [mesure(30000, { pileAv: 150 })]);
  await rejet("pression en texte : refusée", [mesure(30000, { pAv: "2.4" })]);
  await rejet("état inconnu : refusé", [mesure(30000, { etatAv: "OK'); DROP TABLE mesures;--" })]);
  await rejet("champ inconnu : refusé", [mesure(30000, { admin: true })]);
  await rejet("mesure datée dans le futur : refusée", [mesure(-3600000)]);
  await rejet("dates non croissantes : refusées", [mesure(30000), mesure(60000)]);
  var json = c.preparer("V04", []);
  json.corps = "{ pas du json";
  json.enTetes["X-Signature"] = outils.signer(CLES.get("V04"),
    TPMS.flotteMessageASigner("V04", json.enTetes["X-Horodatage"], json.enTetes["X-Sequence"], json.corps));
  r = await c.envoyer(json);
  verifier("JSON invalide (bien signé) : refusé (400 json)", r.statut === 400 && r.json.motif === "json", r.statut);

  // Vélo inconnu
  var inconnu = c.preparer("V01", [mesure(30000)]);
  inconnu.enTetes["X-Velo-Id"] = "V99";
  r = await c.envoyer(inconnu);
  verifier("vélo inconnu (V99) : refusé (401)", r.statut === 401 && r.json.motif === "inconnu", r.statut);

  // Injection SQL dans l'identifiant
  var nbVelos = s.serveur.base.db.prepare("SELECT COUNT(*) AS n FROM velos").get().n;
  var mesuresAvant = await nbMesuresEnBase(s);
  var injection = c.preparer("V01", [mesure(30000)]);
  injection.enTetes["X-Velo-Id"] = "V01'; DROP TABLE mesures; --";
  r = await c.envoyer(injection);
  verifier("injection SQL dans X-Velo-Id : refusée (400)", r.statut === 400 && r.json.motif === "identifiant", r.statut);
  var h = await lire(s, "/api/velos/" + encodeURIComponent("V01' OR '1'='1") + "/historique");
  verifier("injection SQL dans l'adresse de l'historique : refusée (400)", h.statut === 400, h.statut);
  // Même en passant la barrière du format, la requête paramétrée ne trouve rien
  var direct = s.serveur.base.historique("V01' OR '1'='1", 0);
  verifier("requête paramétrée : « V01' OR '1'='1 » ne renvoie aucune mesure", direct.mesures.length === 0, direct.mesures.length);
  verifier("injection SQL : tables intactes",
    s.serveur.base.db.prepare("SELECT COUNT(*) AS n FROM velos").get().n === nbVelos && (await nbMesuresEnBase(s)) === mesuresAvant);
  var refus = (await lire(s, "/api/refus?limite=50")).json.refus;
  var traceInjection = refus.filter(function (x) { return x.motif === "identifiant"; })[0];
  verifier("journal des refus : l'identifiant piégé est gardé comme simple texte",
    traceInjection && traceInjection.velo === "V01'; DROP TABLE mesures; --", traceInjection && traceInjection.velo);

  // Corps trop gros
  var gros = c.preparer("V05", [mesure(30000)]);
  gros.corps = gros.corps + " ".repeat(TPMS.FLOTTE_SECURITE.corpsMaxOctets + 10);
  r = await c.envoyer(gros);
  verifier("corps de plus de 64 Kio : refusé (413)", r.statut === 413, r.statut);

  // Mauvais type de contenu
  var texte = c.preparer("V05", [mesure(30000)]);
  texte.enTetes["Content-Type"] = "text/plain";
  r = await c.envoyer(texte);
  verifier("Content-Type text/plain : refusé (415)", r.statut === 415, r.statut);

  // Journal des refus et statistiques de sécurité
  var stats = (await lire(s, "/api/statistiques")).json;
  var motifs = {};
  stats.securite.refusParMotif.forEach(function (m) { motifs[m.motif] = m.n; });
  verifier("statistiques : refus comptés par motif (signature, rejeu, horodatage, validation)",
    motifs.signature >= 2 && motifs.rejeu >= 2 && motifs.horodatage >= 2 && motifs.validation >= 9, JSON.stringify(motifs));

  // En-têtes de sécurité et fichiers statiques
  var page = await fetch(s.url + "/flotte/");
  verifier("la page /flotte/ est servie", page.status === 200 && (page.headers.get("content-type") || "").indexOf("text/html") === 0, page.status);
  verifier("en-têtes de sécurité présents (CSP, nosniff, frame)",
    /default-src 'self'/.test(page.headers.get("content-security-policy") || "") &&
    page.headers.get("x-content-type-options") === "nosniff" && page.headers.get("x-frame-options") === "SAMEORIGIN");
  verifier("réponses de l'API non mises en cache", (await lire(s, "/api/velos")).enTetes.get("cache-control") === "no-store");
  verifier("les clés de démo ne sont pas servies", (await fetch(s.url + "/serveur/cles-demo.json")).status === 403);
  verifier("sortie du dépôt par ../ impossible", [403, 404, 400].indexOf((await fetch(s.url + "/..%2f..%2f..%2fWindows/win.ini")).status) >= 0);
  verifier("fichiers cachés (.git) non servis", (await fetch(s.url + "/.git/config")).status === 403);

  await arreter(s);
}

// ---------------------------------------------------------------------
// 2. Limitation de débit et blocage d'adresse
// ---------------------------------------------------------------------
async function testsDebit() {
  var s = await demarrer({ requetesParMinute: 5 });
  var statuts = [];
  for (var i = 0; i < 7; i++) {
    statuts.push((await s.client.envoyer(s.client.preparer("V06", [mesure(60000 - i * 1000)]))).statut);
  }
  verifier("limitation de débit : 5 requêtes acceptées, puis 429", statuts.slice(0, 5).every(function (x) { return x === 201; }) &&
    statuts[5] === 429 && statuts[6] === 429, statuts.join(","));
  var autre = await s.client.envoyer(s.client.preparer("V07", [mesure(30000)]));
  verifier("limitation par vélo : V07 n'est pas pénalisé par V06", autre.statut === 201, autre.statut);
  await arreter(s);

  s = await demarrer({ refusParMinuteMax: 3 });
  for (var k = 0; k < 4; k++) {
    var faux = s.client.preparer("V08", [mesure(30000)]);
    faux.enTetes["X-Signature"] = "0".repeat(64);
    await s.client.envoyer(faux);
  }
  var bloque = await s.client.envoyer(s.client.preparer("V08", [mesure(30000)]));
  verifier("après 4 signatures fausses, l'adresse IP est bloquée (429)", bloque.statut === 429 && bloque.json.motif === "ip-bloquee", bloque.statut);
  await arreter(s);
}

// ---------------------------------------------------------------------
// 3. Simulation de la flotte
// ---------------------------------------------------------------------
function empreinte(objet) {
  return crypto.createHash("sha256").update(JSON.stringify(objet)).digest("hex");
}

function testsSimulation() {
  function lancer(graine) {
    var f = TPMS.creerFlotte({ graine: graine, garderLots: true });
    TPMS.flotteAvancer(f, 3 * 86400);
    return { lots: TPMS.flotteLotsAEnvoyer(f), f: f };
  }
  var a = lancer(42), b = lancer(42), c = lancer(43);
  verifier("flotte : même graine → mêmes lots, au bit près", empreinte(a.lots) === empreinte(b.lots));
  verifier("flotte : autre graine → autres lots", empreinte(a.lots) !== empreinte(c.lots));
  verifier("flotte : 20 vélos répartis sur 6 stations", a.f.velos.length === 20 && TPMS.FLOTTE_STATIONS.length === 6);
  var mesures = 0;
  a.lots.forEach(function (l) { mesures += l.mesures.length; });
  verifier("flotte : ≈ 144 mesures par vélo et par jour", proche(mesures / 20 / 3, 144, 6), Math.round(mesures / 60));
  verifier("flotte : des locations ont eu lieu", a.f.compteurs.locations > 20, a.f.compteurs.locations);
  verifier("flotte : chaque lot passe la validation du serveur",
    a.lots.every(function (l) { return TPMS.flotteValiderLot({ mesures: l.mesures }, l.mesures[l.mesures.length - 1].t).ok; }));

  // Effet jour/nuit : la pression brute varie, la pression à 20 °C beaucoup moins
  var v = a.f.registre.mesures.V02;
  var brutes = v.map(function (m) { return m.pAv; }), comp = v.map(function (m) { return TPMS.flottePression20(m, "AV"); });
  var jourNuitBrut = Math.max.apply(null, brutes.slice(0, 144)) - Math.min.apply(null, brutes.slice(0, 144));
  var jourNuitComp = Math.max.apply(null, comp.slice(0, 144)) - Math.min.apply(null, comp.slice(0, 144));
  verifier("jour/nuit : la pression brute varie de plus de 0,05 bar sur 24 h", jourNuitBrut > 0.05, jourNuitBrut.toFixed(3));
  verifier("jour/nuit : la compensation à 20 °C réduit cette variation", jourNuitComp < jourNuitBrut, jourNuitComp.toFixed(3) + " < " + jourNuitBrut.toFixed(3));

  // Tendance : fuite synthétique et perte normale
  function points(penteJour) {
    var p = [];
    for (var i = 0; i < 48 * 6; i++) p.push({ t: i * 600000, p: 2.5 + penteJour * i / 144, temp: 20 });
    return p;
  }
  var fuite = TPMS.flotteTendance(points(-0.3), "AV");
  var normal = TPMS.flotteTendance(points(-0.04), "AV");
  verifier("tendance : −0,30 bar/j retrouvé et classé « fuite lente »", fuite.fuiteLente && proche(fuite.penteBarJour, -0.3, 0.005), fuite.penteBarJour);
  verifier("tendance : −0,04 bar/j (butyle normal) n'est pas une fuite", !normal.fuiteLente && proche(normal.penteBarJour, -0.04, 0.005));
  var avecRegonflage = points(-0.3).concat([{ t: 48 * 3600000, p: 2.6, temp: 20 }, { t: 49 * 3600000, p: 2.6, temp: 20 }]);
  var apres = TPMS.flotteTendance(avecRegonflage, "AV");
  verifier("tendance : repart de zéro après un regonflage", apres.nbPoints === 2 && apres.penteBarJour === null, apres.nbPoints);
}

// ---------------------------------------------------------------------
// 4. Bout en bout : flotte simulée → serveur → statistiques
// ---------------------------------------------------------------------
async function envoyerTout(s, lots) {
  var refus = 0;
  for (var i = 0; i < lots.length; i += 20) {
    var paquet = lots.slice(i, i + 20);
    var reps = await Promise.all(paquet.map(function (l) { return client.envoyerLot(s.client, l); }));
    reps.forEach(function (r) { if (r.statut !== 201) refus++; });
  }
  return refus;
}

async function testsBoutEnBout() {
  // 10 jours jusqu'à maintenant, un lot toutes les 6 h, technicien actif
  var f = TPMS.creerFlotte({ graine: 42, debutMs: Date.now() - 10 * 86400000, lotMs: 6 * 3600000, garderLots: true });
  TPMS.flotteAvancerJusqua(f, Date.now() - 1000);
  var lots = TPMS.flotteLotsAEnvoyer(f);
  var s = await demarrer({ requetesParMinute: 1000 });
  var refus = await envoyerTout(s, lots);
  verifier("bout en bout : tous les lots de 10 jours acceptés", refus === 0 && lots.length >= 780, refus + " refus sur " + lots.length);

  var serveur = (await lire(s, "/api/statistiques")).json;
  var memoire = TPMS.registreStatistiques(f.registre, serveur.maintenantMs);
  verifier("statistiques : même nombre de mesures (SQL et registre de la démo)", serveur.mesures.total === memoire.mesures.total,
    serveur.mesures.total + " / " + memoire.mesures.total);
  verifier("statistiques : mêmes regonflages détectés", serveur.regonflages.total === memoire.regonflages.total && serveur.regonflages.total > 0,
    serveur.regonflages.total + " / " + memoire.regonflages.total);
  verifier("statistiques : temps moyen entre regonflages identique (SQL LAG = JavaScript)",
    serveur.regonflages.tempsMoyenEntreJ !== null && proche(serveur.regonflages.tempsMoyenEntreJ, memoire.regonflages.tempsMoyenEntreJ, 1e-6),
    serveur.regonflages.tempsMoyenEntreJ);
  verifier("statistiques : mêmes alertes par type", JSON.stringify(serveur.alertesParType7j) === JSON.stringify(memoire.alertesParType7j),
    JSON.stringify(serveur.alertesParType7j));
  var Is = serveur.indicateurs, Im = memoire.indicateurs;
  verifier("statistiques : mêmes vélos à regonfler, fuites lentes, immobilisés",
    Is.aRegonfler === Im.aRegonfler && Is.fuitesLentes === Im.fuitesLentes && Is.immobilises === Im.immobilises,
    JSON.stringify([Is.aRegonfler, Is.fuitesLentes, Is.immobilises]) + " / " + JSON.stringify([Im.aRegonfler, Im.fuitesLentes, Im.immobilises]));
  verifier("statistiques : les compteurs se recoupent (somme des statuts = 20 vélos)",
    Is.immobilises + Is.urgents + (Is.aRegonfler - Is.urgents) + Is.muets + Is.aSurveiller + Is.ok === 20, JSON.stringify(Is));
  verifier("statistiques : kilomètres de la semaine identiques", proche(serveur.km7j, memoire.km7j, 1e-6), serveur.km7j);
  var velos = (await lire(s, "/api/velos")).json.velos;
  var memeStatuts = velos.every(function (v) {
    return v.statut === TPMS.flotteResume(f.registre.fiches[v.id], serveur.maintenantMs).statut;
  });
  verifier("chaque vélo a le même statut côté serveur et côté démo", memeStatuts);
  var alertes = (await lire(s, "/api/alertes?limite=500")).json.alertes;
  verifier("les fuites lentes sont signalées par le serveur (alerte FUITE_LENTE)",
    alertes.some(function (a) { return a.type === "FUITE_LENTE" && a.source === "serveur"; }));
  // Lot renvoyé une 2e fois (nouvelle signature) : mesures ignorées, pas de doublon
  var r = await client.envoyerLot(s.client, lots[lots.length - 1]);
  verifier("lot déjà reçu renvoyé : accepté mais aucune mesure en double", r.statut === 201 && r.json.acceptees === 0 && r.json.ignorees > 0, JSON.stringify(r.json));
  await arreter(s);
}

async function testsFuiteRepere() {
  // Sans technicien : V05 a une fuite lente à l'arrière (6 µm), les autres non.
  // Pas de crevaison ni de nouvelle fuite au hasard pendant ce test : seul
  // le défaut de V05 doit ressortir.
  var crevaison = TPMS.FLOTTE_SIM.crevaisonParKm, nouvelleFuite = TPMS.FLOTTE_SIM.fuiteLenteParKm;
  TPMS.FLOTTE_SIM.crevaisonParKm = 0;
  TPMS.FLOTTE_SIM.fuiteLenteParKm = 0;
  var f = TPMS.creerFlotte({
    graine: 7, debutMs: Date.now() - 4 * 86400000, lotMs: 6 * 3600000, garderLots: true, technicien: false,
    fuitesInitiales: [{ id: "V05", roue: "AR", diametreMm: 0.006 }]
  });
  TPMS.flotteAvancerJusqua(f, Date.now() - 1000);
  TPMS.FLOTTE_SIM.crevaisonParKm = crevaison;
  TPMS.FLOTTE_SIM.fuiteLenteParKm = nouvelleFuite;
  var s = await demarrer({ requetesParMinute: 1000 });
  await envoyerTout(s, TPMS.flotteLotsAEnvoyer(f));
  var velos = (await lire(s, "/api/velos")).json.velos;
  var v05 = velos.filter(function (v) { return v.id === "V05"; })[0];
  verifier("vélo qui fuit : V05 repéré « à regonfler » (ou pire)", ["regonfler", "urgent", "immobilise"].indexOf(v05.statut) >= 0,
    v05.statut + " · " + v05.raison);
  verifier("vélo qui fuit : fuite lente arrière détectée", v05.fuiteAr === true && v05.penteAr < TPMS.FLOTTE.fuiteBarJour, v05.penteAr);
  var tournee = TPMS.flotteTrierParPriorite(velos);
  verifier("vélo qui fuit : V05 en tête de la tournée", tournee[0].id === "V05", tournee[0].id + " " + tournee[0].raison);
  var fausses = velos.filter(function (v) { return v.id !== "V05" && (v.fuiteAv || v.fuiteAr); });
  verifier("pas de fausse fuite lente sur les 19 autres vélos", fausses.length === 0, fausses.map(function (v) { return v.id; }).join(","));
  var h = (await lire(s, "/api/velos/V05/historique?jours=7")).json;
  verifier("historique de V05 : 4 jours de mesures et une date de regonflage estimée",
    h.mesures.length > 500 && h.resume.prochainRegonflageMs !== null, h.mesures.length);
  verifier("historique d'un vélo inconnu : 404", (await lire(s, "/api/velos/V42/historique")).statut === 404);
  await arreter(s);
}

// ---------------------------------------------------------------------
// 5. Lecture de l'API réservée aux comptes (jeton « Bearer », rôles)
// ---------------------------------------------------------------------
async function testsComptes() {
  var s = await demarrer();
  await s.client.envoyer(s.client.preparer("V01", [mesure(60000)]));

  var r = await lire(s, "/api/velos", null);
  verifier("compte : GET /api/velos sans jeton → 401", r.statut === 401 && r.json.motif === "authentification", r.statut);
  verifier("compte : la réponse 401 annonce le schéma Bearer (WWW-Authenticate)", /^Bearer/.test(r.enTetes.get("www-authenticate") || ""));
  verifier("compte : aucune donnée de vélo dans la réponse 401", !r.json.velos);
  r = await lire(s, "/api/velos", "Bearer " + "A".repeat(32));
  verifier("compte : jeton faux (bien formé) → 401", r.statut === 401 && r.json.erreur === "jeton invalide", r.statut + " " + (r.json && r.json.erreur));
  r = await lire(s, "/api/statistiques", "Basic dGVjaG5pY2llbjpzZWNyZXQ=");
  verifier("compte : en-tête Authorization d'un autre type → 401", r.statut === 401, r.statut);
  r = await lire(s, "/api/route-qui-n-existe-pas", null);
  verifier("compte : route inconnue sans jeton → 401 (on ne dévoile pas les routes)", r.statut === 401, r.statut);

  r = await lire(s, "/api/velos", JETON_TECHNICIEN);
  verifier("compte : bon jeton (technicien) → 200 et 20 vélos", r.statut === 200 && r.json.velos.length === 20, r.statut);
  r = await lire(s, "/api/moi", JETON_TECHNICIEN);
  verifier("compte : /api/moi donne le compte et son rôle", r.statut === 200 && r.json.compte === "technicien" && r.json.role === "technicien", JSON.stringify(r.json));
  r = await lire(s, "/api/velos/V01/historique?jours=1", JETON_TECHNICIEN);
  verifier("rôle technicien : historique d'un vélo → 200", r.statut === 200 && r.json.mesures.length === 1, r.statut);
  r = await lire(s, "/api/refus", JETON_TECHNICIEN);
  verifier("rôle technicien : journal de sécurité /api/refus → 403", r.statut === 403 && r.json.motif === "droits", r.statut);
  r = await lire(s, "/api/statistiques", JETON_TECHNICIEN);
  verifier("rôle technicien : statistiques sans les chiffres de sécurité", r.statut === 200 && r.json.securite === null && r.json.indicateurs.nbVelos === 20);

  r = await lire(s, "/api/refus?limite=50", JETON_GESTIONNAIRE);
  verifier("rôle gestionnaire : /api/refus → 200", r.statut === 200 && Array.isArray(r.json.refus), r.statut);
  var motifs = r.json.refus.map(function (x) { return x.motif; });
  // Les lectures au jeton faux (ou mal formé) sont tracées ; une simple
  // visite sans jeton (page ouverte avant la connexion) ne l'est pas.
  verifier("journal : les jetons faux sont tracés, pas les visites sans jeton (motif authentification)",
    motifs.filter(function (m) { return m === "authentification"; }).length === 2, motifs.join(","));
  verifier("journal : l'accès refusé au technicien est tracé (motif droits)", motifs.indexOf("droits") >= 0);
  verifier("journal : le jeton essayé n'est pas recopié dans le journal",
    JSON.stringify(r.json.refus).indexOf("AAAAAAAAAAAAAAAA") < 0 && JSON.stringify(r.json.refus).indexOf(JETON_TECHNICIEN) < 0);
  r = await lire(s, "/api/statistiques", JETON_GESTIONNAIRE);
  verifier("rôle gestionnaire : statistiques avec les refus par motif", r.json.securite && r.json.securite.refusParMotif.length > 0);

  // Le serveur ne garde que l'empreinte SHA-256 des jetons.
  var memoire = JSON.stringify(s.serveur.comptes.map(function (c) { return { nom: c.nom, role: c.role, e: c.empreinte.toString("hex") }; }));
  verifier("comptes en mémoire : aucun jeton en clair, seulement l'empreinte",
    memoire.indexOf(JETON_TECHNICIEN) < 0 && memoire.indexOf(JETON_GESTIONNAIRE) < 0 &&
    s.serveur.comptes[0].empreinte.equals(crypto.createHash("sha256").update(COMPTES_DEMO[s.serveur.comptes[0].nom].jeton).digest()));
  // Configuration « production » : seulement l'empreinte dans le fichier.
  var fichier = path.join(os.tmpdir(), "tpms-comptes-" + process.pid + ".json");
  fs.writeFileSync(fichier, JSON.stringify({ velos: {}, comptes: {
    chef: { role: "gestionnaire", empreinte: crypto.createHash("sha256").update("jeton-de-test-0123456789").digest("hex") } } }));
  var comptes = outils.chargerComptes(fichier);
  fs.unlinkSync(fichier);
  verifier("comptes : un fichier qui ne contient que l'empreinte suffit", comptes.length === 1 && comptes[0].role === "gestionnaire" &&
    comptes[0].empreinte.equals(outils.empreinteJeton("jeton-de-test-0123456789")));

  var page = await fetch(s.url + "/flotte/");
  verifier("compte : la page /flotte/ (fichier statique) reste publique", page.status === 200, page.status);
  await arreter(s);

  // Force brute sur les jetons : comptée dans le blocage d'adresse existant.
  s = await demarrer({ refusParMinuteMax: 3 });
  for (var k = 0; k < 4; k++) await lire(s, "/api/velos", "Bearer essai-de-jeton-" + k + "-xxxxxxxx");
  r = await lire(s, "/api/velos", JETON_GESTIONNAIRE);
  verifier("4 jetons faux : l'adresse IP est bloquée, même avec ensuite le bon jeton (429)", r.statut === 429 && r.json.motif === "ip-bloquee", r.statut);
  await arreter(s);
}

// ---------------------------------------------------------------------
// 6. RGPD : minimisation de la position, durée de conservation
// ---------------------------------------------------------------------
async function testsRgpd() {
  var s = await demarrer();
  var c = s.client;
  // V01 rendu en station (position gardée), V02 en location (position envoyée par erreur), V03 sans position.
  await c.envoyer(c.preparer("V01", [mesure(60000)]));
  var r = await c.envoyer(c.preparer("V02", [mesure(60000, { enLocation: true, lat: 45.7601, lon: 4.8402 })]));
  verifier("RGPD : un lot en location AVEC position est accepté (201)", r.statut === 201, r.statut);
  var sansPosition = mesure(50000, { enLocation: true });
  delete sansPosition.lat;
  delete sansPosition.lon;
  r = await c.envoyer(c.preparer("V03", [sansPosition]));
  verifier("RGPD : un lot en location SANS lat/lon est accepté (201)", r.statut === 201, r.statut + " " + JSON.stringify(r.json));
  r = await c.envoyer(c.preparer("V04", [mesure(50000, { lat: null, lon: null })]));
  verifier("validation : lat/lon à null acceptés", r.statut === 201, r.statut);
  r = await c.envoyer(c.preparer("V05", [mesure(50000, { lat: "45.76" })]));
  verifier("validation : lat présente mais en texte → refusée (400)", r.statut === 400 && r.json.motif === "validation", r.statut);
  r = await c.envoyer(c.preparer("V05", [mesure(50000, { lon: 200 })]));
  verifier("validation : longitude hors plage → refusée (400)", r.statut === 400, r.statut);

  var lignes = s.serveur.base.db.prepare("SELECT velo_id, lat, lon, en_location FROM mesures ORDER BY velo_id").all();
  var parVelo = {};
  lignes.forEach(function (l) { parVelo[l.velo_id] = l; });
  verifier("RGPD base : la position envoyée pendant la location n'est PAS stockée (NULL)",
    parVelo.V02 && parVelo.V02.lat === null && parVelo.V02.lon === null && parVelo.V02.en_location === 1, JSON.stringify(parVelo.V02));
  verifier("RGPD base : la position en station est gardée", parVelo.V01 && parVelo.V01.lat === 45.7578, JSON.stringify(parVelo.V01));
  var velos = (await lire(s, "/api/velos")).json.velos;
  var v = {};
  velos.forEach(function (x) { v[x.id] = x; });
  verifier("RGPD API : /api/velos ne donne aucune position pour un vélo en location",
    v.V02.lat === null && v.V02.lon === null && v.V02.enLocation === true && v.V02.station === null, JSON.stringify([v.V02.lat, v.V02.station]));
  verifier("RGPD API : le vélo rendu en station garde sa station", v.V01.station === "Bellecour", v.V01.station);
  verifier("RGPD API : un vélo sans position n'a pas de station (pas d'erreur)", v.V04.station === null && v.V04.statut === "ok", v.V04.statut);
  var h = (await lire(s, "/api/velos/V02/historique?jours=1")).json;
  verifier("RGPD API : l'historique ne contient pas la position de la location",
    h.mesures.length === 1 && h.mesures[0].lat === null && h.mesures[0].lon === null);
  await arreter(s);

  // Même règle dans le registre du mode démo
  var reg = TPMS.creerRegistre([{ id: "V01", nom: "Vélo 01" }]);
  TPMS.registreAjouterLot(reg, "V01", [mesure(60000, { enLocation: true, lat: 45.76, lon: 4.84 })]);
  verifier("RGPD démo : le registre efface aussi la position en location",
    reg.mesures.V01[0].lat === null && TPMS.registreVelos(reg, Date.now()).velos[0].lat === null);

  // Et le boîtier simulé ne l'envoie même pas
  var f = TPMS.creerFlotte({ graine: 42, garderLots: true });
  TPMS.flotteAvancer(f, 86400);
  var enLocation = 0, fuite = 0, enStation = 0;
  TPMS.flotteLotsAEnvoyer(f).forEach(function (lot) {
    lot.mesures.forEach(function (m) {
      if (m.enLocation) { enLocation++; if ("lat" in m || "lon" in m) fuite++; }
      else if (typeof m.lat === "number") enStation++;
    });
  });
  verifier("RGPD simulation : le boîtier n'envoie pas sa position pendant les locations",
    enLocation > 20 && fuite === 0 && enStation > 1000, enLocation + " mesures en location, " + fuite + " avec position");
}

async function testsConservation() {
  var J = 86400000;
  var C = TPMS.FLOTTE_CONSERVATION;
  verifier("conservation : 30 jours de mesures, plus que la fenêtre de tendance (14 j)",
    C.mesuresMs === 30 * J && C.mesuresMs > TPMS.FLOTTE.tendanceFenetreMs);

  var s = await demarrer();
  var c = s.client;
  // Vieilles données (40 jours) de V02 : un regonflage et une alerte « pression basse ».
  var vieilles = [
    mesure(42 * J, { pAv: 1.9, etatAv: "BASSE" }),
    mesure(41 * J, { pAv: 2.45 }),
    mesure(40 * J)
  ];
  var r = await c.envoyer(c.preparer("V02", vieilles));
  verifier("conservation : un lot de vieilles mesures (40 j) est accepté", r.statut === 201 && r.json.acceptees === 3 && r.json.regonflages === 1,
    JSON.stringify(r.json));
  verifier("conservation : la purge compte à partir des DONNÉES, pas de l'horloge (rien d'effacé)",
    (await nbMesuresEnBase(s)) === 3 && r.json.purgees === 0, await nbMesuresEnBase(s));
  r = await c.envoyer(c.preparer("V03", [mesure(60000)]));
  verifier("conservation : une mesure récente fait effacer celles de plus de 30 jours", r.statut === 201 && r.json.purgees === 3,
    JSON.stringify(r.json));
  var db = s.serveur.base.db;
  verifier("conservation : plus aucune mesure de V02 en base",
    db.prepare("SELECT COUNT(*) AS n FROM mesures WHERE velo_id = ?").get("V02").n === 0);
  verifier("conservation : les vieilles alertes sont effacées aussi",
    db.prepare("SELECT COUNT(*) AS n FROM alertes WHERE t < ?").get(Date.now() - 30 * J).n === 0);
  var stats = (await lire(s, "/api/statistiques")).json;
  verifier("conservation : les statistiques agrégées restent (regonflage compté)", stats.regonflages.total === 1 && stats.mesures.total === 1,
    JSON.stringify([stats.regonflages.total, stats.mesures.total]));
  var v02 = (await lire(s, "/api/velos")).json.velos.filter(function (x) { return x.id === "V02"; })[0];
  verifier("conservation : V02 n'a plus de dernière mesure (muet, « Aucune donnée »)", v02.t === null && v02.statut === "muet", v02.statut);

  // Journal des refus : 6 mois
  s.serveur.base.noterRefus(Date.now() - 200 * J, "10.0.0.1", null, "test", "vieux refus");
  s.serveur.base.noterRefus(Date.now(), "10.0.0.2", null, "test", "refus récent");
  var ips = db.prepare("SELECT ip FROM refus WHERE motif = 'test'").all().map(function (l) { return l.ip; });
  verifier("conservation : refus de plus de 6 mois effacés (adresses IP)", ips.length === 1 && ips[0] === "10.0.0.2", ips.join(","));
  await arreter(s);

  // Même règle dans le registre du mode démo
  var reg = TPMS.creerRegistre([{ id: "V02", nom: "Vélo 02" }, { id: "V03", nom: "Vélo 03" }]);
  TPMS.registreAjouterLot(reg, "V02", vieilles);
  var avant = reg.nbMesures;
  var bilan = TPMS.registreAjouterLot(reg, "V03", [mesure(60000)]);
  var sm = TPMS.registreStatistiques(reg, Date.now());
  verifier("conservation démo : le registre efface les mêmes mesures et alertes",
    avant === 3 && bilan.purgees === 3 && reg.mesures.V02.length === 0 && reg.alertes.length === 0 && sm.mesures.total === 1 && sm.regonflages.total === 1,
    JSON.stringify([avant, bilan.purgees, reg.mesures.V02.length, reg.alertes.length]));

  // Ancienne base (lat/lon « NOT NULL ») : mise à jour au démarrage.
  var fichier = path.join(os.tmpdir(), "tpms-ancienne-" + process.pid + ".db");
  var DatabaseSync = require("node:sqlite").DatabaseSync;
  var ancienne = new DatabaseSync(fichier);
  ancienne.exec("CREATE TABLE velos (id TEXT PRIMARY KEY, nom TEXT NOT NULL, derniere_sequence INTEGER NOT NULL DEFAULT 0, " +
    "pente_av REAL, fuite_av INTEGER NOT NULL DEFAULT 0, seuil_av_ms INTEGER, pente_ar REAL, fuite_ar INTEGER NOT NULL DEFAULT 0, seuil_ar_ms INTEGER);" +
    "CREATE TABLE mesures (id INTEGER PRIMARY KEY, velo_id TEXT NOT NULL REFERENCES velos(id), t INTEGER NOT NULL, p_av REAL, p_ar REAL, " +
    "temp_av REAL, temp_ar REAL, pile_av INTEGER, pile_ar INTEGER, batterie INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, " +
    "km REAL NOT NULL, etat_av TEXT NOT NULL, etat_ar TEXT NOT NULL, en_location INTEGER NOT NULL, UNIQUE (velo_id, t));" +
    "INSERT INTO velos (id, nom) VALUES ('V01', 'Vélo 01');" +
    "INSERT INTO mesures (velo_id, t, batterie, lat, lon, km, etat_av, etat_ar, en_location) VALUES " +
    "('V01', 1, 80, 45.76, 4.84, 10, 'OK', 'OK', 1), ('V01', 2, 80, 45.7578, 4.832, 11, 'OK', 'OK', 0);");
  ancienne.close();
  var base = ouvrirBase(fichier, [{ id: "V01", nom: "Vélo 01" }]);
  var colonneLat = base.db.prepare("PRAGMA table_info(mesures)").all().filter(function (col) { return col.name === "lat"; })[0];
  var rangees = base.db.prepare("SELECT t, lat FROM mesures ORDER BY t").all();
  base.fermer();
  ["", "-wal", "-shm"].forEach(function (x) { try { fs.unlinkSync(fichier + x); } catch (e) { /* absent */ } });
  verifier("ancienne base : lat devient facultative, positions de location effacées, le reste gardé",
    colonneLat.notnull === 0 && rangees.length === 2 && rangees[0].lat === null && rangees[1].lat === 45.7578, JSON.stringify(rangees));
}

// ---------------------------------------------------------------------
// 7. HTTPS (certificat auto-signé temporaire, si openssl est présent)
// ---------------------------------------------------------------------
async function testsHttps() {
  var dossier = fs.mkdtempSync(path.join(os.tmpdir(), "tpms-https-"));
  try {
    var fichiers = certificat.genererCertificat(dossier, { jours: 1 });
    if (!fichiers) {
      resultats.lignes.push("SAUTÉ  HTTPS : openssl introuvable, tests HTTPS non exécutés");
      return;
    }
    var ca = fs.readFileSync(fichiers.cert);
    var s = await demarrer({ tls: { cert: ca, key: fs.readFileSync(fichiers.cle) }, ca: ca });
    verifier("HTTPS : le serveur démarre en HTTPS avec le certificat", s.serveur.https && s.url.indexOf("https://") === 0);
    var r = await client.requeteJson(s.url + "/api/velos", { enTetes: { Authorization: "Bearer " + JETON_TECHNICIEN }, ca: ca });
    verifier("HTTPS : requête réussie en faisant confiance au certificat de démo (option ca)", r.statut === 200 && r.json.velos.length === 20, r.statut);
    verifier("HTTPS : en-tête Strict-Transport-Security présent", r.enTetes["strict-transport-security"] === outils.HSTS, r.enTetes["strict-transport-security"]);
    var erreur = null;
    try { await client.requeteJson(s.url + "/api/velos", { enTetes: { Authorization: "Bearer " + JETON_TECHNICIEN } }); } catch (e) { erreur = e; }
    verifier("HTTPS : sans faire confiance au certificat, la connexion est refusée (vérification active)",
      erreur !== null && /SELF_SIGNED|self.signed|unable to verify/i.test(erreur.code + " " + erreur.message), erreur && erreur.code);
    var envoi = await s.client.envoyer(s.client.preparer("V01", [mesure(60000)]));
    verifier("HTTPS : un lot signé passe aussi par HTTPS (201)", envoi.statut === 201, envoi.statut);
    r = await client.requeteJson(s.url + "/api/velos", { ca: ca });
    verifier("HTTPS : le jeton reste exigé (401 sans jeton)", r.statut === 401, r.statut);
    await arreter(s);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });     // pas de clé privée qui traîne
  }
}

// ---------------------------------------------------------------------
// Lancement et bilan
// ---------------------------------------------------------------------
(async function () {
  try {
    await testsSecurite();
    await testsDebit();
    testsSimulation();
    await testsBoutEnBout();
    await testsFuiteRepere();
    await testsComptes();
    await testsRgpd();
    await testsConservation();
    await testsHttps();
  } catch (e) {
    verifier("exécution sans exception", false, e.stack);
  }
  resultats.lignes.push("");
  resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
})();
