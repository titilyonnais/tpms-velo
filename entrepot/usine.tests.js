// =====================================================================
// usine.tests.js — Vérifications du simulateur de l'usine (entrepot/usine.js)
// et de la logique de réception (entrepot/reception.js)
// ---------------------------------------------------------------------
// Se lance : node entrepot/usine.tests.js (et par simulateur/tests/tout.js)
// Le simulateur doit rester FIDÈLE à la maquette : mêmes règles de
// pare-feu que regles.nft, mêmes droits que courtier/acl, même règle des
// fichiers interdits que le serveur, mêmes tailles de paquets MQTT que
// le client réel.
// =====================================================================
"use strict";
var fs = require("node:fs");
var path = require("node:path");
var TPMS = require("./node.js");
var mqtt = require("./mqtt.js");

var resultats = { reussis: 0, rates: 0, lignes: [] };
function verifier(nom, condition, detail) {
  if (condition) { resultats.reussis++; resultats.lignes.push("OK     " + nom); }
  else { resultats.rates++; resultats.lignes.push("ÉCHEC  " + nom + (detail !== undefined ? "  → obtenu : " + detail : "")); }
}

// ---------------------------------------------------------------------
// 1. Fidélité à la maquette
// ---------------------------------------------------------------------
(function () {
  var nft = fs.readFileSync(path.join(__dirname, "pare-feu", "regles.nft"), "utf8");
  // La chaîne « transit » (ce qui traverse le pare-feu), sans la chaîne d'entrée.
  var transit = nft.slice(nft.indexOf("chain transit"), nft.indexOf("chain entree"));
  var lignes = transit.split("\n").filter(function (l) { return /comment "/.test(l); });
  var noms = lignes.map(function (l) { return /comment "([^"]+)"/.exec(l)[1]; });
  verifier("pare-feu : les règles du simulateur sont celles de regles.nft, dans le même ordre",
    JSON.stringify(noms) === JSON.stringify(TPMS.REGLES_PARE_FEU.map(function (r) { return r.nom; })), noms.join(" | "));
  var defines = {};
  nft.split("\n").forEach(function (l) { var m = /^define (\w+)\s*=\s*(.+)$/.exec(l.trim()); if (m) defines[m[1]] = m[2].trim(); });
  var portsOk = TPMS.REGLES_PARE_FEU.every(function (r, i) {
    var l = lignes[i];
    if (r.verdict !== (/\bdrop\b/.test(l) ? "drop" : "accept")) return false;
    if (r.port && l.indexOf(r.proto + " dport " + r.port) < 0) return false;
    return true;
  });
  verifier("pare-feu : verdicts, protocoles et ports identiques à regles.nft", portsOk);
  verifier("pare-feu : adresses du simulateur = « define » de regles.nft (supervision, courtier, réseaux)",
    defines.SUPERVISION === "10.10.20.20" && defines.COURTIER === "10.10.20.10" && defines.OT === "10.10.10.0/24" && defines.BUREAUTIQUE === "10.10.30.0/24" &&
    TPMS.USINE.machines.supervision.ip === defines.SUPERVISION && TPMS.USINE.machines.courtier.ip === defines.COURTIER && TPMS.USINE.machines.ntp.ip === defines.NTP, JSON.stringify(defines));

  var acl = fs.readFileSync(path.join(__dirname, "courtier", "acl"), "utf8").split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== "#"; });
  var lu = [], courant = null;
  acl.forEach(function (l) {
    var m = /^user (\S+)$/.exec(l), t = /^topic (read|write|readwrite) (\S+)$/.exec(l);
    if (m) courant = m[1]; else if (t) lu.push({ utilisateur: courant, acces: t[1], filtre: t[2] });
  });
  verifier("courtier : les droits du simulateur sont ceux de courtier/acl", JSON.stringify(lu) === JSON.stringify(TPMS.ACL_COURTIER), JSON.stringify(lu));

  var serveur = require("../serveur/serveur.js");
  var chemins = ["/entrepot/certificats/courtier.cle", "/Entrepot/Certificats/x.pem", "/entrepot/journaux/central.log", "/serveur/cles-demo.json",
    "/.git/config", "/flotte/chariots.html", "/entrepot/usine.js", "/app/cle.key", "/docs/rapport-e6.md", "/entrepot/donnees/flotte.db"];
  var memes = chemins.every(function (c) {
    var morceaux = c.split("/").filter(Boolean);
    return serveur.cheminInterdit(morceaux) === TPMS.usineCheminInterdit(c);
  });
  verifier("serveur web : le simulateur applique la même règle des fichiers interdits que serveur.js", memes);

  var lot = JSON.stringify({ passerelle: 1, site: "lyon", zone: "quais", envoiMs: 1, annonces: [{ t: 1, rssi: -70, trame: "a".repeat(36) }] });
  var sujet = "entrepot/lyon/passerelle/1/trames";
  verifier("MQTT : taille d'un PUBLISH QoS 1 = celle du client réel (entrepot/mqtt.js)",
    TPMS.mqttTaillePublish(sujet, Buffer.byteLength(lot), 1) === mqtt.paquetPublish(sujet, lot, 1, false, 7).length &&
    TPMS.mqttTaillePublish(sujet, 200, 1) === mqtt.paquetPublish(sujet, "x".repeat(200), 1, false, 7).length);
  verifier("MQTT : filtres « + » et « # » comme le client réel",
    ["entrepot/+/passerelle/1/#", "entrepot/#", "entrepot/+/passerelle/+/etat"].every(function (f) {
      return ["entrepot/lyon/passerelle/1/trames", "entrepot/lyon/passerelle/2/etat", "autre/x"].every(function (s) { return TPMS.mqttFiltreCorrespond(f, s) === mqtt.filtreCorrespond(f, s); });
    }));
  verifier("adresses : 10.10.30.50 ∈ 10.10.30.0/24, ∉ 10.10.10.0/24 ; liste d'adresses",
    TPMS.ipCorrespond("10.10.30.50", "10.10.30.0/24") && !TPMS.ipCorrespond("10.10.30.50", "10.10.10.0/24") && TPMS.ipCorrespond("10.10.20.1", ["10.10.10.1", "10.10.20.1"]));
  // Heure de Paris : passage à l'heure d'hiver le dimanche 25/10/2026 à 3 h (1 h UTC).
  verifier("heure de Paris : 25/10/2026 0 h 59 UTC = 2 h 59 (été), 1 h 00 UTC = 2 h 00 (hiver)",
    Math.abs(TPMS.heureParis(Date.UTC(2026, 9, 25, 0, 59)).heure - 2.9833) < 0.001 && TPMS.heureParis(Date.UTC(2026, 9, 25, 1, 0)).heure === 2);
})();

// ---------------------------------------------------------------------
// 2. La logique de réception (défauts trouvés par l'audit du 24/10/2026)
// ---------------------------------------------------------------------
function trame(adresse, pressionBar, temperatureC) {
  return Buffer.from(TPMS.encoderTrame({ numero: 1, adresse: adresse, pressionBar: pressionBar, temperatureC: temperatureC === undefined ? 16 : temperatureC, batteriePct: 90, alarme: 0 })).toString("hex");
}
function lot(id, zone, annonces) { return JSON.stringify({ passerelle: id, site: "lyon", zone: zone, envoiMs: 0, annonces: annonces }); }
function sujet(id) { return "entrepot/lyon/passerelle/" + id + "/trames"; }
(function () {
  var monde = TPMS.creerEntrepot({ graine: 1, nbChariots: 8, debutMs: 0 });
  var alertes = [];
  var r = TPMS.creerReceptionLots(TPMS.entrepotRegistreCapteurs(monde), { alerte: function (c, t, p, e) { alertes.push(c + p + " " + e); } });
  var t0 = Date.UTC(2026, 9, 26, 8), adr = TPMS.adresseCapteurChariot(1, 0);
  // Deux annonces entendues par deux passerelles ; les lots arrivent l'un APRÈS l'autre.
  var a1 = { t: t0, rssi: -70, trame: trame(adr, 8.40) }, a2 = { t: t0 + 3000, rssi: -70, trame: trame(adr, 8.41) };
  r.recevoirMessage(sujet(1), lot(1, "quais", [a1, a2]), t0 + 10000);
  r.recevoirMessage(sujet(2), lot(2, "allees", [{ t: a1.t + 2, rssi: -85, trame: a1.trame }, { t: a2.t + 1, rssi: -85, trame: a2.trame }]), t0 + 10000);
  verifier("réception : 2 annonces × 2 passerelles en lots successifs → 2 acceptées, 2 doublons",
    r.compteurs.acceptees === 2 && r.compteurs.doublons === 2, JSON.stringify(r.compteurs));
  verifier("réception : zone de la meilleure puissance moyenne (quais à −70, pas allées à −85)", r.zoneDe("C01") === "quais", r.zoneDe("C01"));
  // Une trame refusée (20 bar), reçue très fort par P3, ne déplace pas le chariot.
  r.recevoirMessage(sujet(3), lot(3, "cour", [{ t: t0 + 5000, rssi: -40, trame: trame(adr, 20) }]), t0 + 10000);
  verifier("réception : une trame refusée par la vraisemblance ne change pas la zone", r.zoneDe("C01") === "quais" && r.compteurs.invraisemblables === 1, r.zoneDe("C01"));
  // Une annonce plus ancienne que la dernière acceptée ne fait pas reculer la mesure.
  r.recevoirMessage(sujet(2), lot(2, "allees", [{ t: t0 + 1000, rssi: -80, trame: trame(adr, 8.10) }]), t0 + 11000);
  var p = r.etatDesPneus(t0 + 11000).C01.pneus.AVG;
  verifier("réception : annonce en retard comptée à part, la mesure ne recule pas (8,41 bar gardés)", p.pression === 8.41 && r.compteurs.enRetard === 1, p.pression);
  // Silence de plus de 10 min : « capteur perdu » noté dans les alertes.
  r.recevoirMessage("entrepot/lyon/passerelle/1/etat", JSON.stringify({ etat: "en ligne" }), t0 + 3000 + 601000);
  verifier("réception : capteur muet 10 min → alerte « PERDU » notée (sans annonce pour le dire)", alertes.indexOf("C01AVG PERDU") >= 0, alertes.join(","));
  // Seuils sur la pression ramenée à 20 °C : 7,6 bar à 5 °C (= 8,05 bar à 20 °C) n'est pas « bas ».
  var r2 = TPMS.creerReceptionLots(TPMS.entrepotRegistreCapteurs(monde), {});
  var adr2 = TPMS.adresseCapteurChariot(2, 0);
  r2.recevoirMessage(sujet(3), lot(3, "cour", [{ t: t0, rssi: -70, trame: trame(adr2, 7.6, 5) }]), t0 + 1000);
  var p2 = r2.etatDesPneus(t0 + 1000).C02.pneus.AVG;
  verifier("réception : pneu froid de la cour (7,6 bar à 5 °C ≈ 8,05 à 20 °C) → pas d'alerte basse", p2.etat === "OK" && p2.pression20 > 7.8, p2.etat + " " + p2.pression20);
  // Fuite lente : −0,3 bar/jour sur 14 h (un point toutes les 10 min).
  var r3 = TPMS.creerReceptionLots(TPMS.entrepotRegistreCapteurs(monde), { alerte: function (c, t, p, e) { alertes.push(c + p + " " + e); } });
  var adr3 = TPMS.adresseCapteurChariot(3, 2);
  for (var k = 0; k <= 14 * 6; k++) {
    var tk = t0 + k * 600000;
    r3.recevoirMessage(sujet(1), lot(1, "quais", [{ t: tk, rssi: -70, trame: trame(adr3, 8.5 - 0.3 * k / 144) }]), tk + 1000);
  }
  var p3 = r3.etatDesPneus(t0 + 14 * 3600000 + 1000).C03.pneus.ARG;
  verifier("réception : fuite lente de −0,3 bar/jour repérée après 14 h (tendance depuis le dernier regonflage)",
    p3.etat === "FUITE_LENTE" && Math.abs(p3.tendanceBarJour + 0.3) < 0.02 && alertes.indexOf("C03ARG FUITE_LENTE") >= 0, p3.etat + " " + p3.tendanceBarJour);
})();

// ---------------------------------------------------------------------
// 3. L'usine tourne : réseau, pare-feu, courtier, supervision
// ---------------------------------------------------------------------
(function () {
  var u = TPMS.creerUsine({ graine: 2026 });
  TPMS.usineAvancer(u, u.debutMs + 6 * 3600000);
  var s = u.machines.supervision.supervision, vue = s.reception.etatDesPneus(u.tMs);
  function regle(nom) { return u.regles.filter(function (r) { return r.nom.indexOf(nom) === 0; })[0]; }
  verifier("usine : après 6 h, les 3 passerelles et la supervision sont connectées au courtier",
    ["passerelle-1", "passerelle-2", "passerelle-3", "serveur-supervision"].every(function (id) { return !!u.courtier.clients[id]; }));
  verifier("usine : la supervision connaît les 32 pneus, tous OK", Object.keys(vue).length === 8 &&
    Object.keys(vue).every(function (id) { return vue[id].etat === "OK"; }), JSON.stringify(Object.keys(vue).map(function (id) { return vue[id].etat; })));
  verifier("pare-feu : une seule connexion par passerelle comptée sur la règle 1 (le reste passe par « established »)",
    regle("1 ").paquets === 3 && u.compteurEtabli.paquets > 1000, regle("1 ").paquets);
  verifier("pare-feu : NTP, 3 passerelles × (1 au démarrage + 1 toutes les 10 min) = 3 × 36 sur 6 h",
    regle("2 ").paquets === 3 * 36, regle("2 ").paquets);
  verifier("pare-feu : chaque ligne syslog (UDP sans réponse) reste un « nouveau » paquet, compté sur la règle 3",
    regle("3 ").paquets === u.journalCentral.length, regle("3 ").paquets + " / " + u.journalCentral.length);
  verifier("pare-feu : aucun refus en fonctionnement normal", u.regles.filter(function (r) { return r.verdict === "drop"; }).every(function (r) { return r.paquets === 0; }));
  var c = s.reception.compteurs;
  verifier("radio : annonces entendues = acceptées + doublons + en retard (+ celles encore dans les lots en cours)",
    u.stats.annoncesEntendues - (c.acceptees + c.doublons + c.enRetard) === TPMS.ENTREPOT.passerelles.reduce(function (n, p) { return n + u.machines["passerelle-" + p.id].passerelle.annonces.length; }, 0));
  var ecart = 0;
  u.monde.chariots.forEach(function (ch) { TPMS.POSITIONS_PNEU.forEach(function (pos) { ecart = Math.max(ecart, Math.abs(vue[ch.id].pneus[pos].pression - ch.pneus[pos].pressionRelBar)); }); });
  verifier("supervision : pression vue à moins de 0,2 bar de la vraie pression, pour les 32 pneus", ecart < 0.2, ecart.toFixed(3));
  var decalages = TPMS.ENTREPOT.passerelles.map(function (p) { return Math.abs(u.machines["passerelle-" + p.id].horloge.decalageMs); });
  verifier("heure : avec NTP toutes les 10 min, les horloges des passerelles restent à moins de 25 ms (quartz ±30 ppm)",
    Math.max.apply(null, decalages) < 25, decalages.map(Math.round).join("/"));
  verifier("poste du bureau : lecture de la page toutes les 5 s, sans erreur", u.machines.poste.poste.lectures === 6 * 720 && u.machines.poste.poste.erreurs === 0, u.machines.poste.poste.lectures);
})();

// ---------------------------------------------------------------------
// 4. Le technicien suit la supervision ; la supervision redémarre
// ---------------------------------------------------------------------
(function () {
  var u = TPMS.creerUsine({ graine: 2026 });
  TPMS.usineAvancer(u, u.debutMs + 24 * 3600000);   // jusqu'au mardi 6 h
  var faites = u.technicien.interventions.filter(function (i) { return /regonflé/.test(i.texte); });
  verifier("technicien : à 5 h 30, il regonfle les pneus que la supervision voit en fuite lente (C03, C06) et répare la fuite",
    faites.length >= 2 && faites.some(function (i) { return i.chariot === "C03"; }) && faites.some(function (i) { return i.chariot === "C06"; }) &&
    faites.every(function (i) { return /fuite trouvée et réparée/.test(i.texte) || /bar à 20 °C/.test(i.texte); }), JSON.stringify(faites.map(function (i) { return i.chariot + " " + i.texte; })));
  // Crevaison pendant le poste : alerte, chariot arrêté, réparé 20 min plus tard.
  TPMS.usineAvancer(u, u.tMs + 3 * 3600000);
  TPMS.usineCrevaison(u, "C05", "AVD", "valve");
  TPMS.usineAvancer(u, u.tMs + 40 * 60000);
  var crev = u.technicien.interventions.filter(function (i) { return i.chariot === "C05"; }).map(function (i) { return i.texte; });
  verifier("technicien : valve arrachée sur C05 → crevaison vue, chariot arrêté, réparée 20 min après",
    crev.some(function (t) { return /chariot arrêté/.test(t); }) && crev.some(function (t) { return /réparée/.test(t); }) &&
    u.monde.chariots[4].pneus.AVD.pressionRelBar > 8.3, crev.join(" | "));

  // Session propre (comme avant la correction) : les messages de l'arrêt sont perdus.
  var v = TPMS.creerUsine({ graine: 3 });
  v.machines.supervision.supervision.sessionPersistante = false;
  TPMS.usineAvancer(v, v.debutMs + 3600000);
  TPMS.usinePanne(v, "supervision", "plantage");
  TPMS.usineAvancer(v, v.tMs + 60000);
  TPMS.usinePanne(v, "supervision", "rebrancher");
  TPMS.usineAvancer(v, v.tMs + 20000);
  var garde = v.journalSupervision.some(function (l) { return /gardés par le courtier/.test(l.texte); });
  verifier("courtier : supervision en session propre → les lots de son arrêt sont perdus (défaut corrigé dans le serveur réel)", !garde);
})();

// ---------------------------------------------------------------------
// 5. Les 20 essais (attaques et pannes) : tous conformes
// ---------------------------------------------------------------------
(function () {
  var u = TPMS.creerUsine({ graine: 2026 });
  TPMS.usineAvancer(u, u.debutMs + 3 * 3600000);
  var echecs = [];
  TPMS.USINE_ESSAIS.forEach(function (def) {
    var e = TPMS.usineLancerEssai(u, def.id), garde = 0;
    while (!e.resultat && garde++ < 1200) TPMS.usineAvancer(u, u.tMs + 1000);
    if (!e.resultat || !e.resultat.ok) echecs.push(def.id + " : " + (e.resultat ? e.resultat.obtenu : "pas de résultat"));
    TPMS.usineAvancer(u, u.tMs + 60000);
  });
  verifier("essais : les " + TPMS.USINE_ESSAIS.length + " essais (13 de la maquette + 7 de la simulation) sont conformes", echecs.length === 0, echecs.join(" ; "));
  var e = u.essais.filter(function (x) { return x.id === "courant-passerelle"; })[0];
  verifier("essais : coupure de courant d'une passerelle vue « hors ligne » après le délai de garde (20 à 50 s), pas aussitôt",
    e && /après (\d+) s/.test(e.resultat.obtenu) && Number(/après (\d+) s/.exec(e.resultat.obtenu)[1]) >= 20, e && e.resultat.obtenu);
})();

resultats.lignes.push("");
resultats.lignes.push(resultats.reussis + " réussis, " + resultats.rates + " en échec");
console.log(resultats.lignes.join("\n"));
if (resultats.rates > 0) process.exitCode = 1;
