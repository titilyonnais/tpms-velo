// =====================================================================
// simulateur.js — Interface du simulateur de l'usine (affichage seulement)
// ---------------------------------------------------------------------
// Tout le calcul est dans entrepot/usine.js (modèle pur) : ce fichier fait
// avancer le temps, transmet les actions (pannes, attaques, événements)
// et dessine. Le temps de la simulation commence le lundi 26/10/2026 à
// 6 h (heure de Paris), au début du poste.
// =====================================================================
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var E = TPMS.ENTREPOT, U = TPMS.USINE, POS = TPMS.POSITIONS_PNEU;
  var NOMS_POS = { AVG: "AV G", AVD: "AV D", ARG: "AR G", ARD: "AR D" };
  var NOMS_ZONES = {};
  E.zones.forEach(function (z) { NOMS_ZONES[z.id] = z.nom; });
  var TYPES = { OK: "OK", ATTENTE: "En attente", BASSE: "Pression basse", HAUTE: "Pression haute", FUITE: "Fuite rapide",
    FUITE_LENTE: "Fuite lente", CREVAISON: "Crevaison", PERDU: "Capteur perdu", INTRUSION: "Signal suspect" };

  var graine = Number(new URLSearchParams(location.search).get("graine")) || 2026;
  var etat = {
    usine: TPMS.creerUsine({ graine: graine }), facteur: 10, pause: false, page: "accueil", choisi: "C01",
    cibleMs: 0, histo: {}, dernierEchantillonMs: 0, mesuresDebit: null, fileEssais: [], essaiEnCours: null, calculMs: 0
  };
  etat.cibleMs = etat.usine.tMs;
  etat.usine.monde.chariots.forEach(function (c) { etat.histo[c.id] = { AVG: [], AVD: [], ARG: [], ARD: [] }; });

  // -------------------------------------------------------------------
  // Mise en forme
  // -------------------------------------------------------------------
  function nombre(x, n) {
    if (x === null || x === undefined || isNaN(x)) return "–";
    return Number(x).toFixed(n === undefined ? 2 : n).replace(".", ",").replace("-", "−");
  }
  function echapper(t) {
    return String(t === null || t === undefined ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var PARIS = { timeZone: "Europe/Paris" };
  function heure(t, sec) { return new Date(t).toLocaleTimeString("fr-FR", Object.assign({ hour: "2-digit", minute: "2-digit" }, sec ? { second: "2-digit" } : {}, PARIS)); }
  function jour(t) { return new Date(t).toLocaleDateString("fr-FR", Object.assign({ weekday: "long", day: "numeric", month: "short" }, PARIS)); }
  function depuis(ms) {
    var s = Math.round(ms / 1000);
    if (s < 0) return "—";
    if (s < 60) return s + " s";
    if (s < 3600) return Math.round(s / 60) + " min";
    return nombre(s / 3600, 1) + " h";
  }
  function octets(n) {
    if (n < 1024) return n + " o";
    if (n < 1048576) return nombre(n / 1024, 1) + " Kio";
    return nombre(n / 1048576, 1) + " Mio";
  }
  function classeEtat(e) {
    if (e === "OK") return "ok";
    if (!e || e === "ATTENTE") return "muet";
    if (e === "BASSE" || e === "HAUTE" || e === "FUITE" || e === "FUITE_LENTE") return "regonfler";
    return "urgent";
  }
  function classePuce(e) { var c = classeEtat(e); return c === "ok" ? "ok" : c === "regonfler" ? "attention" : c === "urgent" ? "alerte" : "muet"; }
  function sup() { return etat.usine.machines.supervision.supervision; }
  function vueSup() { return sup().reception.etatDesPneus(TPMS.usineHeure(etat.usine, "supervision")); }
  function chariot(id) { return etat.usine.monde.chariots.filter(function (c) { return c.id === id; })[0]; }
  function etatMachine(m) {
    if (!m.alimentee) return { texte: "courant coupé", classe: "alerte" };
    if (!m.programme) return { texte: "programme arrêté", classe: "alerte" };
    if (!m.cable) return { texte: "câble débranché", classe: "attention" };
    return { texte: "en marche", classe: "ok" };
  }

  // -------------------------------------------------------------------
  // Le temps
  // -------------------------------------------------------------------
  // Avance par tranches d'une minute au plus : un relevé de la vraie
  // pression de chaque pneu par minute (courbes de la page Chariots).
  function avancer(dtMs) {
    var u = etat.usine, debut = performance.now();
    etat.cibleMs += dtMs;
    while (u.tMs + 1000 <= etat.cibleMs) {
      TPMS.usineAvancer(u, Math.min(etat.cibleMs, u.tMs + 60000));
      if (u.tMs - etat.dernierEchantillonMs >= 60000) echantillonner();
      enchainerEssais();
    }
    etat.calculMs = 0.8 * etat.calculMs + 0.2 * (performance.now() - debut);
  }
  function echantillonner() {
    var u = etat.usine;
    etat.dernierEchantillonMs = u.tMs;
    u.monde.chariots.forEach(function (c) {
      POS.forEach(function (p) {
        var h = etat.histo[c.id][p];
        h.push([u.tMs, c.pneus[p].pressionRelBar]);
        if (h.length > 12 * 60) h.shift();
      });
    });
  }
  // « Tout lancer » : un essai après l'autre, chacun attend la fin du précédent.
  function enchainerEssais() {
    if (etat.essaiEnCours && !etat.essaiEnCours.resultat) return;
    if (etat.essaiEnCours && etat.usine.tMs - etat.essaiEnCours.finMs < 30000) return;   // 30 s de calme entre deux essais
    etat.essaiEnCours = null;
    var id = etat.fileEssais.shift();
    if (id) etat.essaiEnCours = TPMS.usineLancerEssai(etat.usine, id);
  }

  // -------------------------------------------------------------------
  // Barre du haut
  // -------------------------------------------------------------------
  function afficherHaut() {
    var u = etat.usine, t = u.tMs;
    $("horloge").textContent = heure(t, true);
    $("txtJour").textContent = jour(t);
    $("txtCharge").textContent = etat.calculMs > 30 ? "calcul " + Math.round(etat.calculMs) + " ms" : "";
    var vue = vueSup(), lignes = Object.keys(vue);
    var urgents = lignes.filter(function (id) { return classeEtat(vue[id].etat) === "urgent"; });
    var aTraiter = lignes.filter(function (id) { return classeEtat(vue[id].etat) === "regonfler"; });
    var horsLigne = Object.keys(sup().passerelles).filter(function (id) { return sup().passerelles[id].etat !== "en ligne"; });
    var supArretee = !u.machines.supervision.alimentee || !u.machines.supervision.programme;
    var courtierArrete = !u.machines.courtier.alimentee || !u.machines.courtier.programme;
    var g = $("etatGlobal");
    g.className = "etat-global " + (supArretee || courtierArrete || urgents.length || horsLigne.length ? "alerte" : aTraiter.length ? "attention" : "");
    $("etatTitre").textContent = supArretee ? "Supervision arrêtée : personne ne voit les pneus"
      : courtierArrete ? "Courtier MQTT arrêté : les passerelles gardent leurs lots"
      : urgents.length ? urgents.length + " chariot(s) à arrêter" : horsLigne.length ? "Passerelle " + horsLigne.join(", ") + " hors ligne"
      : aTraiter.length ? aTraiter.length + " chariot(s) à traiter" : "Tout va bien";
    $("etatDetail").textContent = urgents.concat(aTraiter).map(function (id) { return id + " (" + TYPES[vue[id].etat].toLowerCase() + ")"; }).join(" · ") ||
      (etat.essaiEnCours && !etat.essaiEnCours.resultat ? "Essai en cours : " + etat.essaiEnCours.def.titre : "");
  }

  // -------------------------------------------------------------------
  // Vue d'ensemble
  // -------------------------------------------------------------------
  function debitReseau() {
    var u = etat.usine;
    var total = u.compteurEtabli.octets + u.regles.reduce(function (s, r) { return s + r.octets; }, 0);
    var paquets = u.compteurEtabli.paquets + u.regles.reduce(function (s, r) { return s + r.paquets; }, 0);
    var m = etat.mesuresDebit, res = m && m.debit !== undefined ? m : { debit: 0, pps: 0 };
    if (!m || u.tMs - m.t >= 5000) {
      if (m && u.tMs > m.t) res = { debit: (total - m.octets) * 8 / 1000 / ((u.tMs - m.t) / 1000), pps: (paquets - m.paquets) / ((u.tMs - m.t) / 1000) };
      etat.mesuresDebit = { t: u.tMs, octets: total, paquets: paquets, debit: res.debit, pps: res.pps };
    }
    return res;
  }

  function afficherAccueil() {
    var u = etat.usine, vue = vueSup(), ids = Object.keys(vue);
    var enEtat = ids.filter(function (id) { return vue[id].etat === "OK"; }).length;
    $("kChariots").textContent = enEtat + " / " + ids.length;
    var reelsBas = 0;
    u.monde.chariots.forEach(function (c) { POS.forEach(function (p) { if (TPMS.pressionCompenseeBar(c.pneus[p].pressionRelBar, c.pneus[p].temperatureAirC) < 8.0) reelsBas++; }); });
    $("kChariotsDetail").textContent = "En vrai : " + reelsBas + " pneu(s) sous 8,0 bar à 20 °C";
    var alertes = [];
    ids.forEach(function (id) { POS.forEach(function (p) { var pn = vue[id].pneus[p]; if (pn && TPMS.estAlerte(pn.etat)) alertes.push(id + " " + NOMS_POS[p] + " : " + TYPES[pn.etat].toLowerCase()); }); });
    $("kPneus").textContent = alertes.length;
    $("kPneusDetail").textContent = alertes.slice(0, 2).join(" · ") + (alertes.length > 2 ? "…" : "") || "Aucun";
    var d = debitReseau();
    $("kDebit").textContent = nombre(d.debit, 1);
    $("kDebitDetail").textContent = nombre(d.pps, 0) + " paquets/s · " + Object.keys(u.conntrack).length + " connexions suivies par le pare-feu";
    var air = TPMS.entrepotAir(u.monde, 100, u.tMs), dedans = TPMS.entrepotAir(u.monde, 10, u.tMs);
    $("kMeteo").textContent = nombre(air.temperatureC, 1);
    $("kMeteoDetail").textContent = (air.pluie ? "pluie" : air.ensoleillement > 0.05 ? "soleil " + Math.round(air.ensoleillement * 100) + " %" : "pas de soleil") +
      " · dedans " + nombre(dedans.temperatureC, 0) + " °C";
    dessinerPlan(vue);
    afficherComparaison(vue);
    afficherEvenements();
  }

  var ECH = 8, HAUT = 30;
  function dessinerPlan(vue) {
    var svg = $("plan"), S = TPMS.svgElement, u = etat.usine;
    svg.innerHTML = "";
    var defs = S("defs", {}), clip = S("clipPath", { id: "clipPlan" });
    clip.appendChild(S("rect", { x: 0, y: HAUT, width: E.largeurM * ECH, height: E.profondeurM * ECH, rx: 12 }));
    defs.appendChild(clip); svg.appendChild(defs);
    E.zones.forEach(function (z) {
      svg.appendChild(S("rect", { x: z.x0 * ECH + 2, y: HAUT, width: (z.x1 - z.x0) * ECH - 4, height: E.profondeurM * ECH, rx: 12, "class": "zone-plan" + (z.exterieur ? " exterieur" : "") }));
      svg.appendChild(S("text", { x: z.x0 * ECH + 14, y: HAUT - 10, "class": "zone-nom" }, z.nom));
    });
    for (var r = 0; r < 4; r++) svg.appendChild(S("rect", { x: 44 * ECH + r * 9 * ECH, y: HAUT + 40, width: 18, height: 70, rx: 3, "class": "rack" }));
    var g = S("g", { "clip-path": "url(#clipPlan)" });
    if (u.brouilleur) g.appendChild(S("circle", { cx: u.brouilleur.x * ECH, cy: HAUT + u.brouilleur.y * ECH, r: u.brouilleur.rayonM * ECH, "class": "brouilleur" }));
    E.passerelles.forEach(function (p) {
      var m = u.machines["passerelle-" + p.id], marche = m.alimentee && m.programme;
      var cx = p.x * ECH, cy = HAUT + p.y * ECH;
      g.appendChild(S("circle", { cx: cx, cy: cy, r: 24 * ECH, "class": "portee" + (marche ? "" : " coupee") }));
      g.appendChild(S("circle", { cx: cx, cy: cy, r: 9, "class": "passerelle-plan" + (marche && m.cable ? "" : " coupee") }));
      g.appendChild(S("text", { x: cx + 14, y: cy + 4, "class": "passerelle-texte" }, "P" + p.id));
    });
    svg.appendChild(g);
    u.monde.chariots.forEach(function (c) {
      var x = c.x * ECH, y = HAUT + c.y * ECH, e = vue[c.id] ? vue[c.id].etat : "ATTENTE";
      var grp = S("g", { "class": "chariot-plan" + (c.id === etat.choisi ? " choisi" : ""), "data-id": c.id });
      if (c.cible) grp.appendChild(S("line", { x1: x, y1: y, x2: c.cible.x * ECH, y2: HAUT + c.cible.y * ECH, "class": "trajet" }));
      grp.appendChild(S("rect", { x: x - 22, y: y - 10, width: 44, height: 20, rx: 6, "class": "velo " + classeEtat(e) }));
      grp.appendChild(S("text", { x: x, y: y + 4, "class": "chariot-texte" }, c.id));
      if (c.chargeKg && c.vitesseMs > 0) grp.appendChild(S("text", { x: x, y: y + 24, "class": "charge-texte" }, nombre(c.chargeKg / 1000, 1) + " t"));
      if (u.tMs < c.immobiliseJusquaMs) grp.appendChild(S("text", { x: x, y: y - 14, "class": "charge-texte alerte" }, "arrêté"));
      grp.appendChild(S("title", {}, c.id + " · " + TYPES[e] + " · " + nombre(c.vitesseMs * 3.6, 1) + " km/h · charge " + c.chargeKg + " kg"));
      svg.appendChild(grp);
    });
  }

  function afficherComparaison(vue) {
    var u = etat.usine, s = sup(), lignes = [];
    var vraies = [], vues = [], zonesJustes = 0, zonesVues = 0;
    u.monde.chariots.forEach(function (c) {
      POS.forEach(function (p) {
        vraies.push(c.pneus[p].pressionRelBar);
        var pn = vue[c.id] && vue[c.id].pneus[p];
        if (pn && pn.pression !== undefined) vues.push(pn.pression);
      });
      var zv = s.reception.zoneDe(c.id);
      if (zv) { zonesVues++; if (zv === TPMS.entrepotZone(c.x)) zonesJustes++; }
    });
    function moy(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
    var marche = E.passerelles.filter(function (p) { var m = u.machines["passerelle-" + p.id]; return m.alimentee && m.programme && m.cable; }).length;
    var enLigne = Object.keys(s.passerelles).filter(function (id) { return s.passerelles[id].etat === "en ligne"; }).length;
    var ecarts = E.passerelles.map(function (p) { return Math.abs(u.machines["passerelle-" + p.id].horloge.decalageMs); });
    var annonces = E.passerelles.map(function (p) { return Math.abs(s.passerelles[p.id] && s.passerelles[p.id].decalage_ntp_ms || 0); });
    var attente = E.passerelles.reduce(function (n, p) { return n + u.machines["passerelle-" + p.id].passerelle.lotsEnAttente.length; }, 0);
    lignes.push(["Pression moyenne des pneus", nombre(moy(vraies)) + " bar", vues.length ? nombre(moy(vues)) + " bar (" + vues.length + " pneus connus)" : "–"]);
    lignes.push(["Passerelles qui fonctionnent", marche + " / 3", enLigne + " / 3 « en ligne »"]);
    lignes.push(["Chariots dans la bonne zone", "–", zonesVues ? zonesJustes + " / " + zonesVues + " justes" : "–"]);
    lignes.push(["Écart d'horloge des passerelles", "jusqu'à " + nombre(Math.max.apply(null, ecarts), 0) + " ms", "dernier écart NTP annoncé : jusqu'à " + Math.max.apply(null, annonces) + " ms"]);
    lignes.push(["Lots pas encore livrés", attente + " dans les passerelles", s.messages + " messages reçus"]);
    lignes.push(["Annonces émises / entendues", u.stats.annoncesEmises + " / " + u.stats.annoncesEntendues, s.reception.compteurs.acceptees + " acceptées, " + s.reception.compteurs.doublons + " doublons"]);
    $("corpsComparaison").innerHTML = lignes.map(function (l) { return "<tr><td>" + l[0] + "</td><td>" + l[1] + "</td><td>" + l[2] + "</td></tr>"; }).join("");
  }

  function evenements() {
    var u = etat.usine, tous = [];
    u.journalCentral.slice(-60).forEach(function (l) { tous.push({ t: l.t, src: l.source, txt: l.texte, g: l.gravite }); });
    u.journalCourtier.slice(-60).forEach(function (l) { tous.push({ t: l.t, src: "courtier", txt: l.texte, g: l.gravite }); });
    u.journalSupervision.slice(-60).forEach(function (l) { tous.push({ t: l.t, src: "supervision", txt: l.texte, g: l.gravite }); });
    u.journalPareFeu.slice(-60).forEach(function (l) { tous.push({ t: l.t, src: "pare-feu", txt: l.texte, g: l.gravite }); });
    sup().alertes.slice(0, 30).forEach(function (a) { tous.push({ t: a.t, src: "alerte", txt: a.chariot_id + " " + NOMS_POS[a.position] + " : " + TYPES[a.type] + (a.pression !== null && a.pression !== undefined ? " (" + nombre(a.pression) + " bar)" : ""), g: "attention" }); });
    return tous.filter(function (e) { return !/heure NTP : décalage/.test(e.txt); }).sort(function (a, b) { return b.t - a.t; }).slice(0, 50);
  }
  function afficherEvenements() {
    $("filEvenements").innerHTML = evenements().map(function (e) {
      return "<li class=\"" + (e.g === "attention" || e.g === "erreur" ? "alerte" : "") + "\"><span class=\"heure\">" + heure(e.t, true) + "</span><span><b>" + echapper(e.src) + "</b> · " + echapper(e.txt) + "</span></li>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Chariots et pneus
  // -------------------------------------------------------------------
  function afficherChariots() {
    var u = etat.usine, vue = vueSup(), s = sup();
    $("corpsPneus").innerHTML = u.monde.chariots.map(function (c) {
      return POS.map(function (p, k) {
        var pneu = c.pneus[p], pn = vue[c.id] && vue[c.id].pneus[p], ann = u.dernieresAnnonces[c.id + " " + p];
        var zr = TPMS.entrepotZone(c.x), zv = s.reception.zoneDe(c.id);
        var debut = k === 0 ? "<td rowspan=\"4\" class=\"col-chariot\">" + c.id + (u.tMs < c.immobiliseJusquaMs ? "<span class=\"raison alerte-texte\">arrêté</span>" : "") + "</td>" +
          "<td rowspan=\"4\">" + echapper(NOMS_ZONES[zr]) + (zv && zv !== zr ? "<span class=\"raison\">vu : " + echapper(NOMS_ZONES[zv]) + "</span>" : "") + "</td>" +
          "<td rowspan=\"4\">" + (c.chargeKg ? nombre(c.chargeKg / 1000, 1) + " t" : "à vide") + "<span class=\"raison\">" + nombre(c.vitesseMs * 3.6, 1) + " km/h</span></td>" : "";
        var trous = pneu.orifices.length ? " <span class=\"alerte-texte\" title=\"" + pneu.orifices.map(function (o) { return o.type; }).join(", ") + "\">●</span>" : "";
        var capteur = c.capteurs[p].arrache ? "<td class=\"alerte-texte\">arraché</td>" : "<td>" + (ann ? nombre(ann.pression) + "<span class=\"raison\">il y a " + depuis(u.tMs - ann.t) + "</span>" : "–") + "</td>";
        return "<tr data-id=\"" + c.id + "\"" + (c.id === etat.choisi ? " class=\"choisi\"" : "") + ">" + debut +
          "<td>" + NOMS_POS[p] + trous + "</td><td class=\"pneu\">" + nombre(pneu.pressionRelBar) + "</td><td>" + nombre(pneu.temperatureAirC, 1) + " °C</td>" + capteur +
          "<td class=\"pneu " + classeEtat(pn && pn.etat) + "\">" + (pn && pn.pression !== undefined ? nombre(pn.pression) : "–") + "</td>" +
          "<td>" + (pn && pn.pression20 !== undefined ? nombre(pn.pression20) : "–") + "</td>" +
          "<td>" + (pn && pn.tendanceBarJour !== null && pn.tendanceBarJour !== undefined ? nombre(pn.tendanceBarJour, 3) + " bar/j" : "–") + "</td>" +
          "<td>" + Math.round(c.capteurs[p].pilePct) + " %</td>" +
          "<td><span class=\"puce " + classePuce(pn && pn.etat) + "\">" + echapper(TYPES[pn ? pn.etat : "ATTENTE"]) + "</span></td></tr>";
      }).join("");
    }).join("");

    // Détail du chariot choisi : vraie pression (lignes) et mesures reçues (points).
    var c = chariot(etat.choisi), t0 = u.tMs;
    $("detailTitre").textContent = c.id + " · " + NOMS_ZONES[TPMS.entrepotZone(c.x)];
    var ec = vue[c.id] ? vue[c.id].etat : "ATTENTE";
    $("detailEtat").className = "puce " + classePuce(ec);
    $("detailEtat").textContent = TYPES[ec];
    var classes = { AVG: "", AVD: "s2", ARG: "s3", ARD: "s4" }, series = [];
    POS.forEach(function (p) {
      series.push({ classe: classes[p], points: etat.histo[c.id][p].map(function (x) { return [(x[0] - t0) / 3600000, x[1]]; }) });
    });
    POS.forEach(function (p) {
      series.push({ classe: "points " + (classes[p] || "s1"), points: s.historique[c.id].filter(function (m) { return m.position === p && m.t > t0 - 12 * 3600000; })
        .map(function (m) { return [(m.t - t0) / 3600000, m.pression]; }) });
    });
    TPMS.grapheLignes($("grapheDetail"), {
      series: series, xMax: 0, pasY: 0.25,
      reperes: [{ y: TPMS.RECEPTION.seuils.basBar, texte: "seuil bas 7,8 (à 20 °C)" }],
      formatX: function (v) { return v > -0.05 ? "maintenant" : "−" + nombre(-v, 1).replace(",0", "") + " h"; },
      formatY: function (v) { return nombre(v, 2); }, vide: "Pas encore de relevé"
    });
    $("listeInterventions").innerHTML = u.technicien.interventions.map(function (i) {
      return "<li><span class=\"heure\">" + heure(i.t) + "</span><span><b>" + echapper(i.chariot) + (i.position ? " " + NOMS_POS[i.position] : "") + "</b> · " + echapper(i.texte) + "</span></li>";
    }).join("");
  }
  function construireActionsChariot() {
    $("actionsChariot").innerHTML = "<select class=\"champ-jeton\" id=\"selPneu\" style=\"width:auto\">" + POS.map(function (p) { return "<option value=\"" + p + "\">" + NOMS_POS[p] + "</option>"; }).join("") + "</select>" +
      "<button type=\"button\" class=\"bouton danger\" data-act=\"clou\">Clou</button>" +
      "<button type=\"button\" class=\"bouton danger\" data-act=\"valve\">Valve arrachée</button>" +
      "<button type=\"button\" class=\"bouton\" data-act=\"fuite\">Fuite lente</button>" +
      "<button type=\"button\" class=\"bouton\" data-act=\"capteur\">Arracher le capteur</button>";
  }

  // -------------------------------------------------------------------
  // Radio
  // -------------------------------------------------------------------
  var radioAvant = null;
  function afficherRadio() {
    var u = etat.usine, s = sup();
    var maintenant = E.passerelles.map(function (p) { return u.machines["passerelle-" + p.id].passerelle.compteurs.entendues; });
    var parS = [0, 0, 0];
    if (radioAvant && u.tMs > radioAvant.t) parS = maintenant.map(function (n, i) { return (n - radioAvant.n[i]) / ((u.tMs - radioAvant.t) / 1000); });
    if (!radioAvant || u.tMs - radioAvant.t >= 10000) radioAvant = { t: u.tMs, n: maintenant, parS: parS };
    else parS = radioAvant.parS || parS;
    $("corpsRadio").innerHTML = E.passerelles.map(function (p, i) {
      var m = u.machines["passerelle-" + p.id], pa = m.passerelle, em = etatMachine(m);
      return "<tr><td>P" + p.id + "</td><td>" + NOMS_ZONES[p.zone] + "</td><td><span class=\"puce " + em.classe + "\">" + em.texte + "</span></td>" +
        "<td>" + pa.compteurs.entendues + "</td><td>" + nombre(parS[i], 1) + "</td><td>" + pa.compteurs.horsPortee + "</td><td>" + pa.annonces.length + "</td><td>" + pa.lotsEnAttente.length + "</td></tr>";
    }).join("");
    $("corpsRssi").innerHTML = u.monde.chariots.map(function (c) {
      var r = u.derniersRssi[c.id] || {};
      var dist = E.passerelles.map(function (p) { var dx = c.x - p.x, dy = c.y - p.y; return nombre(Math.sqrt(dx * dx + dy * dy + 36), 0); }).join(" / ");
      var cellules = E.passerelles.map(function (p) {
        var x = r[p.id];
        return x && u.tMs - x.t < 60000 ? "<td class=\"mono\">" + x.rssi + "</td>" : "<td class=\"discret\">—</td>";
      }).join("");
      var zr = TPMS.entrepotZone(c.x), zv = s.reception.zoneDe(c.id);
      return "<tr><td>" + c.id + "</td><td class=\"mono\">" + dist + " m</td>" + cellules + "<td>" + NOMS_ZONES[zr] + "</td><td class=\"" + (zv && zv !== zr ? "attention-texte" : "") + "\">" + (zv ? NOMS_ZONES[zv] : "–") + "</td></tr>";
    }).join("");
    $("mesuresRadio").innerHTML = [["Annonces émises", u.stats.annoncesEmises], ["Entendues (toutes passerelles)", u.stats.annoncesEntendues],
      ["Brouillées", u.stats.annoncesBrouillees], ["Brouilleur", u.brouilleur ? "x = " + u.brouilleur.x + " m, rayon " + u.brouilleur.rayonM + " m" : "aucun"]]
      .map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
    document.querySelectorAll("#choixBrouilleur button").forEach(function (b) {
      b.classList.toggle("actif", String(u.brouilleur ? u.brouilleur.x : "") === b.dataset.brouilleur);
    });
  }

  // -------------------------------------------------------------------
  // Réseau et pare-feu
  // -------------------------------------------------------------------
  var POSITIONS_SCHEMA = {
    "passerelle-1": [80, 115], "passerelle-2": [170, 115], "passerelle-3": [260, 115], "intrus": [170, 170],
    "courtier": [700, 100], "supervision": [800, 100], "ntp": [890, 100], "syslog": [800, 170],
    "poste": [170, 335], "pare-feu": [480, 210]
  };
  var reglesAvant = null;
  function afficherReseau() {
    var u = etat.usine;
    // Règles et compteurs
    var avant = reglesAvant;
    if (!avant || u.tMs - avant.t >= 5000) reglesAvant = { t: u.tMs, paquets: u.regles.map(function (r) { return r.paquets; }), etabli: u.compteurEtabli.paquets, parS: avant ? calculerParS(avant) : null };
    var parS = reglesAvant.parS || [];
    function calculerParS(a) {
      var dt = (u.tMs - a.t) / 1000;
      return u.regles.map(function (r, i) { return dt > 0 ? (r.paquets - a.paquets[i]) / dt : 0; }).concat([dt > 0 ? (u.compteurEtabli.paquets - a.etabli) / dt : 0]);
    }
    var lignes = [{ nom: "ct state established,related", verdict: "accept", paquets: u.compteurEtabli.paquets, octets: u.compteurEtabli.octets }].concat(u.regles);
    var parSOrdre = [parS[u.regles.length]].concat(parS.slice(0, u.regles.length));
    $("corpsRegles").innerHTML = lignes.map(function (r, i) {
      return "<tr class=\"" + (r.verdict === "drop" && r.paquets ? "ligne-refus" : "") + "\"><td>" + echapper(r.nom) + "</td><td class=\"" + (r.verdict === "accept" ? "ok-texte" : "alerte-texte") + "\">" + r.verdict + "</td>" +
        "<td class=\"mono\">" + r.paquets + "</td><td class=\"mono\">" + octets(r.octets) + "</td><td class=\"mono\">" + (parSOrdre[i] === undefined ? "–" : nombre(parSOrdre[i], 1)) + "</td></tr>";
    }).join("");
    var nTcp = Object.keys(u.conntrack).filter(function (k) { return k.indexOf("tcp") === 0; }).length;
    $("txtConntrack").textContent = "Suivi des connexions : " + nTcp + " connexion(s) TCP et " + (Object.keys(u.conntrack).length - nTcp) + " flux UDP. Une connexion autorisée n'est comptée qu'une fois sur sa règle (premier paquet) ; la suite passe par « established ».";
    // Machines
    var machines = ["passerelle-1", "passerelle-2", "passerelle-3", "courtier", "supervision", "ntp", "syslog", "poste", "intrus"];
    $("corpsMachines").innerHTML = machines.map(function (id) {
      var m = u.machines[id], em = etatMachine(m);
      if (id === "intrus" && !m.alimentee) em = { texte: "non branché", classe: "muet" };
      var boutons = em.texte === "en marche"
        ? "<button type=\"button\" class=\"bouton petit-bouton\" data-panne=\"couper-courant\" data-machine=\"" + id + "\">Courant</button><button type=\"button\" class=\"bouton petit-bouton\" data-panne=\"plantage\" data-machine=\"" + id + "\">Plantage</button><button type=\"button\" class=\"bouton petit-bouton\" data-panne=\"debrancher\" data-machine=\"" + id + "\">Câble</button>" +
          (m.passerelle ? "<button type=\"button\" class=\"bouton petit-bouton\" data-panne=\"derive-horloge\" data-machine=\"" + id + "\">Horloge +90 s</button>" : "")
        : "<button type=\"button\" class=\"bouton petit-bouton principal\" data-panne=\"rebrancher\" data-machine=\"" + id + "\">" + (id === "intrus" && !m.alimentee ? "Brancher" : "Rétablir") + "</button>";
      return "<tr><td>" + id + "</td><td class=\"mono\">" + m.ip + "</td><td><span class=\"puce " + em.classe + "\">" + em.texte + "</span></td><td class=\"actions-machine\">" + boutons + "</td></tr>";
    }).join("");
    // Derniers paquets (hors ACK et keepalive, pour la lisibilité)
    $("corpsFlux").innerHTML = u.flux.slice(-60).reverse().filter(function (f) { return f.quoi !== "ACK"; }).slice(0, 40).map(function (f) {
      var pf = f.verdict === "direct" ? "<span class=\"discret\">même zone</span>" : f.verdict === "accept" ? "<span class=\"ok-texte\">" + echapper(f.regle) + "</span>" : "<span class=\"alerte-texte\">" + echapper(f.regle) + "</span>";
      return "<tr><td class=\"mono\">" + heure(f.t, true) + "</td><td>" + echapper(f.src) + "</td><td>" + echapper(f.dst) + "</td><td class=\"mono\">" + f.proto + "/" + f.dport + "</td><td>" + echapper(f.quoi) + (f.livre ? "" : " <span class=\"alerte-texte\">(perdu)</span>") + "</td><td class=\"mono\">" + f.longueur + "</td><td>" + pf + "</td></tr>";
    }).join("");
    dessinerSchema();
  }

  function dessinerSchema() {
    var svg = $("schema"), S = TPMS.svgElement, u = etat.usine;
    svg.innerHTML = "";
    function zone(x, y, l, h, titre, sous, classe) {
      svg.appendChild(S("rect", { x: x, y: y, width: l, height: h, rx: 16, "class": "zone-schema " + classe }));
      svg.appendChild(S("text", { x: x + 16, y: y + 26, "class": "titre-zone" }, titre));
      svg.appendChild(S("text", { x: x + 16, y: y + 46, "class": "sous-zone" }, sous));
    }
    zone(20, 20, 300, 180, "VLAN 10 · atelier (OT)", "10.10.10.0/24", "ot");
    zone(640, 20, 300, 190, "VLAN 20 · serveurs", "10.10.20.0/24", "serveurs");
    zone(20, 250, 300, 150, "VLAN 30 · bureautique", "10.10.30.0/24", "bureau");
    zone(640, 250, 300, 150, "VLAN 40 · DMZ", "10.10.40.0/24 · accès distant (prévu)", "dmz");
    // Liens vers le pare-feu
    [[320, 110], [640, 110], [320, 325], [640, 325]].forEach(function (p) { svg.appendChild(S("line", { x1: p[0], y1: p[1], x2: 480, y2: 210, "class": "lien" })); });
    svg.appendChild(S("rect", { x: 420, y: 180, width: 120, height: 60, rx: 12, "class": "boite-pare-feu" }));
    svg.appendChild(S("text", { x: 480, y: 206, "class": "titre-zone centre" }, "Pare-feu"));
    svg.appendChild(S("text", { x: 480, y: 226, "class": "sous-zone centre" }, "nftables · .254"));
    Object.keys(POSITIONS_SCHEMA).forEach(function (id) {
      if (id === "pare-feu") return;
      var m = u.machines[id];
      if (id === "intrus" && !m.alimentee) return;
      var p = POSITIONS_SCHEMA[id], em = etatMachine(m);
      svg.appendChild(S("rect", { x: p[0] - 40, y: p[1] - 16, width: 80, height: 32, rx: 8, "class": "machine " + em.classe + (id === "intrus" ? " intrus" : "") }));
      svg.appendChild(S("text", { x: p[0], y: p[1] + 4, "class": "nom-machine" }, id.replace("passerelle-", "P").replace("supervision", "supervis.")));
    });
    // Paquets des 3 dernières secondes : un point qui avance sur son chemin.
    var phase = (performance.now() / 1000) % 1;
    u.flux.filter(function (f) { return f.t >= u.tMs - 3000; }).slice(-120).forEach(function (f, i) {
      var a = POSITIONS_SCHEMA[f.src], b = POSITIONS_SCHEMA[f.dst];
      if (!a || !b) return;
      var avance = (phase + i * 0.137) % 1, x, y, pf = POSITIONS_SCHEMA["pare-feu"];
      if (f.verdict === "direct") { x = a[0] + (b[0] - a[0]) * avance; y = a[1] + (b[1] - a[1]) * avance; }
      else if (f.verdict === "drop") { var k = Math.min(1, avance * 1.3); x = a[0] + (pf[0] - a[0]) * k; y = a[1] + (pf[1] - a[1]) * k; }
      else if (avance < 0.5) { x = a[0] + (pf[0] - a[0]) * avance * 2; y = a[1] + (pf[1] - a[1]) * avance * 2; }
      else { x = pf[0] + (b[0] - pf[0]) * (avance - 0.5) * 2; y = pf[1] + (b[1] - pf[1]) * (avance - 0.5) * 2; }
      svg.appendChild(S("circle", { cx: x, cy: y, r: f.verdict === "drop" ? 5 : 3.5, "class": "paquet " + (f.verdict === "drop" ? "refuse" : f.verdict === "direct" ? "direct" : "accepte") }));
    });
  }

  // -------------------------------------------------------------------
  // Courtier MQTT
  // -------------------------------------------------------------------
  function afficherMqtt() {
    var u = etat.usine, C = u.courtier, mc = u.machines.courtier, em = etatMachine(mc);
    $("puceCourtier").className = "puce " + em.classe; $("puceCourtier").textContent = em.texte;
    var ids = Object.keys(C.clients);
    $("corpsClients").innerHTML = ids.map(function (id) {
      var cl = C.clients[id], cert = TPMS.usineCertificat(u, cl.utilisateur);
      return "<tr><td class=\"mono\">" + echapper(id) + "</td><td>" + echapper(cl.utilisateur) + "<span class=\"raison\">" + echapper(cert.emetteur) + "</span></td><td class=\"mono\">" + cl.ip + "</td><td>" + depuis(u.tMs - cl.depuisMs) + "</td><td>il y a " + depuis(u.tMs - cl.dernierPaquetMs) + "</td>" +
        "<td>" + cl.publies + "</td><td class=\"" + (cl.refuses ? "alerte-texte" : "") + "\">" + cl.refuses + "</td><td>" + (cl.testament ? "oui" : "—") + "</td></tr>";
    }).join("") || "<tr><td colspan=\"8\">Aucun client connecté.</td></tr>";
    $("corpsPasserellesMqtt").innerHTML = E.passerelles.map(function (p) {
      var m = u.machines["passerelle-" + p.id], pa = m.passerelle;
      var cx = pa.connexion && pa.connexion.ouverte ? "<span class=\"puce ok\">ouverte</span>" : "<span class=\"puce alerte\">fermée</span>";
      var prochain = pa.connexion && pa.connexion.ouverte ? "—" : "dans " + depuis(pa.prochaineTentativeMs - u.tMs);
      return "<tr><td>P" + p.id + "</td><td>" + cx + "</td><td>" + pa.lotsEnAttente.length + "</td><td>" + pa.compteurs.lotsEnvoyes + "</td><td>" + pa.compteurs.lotsPerdus + "</td><td>" + pa.compteurs.tentatives + "</td><td>" + prochain + "</td></tr>";
    }).join("");
    var file = C.enAttente["serveur-supervision"] || [];
    $("mesuresMqtt").innerHTML = [["Messages reçus", C.messagesRecus], ["Refus ACL", C.refusAcl], ["Messages retenus", Object.keys(C.retenus).length],
      ["Gardés pour la supervision absente", file.length], ["Session de la supervision", sup().sessionPersistante ? "persistante" : "propre"]]
      .map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
    $("corpsRetenus").innerHTML = Object.keys(C.retenus).map(function (s) {
      return "<tr><td class=\"mono\">" + echapper(s) + "</td><td class=\"mono petit-texte\">" + echapper(C.retenus[s].slice(0, 90)) + "</td></tr>";
    }).join("") || "<tr><td colspan=\"2\">Aucun.</td></tr>";
    $("corpsCertificats").innerHTML = ["courtier", "supervision", "serveur-supervision", "passerelle-1", "passerelle-2", "passerelle-3", "passerelle-9"].map(function (n) {
      var c = TPMS.usineCertificat(u, n), pirate = c.emetteur !== "AC de l'usine";
      return "<tr><td class=\"mono\">" + n + "</td><td class=\"" + (pirate ? "alerte-texte" : "") + "\">" + echapper(c.emetteur) + "</td><td>" + jour(c.finMs) + "</td><td>" + (u.revocations[n] ? "<span class=\"alerte-texte\">révoqué</span>" : pirate ? "<span class=\"alerte-texte\">refusé (AC inconnue)</span>" : "valable") + "</td></tr>";
    }).join("");
    $("corpsAcl").innerHTML = TPMS.ACL_COURTIER.map(function (r) { return "<tr><td class=\"mono\">" + r.utilisateur + "</td><td>" + (r.acces === "read" ? "lecture" : "écriture") + "</td><td class=\"mono\">" + r.filtre + "</td></tr>"; }).join("") +
      "<tr><td colspan=\"3\" class=\"discret\">Tout le reste est interdit (pas de connexion anonyme, pas de port 1883).</td></tr>";
  }

  // -------------------------------------------------------------------
  // Heure et journaux
  // -------------------------------------------------------------------
  function afficherHeure() {
    var u = etat.usine;
    $("corpsHorloges").innerHTML = ["passerelle-1", "passerelle-2", "passerelle-3", "courtier", "supervision", "ntp", "syslog", "poste"].map(function (id) {
      var m = u.machines[id], h = m.horloge;
      var reglee = m.passerelle ? (h.dernierReglageMs ? "il y a " + depuis(u.tMs - h.dernierReglageMs) : "jamais") : "hôte réglé sur Internet";
      return "<tr><td>" + id + "</td><td class=\"mono\">" + heure(TPMS.usineHeure(u, id), true) + "," + String(((TPMS.usineHeure(u, id) % 1000) + 1000) % 1000).padStart(3, "0") + "</td>" +
        "<td class=\"mono " + (Math.abs(h.decalageMs) > 2000 ? "alerte-texte" : "") + "\">" + nombre(h.decalageMs, 1) + " ms</td><td>" + (h.derivePpm ? nombre(h.derivePpm, 1) + " ppm" : "—") + "</td>" +
        "<td>" + reglee + "</td><td class=\"mono\">" + (h.dernierEcartMs === null ? "—" : nombre(h.dernierEcartMs, 1) + " ms") + "</td></tr>";
    }).join("");
    function liste(id, lignes, formater) {
      $(id).innerHTML = lignes.slice(-80).reverse().map(formater).join("");
    }
    liste("journalCentral", u.journalCentral, function (l) { return "<li class=\"" + (l.gravite === "erreur" || l.gravite === "attention" ? "alerte" : "") + "\"><span class=\"heure\">" + heure(l.tMachine, true) + "</span><span><b>" + echapper(l.source) + "</b> " + echapper(l.texte) + "</span></li>"; });
    [["journalCourtier", u.journalCourtier], ["journalSupervision", u.journalSupervision], ["journalPareFeu", u.journalPareFeu]].forEach(function (j) {
      liste(j[0], j[1], function (l) { return "<li class=\"" + (l.gravite === "attention" ? "alerte" : "") + "\"><span class=\"heure\">" + heure(l.t, true) + "</span><span>" + echapper(l.texte) + "</span></li>"; });
    });
  }

  // -------------------------------------------------------------------
  // Attaques et pannes
  // -------------------------------------------------------------------
  function construireEssais() {
    var couches = [];
    TPMS.USINE_ESSAIS.forEach(function (d) { if (couches.indexOf(d.couche) < 0) couches.push(d.couche); });
    $("listeEssais").innerHTML = couches.map(function (couche) {
      return "<h4>" + couche + "</h4>" + TPMS.USINE_ESSAIS.filter(function (d) { return d.couche === couche; }).map(function (d) {
        return "<div class=\"essai\"><div><b>" + echapper(d.titre) + "</b><span class=\"raison\">attendu : " + echapper(d.attendu) + "</span></div>" +
          "<button type=\"button\" class=\"bouton petit-bouton\" data-essai=\"" + d.id + "\">Lancer</button></div>";
      }).join("");
    }).join("");
  }
  function afficherEssais() {
    var u = etat.usine;
    var faits = u.essais.filter(function (e) { return e.resultat; }), reussis = faits.filter(function (e) { return e.resultat.ok; }).length;
    $("puceEssais").className = "puce " + (faits.length && reussis === faits.length ? "ok" : faits.length ? "alerte" : "");
    $("puceEssais").textContent = faits.length ? reussis + " / " + faits.length + " conformes" + (etat.fileEssais.length ? " · " + etat.fileEssais.length + " en attente" : "") : "aucun essai";
    $("resultatsEssais").innerHTML = u.essais.map(function (e) {
      var r = e.resultat;
      var tete = r ? (r.ok ? "<span class=\"verdict-ok\">✔ conforme</span>" : "<span class=\"verdict-refus\">✘ inattendu</span>") : "<span class=\"attention-texte\">en cours (" + depuis(u.tMs - e.debutMs) + ")</span>";
      return "<li class=\"" + (r ? (r.ok ? "ok" : "alerte") : "") + "\"><span class=\"heure\">" + heure(e.debutMs, true) + "</span><span><b>" + echapper(e.def.titre) + "</b> · " + tete +
        "<span class=\"raison\">attendu : " + echapper(e.def.attendu) + "</span>" + (r ? "<span class=\"raison\">obtenu : " + echapper(r.obtenu) + "</span>" : "") + "</span></li>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Supervision
  // -------------------------------------------------------------------
  function afficherSupervision() {
    var u = etat.usine, s = sup(), vue = vueSup(), m = u.machines.supervision, em = etatMachine(m);
    $("puceSupervision").className = "puce " + em.classe; $("puceSupervision").textContent = em.texte;
    $("corpsSupervision").innerHTML = Object.keys(vue).map(function (id) {
      var ch = vue[id], zv = s.reception.zoneDe(id);
      return "<tr><td>" + id + "</td><td>" + (zv ? NOMS_ZONES[zv] : "–") + "</td>" + POS.map(function (p) {
        var pn = ch.pneus[p];
        return "<td class=\"pneu " + classeEtat(pn.etat) + "\">" + (pn.pression !== undefined ? nombre(pn.pression) : "–") + "</td>";
      }).join("") + "<td><span class=\"puce " + classePuce(ch.etat) + "\">" + TYPES[ch.etat] + "</span></td></tr>";
    }).join("");
    $("corpsSupPasserelles").innerHTML = Object.keys(s.passerelles).map(function (id) {
      var p = s.passerelles[id];
      return "<tr><td>P" + id + "</td><td><span class=\"puce " + (p.etat === "en ligne" ? "ok" : "alerte") + "\">" + echapper(p.etat) + "</span></td><td>" + (p.decalage_ntp_ms === null ? "–" : p.decalage_ntp_ms + " ms") + "</td><td>" + p.lots + "</td><td>il y a " + depuis(TPMS.usineHeure(u, "supervision") - p.t) + "</td></tr>";
    }).join("");
    var c = s.reception.compteurs;
    var lignes = [["Annonces acceptées", c.acceptees, ""], ["Doublons (2 passerelles)", c.doublons, ""], ["En retard (déjà plus récentes)", c.enRetard, ""],
      ["Capteurs inconnus", c.inconnues, "alerte"], ["Invraisemblables", c.invraisemblables, "alerte"], ["Trames invalides", c.invalides, "alerte"], ["Lots entiers refusés", c.lotsRefuses, "alerte"]];
    var max = Math.max.apply(null, lignes.map(function (l) { return l[1]; }).concat([1]));
    $("supCompteurs").innerHTML = lignes.map(function (l) {
      return "<div class=\"barre-ligne\"><span class=\"nom\">" + l[0] + "</span><span class=\"piste\"><span class=\"plein " + l[2] + "\" style=\"display:block;width:" + Math.max(l[1] ? 2 : 0, Math.round(l[1] / max * 100)) + "%\"></span></span><span class=\"val\">" + l[1] + "</span></div>";
    }).join("");
    $("supRefus").innerHTML = s.refus.slice(0, 10).map(function (r) {
      return "<tr><td>" + heure(r.t, true) + "</td><td class=\"mono\">" + echapper(r.ip) + "</td><td>" + echapper(r.motif) + "<span class=\"raison\">" + echapper(r.detail) + "</span></td></tr>";
    }).join("") || "<tr><td colspan=\"3\">Aucun refus.</td></tr>";
    $("supAlertes").innerHTML = s.alertes.slice(0, 40).map(function (a) {
      return "<li class=\"" + (classeEtat(a.type) === "urgent" ? "alerte" : "") + "\"><span class=\"heure\">" + heure(a.t) + "</span><span><b>" + a.chariot_id + "</b> · " + NOMS_POS[a.position] + " · " + TYPES[a.type] + (a.pression !== null && a.pression !== undefined ? " (" + nombre(a.pression) + " bar)" : "") + "</span></li>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Pages, événements, boucle
  // -------------------------------------------------------------------
  var AFFICHER = { accueil: afficherAccueil, chariots: afficherChariots, radio: afficherRadio, reseau: afficherReseau, mqtt: afficherMqtt,
    heure: afficherHeure, essais: afficherEssais, supervision: afficherSupervision };
  function afficher() { afficherHaut(); AFFICHER[etat.page](); }
  function ouvrirPage(id) {
    etat.page = id;
    document.querySelectorAll("#navigation button").forEach(function (b) { b.classList.toggle("actif", b.dataset.page === id); });
    document.querySelectorAll(".page").forEach(function (p) { p.hidden = p.id !== "page-" + id; });
    afficher();
  }
  function choisir(id) { etat.choisi = id; ouvrirPage("chariots"); }

  document.querySelectorAll("#navigation button").forEach(function (b) { b.addEventListener("click", function () { ouvrirPage(b.dataset.page); }); });
  $("plan").addEventListener("click", function (e) { var g = e.target.closest(".chariot-plan"); if (g) choisir(g.getAttribute("data-id")); });
  $("corpsPneus").addEventListener("click", function (e) { var tr = e.target.closest("tr"); if (tr && tr.dataset.id) { etat.choisi = tr.dataset.id; afficher(); } });
  $("btnPause").addEventListener("click", function () {
    etat.pause = !etat.pause;
    $("btnPause").classList.toggle("en-pause", etat.pause);
    $("btnPause").querySelector("use").setAttribute("href", etat.pause ? "#i-play" : "#i-pause");
  });
  document.querySelectorAll("#choixFacteur button").forEach(function (b) {
    b.addEventListener("click", function () {
      etat.facteur = Number(b.dataset.facteur);
      document.querySelectorAll("#choixFacteur button").forEach(function (x) { x.classList.toggle("actif", x === b); });
    });
  });
  $("btnHeure").addEventListener("click", function () { avancer(3600000); afficher(); });
  construireActionsChariot();
  $("actionsChariot").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var pos = $("selPneu").value, u = etat.usine, c = chariot(etat.choisi);
    if (b.dataset.act === "clou") TPMS.usineCrevaison(u, c.id, pos, "clou");
    else if (b.dataset.act === "valve") TPMS.usineCrevaison(u, c.id, pos, "valve");
    else if (b.dataset.act === "fuite") TPMS.pneuFuiteLente(c.pneus[pos], E.fuiteLenteMaxMm);
    else if (b.dataset.act === "capteur") TPMS.usineArracherCapteur(u, c.id, pos);
    afficher();
  });
  $("choixBrouilleur").addEventListener("click", function (e) {
    var b = e.target.closest("[data-brouilleur]");
    if (!b) return;
    TPMS.usineBrouiller(etat.usine, b.dataset.brouilleur ? { x: Number(b.dataset.brouilleur), y: 15, rayonM: 15 } : null);
    afficher();
  });
  $("corpsMachines").addEventListener("click", function (e) {
    var b = e.target.closest("[data-panne]");
    if (!b) return;
    var id = b.dataset.machine;
    if (id === "intrus" && b.dataset.panne === "rebrancher") { var m = etat.usine.machines.intrus; m.alimentee = true; m.cable = true; m.programme = true; }
    else TPMS.usinePanne(etat.usine, id, b.dataset.panne);
    afficher();
  });
  construireEssais();
  $("listeEssais").addEventListener("click", function (e) {
    var b = e.target.closest("[data-essai]");
    if (!b) return;
    etat.fileEssais.push(b.dataset.essai);
    enchainerEssais();
    afficher();
  });
  $("btnTousEssais").addEventListener("click", function () {
    TPMS.USINE_ESSAIS.forEach(function (d) { etat.fileEssais.push(d.id); });
    if (etat.facteur < 60) { etat.facteur = 60; document.querySelectorAll("#choixFacteur button").forEach(function (x) { x.classList.toggle("actif", x.dataset.facteur === "60"); }); }
    enchainerEssais();
    afficher();
  });
  $("infoGraine").textContent = "Graine " + graine + " · lundi 26/10/2026, 6 h";

  // Une heure de poste avant d'afficher : passerelles connectées, premières mesures.
  avancer(15 * 60000);
  afficher();
  setInterval(function () { if (!etat.pause) avancer(etat.facteur * 250); }, 250);
  setInterval(afficher, 500);
  // Le schéma du réseau s'anime plus souvent (paquets en mouvement).
  setInterval(function () { if (etat.page === "reseau") dessinerSchema(); }, 120);
})();
