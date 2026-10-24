// =====================================================================
// generer-certificats.js — Certificats TLS de la maquette de l'entrepôt
// ---------------------------------------------------------------------
// Lancer : node entrepot/generer-certificats.js
// Résultat : entrepot/certificats/ (exclu de Git : il contient des clés privées)
//
// Une AUTORITÉ DE CERTIFICATION (AC) propre à l'usine signe tous les
// certificats. Chacun fait confiance à l'AC, et à elle seule :
//   - le courtier MQTT présente « courtier » : les passerelles et le
//     serveur vérifient qu'ils parlent au vrai courtier ;
//   - chaque passerelle présente SON certificat (« passerelle-1 »...) et
//     le courtier le vérifie : c'est l'AUTHENTIFICATION MUTUELLE. Le nom
//     dans le certificat sert d'identifiant pour les droits (ACL) ;
//   - le serveur présente « serveur-supervision » au courtier, et
//     « supervision » (HTTPS) aux navigateurs.
// Une passerelle volée ? On révoque SON certificat, sans toucher aux autres.
//
// Pour les démonstrations d'attaque, une SECONDE AC, « pirate », signe
// un certificat « passerelle-9 » : techniquement valable, mais signé par
// quelqu'un que le courtier ne connaît pas → connexion refusée.
//
// Clés sur courbe elliptique P-256, comme serveur/generer-certificat.js
// (même outil openssl, même recherche de l'exécutable).
// =====================================================================
"use strict";
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var trouverOpenssl = require("../serveur/generer-certificat.js").trouverOpenssl;

var DOSSIER = path.join(__dirname, "certificats");

// Certificats à fabriquer : nom (CN), usage, noms et adresses (SAN).
var ENTITES = [
  { nom: "courtier", usage: "serverAuth", san: "DNS:courtier,IP:10.10.20.10" },
  { nom: "supervision", usage: "serverAuth", san: "DNS:supervision,DNS:localhost,IP:10.10.20.20,IP:127.0.0.1" },
  { nom: "serveur-supervision", usage: "clientAuth" },
  { nom: "passerelle-1", usage: "clientAuth" },
  { nom: "passerelle-2", usage: "clientAuth" },
  { nom: "passerelle-3", usage: "clientAuth" }
];

function executer(openssl, args) {
  childProcess.execFileSync(openssl, args, { stdio: "pipe" });
}

// Autorité de certification : certificat auto-signé avec CA:TRUE.
function creerAc(openssl, nom, fichier) {
  executer(openssl, ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-days", "730", "-subj", "/O=Entrepot TPMS (maquette)/CN=" + nom,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout", path.join(DOSSIER, fichier + ".cle"), "-out", path.join(DOSSIER, fichier + ".pem")]);
}

// Certificat d'une entité, signé par l'AC « ac » (fichiers ac.pem / ac.cle).
function creerCertificat(openssl, entite, ac) {
  var cle = path.join(DOSSIER, entite.nom + ".cle");
  var demande = path.join(os.tmpdir(), "tpms-" + entite.nom + "-" + process.pid + ".csr");
  var extensions = path.join(os.tmpdir(), "tpms-" + entite.nom + "-" + process.pid + ".ext");
  executer(openssl, ["req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-subj", "/O=Entrepot TPMS (maquette)/CN=" + entite.nom, "-keyout", cle, "-out", demande]);
  fs.writeFileSync(extensions, "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=" + entite.usage + "\n" +
    (entite.san ? "subjectAltName=" + entite.san + "\n" : ""));
  executer(openssl, ["x509", "-req", "-in", demande, "-CA", path.join(DOSSIER, ac + ".pem"), "-CAkey", path.join(DOSSIER, ac + ".cle"),
    "-CAcreateserial", "-days", "365", "-extfile", extensions, "-out", path.join(DOSSIER, entite.nom + ".pem")]);
  fs.unlinkSync(demande);
  fs.unlinkSync(extensions);
}

function genererTout() {
  var openssl = trouverOpenssl();
  if (!openssl) return null;
  fs.mkdirSync(DOSSIER, { recursive: true });
  creerAc(openssl, "AC de l'usine", "ac");
  ENTITES.forEach(function (e) { creerCertificat(openssl, e, "ac"); });
  creerAc(openssl, "AC pirate", "ac-pirate");
  creerCertificat(openssl, { nom: "passerelle-9", usage: "clientAuth" }, "ac-pirate");
  return DOSSIER;
}

module.exports = { genererTout: genererTout, ENTITES: ENTITES };

if (require.main === module) {
  var dossier = genererTout();
  if (!dossier) {
    console.error("openssl est introuvable (il est livré avec Git pour Windows). Lancer ce script depuis Git Bash.");
    process.exitCode = 1;
  } else {
    console.log("Certificats écrits dans " + dossier + " :");
    fs.readdirSync(dossier).filter(function (f) { return /\.pem$/.test(f); }).forEach(function (f) { console.log("  " + f); });
    console.log("Les fichiers .cle sont des CLÉS PRIVÉES : jamais dans Git (entrepot/.gitignore).");
  }
}
