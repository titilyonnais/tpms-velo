// =====================================================================
// flotte-vers-serveur.js — La flotte simulée envoie ses mesures au serveur
// ---------------------------------------------------------------------
// Lancement (le serveur doit tourner : node serveur/serveur.js) :
//   node serveur/flotte-vers-serveur.js                 14 derniers jours, en accéléré
//   node serveur/flotte-vers-serveur.js --jours 28 --graine 7
//   node serveur/flotte-vers-serveur.js --attaque-rejeu       rejoue une requête capturée
//   node serveur/flotte-vers-serveur.js --attaque-signature   modifie un lot signé
//   node serveur/flotte-vers-serveur.js --continu             puis continue en temps réel
//   node serveur/flotte-vers-serveur.js --https               serveur en HTTPS (https://localhost:8443)
// Autres options : --url http://localhost:8080 --lot-heures 6 --pause-ms 550
//   --jeton <jeton>  compte utilisé pour LIRE les statistiques (par défaut,
//                    le compte « technicien » de serveur/cles-demo.json)
//   --ca <fichier>   certificat à qui faire confiance en HTTPS (par défaut
//                    serveur/certificats/cert.pem, le certificat de démo)
//
// La simulation (flotte/flotte.js) rejoue les N derniers jours jusqu'à
// maintenant : les dates des mesures sont donc réalistes pour le serveur.
// Chaque lot est signé comme le ferait le boîtier (HMAC-SHA256 avec la
// clé du vélo, horodatage, numéro de séquence).
// =====================================================================
var fs = require("node:fs");
var http = require("node:http");
var https = require("node:https");
var path = require("node:path");
var TPMS = require("../flotte/node.js");
var outils = require("./serveur.js");

// ---------------------------------------------------------------------
// Requête HTTP ou HTTPS, réponse JSON
// ---------------------------------------------------------------------
// On n'utilise pas fetch() ici : il ne permet pas de choisir à quel
// certificat faire confiance. Avec node:https, l'option « ca » dit :
// « fais confiance à CE certificat (auto-signé, de démo) ». La
// vérification reste ACTIVE : un autre certificat (celui d'un pirate qui
// s'interposerait) serait refusé. On ne met JAMAIS
// rejectUnauthorized: false, qui accepterait n'importe quel serveur.
// options = { methode, enTetes, corps, ca (contenu du certificat) }
// Retourne une promesse de { statut, json, enTetes }.
function requeteJson(adresse, options) {
  var o = options || {};
  var url = new URL(adresse);
  var bibliotheque = url.protocol === "https:" ? https : http;
  return new Promise(function (ok, echec) {
    var req = bibliotheque.request(url, {
      method: o.methode || "GET",
      headers: Object.assign({}, o.enTetes || {}, o.corps !== undefined ? { "Content-Length": Buffer.byteLength(o.corps) } : {}),
      ca: url.protocol === "https:" && o.ca ? o.ca : undefined,
      timeout: 15000
    }, function (res) {
      var morceaux = [];
      res.on("data", function (m) { morceaux.push(m); });
      res.on("end", function () {
        var json = null;
        try { json = JSON.parse(Buffer.concat(morceaux).toString("utf8")); } catch (e) { /* corps vide ou non JSON */ }
        ok({ statut: res.statusCode, json: json, enTetes: res.headers });
      });
    });
    req.on("timeout", function () { req.destroy(new Error("délai dépassé")); });
    req.on("error", echec);
    if (o.corps !== undefined) req.write(o.corps);
    req.end();
  });
}

// ---------------------------------------------------------------------
// Client : prépare et envoie des requêtes signées
// ---------------------------------------------------------------------
// options = { ca } pour un serveur HTTPS à certificat auto-signé.
function creerClient(urlServeur, cles, options) {
  var ca = options && options.ca;
  var sequences = new Map();
  return {
    // Prépare une requête signée. options.cleDe : signer avec la clé d'un
    // AUTRE vélo (pour la démonstration d'attaque).
    preparer: function (veloId, mesures, options) {
      var o = options || {};
      var maintenant = o.horodatageMs || Date.now();
      var sequence = TPMS.flotteProchaineSequence(sequences.get(veloId) || 0, maintenant);
      sequences.set(veloId, sequence);
      var corps = JSON.stringify({ mesures: mesures });
      var horodatage = String(maintenant);
      var cle = cles.get(o.cleDe || veloId);
      var signature = outils.signer(cle, TPMS.flotteMessageASigner(veloId, horodatage, String(sequence), corps));
      return {
        url: urlServeur + "/api/mesures",
        enTetes: {
          "Content-Type": "application/json",
          "X-Velo-Id": veloId,
          "X-Horodatage": horodatage,
          "X-Sequence": String(sequence),
          "X-Signature": signature
        },
        corps: corps
      };
    },
    envoyer: async function (requete) {
      var r = await requeteJson(requete.url, { methode: "POST", enTetes: requete.enTetes, corps: requete.corps, ca: ca });
      return { statut: r.statut, json: r.json };
    },
    // Lecture de l'API avec un compte (jeton « Bearer »).
    lire: function (chemin, jeton) {
      return requeteJson(urlServeur + chemin, { enTetes: jeton ? { Authorization: "Bearer " + jeton } : {}, ca: ca });
    }
  };
}

function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

// Envoie un lot ; si le serveur dit « trop de requêtes » (429), on
// attend et on recommence avec une NOUVELLE requête signée.
async function envoyerLot(client, lot) {
  for (var essai = 0; essai < 5; essai++) {
    var r = await client.envoyer(client.preparer(lot.veloId, lot.mesures));
    if (r.statut !== 429) return r;
    await attendre(1500);
  }
  return r;
}

function options(argv) {
  function valeur(nom, defaut) {
    var i = argv.indexOf(nom);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : defaut;
  }
  var enHttps = argv.indexOf("--https") >= 0;
  return {
    url: valeur("--url", enHttps ? "https://localhost:8443" : "http://localhost:8080").replace(/\/$/, ""),
    jeton: valeur("--jeton", null),
    ca: valeur("--ca", path.join(__dirname, "certificats", "cert.pem")),
    jours: Number(valeur("--jours", 14)),
    graine: Number(valeur("--graine", 42)),
    lotHeures: Number(valeur("--lot-heures", 6)),
    pauseMs: Number(valeur("--pause-ms", 550)),
    attaqueRejeu: argv.indexOf("--attaque-rejeu") >= 0,
    attaqueSignature: argv.indexOf("--attaque-signature") >= 0,
    continu: argv.indexOf("--continu") >= 0
  };
}

function afficherReponse(titre, r) {
  console.log("  " + titre + " → HTTP " + r.statut + (r.json && r.json.motif ? " (" + r.json.motif + ") " + r.json.erreur : " " + JSON.stringify(r.json)));
}

// ---------------------------------------------------------------------
// Démonstrations d'attaques
// ---------------------------------------------------------------------
async function attaqueRejeu(client, requeteCapturee) {
  console.log("\n[ATTAQUE] Rejeu : un pirate a capturé une requête valide de " + requeteCapturee.enTetes["X-Velo-Id"] +
    " et la renvoie telle quelle (même signature, même séquence).");
  afficherReponse("requête rejouée", await client.envoyer(requeteCapturee));
  console.log("  Le serveur a déjà vu cette séquence : refus. Rejouée plus tard, elle serait aussi refusée (horodatage > 60 s).");
}

async function attaqueSignature(client, lot) {
  var id = lot.veloId;
  console.log("\n[ATTAQUE] Signature : un pirate intercepte un lot de " + id + " et remplace la pression avant par 2,50 bar.");
  var requete = client.preparer(id, lot.mesures);
  var falsifie = JSON.parse(requete.corps);
  falsifie.mesures[0].pAv = 2.5;
  requete.corps = JSON.stringify(falsifie);           // la signature, elle, n'a pas changé
  afficherReponse("lot modifié", await client.envoyer(requete));
  console.log("[ATTAQUE] Usurpation : le pirate signe avec la clé d'un autre vélo (V03) en se faisant passer pour " + id + ".");
  afficherReponse("mauvaise clé", await client.envoyer(client.preparer(id, lot.mesures, { cleDe: id === "V03" ? "V04" : "V03" })));
}

// ---------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------
async function principal() {
  var o = options(process.argv);
  var fichierCles = path.join(__dirname, "cles-demo.json");
  var cles = outils.chargerCles(fichierCles);
  // Jeton de lecture : celui donné en option, sinon le compte « technicien » de démo.
  var jeton = o.jeton;
  if (!jeton) {
    var comptes = JSON.parse(fs.readFileSync(fichierCles, "utf8")).comptes || {};
    jeton = comptes.technicien ? comptes.technicien.jeton : null;
  }
  // HTTPS : on fait confiance au certificat de démo (et à lui seul).
  var ca = null;
  if (o.url.indexOf("https://") === 0) {
    if (fs.existsSync(o.ca)) {
      ca = fs.readFileSync(o.ca);
      console.log("HTTPS : confiance accordée au certificat " + o.ca);
    } else {
      console.log("HTTPS : pas de certificat " + o.ca + " ; seules les autorités reconnues du système seront acceptées.");
    }
  }
  var client = creerClient(o.url, cles, { ca: ca });

  try {
    var essai = await client.lire("/api/velos", jeton);
    if (essai.statut === 401) throw new Error("jeton refusé (401) : vérifier --jeton");
    if (essai.statut !== 200) throw new Error("HTTP " + essai.statut);
  } catch (e) {
    if (/CERT|certificate/i.test(String(e.code) + " " + e.message)) {
      console.error("Certificat du serveur NON RECONNU (" + e.message + ") : connexion refusée, c'est voulu.");
      console.error("Pour le certificat de démo : --ca serveur/certificats/cert.pem (valeur par défaut).");
      process.exitCode = 1;
      return;
    }
    console.error("Serveur injoignable sur " + o.url + " (" + e.message + "). Lancer d'abord : node serveur/serveur.js" +
      (o.url.indexOf("https://") === 0 ? "" : " (ou --https si le serveur est en HTTPS)"));
    process.exitCode = 1;
    return;
  }

  var lotMs = o.lotHeures * 3600000;
  var debut = Date.now() - o.jours * 86400000;
  var f = TPMS.creerFlotte({ graine: o.graine, debutMs: debut, lotMs: lotMs, garderLots: true });
  console.log("Flotte de " + f.velos.length + " vélos, graine " + o.graine + " : " + o.jours + " jours simulés jusqu'à maintenant, " +
    "un lot par vélo toutes les " + o.lotHeures + " h.");

  var bilan = { requetes: 0, acceptees: 0, refusees: 0, mesures: 0, alertes: 0 };
  var capturee = null, lotPourAttaque = null, jourAffiche = -1;
  var t0 = Date.now();

  while (f.tMs < Date.now() - 1000) {
    var debutTour = Date.now();
    TPMS.flotteAvancerJusqua(f, Math.min(f.tMs + lotMs, Date.now()));
    var lots = TPMS.flotteLotsAEnvoyer(f);
    var reponses = await Promise.all(lots.map(function (lot) { return envoyerLot(client, lot); }));
    reponses.forEach(function (r, k) {
      bilan.requetes++;
      if (r.statut === 201) {
        bilan.acceptees++;
        bilan.mesures += r.json.acceptees;
        bilan.alertes += r.json.alertes;
      } else {
        bilan.refusees++;
        afficherReponse("lot " + lots[k].veloId + " refusé", r);
      }
    });
    if (lots.length > 0 && !lotPourAttaque) lotPourAttaque = lots[1] || lots[0];
    // On « capture » une requête valide, comme un pirate sur le réseau.
    if (o.attaqueRejeu && !capturee && lots.length > 0) {
      capturee = client.preparer(lots[0].veloId, [lots[0].mesures[lots[0].mesures.length - 1]]);
      var r0 = await client.envoyer(capturee);
      console.log("  (requête de " + lots[0].veloId + " envoyée normalement : HTTP " + r0.statut + ")");
    }

    var jour = Math.floor((f.tMs - debut) / 86400000);
    if (jour !== jourAffiche) {
      jourAffiche = jour;
      console.log("Jour " + jour + "/" + o.jours + " : " + bilan.acceptees + " lots acceptés, " +
        bilan.mesures + " mesures, " + bilan.alertes + " alertes, " + bilan.refusees + " refus");
    }
    // Rythme : rester sous la limite du serveur (120 requêtes / min / vélo).
    var duree = Date.now() - debutTour;
    if (lots.length > 0 && duree < o.pauseMs) await attendre(o.pauseMs - duree);
  }
  console.log("Rattrapage terminé en " + Math.round((Date.now() - t0) / 1000) + " s : " + bilan.acceptees + "/" + bilan.requetes +
    " lots acceptés, " + bilan.mesures + " mesures.");

  if (o.attaqueRejeu && capturee) await attaqueRejeu(client, capturee);
  if (o.attaqueSignature && lotPourAttaque) await attaqueSignature(client, lotPourAttaque);

  var stats = (await client.lire("/api/statistiques", jeton)).json;
  var I = stats.indicateurs;
  console.log("\nIndicateurs du serveur : " + I.aRegonfler + " vélo(s) à regonfler (dont " + I.urgents + " urgent(s)), " +
    I.immobilises + " immobilisé(s), " + I.fuitesLentes + " fuite(s) lente(s), " + I.boitiersARecharger + " boîtier(s) à recharger.");
  if (stats.regonflages.tempsMoyenEntreJ !== null) {
    console.log("Temps moyen entre deux regonflages : " + stats.regonflages.tempsMoyenEntreJ.toFixed(1).replace(".", ",") + " jours.");
  }
  if (stats.securite && stats.securite.refusParMotif.length > 0) {
    console.log("Refus enregistrés : " + stats.securite.refusParMotif.map(function (m) { return m.motif + " × " + m.n; }).join(", "));
  }
  console.log("Supervision : " + o.url + "/flotte/");

  if (o.continu) {
    console.log("\nMode continu : la flotte avance en temps réel, un lot toutes les 5 min (Ctrl+C pour arrêter).");
    f.lotMs = 5 * 60000;
    f.velos.forEach(function (v) { v.boitier.prochainEnvoiMs = f.tMs + f.lotMs; });
    for (;;) {
      await attendre(10000);
      TPMS.flotteAvancerJusqua(f, Date.now());
      var lotsContinus = TPMS.flotteLotsAEnvoyer(f);
      for (var i = 0; i < lotsContinus.length; i++) {
        var rc = await envoyerLot(client, lotsContinus[i]);
        if (rc.statut !== 201) afficherReponse("lot " + lotsContinus[i].veloId, rc);
      }
      if (lotsContinus.length > 0) console.log(new Date().toLocaleTimeString("fr-FR") + " : " + lotsContinus.length + " lots envoyés");
    }
  }
}

module.exports = { creerClient: creerClient, envoyerLot: envoyerLot, requeteJson: requeteJson };

if (require.main === module) {
  principal().catch(function (e) { console.error(e); process.exitCode = 1; });
}
