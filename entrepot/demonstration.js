// =====================================================================
// demonstration.js — Essais de sécurité commentés de la maquette
// ---------------------------------------------------------------------
// À lancer sur le PC, maquette démarrée (docker compose up -d) :
//   node entrepot/demonstration.js        les 13 essais à la suite (≈ 3 min)
//   node entrepot/demonstration.js 6      un seul essai (pour l'oral)
//
// Chaque essai dit ce qui est tenté, ce qu'on attend, ce qu'on obtient,
// et d'où vient la preuve : compteurs du pare-feu, réponse du courtier,
// compteurs de la supervision, journal central. Les défenses sont en
// COUCHES : le pare-feu (zones), puis le courtier (certificats, droits),
// puis le serveur (contenu des lots), puis la continuité de service.
// =====================================================================
"use strict";
var childProcess = require("node:child_process");
var fs = require("node:fs");
var https = require("node:https");
var path = require("node:path");

var DOSSIER = __dirname;
var CA = path.join(DOSSIER, "certificats", "ac.pem");
var JOURNAL = path.join(DOSSIER, "journaux", "central.log");
var COMPTES = require("../serveur/cles-demo.json").comptes;

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------
// « docker compose … » dans le dossier entrepot/ ; renvoie la sortie,
// même si la commande échoue (un refus est souvent un code d'erreur).
function compose(args) {
  try {
    return childProcess.execFileSync("docker", ["compose", "--profile", "attaques"].concat(args),
      { cwd: DOSSIER, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

// Compteurs du pare-feu : { "REFUS bureautique vers OT": 12, ... }
function compteursPareFeu() {
  var c = {}, re = /counter packets (\d+) bytes \d+ (?:accept|drop) comment "([^"]+)"/g, m;
  var texte = compose(["exec", "-T", "pare-feu", "nft", "list", "ruleset"]);
  while ((m = re.exec(texte)) !== null) c[m[2]] = Number(m[1]);
  return c;
}

// API de la supervision, avec le compte gestionnaire (HTTPS, AC de la maquette).
var jeton = null;
function requete(methode, chemin, corps) {
  return new Promise(function (ok, echec) {
    var r = https.request({ host: "localhost", port: 8443, method: methode, path: chemin, ca: fs.readFileSync(CA),
      headers: Object.assign({ "Content-Type": "application/json" }, jeton ? { Authorization: "Bearer " + jeton } : {}) },
      function (rep) {
        var d = "";
        rep.on("data", function (m) { d += m; });
        rep.on("end", function () { try { ok(JSON.parse(d)); } catch (e) { echec(new Error("réponse illisible (" + rep.statusCode + ")")); } });
      });
    r.on("error", echec);
    if (corps) r.write(JSON.stringify(corps));
    r.end();
  });
}
async function api(chemin) {
  if (!jeton) jeton = (await requete("POST", "/api/connexion", { compte: "gestionnaire", motDePasse: COMPTES.gestionnaire.motDePasse })).jeton;
  return requete("GET", chemin);
}
async function compteursServeur() { return (await api("/api/chariots")).compteurs; }
async function etatPasserelle(id) {
  var p = (await api("/api/passerelles")).passerelles.find(function (x) { return x.id === id; });
  return p ? p.etat : "inconnue";
}

// Attend qu'une condition soit vraie (au plus delaiMs) ; renvoie true si oui.
async function attendreQue(condition, delaiMs) {
  var fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await attendre(1000);
  }
  return false;
}

// Ports vus par nmap : { "22/tcp": "filtered", ... }
function nmap(conteneur, cible, ports) {
  var sortie = compose(["exec", "-T", conteneur, "nmap", "-Pn", "-n", "--max-retries", "0", "--host-timeout", "30s", "-p", ports, cible]);
  var r = {}, re = /^(\d+\/tcp)\s+(\S+)/gm, m;
  while ((m = re.exec(sortie)) !== null) r[m[1]] = m[2];
  return r;
}
function intrus(essai, marque) {
  return compose(["exec", "-T", "intrus", "node", "entrepot/intrus.js", essai].concat(marque ? [marque] : [])).trim();
}

// ---------------------------------------------------------------------
// Les essais
// ---------------------------------------------------------------------
// Chaque essai renvoie { obtenu, ok }.
var ESSAIS = [
  { titre: "Un poste de bureau balaie une passerelle de l'atelier (nmap)",
    attendu: "ports « filtered » : le pare-feu jette tout ce qui va de la bureautique vers l'OT",
    lancer: async function () {
      var avant = compteursPareFeu()["REFUS bureautique vers OT"];
      var ports = nmap("poste", "10.10.10.11", "22,80,1883,8883");
      var apres = compteursPareFeu()["REFUS bureautique vers OT"];
      var tousFiltres = Object.keys(ports).length > 0 && Object.keys(ports).every(function (p) { return ports[p] === "filtered"; });
      return { obtenu: JSON.stringify(ports) + " ; compteur « REFUS bureautique vers OT » : +" + (apres - avant),
        ok: tousFiltres && apres > avant };
    } },

  { titre: "Un poste de bureau tente de joindre le courtier MQTT",
    attendu: "refusé par le pare-feu : seules les passerelles (OT) parlent au courtier",
    lancer: async function () {
      var avant = compteursPareFeu()["REFUS bureautique vers courtier"];
      var ports = nmap("poste", "10.10.20.10", "8883");
      var apres = compteursPareFeu()["REFUS bureautique vers courtier"];
      return { obtenu: "8883/tcp " + ports["8883/tcp"] + " ; compteur « REFUS bureautique vers courtier » : +" + (apres - avant),
        ok: ports["8883/tcp"] === "filtered" && apres > avant };
    } },

  { titre: "L'intrus branché sur l'atelier tente la page de supervision",
    attendu: "refusé par le pare-feu : l'OT n'a pas à lire la supervision",
    lancer: async function () {
      var avant = compteursPareFeu()["REFUS OT vers supervision"];
      var code = compose(["exec", "-T", "intrus", "curl", "-sk", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", "https://10.10.20.20:8443/flotte/"]).trim();
      var apres = compteursPareFeu()["REFUS OT vers supervision"];
      return { obtenu: "code HTTP « " + code.slice(0, 3) + " » (000 = pas de réponse) ; compteur « REFUS OT vers supervision » : +" + (apres - avant),
        ok: code.indexOf("000") === 0 && apres > avant };
    } },

  { titre: "Un poste de bureau réclame à la supervision la clé privée du courtier",
    attendu: "403 : la supervision ne sert ni certificats, ni clés, ni base, ni journaux (même en majuscules)",
    lancer: async function () {
      var codes = ["/entrepot/certificats/courtier.cle", "/Entrepot/Certificats/courtier.cle", "/entrepot/journaux/central.log"].map(function (a) {
        return compose(["exec", "-T", "poste", "curl", "-sk", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", "https://10.10.20.20:8443" + a]).trim();
      });
      return { obtenu: "codes HTTP : " + codes.join(", "), ok: codes.every(function (c) { return c === "403"; }) };
    } },

  { titre: "L'intrus se connecte au courtier SANS certificat",
    attendu: "le pare-feu laisse passer (port 8883 ouvert à l'OT), mais le courtier exige un certificat",
    lancer: async function () {
      var r = intrus("sans-certificat");
      return { obtenu: r, ok: r.indexOf("REFUSÉ") === 0 };
    } },

  { titre: "L'intrus présente un certificat fabriqué par une AC pirate",
    attendu: "refusé : le courtier ne fait confiance qu'à l'AC de l'usine",
    lancer: async function () {
      var r = intrus("ac-pirate");
      return { obtenu: r, ok: r.indexOf("REFUSÉ") === 0 };
    } },

  { titre: "Avec le certificat VOLÉ de la passerelle 1, l'intrus publie au nom de la passerelle 2",
    attendu: "le courtier jette le message (droits ACL : chaque passerelle n'écrit que sous son numéro)",
    lancer: async function () {
      var marque = "INTRUS-" + Date.now();
      // Contrôle : la supervision (identité légitime) écoute le sujet de la passerelle 2.
      var controle = childProcess.spawn("docker", ["compose", "exec", "-T", "supervision", "node", "entrepot/intrus.js", "observer", marque, "8"],
        { cwd: DOSSIER });
      var sortie = "";
      controle.stdout.on("data", function (m) { sortie += m; });
      var termine = new Promise(function (ok) { controle.on("close", ok); });
      await attendreQue(function () { return sortie.indexOf("à l'écoute") >= 0; }, 15000);
      var r = intrus("usurpation", marque);
      await termine;
      var verdict = sortie.split("\n").filter(function (l) { return /REÇU|RIEN/.test(l); })[0] || sortie.trim();
      return { obtenu: r + " → contrôle : " + verdict, ok: verdict.indexOf("RIEN REÇU") === 0 };
    } },

  { titre: "Certificat volé : un lot qui se dit de la passerelle 2, publié sur le sujet de la 1",
    attendu: "le courtier accepte (c'est le bon sujet), mais le SERVEUR refuse le lot incohérent",
    lancer: async function () {
      var avant = (await compteursServeur()).lotsRefuses;
      var r = intrus("faux-lot");
      await attendre(1500);
      var apres = (await compteursServeur()).lotsRefuses;
      return { obtenu: r + " → lots refusés par le serveur : +" + (apres - avant), ok: apres > avant };
    } },

  { titre: "Certificat volé : la trame d'un capteur qui n'est sur aucun chariot",
    attendu: "rejetée par la liste blanche du serveur (registre des capteurs posés)",
    lancer: async function () {
      var avant = (await compteursServeur()).inconnues;
      var r = intrus("capteur-inconnu");
      await attendre(1500);
      var apres = (await compteursServeur()).inconnues;
      return { obtenu: r + " → capteurs inconnus : +" + (apres - avant), ok: apres > avant };
    } },

  { titre: "Certificat volé : un vrai pneu annoncé à 20 bar",
    attendu: "rejetée par le contrôle de vraisemblance (capteurs 0-13 bar) : la supervision garde la vraie pression",
    lancer: async function () {
      var avant = (await compteursServeur()).invraisemblables;
      var r = intrus("valeur-aberrante");
      await attendre(1500);
      var apres = (await compteursServeur()).invraisemblables;
      var c01 = (await api("/api/chariots")).chariots.find(function (c) { return c.id === "C01"; });
      var p = c01 && c01.pneus.AVG && c01.pneus.AVG.pression;
      return { obtenu: r + " → invraisemblables : +" + (apres - avant) + " ; pression affichée de C01 AVG : " + p + " bar",
        ok: apres > avant && p !== 20 };
    } },

  { titre: "Certificat volé : des annonces vieilles de 3 h rejouées",
    attendu: "le serveur refuse les annonces trop anciennes (anti-rejeu par l'horodatage NTP)",
    lancer: async function () {
      var avant = (await compteursServeur()).lotsRefuses;
      var r = intrus("rejeu");
      await attendre(1500);
      var apres = (await compteursServeur()).lotsRefuses;
      return { obtenu: r + " → lots refusés : +" + (apres - avant), ok: apres > avant };
    } },

  { titre: "Panne : le programme de la passerelle 2 s'arrête net (docker kill)",
    attendu: "le système ferme sa connexion sans DISCONNECT : le courtier publie aussitôt le « testament », la supervision la voit « hors ligne » (une vraie coupure de courant, sans FIN, ne se voit qu'après 45 s : voir le simulateur de l'usine)",
    lancer: async function () {
      compose(["kill", "passerelle-2"]);
      var t0 = Date.now();
      var vu = await attendreQue(async function () { return (await etatPasserelle(2)) === "hors ligne"; }, 20000);
      var delai = Math.round((Date.now() - t0) / 1000);
      compose(["start", "passerelle-2"]);
      var revenue = await attendreQue(async function () { return (await etatPasserelle(2)) === "en ligne"; }, 30000);
      return { obtenu: (vu ? "« hors ligne » " + (delai < 1 ? "en moins d'une seconde" : "après " + delai + " s") : "jamais vue hors ligne") + (revenue ? ", de nouveau « en ligne » au redémarrage" : ", pas revenue"),
        ok: vu && revenue };
    } },

  { titre: "Panne : le courtier est arrêté 30 s",
    attendu: "les passerelles GARDENT leurs lots et les envoient au retour (stocker puis transmettre)",
    lancer: async function () {
      var tailleAvant = fs.existsSync(JOURNAL) ? fs.statSync(JOURNAL).size : 0;
      compose(["stop", "courtier"]);
      await attendre(30000);
      compose(["start", "courtier"]);
      var lignes = [];
      var ok = await attendreQue(function () {
        var texte = fs.readFileSync(JOURNAL, "utf8");
        lignes = texte.slice(tailleAvant).split("\n").filter(function (l) { return /lot\(s\) à rattraper/.test(l); });
        return lignes.length >= 3;
      }, 60000);
      var resume = lignes.map(function (l) { var m = /(passerelle-\d).*?(\d+) lot\(s\)/.exec(l); return m ? m[1] + " : " + m[2] + " lots" : ""; });
      return { obtenu: lignes.length ? "rattrapage annoncé dans le journal central : " + resume.join(", ") : "aucun rattrapage vu dans le journal",
        ok: ok };
    } }
];

// ---------------------------------------------------------------------
// Déroulement
// ---------------------------------------------------------------------
async function principal() {
  var choix = process.argv[2] ? [Number(process.argv[2])] : ESSAIS.map(function (e, i) { return i + 1; });
  if (choix.some(function (n) { return !ESSAIS[n - 1]; })) {
    console.error("Numéro d'essai entre 1 et " + ESSAIS.length + ".");
    process.exit(1);
  }
  console.log("Démonstration de sécurité de la maquette de l'entrepôt");
  console.log("Démarrage du conteneur « intrus » (une machine pirate branchée sur l'atelier)...\n");
  compose(["up", "-d", "intrus"]);
  await attendre(2000);

  var bilan = [];
  for (var i = 0; i < choix.length; i++) {
    var n = choix[i], e = ESSAIS[n - 1];
    console.log("Essai " + n + " : " + e.titre);
    console.log("  attendu : " + e.attendu);
    var r;
    try { r = await e.lancer(); } catch (err) { r = { obtenu: "erreur : " + err.message, ok: false }; }
    console.log("  obtenu  : " + r.obtenu);
    console.log("  " + (r.ok ? "✔ défense efficace" : "✘ RÉSULTAT INATTENDU") + "\n");
    bilan.push({ n: n, ok: r.ok });
  }

  compose(["stop", "intrus"]);
  var reussis = bilan.filter(function (b) { return b.ok; }).length;
  console.log("Bilan : " + reussis + " / " + bilan.length + " essais conformes" +
    (reussis < bilan.length ? " (en échec : " + bilan.filter(function (b) { return !b.ok; }).map(function (b) { return b.n; }).join(", ") + ")" : "") + ".");
  process.exitCode = reussis === bilan.length ? 0 : 1;
}

principal().catch(function (e) { console.error("Démonstration interrompue : " + e.message); process.exit(1); });
