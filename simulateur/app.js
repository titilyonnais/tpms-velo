// =====================================================================
// app.js — Interface de la simulation (tableau de bord)
// ---------------------------------------------------------------------
// Ce fichier ne calcule rien de physique : il crée le monde (moteur.js),
// le fait avancer au rythme choisi, transmet les actions de
// l'utilisateur (toujours par TPMS.mondeAction, pour pouvoir rejouer)
// et affiche l'état du monde.
// =====================================================================
(function () {
  "use strict";

  var POSITIONS = ["AV", "AR"];
  var NOMS = { AV: "avant", AR: "arrière" };
  var NOMS_METEO = {
    printemps: "Printemps doux", ete_canicule: "Été, canicule",
    hiver_gel: "Hiver, gel", automne_pluie: "Automne pluvieux"
  };
  var ETATS_CYCLISTE = {
    roule: ["Roule", "ok"], feu: ["Feu rouge", "attention"], arret: ["Arrêté", ""],
    fini: ["Arrivé", "accent"], crevaison: ["Crevé", "alerte"]
  };

  var m = null;
  var vue = {
    page: "accueil", enPause: false, facteur: 1, roueGraphe: "AV", variable: "pressions",
    rayonRadio: 2.5, versionsRegistres: { AV: -1, AR: -1 }, schemaInsere: false,
    rssi: { AV: [], AR: [] }, derniereTrameVue: null, echanges: [], journal: [],
    vitesseReelle: 0, dernierToast: -Infinity
  };

  function $(id) { return document.getElementById(id); }
  function nombre(x, d) { return (x === null || x === undefined || isNaN(x)) ? "–" : x.toFixed(d).replace(".", ","); }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function heureTexte(h) {
    var s = Math.floor(h * 3600);
    return deux(Math.floor(s / 3600) % 24) + ":" + deux(Math.floor(s / 60) % 60) + ":" + deux(s % 60);
  }
  function horodatage(tMs) {
    var h = m.heureDepartH + tMs / 3600000;
    return "J" + (Math.floor(h / 24) + 1) + " " + heureTexte(h % 24).slice(0, 5);
  }
  function mesures(lignes) {
    return lignes.map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
  }
  function puce(el, texte, classe) {
    el.textContent = texte || "";
    el.className = "puce" + (classe ? " " + classe : "");
  }
  function action(a) { TPMS.mondeAction(m, a); }
  // « PRESSION BASSE » → « Pression basse » ; « OK » reste « OK ».
  function texteEtatCourt(etat) {
    if (etat === "OK") return "OK";
    if (etat === "ATTENTE") return "En attente";
    var t = TPMS.texteEtat(etat).toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // -------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------
  function notifier(titre, texte, classe) {
    var maintenant = performance.now();
    if (maintenant - vue.dernierToast < 700 && classe !== "alerte") return;   // pas d'avalanche
    vue.dernierToast = maintenant;
    var zone = $("toasts");
    var t = document.createElement("div");
    t.className = "toast " + (classe || "");
    t.innerHTML = "<div><b>" + titre + "</b>" + (texte || "") + "</div>";
    zone.appendChild(t);
    while (zone.children.length > 3) zone.removeChild(zone.firstChild);
    setTimeout(function () {
      t.classList.add("sortie");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 5000);
  }

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
      vehiculesVoisins: parseInt($("cfgVoisins").value, 10) || 0,
      plageCapteurBar: parseFloat($("cfgPlage").value) || 3.5
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
    $("titreCarte").textContent = m.parcours.nom;
    $("infoMonde").innerHTML = m.parcours.nom + "<br>" + (NOMS_METEO[m.options.meteo] || "") + " · graine " + m.graine;
    $("cadreApp").src = "../app/index.html?transport=simule";
    dessinerCanvas();
  }

  function nouvelleSimulation() {
    installerMonde(TPMS.creerMonde(optionsFormulaire()));
  }

  // -------------------------------------------------------------------
  // Boucle
  // -------------------------------------------------------------------
  var dernierInstant = null, dernierPanneaux = 0, mesureVitesse = { reel: 0, simule: 0 };

  function boucle() {
    var maintenant = performance.now();
    if (dernierInstant !== null && !vue.enPause) {
      var dtReel = Math.min(maintenant - dernierInstant, 1000);
      var aFaire = dtReel * vue.facteur, debut = performance.now(), fait = 0;
      // On avance par tranches et on s'arrête si le calcul devient trop long :
      // la page reste fluide, la simulation ralentit simplement.
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
    afficherBoitier();
    notifierApp();
    if (maintenant - dernierPanneaux > 200) {
      dernierPanneaux = maintenant;
      recupererJournal();
      afficherEtatGlobal();
      if (vue.page === "accueil") afficherAccueil();
      else if (vue.page === "config") afficherConfig();
      else if (vue.page === "pneus") afficherPneus();
      else if (vue.page === "radio") afficherRadio();
      else if (vue.page === "elec") afficherElectronique();
      else if (vue.page === "app") afficherLiaison();
      else if (vue.page === "donnees") afficherDonnees();
    }
  }

  // -------------------------------------------------------------------
  // Barre du haut : ce qui se passe, en une phrase
  // -------------------------------------------------------------------
  function alertesEnCours() {
    return POSITIONS.filter(function (p) { return TPMS.estAlerte(m.boitier.roues[p].etat); });
  }

  function afficherEtatGlobal() {
    var b = m.boitier, classe, titre, detail;
    var alertes = alertesEnCours();
    var avance = nombre(m.velo.distanceM / 1000, 1) + " / " + nombre(m.prep.longueurM / 1000, 1) + " km";
    if (m.boitierMort) {
      classe = "alerte"; titre = "Batterie du boîtier vide";
      detail = "Le boîtier est éteint. Branche le chargeur dans la tuile Batterie.";
    } else if (alertes.length) {
      var p = alertes[0];
      classe = "alerte";
      titre = "Alerte pneu " + NOMS[p] + " : " + TPMS.texteEtat(b.roues[p].etat).toLowerCase();
      detail = b.roues[p].etat === "INTRUSION"
        ? "Deux émetteurs utilisent l'adresse du capteur : le boîtier se méfie et prévient."
        : "Le boîtier bipe et sa LED clignote. Regonfle ou répare le pneu, ou appuie longtemps sur le bouton 2 pour acquitter.";
    } else if (m.pirate.actif) {
      classe = "attention"; titre = "Attaque pirate en cours";
      detail = "Le boîtier ne l'a pas encore repérée. Regarde la page Radio et sécurité.";
    } else if (m.enSortie) {
      classe = "ok"; titre = "Sortie en cours · tout va bien";
      detail = m.parcours.nom + " · " + avance;
    } else if (b.veille) {
      classe = "repos"; titre = "Vélo garé · boîtier en veille";
      detail = "Démarre une sortie pour le réveiller.";
    } else {
      classe = "repos"; titre = m.cycliste.etat === "fini" ? "Sortie terminée" : "Prêt à partir";
      detail = m.parcours.nom + " · " + avance;
    }
    $("etatGlobal").className = "etat-global " + classe;
    $("etatTitre").textContent = titre;
    $("etatDetail").textContent = detail;
    var h = TPMS.mondeHeure(m);
    $("txtJour").textContent = "Jour " + (h.jour + 1);
    $("txtCharge").textContent = (!vue.enPause && vue.vitesseReelle > 0 && vue.vitesseReelle < vue.facteur * 0.9)
      ? "calcul limité à ×" + Math.round(vue.vitesseReelle) : "";
  }

  // -------------------------------------------------------------------
  // Boîtier (écran, LED, buzzer)
  // -------------------------------------------------------------------
  var ctx = $("ecran").getContext("2d");
  var image = ctx.createImageData(TPMS.ECRAN_LARGEUR, TPMS.ECRAN_HAUTEUR);

  function dessinerCanvas() {
    var pixels = m.boitier.ecranAffiche.pixels;
    for (var i = 0; i < pixels.length; i++) {
      var noir = pixels[i] === TPMS.NOIR;
      image.data[i * 4] = noir ? 0x1C : 0xD9;
      image.data[i * 4 + 1] = noir ? 0x1C : 0xD7;
      image.data[i * 4 + 2] = noir ? 0x1F : 0xCF;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function afficherBoitier() {
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
    if (m.bipsAJouer > 0) { m.bipsAJouer = 0; jouerBip(); }
    var allumee = !m.boitierMort && (m.ledAlerte === "fixe" || (m.ledAlerte === "clignote" && (m.tMs % 1000) < 500));
    $("ledAlerte").className = "led led-alerte" + (allumee ? " fixe" : "");
    var eclairage = !m.boitierMort && m.boitier.eclairage && !m.boitier.veille;
    $("ledEclairageG").classList.toggle("on", eclairage);
    $("ledEclairageD").classList.toggle("on", eclairage);
    $("voyantRadio").classList.toggle("on", !m.boitierMort && TPMS.boitierEcoute(m.boitier, m.tMs));
    $("buzzer").classList.toggle("bip", m.tMs < m.bipJusquaMs);
    $("horloge").textContent = heureTexte(TPMS.mondeHeure(m).heure);
  }

  // -------------------------------------------------------------------
  // Vue d'ensemble
  // -------------------------------------------------------------------
  function afficherAccueil() {
    var b = m.boitier;
    // Tuile d'action principale
    var fini = !m.enSortie && m.cycliste.etat === "fini";
    $("actionTitre").textContent = m.enSortie ? "Sortie en cours" : (fini ? "Sortie terminée" : "Prêt à partir");
    $("actionTexte").textContent = m.enSortie
      ? "Le cycliste roule sur « " + m.parcours.nom + " ». Essaie une crevaison ou une attaque pour voir le boîtier réagir."
      : (fini ? "Arrivée après " + nombre(m.velo.distanceM / 1000, 1) + " km. Tu peux repartir ou changer de parcours."
        : m.parcours.nom + " · " + nombre(m.prep.longueurM / 1000, 1) + " km · " + Math.round(m.prep.denivelePositifM || 0) + " m de dénivelé.");
    var btn = $("btnSortie");
    btn.textContent = m.enSortie ? "Arrêter et garer le vélo" : (fini ? "Repartir du début" : "Démarrer la sortie");
    btn.classList.toggle("principal", !m.enSortie);

    // Pneus
    document.querySelectorAll(".tuile-pneu").forEach(function (tuile) {
      var pos = tuile.dataset.roue, p = m.pneus[pos], roue = b.roues[pos], c = m.capteurs[pos];
      var alerte = TPMS.estAlerte(roue.etat);
      tuile.classList.toggle("alerte", alerte);
      tuile.querySelector("[data-pression]").textContent = nombre(p.pressionRelBar, 2);
      var affiche = roue.mesure && roue.etat !== "INTRUSION" ? nombre(roue.mesure.pressionBar, 2) + " bar" : "–";
      tuile.querySelector("[data-sous-titre]").textContent = roue.etat === "ATTENTE"
        ? "Le boîtier attend la 1re annonce du capteur (jusqu'à 1 min vélo à l'arrêt)."
        : "Boîtier : " + affiche + " · air " + nombre(p.temperatureAirC, 0) + " °C · pile " + nombre(c.pileTensionV, 2) + " V";
      var etat = roue.etat;
      puce(tuile.querySelector("[data-etat]"),
        texteEtatCourt(etat),
        etat === "OK" ? "ok" : (etat === "ATTENTE" ? "" : "alerte"));
      miniGraphe(tuile.querySelector("[data-graphe]"), pos);
    });

    // Vélo
    $("valVitesse").textContent = nombre(m.velo.vitesseMs * 3.6, 1);
    var ec = m.enSortie ? (ETATS_CYCLISTE[m.cycliste.etat] || ["Roule", "ok"]) : ["Garé", ""];
    if (!m.enSortie && m.cycliste.etat === "fini") ec = ETATS_CYCLISTE.fini;
    puce($("puceCycliste"), ec[0], ec[1]);
    var fraction = m.parcours.boucle ? ((m.velo.distanceM - (m.departSortieM || 0)) / m.prep.longueurM) : m.velo.distanceM / m.prep.longueurM;
    $("barreParcours").style.width = Math.max(0, Math.min(100, fraction * 100)) + "%";
    $("txtParcoursAvance").textContent = nombre(m.velo.distanceM / 1000, 2) + " km parcourus sur " + nombre(m.prep.longueurM / 1000, 1);
    var i = m.instant, c = m.commande || {};
    $("mesuresVelo").innerHTML = mesures([
      ["Altitude", Math.round(m.point.altitudeM) + " m"],
      ["Pente", nombre(Math.tan(m.point.penteRad) * 100, 1) + " %"],
      ["Puissance", Math.round(c.puissanceW || 0) + " W"],
      ["Air", nombre(i.temperatureC, 1) + " °C"],
      ["Vent", nombre(i.ventMs * 3.6, 0) + " km/h"],
      ["Sol", m.point.revetement || "–"]
    ]);

    // Boîtier
    puce($("puceBoitier"), m.boitierMort ? "Éteint" : (b.veille ? "Veille" : "En marche"),
      m.boitierMort ? "alerte" : (b.veille ? "" : "ok"));

    // Carte
    TPMS.carteDessiner($("carte"), m);
    TPMS.profilDessiner($("profil"), m);

    afficherJaugeBatterie();
    afficherSecuriteAccueil();
    $("evenementsAccueil").innerHTML = lignesJournal(8);
  }

  // Petite courbe des 30 dernières minutes, avec le seuil bas.
  function miniGraphe(svg, pos) {
    var pts = derniersPoints(30 * 60000), cle = pos === "AV" ? "pAV" : "pAR";
    var seuil = m.boitier.reglages.seuils[pos].basBar;
    if (pts.length < 2) { svg.innerHTML = ""; return; }
    var vals = pts.map(function (q) { return q[cle]; }).concat([seuil]);
    var min = Math.min.apply(null, vals) - 0.1, max = Math.max.apply(null, vals) + 0.1;
    var t0 = pts[0].tMs, t1 = pts[pts.length - 1].tMs || t0 + 1;
    function X(t) { return (t - t0) / Math.max(1, t1 - t0) * 300; }
    function Y(v) { return 56 - (v - min) / (max - min) * 52; }
    var pas = Math.max(1, Math.floor(pts.length / 150));
    var d = "";
    for (var k = 0; k < pts.length; k += pas) d += (k ? "L" : "M") + X(pts[k].tMs).toFixed(1) + " " + Y(pts[k][cle]).toFixed(1);
    svg.innerHTML = '<line class="seuil" x1="0" x2="300" y1="' + Y(seuil).toFixed(1) + '" y2="' + Y(seuil).toFixed(1) + '"/>' +
      '<path class="aire" d="' + d + " L300 60 L0 60 Z" + '"/><path class="serie" d="' + d + '"/>';
  }

  function afficherJaugeBatterie() {
    var b = m.boitier, pct = b.batteriePct / 100, longueur = 2 * Math.PI * 50;
    var arc = $("jaugeArc");
    arc.style.strokeDasharray = longueur;
    arc.style.strokeDashoffset = longueur * (1 - pct);
    arc.style.stroke = pct > 0.3 ? "var(--ok)" : (pct > 0.15 ? "var(--attention)" : "var(--alerte)");
    $("jaugeTexte").textContent = b.batteriePct + " %";
    $("jaugeSous").textContent = nombre(m.lipo.tensionV, 2) + " V";
    var courantMa = m.electronique ? m.electronique.courantBatterieA * 1000 : 0;
    var heures = m.tMs / 3600000;
    var moyenMa = heures > 0.05 ? ((1 - m.lipo.etatCharge) * TPMS.LIPO_MAH) / heures : 0;
    $("mesuresBatterie").innerHTML = mesures([
      ["Courant", (courantMa < 0 ? "charge " : "") + nombre(Math.abs(courantMa), courantMa < 1 ? 3 : 1) + " mA"],
      ["Charge réelle", nombre(m.lipo.etatCharge * 100, 1) + " %"],
      ["Autonomie au rythme actuel", moyenMa > 0 ? nombre(TPMS.LIPO_MAH * TPMS.LIPO_UTILE / moyenMa / 24, 0) + " jours" : "–"]
    ]);
  }

  function afficherSecuriteAccueil() {
    var b = m.boitier, p = m.pirate;
    var detectee = POSITIONS.some(function (pos) { return b.roues[pos].etat === "INTRUSION"; });
    var trompe = POSITIONS.some(function (pos) {
      var r = b.roues[pos];
      return r.mesure && r.etat !== "INTRUSION" && Math.abs(r.mesure.pressionBar - m.pneus[pos].pressionRelBar) > 0.25;
    });
    if (!p.actif) { puce($("puceSecurite"), "Aucune attaque", "ok"); }
    else if (trompe) { puce($("puceSecurite"), "Boîtier trompé", "alerte"); }
    else if (detectee) { puce($("puceSecurite"), "Attaque repérée", "attention"); }
    else { puce($("puceSecurite"), "Attaque en cours", "attention"); }
    var actives = ["listeBlanche", "vraisemblance", "rythme"].filter(function (k) { return b.reglages.protections[k]; }).length;
    $("txtSecurite").textContent = actives + " protection" + (actives > 1 ? "s" : "") + " sur 3 active" + (actives > 1 ? "s" : "") +
      ". " + b.stats.intrusions + " intrusion" + (b.stats.intrusions > 1 ? "s" : "") + " repérée" + (b.stats.intrusions > 1 ? "s" : "") + " depuis le début.";
    $("chkPirateAccueil").checked = p.actif;
  }

  // -------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------
  function afficherConfig() {
    var reelle = Math.round(2 * Math.PI * (m.velo.rayonRoulementAVM || m.velo.rayonRoueM) * 1000);
    $("txtCirconferenceReelle").textContent = "Circonférence réelle de la roue simulée : " + reelle + " mm. Choisis la plus proche pour que la vitesse et la distance soient justes.";
  }

  // -------------------------------------------------------------------
  // Pneus
  // -------------------------------------------------------------------
  function construirePneus() {
    var html = POSITIONS.map(function (pos) {
      return '<article class="tuile large-6" id="detail' + pos + '">' +
        '<header><svg><use href="#i-pneu"/></svg><h3>Pneu ' + NOMS[pos] + '</h3><span class="puce" data-etat></span></header>' +
        '<div class="grand-chiffre"><span data-pression>–</span><small>bar réels</small></div>' +
        '<dl class="petites-mesures" data-mesures></dl>' +
        '<div class="groupe-actions"><h4>Provoquer</h4><div class="rangee">' +
        '<button type="button" class="bouton danger" data-percer="1" data-forme="epine">Épine 1 mm</button>' +
        '<button type="button" class="bouton danger" data-percer="2.5" data-forme="pincement">Pincement</button>' +
        '<button type="button" class="bouton danger" data-percer="0.6" data-forme="valve">Valve</button>' +
        '<button type="button" class="bouton" data-fuite="0.04">Fuite lente</button>' +
        '<button type="button" class="bouton" data-reparer="1">Réparer</button></div>' +
        '<h4>Pompe</h4><div class="rangee"><span class="champ-unite"><input type="number" step="0.1" value="' +
        (pos === "AV" ? 2.2 : 2.4) + '" data-cible-gonflage><i>bar</i></span>' +
        '<button type="button" class="bouton" data-gonfler="1">Gonfler</button></div>' +
        '<label class="interrupteur"><input type="checkbox" data-capteur checked><span></span>Capteur vissé sur la valve</label></div>' +
        "</article>";
    }).join("");
    $("grillePneus").insertAdjacentHTML("afterbegin", html);
    POSITIONS.forEach(function (pos) {
      var bloc = $("detail" + pos);
      bloc.querySelectorAll("[data-percer]").forEach(function (bt) {
        bt.addEventListener("click", function () {
          action({ type: "percer", roue: pos, diametreMm: parseFloat(bt.dataset.percer), forme: bt.dataset.forme });
          notifier("Pneu " + NOMS[pos] + " percé", bt.textContent + ". Regarde le boîtier réagir.", "alerte");
        });
      });
      bloc.querySelector("[data-fuite]").addEventListener("click", function () { fuite(pos); });
      bloc.querySelector("[data-reparer]").addEventListener("click", function () {
        action({ type: "reparer", roue: pos });
        notifier("Pneu " + NOMS[pos] + " réparé", "Les trous sont bouchés. Pense à regonfler.", "ok");
      });
      bloc.querySelector("[data-gonfler]").addEventListener("click", function () {
        regonfler(pos, parseFloat(bloc.querySelector("[data-cible-gonflage]").value));
      });
      bloc.querySelector("[data-capteur]").addEventListener("change", function (e) {
        action({ type: "capteur", roue: pos, present: e.target.checked });
        notifier(e.target.checked ? "Capteur revissé" : "Capteur dévissé", "Pneu " + NOMS[pos] + ".");
      });
    });
  }

  function crever(pos) {
    action({ type: "percer", roue: pos, diametreMm: 1, forme: "epine" });
    notifier("Crevaison du pneu " + NOMS[pos], "Une épine de 1 mm. Le pneu se vide en une minute environ.", "alerte");
  }
  function fuite(pos) {
    action({ type: "fuite", roue: pos, diametreMm: 0.04 });
    notifier("Fuite lente sur le pneu " + NOMS[pos], "Quelques dixièmes de bar par heure : accélère le temps pour la voir.");
  }
  function regonfler(pos, cible) {
    if (!cible) cible = pos === "AV" ? m.options.pressionAVBar : m.options.pressionARBar;
    action({ type: "reparer", roue: pos });
    action({ type: "gonfler", roue: pos, pressionBar: cible });
    notifier("Pneu " + NOMS[pos] + " regonflé", "Réparé et gonflé à " + nombre(cible, 1) + " bar.", "ok");
  }

  function afficherPneus() {
    POSITIONS.forEach(function (pos) {
      var bloc = $("detail" + pos), p = m.pneus[pos], c = m.capteurs[pos], roue = m.boitier.roues[pos];
      bloc.querySelector("[data-pression]").textContent = nombre(p.pressionRelBar, 3);
      puce(bloc.querySelector("[data-etat]"), texteEtatCourt(roue.etat),
        roue.etat === "OK" ? "ok" : (roue.etat === "ATTENTE" ? "" : "alerte"));
      var trous = (p.orifices || []).map(function (o) { return o.type + " " + nombre(o.diametreMm, 2) + " mm"; }).join(", ");
      bloc.querySelector("[data-mesures]").innerHTML = mesures([
        ["Boîtier affiche", roue.mesure && roue.etat !== "INTRUSION" ? nombre(roue.mesure.pressionBar, 2) + " bar" : "–"],
        ["Pression absolue", nombre(TPMS.pneuPressionAbsoluePa(p) / 1e5, 3) + " bar"],
        ["Air intérieur", nombre(p.temperatureAirC, 1) + " °C"],
        ["Trous", trous || "aucun"],
        ["Capteur", c.monte === false ? "dévissé" : (c.actif ? "émet" : "muet")],
        ["Température du capteur", nombre(c.temperatureCapteurC, 1) + " °C"],
        ["Pile CR1632", nombre(c.pileTensionV, 3) + " V"],
        ["Pile restante", nombre(c.pileRestanteMAh, 1) + " mAh"]
      ]);
    });
    var cles = vue.roueGraphe === "AV" ? ["pAV", "affAV"] : ["pAR", "affAR"];
    var pts = derniersPoints(3 * 3600000);
    TPMS.grapheLignes($("graphePneu"), {
      series: [
        { points: pts.map(function (q) { return [q.tMs / 60000, q[cles[0]]]; }), classe: "s1" },
        { points: pts.map(function (q) { return [q.tMs / 60000, q[cles[1]]]; }), classe: "s2" }
      ],
      reperes: [{ y: m.boitier.reglages.seuils[vue.roueGraphe].basBar, texte: "seuil d'alerte" }],
      pasY: 0.25,
      formatX: function (x) { return horodatage(x * 60000); },
      formatY: function (y) { return nombre(y, 2); }
    });
    afficherRegistres();
  }

  function derniersPoints(dureeMs) {
    var e = m.enregistrement, debut = m.tMs - dureeMs, i = e.length - 1;
    while (i > 0 && e[i - 1].tMs >= debut) i--;
    return e.slice(Math.max(0, i));
  }

  var CHAMPS = [
    { court: "fabricant", debut: 0, fin: 2 }, { court: "n°", debut: 2, fin: 3 },
    { court: "adresse", debut: 3, fin: 8 }, { court: "pression (Pa)", debut: 8, fin: 12, pression: true },
    { court: "température", debut: 12, fin: 16 }, { court: "pile", debut: 16, fin: 17 }, { court: "al.", debut: 17, fin: 18 }
  ];
  function construireRegistres() {
    $("registres").innerHTML = POSITIONS.map(function (pos) {
      return '<div class="registre-bloc" id="registre' + pos + '"><div class="registre-tete"><b>Capteur ' + NOMS[pos] +
        '</b><span>en attente…</span></div><div class="registre-defilement"><table class="registre"></table></div></div>';
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
        champs += '<td colspan="' + (c.fin - c.debut) + '"' + (c.pression ? ' class="champ-pression"' : "") + ">" + c.court + "</td>";
      });
      var bloc = $("registre" + pos);
      bloc.querySelector(".registre-tete").innerHTML = "<b>Capteur " + NOMS[pos] + "</b><span>" + horodatage(tr.tMs) +
        " · " + nombre(tr.pressionBar, 2) + " bar annoncés · " + (tr.rssiDbm === null ? "–" : Math.round(tr.rssiDbm) + " dBm") + " · " + verdict(tr) + "</span>";
      bloc.querySelector(".registre").innerHTML = '<tr class="index">' + index + '</tr><tr class="hexa">' + hexa + '</tr><tr class="champs">' + champs + "</tr>";
    });
  }

  // -------------------------------------------------------------------
  // Radio et sécurité
  // -------------------------------------------------------------------
  var RAISONS = {
    ok: ["ok", "Reçues"], "hors-ecoute": ["gris", "Radio du boîtier coupée"], "trop-faible": ["attention", "Signal trop faible"],
    collision: ["alerte", "Collision"], "erreur-paquet": ["alerte", "Paquet corrompu"], brouillee: ["alerte", "Brouillées"]
  };
  var VERDICTS = {
    acceptee: ["ok", "acceptée"], inconnue: ["non", "ignorée (inconnu)"], invalide: ["rejet", "rejetée"],
    intrusion: ["rejet", "rejetée (suspecte)"], suspecte: ["attente", "à confirmer"],
    "hors-limites": ["rejet", "hors limites"], "radio-coupee": ["non", "radio coupée"]
  };
  function verdict(tr) {
    if (tr.raison !== "ok") {
      var r = RAISONS[tr.raison] || ["non", tr.raison];
      return '<span class="verdict non">perdue · ' + r[1].toLowerCase() + "</span>";
    }
    if (tr.verdict === "acceptee" && tr.source === "pirate") return '<span class="verdict trompe">acceptée, boîtier trompé</span>';
    var v = VERDICTS[tr.verdict] || ["non", tr.verdict];
    return '<span class="verdict ' + v[0] + '">' + v[1] + "</span>";
  }
  function nomSource(s) {
    if (s === "AV" || s === "AR") return "Capteur " + NOMS[s];
    return s === "pirate" ? "Pirate" : "Vélo voisin";
  }
  function barres(conteneur, lignes) {
    var max = 0;
    lignes.forEach(function (l) { if (l.valeur > max) max = l.valeur; });
    conteneur.innerHTML = lignes.map(function (l) {
      return '<div class="barre-ligne"><span class="nom">' + l.nom + '</span><span class="piste"><span class="plein ' + (l.classe || "") +
        '" style="display:block;width:' + (max > 0 ? Math.max(1, l.valeur / max * 100) : 0) + '%"></span></span><span class="val">' + l.texte + "</span></div>";
    }).join("");
  }

  function afficherRadio() {
    TPMS.vueRadioDessiner($("vueRadio"), m, vue.rayonRadio);
    $("txtEnvRadio").textContent = "Environnement radio : " + m.parcours.environnementRadio + ".";
    var total = m.stats.emissions || 1;
    barres($("barresRadio"), Object.keys(RAISONS).map(function (r) {
      var n = m.stats.radio[r] || 0;
      return { nom: RAISONS[r][1], valeur: n, classe: RAISONS[r][0], texte: nombre(100 * n / total, 1) + " %" };
    }));
    m.trafic.forEach(function (tr) {
      if ((tr.source === "AV" || tr.source === "AR") && tr.rssiDbm !== null && (!vue.derniereTrameVue || tr.tMs > vue.derniereTrameVue)) {
        vue.rssi[tr.source].push([tr.tMs / 1000, tr.rssiDbm]);
        if (vue.rssi[tr.source].length > 300) vue.rssi[tr.source].shift();
      }
    });
    if (m.trafic.length) vue.derniereTrameVue = m.trafic[0].tMs;
    ["AV", "AR"].forEach(function (s) { vue.rssi[s].sort(function (a, b) { return a[0] - b[0]; }); });
    TPMS.grapheLignes($("grapheRssi"), {
      series: [{ points: vue.rssi.AV, classe: "s1 points" }, { points: vue.rssi.AR, classe: "s2 points" }],
      pasY: 10, yMin: -100, yMax: -30,
      reperes: [{ y: -95, texte: "limite de réception" }],
      formatX: function (x) { return horodatage(x * 1000); },
      formatY: function (y) { return y + " dBm"; }
    });
    // Attaquant
    var p = m.pirate;
    puce($("pucePirate"), p.actif ? "Actif" : "Inactif", p.actif ? "alerte" : "");
    $("chkPirate").checked = p.actif;
    $("txtEnregistrement").textContent = p.enregistrement.length + " / " + TPMS.PIRATE_TAILLE_ENREGISTREMENT + (p.enregistre ? " · écoute…" : "");
    PROTECTIONS.forEach(function (pr) {
      $("compteur-" + pr.cle).textContent = pr.compteur(m.boitier.stats);
      $("prot-" + pr.cle).checked = m.boitier.reglages.protections[pr.cle];
    });
    // Vérité
    $("verite").innerHTML = POSITIONS.map(function (pos) {
      var reelle = m.pneus[pos].pressionRelBar, roue = m.boitier.roues[pos];
      var retenue = roue.mesure ? roue.mesure.pressionBar : null, bilan;
      if (roue.etat === TPMS.ETAT.INTRUSION) bilan = '<span class="puce attention">Attaque repérée</span>';
      else if (retenue === null) bilan = '<span class="puce">Pas de mesure</span>';
      else if (Math.abs(reelle - retenue) > 0.25) bilan = '<span class="puce alerte">Boîtier trompé</span>';
      else bilan = '<span class="puce ok">Conforme</span>';
      return '<div class="verite-ligne"><b>' + (pos === "AV" ? "Avant" : "Arrière") + "</b><span><small>réelle</small>" + nombre(reelle, 2) +
        " bar</span><span><small>boîtier</small>" + (retenue === null ? "–" : nombre(retenue, 2) + " bar") + "</span>" + bilan + "</div>";
    }).join("");
    // Trafic
    var html = "<tr><th>Heure</th><th>Émetteur</th><th>Annonce</th><th>RSSI</th><th>Devenir</th></tr>";
    m.trafic.slice(0, 16).forEach(function (tr) {
      html += "<tr" + (tr.source === "pirate" ? ' class="ligne-pirate"' : "") + "><td>" + horodatage(tr.tMs) + "</td><td>" + nomSource(tr.source) +
        '</td><td class="mono">' + nombre(tr.pressionBar, 2) + ' bar</td><td class="mono">' + (tr.rssiDbm === null ? "–" : Math.round(tr.rssiDbm) + " dBm") + "</td><td>" + verdict(tr) + "</td></tr>";
    });
    $("tableTrafic").innerHTML = html;
  }

  var PROTECTIONS = [
    { cle: "listeBlanche", nom: "Liste blanche", texte: "Seuls les deux capteurs appairés sont écoutés. Sans elle, le capteur n°1 d'un vélo voisin passerait pour ta roue avant.", compteur: function (s) { return s.tramesInconnues + " ignorées"; } },
    { cle: "vraisemblance", nom: "Vraisemblance", texte: "Une pression ne peut pas sauter de plus de 0,3 bar/s sans être confirmée par 3 trames de suite.", compteur: function (s) { return s.rejetsVraisemblance + " rejetées"; } },
    { cle: "rythme", nom: "Rythme", texte: "Un capteur émet toutes les 3 s. Des trames plus rapprochées sous la même adresse trahissent un second émetteur.", compteur: function (s) { return s.intrusions + " intrusion" + (s.intrusions > 1 ? "s" : ""); } }
  ];
  function construireProtections() {
    $("protections").innerHTML = PROTECTIONS.map(function (p) {
      return '<div class="protection"><label class="interrupteur"><input type="checkbox" id="prot-' + p.cle + '" checked><span></span>' + p.nom +
        '</label><span class="compteur" id="compteur-' + p.cle + '"></span><p>' + p.texte + "</p></div>";
    }).join("");
    PROTECTIONS.forEach(function (p) {
      $("prot-" + p.cle).addEventListener("change", function (e) {
        action({ type: "protection", cle: p.cle, valeur: e.target.checked });
        notifier(p.nom + (e.target.checked ? " activée" : " désactivée"), "");
      });
    });
  }

  function attaqueCourante() { return m.pirateMonde.brouillage ? "brouillage" : m.pirate.attaque; }
  function choisirAttaque(a) {
    action({ type: "pirate", pirate: a === "brouillage" ? {} : { attaque: a }, monde: { brouillage: a === "brouillage" } });
    synchroniserPirate();
  }
  function activerPirate(actif) {
    action({ type: "pirate", pirate: { actif: actif } });
    notifier(actif ? "Attaque pirate lancée" : "Attaque arrêtée",
      actif ? { usurpation: "Fausse pression envoyée au nom du capteur.", rejeu: "Rejeu de trames enregistrées.", brouillage: "Brouillage des canaux radio." }[attaqueCourante()] : "",
      actif ? "alerte" : "ok");
    synchroniserPirate();
  }
  function synchroniserPirate() {
    var a = attaqueCourante();
    ["choixAttaque", "choixAttaqueAccueil"].forEach(function (id) {
      $(id).querySelectorAll("button").forEach(function (b) { b.classList.toggle("actif", b.dataset.attaque === a); });
    });
    $("chkPirate").checked = m.pirate.actif;
    $("chkPirateAccueil").checked = m.pirate.actif;
    $("ligneFaussePression").hidden = a !== "usurpation";
    $("ligneEnregistrement").hidden = a !== "rejeu";
    $("noteAttaque").textContent = {
      usurpation: "Le pirate a relevé l'adresse du capteur en écoutant l'air, et diffuse des trames à son nom avec la pression de son choix.",
      rejeu: "Le pirate renvoie à l'identique des trames enregistrées plus tôt, par exemple pneu gonflé pour masquer une crevaison.",
      brouillage: "Le pirate émet en continu sur les canaux d'annonce : près de lui, plus rien n'est reçu."
    }[a];
  }

  // -------------------------------------------------------------------
  // Électronique
  // -------------------------------------------------------------------
  function afficherElectronique() {
    if (!vue.schemaInsere && TPMS.schemaSvg) {
      $("schemaZone").innerHTML = TPMS.schemaSvg({ theme: "sombre" });
      vue.schemaInsere = true;
    }
    var e = m.electronique;
    if (e && TPMS.schemaMettreAJour) TPMS.schemaMettreAJour($("schemaZone").querySelector("svg"), e);
    var l = m.lipo, courantMa = e ? e.courantBatterieA * 1000 : 0;
    $("mesuresLipo").innerHTML = mesures([
      ["Charge réelle", nombre(l.etatCharge * 100, 1) + " %"],
      ["Jauge du boîtier", m.boitier.batteriePct + " %"],
      ["Tension", nombre(l.tensionV, 3) + " V"],
      ["Courant", (courantMa < 0 ? "charge " : "") + nombre(Math.abs(courantMa), 3) + " mA"],
      ["Protection", l.coupee ? "coupée" : "normale"],
      ["Chargeur", m.vbusV > 0 ? "branché" : "débranché"]
    ]);
    var pts = derniersPoints(24 * 3600000);
    TPMS.grapheLignes($("grapheVbat"), {
      series: [{ points: pts.map(function (q) { return [q.tMs / 3600000, q.vbat]; }), classe: "s1" }],
      pasY: 0.1, reperes: [{ y: 3.0, texte: "coupure" }],
      formatX: function (x) { return horodatage(x * 3600000); },
      formatY: function (y) { return nombre(y, 1) + " V"; }
    });
    if (e) {
      var lignes = Object.keys(e.courants || {})
        .filter(function (k) { return k.indexOf("U1.") !== 0 && Math.abs(e.courants[k]) > 1e-7; })
        .sort(function (a, b) { return Math.abs(e.courants[b]) - Math.abs(e.courants[a]); }).slice(0, 8)
        .map(function (k) {
          var ma = Math.abs(e.courants[k]) * 1000;
          return { nom: k, valeur: ma, texte: (ma < 0.01 ? nombre(ma * 1000, 1) + " µA" : nombre(ma, 2) + " mA") };
        });
      barres($("barresCourants"), lignes);
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
    var bilan = TPMS.bilanJournee(profil), max = 0;
    bilan.postes.forEach(function (p) { if (p.mAhJour > max) max = p.mAhJour; });
    $("bilanJours").textContent = nombre(bilan.autonomieJours, 0);
    $("bilanJours").classList.toggle("insuffisant", bilan.autonomieJours < 7);
    $("bilanDetail").textContent = nombre(bilan.totalMAhJour, 2) + " mAh par jour · objectif : au moins 7 jours";
    barres($("barresBilan"), bilan.postes.map(function (p) {
      return { nom: p.nom, valeur: p.mAhJour, classe: p.mAhJour === max ? "attention" : "", texte: nombre(p.mAhJour, p.mAhJour < 0.1 ? 3 : 2) + " mAh" };
    }));
  }

  // -------------------------------------------------------------------
  // Application (cadre du téléphone)
  // -------------------------------------------------------------------
  var cadreApp = $("cadreApp");
  function versApp(message) {
    message.tMs = m.tMs;
    if (cadreApp.contentWindow) cadreApp.contentWindow.postMessage(message, "*");
  }
  function noterEchange(sens, quoi, detail) {
    vue.echanges.unshift({ tMs: m.tMs, sens: sens, quoi: quoi, detail: detail });
    if (vue.echanges.length > 14) vue.echanges.pop();
  }
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
        if (r === "code-requis") notifier("Code d'appairage affiché", "Lis-le sur l'écran du boîtier (Vue d'ensemble).");
        break;
      case "code":
        r = TPMS.liaisonSaisirCode(b, msg.code, t);
        noterEchange("app → boîtier", "Code " + msg.code, r);
        versApp({ type: "code-resultat", resultat: r });
        notif.prochaineMs = t;
        if (r === "ok") notifier("Téléphone appairé", "La liaison est chiffrée.", "ok");
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
    $("mesuresLiaison").innerHTML = mesures([
      ["Connexion", l.connecte ? "établie" : "aucune"],
      ["Téléphone appairé", l.appaire ? "oui" : "non"],
      ["Chiffrement", l.connecte && l.appaire ? "AES-CCM" : "–"],
      ["Code affiché", l.code ? l.code : "–"],
      ["Notifications", l.sequence]
    ]);
    var html = "<tr><th>Heure</th><th>Sens</th><th>Quoi</th><th>Octets</th></tr>";
    vue.echanges.forEach(function (x) {
      html += "<tr><td>" + horodatage(x.tMs) + "</td><td>" + x.sens + "</td><td>" + x.quoi + "</td><td>" + x.detail + "</td></tr>";
    });
    $("tableEchanges").innerHTML = html;
  }

  // -------------------------------------------------------------------
  // Données
  // -------------------------------------------------------------------
  function afficherDonnees() {
    var e = m.enregistrement;
    var choix = {
      pressions: { s: [["pAV", "s1", "avant réelle"], ["pAR", "s2", "arrière réelle"], ["affAV", "s3", "avant affichée"]], pas: 0.25, u: " bar" },
      temperatures: { s: [["temperatureC", "s1", "air ambiant"], ["tAirAV", "s2", "air du pneu avant"]], pas: 5, u: " °C" },
      vitesse: { s: [["vitesseKmh", "s1", "vitesse"]], pas: 10, u: " km/h" },
      altitude: { s: [["altitudeM", "s1", "altitude"]], pas: 50, u: " m" },
      batterie: { s: [["vbat", "s1", "tension de la LiPo"]], pas: 0.1, u: " V" },
      piles: { s: [["pileAV", "s1", "pile capteur avant"], ["pileAR", "s2", "pile capteur arrière"]], pas: 0.1, u: " V" }
    }[vue.variable];
    TPMS.grapheLignes($("grapheDonnees"), {
      series: choix.s.map(function (c) { return { points: e.map(function (q) { return [q.tMs / 3600000, q[c[0]]]; }), classe: c[1] }; }),
      pasY: choix.pas,
      formatX: function (x) { return horodatage(x * 3600000); },
      formatY: function (y) { return nombre(y, choix.pas < 1 ? 2 : 0) + choix.u; }
    });
    $("legendeDonnees").innerHTML = choix.s.map(function (c) { return '<span class="trait ' + c[1] + '"></span>' + c[2]; }).join(" ");
    var min = { AV: Infinity, AR: Infinity }, vmax = 0, alertes = 0;
    e.forEach(function (q) {
      if (q.pAV < min.AV) min.AV = q.pAV;
      if (q.pAR < min.AR) min.AR = q.pAR;
      if (q.vitesseKmh > vmax) vmax = q.vitesseKmh;
    });
    vue.journal.forEach(function (l) { if (MOTS_ALERTE.test(l.texte)) alertes++; });
    $("resume").innerHTML = mesures([
      ["Temps simulé", nombre(m.tMs / 3600000, 2) + " h"],
      ["Distance", nombre(m.velo.distanceM / 1000, 2) + " km"],
      ["Vitesse maximale", nombre(vmax, 1) + " km/h"],
      ["Pression minimale avant", nombre(min.AV, 2) + " bar"],
      ["Pression minimale arrière", nombre(min.AR, 2) + " bar"],
      ["Alertes du boîtier", alertes],
      ["Annonces reçues", m.stats.recues + " sur " + m.stats.emissions],
      ["Batterie consommée", nombre((1 - m.lipo.etatCharge) * TPMS.LIPO_MAH, 1) + " mAh"],
      ["Actions enregistrées", m.actions.length]
    ]);
    $("journal").innerHTML = lignesJournal(200);
  }

  // -------------------------------------------------------------------
  // Journal du boîtier et notifications
  // -------------------------------------------------------------------
  var MOTS_ALERTE = /PERDU|CREVAISON|BASSE|HAUTE|FUITE|SUSPECT|faux|bloqué|refusés|vide/;
  var MOTS_OK = /: OK|appairé|revenue|Réveil/;
  function recupererJournal() {
    var b = m.boitier;
    while (b.journal.length > 0) {
      var ligne = b.journal.shift();
      vue.journal.unshift(ligne);
      if (MOTS_ALERTE.test(ligne.texte)) notifier("Le boîtier signale", ligne.texte, "alerte");
    }
    if (vue.journal.length > 300) vue.journal.length = 300;
  }
  function lignesJournal(n) {
    return vue.journal.slice(0, n).map(function (l) {
      var cl = MOTS_ALERTE.test(l.texte) ? ' class="alerte"' : (MOTS_OK.test(l.texte) ? ' class="ok"' : "");
      return "<li" + cl + '><span class="heure">' + horodatage(l.tMs) + "</span><span>" + l.texte + "</span></li>";
    }).join("");
  }

  function synchroniserReglages() {
    var r = m.boitier.reglages;
    $("seuilAVbas").value = r.seuils.AV.basBar;
    $("seuilAVhaut").value = r.seuils.AV.hautBar;
    $("seuilARbas").value = r.seuils.AR.basBar;
    $("seuilARhaut").value = r.seuils.AR.hautBar;
    ["selCirconference", "selVeille"].forEach(function (id) {
      var valeur = id === "selVeille" ? r.delaiVeilleMs : r.circonferenceMm, sel = $(id);
      if (!sel.querySelector('option[value="' + valeur + '"]')) {
        var o = document.createElement("option");
        o.value = valeur;
        o.textContent = id === "selVeille" ? (valeur / 1000) + " s immobile" : valeur + " mm (mesurée sur le vélo)";
        sel.appendChild(o);
      }
      sel.value = valeur;
    });
    $("selEcoute").value = r.ecouteFenetreMs + "/" + r.ecoutePeriodeMs;
    $("selPeriodeEcran").value = r.periodeEcranMs;
    if (m.pirate) synchroniserPirate();
  }

  function telecharger(nom, contenu, type) {
    var lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([contenu], { type: type }));
    lien.download = nom;
    lien.click();
    setTimeout(function () { URL.revokeObjectURL(lien.href); }, 1000);
  }

  // -------------------------------------------------------------------
  // Buzzer
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
  // Branchements
  // -------------------------------------------------------------------
  function pilules(conteneur, rappel) {
    var boutons = conteneur.querySelectorAll("button");
    boutons.forEach(function (bt) {
      bt.addEventListener("click", function () {
        boutons.forEach(function (x) { x.classList.toggle("actif", x === bt); });
        rappel(bt);
      });
    });
  }

  function ouvrirPage(id) {
    vue.page = id;
    document.querySelectorAll("#navigation button").forEach(function (b) { b.classList.toggle("actif", b.dataset.page === id); });
    document.querySelectorAll(".page").forEach(function (p) { p.hidden = p.id !== "page-" + id; });
    try { localStorage.setItem("tpms-sim-page", id); } catch (e) { /* sans importance */ }
    window.scrollTo(0, 0);
    dernierPanneaux = 0;
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
    $("cfgParcours").innerHTML = TPMS.PARCOURS.map(function (p) { return '<option value="' + p.id + '">' + p.nom + "</option>"; }).join("");
    $("cfgMeteo").innerHTML = Object.keys(TPMS.METEOS).map(function (k) { return '<option value="' + k + '">' + (NOMS_METEO[k] || k) + "</option>"; }).join("");
    function decrireParcours() {
      var p = TPMS.parcoursParId($("cfgParcours").value);
      $("cfgDescription").textContent = p.description || "";
    }
    $("cfgParcours").addEventListener("change", function () {
      decrireParcours();
      var p = TPMS.parcoursParId($("cfgParcours").value);
      var type = p.type === "route" ? "route" : (p.type === "vtt" ? "vtt" : "ville");
      var nominale = TPMS.creerVelo({ type: type, graine: 1 }).pressionNominaleBar;
      $("cfgPAV").value = (Math.round(nominale * 10) / 10).toFixed(1);
      $("cfgPAR").value = (Math.round((nominale + 0.2) * 10) / 10).toFixed(1);
    });
    decrireParcours();
    // Au-delà de la plage des capteurs (3,5 bar supposés), le boîtier
    // affichera une valeur fausse : on prévient avant de lancer.
    function verifierPlage() {
      var max = Math.max(parseFloat($("cfgPAV").value) || 0, parseFloat($("cfgPAR").value) || 0);
      var plage = parseFloat($("cfgPlage").value) || 3.5;
      var av = $("cfgAvertissement");
      av.hidden = max <= plage;
      av.textContent = "Au-delà de " + nombre(plage, 1) + " bar, les capteurs saturent : le boîtier affichera " + nombre(plage, 2) +
        " bar au lieu de " + nombre(max, 1) + " bar et restera en alerte. Choisis une plage plus large ou une pression plus basse.";
    }
    ["cfgPAV", "cfgPAR"].forEach(function (id) { $(id).addEventListener("input", verifierPlage); });
    $("cfgPlage").addEventListener("change", verifierPlage);
    verifierPlage();
    $("cfgParcours").addEventListener("change", verifierPlage);

    document.querySelectorAll("#navigation button").forEach(function (b) {
      b.addEventListener("click", function () { ouvrirPage(b.dataset.page); });
    });
    try { var memo = localStorage.getItem("tpms-sim-page"); if (memo && $("page-" + memo)) ouvrirPage(memo); } catch (e) { /* rien */ }

    $("btnPause").addEventListener("click", function () {
      vue.enPause = !vue.enPause;
      $("btnPause").classList.toggle("en-pause", vue.enPause);
      $("btnPause").querySelector("use").setAttribute("href", vue.enPause ? "#i-play" : "#i-pause");
    });
    pilules($("choixFacteur"), function (bt) { vue.facteur = parseInt(bt.dataset.facteur, 10); });

    // Vue d'ensemble
    $("btnSortie").addEventListener("click", function () {
      if (m.enSortie) {
        action({ type: "garer" });
        notifier("Vélo garé", "Le boîtier passera en veille après quelques minutes sans rouler.");
      } else {
        var fini = m.cycliste.etat === "fini";
        action({ type: "partir", depuisDebut: fini || m.velo.distanceM === 0 });
        notifier("C'est parti", m.parcours.nom + ". Accélère le temps en haut à droite si besoin.", "ok");
      }
    });
    $("btnAllerConfig").addEventListener("click", function () { ouvrirPage("config"); });
    document.querySelectorAll(".tuile-pneu").forEach(function (tuile) {
      var pos = tuile.dataset.roue;
      tuile.querySelector('[data-act="percer"]').addEventListener("click", function () { crever(pos); });
      tuile.querySelector('[data-act="fuite"]').addEventListener("click", function () { fuite(pos); });
      tuile.querySelector('[data-act="regonfler"]').addEventListener("click", function () { regonfler(pos); });
    });
    $("chkRecharge").addEventListener("change", function (e) {
      action({ type: "recharge", branche: e.target.checked });
      notifier(e.target.checked ? "Chargeur branché" : "Chargeur débranché", e.target.checked ? "La LiPo se recharge à 100 mA." : "", e.target.checked ? "ok" : "");
    });
    $("chkPirateAccueil").addEventListener("change", function (e) { activerPirate(e.target.checked); });
    pilules($("choixAttaqueAccueil"), function (bt) { choisirAttaque(bt.dataset.attaque); });
    brancherBoutonPhysique("bouton1", 1);
    brancherBoutonPhysique("bouton2", 2);

    // Configuration
    $("btnNouveau").addEventListener("click", function () {
      nouvelleSimulation();
      ouvrirPage("accueil");
      notifier("Nouvelle simulation prête", "Clique sur « Démarrer la sortie ».", "ok");
    });
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

    // Pneus
    pilules($("choixRouePneu"), function (bt) { vue.roueGraphe = bt.dataset.roue; });

    // Radio et sécurité
    pilules($("choixZoomRadio"), function (bt) { vue.rayonRadio = parseFloat(bt.dataset.rayon); });
    $("chkPirate").addEventListener("change", function (e) { activerPirate(e.target.checked); });
    pilules($("choixAttaque"), function (bt) { choisirAttaque(bt.dataset.attaque); });
    pilules($("choixCible"), function (bt) { action({ type: "pirate", pirate: { cible: bt.dataset.cible, enregistrement: [] } }); });
    pilules($("choixPosition"), function (bt) { action({ type: "pirate", monde: { suit: bt.dataset.suit === "1" } }); });
    pilules($("choixCadence"), function (bt) { action({ type: "pirate", pirate: { intervalleMs: parseInt(bt.dataset.cadence, 10) } }); });
    $("curDistancePirate").addEventListener("input", function (e) { $("txtDistancePirate").textContent = e.target.value + " m"; });
    $("curDistancePirate").addEventListener("change", function (e) { action({ type: "pirate", monde: { distanceM: parseFloat(e.target.value) } }); });
    $("curPuissancePirate").addEventListener("input", function (e) { var v = parseFloat(e.target.value); $("txtPuissancePirate").textContent = (v > 0 ? "+" : "") + v + " dBm"; });
    $("curPuissancePirate").addEventListener("change", function (e) { action({ type: "pirate", monde: { puissanceDbm: parseFloat(e.target.value) } }); });
    $("curFaussePression").addEventListener("input", function (e) { $("txtFaussePression").textContent = nombre(parseFloat(e.target.value), 2) + " bar"; });
    $("curFaussePression").addEventListener("change", function (e) { action({ type: "pirate", pirate: { pressionFausseBar: parseFloat(e.target.value) } }); });
    $("btnEnregistrer").addEventListener("click", function () {
      action({ type: "pirate", enregistrer: true });
      notifier("Le pirate écoute", "Il enregistre les 20 prochaines trames du capteur visé.");
    });

    // Application
    $("btnOublierTel").addEventListener("click", function () { TPMS.liaisonOublier(m.boitier, m.tMs); versApp({ type: "deconnecte" }); });

    // Données
    pilules($("choixVariable"), function (bt) { vue.variable = bt.dataset.variable; });
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
        notifier("Scénario chargé", "La sortie est rejouée à l'identique.", "ok");
      });
    });
    $("btnRejouer").addEventListener("click", function () {
      installerMonde(TPMS.mondeRejeu(m));
      notifier("Rejeu lancé", "Même graine, mêmes actions aux mêmes instants.", "ok");
    });
  }

  // -------------------------------------------------------------------
  // Démarrage
  // -------------------------------------------------------------------
  brancher();
  construirePneus();
  construireRegistres();
  construireProtections();
  nouvelleSimulation();
  synchroniserPirate();
  try {
    if (!localStorage.getItem("tpms-sim-bienvenue")) {
      localStorage.setItem("tpms-sim-bienvenue", "1");
      notifier("Bienvenue", "Clique sur « Démarrer la sortie », puis crève un pneu pour voir le boîtier réagir.", "ok");
    }
  } catch (e) { /* sans stockage, pas de message d'accueil */ }
  setInterval(boucle, 33);

  // Accès en lecture au monde depuis la console du navigateur (mise au point) :
  // TPMS.mondeCourant().pneus.AV.pressionRelBar
  TPMS.mondeCourant = function () { return m; };
})();
