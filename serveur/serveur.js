// =====================================================================
// serveur.js — Serveur de supervision de la flotte (Node.js 24)
// ---------------------------------------------------------------------
// Lancement :  node serveur/serveur.js            (port 8080)
//              node serveur/serveur.js --port 9000
// Puis ouvrir  http://localhost:8080/flotte/
//
// AUCUNE dépendance à installer : uniquement des modules intégrés à Node
//   node:http    le serveur web
//   node:sqlite  la base de données (fichier serveur/flotte.db)
//   node:crypto  la signature HMAC-SHA256
//
// API REST (JSON) :
//   POST /api/mesures                   un vélo envoie un lot de mesures (SIGNÉ)
//   GET  /api/velos                     dernier état de chaque vélo
//   GET  /api/velos/V07/historique?jours=7
//   GET  /api/alertes?limite=50
//   GET  /api/statistiques              indicateurs de l'entreprise
//   GET  /api/refus?limite=20           journal des requêtes refusées
// Les autres adresses servent les fichiers du dépôt (page /flotte/...).
//
// Cybersécurité (détails dans serveur/README.md) :
//   - chaque vélo signe ses envois (HMAC-SHA256 avec SA clé secrète) ;
//   - fenêtre d'horodatage de ±60 s et numéro de séquence : anti-rejeu ;
//   - validation stricte de chaque champ (flotte/flotte-logique.js) ;
//   - requêtes SQL paramétrées uniquement (serveur/base.js) ;
//   - limitation de débit par vélo, blocage d'une IP qui accumule les
//     refus, taille de corps limitée, délais de lecture limités ;
//   - en-têtes de sécurité sur toutes les réponses ;
//   - journal des refus (table « refus » + console).
// =====================================================================
var http = require("node:http");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var TPMS = require("../flotte/node.js");
var ouvrirBase = require("./base.js").ouvrirBase;

var RACINE = path.resolve(__dirname, "..");          // racine du dépôt (fichiers statiques)
var S = TPMS.FLOTTE_SECURITE;

// ---------------------------------------------------------------------
// Clés des vélos
// ---------------------------------------------------------------------
// En démo, elles sont dans serveur/cles-demo.json (publiques, sans
// valeur). En production : une clé différente par vélo, générée à la
// fabrication, stockée dans un coffre à secrets, jamais dans Git.
function chargerCles(fichier) {
  var config = JSON.parse(fs.readFileSync(fichier, "utf8"));
  var cles = new Map();       // Map et pas {} : « __proto__ » ou « constructor » ne sont pas des vélos
  Object.keys(config.velos).forEach(function (id) {
    if (TPMS.flotteIdentifiantValide(id)) cles.set(id, Buffer.from(config.velos[id], "hex"));
  });
  return cles;
}

// Signature attendue : HMAC-SHA256(clé du vélo, message), en hexadécimal.
function signer(cle, message) {
  return crypto.createHmac("sha256", cle).update(message, "utf8").digest("hex");
}

// ---------------------------------------------------------------------
// Limitation de débit : compteur par clé (vélo ou IP) sur une minute
// ---------------------------------------------------------------------
// Fenêtre fixe : on compte les requêtes depuis le début de la minute en
// cours ; au-delà du maximum, on refuse jusqu'à la minute suivante.
function creerLimiteur(maximum, dureeMs) {
  var compteurs = new Map();
  return function (cle, maintenantMs) {
    var c = compteurs.get(cle);
    if (!c || maintenantMs - c.debutMs >= dureeMs) {
      c = { debutMs: maintenantMs, n: 0 };
      compteurs.set(cle, c);
    }
    c.n++;
    return c.n <= maximum;     // true = autorisé
  };
}

// ---------------------------------------------------------------------
// En-têtes de sécurité, sur TOUTES les réponses
// ---------------------------------------------------------------------
var EN_TETES_SECURITE = {
  // Le navigateur ne charge que nos propres fichiers (et les polices Google).
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",           // pas de « devinette » du type de fichier
  "X-Frame-Options": "SAMEORIGIN",               // pas d'affichage dans le cadre d'un autre site
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function envoyer(res, statut, contenu, type, enTetesEnPlus) {
  var corps = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, "utf8");
  var enTetes = Object.assign({ "Content-Type": type, "Content-Length": corps.length }, EN_TETES_SECURITE, enTetesEnPlus || {});
  res.writeHead(statut, enTetes);
  res.end(corps);
}

function envoyerJson(res, statut, objet, enTetesEnPlus) {
  envoyer(res, statut, JSON.stringify(objet), "application/json; charset=utf-8",
    Object.assign({ "Cache-Control": "no-store" }, enTetesEnPlus || {}));
}

// ---------------------------------------------------------------------
// Fichiers statiques
// ---------------------------------------------------------------------
var TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2"
};

// Dossiers jamais servis : le serveur lui-même (clés de démo, base de
// données), l'historique git, les fichiers cachés.
function cheminInterdit(morceaux) {
  if (morceaux[0] === "serveur" || morceaux[0] === "node_modules") return true;
  return morceaux.some(function (m) { return m.charAt(0) === "."; });
}

function servirFichier(req, res, cheminUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return envoyerJson(res, 405, { erreur: "méthode non permise" }, { Allow: "GET, HEAD" });
  }
  if (cheminUrl === "/") return envoyer(res, 302, "", "text/plain", { Location: "/flotte/" });

  var decode;
  try { decode = decodeURIComponent(cheminUrl); } catch (e) { return envoyerJson(res, 400, { erreur: "adresse invalide" }); }
  if (decode.indexOf("\0") >= 0 || decode.indexOf("\\") >= 0) return envoyerJson(res, 400, { erreur: "adresse invalide" });

  // Anti « path traversal » : /../../Windows/win.ini ne doit pas sortir du dépôt.
  var complet = path.resolve(RACINE, "." + path.posix.normalize(decode));
  if (complet !== RACINE && complet.indexOf(RACINE + path.sep) !== 0) return envoyerJson(res, 403, { erreur: "interdit" });
  var morceaux = path.relative(RACINE, complet).split(path.sep).filter(Boolean);
  if (cheminInterdit(morceaux)) return envoyerJson(res, 403, { erreur: "interdit" });

  fs.stat(complet, function (err, infos) {
    if (err) return envoyerJson(res, 404, { erreur: "introuvable" });
    if (infos.isDirectory()) {
      // /flotte → /flotte/ pour que les liens relatifs de la page marchent
      if (!cheminUrl.endsWith("/")) return envoyer(res, 301, "", "text/plain", { Location: cheminUrl + "/" });
      complet = path.join(complet, "index.html");
    }
    fs.readFile(complet, function (err2, contenu) {
      if (err2) return envoyerJson(res, 404, { erreur: "introuvable" });
      var type = TYPES[path.extname(complet).toLowerCase()] || "application/octet-stream";
      envoyer(res, 200, req.method === "HEAD" ? Buffer.alloc(0) : contenu, type, { "Cache-Control": "no-cache" });
    });
  });
}

// ---------------------------------------------------------------------
// Création du serveur
// ---------------------------------------------------------------------
// options = { cheminBase, fichierCles, journal (true : affiche les refus),
//             requetesParMinute, refusParMinuteMax, blocageMs }
function creerServeur(options) {
  var o = options || {};
  var cles = o.cles || chargerCles(o.fichierCles || path.join(__dirname, "cles-demo.json"));
  var velos = [];
  cles.forEach(function (cle, id) { velos.push({ id: id, nom: "Vélo " + id.slice(1) }); });
  velos.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  var base = ouvrirBase(o.cheminBase || path.join(__dirname, "flotte.db"), velos);

  var limiteVelo = creerLimiteur(o.requetesParMinute || S.requetesParMinute, 60000);
  var compteRefus = creerLimiteur(o.refusParMinuteMax || S.refusParMinuteMax, 60000);
  var blocages = new Map();                      // ip → fin du blocage (ms)
  var dureeBlocage = o.blocageMs || S.blocageMs;
  var journal = o.journal !== false;

  // Toute requête refusée passe par ici : réponse + trace.
  function refuser(req, res, statut, motif, detail, veloAnnonce) {
    var maintenant = Date.now();
    var ip = req.socket.remoteAddress || "?";
    var velo = typeof veloAnnonce === "string" ? veloAnnonce.slice(0, 32) : null;   // tronqué : on ne stocke pas n'importe quoi
    base.noterRefus(maintenant, ip, velo, motif, detail);
    if (journal) console.warn("[refus] " + new Date(maintenant).toISOString() + " " + ip + " " + (velo || "-") + " " + motif + " : " + detail);
    // Trop de refus en une minute : l'adresse est bloquée un moment.
    if (!compteRefus(ip, maintenant) && !blocages.has(ip)) {
      blocages.set(ip, maintenant + dureeBlocage);
      if (journal) console.warn("[refus] IP " + ip + " bloquée " + Math.round(dureeBlocage / 60000) + " min");
    }
    // Réponse volontairement brève : le motif aide à la démo, mais on ne
    // renvoie jamais la signature attendue ni d'autre secret.
    envoyerJson(res, statut, { erreur: detail, motif: motif });
  }

  // --- POST /api/mesures ---------------------------------------------
  function recevoirMesures(req, res) {
    var id = req.headers["x-velo-id"];
    var type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return refuser(req, res, 415, "type", "Content-Type application/json attendu", id);

    var annonce = Number(req.headers["content-length"] || 0);
    if (annonce > S.corpsMaxOctets) {
      res.setHeader("Connection", "close");
      return refuser(req, res, 413, "taille", "corps trop gros (max " + S.corpsMaxOctets + " octets)", id);
    }

    // Lecture du corps, en comptant les octets (au cas où Content-Length mentirait).
    var morceaux = [], taille = 0, trop = false;
    req.on("data", function (morceau) {
      if (trop) return;
      taille += morceau.length;
      if (taille > S.corpsMaxOctets) {
        trop = true;
        res.setHeader("Connection", "close");
        refuser(req, res, 413, "taille", "corps trop gros (max " + S.corpsMaxOctets + " octets)", id);
        return;
      }
      morceaux.push(morceau);
    });
    req.on("end", function () {
      if (trop) return;
      var corps = Buffer.concat(morceaux).toString("utf8");
      var maintenant = Date.now();

      // 1. Authentification (flotte-logique.js : TPMS.flotteControlerRequete)
      var ligne = TPMS.flotteIdentifiantValide(id) ? base.velo(id) : null;
      var cle = TPMS.flotteIdentifiantValide(id) ? cles.get(id) : null;
      var horodatage = req.headers["x-horodatage"], sequence = req.headers["x-sequence"];
      var attendue = (cle && ligne && typeof horodatage === "string" && typeof sequence === "string")
        ? signer(cle, TPMS.flotteMessageASigner(id, horodatage, sequence, corps)) : null;
      var probleme = TPMS.flotteControlerRequete({
        veloId: id, horodatage: horodatage, sequence: sequence, signature: req.headers["x-signature"],
        signatureAttendue: attendue, derniereSequence: ligne ? ligne.derniere_sequence : 0, maintenantMs: maintenant
      });
      if (probleme) return refuser(req, res, probleme.statut, probleme.motif, probleme.detail, id);

      // 2. Débit : le vélo est authentifié, on compte SES requêtes (un
      //    attaquant ne peut pas épuiser le quota d'un vélo sans sa clé).
      if (!limiteVelo(id, maintenant)) {
        return refuser(req, res, 429, "debit", "trop de requêtes pour ce vélo, réessayer dans une minute", id);
      }

      // 3. Contenu : JSON puis validation stricte des champs et des plages.
      var objet;
      try { objet = JSON.parse(corps); } catch (e) { return refuser(req, res, 400, "json", "JSON invalide", id); }
      var verdict = TPMS.flotteValiderLot(objet, maintenant);
      if (!verdict.ok) return refuser(req, res, 400, "validation", verdict.erreur, id);

      // 4. Enregistrement (transaction) et mise à jour de la séquence.
      try {
        var bilan = base.enregistrerLot(id, verdict.mesures, Number(sequence));
        envoyerJson(res, 201, bilan);
      } catch (e) {
        console.error("[erreur] " + e.message);
        envoyerJson(res, 500, { erreur: "erreur interne" });     // pas de détail technique au client
      }
    });
  }

  // --- Lectures -------------------------------------------------------
  function entier(texte, defaut, min, max) {
    var n = /^[0-9]{1,6}$/.test(texte || "") ? Number(texte) : defaut;
    return Math.max(min, Math.min(max, n));
  }

  function lireVelos(res) {
    var maintenant = Date.now();
    envoyerJson(res, 200, {
      maintenantMs: maintenant,
      velos: base.fiches().map(function (f) { return TPMS.flotteResume(f, maintenant); })
    });
  }

  function lireHistorique(res, id, params) {
    if (!TPMS.flotteIdentifiantValide(id)) return envoyerJson(res, 400, { erreur: "identifiant de vélo mal formé" });
    var fiche = base.fiche(id);
    if (!fiche) return envoyerJson(res, 404, { erreur: "vélo inconnu" });
    var maintenant = Date.now();
    var jours = entier(params.get("jours"), 7, 1, 30);
    var h = base.historique(id, maintenant - jours * 86400000);
    envoyerJson(res, 200, {
      id: id, nom: fiche.nom, maintenantMs: maintenant,
      mesures: h.mesures, regonflages: h.regonflages, tendance: fiche.tendance,
      resume: TPMS.flotteResume(fiche, maintenant)
    });
  }

  function lireStatistiques(res) {
    var maintenant = Date.now();
    var resumes = base.fiches().map(function (f) { return TPMS.flotteResume(f, maintenant); });
    var stats = base.agregats(maintenant);
    stats.maintenantMs = maintenant;
    stats.indicateurs = TPMS.flotteIndicateurs(resumes);
    envoyerJson(res, 200, stats);
  }

  // --- Aiguillage -------------------------------------------------------
  var serveur = http.createServer(function (req, res) {
    var url;
    try { url = new URL(req.url, "http://localhost"); } catch (e) { return envoyerJson(res, 400, { erreur: "adresse invalide" }); }
    var chemin = url.pathname;
    var ip = req.socket.remoteAddress || "?";

    if (chemin.indexOf("/api/") === 0) {
      var finBlocage = blocages.get(ip);
      if (finBlocage) {
        if (Date.now() < finBlocage) {
          return envoyerJson(res, 429, { erreur: "adresse bloquée après trop de requêtes refusées", motif: "ip-bloquee" },
            { "Retry-After": String(Math.ceil((finBlocage - Date.now()) / 1000)) });
        }
        blocages.delete(ip);
      }
      if (chemin === "/api/mesures") {
        if (req.method !== "POST") return envoyerJson(res, 405, { erreur: "POST attendu" }, { Allow: "POST" });
        return recevoirMesures(req, res);
      }
      if (req.method !== "GET") return envoyerJson(res, 405, { erreur: "GET attendu" }, { Allow: "GET" });
      if (chemin === "/api/velos") return lireVelos(res);
      if (chemin === "/api/alertes") return envoyerJson(res, 200, { alertes: base.alertes(entier(url.searchParams.get("limite"), 50, 1, 500)) });
      if (chemin === "/api/statistiques") return lireStatistiques(res);
      if (chemin === "/api/refus") return envoyerJson(res, 200, { refus: base.refus(entier(url.searchParams.get("limite"), 20, 1, 200)) });
      var m = /^\/api\/velos\/([^/]+)\/historique$/.exec(chemin);
      if (m) {
        var id;
        try { id = decodeURIComponent(m[1]); } catch (e) { return envoyerJson(res, 400, { erreur: "adresse invalide" }); }
        return lireHistorique(res, id, url.searchParams);
      }
      return envoyerJson(res, 404, { erreur: "route inconnue" });
    }
    servirFichier(req, res, chemin);
  });

  // Contre les connexions lentes (« slowloris ») : délais limités.
  serveur.headersTimeout = 10000;
  serveur.requestTimeout = 15000;
  serveur.keepAliveTimeout = 5000;
  serveur.on("close", function () { base.fermer(); });
  serveur.base = base;
  return serveur;
}

module.exports = { creerServeur: creerServeur, signer: signer, chargerCles: chargerCles };

// ---------------------------------------------------------------------
// Lancement en ligne de commande
// ---------------------------------------------------------------------
if (require.main === module) {
  var port = 8080;
  var i = process.argv.indexOf("--port");
  if (i > 0) port = Number(process.argv[i + 1]);
  var serveur = creerServeur({});
  serveur.listen(port, function () {
    console.log("Serveur de flotte TPMS : http://localhost:" + port + "/flotte/");
    console.log("Base : " + path.join(__dirname, "flotte.db") + " · clés de DÉMO : serveur/cles-demo.json");
  });
  process.on("SIGINT", function () { serveur.close(); process.exit(0); });
}
