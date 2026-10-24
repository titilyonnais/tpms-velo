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
//   node:crypto             signature HMAC-SHA256, scrypt des mots de passe,
//                           jetons de session tirés au hasard (serveur/sessions.js)
//
// API REST (JSON) :
//   POST /api/mesures                   un vélo envoie un lot de mesures (SIGNÉ)
//   POST /api/connexion                 { compte, motDePasse } → jeton de session
//   POST /api/deconnexion               détruit la session présentée
// Lectures, avec l'en-tête « Authorization: Bearer <jeton de session> » :
//   GET  /api/moi                       compte, rôle et fin de la session
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
//   - lecture réservée aux comptes identifiés : connexion par mot de
//     passe (empreinte scrypt), puis session qui expire (15 min sans
//     requête, 8 h au plus), rôles technicien et gestionnaire ;
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
var sessions = require("./sessions.js");
var chariots = require("./chariots.js");
var mqtt = require("../entrepot/mqtt.js");

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
// Chaque personne qui consulte l'API se connecte avec son nom de compte
// et son MOT DE PASSE (POST /api/connexion), puis présente le jeton de
// SESSION reçu (« Authorization: Bearer <jeton> »). La session expire ;
// voir serveur/sessions.js. Le serveur ne garde que le sel et l'empreinte
// scrypt de chaque mot de passe. En démo, cles-demo.json donne les mots
// de passe en clair (champ « motDePasse »), hachés dès la lecture ; en
// production il ne contiendrait que « sel » et « empreinte ».

// Ce que chaque rôle a le droit de lire. Le technicien prépare sa
// tournée ; seul le gestionnaire voit le journal de sécurité (il
// contient des adresses IP).
var DROITS = {
  technicien:   ["moi", "velos", "historique", "alertes", "statistiques", "chariots", "passerelles"],
  gestionnaire: ["moi", "velos", "historique", "alertes", "statistiques", "refus", "chariots", "passerelles"]
};
function autorise(role, ressource) {
  return Object.prototype.hasOwnProperty.call(DROITS, role) && DROITS[role].indexOf(ressource) >= 0;
}

// Retourne [{ nom, role, sel, empreinte }].
function chargerComptes(fichier) {
  var config = JSON.parse(fs.readFileSync(fichier, "utf8"));
  var comptes = [];
  Object.keys(config.comptes || {}).forEach(function (nom) {
    var c = config.comptes[nom];
    if (!Object.prototype.hasOwnProperty.call(DROITS, c.role)) return;          // rôle inconnu : ignoré
    var compte = sessions.preparerCompte(nom, c);
    if (compte) comptes.push(compte);
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
// données), l'historique git, les fichiers cachés, et dans la maquette de
// l'entrepôt les certificats et CLÉS PRIVÉES, les données et les journaux
// (le dépôt y est monté en entier dans le conteneur). Par prudence, aucun
// fichier de clé ou de base n'est servi, où qu'il soit.
var DOSSIERS_ENTREPOT_INTERDITS = ["certificats", "donnees", "journaux"];
var EXTENSIONS_INTERDITES = [".cle", ".key", ".db", ".sqlite", ".srl", ".csr"];
function cheminInterdit(morceauxBruts) {
  // En minuscules : sous Windows, /Serveur/ désigne le même dossier que /serveur/.
  var morceaux = morceauxBruts.map(function (m) { return m.toLowerCase(); });
  if (morceaux[0] === "serveur" || morceaux[0] === "node_modules") return true;
  if (morceaux[0] === "entrepot" && DOSSIERS_ENTREPOT_INTERDITS.indexOf(morceaux[1]) >= 0) return true;
  var dernier = morceaux[morceaux.length - 1] || "";
  if (EXTENSIONS_INTERDITES.indexOf(path.extname(dernier).toLowerCase()) >= 0) return true;
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
//             sessions (règles d'expiration, voir sessions.js),
//             horloge (fonction qui donne l'heure en ms ; Date.now par défaut,
//               remplacée dans les tests pour « avancer le temps »),
//             registreChariots (sinon lu dans serveur/capteurs-chariots.json),
//             mqtt: { hote, port, ca, cert, cle, nomServeur } pour recevoir
//               les trames des chariots (version industrielle),
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
  var horloge = o.horloge || Date.now;
  var lesSessions = sessions.creerSessions(o.sessions);

  // Version industrielle : réception des trames des chariots par MQTT.
  var reception = chariots.creerReception(base.db, base.noterRefus, o.registreChariots || chariots.lireRegistre());
  var clientMqtt = null, arretMqtt = false;
  var etatMqtt = { configure: !!o.mqtt, connecte: false, depuisMs: null, derniereErreur: null, refus: 0 };
  // Le serveur s'abonne aux sujets des passerelles, avec SON certificat
  // (les droits du courtier ne lui permettent que de LIRE). En cas de
  // coupure, il se reconnecte toutes les 5 s ; les passerelles, elles,
  // gardent leurs lots en attendant.
  function surMessageMqtt(sujet, contenu) {
    try {
      var probleme = reception.recevoirMessage(sujet, contenu, horloge());
      if (probleme) {
        etatMqtt.refus++;
        if (journal) console.warn("[mqtt] message refusé (" + sujet + ") : " + probleme);
      }
    } catch (e) {
      console.error("[mqtt] erreur de traitement : " + e.message);
    }
  }
  function connecterMqtt() {
    if (arretMqtt) return;
    var m = o.mqtt;
    mqtt.connecter({ hote: m.hote, port: m.port || 8883, ca: m.ca, cert: m.cert, cle: m.cle, nomServeur: m.nomServeur,
      tls: m.tls !== false, idClient: "serveur-supervision", gardeS: 30,
      // Session persistante : pendant un redémarrage du serveur, le courtier
      // garde les lots (QoS 1) au lieu de les jeter ; ils arrivent avant
      // même le SUBSCRIBE, d'où surMessage (défaut trouvé en simulant l'usine).
      sessionPersistante: true, surMessage: function (sujet, contenu) { surMessageMqtt(sujet, contenu); } })
      .then(function (c) {
        clientMqtt = c;
        etatMqtt.connecte = true;
        etatMqtt.depuisMs = Date.now();
        if (journal) console.log("[mqtt] connecté au courtier " + m.hote + ":" + (m.port || 8883));
        function surMessage(sujet, contenu) { surMessageMqtt(sujet, contenu); }
        c.abonner("entrepot/+/passerelle/+/trames", 1, surMessage);
        c.abonner("entrepot/+/passerelle/+/etat", 1, surMessage);
        c.surFermeture(function () {
          clientMqtt = null;
          etatMqtt.connecte = false;
          if (!arretMqtt) setTimeout(connecterMqtt, 5000);
        });
      })
      .catch(function (e) {
        etatMqtt.derniereErreur = e.message;
        if (journal) console.warn("[mqtt] courtier injoignable : " + e.message);
        setTimeout(connecterMqtt, 5000);
      });
  }
  if (o.mqtt) connecterMqtt();

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

  // --- Lecture : quelle session présente-t-on ? ----------------------------
  // Le jeton présenté, s'il y en a un et s'il est bien formé.
  function jetonPresente(req) {
    var entete = req.headers.authorization;
    if (entete === undefined) return { absent: true };
    // Format d'un jeton « Bearer » (RFC 6750), longueur bornée.
    var m = /^Bearer ([A-Za-z0-9._~+/-]{16,128}=*)$/.exec(entete);
    return m ? { jeton: m[1] } : { mal: true };
  }
  // Retourne { compte, finMs } si la session est valable ; sinon { absent }
  // (pas d'en-tête), { expiree } (session terminée : c'est normal) ou
  // { detail } seul (jeton inconnu ou mal formé : suspect).
  function authentifier(req) {
    var p = jetonPresente(req);
    if (p.absent) return { absent: true, detail: "authentification requise : se connecter (POST /api/connexion)" };
    if (p.mal) return { detail: "en-tête Authorization mal formé" };
    var v = sessions.verifierSession(lesSessions, p.jeton, horloge());
    if (v.expiree) return { expiree: true, detail: "session expirée : se reconnecter" };
    if (v.inconnue) return { detail: "jeton invalide" };
    return { compte: v.compte, finMs: v.finMs };
  }

  // Lit un petit corps JSON (au plus maxOctets), puis appelle suite(objet).
  function lireCorpsJson(req, res, maxOctets, suite) {
    var type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return refuser(req, res, 415, "type", "Content-Type application/json attendu", null);
    var morceaux = [], taille = 0, trop = false;
    req.on("data", function (morceau) {
      if (trop) return;
      taille += morceau.length;
      if (taille > maxOctets) {
        trop = true;
        res.setHeader("Connection", "close");
        refuser(req, res, 413, "taille", "corps trop gros (max " + maxOctets + " octets)", null);
        return;
      }
      morceaux.push(morceau);
    });
    req.on("end", function () {
      if (trop) return;
      var objet;
      try { objet = JSON.parse(Buffer.concat(morceaux).toString("utf8")); } catch (e) { objet = null; }
      if (objet === null || typeof objet !== "object") return refuser(req, res, 400, "json", "JSON invalide", null);
      suite(objet);
    });
  }

  // --- POST /api/connexion -------------------------------------------------
  // Un mot de passe faux est journalisé (sans le mot de passe essayé) et
  // compte pour le blocage de l'adresse IP (30 refus par minute au plus,
  // puis 5 min de blocage). scrypt (≈ 50 ms par essai) ralentit en plus
  // une attaque sur le fichier des empreintes, s'il était volé.
  function connexion(req, res) {
    lireCorpsJson(req, res, 1024, function (objet) {
      var nom = typeof objet.compte === "string" ? objet.compte.slice(0, 32) : "";
      var motDePasse = typeof objet.motDePasse === "string" ? objet.motDePasse.slice(0, 256) : "";
      var compte = sessions.verifierMotDePasse(comptes, nom, motDePasse);
      // Même message que le compte existe ou non : on ne renseigne pas l'attaquant.
      if (!compte) return refuser(req, res, 401, "connexion", "compte ou mot de passe incorrect", null);
      var maintenant = horloge();
      var s = sessions.ouvrirSession(lesSessions, compte, maintenant);
      if (journal) console.log("[connexion] " + compte.nom + " depuis " + (req.socket.remoteAddress || "?"));
      envoyerJson(res, 200, {
        jeton: s.jeton, compte: compte.nom, role: compte.role, droits: DROITS[compte.role],
        expireDansS: Math.round((s.finMs - maintenant) / 1000),
        inactiviteMaxS: Math.round(lesSessions.regles.inactiviteMs / 1000)
      });
    });
  }

  // --- POST /api/deconnexion ---------------------------------------------
  // Détruit la session côté serveur : le jeton ne vaut plus rien, même
  // recopié ailleurs. Toujours 204, que la session existe ou non.
  function deconnexion(req, res) {
    var p = jetonPresente(req);
    if (p.jeton) sessions.fermerSession(lesSessions, p.jeton);
    envoyer(res, 204, "", "text/plain");
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
      if (chemin === "/api/connexion" || chemin === "/api/deconnexion") {
        if (req.method !== "POST") return envoyerJson(res, 405, { erreur: "POST attendu" }, { Allow: "POST" });
        return chemin === "/api/connexion" ? connexion(req, res) : deconnexion(req, res);
      }
      if (req.method !== "GET") return envoyerJson(res, 405, { erreur: "GET attendu" }, { Allow: "GET" });

      // Toutes les lectures exigent une session. Sans jeton du tout (page
      // ouverte avant la connexion) ou avec une session expirée, simple
      // 401 : ce n'est pas une attaque, on ne remplit pas le journal de
      // sécurité. Un jeton FAUX, lui, est journalisé et compte pour le
      // blocage de l'adresse IP (anti force brute).
      var auth = authentifier(req);
      if (auth.absent || auth.expiree) {
        return envoyerJson(res, 401, { erreur: auth.detail, motif: auth.expiree ? "session-expiree" : "authentification" },
          { "WWW-Authenticate": "Bearer realm=\"flotte\"" + (auth.expiree ? ", error=\"invalid_token\"" : "") });
      }
      if (!auth.compte) {
        return refuser(req, res, 401, "authentification", auth.detail, null, { "WWW-Authenticate": "Bearer realm=\"flotte\"" });
      }
      var compte = auth.compte;
      var m = /^\/api\/velos\/([^/]+)\/historique$/.exec(chemin);
      var mc = /^\/api\/chariots\/([^/]+)\/historique$/.exec(chemin);
      var ressource = chemin === "/api/moi" ? "moi" : chemin === "/api/velos" ? "velos" : chemin === "/api/alertes" ? "alertes" :
        chemin === "/api/statistiques" ? "statistiques" : chemin === "/api/refus" ? "refus" : m ? "historique" :
        chemin === "/api/chariots" || mc ? "chariots" : chemin === "/api/passerelles" ? "passerelles" : null;
      if (ressource === null) return envoyerJson(res, 404, { erreur: "route inconnue" });
      // Rôle : le compte a-t-il le droit de lire CETTE ressource ?
      if (!autorise(compte.role, ressource)) {
        return refuser(req, res, 403, "droits", "le compte « " + compte.nom + " » n'a pas accès à " + chemin, null);
      }

      if (ressource === "moi") {
        return envoyerJson(res, 200, { compte: compte.nom, role: compte.role, droits: DROITS[compte.role],
          expireDansS: Math.round((auth.finMs - horloge()) / 1000) });
      }
      if (ressource === "velos") return lireVelos(res);
      if (ressource === "alertes") return envoyerJson(res, 200, { alertes: base.alertes(entier(url.searchParams.get("limite"), 50, 1, 500)) });
      if (ressource === "statistiques") return lireStatistiques(res, compte);
      if (ressource === "refus") return envoyerJson(res, 200, { refus: base.refus(entier(url.searchParams.get("limite"), 20, 1, 200)) });
      // Version industrielle : chariots et passerelles (serveur/chariots.js).
      if (ressource === "chariots" && !mc) {
        return envoyerJson(res, 200, { maintenantMs: horloge(), chariots: reception.chariots(horloge()),
          alertes: reception.alertes(entier(url.searchParams.get("limite"), 30, 1, 500)), compteurs: reception.compteurs });
      }
      if (ressource === "chariots") {
        var idChariot;
        try { idChariot = decodeURIComponent(mc[1]); } catch (e) { return envoyerJson(res, 400, { erreur: "adresse invalide" }); }
        if (!/^C[0-9]{2}$/.test(idChariot) || !reception.connu(idChariot)) return envoyerJson(res, 404, { erreur: "chariot inconnu" });
        var heures = entier(url.searchParams.get("heures"), 24, 1, 24 * 30);
        return envoyerJson(res, 200, { chariot: idChariot, mesures: reception.historique(idChariot, Date.now() - heures * 3600000) });
      }
      if (ressource === "passerelles") return envoyerJson(res, 200, { passerelles: reception.passerelles(), mqtt: etatMqtt });
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
  serveur.on("close", function () {
    arretMqtt = true;
    if (clientMqtt) clientMqtt.fermer();
    base.fermer();
  });
  serveur.base = base;
  serveur.reception = reception;
  serveur.comptes = comptes;
  serveur.sessions = lesSessions;
  serveur.https = !!o.tls;
  return serveur;
}

module.exports = {
  creerServeur: creerServeur, signer: signer, chargerCles: chargerCles,
  chargerComptes: chargerComptes, DROITS: DROITS, HSTS: HSTS,
  cheminInterdit: cheminInterdit    // pour vérifier que le simulateur de l'usine applique la même règle
};

// ---------------------------------------------------------------------
// Lancement en ligne de commande
// ---------------------------------------------------------------------
if (require.main === module) {
  var argv = process.argv;
  var dossierCertificats = path.join(__dirname, "certificats");
  // SERVEUR_CERT et SERVEUR_CLE : certificat signé par l'AC de la maquette
  // de l'entrepôt (entrepot/), à la place du certificat auto-signé.
  var fichierCert = process.env.SERVEUR_CERT || path.join(dossierCertificats, "cert.pem");
  var fichierCle = process.env.SERVEUR_CLE || path.join(dossierCertificats, "cle.pem");
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
  // Maquette industrielle (entrepot/) : le courtier MQTT et les fichiers
  // de certificats sont donnés par des variables d'environnement.
  var env = process.env;
  var optionsMqtt = env.MQTT_HOTE ? {
    hote: env.MQTT_HOTE, port: Number(env.MQTT_PORT || 8883), nomServeur: env.MQTT_NOM || env.MQTT_HOTE,
    ca: env.MQTT_CA ? fs.readFileSync(env.MQTT_CA) : undefined,
    cert: env.MQTT_CERT ? fs.readFileSync(env.MQTT_CERT) : undefined,
    cle: env.MQTT_CLE ? fs.readFileSync(env.MQTT_CLE) : undefined,
    tls: !env.MQTT_SANS_TLS
  } : null;
  var serveur = creerServeur({
    cheminBase: cheminBase,
    tls: enHttps ? { cert: fs.readFileSync(fichierCert), key: fs.readFileSync(fichierCle) } : null,
    mqtt: optionsMqtt
  });
  serveur.listen(port, function () {
    console.log("Serveur de flotte TPMS : " + (enHttps ? "https" : "http") + "://localhost:" + port + "/flotte/");
    console.log("Base : " + cheminBase + " · clés et jetons de DÉMO : serveur/cles-demo.json");
    console.log("Comptes de lecture : " + serveur.comptes.map(function (c) { return c.nom + " (" + c.role + ")"; }).join(", "));
    if (enHttps && process.env.SERVEUR_CERT) {
      console.log("HTTPS actif (" + fichierCert + "), certificat signé par l'AC de la maquette de l'entrepôt.");
    } else if (enHttps) {
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
