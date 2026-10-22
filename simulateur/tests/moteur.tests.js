// =====================================================================
// moteur.tests.js — Le monde complet, de bout en bout, sans la page
// ---------------------------------------------------------------------
// Lancer : node simulateur/tests/moteur.tests.js
// =====================================================================
var chemin = require("path");
[
  "../../logique/trame.js", "../../logique/vitesse.js", "../../logique/fuite.js",
  "../../logique/alertes.js", "../../logique/securite.js", "../../logique/protocole.js",
  "../../logique/energie.js",
  "../boitier/police5x7.js", "../boitier/epaper.js", "../boitier/ecran.js",
  "../boitier/liaison.js", "../boitier/boitier.js",
  "../monde/alea.js", "../monde/atmosphere.js", "../monde/pneu.js", "../monde/capteur.js",
  "../monde/parcours.js", "../monde/velo.js", "../monde/radio.js", "../monde/lipo.js",
  "../monde/circuit.js", "../sources/pirate.js", "../moteur.js"
].forEach(function (f) { require(chemin.join(__dirname, f)); });

var reussis = 0, rates = 0;
function verifier(nom, condition, detail) {
  if (condition) { reussis++; console.log("OK     " + nom); }
  else { rates++; console.log("ÉCHEC  " + nom + (detail !== undefined ? "  → obtenu : " + detail : "")); }
}

function options(sup) {
  return Object.assign({
    graine: 7, parcoursId: TPMS.PARCOURS[0].id, meteo: "printemps", heureDepartH: 8,
    chambre: "butyle", pressionAVBar: 2.2, pressionARBar: 2.4, vehiculesVoisins: 2
  }, sup || {});
}

// 1. Une sortie normale de 10 minutes
var m = TPMS.creerMonde(options());
TPMS.mondeAction(m, { type: "partir", depuisDebut: true });
var debut = Date.now();
TPMS.mondeAvancer(m, 10 * 60000);
var dureeCalcul = Date.now() - debut;
verifier("10 min simulées en moins de 10 s de calcul", dureeCalcul < 10000, dureeCalcul + " ms");
verifier("le vélo a roulé", m.velo.distanceM > 1000, Math.round(m.velo.distanceM) + " m");
verifier("le boîtier a compté des tours de roue", m.boitier.compteur.nbTours > 300, m.boitier.compteur.nbTours);
// Le boîtier compte avec la circonférence RÉGLÉE (2105 mm), la roue simulée
// a sa circonférence RÉELLE (rayon sous charge, selon le pneu et sa pression).
// Comme un vrai compteur, il se trompe exactement du rapport des deux.
var circReelleMm = 2 * Math.PI * m.velo.rayonRoulementAVM * 1000;
var attendue = m.velo.distanceM * m.boitier.reglages.circonferenceMm / circReelleMm;
var ecart = Math.abs(TPMS.compteurDistanceKm(m.boitier.compteur) * 1000 - attendue) / attendue;
verifier("distance du boîtier = distance réelle × circonférence réglée / réelle (< 1 %)", ecart < 0.01, (ecart * 100).toFixed(2) + " %");
verifier("des annonces des capteurs ont été reçues", m.stats.recues > 20, m.stats.recues);
verifier("le boîtier affiche la pression avant", m.boitier.roues.AV.mesure !== null);
verifier("pression affichée proche de la réelle",
  m.boitier.roues.AV.mesure && Math.abs(m.boitier.roues.AV.mesure.pressionBar - m.pneus.AV.pressionRelBar) < 0.1,
  m.boitier.roues.AV.mesure && m.boitier.roues.AV.mesure.pressionBar);
verifier("pas d'alerte sur une sortie normale", m.boitier.roues.AV.etat === "OK" && m.boitier.roues.AR.etat === "OK",
  m.boitier.roues.AV.etat + " / " + m.boitier.roues.AR.etat);
verifier("la LiPo s'est un peu vidée", m.lipo.etatCharge < 1 && m.lipo.etatCharge > 0.9, m.lipo.etatCharge);
verifier("enregistrement rempli", m.enregistrement.length > 500, m.enregistrement.length);

// 2. Crevaison : le boîtier doit alerter
TPMS.mondeAction(m, { type: "percer", roue: "AV", diametreMm: 1, forme: "epine" });
TPMS.mondeAvancer(m, 3 * 60000);
verifier("crevaison : pneu avant vidé", m.pneus.AV.pressionRelBar < 0.6, m.pneus.AV.pressionRelBar.toFixed(2));
verifier("crevaison : le boîtier alerte", TPMS.estAlerte(m.boitier.roues.AV.etat), m.boitier.roues.AV.etat);

// 3. Reproductibilité et rejeu
var a = TPMS.creerMonde(options({ graine: 99 }));
var b = TPMS.creerMonde(options({ graine: 99 }));
TPMS.mondeAction(a, { type: "partir", depuisDebut: true });
TPMS.mondeAction(b, { type: "partir", depuisDebut: true });
TPMS.mondeAvancer(a, 120000);
TPMS.mondeAvancer(b, 120000);
verifier("même graine → même distance", a.velo.distanceM === b.velo.distanceM, a.velo.distanceM + " / " + b.velo.distanceM);
verifier("même graine → même pression", a.pneus.AR.pressionRelBar === b.pneus.AR.pressionRelBar);
TPMS.mondeAction(a, { type: "fuite", roue: "AR", diametreMm: 0.04 });
TPMS.mondeAvancer(a, 60000);
var r = TPMS.mondeRejeu(a);
TPMS.mondeAvancer(r, a.tMs);
verifier("rejeu → même distance", Math.abs(r.velo.distanceM - a.velo.distanceM) < 1e-6, r.velo.distanceM + " / " + a.velo.distanceM);
verifier("rejeu → même pression arrière", Math.abs(r.pneus.AR.pressionRelBar - a.pneus.AR.pressionRelBar) < 1e-9);

// 4. Plusieurs jours vélo garé : la batterie se vide lentement
var g = TPMS.creerMonde(options({ graine: 3 }));
debut = Date.now();
TPMS.mondeAvancer(g, 2 * 24 * 3600000);
verifier("2 jours garés calculés en moins de 15 s", Date.now() - debut < 15000, (Date.now() - debut) + " ms");
verifier("boîtier en veille", g.boitier.veille);
verifier("batterie encore presque pleine après 2 jours de veille", g.lipo.etatCharge > 0.95, g.lipo.etatCharge);

// 5. Pirate qui usurpe le capteur avant, protections actives
var p = TPMS.creerMonde(options({ graine: 11 }));
TPMS.mondeAction(p, { type: "partir", depuisDebut: true });
TPMS.mondeAvancer(p, 60000);
TPMS.mondeAction(p, { type: "pirate", pirate: { actif: true, cible: "AV", attaque: "usurpation", pressionFausseBar: 0.3, intervalleMs: 1000 } });
TPMS.mondeAvancer(p, 60000);
verifier("pirate : le boîtier détecte l'intrusion", p.boitier.stats.intrusions > 0, p.boitier.stats.intrusions);
verifier("pirate : la fausse crevaison n'est pas acceptée",
  !p.boitier.roues.AV.mesure || p.boitier.roues.AV.mesure.pressionBar > 1, p.boitier.roues.AV.mesure && p.boitier.roues.AV.mesure.pressionBar);

// 6. Vélo arrêté en fin de parcours : pas de fausse alerte « capteur perdu »
// (les capteurs n'annoncent plus qu'une fois par minute à l'arrêt).
(function () {
  var a = TPMS.creerMonde(options({ graine: 5 }));
  TPMS.mondeAction(a, { type: "partir", depuisDebut: true });
  TPMS.mondeAvancer(a, 120000);
  TPMS.mondeAction(a, { type: "garer" });
  var fausses = 0;
  for (var i = 0; i < 4 * 60; i++) {           // 4 min arrêté, boîtier encore éveillé
    TPMS.mondeAvancer(a, 1000);
    if (a.boitier.roues.AV.etat === "PERDU" || a.boitier.roues.AR.etat === "PERDU") fausses++;
  }
  verifier("arrêt : aucune fausse alerte « capteur perdu »", fausses === 0, fausses + " s en alerte");
})();

// 7. Le découpage du temps ne change rien : avancer de 10 min d'un coup,
// ou par morceaux irréguliers (comme les images de la page), donne
// exactement le même monde. Indispensable pour un rejeu exact.
(function () {
  var a = TPMS.creerMonde(options({ graine: 21 }));
  var b = TPMS.creerMonde(options({ graine: 21 }));
  TPMS.mondeAction(a, { type: "partir", depuisDebut: true });
  TPMS.mondeAction(b, { type: "partir", depuisDebut: true });
  TPMS.mondeAvancer(a, 600000);
  var alea = TPMS.creerAlea(4), fait = 0;
  while (fait < 600000) {
    var morceau = Math.min(600000 - fait, 1 + Math.floor(alea() * 3000));
    TPMS.mondeAvancer(b, morceau);
    fait += morceau;
  }
  verifier("découpage du temps sans effet : même distance", a.velo.distanceM === b.velo.distanceM, a.velo.distanceM + " / " + b.velo.distanceM);
  verifier("découpage du temps sans effet : même pression", a.pneus.AV.pressionRelBar === b.pneus.AV.pressionRelBar);
  verifier("découpage du temps sans effet : même batterie", a.lipo.etatCharge === b.lipo.etatCharge);
})();

// 8. Après une attaque repérée, pas de fausse alerte « capteur perdu » à la
// fin de la quarantaine : le vrai capteur reprend la main.
(function () {
  var a = TPMS.creerMonde(options({ graine: 13 }));
  TPMS.mondeAction(a, { type: "partir", depuisDebut: true });
  TPMS.mondeAvancer(a, 60000);
  TPMS.mondeAction(a, { type: "pirate", pirate: { actif: true, cible: "AR", attaque: "usurpation", pressionFausseBar: 1.2, intervalleMs: 500 } });
  TPMS.mondeAvancer(a, 20000);
  TPMS.mondeAction(a, { type: "pirate", pirate: { actif: false } });
  var perdu = 0;
  for (var i = 0; i < 180; i++) {
    TPMS.mondeAvancer(a, 1000);
    if (a.boitier.roues.AR.etat === "PERDU") perdu++;
  }
  verifier("fin d'attaque : pas de fausse alerte « capteur perdu »", perdu === 0, perdu + " s en alerte");
  verifier("fin d'attaque : la roue arrière revient à OK", a.boitier.roues.AR.etat === "OK", a.boitier.roues.AR.etat);
  console.log("\n" + reussis + " réussis, " + rates + " en échec");
  if (rates > 0) process.exitCode = 1;
})();
