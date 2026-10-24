// =====================================================================
// intrus.js — Ce que tente un pirate branché sur le réseau OT
// ---------------------------------------------------------------------
// Lancé par demonstration.js dans le conteneur « intrus » (une machine
// branchée sur une prise réseau de l'atelier, VLAN OT). Chaque essai
// affiche UNE ligne : « REFUSÉ : … » ou « ACCEPTÉ : … ».
//
//   node entrepot/intrus.js sans-certificat   connexion au courtier sans certificat client
//   node entrepot/intrus.js ac-pirate         certificat signé par une autre AC (passerelle-9)
//   node entrepot/intrus.js usurpation        certificat VOLÉ de la passerelle 1, publié
//                                             sur le sujet de la passerelle 2
//   node entrepot/intrus.js faux-lot          certificat volé, lot qui se dit de la passerelle 2
//   node entrepot/intrus.js capteur-inconnu   certificat volé, trame d'un capteur absent du registre
//   node entrepot/intrus.js valeur-aberrante  certificat volé, pneu d'un vrai chariot à 20 bar
//   node entrepot/intrus.js rejeu             certificat volé, vieilles annonces (3 h)
//
// Mode contrôle (lancé dans le conteneur de la SUPERVISION, avec son
// identité légitime) : écoute le sujet de la passerelle 2 et dit si le
// message marqué de l'intrus est arrivé.
//   node entrepot/intrus.js observer <marque> <durée en s>
// =====================================================================
"use strict";
var fs = require("node:fs");
var TPMS = require("./node.js");
var mqtt = require("./mqtt.js");

var COURTIER = { hote: "10.10.20.10", port: 8883, nomServeur: "courtier", delaiMs: 5000 };
var SUJET_1 = "entrepot/lyon/passerelle/1/trames";
var SUJET_2 = "entrepot/lyon/passerelle/2/trames";

function lire(nom) { return fs.readFileSync("/certificats/" + nom); }

// Connexion au courtier avec l'identité donnée (null : sans certificat).
function connecterAvec(identite, ac) {
  return mqtt.connecter(Object.assign({}, COURTIER, {
    ca: lire(ac || "ac.pem"),
    cert: identite ? lire(identite + ".pem") : undefined,
    cle: identite ? lire(identite + ".cle") : undefined,
    idClient: "intrus-" + process.pid       // pas « passerelle-1 » : sinon la vraie serait déconnectée
  }));
}

// Une trame TPMS de 18 octets, en hexadécimal, comme celles des capteurs.
function trame(adresse, pressionBar) {
  var octets = adresse.split(":").map(function (h) { return parseInt(h, 16); });
  return Buffer.from(TPMS.encoderTrame({ numero: 1, adresse: octets, pressionBar: pressionBar,
    temperatureC: 15, batteriePct: 80, alarme: 0 })).toString("hex");
}

// Un lot au format des passerelles.
function lot(passerelle, annonces) {
  return JSON.stringify({ passerelle: passerelle, site: "lyon", zone: "quais", envoiMs: Date.now(), annonces: annonces });
}

function fin(texte) { console.log(texte); process.exit(0); }

// Les erreurs TLS d'OpenSSL sont longues : on garde l'alerte envoyée par le courtier.
function expliquer(e) {
  var m = e.message;
  if (/certificate required/.test(m)) return "alerte TLS 116, certificat client exigé";
  if (/unknown ca/.test(m)) return "alerte TLS 48, certificat signé par une AC inconnue";
  return m;
}

// Publie avec le certificat volé de la passerelle 1.
function publierVole(sujet, contenu, explication) {
  connecterAvec("passerelle-1").then(function (c) {
    return c.publier(sujet, contenu, { qos: 1 }).then(function () {
      c.fermer();
      fin("ACCEPTÉ par le courtier : " + explication);
    });
  }).catch(function (e) { fin("REFUSÉ : " + expliquer(e)); });
}

var essai = process.argv[2];
var maintenant = Date.now();
var premierCapteur = JSON.parse(fs.readFileSync(__dirname + "/../serveur/capteurs-chariots.json", "utf8")).capteurs[0];

if (essai === "sans-certificat" || essai === "ac-pirate") {
  var identite = essai === "ac-pirate" ? "passerelle-9" : null;
  connecterAvec(identite, "ac.pem").then(function (c) {
    c.fermer();
    fin("ACCEPTÉ : le courtier a laissé entrer l'intrus !");
  }).catch(function (e) { fin("REFUSÉ par le courtier : " + expliquer(e)); });

} else if (essai === "usurpation") {
  // La marque permet au contrôle de reconnaître CE message.
  var marque = process.argv[3] || "INTRUS";
  publierVole(SUJET_2, JSON.stringify({ passerelle: 2, marque: marque, annonces: [] }),
    "message publié sur le sujet de la passerelle 2 (MQTT 3.1.1 ne signale pas le refus : voir le contrôle)");

} else if (essai === "faux-lot") {
  publierVole(SUJET_1, lot(2, [{ t: maintenant, rssi: -60, trame: trame(premierCapteur.adresse, 8.5) }]),
    "lot « de la passerelle 2 » publié sur le sujet de la passerelle 1");

} else if (essai === "capteur-inconnu") {
  publierVole(SUJET_1, lot(1, [{ t: maintenant, rssi: -60, trame: trame("C4:10:99:00:01", 8.5) }]),
    "trame du capteur C4:10:99:00:01 (absent du registre) publiée");

} else if (essai === "valeur-aberrante") {
  publierVole(SUJET_1, lot(1, [{ t: maintenant, rssi: -60, trame: trame(premierCapteur.adresse, 20) }]),
    "pneu " + premierCapteur.position + " du chariot " + premierCapteur.chariot + " annoncé à 20 bar");

} else if (essai === "rejeu") {
  publierVole(SUJET_1, lot(1, [{ t: maintenant - 3 * 3600000, rssi: -60, trame: trame(premierCapteur.adresse, 8.5) }]),
    "annonces vieilles de 3 h republiées");

} else if (essai === "observer") {
  // Contrôle, avec l'identité de la supervision (droit de LECTURE seulement).
  var attendue = process.argv[3], dureeS = Number(process.argv[4] || 8), recu = false;
  connecterAvec("serveur-supervision").then(function (c) {
    c.abonner(SUJET_2, 1, function (sujet, contenu) {
      if (contenu.toString("utf8").indexOf(attendue) >= 0) recu = true;
    }).then(function () { console.log("à l'écoute"); });
    setTimeout(function () {
      c.fermer();
      fin(recu ? "REÇU : le message de l'intrus est arrivé sur le sujet de la passerelle 2 !"
               : "RIEN REÇU : le courtier a jeté le message de l'intrus (droits ACL)");
    }, dureeS * 1000);
  }).catch(function (e) { fin("contrôle impossible : " + e.message); });

} else {
  console.error("Essai inconnu. Voir l'en-tête de intrus.js.");
  process.exit(1);
}
