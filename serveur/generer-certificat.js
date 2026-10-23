// =====================================================================
// generer-certificat.js — Certificat HTTPS AUTO-SIGNÉ de démonstration
// ---------------------------------------------------------------------
// Lancement : node serveur/generer-certificat.js
// Résultat  : serveur/certificats/cert.pem  (certificat, public)
//             serveur/certificats/cle.pem   (clé privée : SECRÈTE)
// Ensuite   : node serveur/serveur.js  démarre tout seul en HTTPS.
//
// Node sait lire un certificat (crypto.X509Certificate) mais pas en
// FABRIQUER un. On appelle donc l'outil « openssl », livré avec Git pour
// Windows (Git Bash) et présent sur Linux et macOS. Commande lancée :
//
//   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1
//     -nodes -days 365 -subj "/CN=localhost"
//     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
//     -keyout cle.pem -out cert.pem
//
//   req -x509        : fabrique directement un certificat (pas une demande)
//   -newkey ec ...   : nouvelle clé sur courbe elliptique P-256 (même
//                      sécurité qu'une clé RSA de 3072 bits, plus courte)
//   -nodes           : clé privée non chiffrée (le serveur démarre seul)
//   -days 365        : valable un an
//   -subj /CN=...    : nom du serveur
//   -addext SAN      : noms et adresses pour lesquels il est valable ;
//                      les navigateurs ne regardent QUE ce champ.
//
// « Auto-signé » : il n'est signé par aucune autorité reconnue. Le
// chiffrement est réel, mais le navigateur affiche un avertissement (il
// ne peut pas vérifier l'identité du serveur). Le script de flotte, lui,
// fait confiance EXPLICITEMENT à ce certificat-là (option « ca »), sans
// désactiver la vérification. En production : certificat d'une autorité
// (Let's Encrypt, gratuit) pour le vrai nom de domaine.
//
// La clé privée ne va JAMAIS dans Git : serveur/.gitignore exclut le
// dossier certificats/.
// =====================================================================
var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");

// Cherche openssl : d'abord dans le PATH, puis aux emplacements de Git
// pour Windows (si le PATH de PowerShell ne le contient pas).
function trouverOpenssl() {
  var candidats = ["openssl",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"];
  for (var i = 0; i < candidats.length; i++) {
    try {
      childProcess.execFileSync(candidats[i], ["version"], { stdio: "pipe" });
      return candidats[i];
    } catch (e) { /* pas ici : on essaie le suivant */ }
  }
  return null;
}

// Fabrique cert.pem et cle.pem dans « dossier ». Retourne leurs chemins,
// ou null si openssl est introuvable.
function genererCertificat(dossier, options) {
  var o = options || {};
  var openssl = trouverOpenssl();
  if (!openssl) return null;
  fs.mkdirSync(dossier, { recursive: true });
  var cert = path.join(dossier, "cert.pem"), cle = path.join(dossier, "cle.pem");
  childProcess.execFileSync(openssl, [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
    "-nodes", "-days", String(o.jours || 365), "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    "-keyout", cle, "-out", cert
  ], { stdio: "pipe" });
  try { fs.chmodSync(cle, 0o600); } catch (e) { /* sans effet sous Windows */ }
  return { cert: cert, cle: cle, openssl: openssl };
}

module.exports = { genererCertificat: genererCertificat, trouverOpenssl: trouverOpenssl };

if (require.main === module) {
  var dossier = path.join(__dirname, "certificats");
  var resultat = genererCertificat(dossier);
  if (!resultat) {
    console.error("openssl est introuvable. Il est livré avec Git pour Windows (Git Bash) : lancer ce script depuis Git Bash,");
    console.error("ou installer OpenSSL. Sans certificat, le serveur démarre en HTTP (démo uniquement).");
    process.exitCode = 1;
  } else {
    var x509 = new crypto.X509Certificate(fs.readFileSync(resultat.cert));
    console.log("Certificat AUTO-SIGNÉ de démonstration créé avec " + resultat.openssl);
    console.log("  " + resultat.cert + " (public)");
    console.log("  " + resultat.cle + " (clé privée, SECRÈTE, exclue de Git)");
    console.log("  valable pour : " + x509.subjectAltName + ", jusqu'au " + new Date(x509.validTo).toLocaleDateString("fr-FR"));
    console.log("  empreinte SHA-256 : " + x509.fingerprint256);
    console.log("Lancer ensuite : node serveur/serveur.js   (HTTPS sur https://localhost:8443/flotte/)");
  }
}
