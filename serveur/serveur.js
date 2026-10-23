// =====================================================================
// serveur.js — Serveur de supervision de la flotte (Node.js 24)
// ---------------------------------------------------------------------
// Lancement :  node serveur/serveur.js            HTTPS (port 8443) si serveur/certificats/
//                                                 contient cert.pem et cle.pem, sinon HTTP (port 8080)
//              node serveur/serveur.js --https    exige HTTPS (erreur si pas de certificat)
//              node serveur/serveur.js --http     force HTTP même avec un certificat
//              node serveur/serveur.js --port 9000
//              node serveur/serveur.js --base essai.db   (autre fichier de base)
// Certificat de démo : node serveur/generer-certificat.js (auto-signé)
// Puis ouvrir  https://localhost:8443/flotte/  (ou http://localhost:8080/flotte/)
//
// AUCUNE dépendance à installer : uniquement des modules intégrés à Node
//   node:http, node:https   le serveur web (HTTPS = HTTP dans un tunnel TLS chiffré)
//   node:sqlite             la base de données (fichier serveur/flotte.db)
//   node:crypto             signature HMAC-SHA256, empreinte SHA-256 des jetons
//
// API REST (JSON) :
//   POST /api/mesures                   un vélo envoie un lot de mesures (SIGNÉ)
// Lectures, avec l'en-tête « Authorization: Bearer <jeton> » :
//   GET  /api/moi                       compte et rôle du jeton présenté
//   GET  /api/velos                     dernier état de chaque vélo
//   GET  /api/velos/V07/historique?jours=7
//   GET  /api/alertes?limite=50
//   GET  /api/statistiques              indicateurs de l'entreprise
//   GET  /api/refus?limite=20           journal des refus (gestionnaire seulement)
// Les autres adresses servent les fichiers du dépôt (page /flotte/...),
// sans compte : ce sont les mêmes fichiers que sur GitHub Pages.
//
// Cybersécurité (détails dans serveur/README.md) :
//   - chaque vélo signe ses envois (HMAC-SHA256 avec SA clé secrète) ;
//   - lecture réservée aux comptes identifiés (jeton, rôles technicien
//     et gestionnaire) ; le serveur ne garde que l'empreinte des jetons ;
//   - HTTPS (confidentialité) dès qu'un certificat est présent ;
//   - fenêtre d'horodatage de ±60 s et numéro de séquence : anti-rejeu ;
//   - validation stricte de chaque champ (flotte/flotte-logique.js) ;
//   - requêtes SQL paramétrées uniquement (serveur/base.js) ;
//   - limitation de débit par vélo, blocage d'une IP qui accumule les
//     refus, taille de corps limitée, délais de lecture limités ;
//   - en-têtes de sécurité sur toutes les réponses ;
//   - journal des refus (table « refus » + console).
// =====================================================================
var http = require("node:http");
var https = require("node:https");
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
// Comptes de lecture (technicien, gestionnaire)
// ---------------------------------------------------------------------
// Chaque personne qui consulte l'API présente un JETON (un long texte
// aléatoire) dans l'en-tête « Authorization: Bearer <jeton> ».
// Le serveur ne garde PAS les jetons : seulement leur empreinte SHA-256
// (comme on stocke l'empreinte d'un mot de passe). Si la configuration
// fuit, on ne peut pas en déduire les jetons. Un jeton de 192 bits tiré
// au hasard ne se devine pas : un simple SHA-256 suffit (pour un mot de
// passe choisi par un humain, il faudrait une fonction lente : scrypt).
// En démo, cles-demo.json donne les jetons en clair (champ « jeton »),
// hachés dès la lecture ; en production il ne contiendrait que le champ
// « empreinte ».
function empreinteJeton(jeton) {
  return crypto.createHash("sha256").update(jeton, "utf8").digest();
}

// Ce que chaque rôle a le droit de lire. Le technicien prépare sa
// tournée ; seul le gestionnaire voit le journal de sécurité (il
// contient des adresses IP).
var DROITS = {
  technicien:   ["moi", "velos", "historique", "alertes", "statistiques"],
  gestionnaire: ["moi", "velos", "historique", "alertes", "statistiques", "refus"]
};
function autorise(role, ressource) {
  return Object.prototype.hasOwnProperty.call(DROITS, role) && DROITS[role].indexOf(ressource) >= 0;
}

// Retourne [{ nom, role, empreinte (Buffer de 32 octets) }].
function chargerComptes(fichier) {
  var config = JSON.parse(fs.readFileSync(fichier, "utf8"));
  var comptes = [];
  Object.keys(config.comptes || {}).forEach(function (nom) {
    var c = config.comptes[nom];
    if (!Object.prototype.hasOwnProperty.call(DROITS, c.role)) return;          // rôle inconnu : ignoré
    var empreinte = null;
    if (typeof c.empreinte === "string" && /^[0-9a-f]{64}$/.test(c.empreinte)) empreinte = Buffer.from(c.empreinte, "hex");
    else if (typeof c.jeton === "string" && c.jeton.length >= 16) empreinte = empreinteJeton(c.jeton);   // démo
    // Le jeton en clair n'est PAS gardé en mémoire : seulement son empreinte.
    if (empreinte) comptes.push({ nom: nom, role: c.role, empreinte: empreinte });
  });
  return comptes;
}

// ---------------------------------------------------------------------
// HTTPS : en-tête HSTS
// ---------------------------------------------------------------------
// « Strict-Transport-Security » : le navigateur retient de n'utiliser
// QUE HTTPS pour ce site pendant max-age secondes (plus de retour
// possible vers HTTP en clair, même si un attaquant l'y pousse).
// On commence par 1 jour, comme le recommande un déploiement prudent ;
// en production on monte à 1 an (31536000) une fois HTTPS validé.
// Les navigateurs ignorent cet en-tête si le certificat n'est pas de
// confiance (certificat auto-signé de démo) et sur une adresse IP.
var HSTS = "max-age=86400";

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
//             requetesParMinute, refusParMinuteMax, blocageMs,
//             comptes (sinon lus dans fichierCles),
//             tls: { cert, key } pour HTTPS (contenu des fichiers .pem) }
function creerServeur(options) {
  var o = options || {};
  var fichierCles = o.fichierCles || path.join(__dirname, "cles-demo.json");
  var cles = o.cles || chargerCles(fichierCles);
  var comptes = o.comptes || chargerComptes(fichierCles);
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
  function refuser(req, res, statut, motif, detail, veloAnnonce, enTetesEnPlus) {
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
    envoyerJson(res, statut, { erreur: detail, motif: motif }, enTetesEnPlus);
  }

  // --- Lecture : qui présente quel jeton ? ------------------------------
  // Retourne { compte } si le jeton est bon, sinon { detail }.
  function authentifier(req) {
    var entete = req.headers.authorization;
    if (entete === undefined) return { absent: true, detail: "authentification requise (en-tête Authorization: Bearer <jeton>)" };
    // Format d'un jeton « Bearer » (RFC 6750), longueur bornée.
    var m = /^Bearer ([A-Za-z0-9._~+\/-]{16,128}=*)$/.exec(entete);
    if (!m) return { detail: "en-tête Authorization mal formé" };
    var empreinte = empreinteJeton(m[1]);
    var trouve = null;
    // On compare à TOUS les comptes, à temps constant (crypto.timingSafeEqual) :
    // le temps de réponse ne renseigne pas sur le jeton essayé.
    comptes.forEach(function (c) {
      if (crypto.timingSafeEqual(c.empreinte, empreinte) && trouve === null) trouve = c;
    });
    return trouve ? { compte: trouve } : { detail: "jeton invalide" };
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

  function lireStatistiques(res, compte) {
    var maintenant = Date.now();
    var resumes = base.fiches().map(function (f) { return TPMS.flotteResume(f, maintenant); });
    var stats = base.agregats(maintenant);
    // Les chiffres de sécurité (refus par motif) : gestionnaire seulement.
    if (!autorise(compte.role, "refus")) stats.securite = null;
    stats.maintenantMs = maintenant;
    stats.indicateurs = TPMS.flotteIndicateurs(resumes);
    envoyerJson(res, 200, stats);
  }

  // --- Aiguillage -------------------------------------------------------
  function aiguiller(req, res) {
    if (o.tls) res.setHeader("Strict-Transport-Security", HSTS);
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

      // Toutes les lectures exigent un compte. Sans jeton du tout (page
      // ouverte avant la connexion), simple 401 : ce n'est pas une attaque,
      // on ne remplit pas le journal de sécurité. Un jeton FAUX, lui, est
      // journalisé et compte pour le blocage de l'adresse IP (anti force brute).
      var auth = authentifier(req);
      if (auth.absent) {
        return envoyerJson(res, 401, { erreur: auth.detail, motif: "authentification" }, { "WWW-Authenticate": "Bearer realm=\"flotte\"" });
      }
      if (!auth.compte) {
        return refuser(req, res, 401, "authentification", auth.detail, null, { "WWW-Authenticate": "Bearer realm=\"flotte\"" });
      }
      var compte = auth.compte;
      var m = /^\/api\/velos\/([^/]+)\/historique$/.exec(chemin);
      var ressource = chemin === "/api/moi" ? "moi" : chemin === "/api/velos" ? "velos" : chemin === "/api/alertes" ? "alertes" :
        chemin === "/api/statistiques" ? "statistiques" : chemin === "/api/refus" ? "refus" : m ? "historique" : null;
      if (ressource === null) return envoyerJson(res, 404, { erreur: "route inconnue" });
      // Rôle : le compte a-t-il le droit de lire CETTE ressource ?
      if (!autorise(compte.role, ressource)) {
        return refuser(req, res, 403, "droits", "le compte « " + compte.nom + " » n'a pas accès à " + chemin, null);
      }

      if (ressource === "moi") return envoyerJson(res, 200, { compte: compte.nom, role: compte.role, droits: DROITS[compte.role] });
      if (ressource === "velos") return lireVelos(res);
      if (ressource === "alertes") return envoyerJson(res, 200, { alertes: base.alertes(entier(url.searchParams.get("limite"), 50, 1, 500)) });
      if (ressource === "statistiques") return lireStatistiques(res, compte);
      if (ressource === "refus") return envoyerJson(res, 200, { refus: base.refus(entier(url.searchParams.get("limite"), 20, 1, 200)) });
      var id;
      try { id = decodeURIComponent(m[1]); } catch (e) { return envoyerJson(res, 400, { erreur: "adresse invalide" }); }
      return lireHistorique(res, id, url.searchParams);
    }
    servirFichier(req, res, chemin);
  }

  // HTTP, ou HTTPS si on a un certificat (TLS 1.2 au minimum).
  var serveur = o.tls
    ? https.createServer({ cert: o.tls.cert, key: o.tls.key, minVersion: "TLSv1.2" }, aiguiller)
    : http.createServer(aiguiller);

  // Contre les connexions lentes (« slowloris ») : délais limités.
  serveur.headersTimeout = 10000;
  serveur.requestTimeout = 15000;
  serveur.keepAliveTimeout = 5000;
  serveur.on("close", function () { base.fermer(); });
  serveur.base = base;
  serveur.comptes = comptes;
  serveur.https = !!o.tls;
  return serveur;
}

module.exports = {
  creerServeur: creerServeur, signer: signer, chargerCles: chargerCles,
  chargerComptes: chargerComptes, empreinteJeton: empreinteJeton, DROITS: DROITS, HSTS: HSTS
};

// ---------------------------------------------------------------------
// Lancement en ligne de commande
// ---------------------------------------------------------------------
if (require.main === module) {
  var argv = process.argv;
  var dossierCertificats = path.join(__dirname, "certificats");
  var fichierCert = path.join(dossierCertificats, "cert.pem"), fichierCle = path.join(dossierCertificats, "cle.pem");
  var certificatPresent = fs.existsSync(fichierCert) && fs.existsSync(fichierCle);
  var enHttps = argv.indexOf("--https") >= 0 || (certificatPresent && argv.indexOf("--http") < 0);
  if (enHttps && !certificatPresent) {
    console.error("HTTPS demandé, mais serveur/certificats/cert.pem et cle.pem sont absents.");
    console.error("Pour un certificat de démonstration : node serveur/generer-certificat.js");
    process.exit(1);
  }
  var port = enHttps ? 8443 : 8080;
  var i = argv.indexOf("--port");
  if (i > 0) port = Number(argv[i + 1]);
  var j = argv.indexOf("--base");
  var cheminBase = j > 0 ? path.resolve(argv[j + 1]) : path.join(__dirname, "flotte.db");
  var serveur = creerServeur({
    cheminBase: cheminBase,
    tls: enHttps ? { cert: fs.readFileSync(fichierCert), key: fs.readFileSync(fichierCle) } : null
  });
  serveur.listen(port, function () {
    console.log("Serveur de flotte TPMS : " + (enHttps ? "https" : "http") + "://localhost:" + port + "/flotte/");
    console.log("Base : " + cheminBase + " · clés et jetons de DÉMO : serveur/cles-demo.json");
    console.log("Comptes de lecture : " + serveur.comptes.map(function (c) { return c.nom + " (" + c.role + ")"; }).join(", "));
    if (enHttps) {
      console.log("HTTPS actif (serveur/certificats/cert.pem). Certificat auto-signé de démo : le navigateur affiche");
      console.log("un avertissement, c'est normal. Script de flotte : node serveur/flotte-vers-serveur.js --https");
    } else {
      console.warn("");
      console.warn("ATTENTION : serveur en HTTP, SANS chiffrement. Les jetons des comptes et les mesures circulent en");
      console.warn("clair : quelqu'un sur le même réseau peut les lire. Acceptable pour une démo sur ce PC uniquement.");
      console.warn("Pour passer en HTTPS : node serveur/generer-certificat.js, puis relancer le serveur.");
      console.warn("");
    }
  });
  process.on("SIGINT", function () { serveur.close(); process.exit(0); });
}
