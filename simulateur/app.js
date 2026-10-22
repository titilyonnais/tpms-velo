// =====================================================================
// app.js — Interface du simulateur
// ---------------------------------------------------------------------
// Ce fichier n'ira PAS dans le firmware : il remplace le monde réel.
//   - Il fait avancer le temps simulé.
//   - Il fait émettre les capteurs simulés et tourner la roue.
//   - Il transmet les trames et les tops au boîtier, comme le ferait
//     le vrai matériel.
//   - Il affiche le résultat sur la page.
// =====================================================================
(function () {
  "use strict";

  var PAS_MS = 50;                       // pas de la simulation (temps simulé)
  var POSITIONS = ["AV", "AR"];
  var NOMS = { AV: "Avant", AR: "Arrière" };
  var NOMINAL = { AV: 2.2, AR: 2.4 };    // pression après regonflage

  function $(id) { return document.getElementById(id); }

  // -------------------------------------------------------------------
  // État de la simulation
  // -------------------------------------------------------------------
  var sim = {
    tMs: 0,
    enPause: false,
    facteur: 1,
    capteurs: {
      AV: TPMS.creerCapteurSimule(1, [0xEA, 0xCA, 0x3F, 0x1B, 0x07], NOMINAL.AV),
      AR: TPMS.creerCapteurSimule(2, [0xEA, 0xCA, 0x3F, 0x1B, 0x08], NOMINAL.AR)
    },
    voisin: TPMS.creerCapteurSimule(1, [0xEA, 0xCA, 0x52, 0x90, 0x11], 2.0),
    voisinPresent: false,
    boitier: TPMS.creerBoitier(),
    roue: { vitesseKmh: 0, angleDeg: 0, dernierTopReel: 0 },
    prochaineMajBoitierMs: 0,
    dernieresTrames: { AV: null, AR: null },
    versionTrames: { AV: 0, AR: 0 },
    trafic: [],
    traficChange: true,
    journal: [],
    ecranAChange: false,
    flashDemande: false,
    bipDemande: false,
    ledAlerte: "eteinte",
    ledsEclairage: false
  };
  // Les deux capteurs ne sont pas synchronisés.
  sim.capteurs.AR.prochaineEmissionMs = 1500;
  sim.capteurs.AR.temperatureC = 19;
  sim.capteurs.AR.batteriePct = 92;
  sim.voisin.intervalleMs = 2500;

  // -------------------------------------------------------------------
  // Mise en forme
  // -------------------------------------------------------------------
  function nombre(x, decimales) {
    return x.toFixed(decimales).replace(".", ",");
  }

  function heure(tMs) {
    return "T+ " + TPMS.dureeEnTexte(tMs / 1000);
  }

  var TEXTE_RESULTAT = {
    "acceptee": "acceptée",
    "radio-coupee": "manquée : radio coupée",
    "inconnue": "ignorée : capteur inconnu",
    "invalide": "rejetée : format invalide"
  };

  function badge(resultat) {
    return '<span class="badge ' + resultat + '">' + TEXTE_RESULTAT[resultat] + "</span>";
  }

  // -------------------------------------------------------------------
  // Avancer le temps simulé
  // -------------------------------------------------------------------
  function avancer(dureeMs) {
    var fin = sim.tMs + dureeMs;
    while (sim.tMs < fin) {
      var pas = Math.min(PAS_MS, fin - sim.tMs);
      var t = sim.tMs + pas;

      tournerRoue(pas);
      for (var i = 0; i < POSITIONS.length; i++) {
        faireEmettre(sim.capteurs[POSITIONS[i]], POSITIONS[i], pas, t);
      }
      if (sim.voisinPresent) {
        faireEmettre(sim.voisin, "Voisin", pas, t);
      } else {
        sim.voisin.prochaineEmissionMs = t;
      }

      // Le boîtier fait sa mise à jour une fois par seconde.
      while (sim.prochaineMajBoitierMs <= t) {
        appliquerSorties(TPMS.boitierMiseAJour(sim.boitier, sim.prochaineMajBoitierMs));
        sim.prochaineMajBoitierMs += 1000;
      }
      sim.tMs = t;
    }
  }

  // Le capteur évolue (fuite, crevaison) et diffuse ses annonces BLE.
  function faireEmettre(c, source, pas, t) {
    TPMS.capteurAvancer(c, pas);
    while (c.prochaineEmissionMs <= t) {
      var tEmission = c.prochaineEmissionMs;
      c.prochaineEmissionMs += c.intervalleMs;
      if (!c.actif) continue;
      var octets = TPMS.capteurTrame(c);
      var resultat = TPMS.boitierRecevoirTrame(sim.boitier, octets, tEmission);
      noterTrame(source, octets, tEmission, resultat);
    }
  }

  // La roue tourne ; à chaque tour, l'aimant passe devant le reed.
  function tournerRoue(pas) {
    var r = sim.roue;
    if (r.vitesseKmh <= 0) return;
    var circonferenceM = sim.boitier.reglages.circonferenceMm / 1000;
    var degres = (r.vitesseKmh / 3.6) / circonferenceM * 360 * pas / 1000;
    var avant = r.angleDeg;
    r.angleDeg += degres;
    if (r.angleDeg >= 360) {
      r.angleDeg -= 360;
      // Instant exact où l'aimant est passé devant le reed, dans ce pas.
      var tTop = sim.tMs + pas * (360 - avant) / degres;
      TPMS.boitierTopRoue(sim.boitier, Math.round(tTop));
      r.dernierTopReel = performance.now();
    }
  }

  function noterTrame(source, octets, tMs, resultat) {
    if (source === "AV" || source === "AR") {
      sim.dernieresTrames[source] = { octets: octets, tMs: tMs, resultat: resultat };
      sim.versionTrames[source]++;
    }
    var m = TPMS.decoderTrame(octets);
    sim.trafic.unshift({
      tMs: tMs,
      source: source === "Voisin" ? "Vélo voisin" : NOMS[source],
      pression: m ? nombre(m.pressionBar, 2) + " bar" : "?",
      hexa: TPMS.trameEnHexa(octets),
      resultat: resultat
    });
    if (sim.trafic.length > 12) sim.trafic.pop();
    sim.traficChange = true;
  }

  function appliquerSorties(s) {
    if (s.rafraichissement !== "aucun") {
      sim.ecranAChange = true;
      if (s.rafraichissement === "complet") sim.flashDemande = true;
    }
    if (s.bip) sim.bipDemande = true;
    sim.ledAlerte = s.ledAlerte;
    sim.ledsEclairage = s.ledsEclairage;
  }

  // -------------------------------------------------------------------
  // Affichage
  // -------------------------------------------------------------------
  var ctx = $("ecran").getContext("2d");
  var image = ctx.createImageData(TPMS.ECRAN_LARGEUR, TPMS.ECRAN_HAUTEUR);

  // Copie la mémoire d'image du boîtier dans le canvas, pixel par pixel.
  function dessinerCanvas() {
    var pixels = sim.boitier.ecranAffiche.pixels;
    for (var i = 0; i < pixels.length; i++) {
      var noir = pixels[i] === TPMS.NOIR;
      image.data[i * 4]     = noir ? 0x1C : 0xE8;
      image.data[i * 4 + 1] = noir ? 0x1C : 0xE6;
      image.data[i * 4 + 2] = noir ? 0x1A : 0xDC;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function afficherBoitier() {
    if (sim.ecranAChange) {
      dessinerCanvas();
      sim.ecranAChange = false;
    }
    if (sim.flashDemande) {
      // Le rafraîchissement complet d'un e-paper fait clignoter l'écran.
      var ecran = $("ecran");
      ecran.classList.remove("flash");
      void ecran.offsetWidth;          // relance l'animation
      ecran.classList.add("flash");
      sim.flashDemande = false;
    }
    if (sim.bipDemande) {
      jouerBip();
      sim.bipDemande = false;
    }
    $("ledAlerte").className = "led-alerte " + sim.ledAlerte;
    $("ledEclairageG").classList.toggle("on", sim.ledsEclairage);
    $("ledEclairageD").classList.toggle("on", sim.ledsEclairage);
    $("voyantRadio").classList.toggle("on", TPMS.boitierEcoute(sim.boitier, sim.tMs));

    $("roueRotation").setAttribute("transform", "rotate(" + sim.roue.angleDeg.toFixed(1) + " 100 100)");
    $("reed").classList.toggle("top", performance.now() - sim.roue.dernierTopReel < 90);
    $("horloge").textContent = heure(sim.tMs);
  }

  function afficherCapteurs() {
    POSITIONS.forEach(function (pos) {
      var c = sim.capteurs[pos];
      var carte = $("carte" + pos);
      var curseur = carte.querySelector('[data-champ="pression"]');
      // On ne déplace pas le curseur pendant que l'utilisateur le tient.
      if (curseur.dataset.glisse !== "1") curseur.value = c.pressionBar;
      carte.querySelector('[data-sortie="pression"]').textContent = nombre(c.pressionBar, 2) + " bar";
      carte.querySelector('[data-sortie="temperature"]').textContent = nombre(c.temperatureC, 1) + " °C";
      carte.querySelector('[data-sortie="pile"]').textContent = c.batteriePct + " %";
      var boutonCrevaison = carte.querySelector('[data-action="crevaison"]');
      boutonCrevaison.classList.toggle("actif", c.crevaison);
      boutonCrevaison.textContent = c.crevaison ? "💥 Crevaison en cours" : "💥 Crevaison";
      carte.classList.toggle("capteur-inactif", !c.actif);
    });
  }

  // Décodage champ par champ de la dernière trame de chaque capteur.
  var CHAMPS = [
    { nom: "Fabricant",   debut: 0,  fin: 2,  classe: "champ-fabricant" },
    { nom: "N° capteur",  debut: 2,  fin: 3,  classe: "champ-numero" },
    { nom: "Adresse",     debut: 3,  fin: 8,  classe: "champ-adresse" },
    { nom: "Pression",    debut: 8,  fin: 12, classe: "champ-pression" },
    { nom: "Température", debut: 12, fin: 16, classe: "champ-temp" },
    { nom: "Pile",        debut: 16, fin: 17, classe: "champ-pile" },
    { nom: "Alarme",      debut: 17, fin: 18, classe: "champ-alarme" }
  ];
  var versionsAffichees = { AV: -1, AR: -1 };

  function sensChamp(o, m, nom) {
    switch (nom) {
      case "Fabricant":
        return "0x" + TPMS.octetEnHexa(o[0]) + TPMS.octetEnHexa(o[1]) + " (supposé)";
      case "N° capteur":
        return "0x" + TPMS.octetEnHexa(o[2]) + " − 0x80 + 1 = capteur " + m.numero;
      case "Adresse":
        return m.adresse;
      case "Pression": {
        var pa = TPMS.lireInt32LE(o, 8);
        return "à l'envers : 0x" + TPMS.octetEnHexa(o[11]) + TPMS.octetEnHexa(o[10]) +
          TPMS.octetEnHexa(o[9]) + TPMS.octetEnHexa(o[8]) + " = " + pa.toLocaleString("fr-FR") +
          " Pa = <b>" + nombre(m.pressionBar, 2) + " bar</b>";
      }
      case "Température":
        return TPMS.lireInt32LE(o, 12) + " centièmes = <b>" + nombre(m.temperatureC, 2) + " °C</b>";
      case "Pile":
        return "<b>" + m.batteriePct + " %</b>";
      default:
        return o[17] === 0 ? "0x00 : OK" : "<b>0x01 : pas de pression</b>";
    }
  }

  function afficherTrames() {
    POSITIONS.forEach(function (pos) {
      var trame = sim.dernieresTrames[pos];
      if (!trame || versionsAffichees[pos] === sim.versionTrames[pos]) return;
      versionsAffichees[pos] = sim.versionTrames[pos];

      var o = trame.octets;
      var m = TPMS.decoderTrame(o);
      var hexa = "";
      var lignes = "";
      CHAMPS.forEach(function (champ) {
        var morceaux = [];
        for (var i = champ.debut; i < champ.fin; i++) morceaux.push(TPMS.octetEnHexa(o[i]));
        hexa += '<span class="' + champ.classe + '" title="' + champ.nom + '">' + morceaux.join(" ") + "</span>";
        lignes += '<tr><td><span class="' + champ.classe + '">' + champ.nom + "</span></td><td>" +
          morceaux.join(" ") + "</td><td>" + sensChamp(o, m, champ.nom) + "</td></tr>";
      });
      var carte = $("trame" + pos);
      carte.querySelector(".etat-trame").innerHTML = "Émise à " + heure(trame.tMs) + " · " + badge(trame.resultat);
      carte.querySelector(".trame-hexa").innerHTML = hexa;
      carte.querySelector(".decodage").innerHTML = lignes;
    });
  }

  function afficherTrafic() {
    if (!sim.traficChange) return;
    sim.traficChange = false;
    var html = "";
    sim.trafic.forEach(function (ligne) {
      html += '<tr title="' + ligne.hexa + '"><td>' + heure(ligne.tMs) + "</td><td>" + ligne.source +
        "</td><td>" + ligne.pression + "</td><td>" + badge(ligne.resultat) + "</td></tr>";
    });
    $("tableTrafic").innerHTML = html;
  }

  var MOTS_ALERTE = /PERDU|CREVAISON|BASSE|HAUTE|FUITE/;

  function afficherJournal() {
    var b = sim.boitier;
    if (b.journal.length === 0) return;
    // On récupère les messages du boîtier (en vrai : le port série).
    while (b.journal.length > 0) sim.journal.unshift(b.journal.shift());
    if (sim.journal.length > 80) sim.journal.length = 80;
    var html = "";
    sim.journal.forEach(function (ligne) {
      var classe = MOTS_ALERTE.test(ligne.texte) ? ' class="alerte"' : "";
      html += '<li><span class="heure">' + heure(ligne.tMs) + "</span><span" + classe + ">" + ligne.texte + "</span></li>";
    });
    $("journal").innerHTML = html;
  }

  function afficherStats() {
    var b = sim.boitier;
    var s = b.stats;
    function pente(pos) {
      var roue = b.roues[pos];
      return nombre(roue.penteBarH, 3) + " bar/h (" + roue.historique.tMs.length + " pts)";
    }
    var lignes = [
      ["Mode", b.veille ? "veille" : "en marche"],
      ["Radio", b.veille ? "coupée (veille)" : (TPMS.boitierEcoute(b, sim.tMs) ? "écoute" : "coupée")],
      ["Trames acceptées", s.tramesAcceptees],
      ["Trames manquées (radio coupée)", s.tramesManquees],
      ["Trames ignorées (capteur inconnu)", s.tramesInconnues],
      ["Écran : rafraîchissements partiels", s.rafraichissementsPartiels],
      ["Écran : rafraîchissements complets", s.rafraichissementsComplets],
      ["Tendance de pression avant", pente("AV")],
      ["Tendance de pression arrière", pente("AR")],
      ["Tours de roue comptés", b.compteur.nbTours]
    ];
    var html = "";
    lignes.forEach(function (l) { html += "<tr><td>" + l[0] + "</td><td>" + l[1] + "</td></tr>"; });
    $("tableStats").innerHTML = html;
  }

  // -------------------------------------------------------------------
  // Buzzer : 3 bips à 2,7 kHz (fréquence typique d'un buzzer actif)
  // -------------------------------------------------------------------
  var audio = null;
  document.addEventListener("pointerdown", function () {
    // Les navigateurs n'autorisent le son qu'après un clic de l'utilisateur.
    if (!audio && (window.AudioContext || window.webkitAudioContext)) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audio && audio.state === "suspended") audio.resume();
  });

  function jouerBip() {
    var buzzer = $("buzzer");
    buzzer.classList.add("bip");
    setTimeout(function () { buzzer.classList.remove("bip"); }, 800);
    if (!audio || !$("chkSon").checked) return;
    var t0 = audio.currentTime;
    for (var i = 0; i < 3; i++) {
      var oscillateur = audio.createOscillator();
      var volume = audio.createGain();
      oscillateur.type = "square";
      oscillateur.frequency.value = 2700;
      volume.gain.value = 0.04;
      oscillateur.connect(volume);
      volume.connect(audio.destination);
      oscillateur.start(t0 + i * 0.25);
      oscillateur.stop(t0 + i * 0.25 + 0.12);
    }
  }

  // -------------------------------------------------------------------
  // Construction des cartes et branchement des commandes
  // -------------------------------------------------------------------
  function ligneReglage(champ, libelle, min, max, pas) {
    return '<div class="reglage"><span>' + libelle + "</span>" +
      '<input type="range" data-champ="' + champ + '" min="' + min + '" max="' + max + '" step="' + pas + '">' +
      '<output data-sortie="' + champ + '"></output></div>';
  }

  function construireCapteur(pos) {
    var c = sim.capteurs[pos];
    var carte = document.createElement("div");
    carte.className = "carte";
    carte.id = "carte" + pos;
    carte.innerHTML =
      '<div class="capteur-titre"><h3>' + NOMS[pos] + " — capteur n°" + c.numero + "</h3>" +
      "<code>" + TPMS.adresseEnTexte(c.adresse) + "</code></div>" +
      '<label class="case"><input type="checkbox" data-champ="actif" checked> Capteur actif ' +
      "(décocher = pile morte ou capteur arraché)</label>" +
      ligneReglage("pression", "Pression", 0, 4, 0.01) +
      ligneReglage("temperature", "Température", -10, 50, 0.5) +
      ligneReglage("pile", "Pile CR1632", 0, 100, 1) +
      '<div class="reglage"><span>Fuite lente</span><select data-champ="fuite">' +
      '<option value="0">aucune</option>' +
      '<option value="0.1">0,1 bar/h (très lente)</option>' +
      '<option value="0.3">0,3 bar/h</option>' +
      '<option value="1">1 bar/h</option>' +
      '<option value="5">5 bar/h (rapide)</option>' +
      "</select><span></span></div>" +
      '<div class="actions">' +
      '<button type="button" data-action="crevaison">💥 Crevaison</button>' +
      '<button type="button" data-action="regonfler">Regonfler à ' + nombre(NOMINAL[pos], 1) + " bar</button>" +
      "</div>";
    $("cartesCapteurs").appendChild(carte);

    var pression = carte.querySelector('[data-champ="pression"]');
    pression.value = c.pressionBar;
    pression.addEventListener("pointerdown", function () { pression.dataset.glisse = "1"; });
    pression.addEventListener("input", function () { c.pressionBar = parseFloat(pression.value); });

    var temperature = carte.querySelector('[data-champ="temperature"]');
    temperature.value = c.temperatureC;
    temperature.addEventListener("input", function () { c.temperatureC = parseFloat(temperature.value); });

    var pile = carte.querySelector('[data-champ="pile"]');
    pile.value = c.batteriePct;
    pile.addEventListener("input", function () { c.batteriePct = parseInt(pile.value, 10); });

    carte.querySelector('[data-champ="actif"]').addEventListener("change", function (e) {
      c.actif = e.target.checked;
    });
    carte.querySelector('[data-champ="fuite"]').addEventListener("change", function (e) {
      c.fuiteBarH = parseFloat(e.target.value);
    });
    carte.querySelector('[data-action="crevaison"]').addEventListener("click", function () {
      c.crevaison = !c.crevaison;
    });
    carte.querySelector('[data-action="regonfler"]').addEventListener("click", function () {
      c.crevaison = false;
      c.pressionBar = NOMINAL[pos];
    });
  }

  function construireTrame(pos) {
    var carte = document.createElement("div");
    carte.className = "carte";
    carte.id = "trame" + pos;
    carte.innerHTML =
      "<h3>Dernière trame émise — " + NOMS[pos] + "</h3>" +
      '<div class="etat-trame">En attente de la première annonce…</div>' +
      '<div class="trame-hexa"></div>' +
      '<table class="decodage"></table>';
    $("cartesTrames").appendChild(carte);
  }

  // Bouton physique : un appui de plus de 0,7 s est un appui long.
  function brancherBouton(id, numero) {
    var bouton = $(id);
    var debut = 0;
    bouton.addEventListener("pointerdown", function () {
      debut = performance.now();
      bouton.classList.add("appui");
    });
    bouton.addEventListener("pointerup", function () {
      if (!debut) return;
      var appuiLong = performance.now() - debut >= 700;
      debut = 0;
      bouton.classList.remove("appui");
      TPMS.boitierBouton(sim.boitier, numero, appuiLong, sim.tMs);
      // L'écran réagit tout de suite, sans attendre la seconde suivante.
      appliquerSorties(TPMS.boitierMiseAJour(sim.boitier, sim.tMs));
    });
    bouton.addEventListener("pointerleave", function () {
      debut = 0;
      bouton.classList.remove("appui");
    });
  }

  function brancherCommandes() {
    var b = sim.boitier;

    // Le curseur de pression peut à nouveau suivre le capteur une fois relâché.
    window.addEventListener("pointerup", function () {
      document.querySelectorAll('[data-champ="pression"]').forEach(function (c) { c.dataset.glisse = ""; });
    });

    $("btnPause").addEventListener("click", function () {
      sim.enPause = !sim.enPause;
      $("btnPause").textContent = sim.enPause ? "▶ Reprendre" : "⏸ Pause";
    });
    $("selFacteur").addEventListener("change", function (e) { sim.facteur = parseInt(e.target.value, 10); });
    $("btnReinit").addEventListener("click", function () { location.reload(); });

    var curseurVitesse = $("curVitesseVelo");
    function changerVitesse(v) {
      sim.roue.vitesseKmh = v;
      curseurVitesse.value = v;
      $("txtVitesseVelo").textContent = nombre(v, 1) + " km/h";
    }
    curseurVitesse.addEventListener("input", function () { changerVitesse(parseFloat(curseurVitesse.value)); });
    document.querySelectorAll("[data-vitesse]").forEach(function (bouton) {
      bouton.addEventListener("click", function () { changerVitesse(parseFloat(bouton.dataset.vitesse)); });
    });

    brancherBouton("bouton1", 1);
    brancherBouton("bouton2", 2);

    $("selCirconference").addEventListener("change", function (e) {
      var mm = parseInt(e.target.value, 10);
      b.reglages.circonferenceMm = mm;
      b.compteur.circonferenceMm = mm;
    });

    // Seuils d'alerte : on lit les champs à chaque modification.
    [["seuilAVbas", "AV", "basBar"], ["seuilAVhaut", "AV", "hautBar"],
     ["seuilARbas", "AR", "basBar"], ["seuilARhaut", "AR", "hautBar"]].forEach(function (s) {
      var champ = $(s[0]);
      champ.value = b.reglages.seuils[s[1]][s[2]];
      champ.addEventListener("change", function () {
        var v = parseFloat(champ.value);
        if (!isNaN(v)) b.reglages.seuils[s[1]][s[2]] = v;
      });
    });

    $("selVeille").addEventListener("change", function (e) {
      b.reglages.delaiVeilleMs = parseInt(e.target.value, 10);
    });
    $("curBatterie").addEventListener("input", function (e) {
      b.batteriePct = parseInt(e.target.value, 10);
      $("txtBatterie").textContent = b.batteriePct + " %";
    });
    $("chkCharge").addEventListener("change", function (e) { b.enCharge = e.target.checked; });
    $("chkVoisin").addEventListener("change", function (e) { sim.voisinPresent = e.target.checked; });
  }

  // -------------------------------------------------------------------
  // Boucle principale : environ 60 fois par seconde
  // -------------------------------------------------------------------
  var dernierInstant = null;
  var dernierAffichagePanneaux = 0;

  function boucle(instant) {
    if (dernierInstant !== null && !sim.enPause) {
      var dtReel = Math.min(instant - dernierInstant, 100);   // évite un bond après un onglet en arrière-plan
      avancer(dtReel * sim.facteur);
    }
    dernierInstant = instant;

    afficherBoitier();
    // Les tableaux texte sont rafraîchis 5 fois par seconde, c'est assez.
    if (instant - dernierAffichagePanneaux > 200) {
      dernierAffichagePanneaux = instant;
      afficherCapteurs();
      afficherTrames();
      afficherTrafic();
      afficherJournal();
      afficherStats();
    }
    requestAnimationFrame(boucle);
  }

  POSITIONS.forEach(construireCapteur);
  POSITIONS.forEach(construireTrame);
  brancherCommandes();
  requestAnimationFrame(boucle);
})();
