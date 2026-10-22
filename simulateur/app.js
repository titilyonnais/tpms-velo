// =====================================================================
// app.js — Interface de la simulation
// ---------------------------------------------------------------------
// Ce fichier ne calcule rien de physique : il crée le monde (moteur.js),
// le fait avancer au rythme choisi, transmet les actions de
// l'utilisateur (toujours par TPMS.mondeAction, pour pouvoir rejouer)
// et affiche l'état du monde.
// =====================================================================
(function () {
  "use strict";

  var POSITIONS = ["AV", "AR"];
  var NOMS = { AV: "Avant", AR: "Arrière" };
  var NOMS_METEO = {
    printemps: "Printemps doux", ete_canicule: "Été, canicule",
    hiver_gel: "Hiver, gel", automne_pluie: "Automne pluvieux"
  };

  var m = null;                       // le monde simulé en cours
  var vue = {
    enPause: false, facteur: 1, roueGraphe: "AV", variable: "pressions", rayonRadio: 2.5,
    versionsRegistres: { AV: -1, AR: -1 }, schemaInsere: false,
    rssi: { AV: [], AR: [] }, derniereTrameVue: null, echanges: [], journal: [],
    vitesseReelle: 0
  };

  function $(id) { return document.getElementById(id); }
  function nombre(x, d) { return (x === null || x === undefined || isNaN(x)) ? "—" : x.toFixed(d).replace(".", ","); }
  function deuxChiffres(n) { return (n < 10 ? "0" : "") + n; }
  function heureTexte(h) {
    var s = Math.floor(h * 3600);
    return deuxChiffres(Math.floor(s / 3600) % 24) + ":" + deuxChiffres(Math.floor(s / 60) % 60) + ":" + deuxChiffres(s % 60);
  }
  function horodatage(tMs) {
    var h = m.heureDepartH + tMs / 3600000;
    return "J" + (Math.floor(h / 24) + 1) + " " + heureTexte(h % 24);
  }
  function lignesTableau(lignes) {
    return lignes.map(function (l) { return "<tr><td>" + l[0] + "</td><td>" + l[1] + "</td></tr>"; }).join("");
  }
  function action(a) { TPMS.mondeAction(m, a); }

  // -------------------------------------------------------------------
  // Création d'un monde
  // -------------------------------------------------------------------
  function optionsFormulaire() {
    return {
      graine: parseInt($("cfgGraine").value, 10) || 0,
      parcoursId: $("cfgParcours").value,
      meteo: $("cfgMeteo").value,
      heureDepartH: parseFloat($("cfgHeure").value) || 8,
      chambre: $("cfgChambre").value,
      pressionAVBar: parseFloat($("cfgPAV").value) || 2.2,
      pressionARBar: parseFloat($("cfgPAR").value) || 2.4,
      vehiculesVoisins: parseInt($("cfgVoisins").value, 10) || 0
    };
  }

  function installerMonde(nouveau) {
    m = nouveau;
    vue.versionsRegistres = { AV: -1, AR: -1 };
    vue.rssi = { AV: [], AR: [] };
    vue.echanges = [];
    vue.journal = [];
    $("carte")._cache = null;
    $("profil")._points = null;
    synchroniserReglages();
    $("txtParcours").textContent = m.parcours.nom + " · " + nombre(m.prep.longueurM / 1000, 1) + " km · D+ " +
      Math.round(m.prep.denivelePositifM || 0) + " m";
    $("txtEnvRadio").textContent = "environnement radio : " + m.parcours.environnementRadio;
    // L'app repart de zéro, comme un téléphone qui ne connaît pas encore ce boîtier.
    $("cadreApp").src = "../app/index.html?transport=simule";
    dessinerCanvas();
  }

  function nouvelleSimulation() {
    installerMonde(TPMS.creerMonde(optionsFormulaire()));
    action({ type: "partir", depuisDebut: true });
  }

  // -------------------------------------------------------------------
  // Boucle : le temps simulé avance, dans la limite du calcul possible
  // -------------------------------------------------------------------
  var dernierInstant = null;
  var dernierPanneaux = 0;
  var mesureVitesse = { reel: 0, simule: 0 };

  function boucle() {
    var maintenant = performance.now();
    if (dernierInstant !== null && !vue.enPause) {
      var dtReel = Math.min(maintenant - dernierInstant, 1000);
      var aFaire = dtReel * vue.facteur;
      var debut = performance.now();
      var fait = 0;
      // On avance par tranches et on s'arrête si le calcul prend trop de
      // temps : la page reste fluide, la simulation ralentit simplement.
      while (fait < aFaire && performance.now() - debut < 22) {
        var tranche = Math.min(aFaire - fait, 2000);
        TPMS.mondeAvancer(m, tranche);
        fait += tranche;
      }
      mesureVitesse.reel += dtReel;
      mesureVitesse.simule += fait;
      if (mesureVitesse.reel > 1000) {
        vue.vitesseReelle = mesureVitesse.simule / mesureVitesse.reel;
        mesureVitesse = { reel: 0, simule: 0 };
      }
    }
    dernierInstant = maintenant;
    afficherBanc();
    if (maintenant - dernierPanneaux > 200) {
      dernierPanneaux = maintenant;
      afficherPanneaux();
    }
  }

  // -------------------------------------------------------------------
  // Banc : boîtier, LED, buzzer, horloge
  // -------------------------------------------------------------------
  var ctx = $("ecran").getContext("2d");
  var image = ctx.createImageData(TPMS.ECRAN_LARGEUR, TPMS.ECRAN_HAUTEUR);

  function dessinerCanvas() {
    var pixels = m.boitier.ecranAffiche.pixels;
    for (var i = 0; i < pixels.length; i++) {
      var noir = pixels[i] === TPMS.NOIR;
      image.data[i * 4] = noir ? 0x1C : 0xDC;
      image.data[i * 4 + 1] = noir ? 0x1C : 0xDA;
      image.data[i * 4 + 2] = noir ? 0x1A : 0xD1;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function afficherBanc() {
    if (m.rafraichissementsEcran.length > 0) {
      var complet = m.rafraichissementsEcran.indexOf("complet") >= 0;
      m.rafraichissementsEcran.length = 0;
      dessinerCanvas();
      if (complet && vue.facteur <= 10) {
        var ecran = $("ecran");
        ecran.classList.remove("flash");
        void ecran.offsetWidth;
        ecran.classList.add("flash");
      }
    }
    if (m.bipsAJouer > 0) {
      m.bipsAJouer = 0;
      jouerBip();
    }
    var e = m.electronique || { courants: {} };
    var allumee = !m.boitierMort && (m.ledAlerte === "fixe" || (m.ledAlerte === "clignote" && (m.tMs % 1000) < 500));
    $("ledAlerte").className = "led led-alerte" + (allumee ? " fixe" : "");
    var eclairage = !m.boitierMort && m.boitier.eclairage && !m.boitier.veille;
    $("ledEclairageG").classList.toggle("on", eclairage);
    $("ledEclairageD").classList.toggle("on", eclairage);
    $("voyantRadio").classList.toggle("on", !m.boitierMort && TPMS.boitierEcoute(m.boitier, m.tMs));
    $("buzzer").classList.toggle("bip", m.tMs < m.bipJusquaMs);

    var h = TPMS.mondeHeure(m);
    $("horloge").textContent = heureTexte(h.heure);
    $("txtJour").textContent = "Jour " + (h.jour + 1);
    $("txtCharge").textContent = vue.enPause ? "en pause"
      : (vue.vitesseReelle > 0 && vue.vitesseReelle < vue.facteur * 0.9
        ? "calcul limité à ×" + Math.round(vue.vitesseReelle) : "");
  }

  function afficherReleveBanc() {
    var b = m.boitier;
    var mode = m.boitierMort ? "éteint (batterie vide)" : (b.veille ? "veille" : "en marche");
    var lignes = [
      ["Cycliste", m.enSortie ? (m.cycliste.etat || "roule") : "vélo garé"],
      ["Vitesse", nombre(m.velo.vitesseMs * 3.6, 1) + " km/h"],
      ["Pression réelle AV", nombre(m.pneus.AV.pressionRelBar, 2) + " bar"],
      ["Pression réelle AR", nombre(m.pneus.AR.pressionRelBar, 2) + " bar"],
      ["Boîtier", mode],
      ["Batterie", nombre(m.lipo.tensionV, 2) + " V · " + b.batteriePct + " %"],
      ["Courant", m.electronique ? nombre(m.electronique.courantBatterieA * 1000, 2) + " mA" : "—"],
      ["App", b.liaison.connecte ? "connectée" : (b.liaison.code ? "code affiché" : "—")],
      ["Pirate", m.pirate.actif ? (m.pirateMonde.brouillage ? "brouillage" : m.pirate.attaque) : "—"]
    ];
    $("releveBanc").innerHTML = lignes.map(function (l) { return "<dt>" + l[0] + "</dt><dd>" + l[1] + "</dd>"; }).join("");
  }

  // -------------------------------------------------------------------
  // Panneaux (5 fois par seconde, seulement la section ouverte)
  // -------------------------------------------------------------------
  function ouverte(id) { return !$(id).hidden; }

  function afficherPanneaux() {
    afficherReleveBanc();
    recupererJournal();
    if (ouverte("s1")) afficherSortie();
    if (ouverte("s2")) afficherPneus();
    if (ouverte("s3")) afficherRadio();
    if (ouverte("s4")) { afficherStats(); afficherJournal(); }
    if (ouverte("s5")) afficherElectronique();
    if (ouverte("s6")) afficherLiaison();
    if (ouverte("s7")) afficherCyber();
    if (ouverte("s8")) afficherDonnees();
  }

  // ---------- §1 Sortie ----------
  function afficherSortie() {
    TPMS.carteDessiner($("carte"), m);
    TPMS.profilDessiner($("profil"), m);
    var i = m.instant, p = m.point, c = m.commande || {};
    var lignes = [
      ["Heure", horodatage(m.tMs)],
      ["Température", nombre(i.temperatureC, 1) + " °C"],
      ["Soleil", Math.round(i.ensoleillement * 100) + " %"],
      ["Vent", nombre(i.ventMs * 3.6, 0) + " km/h · " + Math.round(i.ventDirDeg) + "°"],
      ["Pluie", i.pluie ? "oui" : "non"],
      ["Distance", nombre(m.velo.distanceM / 1000, 2) + " / " + nombre(m.prep.longueurM / 1000, 1) + " km"],
      ["Altitude", Math.round(p.altitudeM) + " m"],
      ["Pente", nombre(Math.tan(p.penteRad) * 100, 1) + " %"],
      ["Revêtement", p.revetement || "—"],
      ["Vitesse", nombre(m.velo.vitesseMs * 3.6, 1) + " km/h"],
      ["Puissance", Math.round(c.puissanceW || 0) + " W"],
      ["Cycliste", m.enSortie ? (m.cycliste.etat || "roule") : "garé"]
    ];
    $("mesuresSortie").innerHTML = lignes.map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
  }

  // ---------- §2 Pneus ----------
  function construirePneus() {
    var html = "";
    POSITIONS.forEach(function (pos) {
      html += '<div class="pneu-bloc" id="pneu' + pos + '">' +
        '<div class="capteur-tete"><h3>' + NOMS[pos] + '</h3><code id="adresse' + pos + '"></code></div>' +
        '<table class="tableau releve-table" id="tablePneu' + pos + '"></table>' +
        '<div class="actions">' +
        '<button type="button" class="bouton alerte" data-percer="1" data-forme="epine">Épine 1 mm</button>' +
        '<button type="button" class="bouton alerte" data-percer="2.5" data-forme="pincement">Pincement</button>' +
        '<button type="button" class="bouton alerte" data-percer="0.6" data-forme="valve">Valve</button>' +
        '<button type="button" class="bouton" data-fuite="0.04">Fuite lente</button>' +
        '<button type="button" class="bouton" data-reparer="1">Réparer</button>' +
        "</div>" +
        '<div class="actions">' +
        '<span class="duo">Gonfler à <input type="number" step="0.1" value="' + (pos === "AV" ? 2.2 : 2.4) + '" data-cible-gonflage> bar</span>' +
        '<button type="button" class="bouton" data-gonfler="1">Pomper</button>' +
        '<label class="case" style="margin-left:auto"><input type="checkbox" data-capteur checked> Capteur vissé</label>' +
        "</div></div>";
    });
    $("blocsPneus").innerHTML = html;
    POSITIONS.forEach(function (pos) {
      var bloc = $("pneu" + pos);
      bloc.querySelectorAll("[data-percer]").forEach(function (bt) {
        bt.addEventListener("click", function () {
          action({ type: "percer", roue: pos, diametreMm: parseFloat(bt.dataset.percer), forme: bt.dataset.forme });
        });
      });
      bloc.querySelector("[data-fuite]").addEventListener("click", function (e) {
        action({ type: "fuite", roue: pos, diametreMm: parseFloat(e.target.dataset.fuite) });
      });
      bloc.querySelector("[data-reparer]").addEventListener("click", function () { action({ type: "reparer", roue: pos }); });
      bloc.querySelector("[data-gonfler]").addEventListener("click", function () {
        action({ type: "gonfler", roue: pos, pressionBar: parseFloat(bloc.querySelector("[data-cible-gonflage]").value) });
      });
      bloc.querySelector("[data-capteur]").addEventListener("change", function (e) {
        action({ type: "capteur", roue: pos, present: e.target.checked });
      });
    });
  }

  function afficherPneus() {
    POSITIONS.forEach(function (pos) {
      var p = m.pneus[pos], c = m.capteurs[pos];
      $("adresse" + pos).textContent = m.boitier.reglages.appairage[pos];
      var fuites = (p.orifices || []).map(function (o) { return (o.type || "trou") + " " + nombre(o.diametreMm, 2) + " mm"; }).join(", ");
      $("tablePneu" + pos).innerHTML = lignesTableau([
        ["Pression relative (réelle)", "<b>" + nombre(p.pressionRelBar, 3) + " bar</b>"],
        ["Pression absolue", nombre(TPMS.pneuPressionAbsoluePa(p) / 1e5, 3) + " bar"],
        ["Air intérieur", nombre(p.temperatureAirC, 1) + " °C"],
        ["Orifices", fuites || "aucun"],
        ["Capteur", c.actif === false ? "muet" : "émet"],
        ["Température du capteur", nombre(c.temperatureCapteurC, 1) + " °C"],
        ["Pile CR1632", nombre(c.pileTensionV, 3) + " V · " + nombre(c.pileRestanteMAh, 1) + " mAh"],
        ["Boîtier affiche", m.boitier.roues[pos].mesure ? nombre(m.boitier.roues[pos].mesure.pressionBar, 2) + " bar · " + TPMS.texteEtat(m.boitier.roues[pos].etat) : "—"]
      ]);
    });
    var cle = vue.roueGraphe === "AV" ? ["pAV", "affAV"] : ["pAR", "affAR"];
    var points = derniersPoints(3 * 3600000);
    var seuil = m.boitier.reglages.seuils[vue.roueGraphe];
    TPMS.grapheLignes($("graphePneu"), {
      series: [
        { points: points.map(function (q) { return [q.tMs / 60000, q[cle[0]]]; }), classe: "s1" },
        { points: points.map(function (q) { return [q.tMs / 60000, q[cle[1]]]; }), classe: "s2" }
      ],
      reperes: [{ y: seuil.basBar, texte: "seuil bas", classe: "repere" }],
      pasY: 0.25,
      formatX: function (x) { return horodatage(x * 60000); }
    });
    afficherRegistres();
  }

  function derniersPoints(dureeMs) {
    var e = m.enregistrement, debut = m.tMs - dureeMs, i = e.length - 1;
    while (i > 0 && e[i - 1].tMs >= debut) i--;
    return e.slice(Math.max(0, i));
  }

  var CHAMPS = [
    { nom: "Fabricant", court: "fab.", debut: 0, fin: 2 },
    { nom: "N° capteur", court: "n°", debut: 2, fin: 3 },
    { nom: "Adresse", court: "adresse", debut: 3, fin: 8 },
    { nom: "Pression", court: "pression · Pa", debut: 8, fin: 12 },
    { nom: "Température", court: "temp. · c°C", debut: 12, fin: 16 },
    { nom: "Pile", court: "pile", debut: 16, fin: 17 },
    { nom: "Alarme", court: "al.", debut: 17, fin: 18 }
  ];

  function construireRegistres() {
    $("registres").innerHTML = POSITIONS.map(function (pos) {
      return '<div class="registre-bloc" id="registre' + pos + '"><div class="registre-tete"><b>Capteur ' +
        NOMS[pos].toLowerCase() + '</b><span>en attente…</span></div><div class="registre-defilement"><table class="registre"></table></div></div>';
    }).join("");
  }

  function afficherRegistres() {
    POSITIONS.forEach(function (pos) {
      var tr = null;
      for (var i = 0; i < m.trafic.length; i++) if (m.trafic[i].source === pos) { tr = m.trafic[i]; break; }
      if (!tr || vue.versionsRegistres[pos] === tr.tMs) return;
      vue.versionsRegistres[pos] = tr.tMs;
      var o = tr.octets, index = "", hexa = "", champs = "";
      for (var k = 0; k < o.length; k++) {
        var cl = k >= 8 && k < 12 ? ' class="champ-pression"' : "";
        index += "<td>" + k + "</td>";
        hexa += "<td" + cl + ">" + TPMS.octetEnHexa(o[k]) + "</td>";
      }
      CHAMPS.forEach(function (c) {
        champs += '<td colspan="' + (c.fin - c.debut) + '"' + (c.nom === "Pression" ? ' class="champ-pression"' : "") + ">" + c.court + "</td>";
      });
      var bloc = $("registre" + pos);
      bloc.querySelector(".registre-tete").innerHTML = "<b>Capteur " + NOMS[pos].toLowerCase() + "</b><span>" +
        horodatage(tr.tMs) + " · " + nombre(tr.pressionBar, 3) + " bar annoncés · " + Math.round(tr.rssiDbm) + " dBm · " + verdict(tr) + "</span>";
      bloc.querySelector(".registre").innerHTML = '<tr class="index">' + index + '</tr><tr class="hexa">' + hexa + '</tr><tr class="champs">' + champs + "</tr>";
    });
  }

  // ---------- §3 Radio ----------
  var RAISONS = {
    ok: ["ok", "reçue"], "hors-ecoute": ["non", "radio du boîtier coupée"], "trop-faible": ["non", "signal trop faible"],
    collision: ["rejet", "collision"], "erreur-paquet": ["rejet", "paquet corrompu"], brouillee: ["rejet", "brouillée"]
  };
  var VERDICTS = {
    acceptee: ["ok", "acceptée"], inconnue: ["non", "ignorée (inconnu)"], invalide: ["rejet", "rejetée (format)"],
    intrusion: ["rejet", "rejetée (signal suspect)"], suspecte: ["attente", "en attente de confirmation"],
    "hors-limites": ["rejet", "rejetée (hors limites)"], "radio-coupee": ["non", "radio coupée"]
  };

  function verdict(tr) {
    if (tr.raison !== "ok") {
      var r = RAISONS[tr.raison] || ["non", tr.raison];
      return '<span class="verdict ' + r[0] + '">perdue : ' + r[1] + "</span>";
    }
    if (tr.verdict === "acceptee" && tr.source === "pirate") return '<span class="verdict trompe">ACCEPTÉE — boîtier trompé</span>';
    var v = VERDICTS[tr.verdict] || ["non", tr.verdict];
    return '<span class="verdict ' + v[0] + '">' + v[1] + "</span>";
  }

  function nomSource(s) {
    if (s === "AV" || s === "AR") return "Capteur " + NOMS[s].toLowerCase();
    if (s === "pirate") return "Pirate";
    return "Vélo voisin";
  }

  function afficherRadio() {
    TPMS.vueRadioDessiner($("vueRadio"), m, vue.rayonRadio);
    var total = m.stats.emissions || 1;
    var lignes = [["Annonces émises (tous émetteurs)", m.stats.emissions]];
    Object.keys(RAISONS).forEach(function (r) {
      var n = m.stats.radio[r] || 0;
      lignes.push([RAISONS[r][1], n + " · " + nombre(100 * n / total, 1) + " %"]);
    });
    $("tableRadio").innerHTML = lignesTableau(lignes);
    // Historique RSSI des deux capteurs, à partir du trafic récent
    m.trafic.forEach(function (tr) {
      if ((tr.source === "AV" || tr.source === "AR") && (!vue.derniereTrameVue || tr.tMs > vue.derniereTrameVue)) {
        vue.rssi[tr.source].push([tr.tMs / 1000, tr.rssiDbm]);
        if (vue.rssi[tr.source].length > 300) vue.rssi[tr.source].shift();
      }
    });
    if (m.trafic.length) vue.derniereTrameVue = m.trafic[0].tMs;
    ["AV", "AR"].forEach(function (s) { vue.rssi[s].sort(function (a, b) { return a[0] - b[0]; }); });
    TPMS.grapheLignes($("grapheRssi"), {
      series: [{ points: vue.rssi.AV, classe: "s1 points" }, { points: vue.rssi.AR, classe: "s2 points" }],
      pasY: 10, yMin: -100, yMax: -30,
      reperes: [{ y: -95, texte: "sensibilité", classe: "repere" }],
      formatX: function (x) { return horodatage(x * 1000); },
      formatY: function (y) { return y + " dBm"; }
    });
    var html = "<tr><th>Heure</th><th>Émetteur</th><th>Annonce</th><th>RSSI</th><th>Canal</th><th>Devenir</th></tr>";
    m.trafic.slice(0, 18).forEach(function (tr) {
      html += "<tr" + (tr.source === "pirate" ? ' class="ligne-pirate"' : "") + "><td>" + horodatage(tr.tMs) + "</td><td>" + nomSource(tr.source) +
        '</td><td class="mono">' + nombre(tr.pressionBar, 2) + ' bar</td><td class="mono">' + Math.round(tr.rssiDbm) +
        ' dBm</td><td class="mono">' + (tr.canalBle || "—") + "</td><td>" + verdict(tr) + "</td></tr>";
    });
    $("tableTrafic").innerHTML = html;
  }

  // ---------- §4 Boîtier ----------
  function afficherStats() {
    var b = m.boitier, s = b.stats;
    function pente(pos) { var r = b.roues[pos]; return nombre(r.penteBarH, 3) + " bar/h · " + r.historique.tMs.length + " pts"; }
    $("tableStats").innerHTML = lignesTableau([
      ["Trames acceptées", s.tramesAcceptees],
      ["Trames ignorées (capteur inconnu)", s.tramesInconnues],
      ["Trames rejetées (vraisemblance)", s.rejetsVraisemblance],
      ["Trames rejetées (signal suspect)", s.rejetsRythme],
      ["Intrusions détectées", s.intrusions],
      ["Écran : rafraîchissements partiels", s.rafraichissementsPartiels],
      ["Écran : rafraîchissements complets", s.rafraichissementsComplets],
      ["Tendance avant", pente("AV")],
      ["Tendance arrière", pente("AR")],
      ["Tours de roue comptés", b.compteur.nbTours],
      ["Distance du trajet (boîtier)", nombre(TPMS.compteurDistanceKm(b.compteur), 3) + " km"],
      ["Distance réellement parcourue", nombre(m.velo.distanceM / 1000, 3) + " km"],
      ["Circonférence réglée / réelle", b.reglages.circonferenceMm + " / " +
        Math.round(2 * Math.PI * (m.velo.rayonRoulementAVM || m.velo.rayonRoueM) * 1000) + " mm"]
    ]);
  }

  var MOTS_ALERTE = /PERDU|CREVAISON|BASSE|HAUTE|FUITE|SUSPECT|faux|bloqué|refusés|vide/;
  function recupererJournal() {
    var b = m.boitier;
    while (b.journal.length > 0) vue.journal.unshift(b.journal.shift());
    if (vue.journal.length > 200) vue.journal.length = 200;
  }
  function afficherJournal() {
    $("journal").innerHTML = vue.journal.map(function (l) {
      return '<li><span class="heure">' + horodatage(l.tMs) + "</span><span" + (MOTS_ALERTE.test(l.texte) ? ' class="alerte"' : "") + ">" + l.texte + "</span></li>";
    }).join("");
  }

  function synchroniserReglages() {
    var r = m.boitier.reglages;
    $("seuilAVbas").value = r.seuils.AV.basBar;
    $("seuilAVhaut").value = r.seuils.AV.hautBar;
    $("seuilARbas").value = r.seuils.AR.basBar;
    $("seuilARhaut").value = r.seuils.AR.hautBar;
    ["selCirconference", "selVeille"].forEach(function (id) {
      var valeur = id === "selVeille" ? r.delaiVeilleMs : r.circonferenceMm;
      var sel = $(id);
      if (!sel.querySelector('option[value="' + valeur + '"]')) {
        var o = document.createElement("option");
        o.value = valeur;
        o.textContent = id === "selVeille" ? (valeur / 1000) + " s immobile" : "réglée par l'app — " + valeur + " mm";
        sel.appendChild(o);
      }
      sel.value = valeur;
    });
    $("selEcoute").value = r.ecouteFenetreMs + "/" + r.ecoutePeriodeMs;
    $("selPeriodeEcran").value = r.periodeEcranMs;
    ["listeBlanche", "vraisemblance", "rythme"].forEach(function (k) {
      var c = $("prot-" + k);
      if (c) c.checked = r.protections[k];
    });
  }

  // ---------- §5 Électronique ----------
  function afficherElectronique() {
    if (!vue.schemaInsere && TPMS.schemaSvg) {
      $("schemaZone").innerHTML = TPMS.schemaSvg();
      vue.schemaInsere = true;
    }
    var e = m.electronique;
    if (e && TPMS.schemaMettreAJour) TPMS.schemaMettreAJour($("schemaZone").querySelector("svg"), e);
    var l = m.lipo;
    var courantMa = e ? e.courantBatterieA * 1000 : 0;
    $("tableLipo").innerHTML = lignesTableau([
      ["État de charge (réel)", nombre(l.etatCharge * 100, 1) + " %"],
      ["Tension aux bornes", nombre(l.tensionV, 3) + " V"],
      ["Jauge du boîtier (par la tension)", m.boitier.batteriePct + " %"],
      ["Courant", (courantMa >= 0 ? "décharge " : "charge ") + nombre(Math.abs(courantMa), 3) + " mA"],
      ["Protection", l.coupee ? "<b>batterie coupée</b>" : "normale"],
      ["Recharge", m.vbusV > 0 ? "câble branché" : "—"]
    ]);
    var pts = derniersPoints(24 * 3600000);
    TPMS.grapheLignes($("grapheVbat"), {
      series: [{ points: pts.map(function (q) { return [q.tMs / 3600000, q.vbat]; }), classe: "s1" }],
      pasY: 0.1,
      reperes: [{ y: 3.0, texte: "coupure", classe: "repere" }],
      formatX: function (x) { return horodatage(x * 3600000); },
      formatY: function (y) { return nombre(y, 1) + " V"; }
    });
    if (e) {
      var lignes = Object.keys(e.courants || {}).map(function (k) { return [k, e.courants[k]]; })
        .filter(function (x) { return Math.abs(x[1]) > 1e-7; })
        .sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); })
        .map(function (x) { return [x[0], nombre(x[1] * 1000, 3) + " mA"]; });
      var tensions = Object.keys(e.tensions || {}).map(function (k) { return [k, nombre(e.tensions[k], 3) + " V"]; });
      $("tableCourants").innerHTML = lignesTableau(lignes.concat(tensions));
      $("alertesCircuit").textContent = (e.alertes || []).join(" · ");
    }
    afficherBilan();
  }

  var dernierProfil = "";
  function afficherBilan() {
    var r = m.boitier.reglages;
    function n(id) { var v = parseFloat($(id).value); return isNaN(v) ? 0 : v; }
    var profil = {
      heuresRoulage: n("pfRoulage"), sortiesParJour: n("pfSorties"), heuresEclairage: n("pfEclairage"),
      heuresApp: n("pfApp"), alertesParJour: n("pfAlertes"),
      fenetreMs: r.ecouteFenetreMs, periodeMs: r.ecoutePeriodeMs, periodeEcranMs: r.periodeEcranMs, delaiVeilleMs: r.delaiVeilleMs
    };
    var sig = JSON.stringify(profil);
    if (sig === dernierProfil) return;
    dernierProfil = sig;
    var bilan = TPMS.bilanJournee(profil);
    var svg = $("grapheBilan");
    svg.innerHTML = "";
    var X0 = 190, L = 640, D = 70, hL = 28, y0 = 14, max = 0;
    bilan.postes.forEach(function (p) { if (p.mAhJour > max) max = p.mAhJour; });
    bilan.postes.forEach(function (p, i) {
      var y = y0 + i * hL, w = Math.max(1, p.mAhJour * (L - X0 - D) / (max || 1));
      svg.appendChild(TPMS.svgElement("text", { x: X0 - 10, y: y + 13, "text-anchor": "end", class: "libelle" }, p.nom));
      svg.appendChild(TPMS.svgElement("rect", { x: X0, y: y + 3, width: w, height: 13, class: "barre" + (p.mAhJour === max ? " max" : "") }));
      svg.appendChild(TPMS.svgElement("text", { x: X0 + w + 6, y: y + 13, class: "valeur" }, nombre(p.mAhJour, p.mAhJour < 0.1 ? 3 : 2) + " mAh"));
    });
    var ok = bilan.autonomieJours >= 7;
    $("legendeBilan").innerHTML = "<b>Fig. 4</b> — Journée type : " + nombre(bilan.totalMAhJour, 2) + " mAh/jour → autonomie " +
      '<span class="resultat' + (ok ? "" : " insuffisant") + '">' + nombre(bilan.autonomieJours, 1) + " jours</span> (exigence : au moins 7 jours).";
  }

  // ---------- §6 Application ----------
  var cadreApp = $("cadreApp");
  function versApp(message) {
    message.tMs = m.tMs;
    if (cadreApp.contentWindow) cadreApp.contentWindow.postMessage(message, "*");
  }
  function noterEchange(sens, quoi, detail) {
    vue.echanges.unshift({ tMs: m.tMs, sens: sens, quoi: quoi, detail: detail });
    if (vue.echanges.length > 14) vue.echanges.pop();
  }

  // Notifications MESURES toutes les 5 s simulées, au plus 10 par seconde réelle.
  var notif = { prochaineMs: 0, derniereReelle: 0 };
  function notifierApp() {
    var b = m.boitier;
    if (b.liaison.connecte && (b.veille || m.boitierMort)) {
      TPMS.liaisonDeconnexion(b, m.tMs);
      versApp({ type: "deconnecte" });
      return;
    }
    if (!b.liaison.connecte || m.tMs < notif.prochaineMs) return;
    notif.prochaineMs = m.tMs + 5000;
    var maintenant = performance.now();
    if (maintenant - notif.derniereReelle < 100) return;
    notif.derniereReelle = maintenant;
    var octets = TPMS.liaisonMesures(b, m.tMs);
    noterEchange("boîtier → app", "MESURES", TPMS.trameEnHexa(octets));
    versApp({ type: "mesures", octets: Array.from(octets) });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== cadreApp.contentWindow) return;
    var msg = e.data, b = m.boitier, t = m.tMs, r, o;
    switch (msg.type) {
      case "connexion":
        r = (b.veille || m.boitierMort) ? "absent" : TPMS.liaisonConnexion(b, t);
        noterEchange("app → boîtier", "Connexion", r);
        versApp({ type: "connexion-resultat", resultat: r });
        notif.prochaineMs = t;
        break;
      case "code":
        r = TPMS.liaisonSaisirCode(b, msg.code, t);
        noterEchange("app → boîtier", "Appairage, code " + msg.code, r);
        versApp({ type: "code-resultat", resultat: r });
        notif.prochaineMs = t;
        break;
      case "lireReglages":
        o = TPMS.liaisonLireReglages(b);
        noterEchange("boîtier → app", "REGLAGES (lecture)", o ? TPMS.trameEnHexa(o) : "refusée");
        versApp({ type: "reglages", octets: o ? Array.from(o) : null });
        break;
      case "ecrireReglages":
        r = TPMS.liaisonEcrireReglages(b, new Uint8Array(msg.octets), t);
        noterEchange("app → boîtier", "REGLAGES (écriture)", TPMS.trameEnHexa(msg.octets) + " → " + r);
        versApp({ type: "ecriture-resultat", resultat: r });
        synchroniserReglages();
        break;
      case "commande":
        r = TPMS.liaisonCommande(b, msg.octet, t);
        noterEchange("app → boîtier", "COMMANDE", TPMS.octetEnHexa(msg.octet) + " → " + r);
        versApp({ type: "commande-resultat", resultat: r });
        break;
      case "deconnexion": TPMS.liaisonDeconnexion(b, t); break;
      case "oublier": TPMS.liaisonOublier(b, t); break;
    }
  });

  function afficherLiaison() {
    var l = m.boitier.liaison;
    $("tableLiaison").innerHTML = lignesTableau([
      ["Connexion", l.connecte ? "établie" : "aucune"],
      ["Téléphone appairé", l.appaire ? "oui (clé mémorisée)" : "non"],
      ["Chiffrement", l.connecte && l.appaire ? "AES-CCM · BLE Secure Connections" : "—"],
      ["Code affiché", l.code ? l.code + " · expire dans " + Math.max(0, Math.ceil((l.codeJusquaMs - m.tMs) / 1000)) + " s" : "—"],
      ["Notifications envoyées", l.sequence]
    ]);
    var html = "<tr><th>Heure</th><th>Sens</th><th>Caractéristique</th><th>Contenu</th></tr>";
    vue.echanges.forEach(function (x) {
      html += "<tr><td>" + horodatage(x.tMs) + "</td><td>" + x.sens + "</td><td>" + x.quoi + "</td><td>" + x.detail + "</td></tr>";
    });
    $("tableEchanges").innerHTML = html;
  }

  // ---------- §7 Cybersécurité ----------
  var PROTECTIONS = [
    { cle: "listeBlanche", nom: "Liste blanche", texte: "Seuls les deux capteurs appairés sont écoutés. Sans elle, le boîtier range les capteurs par numéro : le capteur n°1 d'un vélo voisin devient ta roue avant.", compteur: function (s) { return s.tramesInconnues + " ignorées"; } },
    { cle: "vraisemblance", nom: "Vraisemblance", texte: "Bornes physiques, et tout changement de plus de 0,3 bar/s doit être confirmé par 3 trames de suite. Seule, elle cède face à un pirate rapide.", compteur: function (s) { return s.rejetsVraisemblance + " rejetées"; } },
    { cle: "rythme", nom: "Rythme", texte: "Le vrai capteur émet toutes les 3 s. Des trames plus rapprochées sous la même adresse trahissent un second émetteur : « signal suspect » pendant 1 min.", compteur: function (s) { return s.intrusions + " intrusion" + (s.intrusions > 1 ? "s" : ""); } }
  ];

  function construireProtections() {
    $("protections").innerHTML = PROTECTIONS.map(function (p) {
      return '<label class="protection"><input type="checkbox" id="prot-' + p.cle + '" checked><b>' + p.nom +
        '</b><span class="compteur" id="compteur-' + p.cle + '"></span><p>' + p.texte + "</p></label>";
    }).join("");
    PROTECTIONS.forEach(function (p) {
      $("prot-" + p.cle).addEventListener("change", function (e) { action({ type: "protection", cle: p.cle, valeur: e.target.checked }); });
    });
  }

  function afficherCyber() {
    var b = m.boitier, p = m.pirate;
    PROTECTIONS.forEach(function (pr) { $("compteur-" + pr.cle).textContent = pr.compteur(b.stats); });
    $("txtEnregistrement").textContent = p.enregistrement.length + " / " + TPMS.PIRATE_TAILLE_ENREGISTREMENT + (p.enregistre ? " · écoute…" : "");
    var html = "<tr><th>Roue</th><th>Pression réelle</th><th>Retenue par le boîtier</th><th>État affiché</th><th>Bilan</th></tr>";
    POSITIONS.forEach(function (pos) {
      var reelle = m.pneus[pos].pressionRelBar, roue = b.roues[pos];
      var retenue = roue.mesure ? roue.mesure.pressionBar : null, bilan;
      if (roue.etat === TPMS.ETAT.INTRUSION) bilan = '<span class="verdict attente">attaque détectée, cycliste prévenu</span>';
      else if (retenue === null) bilan = '<span class="verdict non">pas de mesure</span>';
      else if (Math.abs(reelle - retenue) > 0.25) bilan = '<span class="verdict trompe">BOÎTIER TROMPÉ</span>';
      else bilan = '<span class="verdict ok">conforme</span>';
      html += "<tr><td>" + NOMS[pos] + '</td><td class="mono">' + nombre(reelle, 2) + ' bar</td><td class="mono">' +
        (retenue === null ? "—" : nombre(retenue, 2) + " bar") + "</td><td>" + TPMS.texteEtat(roue.etat) + "</td><td>" + bilan + "</td></tr>";
    });
    $("tableVerite").innerHTML = html;
  }

  function afficherFormulairePirate() {
    var attaque = m.pirateMonde.brouillage ? "brouillage" : m.pirate.attaque;
    $("ligneFaussePression").hidden = attaque !== "usurpation";
    $("ligneEnregistrement").hidden = attaque !== "rejeu";
    $("noteAttaque").textContent = {
      usurpation: "Usurpation : le pirate a relevé l'adresse du capteur visé en écoutant l'air, et diffuse des trames à son nom avec la pression de son choix.",
      rejeu: "Rejeu : le pirate renvoie à l'identique des trames enregistrées plus tôt (par exemple pneu gonflé, pour masquer une crevaison).",
      brouillage: "Brouillage : le pirate émet en continu sur les canaux d'annonce. Plus personne n'est reçu près de lui : le boîtier finit par signaler des capteurs perdus."
    }[attaque];
  }

  // ---------- §8 Données ----------
  function afficherDonnees() {
    var e = m.enregistrement;
    var X = function (q) { return q.tMs / 3600000; };
    var choix = {
      pressions: { s: [["pAV", "s1", "avant réelle"], ["pAR", "s2", "arrière réelle"], ["affAV", "s3", "avant affichée"]], pas: 0.25, u: " bar" },
      temperatures: { s: [["temperatureC", "s1", "air ambiant"], ["tAirAV", "s2", "air dans le pneu avant"]], pas: 5, u: " °C" },
      vitesse: { s: [["vitesseKmh", "s1", "vitesse"]], pas: 10, u: " km/h" },
      altitude: { s: [["altitudeM", "s1", "altitude"]], pas: 50, u: " m" },
      batterie: { s: [["vbat", "s1", "tension LiPo"]], pas: 0.1, u: " V" },
      piles: { s: [["pileAV", "s1", "pile capteur avant"], ["pileAR", "s2", "pile capteur arrière"]], pas: 0.1, u: " V" }
    }[vue.variable];
    TPMS.grapheLignes($("grapheDonnees"), {
      series: choix.s.map(function (c) { return { points: e.map(function (q) { return [X(q), q[c[0]]]; }), classe: c[1] }; }),
      pasY: choix.pas,
      formatX: function (x) { return horodatage(x * 3600000); },
      formatY: function (y) { return nombre(y, choix.pas < 1 ? 2 : 0) + choix.u; }
    });
    $("legendeDonnees").innerHTML = choix.s.map(function (c) { return '<span class="trait-serie ' + c[1] + '"></span>' + c[2]; }).join(" ");
    var min = { AV: Infinity, AR: Infinity }, vmax = 0, alertes = 0;
    e.forEach(function (q) {
      if (q.pAV < min.AV) min.AV = q.pAV;
      if (q.pAR < min.AR) min.AR = q.pAR;
      if (q.vitesseKmh > vmax) vmax = q.vitesseKmh;
    });
    vue.journal.forEach(function (l) { if (MOTS_ALERTE.test(l.texte)) alertes++; });
    $("tableResume").innerHTML = lignesTableau([
      ["Temps simulé", nombre(m.tMs / 3600000, 2) + " h"],
      ["Distance parcourue", nombre(m.velo.distanceM / 1000, 2) + " km"],
      ["Vitesse maximale", nombre(vmax, 1) + " km/h"],
      ["Pression minimale avant / arrière", nombre(min.AV, 2) + " / " + nombre(min.AR, 2) + " bar"],
      ["Messages d'alerte du boîtier", alertes],
      ["Annonces reçues / émises", m.stats.recues + " / " + m.stats.emissions],
      ["Batterie du boîtier consommée", nombre((1 - m.lipo.etatCharge) * TPMS.LIPO_MAH, 2) + " mAh"],
      ["Points enregistrés", e.length]
    ]);
    $("listeActions").innerHTML = m.actions.map(function (a) {
      return '<li><span class="heure">' + horodatage(a.tMs) + "</span><span>" + JSON.stringify(a.action) + "</span></li>";
    }).reverse().join("");
  }

  function telecharger(nom, contenu, type) {
    var lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([contenu], { type: type }));
    lien.download = nom;
    lien.click();
    setTimeout(function () { URL.revokeObjectURL(lien.href); }, 1000);
  }

  // -------------------------------------------------------------------
  // Buzzer (son)
  // -------------------------------------------------------------------
  var audio = null;
  document.addEventListener("pointerdown", function () {
    if (!audio && (window.AudioContext || window.webkitAudioContext)) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio && audio.state === "suspended") audio.resume();
  });
  function jouerBip() {
    if (!audio || !$("chkSon").checked || vue.facteur > 60) return;
    var t0 = audio.currentTime;
    for (var i = 0; i < 3; i++) {
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = "square"; o.frequency.value = 2700; g.gain.value = 0.04;
      o.connect(g); g.connect(audio.destination);
      o.start(t0 + i * 0.25); o.stop(t0 + i * 0.25 + 0.12);
    }
  }

  // -------------------------------------------------------------------
  // Branchement des commandes
  // -------------------------------------------------------------------
  function segments(conteneur, rappel) {
    var boutons = conteneur.querySelectorAll("button");
    boutons.forEach(function (bt) {
      bt.addEventListener("click", function () {
        boutons.forEach(function (x) { x.classList.toggle("actif", x === bt); });
        rappel(bt);
      });
    });
  }

  function brancherBoutonPhysique(id, numero) {
    var bt = $(id), debut = 0;
    bt.addEventListener("pointerdown", function () { debut = performance.now(); bt.classList.add("appui"); m.boutons[numero] = true; });
    bt.addEventListener("pointerup", function () {
      if (!debut) return;
      var long = performance.now() - debut >= 700;
      debut = 0;
      bt.classList.remove("appui");
      m.boutons[numero] = false;
      action({ type: "bouton", numero: numero, long: long });
    });
    bt.addEventListener("pointerleave", function () { debut = 0; bt.classList.remove("appui"); m.boutons[numero] = false; });
  }

  function brancher() {
    // Choix des parcours et des météos
    $("cfgParcours").innerHTML = TPMS.PARCOURS.map(function (p) { return '<option value="' + p.id + '">' + p.nom + "</option>"; }).join("");
    $("cfgMeteo").innerHTML = Object.keys(TPMS.METEOS).map(function (k) { return '<option value="' + k + '">' + (NOMS_METEO[k] || k) + "</option>"; }).join("");
    // Changer de parcours propose la pression conseillée pour ce type de vélo.
    $("cfgParcours").addEventListener("change", function () {
      var p = TPMS.parcoursParId($("cfgParcours").value);
      var type = p.type === "route" ? "route" : (p.type === "vtt" ? "vtt" : "ville");
      var nominale = TPMS.creerVelo({ type: type, graine: 1 }).pressionNominaleBar;
      $("cfgPAV").value = (Math.round(nominale * 10) / 10).toFixed(1);
      $("cfgPAR").value = (Math.round((nominale + 0.2) * 10) / 10).toFixed(1);
    });

    $("btnPause").addEventListener("click", function () {
      vue.enPause = !vue.enPause;
      $("btnPause").textContent = vue.enPause ? "Reprendre" : "Pause";
      $("btnPause").classList.toggle("actif", vue.enPause);
    });
    segments($("choixFacteur"), function (bt) { vue.facteur = parseInt(bt.dataset.facteur, 10); });

    var sections = document.querySelectorAll("#sections button");
    function ouvrir(id) {
      sections.forEach(function (s) { s.classList.toggle("actif", s.dataset.section === id); });
      document.querySelectorAll(".section").forEach(function (s) { s.hidden = s.id !== id; });
      try { localStorage.setItem("tpms-sim-section", id); } catch (e) { /* sans importance */ }
      afficherPanneaux();
    }
    sections.forEach(function (s) { s.addEventListener("click", function () { ouvrir(s.dataset.section); }); });
    try { var memo = localStorage.getItem("tpms-sim-section"); if (memo && $(memo)) ouvrir(memo); } catch (e) { /* rien */ }

    // §1
    $("btnNouveau").addEventListener("click", nouvelleSimulation);
    $("btnPartir").addEventListener("click", function () { action({ type: "partir" }); });
    $("btnGarer").addEventListener("click", function () { action({ type: "garer" }); });

    // §2
    segments($("choixRouePneu"), function (bt) { vue.roueGraphe = bt.dataset.roue; });
    segments($("choixZoomRadio"), function (bt) { vue.rayonRadio = parseFloat(bt.dataset.rayon); });

    // §4
    brancherBoutonPhysique("bouton1", 1);
    brancherBoutonPhysique("bouton2", 2);
    $("selCirconference").addEventListener("change", function (e) { action({ type: "reglage", cle: "circonferenceMm", valeur: parseInt(e.target.value, 10) }); });
    [["seuilAVbas", "AV", "basBar"], ["seuilAVhaut", "AV", "hautBar"], ["seuilARbas", "AR", "basBar"], ["seuilARhaut", "AR", "hautBar"]].forEach(function (s) {
      $(s[0]).addEventListener("change", function (e) {
        var v = parseFloat(e.target.value);
        if (!isNaN(v)) action({ type: "reglage", cle: "seuil", valeur: { roue: s[1], borne: s[2], bar: v } });
      });
    });
    $("selEcoute").addEventListener("change", function (e) { action({ type: "reglage", cle: "ecoute", valeur: e.target.value.split("/").map(Number) }); });
    $("selPeriodeEcran").addEventListener("change", function (e) { action({ type: "reglage", cle: "periodeEcranMs", valeur: parseInt(e.target.value, 10) }); });
    $("selVeille").addEventListener("change", function (e) { action({ type: "reglage", cle: "delaiVeilleMs", valeur: parseInt(e.target.value, 10) }); });

    // §5
    $("chkRecharge").addEventListener("change", function (e) { action({ type: "recharge", branche: e.target.checked }); });

    // §6
    $("btnOublierTel").addEventListener("click", function () { TPMS.liaisonOublier(m.boitier, m.tMs); versApp({ type: "deconnecte" }); });

    // §7
    $("chkPirate").addEventListener("change", function (e) { action({ type: "pirate", pirate: { actif: e.target.checked } }); });
    segments($("choixCible"), function (bt) { action({ type: "pirate", pirate: { cible: bt.dataset.cible, enregistrement: [] } }); });
    segments($("choixAttaque"), function (bt) {
      var a = bt.dataset.attaque;
      action({ type: "pirate", pirate: a === "brouillage" ? {} : { attaque: a }, monde: { brouillage: a === "brouillage" } });
      afficherFormulairePirate();
    });
    segments($("choixPosition"), function (bt) { action({ type: "pirate", monde: { suit: bt.dataset.suit === "1" } }); });
    segments($("choixCadence"), function (bt) { action({ type: "pirate", pirate: { intervalleMs: parseInt(bt.dataset.cadence, 10) } }); });
    $("curDistancePirate").addEventListener("change", function (e) { action({ type: "pirate", monde: { distanceM: parseFloat(e.target.value) } }); });
    $("curDistancePirate").addEventListener("input", function (e) { $("txtDistancePirate").textContent = e.target.value + " m"; });
    $("curPuissancePirate").addEventListener("change", function (e) { action({ type: "pirate", monde: { puissanceDbm: parseFloat(e.target.value) } }); });
    $("curPuissancePirate").addEventListener("input", function (e) { var v = parseFloat(e.target.value); $("txtPuissancePirate").textContent = (v > 0 ? "+" : "") + v + " dBm"; });
    $("curFaussePression").addEventListener("change", function (e) { action({ type: "pirate", pirate: { pressionFausseBar: parseFloat(e.target.value) } }); });
    $("curFaussePression").addEventListener("input", function (e) { $("txtFaussePression").textContent = nombre(parseFloat(e.target.value), 2) + " bar"; });
    $("btnEnregistrer").addEventListener("click", function () { action({ type: "pirate", enregistrer: true }); });

    // §8
    segments($("choixVariable"), function (bt) { vue.variable = bt.dataset.variable; });
    $("btnCsv").addEventListener("click", function () { telecharger("simulation-tpms.csv", TPMS.mondeExportCsv(m), "text/csv"); });
    $("btnSauver").addEventListener("click", function () {
      telecharger("scenario-tpms.json", JSON.stringify({ options: m.options, actions: m.actions }, null, 1), "application/json");
    });
    $("fichierScenario").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (!f) return;
      f.text().then(function (texte) {
        var s = JSON.parse(texte);
        installerMonde(TPMS.mondeRejeu({ options: s.options, actions: s.actions }));
      });
    });
    $("btnRejouer").addEventListener("click", function () { installerMonde(TPMS.mondeRejeu(m)); });
  }

  // -------------------------------------------------------------------
  // Démarrage
  // -------------------------------------------------------------------
  brancher();
  construirePneus();
  construireRegistres();
  construireProtections();
  nouvelleSimulation();
  afficherFormulairePirate();
  setInterval(function () { boucle(); notifierApp(); }, 33);
})();
