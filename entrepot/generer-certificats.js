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
// Une passerelle volée ? On révoque SON certificat, sans toucher aux autres :
// l'AC publie une LISTE DE RÉVOCATION (crl.pem) que le courtier consulte à
// chaque connexion. La maquette rejoue l'histoire : la passerelle 1 a été
// volée avec son ancien certificat (« passerelle-1-ancien », même nom
// CN=passerelle-1) ; on l'a révoqué et on a posé un certificat neuf sur la
// passerelle de remplacement. Le voleur est refusé, la vraie passerelle non.
//   node entrepot/generer-certificats.js --revoquer <nom>   (puis relancer le courtier)
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
// entite.cn : nom inscrit dans le certificat, s'il diffère du nom du fichier.
function creerCertificat(openssl, entite, ac) {
  var cle = path.join(DOSSIER, entite.nom + ".cle");
  var demande = path.join(os.tmpdir(), "tpms-" + entite.nom + "-" + process.pid + ".csr");
  var extensions = path.join(os.tmpdir(), "tpms-" + entite.nom + "-" + process.pid + ".ext");
  executer(openssl, ["req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-subj", "/O=Entrepot TPMS (maquette)/CN=" + (entite.cn || entite.nom), "-keyout", cle, "-out", demande]);
  fs.writeFileSync(extensions, "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=" + entite.usage + "\n" +
    (entite.san ? "subjectAltName=" + entite.san + "\n" : ""));
  executer(openssl, ["x509", "-req", "-in", demande, "-CA", path.join(DOSSIER, ac + ".pem"), "-CAkey", path.join(DOSSIER, ac + ".cle"),
    "-CAcreateserial", "-days", "365", "-extfile", extensions, "-out", path.join(DOSSIER, entite.nom + ".pem")]);
  fs.unlinkSync(demande);
  fs.unlinkSync(extensions);
}

// La base de l'AC (registre des certificats révoqués) et sa configuration
// pour « openssl ca ». Chemins avec des « / » (openssl les lit aussi sous Windows).
function configAc() {
  var base = path.join(DOSSIER, "ac-base");
  fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(path.join(base, "index.txt"))) fs.writeFileSync(path.join(base, "index.txt"), "");
  if (!fs.existsSync(path.join(base, "crlnumber"))) fs.writeFileSync(path.join(base, "crlnumber"), "1000\n");
  var cnf = path.join(base, "openssl.cnf");
  fs.writeFileSync(cnf, "[ ca ]\ndefault_ca = ac_usine\n\n[ ac_usine ]\ndir = " + base.replace(/\\/g, "/") +
    "\ndatabase = $dir/index.txt\ncrlnumber = $dir/crlnumber\ndefault_md = sha256\ndefault_crl_days = 365\n");
  return cnf;
}

// Publie la liste de révocation signée par l'AC : certificats/crl.pem.
function publierCrl(openssl) {
  executer(openssl, ["ca", "-config", configAc(), "-gencrl", "-keyfile", path.join(DOSSIER, "ac.cle"),
    "-cert", path.join(DOSSIER, "ac.pem"), "-out", path.join(DOSSIER, "crl.pem")]);
}

// Révoque le certificat « nom » (fichier certificats/nom.pem) et republie la liste.
function revoquer(openssl, nom) {
  executer(openssl, ["ca", "-config", configAc(), "-revoke", path.join(DOSSIER, nom + ".pem"),
    "-keyfile", path.join(DOSSIER, "ac.cle"), "-cert", path.join(DOSSIER, "ac.pem"), "-crl_reason", "keyCompromise"]);
  publierCrl(openssl);
}

function genererTout() {
  var openssl = trouverOpenssl();
  if (!openssl) return null;
  fs.rmSync(path.join(DOSSIER, "ac-base"), { recursive: true, force: true });   // nouvelle AC : registre neuf
  fs.mkdirSync(DOSSIER, { recursive: true });
  creerAc(openssl, "AC de l'usine", "ac");
  ENTITES.forEach(function (e) { creerCertificat(openssl, e, "ac"); });
  // La passerelle volée : son ancien certificat, au nom de passerelle-1, révoqué.
  creerCertificat(openssl, { nom: "passerelle-1-ancien", cn: "passerelle-1", usage: "clientAuth" }, "ac");
  revoquer(openssl, "passerelle-1-ancien");
  creerAc(openssl, "AC pirate", "ac-pirate");
  creerCertificat(openssl, { nom: "passerelle-9", usage: "clientAuth" }, "ac-pirate");
  return DOSSIER;
}

module.exports = { genererTout: genererTout, revoquer: revoquer, ENTITES: ENTITES };

if (require.main === module && process.argv[2] === "--revoquer") {
  var openssl = trouverOpenssl();
  revoquer(openssl, process.argv[3]);
  console.log("Certificat « " + process.argv[3] + " » révoqué ; liste publiée dans certificats/crl.pem.");
  console.log("Relancer le courtier pour qu'il la relise : docker compose restart courtier");
} else if (require.main === module) {
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
