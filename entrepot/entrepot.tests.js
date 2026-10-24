// =====================================================================
// entrepot.tests.js — Vérifications de la version industrielle
// (client MQTT, passerelles, réception des trames par le serveur)
// ---------------------------------------------------------------------
// Se lance : node entrepot/entrepot.tests.js (et par simulateur/tests/tout.js)
// Aucun courtier ni Docker n'est nécessaire : un faux courtier minimal,
// lancé dans le test, répond comme Mosquitto. Les essais avec le vrai
// Mosquitto et le réseau complet sont dans la maquette (entrepot/README.md).
// =====================================================================
"use strict";
var net = require("node:net");
var mqtt = require("./mqtt.js");

var resultats = { reussis: 0, rates: 0, lignes: [] };
function verifier(nom, condition, detail) {
  if (condition) { resultats.reussis++; resultats.lignes.push("OK     " + nom); }
  else { resultats.rates++; resultats.lignes.push("ÉCHEC  " + nom + (detail !== undefined ? "  → obtenu : " + detail : "")); }
}
function hexa(b) { return Array.from(b).map(function (x) { return x.toString(16).padStart(2, "0").toUpperCase(); }).join(" "); }
function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

// ---------------------------------------------------------------------
// 1. Codage des paquets MQTT (norme 3.1.1)
// ---------------------------------------------------------------------
(function () {
  var cas = [[0, "00"], [127, "7F"], [128, "80 01"], [16383, "FF 7F"], [16384, "80 80 01"], [268435455, "FF FF FF 7F"]];
  var bons = cas.every(function (c) { return hexa(mqtt.encoderLongueur(c[0])) === c[1]; });
  verifier("MQTT : longueur restante codée sur 1 à 4 octets (exemples de la norme)", bons);
  var aller = cas.every(function (c) { return mqtt.decoderLongueur(mqtt.encoderLongueur(c[0]), 0).valeur === c[0]; });
  verifier("MQTT : longueur restante décodée (aller-retour)", aller);
  verifier("MQTT : longueur incomplète → on attend la suite", mqtt.decoderLongueur(Buffer.from([0x80]), 0) === null);

  verifier("MQTT : CONNECT octet par octet (client « p1 », garde 30 s, session propre)",
    hexa(mqtt.paquetConnect({ idClient: "p1", gardeS: 30 })) === "10 0E 00 04 4D 51 54 54 04 02 00 1E 00 02 70 31",
    hexa(mqtt.paquetConnect({ idClient: "p1", gardeS: 30 })));
  var c = mqtt.paquetConnect({ idClient: "p1", testament: { sujet: "a", message: "hors ligne", qos: 1, retenu: true } });
  verifier("MQTT : CONNECT avec testament QoS 1 retenu (drapeaux 0x2E)", c[9] === 0x2E, c[9]);
  verifier("MQTT : PUBLISH QoS 1 octet par octet (sujet a/b, paquet n° 1, contenu « x »)",
    hexa(mqtt.paquetPublish("a/b", "x", 1, false, 1)) === "32 08 00 03 61 2F 62 00 01 78", hexa(mqtt.paquetPublish("a/b", "x", 1, false, 1)));
  verifier("MQTT : SUBSCRIBE a ses drapeaux obligatoires 0010", mqtt.paquetSubscribe(7, "a/#", 1)[0] === 0x82);

  // Découpage : les octets arrivent en morceaux quelconques.
  var deux = Buffer.concat([mqtt.paquetPublish("a/b", "x", 1, false, 1), mqtt.paquetPublish("c", "yz", 0, true)]);
  var r1 = mqtt.decouper(deux.subarray(0, 7));
  verifier("MQTT : paquet incomplet → rien n'est lu, les octets sont gardés", r1.paquets.length === 0 && r1.reste.length === 7);
  var r2 = mqtt.decouper(deux);
  verifier("MQTT : deux paquets collés → deux paquets lus",
    r2.paquets.length === 2 && r2.paquets[0].sujet === "a/b" && r2.paquets[0].idPaquet === 1 && r2.paquets[0].contenu.toString() === "x" &&
    r2.paquets[1].retenu === true && r2.paquets[1].qos === 0 && r2.reste.length === 0);

  verifier("MQTT : filtres + et #",
    mqtt.filtreCorrespond("entrepot/+/passerelle/#", "entrepot/lyon/passerelle/2/trames") &&
    !mqtt.filtreCorrespond("entrepot/+/passerelle/#", "entrepot/lyon/autre/2") &&
    mqtt.filtreCorrespond("a/+", "a/b") && !mqtt.filtreCorrespond("a/+", "a/b/c") && mqtt.filtreCorrespond("#", "x/y"));
})();

// ---------------------------------------------------------------------
// Faux courtier : juste assez pour tester le client (TCP, sans TLS).
// options.codeConnack : 0 (accepté) ou un code de refus ;
// options.refuserAbonnement : répond 0x80 au SUBSCRIBE.
// ---------------------------------------------------------------------
function fauxCourtier(options) {
  var o = options || {};
  var recus = [];
  var serveur = net.createServer(function (socket) {
    var tampon = Buffer.alloc(0);
    socket.on("data", function (morceau) {
      tampon = Buffer.concat([tampon, morceau]);
      for (;;) {
        var lg = tampon.length >= 2 ? mqtt.decoderLongueur(tampon, 1) : null;
        if (!lg || tampon.length < 1 + lg.taille + lg.valeur) break;
        var type = tampon[0] >> 4, qos = (tampon[0] >> 1) & 3;
        var corps = tampon.subarray(1 + lg.taille, 1 + lg.taille + lg.valeur);
        tampon = tampon.subarray(1 + lg.taille + lg.valeur);
        recus.push(type);
        if (type === mqtt.TYPE.CONNECT) {
          socket.write(Buffer.from([0x20, 2, 0, o.codeConnack || 0]));
          recus.push("drapeaux-" + corps[7]);
          // Session persistante : le courtier livre aussitôt ce qu'il a gardé.
          if (o.publierApresConnack) socket.write(mqtt.paquetPublish("entrepot/lyon/passerelle/2/trames", "garde", 1, false, 7));
        }
        if (type === mqtt.TYPE.PUBLISH && qos === 1) {
          var lgSujet = corps.readUInt16BE(0);
          socket.write(mqtt.paquetPuback(corps.readUInt16BE(2 + lgSujet)));
        }
        if (type === mqtt.TYPE.SUBSCRIBE) {
          var id = corps.readUInt16BE(0);
          socket.write(Buffer.from([0x90, 3, id >> 8, id & 0xFF, o.refuserAbonnement ? 0x80 : 1]));
          // Le courtier renvoie aussitôt un message en QoS 1 sur ce sujet.
          setTimeout(function () { socket.write(mqtt.paquetPublish("entrepot/lyon/passerelle/1/etat", "en ligne", 1, true, 42)); }, 20);
        }
        if (type === mqtt.TYPE.PUBACK) recus.push("puback-" + corps.readUInt16BE(0));
      }
    });
  });
  return new Promise(function (ok) {
    serveur.listen(0, "127.0.0.1", function () { ok({ port: serveur.address().port, recus: recus, fermer: function () { serveur.close(); } }); });
  });
}

// ---------------------------------------------------------------------
// 2. Client MQTT face au faux courtier
// ---------------------------------------------------------------------
async function testsClient() {
  var fc = await fauxCourtier();
  var client = await mqtt.connecter({ hote: "127.0.0.1", port: fc.port, tls: false, idClient: "passerelle-1" });
  verifier("client MQTT : connexion acceptée (CONNACK 0)", !!client);
  await client.publier("entrepot/lyon/passerelle/1/trames", "{}", { qos: 1 });
  verifier("client MQTT : PUBLISH QoS 1 attend et reçoit son PUBACK", fc.recus.indexOf(mqtt.TYPE.PUBLISH) >= 0);
  var messages = [];
  var code = await client.abonner("entrepot/+/passerelle/#", 1, function (sujet, contenu) { messages.push(sujet + "=" + contenu); });
  await attendre(100);
  verifier("client MQTT : abonnement accordé en QoS 1 (SUBACK)", code === 1, code);
  verifier("client MQTT : message reçu sur un sujet abonné, et accusé (PUBACK n° 42)",
    messages[0] === "entrepot/lyon/passerelle/1/etat=en ligne" && fc.recus.indexOf("puback-42") >= 0, messages.join(","));
  client.fermer();
  await attendre(50);
  verifier("client MQTT : fin propre par DISCONNECT (le testament ne sera pas publié)", fc.recus.indexOf(mqtt.TYPE.DISCONNECT) >= 0);
  fc.fermer();

  fc = await fauxCourtier({ codeConnack: 5 });
  var erreur = null;
  try { await mqtt.connecter({ hote: "127.0.0.1", port: fc.port, tls: false, idClient: "intrus" }); } catch (e) { erreur = e; }
  verifier("client MQTT : connexion refusée (code 5) → erreur « non autorisé »", erreur && /non autorisé/.test(erreur.message), erreur && erreur.message);
  fc.fermer();

  fc = await fauxCourtier({ refuserAbonnement: true });
  client = await mqtt.connecter({ hote: "127.0.0.1", port: fc.port, tls: false, idClient: "curieux" });
  erreur = null;
  try { await client.abonner("entrepot/#", 1, function () {}); } catch (e) { erreur = e; }
  verifier("client MQTT : abonnement refusé par les droits (0x80) → erreur", erreur && /refusé/.test(erreur.message), erreur && erreur.message);
  client.fermer();
  fc.fermer();

  // Garde dans les deux sens : ce faux courtier ne répond jamais aux PINGREQ.
  fc = await fauxCourtier();
  client = await mqtt.connecter({ hote: "127.0.0.1", port: fc.port, tls: false, idClient: "passerelle-1", gardeS: 1 });
  var t0 = Date.now(), fermeApres = null;
  client.surFermeture(function () { fermeApres = Date.now() - t0; });
  await attendre(2600);
  verifier("client MQTT : courtier muet (aucun PINGRESP) → connexion fermée après 1,5 × la garde, et signalée",
    fermeApres !== null && fermeApres >= 1400 && fermeApres <= 2500, fermeApres);
  fc.fermer();

  // Session persistante : drapeau « session propre » à 0, et le message
  // livré juste après le CONNACK (avant tout SUBSCRIBE) n'est pas perdu.
  fc = await fauxCourtier({ publierApresConnack: true });
  var avantAbonnement = [];
  client = await mqtt.connecter({ hote: "127.0.0.1", port: fc.port, tls: false, idClient: "serveur-supervision", sessionPersistante: true,
    surMessage: function (sujet, contenu) { avantAbonnement.push(sujet + "=" + contenu); } });
  await attendre(100);
  verifier("client MQTT : session persistante (drapeaux CONNECT = 0x00), message gardé reçu par surMessage et accusé",
    fc.recus.indexOf("drapeaux-0") >= 0 && avantAbonnement[0] === "entrepot/lyon/passerelle/2/trames=garde" && fc.recus.indexOf("puback-7") >= 0, avantAbonnement.join(","));
  client.fermer();
  fc.fermer();
}

// ---------------------------------------------------------------------
// 3. L'entrepôt simulé (chariots, pneus, capteurs, radio)
// ---------------------------------------------------------------------
var TPMS = require("./node.js");
(function () {
  var lundi7h = new Date(2026, 9, 26, 7, 0, 0).getTime();   // heure locale
  var m = TPMS.creerEntrepot({ graine: 7, nbChariots: 8, debutMs: lundi7h, chariotsAvecFuite: [] });
  var registre = TPMS.entrepotRegistreCapteurs(m);
  var adresses = {};
  registre.forEach(function (r) { adresses[r.adresse] = r; });
  verifier("entrepôt : 8 chariots × 4 pneus = 32 capteurs, adresses toutes différentes",
    registre.length === 32 && Object.keys(adresses).length === 32 && adresses["C4:10:03:00:04"].chariot === "C03" && adresses["C4:10:03:00:04"].position === "ARD");

  var annonces = TPMS.entrepotAvancer(m, lundi7h + 3600000, 1);
  var decodees = annonces.map(function (a) { return TPMS.decoderTrame(a.octets); });
  verifier("entrepôt : une heure de poste → des milliers de trames de 18 octets, toutes décodables", annonces.length > 1000 &&
    decodees.every(function (d) { return d !== null; }), annonces.length);
  verifier("entrepôt : chaque trame vient d'un capteur du registre (liste blanche)",
    decodees.every(function (d) { return !!adresses[d.adresse]; }));
  var pressions = decodees.map(function (d) { return d.pressionBar; });
  verifier("entrepôt : pressions de chariot entre 7,5 et 9,5 bar (au-delà des 8 bar d'un vélo)",
    Math.min.apply(null, pressions) > 7.5 && Math.max.apply(null, pressions) < 9.5,
    Math.min.apply(null, pressions) + " à " + Math.max.apply(null, pressions));
  var zones = {};
  m.chariots.forEach(function (c) { zones[TPMS.entrepotZone(c.x)] = true; });
  verifier("entrepôt : pendant le poste, les chariots circulent dans plusieurs zones", Object.keys(zones).length >= 2, Object.keys(zones).join(","));

  var nuit = TPMS.creerEntrepot({ graine: 7, nbChariots: 8, debutMs: new Date(2026, 9, 26, 22, 30, 0).getTime() });
  var annoncesNuit = TPMS.entrepotAvancer(nuit, nuit.tMs + 2 * 3600000, 1);
  verifier("entrepôt : la nuit, chariots garés aux quais, une annonce par minute et par capteur",
    nuit.chariots.every(function (c) { return TPMS.entrepotZone(c.x) === "quais"; }) && annoncesNuit.length < 32 * 130, annoncesNuit.length);

  var alea = TPMS.creerAleaNomme(1, "essai-radio");
  var p1 = TPMS.ENTREPOT.passerelles[0];
  var pres = [], loin = 0;
  for (var k = 0; k < 200; k++) { pres.push(TPMS.entrepotRssi(p1, p1.x, p1.y, alea)); if (TPMS.entrepotRssi(p1, p1.x + 100, p1.y, alea) === null) loin++; }
  var moyenne = pres.reduce(function (s, x) { return s + x; }, 0) / pres.length;
  verifier("radio : sous la passerelle (6 m), ≈ −78 dBm ; à 100 m, hors de portée", Math.abs(moyenne - (-59 - 24 * Math.log10(6))) < 1.5 && loin === 200,
    moyenne.toFixed(1) + " dBm, " + loin + "/200 perdues");

  var pneu = TPMS.creerPneu({ volumeL: 20, largeurMm: 165, pressionRelBar: 6.0, temperatureC: 16 });
  TPMS.regonflerPneu(pneu, 8.5);
  verifier("maintenance : regonflage à 8,5 bar à la station d'air", Math.abs(pneu.pressionRelBar - 8.5) < 0.01, pneu.pressionRelBar);

  var fuite = TPMS.creerEntrepot({ graine: 7, nbChariots: 4, debutMs: new Date(2026, 9, 26, 8, 0, 0).getTime(), chariotsAvecFuite: [2] });
  var avant = {};
  fuite.chariots.forEach(function (c) { TPMS.POSITIONS_PNEU.forEach(function (p) { avant[c.id + p] = c.pneus[p].nMol; }); });
  TPMS.entrepotAvancer(fuite, fuite.tMs + 20 * 3600000, 10);   // jusqu'à 4 h du matin, avant la maintenance
  var pertes = [];
  fuite.chariots.forEach(function (c) { TPMS.POSITIONS_PNEU.forEach(function (p) { pertes.push({ cle: c.id + p, perte: 1 - c.pneus[p].nMol / avant[c.id + p] }); }); });
  pertes.sort(function (a, b) { return b.perte - a.perte; });
  verifier("fuite lente : le pneu percé du chariot C02 perd nettement plus d'air que les autres",
    pertes[0].cle.indexOf("C02") === 0 && pertes[0].perte > 3 * pertes[1].perte, pertes[0].cle + " " + (pertes[0].perte * 100).toFixed(2) + " %");

  var v = TPMS.creerVerification();
  verifier("vraisemblance : 8,5 bar hors limites pour un vélo, accepté avec la plage des chariots (13 bar)",
    TPMS.verifierVraisemblance(v, null, 0, { pressionBar: 8.5, temperatureC: 16 }, 0) === "hors-limites" &&
    TPMS.verifierVraisemblance(v, null, 0, { pressionBar: 8.5, temperatureC: 16 }, 0, true, 13) === "ok");
})();

// ---------------------------------------------------------------------
// 4. Heure (SNTP) et journal (syslog)
// ---------------------------------------------------------------------
var dgram = require("node:dgram");
var reseau = require("./reseau.js");
async function testsReseau() {
  // 1er janvier 1970 à 0 h en temps NTP = 2 208 988 800 s.
  var b = Buffer.alloc(8);
  b.writeUInt32BE(reseau.DECALAGE_1900_1970_S + 1000, 0);
  b.writeUInt32BE(2147483648, 4);   // une demi-seconde
  verifier("NTP : horodatage de 1900 converti en heure Unix (1 000,5 s)", reseau.lireHorodatageNtp(b, 0) === 1000500);

  // Faux serveur NTP, 5 s en avance sur l'horloge locale.
  var serveur = dgram.createSocket("udp4");
  await new Promise(function (ok) { serveur.bind(0, "127.0.0.1", ok); });
  serveur.on("message", function (requete, rinfo) {
    var reponse = Buffer.alloc(48);
    reponse[0] = (0 << 6) | (4 << 3) | 4;   // version 4, mode 4 = serveur
    reponse[1] = 2;                          // strate 2
    var ms = Date.now() + 5000;
    reponse.writeUInt32BE(Math.floor(ms / 1000) + reseau.DECALAGE_1900_1970_S, 40);
    reponse.writeUInt32BE(Math.floor((ms % 1000) / 1000 * 4294967296), 44);
    serveur.send(reponse, rinfo.port, rinfo.address);
  });
  var r = await reseau.demanderHeure("127.0.0.1", { port: serveur.address().port });
  serveur.close();
  verifier("NTP : décalage mesuré face à un serveur 5 s en avance (± 50 ms)", Math.abs(r.decalageMs - 5000) < 50, Math.round(r.decalageMs));

  var ligne = reseau.ligneSyslog("attention", "passerelle-2", "connexion au courtier perdue", Date.UTC(2026, 9, 24, 8, 0, 0));
  verifier("syslog : ligne au format RFC 5424 (local0, gravité 4 → <132>)",
    /^<132>1 2026-10-24T08:00:00\.000Z \S+ passerelle-2 \d+ - - connexion au courtier perdue$/.test(ligne), ligne);
}

// ---------------------------------------------------------------------
// 5. Le serveur reçoit les lots des passerelles (serveur/chariots.js)
// ---------------------------------------------------------------------
var DatabaseSync = require("node:sqlite").DatabaseSync;
var receptionChariots = require("../serveur/chariots.js");
function trameHexa(adresse, numero, pressionBar, temperatureC) {
  return Buffer.from(TPMS.encoderTrame({ numero: numero, adresse: adresse, pressionBar: pressionBar, temperatureC: temperatureC || 16, batteriePct: 90, alarme: 0 })).toString("hex");
}
function testsReception() {
  var db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE refus (id INTEGER PRIMARY KEY, t INTEGER, ip TEXT, velo TEXT, motif TEXT, detail TEXT)");
  var refus = [];
  function noterRefus(t, ip, velo, motif, detail) { refus.push({ ip: ip, motif: motif, detail: detail }); }
  var monde = TPMS.creerEntrepot({ graine: 2026, nbChariots: 8, debutMs: 0 });
  var r = receptionChariots.creerReception(db, noterRefus, TPMS.entrepotRegistreCapteurs(monde));
  var t0 = Date.now();
  var adr = TPMS.adresseCapteurChariot(3, 0);   // C03, AVG
  function lot(passerelle, zone, annonces) { return Buffer.from(JSON.stringify({ passerelle: passerelle, site: "lyon", zone: zone, envoiMs: t0, annonces: annonces })); }

  var probleme = r.recevoirMessage("entrepot/lyon/passerelle/1/trames",
    lot(1, "quais", [{ t: t0 - 1000, rssi: -80, trame: trameHexa(adr, 1, 8.42) }]), t0);
  var c3 = r.chariots(t0).filter(function (c) { return c.id === "C03"; })[0];
  verifier("réception : lot valable accepté, pression du pneu AVG de C03 connue, zone « quais »",
    probleme === "" && c3.pneus.AVG.pression === 8.42 && c3.zone === "quais" && c3.pneus.AVG.etat === "OK", JSON.stringify(c3.pneus.AVG));

  // La même annonce, entendue plus fort par la passerelle 2 : un seul comptage, nouvelle zone.
  r.recevoirMessage("entrepot/lyon/passerelle/2/trames", lot(2, "allees", [{ t: t0 - 900, rssi: -70, trame: trameHexa(adr, 1, 8.42) }]), t0);
  c3 = r.chariots(t0).filter(function (c) { return c.id === "C03"; })[0];
  verifier("réception : même annonce par deux passerelles → comptée une fois, zone de la meilleure réception",
    r.compteurs.acceptees === 1 && r.compteurs.doublons === 1 && c3.zone === "allees", JSON.stringify(r.compteurs));
  var nbMesures = db.prepare("SELECT COUNT(*) AS n FROM mesures_pneus").get().n;
  r.recevoirMessage("entrepot/lyon/passerelle/2/trames", lot(2, "allees", [{ t: t0 - 500, rssi: -71, trame: trameHexa(adr, 1, 8.41) }]), t0);
  verifier("réception : au plus une mesure par pneu et par minute en base",
    nbMesures === 1 && db.prepare("SELECT COUNT(*) AS n FROM mesures_pneus").get().n === 1 && r.compteurs.acceptees === 2);

  // Lots piégés
  var p1 = r.recevoirMessage("entrepot/lyon/passerelle/2/trames", lot(1, "quais", [{ t: t0, rssi: -70, trame: trameHexa(adr, 1, 8.4) }]), t0);
  verifier("lot refusé : la passerelle 2 se fait passer pour la 1 (sujet ≠ contenu)", /se dit de la passerelle 1/.test(p1), p1);
  var p2 = r.recevoirMessage("entrepot/lyon/passerelle/1/trames", lot(1, "quais", [{ t: t0 + 3600000, rssi: -70, trame: trameHexa(adr, 1, 8.4) }]), t0);
  var p3 = r.recevoirMessage("entrepot/lyon/passerelle/1/trames", lot(1, "quais", [{ t: t0 - 3 * 3600000, rssi: -70, trame: trameHexa(adr, 1, 8.4) }]), t0);
  verifier("lot refusé : annonce datée du futur, ou trop ancienne (rejeu)", /futur/.test(p2) && /ancienne/.test(p3), p2 + " / " + p3);
  var p4 = r.recevoirMessage("entrepot/lyon/passerelle/1/trames", lot(1, "quais", [{ t: t0, rssi: -70, trame: "zz' OR 1=1 --" }]), t0);
  verifier("lot refusé : trame qui n'est pas de l'hexadécimal (injection)", /hexadécimal/.test(p4), p4);
  verifier("lots refusés : tracés dans le journal des refus (motif lot-mqtt)",
    refus.filter(function (x) { return x.motif === "lot-mqtt"; }).length === 4);

  // Capteur inconnu (autre véhicule, ou pirate)
  var pirate = [0xDE, 0xAD, 0xBE, 0xEF, 0x01];
  r.recevoirMessage("entrepot/lyon/passerelle/3/trames", lot(3, "cour", [
    { t: t0 - 3000, rssi: -60, trame: trameHexa(pirate, 1, 2.0) }, { t: t0 - 2000, rssi: -60, trame: trameHexa(pirate, 1, 2.0) }]), t0);
  verifier("liste blanche : capteur inconnu ignoré, tracé une seule fois par minute",
    r.compteurs.inconnues === 2 && refus.filter(function (x) { return x.motif === "capteur-inconnu"; }).length === 1);

  // Vraisemblance : un saut à 12,9 bar n'est pas cru tant qu'il n'est pas confirmé.
  var adr2 = TPMS.adresseCapteurChariot(5, 1);
  r.recevoirMessage("entrepot/lyon/passerelle/1/trames", lot(1, "quais", [
    { t: t0 - 30000, rssi: -70, trame: trameHexa(adr2, 2, 8.5) }, { t: t0 - 27000, rssi: -70, trame: trameHexa(adr2, 2, 12.9) }]), t0);
  var c5 = r.chariots(t0).filter(function (c) { return c.id === "C05"; })[0];
  verifier("vraisemblance : un saut de 8,5 à 12,9 bar en 3 s est mis en doute", r.compteurs.invraisemblables === 1 && c5.pneus.AVD.pression === 8.5);

  // Crevaison : la chute est confirmée par 3 trames, puis l'alerte est notée.
  var adr3 = TPMS.adresseCapteurChariot(7, 3);
  var chute = [8.5, 3.20, 3.18, 3.16].map(function (p, k) { return { t: t0 - 20000 + k * 1000, rssi: -65, trame: trameHexa(adr3, 4, p) }; });
  r.recevoirMessage("entrepot/lyon/passerelle/2/trames", lot(2, "allees", chute), t0);
  var c7 = r.chariots(t0).filter(function (c) { return c.id === "C07"; })[0];
  verifier("crevaison : chute confirmée, état CREVAISON et alerte en base",
    c7.etat === "CREVAISON" && r.alertes(10).some(function (a) { return a.chariot_id === "C07" && a.type === "CREVAISON" && a.position === "ARD"; }), c7.etat);

  // État des passerelles (publié par elles, ou par le courtier : testament)
  r.recevoirMessage("entrepot/lyon/passerelle/3/etat", Buffer.from(JSON.stringify({ etat: "hors ligne", passerelle: 3, zone: "cour" })), t0);
  var p = r.passerelles().filter(function (x) { return x.id === 3; })[0];
  verifier("passerelle : le testament « hors ligne » est enregistré", p && p.etat === "hors ligne" && p.zone === "cour");
  verifier("sujet inconnu refusé", r.recevoirMessage("entrepot/lyon/autre/1/trames", Buffer.from("{}"), t0) === "sujet inconnu");
  db.close();
}

// La même logique de réception, SEULE (sans base) : c'est ainsi que le
// mode démo de flotte/chariots.html l'utilise dans le navigateur.
function testsReceptionPure() {
  require("./reception.js");
  var monde = TPMS.creerEntrepot({ graine: 2026, nbChariots: 8, debutMs: 0 });
  var appels = { mesure: [], zone: [], passerelle: [], refus: [], alerte: [] };
  var r = TPMS.creerReceptionLots(TPMS.entrepotRegistreCapteurs(monde), {
    mesure: function (chariot, position, t, m) { appels.mesure.push(chariot + position + " " + m.pressionBar); },
    zone: function (chariot, zone) { appels.zone.push(chariot + " " + zone); },
    passerelle: function (id, p) { appels.passerelle.push(id + " " + p.etat + " " + p.annonces); },
    refus: function (t, source, motif) { appels.refus.push(source + " " + motif); },
    alerte: function (chariot, t, position, etat) { appels.alerte.push(chariot + position + " " + etat); }
  });
  var t0 = 1792800000000;
  // Contenu en TEXTE (pas de Buffer dans le navigateur).
  var texte = JSON.stringify({ passerelle: 2, site: "lyon", zone: "allees", envoiMs: t0, annonces: [
    { t: t0 - 2000, rssi: -75, trame: trameHexa(TPMS.adresseCapteurChariot(4, 1), 2, 8.37) },
    { t: t0 - 1000, rssi: -75, trame: trameHexa([0xDE, 0xAD, 0xBE, 0xEF, 0x01], 1, 8.5) }] });
  var probleme = r.recevoirMessage("entrepot/lyon/passerelle/2/trames", texte, t0);
  verifier("réception pure : lot en texte accepté, rappels mesure, zone et passerelle appelés",
    probleme === "" && appels.mesure.join() === "C04AVD 8.37" && appels.zone.join() === "C04 allees" && appels.passerelle.join() === "2 en ligne 2",
    JSON.stringify(appels));
  verifier("réception pure : capteur inconnu signalé par le rappel refus", appels.refus.join() === "passerelle-2 capteur-inconnu", appels.refus.join());
  var etat = r.etatDesPneus(t0).C04;
  verifier("réception pure : état des pneus de C04 (AVD connu, les autres en attente → pire état ATTENTE)",
    etat.pneus.AVD.pression === 8.37 && etat.pneus.AVG.etat === "ATTENTE" && etat.etat === "ATTENTE" && r.zoneDe("C04") === "allees",
    JSON.stringify(etat));
}

// API : /api/chariots, réservée aux sessions, comme le reste.
async function testsApiChariots() {
  var outils = require("../serveur/serveur.js");
  var serveur = outils.creerServeur({ cheminBase: ":memory:", journal: false });
  await new Promise(function (ok) { serveur.listen(0, "127.0.0.1", ok); });
  var url = "http://127.0.0.1:" + serveur.address().port;
  var adr = TPMS.adresseCapteurChariot(1, 2);
  serveur.reception.recevoirMessage("entrepot/lyon/passerelle/1/trames", Buffer.from(JSON.stringify({
    passerelle: 1, site: "lyon", zone: "quais", envoiMs: Date.now(), annonces: [{ t: Date.now() - 500, rssi: -75, trame: trameHexa(adr, 3, 8.3) }]
  })), Date.now());
  var sans = await fetch(url + "/api/chariots");
  var comptes = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "serveur", "cles-demo.json"), "utf8")).comptes;
  var connexion = await (await fetch(url + "/api/connexion", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compte: "technicien", motDePasse: comptes.technicien.motDePasse }) })).json();
  var avec = await (await fetch(url + "/api/chariots", { headers: { Authorization: "Bearer " + connexion.jeton } })).json();
  var c1 = avec.chariots.filter(function (c) { return c.id === "C01"; })[0];
  var histo = await (await fetch(url + "/api/chariots/C01/historique?heures=1", { headers: { Authorization: "Bearer " + connexion.jeton } })).json();
  var inconnu = await fetch(url + "/api/chariots/C99/historique", { headers: { Authorization: "Bearer " + connexion.jeton } });
  verifier("API : /api/chariots sans session → 401 ; avec session → 8 chariots et la pression du pneu ARG de C01",
    sans.status === 401 && avec.chariots.length === 8 && c1.pneus.ARG.pression === 8.3 && c1.zone === "quais", sans.status);
  verifier("API : historique d'un chariot (une mesure), chariot inconnu → 404", histo.mesures.length === 1 && inconnu.status === 404, inconnu.status);
  serveur.closeAllConnections();
  await new Promise(function (ok) { serveur.close(ok); });
}

// ---------------------------------------------------------------------
// Lancement et bilan
// ---------------------------------------------------------------------
(async function () {
  try {
    await testsClient();
    await testsReseau();
    testsReception();
    testsReceptionPure();
    await testsApiChariots();
  } catch (e) {
    verifier("exécution sans exception", false, e.stack);
  }
  resultats.lignes.push("");
  resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
  console.log(resultats.lignes.join("\n"));
  if (resultats.rates > 0) process.exitCode = 1;
})();
