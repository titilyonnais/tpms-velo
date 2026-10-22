// =====================================================================
// app.js — Interface du simulateur
// ---------------------------------------------------------------------
// Ce fichier n'ira PAS dans le firmware : il remplace le monde réel.
//   - Il fait avancer le temps simulé.
//   - Il fait émettre les capteurs, le vélo voisin et le pirate, et
//     tourner la roue.
//   - Il transmet tout au boîtier, comme le ferait le vrai matériel.
//   - Il relie la vraie application (cadre §3) au boîtier virtuel.
//   - Il mesure l'énergie consommée par le boîtier virtuel.
//   - Il affiche le résultat.
// =====================================================================
(function () {
  "use strict";

  var PAS_MS = 50;                       // pas de la simulation (temps simulé)
  var NOTIF_APP_MS = 5000;               // le boîtier notifie l'app toutes les 5 s
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
    pirate: TPMS.creerPirate(),
    boitier: TPMS.creerBoitier(),
    roue: { vitesseKmh: 0, angleDeg: 140, dernierTopReel: 0 },
    prochaineMajBoitierMs: 0,
    prochaineNotifMs: 0,
    derniereNotifReel: 0,
    dernieresTrames: { AV: null, AR: null },
    versionTrames: { AV: 0, AR: 0 },
    trafic: [],
    traficChange: true,
    echanges: [],
    echangesChange: true,
    journal: [],
    ecranAChange: false,
    flashDemande: false,
    bipDemande: false,
    ledAlerte: "eteinte",
    ledsEclairage: false,
    energie: {
      pctDepart: 100,
      chargeNetteMAh: 0,       // consommé moins rechargé
      consommeMAh: 0,          // consommé depuis le début
      courantMa: 0,
      decharge: true
    }
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
    return TPMS.dureeEnTexte(tMs / 1000);
  }

  // Verdict du boîtier sur une trame : texte + style.
  var VERDICTS = {
    "acceptee":     ["ok", "acceptée"],
    "radio-coupee": ["non", "non reçue (radio coupée)"],
    "inconnue":     ["non", "ignorée (capteur inconnu)"],
    "invalide":     ["rejet", "rejetée (format)"],
    "intrusion":    ["rejet", "rejetée (signal suspect)"],
    "suspecte":     ["attente", "en attente de confirmation"],
    "hors-limites": ["rejet", "rejetée (hors limites)"]
  };

  function verdict(resultat, deLaPart) {
    // Une trame du pirate acceptée : le boîtier s'est fait tromper.
    if (resultat === "acceptee" && deLaPart === "pirate") {
      return '<span class="verdict trompe">ACCEPTÉE — boîtier trompé</span>';
    }
    var v = VERDICTS[resultat];
    return '<span class="verdict ' + v[0] + '">' + v[1] + "</span>";
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
        faireEmettre(sim.voisin, "voisin", pas, t);
      } else {
        sim.voisin.prochaineEmissionMs = t;
      }
      faireEmettrePirate(t);

      // Le boîtier fait sa mise à jour une fois par seconde.
      while (sim.prochaineMajBoitierMs <= t) {
        appliquerSorties(TPMS.boitierMiseAJour(sim.boitier, sim.prochaineMajBoitierMs));
        sim.prochaineMajBoitierMs += 1000;
      }
      notifierApp(t);
      mesurerEnergie(pas, t);
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
      TPMS.pirateEcouter(sim.pirate, source, octets);   // le pirate écoute tout
      var resultat = TPMS.boitierRecevoirTrame(sim.boitier, octets, tEmission);
      noterTrame(source, octets, tEmission, resultat);
    }
  }

  function faireEmettrePirate(t) {
    var p = sim.pirate;
    if (!p.actif) {
      p.prochaineEmissionMs = t;
      return;
    }
    while (p.prochaineEmissionMs <= t) {
      var tEmission = p.prochaineEmissionMs;
      p.prochaineEmissionMs += p.intervalleMs;
      var octets = TPMS.pirateTrame(p, sim.capteurs[p.cible]);
      if (octets === null) continue;   // rejeu sans enregistrement
      var resultat = TPMS.boitierRecevoirTrame(sim.boitier, octets, tEmission);
      noterTrame("pirate", octets, tEmission, resultat);
    }
  }

  // La roue tourne ; à chaque tour, l'aimant passe devant l'ILS.
  function tournerRoue(pas) {
    var r = sim.roue;
    if (r.vitesseKmh <= 0) return;
    var circonferenceM = sim.boitier.reglages.circonferenceMm / 1000;
    var degres = (r.vitesseKmh / 3.6) / circonferenceM * 360 * pas / 1000;
    var avant = r.angleDeg;
    r.angleDeg += degres;
    if (r.angleDeg >= 360) {
      r.angleDeg -= 360;
      // Instant exact où l'aimant est passé devant l'ILS, dans ce pas.
      var tTop = sim.tMs + pas * (360 - avant) / degres;
      TPMS.boitierTopRoue(sim.boitier, Math.round(tTop));
      r.dernierTopReel = performance.now();
    }
  }

  // Roue arrêtée avec l'aimant juste devant l'ILS : le contact reste fermé.
  function reedColle() {
    var a = sim.roue.angleDeg;
    return sim.roue.vitesseKmh === 0 && (a < 8 || a > 352);
  }

  function noterTrame(source, octets, tMs, resultat) {
    if (source === "AV" || source === "AR") {
      sim.dernieresTrames[source] = { octets: octets, tMs: tMs, resultat: resultat };
      sim.versionTrames[source]++;
    }
    var m = TPMS.decoderTrame(octets);
    var emetteur = source === "voisin" ? "Vélo voisin"
      : source === "pirate" ? "Pirate → " + NOMS[sim.pirate.cible].toLowerCase()
      : "Capteur " + NOMS[source].toLowerCase();
    sim.trafic.unshift({
      tMs: tMs,
      source: source,
      emetteur: emetteur,
      pression: m ? nombre(m.pressionBar, 2) + " bar" : "?",
      hexa: TPMS.trameEnHexa(octets),
      resultat: resultat
    });
    if (sim.trafic.length > 14) sim.trafic.pop();
    sim.traficChange = true;
  }

  function appliquerSorties(s) {
    var e = sim.energie;
    if (s.rafraichissement === "partiel") {
      e.chargeNetteMAh += TPMS.CONSO.ecranPartielMas / 3600;
      e.consommeMAh += TPMS.CONSO.ecranPartielMas / 3600;
    } else if (s.rafraichissement === "complet") {
      e.chargeNetteMAh += TPMS.CONSO.ecranCompletMas / 3600;
      e.consommeMAh += TPMS.CONSO.ecranCompletMas / 3600;
      sim.flashDemande = true;
    }
    if (s.rafraichissement !== "aucun") sim.ecranAChange = true;
    if (s.bip) {
      sim.bipDemande = true;
      e.chargeNetteMAh += TPMS.CONSO.bipMas / 3600;
      e.consommeMAh += TPMS.CONSO.bipMas / 3600;
    }
    sim.ledAlerte = s.ledAlerte;
    sim.ledsEclairage = s.ledsEclairage;
  }

  // -------------------------------------------------------------------
  // Énergie (module 5)
  // -------------------------------------------------------------------
  function mesurerEnergie(pas, t) {
    var b = sim.boitier;
    var e = sim.energie;
    e.courantMa = TPMS.consoInstantaneeMa({
      veille: b.veille,
      radio: TPMS.boitierEcoute(b, t),
      appConnectee: b.liaison.connecte,
      eclairage: b.eclairage && !b.veille,
      ledAlerte: sim.ledAlerte,
      reedColle: reedColle()
    });
    var charge = e.courantMa * pas / 3600000;
    e.chargeNetteMAh += charge;
    e.consommeMAh += charge;
    if (b.enCharge) {
      // Le chargeur du XIAO fournit environ 100 mA.
      e.chargeNetteMAh = Math.max(e.chargeNetteMAh - 100 * pas / 3600000,
        -e.pctDepart / 100 * TPMS.LIPO_MAH * TPMS.LIPO_UTILE);
    }
    if (e.decharge) {
      var pct = e.pctDepart - e.chargeNetteMAh / (TPMS.LIPO_MAH * TPMS.LIPO_UTILE) * 100;
      b.batteriePct = Math.max(0, Math.min(100, pct));
    }
  }

  // -------------------------------------------------------------------
  // Liaison avec l'application (cadre §3)
  // -------------------------------------------------------------------
  var cadreApp = $("cadreApp");

  function versApp(message) {
    message.tMs = sim.tMs;
    cadreApp.contentWindow.postMessage(message, "*");
  }

  function noterEchange(sens, quoi, detail) {
    sim.echanges.unshift({ tMs: sim.tMs, sens: sens, quoi: quoi, detail: detail });
    if (sim.echanges.length > 14) sim.echanges.pop();
    sim.echangesChange = true;
  }

  // Notification MESURES : toutes les 5 s simulées, mais au plus
  // 10 fois par seconde réelle quand le temps est accéléré.
  function notifierApp(t) {
    var b = sim.boitier;
    if (b.veille && b.liaison.connecte) {
      // En veille la radio s'éteint : le téléphone perd la connexion.
      TPMS.liaisonDeconnexion(b, t);
      versApp({ type: "deconnecte" });
      return;
    }
    if (!b.liaison.connecte || t < sim.prochaineNotifMs) return;
    sim.prochaineNotifMs = t + NOTIF_APP_MS;
    var maintenantReel = performance.now();
    if (maintenantReel - sim.derniereNotifReel < 100) return;
    sim.derniereNotifReel = maintenantReel;
    var octets = TPMS.liaisonMesures(b, t);
    noterEchange("boîtier → app", "MESURES (notification)", TPMS.trameEnHexa(octets));
    versApp({ type: "mesures", octets: Array.from(octets) });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== cadreApp.contentWindow) return;   // seulement notre app
    var m = e.data;
    var b = sim.boitier;
    var t = sim.tMs;
    var r, octets;
    switch (m.type) {
      case "connexion":
        // Un boîtier en veille n'émet pas : le téléphone ne le trouve pas.
        r = b.veille ? "absent" : TPMS.liaisonConnexion(b, t);
        noterEchange("app → boîtier", "Connexion", r);
        versApp({ type: "connexion-resultat", resultat: r });
        if (r === "connecte") sim.prochaineNotifMs = t;
        break;
      case "code":
        r = TPMS.liaisonSaisirCode(b, m.code, t);
        noterEchange("app → boîtier", "Appairage, code " + m.code, r);
        versApp({ type: "code-resultat", resultat: r });
        if (r === "ok") sim.prochaineNotifMs = t;
        break;
      case "lireReglages":
        octets = TPMS.liaisonLireReglages(b);
        noterEchange("boîtier → app", "REGLAGES (lecture)", octets ? TPMS.trameEnHexa(octets) : "refusée");
        versApp({ type: "reglages", octets: octets ? Array.from(octets) : null });
        break;
      case "ecrireReglages":
        r = TPMS.liaisonEcrireReglages(b, new Uint8Array(m.octets), t);
        noterEchange("app → boîtier", "REGLAGES (écriture)", TPMS.trameEnHexa(m.octets) + " → " + r);
        versApp({ type: "ecriture-resultat", resultat: r });
        synchroniserReglages();
        break;
      case "commande":
        r = TPMS.liaisonCommande(b, m.octet, t);
        noterEchange("app → boîtier", "COMMANDE", TPMS.octetEnHexa(m.octet) + " → " + r);
        versApp({ type: "commande-resultat", resultat: r });
        break;
      case "deconnexion":
        TPMS.liaisonDeconnexion(b, t);
        break;
      case "oublier":
        TPMS.liaisonOublier(b, t);
        break;
    }
    // L'écran réagit tout de suite (code d'appairage, mention APP).
    appliquerSorties(TPMS.boitierMiseAJour(b, t));
  });

  // -------------------------------------------------------------------
  // Affichage : le banc (toujours visible)
  // -------------------------------------------------------------------
  var ctx = $("ecran").getContext("2d");
  var image = ctx.createImageData(TPMS.ECRAN_LARGEUR, TPMS.ECRAN_HAUTEUR);

  // Copie la mémoire d'image du boîtier dans le canvas, pixel par pixel.
  function dessinerCanvas() {
    var pixels = sim.boitier.ecranAffiche.pixels;
    for (var i = 0; i < pixels.length; i++) {
      var noir = pixels[i] === TPMS.NOIR;
      image.data[i * 4]     = noir ? 0x1C : 0xDC;
      image.data[i * 4 + 1] = noir ? 0x1C : 0xDA;
      image.data[i * 4 + 2] = noir ? 0x1A : 0xD1;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function afficherBanc() {
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
    $("ledAlerte").className = "led led-alerte " + sim.ledAlerte;
    $("ledEclairageG").classList.toggle("on", sim.ledsEclairage);
    $("ledEclairageD").classList.toggle("on", sim.ledsEclairage);
    $("voyantRadio").classList.toggle("on", TPMS.boitierEcoute(sim.boitier, sim.tMs));

    $("roueRotation").setAttribute("transform", "rotate(" + sim.roue.angleDeg.toFixed(1) + " 100 100)");
    $("reed").classList.toggle("top", performance.now() - sim.roue.dernierTopReel < 90 || reedColle());
    $("horloge").textContent = heure(sim.tMs);
  }

  function afficherReleveBanc() {
    var b = sim.boitier;
    var lignes = [
      ["Mode", b.veille ? "veille" : "en marche"],
      ["Radio", b.veille ? "coupée" : (TPMS.boitierEcoute(b, sim.tMs) ? "écoute" : "coupée")],
      ["Courant", nombre(sim.energie.courantMa, sim.energie.courantMa < 0.1 ? 3 : 2) + " mA"],
      ["Batterie", nombre(b.batteriePct, 1) + " %" + (b.enCharge ? " · charge" : "")],
      ["App", b.liaison.connecte ? "connectée" : (b.liaison.code ? "code affiché" : "—")],
      ["Pirate", sim.pirate.actif ? sim.pirate.attaque + " → " + NOMS[sim.pirate.cible].toLowerCase() : "—"]
    ];
    var html = "";
    lignes.forEach(function (l) { html += "<dt>" + l[0] + "</dt><dd>" + l[1] + "</dd>"; });
    $("releveBanc").innerHTML = html;
  }

  // -------------------------------------------------------------------
  // §1 Capteurs et trames
  // -------------------------------------------------------------------
  function afficherCapteurs() {
    POSITIONS.forEach(function (pos) {
      var c = sim.capteurs[pos];
      var bloc = $("capteur" + pos);
      var curseur = bloc.querySelector('[data-champ="pression"]');
      // On ne déplace pas le curseur pendant que l'utilisateur le tient.
      if (curseur.dataset.glisse !== "1") curseur.value = c.pressionBar;
      bloc.querySelector('[data-sortie="pression"]').textContent = nombre(c.pressionBar, 2) + " bar";
      bloc.querySelector('[data-sortie="temperature"]').textContent = nombre(c.temperatureC, 1) + " °C";
      bloc.querySelector('[data-sortie="pile"]').textContent = c.batteriePct + " %";
      bloc.querySelector('[data-action="crevaison"]').classList.toggle("actif", c.crevaison);
      bloc.classList.toggle("capteur-inactif", !c.actif);
    });
  }

  var CHAMPS = [
    { nom: "Fabricant",   court: "fab.",      debut: 0,  fin: 2 },
    { nom: "N° capteur",  court: "n°",        debut: 2,  fin: 3 },
    { nom: "Adresse",     court: "adresse",   debut: 3,  fin: 8 },
    { nom: "Pression",    court: "pression · Pa", debut: 8, fin: 12 },
    { nom: "Température", court: "temp. · c°C", debut: 12, fin: 16 },
    { nom: "Pile",        court: "pile",      debut: 16, fin: 17 },
    { nom: "Alarme",      court: "al.",       debut: 17, fin: 18 }
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
      case "Pression":
        return "lu à l'envers 0x" + TPMS.octetEnHexa(o[11]) + TPMS.octetEnHexa(o[10]) +
          TPMS.octetEnHexa(o[9]) + TPMS.octetEnHexa(o[8]) + " = " +
          TPMS.lireInt32LE(o, 8).toLocaleString("fr-FR") + " Pa = <b>" + nombre(m.pressionBar, 2) + " bar</b>";
      case "Température":
        return TPMS.lireInt32LE(o, 12) + " centièmes = <b>" + nombre(m.temperatureC, 2) + " °C</b>";
      case "Pile":
        return "<b>" + m.batteriePct + " %</b>";
      default:
        return o[17] === 0 ? "0x00 : OK" : "<b>0x01 : pas de pression</b>";
    }
  }

  function afficherRegistres() {
    POSITIONS.forEach(function (pos) {
      var trame = sim.dernieresTrames[pos];
      if (!trame || versionsAffichees[pos] === sim.versionTrames[pos]) return;
      versionsAffichees[pos] = sim.versionTrames[pos];

      var o = trame.octets;
      var m = TPMS.decoderTrame(o);
      var index = "", hexa = "", champs = "", lignes = "";
      for (var i = 0; i < o.length; i++) {
        var pression = i >= 8 && i < 12 ? ' class="champ-pression"' : "";
        index += "<td>" + i + "</td>";
        hexa += "<td" + pression + ">" + TPMS.octetEnHexa(o[i]) + "</td>";
      }
      CHAMPS.forEach(function (champ) {
        var morceaux = [];
        for (var j = champ.debut; j < champ.fin; j++) morceaux.push(TPMS.octetEnHexa(o[j]));
        var classe = champ.nom === "Pression" ? ' class="champ-pression"' : "";
        champs += "<td colspan=\"" + (champ.fin - champ.debut) + "\"" + classe + ">" + champ.court + "</td>";
        lignes += "<tr><td>" + champ.nom + "</td><td>" + morceaux.join(" ") + "</td><td>" +
          sensChamp(o, m, champ.nom) + "</td></tr>";
      });
      var bloc = $("registre" + pos);
      bloc.querySelector(".registre-tete").innerHTML =
        "<b>Capteur " + NOMS[pos].toLowerCase() + "</b><span>émise à " + heure(trame.tMs) + " · " +
        verdict(trame.resultat, "capteur") + "</span>";
      bloc.querySelector(".registre").innerHTML =
        '<tr class="index">' + index + '</tr><tr class="hexa">' + hexa + '</tr><tr class="champs">' + champs + "</tr>";
      bloc.querySelector(".decodage").innerHTML = lignes;
    });
  }

  function afficherTrafic() {
    if (!sim.traficChange) return;
    sim.traficChange = false;
    var html = "<tr><th>Heure</th><th>Émetteur (réel)</th><th>Annonce</th><th>Boîtier</th></tr>";
    sim.trafic.forEach(function (l) {
      html += "<tr" + (l.source === "pirate" ? ' class="ligne-pirate"' : "") + ' title="' + l.hexa + '"><td>' +
        heure(l.tMs) + "</td><td>" + l.emetteur + '</td><td class="mono">' + l.pression + "</td><td>" +
        verdict(l.resultat, l.source) + "</td></tr>";
    });
    $("tableTrafic").innerHTML = html;
    $("tableTrafic4").innerHTML = html;
  }

  // -------------------------------------------------------------------
  // §2 Boîtier
  // -------------------------------------------------------------------
  function afficherStats() {
    var b = sim.boitier;
    var s = b.stats;
    function pente(pos) {
      var roue = b.roues[pos];
      return nombre(roue.penteBarH, 3) + " bar/h · " + roue.historique.tMs.length + " pts";
    }
    var lignes = [
      ["Trames acceptées", s.tramesAcceptees],
      ["Trames non reçues (radio coupée)", s.tramesManquees],
      ["Trames ignorées (capteur inconnu)", s.tramesInconnues],
      ["Trames rejetées (vraisemblance)", s.rejetsVraisemblance],
      ["Trames rejetées (signal suspect)", s.rejetsRythme],
      ["Intrusions détectées", s.intrusions],
      ["Écran : rafraîchissements partiels", s.rafraichissementsPartiels],
      ["Écran : rafraîchissements complets", s.rafraichissementsComplets],
      ["Tendance avant", pente("AV")],
      ["Tendance arrière", pente("AR")],
      ["Tours de roue comptés", b.compteur.nbTours],
      ["Distance du trajet", nombre(TPMS.compteurDistanceKm(b.compteur), 3) + " km"]
    ];
    var html = "";
    lignes.forEach(function (l) { html += "<tr><td>" + l[0] + "</td><td>" + l[1] + "</td></tr>"; });
    $("tableStats").innerHTML = html;
  }

  var MOTS_ALERTE = /PERDU|CREVAISON|BASSE|HAUTE|FUITE|SUSPECT|faux|bloqué|refusés/;

  function afficherJournal() {
    var b = sim.boitier;
    if (b.journal.length === 0) return;
    // On récupère les messages du boîtier (en vrai : le port série).
    while (b.journal.length > 0) sim.journal.unshift(b.journal.shift());
    if (sim.journal.length > 120) sim.journal.length = 120;
    var html = "";
    sim.journal.forEach(function (ligne) {
      var classe = MOTS_ALERTE.test(ligne.texte) ? ' class="alerte"' : "";
      html += '<li><span class="heure">' + heure(ligne.tMs) + "</span><span" + classe + ">" + ligne.texte + "</span></li>";
    });
    $("journal").innerHTML = html;
  }

  // Les réglages ont pu changer depuis l'app : on remet les champs à jour.
  function synchroniserReglages() {
    var r = sim.boitier.reglages;
    $("seuilAVbas").value = r.seuils.AV.basBar;
    $("seuilAVhaut").value = r.seuils.AV.hautBar;
    $("seuilARbas").value = r.seuils.AR.basBar;
    $("seuilARhaut").value = r.seuils.AR.hautBar;
    var circ = $("selCirconference");
    if (!circ.querySelector('option[value="' + r.circonferenceMm + '"]')) {
      var option = document.createElement("option");
      option.value = r.circonferenceMm;
      option.textContent = "réglée par l'app — " + r.circonferenceMm + " mm";
      circ.appendChild(option);
    }
    circ.value = r.circonferenceMm;
    var veille = $("selVeille");
    if (!veille.querySelector('option[value="' + r.delaiVeilleMs + '"]')) {
      var opt = document.createElement("option");
      opt.value = r.delaiVeilleMs;
      opt.textContent = (r.delaiVeilleMs / 1000) + " s immobile";
      veille.appendChild(opt);
    }
    veille.value = r.delaiVeilleMs;
    ["listeBlanche", "vraisemblance", "rythme"].forEach(function (k) {
      $("prot-" + k).checked = r.protections[k];
    });
  }

  // -------------------------------------------------------------------
  // §3 Application
  // -------------------------------------------------------------------
  function afficherLiaison() {
    var b = sim.boitier;
    var l = b.liaison;
    var code = l.code
      ? l.code + " · expire dans " + Math.max(0, Math.ceil((l.codeJusquaMs - sim.tMs) / 1000)) + " s"
      : "—";
    var lignes = [
      ["Connexion", l.connecte ? "établie" : "aucune"],
      ["Téléphone appairé", l.appaire ? "oui (clé mémorisée)" : "non"],
      ["Chiffrement", l.connecte && l.appaire ? "AES-CCM · BLE Secure Connections" : "—"],
      ["Code affiché", code],
      ["Appairage bloqué", sim.tMs < l.bloqueJusquaMs ? "encore " + Math.ceil((l.bloqueJusquaMs - sim.tMs) / 1000) + " s" : "non"],
      ["Notifications envoyées", l.sequence]
    ];
    var html = "";
    lignes.forEach(function (x) { html += "<tr><td>" + x[0] + "</td><td>" + x[1] + "</td></tr>"; });
    $("tableLiaison").innerHTML = html;

    if (!sim.echangesChange) return;
    sim.echangesChange = false;
    html = "<tr><th>Heure</th><th>Sens</th><th>Caractéristique</th><th>Contenu</th></tr>";
    sim.echanges.forEach(function (x) {
      html += "<tr><td>" + heure(x.tMs) + "</td><td>" + x.sens + "</td><td>" + x.quoi + "</td><td>" + x.detail + "</td></tr>";
    });
    $("tableEchanges").innerHTML = html;
  }

  // -------------------------------------------------------------------
  // §4 Cybersécurité
  // -------------------------------------------------------------------
  var PROTECTIONS = [
    { cle: "listeBlanche", nom: "Liste blanche",
      texte: "Seuls les deux capteurs appairés sont écoutés. Sans elle, le boîtier range les capteurs par numéro : le capteur n°1 du vélo voisin devient ta roue avant.",
      compteur: function (s) { return s.tramesInconnues + " ignorées"; } },
    { cle: "vraisemblance", nom: "Vraisemblance",
      texte: "Bornes physiques du capteur, et tout changement de plus de 0,3 bar/s doit être confirmé par 3 trames de suite. Seule, elle cède face à un pirate qui émet plus vite que le vrai capteur.",
      compteur: function (s) { return s.rejetsVraisemblance + " rejetées"; } },
    { cle: "rythme", nom: "Rythme",
      texte: "Le vrai capteur émet toutes les 3 s. Des trames plus rapprochées sous la même adresse trahissent un second émetteur : la roue passe en « signal suspect » pendant 1 min et garde sa dernière valeur de confiance.",
      compteur: function (s) { return s.intrusions + " intrusion" + (s.intrusions > 1 ? "s" : ""); } }
  ];

  function afficherCyber() {
    var p = sim.pirate;
    var b = sim.boitier;
    PROTECTIONS.forEach(function (pr) {
      $("compteur-" + pr.cle).textContent = pr.compteur(b.stats);
    });
    $("txtEnregistrement").textContent = p.enregistrement.length + " / " + TPMS.PIRATE_TAILLE_ENREGISTREMENT +
      (p.enregistre ? " · écoute…" : "");
    $("btnEnregistrer").classList.toggle("actif", p.enregistre);

    var html = "<tr><th>Roue</th><th>Pression réelle</th><th>Retenue par le boîtier</th><th>État affiché</th><th>Bilan</th></tr>";
    POSITIONS.forEach(function (pos) {
      var reelle = sim.capteurs[pos].pressionBar;
      var roue = b.roues[pos];
      var retenue = roue.mesure ? roue.mesure.pressionBar : null;
      var bilan;
      if (roue.etat === TPMS.ETAT.INTRUSION) {
        bilan = '<span class="verdict attente">attaque détectée, cycliste prévenu</span>';
      } else if (retenue === null) {
        bilan = '<span class="verdict non">pas encore de mesure</span>';
      } else if (Math.abs(reelle - retenue) > 0.25) {
        bilan = '<span class="verdict trompe">BOÎTIER TROMPÉ</span>';
      } else {
        bilan = '<span class="verdict ok">conforme</span>';
      }
      html += "<tr><td>" + NOMS[pos] + '</td><td class="mono">' + nombre(reelle, 2) + ' bar</td><td class="mono">' +
        (retenue === null ? "—" : nombre(retenue, 2) + " bar") + "</td><td>" + TPMS.texteEtat(roue.etat) +
        "</td><td>" + bilan + "</td></tr>";
    });
    $("tableVerite").innerHTML = html;
  }

  function afficherFormulairePirate() {
    var p = sim.pirate;
    $("ligneFaussePression").hidden = p.attaque !== "usurpation";
    $("ligneEnregistrement").hidden = p.attaque !== "rejeu";
    $("noteAttaque").textContent = p.attaque === "usurpation"
      ? "Usurpation : le pirate a relevé l'adresse et le numéro du capteur visé en écoutant l'air. Il diffuse des trames à son nom avec la pression de son choix, par exemple 0,30 bar pour simuler une crevaison."
      : "Rejeu : le pirate renvoie à l'identique des trames enregistrées plus tôt. Enregistre pendant que le pneu est gonflé, déclenche une crevaison au §1, puis active le pirate pour masquer la crevaison.";
  }

  // -------------------------------------------------------------------
  // §5 Autonomie
  // -------------------------------------------------------------------
  function afficherEnergie() {
    var e = sim.energie;
    var heures = sim.tMs / 3600000;
    var moyenMa = heures > 0 ? e.consommeMAh / heures : 0;
    var autonomie = moyenMa > 0 ? TPMS.LIPO_MAH * TPMS.LIPO_UTILE / moyenMa / 24 : 0;
    var lignes = [
      ["Courant instantané", nombre(e.courantMa, 3) + " mA"],
      ["Charge consommée", nombre(e.consommeMAh, 3) + " mAh"],
      ["Courant moyen depuis le début", nombre(moyenMa, 3) + " mA"],
      ["Autonomie à ce rythme", heures > 0 ? nombre(autonomie, 1) + " jours" : "—"],
      ["Aimant collé devant l'ILS", reedColle() ? "oui : +" + nombre(TPMS.CONSO.reedColleMa, 2) + " mA perdus" : "non"]
    ];
    var html = "";
    lignes.forEach(function (l) { html += "<tr><td>" + l[0] + "</td><td>" + l[1] + "</td></tr>"; });
    $("tableMesureEnergie").innerHTML = html;
  }

  function profilJournee() {
    var r = sim.boitier.reglages;
    function n(id) { var v = parseFloat($(id).value); return isNaN(v) ? 0 : v; }
    return {
      heuresRoulage: n("pfRoulage"),
      sortiesParJour: n("pfSorties"),
      heuresEclairage: n("pfEclairage"),
      heuresApp: n("pfApp"),
      alertesParJour: n("pfAlertes"),
      fenetreMs: r.ecouteFenetreMs,
      periodeMs: r.ecoutePeriodeMs,
      periodeEcranMs: r.periodeEcranMs,
      delaiVeilleMs: r.delaiVeilleMs
    };
  }

  var SVG = "http://www.w3.org/2000/svg";
  function element(nom, attributs, texte) {
    var el = document.createElementNS(SVG, nom);
    for (var cle in attributs) el.setAttribute(cle, attributs[cle]);
    if (texte !== undefined) el.textContent = texte;
    return el;
  }

  var dernierProfil = "";
  function afficherBilan() {
    var profil = profilJournee();
    var signature = JSON.stringify(profil);
    if (signature === dernierProfil) return;   // rien n'a changé
    dernierProfil = signature;

    var bilan = TPMS.bilanJournee(profil);
    var svg = $("grapheBilan");
    svg.innerHTML = "";
    var X0 = 190, L = 640, D = 70, hLigne = 28, y0 = 14;
    var max = 0;
    bilan.postes.forEach(function (p) { if (p.mAhJour > max) max = p.mAhJour; });
    var echelle = max > 0 ? (L - X0 - D) / max : 0;

    bilan.postes.forEach(function (p, i) {
      var y = y0 + i * hLigne;
      var largeur = Math.max(1, p.mAhJour * echelle);
      svg.appendChild(element("text", { x: X0 - 10, y: y + 13, "text-anchor": "end", class: "libelle" }, p.nom));
      svg.appendChild(element("rect", { x: X0, y: y + 3, width: largeur, height: 13,
        class: "barre" + (p.mAhJour === max ? " max" : "") }));
      svg.appendChild(element("text", { x: X0 + largeur + 6, y: y + 13, class: "valeur" },
        nombre(p.mAhJour, p.mAhJour < 0.1 ? 3 : 2) + " mAh"));
    });
    svg.appendChild(element("line", { x1: X0, x2: X0, y1: y0 - 4, y2: y0 + bilan.postes.length * hLigne, class: "grille" }));

    var suffisant = bilan.autonomieJours >= 7;
    $("legendeBilan").innerHTML = "<b>Fig. 4</b> — Consommation par poste sur une journée type. Total " +
      '<span class="resultat">' + nombre(bilan.totalMAhJour, 2) + " mAh/jour</span> → autonomie " +
      '<span class="resultat' + (suffisant ? "" : " insuffisant") + '">' + nombre(bilan.autonomieJours, 1) +
      " jours</span> avec la LiPo de 500 mAh utilisée à 90 % (exigence : au moins 7 jours" +
      (suffisant ? ", respectée)." : ", NON respectée).");
  }

  function afficherPiles() {
    var html = "<tr><th>Intervalle d'annonce</th><th>Courant moyen</th><th>Durée de vie de la pile</th></tr>";
    [1000, 3000, 5000, 10000, 30000].forEach(function (ms) {
      var jours = TPMS.dureeViePileCapteurJours(ms);
      var courantUa = (TPMS.CONSO_CAPTEUR.sommeilMa + TPMS.CONSO_CAPTEUR.annonceMas / (ms / 1000)) * 1000;
      html += "<tr" + (ms === 3000 ? ' style="font-weight:600"' : "") + "><td>" + nombre(ms / 1000, 0) + " s" +
        (ms === 3000 ? " (simulé)" : "") + '</td><td class="mono">' + nombre(courantUa, 1) + ' µA</td><td class="mono">' +
        Math.round(jours) + " jours ≈ " + nombre(jours / 365, 1) + " an" + (jours >= 730 ? "s" : "") + "</td></tr>";
    });
    $("tablePiles").innerHTML = html;
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
  // Construction des blocs répétés
  // -------------------------------------------------------------------
  function ligneReglage(champ, libelle, min, max, pas) {
    return '<div class="reglage"><span>' + libelle + "</span>" +
      '<input type="range" data-champ="' + champ + '" min="' + min + '" max="' + max + '" step="' + pas + '">' +
      '<output data-sortie="' + champ + '"></output></div>';
  }

  // Un groupe de boutons dont un seul est actif à la fois.
  function brancherSegments(conteneur, rappel) {
    var boutons = conteneur.querySelectorAll("button");
    boutons.forEach(function (bouton) {
      bouton.addEventListener("click", function () {
        boutons.forEach(function (b) { b.classList.toggle("actif", b === bouton); });
        rappel(bouton);
      });
    });
  }

  function construireCapteur(pos) {
    var c = sim.capteurs[pos];
    var bloc = document.createElement("div");
    bloc.className = "capteur";
    bloc.id = "capteur" + pos;
    bloc.innerHTML =
      '<div class="capteur-tete"><h3>' + NOMS[pos] + "</h3><code>n°" + c.numero + " · " +
      TPMS.adresseEnTexte(c.adresse) + "</code></div>" +
      ligneReglage("pression", "Pression", 0, 4, 0.01) +
      ligneReglage("temperature", "Température", -10, 50, 0.5) +
      ligneReglage("pile", "Pile CR1632", 0, 100, 1) +
      '<div class="reglage"><span>Fuite</span><span class="segments petit" data-champ="fuite">' +
      '<button type="button" data-valeur="0" class="actif">0</button>' +
      '<button type="button" data-valeur="0.1">0,1</button>' +
      '<button type="button" data-valeur="0.3">0,3</button>' +
      '<button type="button" data-valeur="1">1</button>' +
      '<button type="button" data-valeur="5">5</button>' +
      '</span><output>bar/h</output></div>' +
      '<div class="actions">' +
      '<button type="button" class="bouton alerte" data-action="crevaison">Crevaison</button>' +
      '<button type="button" class="bouton" data-action="regonfler">Regonfler à ' + nombre(NOMINAL[pos], 1) + " bar</button>" +
      '<label class="case" style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;font-size:12px">' +
      '<input type="checkbox" data-champ="actif" checked> Émet</label>' +
      "</div>";
    $("blocsCapteurs").appendChild(bloc);

    var pression = bloc.querySelector('[data-champ="pression"]');
    pression.value = c.pressionBar;
    pression.addEventListener("pointerdown", function () { pression.dataset.glisse = "1"; });
    pression.addEventListener("input", function () { c.pressionBar = parseFloat(pression.value); });

    var temperature = bloc.querySelector('[data-champ="temperature"]');
    temperature.value = c.temperatureC;
    temperature.addEventListener("input", function () { c.temperatureC = parseFloat(temperature.value); });

    var pile = bloc.querySelector('[data-champ="pile"]');
    pile.value = c.batteriePct;
    pile.addEventListener("input", function () { c.batteriePct = parseInt(pile.value, 10); });

    brancherSegments(bloc.querySelector('[data-champ="fuite"]'), function (b) {
      c.fuiteBarH = parseFloat(b.dataset.valeur);
    });
    bloc.querySelector('[data-champ="actif"]').addEventListener("change", function (e) {
      c.actif = e.target.checked;
    });
    bloc.querySelector('[data-action="crevaison"]').addEventListener("click", function () {
      c.crevaison = !c.crevaison;
    });
    bloc.querySelector('[data-action="regonfler"]').addEventListener("click", function () {
      c.crevaison = false;
      c.pressionBar = NOMINAL[pos];
    });
  }

  function construireRegistre(pos) {
    var bloc = document.createElement("div");
    bloc.className = "registre-bloc";
    bloc.id = "registre" + pos;
    bloc.innerHTML =
      '<div class="registre-tete"><b>Capteur ' + NOMS[pos].toLowerCase() + "</b><span>en attente de la première annonce…</span></div>" +
      '<div class="registre-defilement"><table class="registre"></table></div>' +
      '<table class="decodage"></table>';
    $("registres").appendChild(bloc);
  }

  function construireProtections() {
    var html = "";
    PROTECTIONS.forEach(function (pr) {
      html += '<label class="protection"><input type="checkbox" id="prot-' + pr.cle + '"' +
        (sim.boitier.reglages.protections[pr.cle] ? " checked" : "") + "><b>" + pr.nom + "</b>" +
        '<span class="compteur" id="compteur-' + pr.cle + '"></span><p>' + pr.texte + "</p></label>";
    });
    $("protections").innerHTML = html;
    PROTECTIONS.forEach(function (pr) {
      $("prot-" + pr.cle).addEventListener("change", function (e) {
        sim.boitier.reglages.protections[pr.cle] = e.target.checked;
      });
    });
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

  // -------------------------------------------------------------------
  // Branchement des commandes
  // -------------------------------------------------------------------
  function brancherCommandes() {
    var b = sim.boitier;

    // Le curseur de pression peut à nouveau suivre le capteur une fois relâché.
    window.addEventListener("pointerup", function () {
      document.querySelectorAll('[data-champ="pression"]').forEach(function (c) { c.dataset.glisse = ""; });
    });

    // Cartouche
    $("btnPause").addEventListener("click", function () {
      sim.enPause = !sim.enPause;
      $("btnPause").textContent = sim.enPause ? "Reprendre" : "Pause";
      $("btnPause").classList.toggle("actif", sim.enPause);
    });
    brancherSegments($("choixFacteur"), function (bouton) { sim.facteur = parseInt(bouton.dataset.facteur, 10); });
    $("btnReinit").addEventListener("click", function () { location.reload(); });

    // Sections
    var sections = document.querySelectorAll("#sections button");
    function ouvrirSection(id) {
      sections.forEach(function (s) { s.classList.toggle("actif", s.dataset.section === id); });
      document.querySelectorAll(".section").forEach(function (s) { s.hidden = s.id !== id; });
      try { localStorage.setItem("tpms-sim-section", id); } catch (e) { /* sans importance */ }
    }
    sections.forEach(function (s) {
      s.addEventListener("click", function () { ouvrirSection(s.dataset.section); });
    });
    try {
      var memorisee = localStorage.getItem("tpms-sim-section");
      if (memorisee && $(memorisee)) ouvrirSection(memorisee);
    } catch (e) { /* stockage indisponible : on reste sur §1 */ }

    // Roue
    var curseurVitesse = $("curVitesseVelo");
    var raccourcis = $("raccourcisVitesse").querySelectorAll("button");
    function changerVitesse(v) {
      sim.roue.vitesseKmh = v;
      curseurVitesse.value = v;
      $("txtVitesseVelo").textContent = nombre(v, 1);
      raccourcis.forEach(function (r) { r.classList.toggle("actif", parseFloat(r.dataset.vitesse) === v); });
    }
    curseurVitesse.addEventListener("input", function () { changerVitesse(parseFloat(curseurVitesse.value)); });
    raccourcis.forEach(function (r) {
      r.addEventListener("click", function () { changerVitesse(parseFloat(r.dataset.vitesse)); });
    });

    brancherBouton("bouton1", 1);
    brancherBouton("bouton2", 2);

    // §1
    $("chkVoisin").addEventListener("change", function (e) { sim.voisinPresent = e.target.checked; });

    // §2
    $("selCirconference").addEventListener("change", function (e) {
      var mm = parseInt(e.target.value, 10);
      b.reglages.circonferenceMm = mm;
      b.compteur.circonferenceMm = mm;
    });
    [["seuilAVbas", "AV", "basBar"], ["seuilAVhaut", "AV", "hautBar"],
     ["seuilARbas", "AR", "basBar"], ["seuilARhaut", "AR", "hautBar"]].forEach(function (s) {
      var champ = $(s[0]);
      champ.addEventListener("change", function () {
        var v = parseFloat(champ.value);
        if (!isNaN(v)) b.reglages.seuils[s[1]][s[2]] = v;
      });
    });
    $("selEcoute").addEventListener("change", function (e) {
      var morceaux = e.target.value.split("/");
      b.reglages.ecouteFenetreMs = parseInt(morceaux[0], 10);
      b.reglages.ecoutePeriodeMs = parseInt(morceaux[1], 10);
    });
    $("selPeriodeEcran").addEventListener("change", function (e) {
      b.reglages.periodeEcranMs = parseInt(e.target.value, 10);
    });
    $("selVeille").addEventListener("change", function (e) {
      b.reglages.delaiVeilleMs = parseInt(e.target.value, 10);
    });
    $("curBatterie").addEventListener("input", function (e) {
      // Nouveau point de départ : on repart d'une batterie à ce niveau.
      sim.energie.pctDepart = parseInt(e.target.value, 10);
      sim.energie.chargeNetteMAh = 0;
      b.batteriePct = sim.energie.pctDepart;
      $("txtBatterie").textContent = sim.energie.pctDepart + " %";
    });
    $("chkCharge").addEventListener("change", function (e) { b.enCharge = e.target.checked; });

    // §3
    $("btnOublierTel").addEventListener("click", function () {
      TPMS.liaisonOublier(b, sim.tMs);
      versApp({ type: "deconnecte" });
      appliquerSorties(TPMS.boitierMiseAJour(b, sim.tMs));
    });

    // §4
    var p = sim.pirate;
    $("chkPirate").addEventListener("change", function (e) { p.actif = e.target.checked; });
    brancherSegments($("choixCible"), function (bouton) {
      p.cible = bouton.dataset.cible;
      p.enregistrement = [];
    });
    brancherSegments($("choixAttaque"), function (bouton) {
      p.attaque = bouton.dataset.attaque;
      afficherFormulairePirate();
    });
    brancherSegments($("choixCadence"), function (bouton) { p.intervalleMs = parseInt(bouton.dataset.cadence, 10); });
    $("curFaussePression").addEventListener("input", function (e) {
      p.pressionFausseBar = parseFloat(e.target.value);
      $("txtFaussePression").textContent = nombre(p.pressionFausseBar, 2) + " bar";
    });
    $("btnEnregistrer").addEventListener("click", function () {
      p.enregistrement = [];
      p.indexRejeu = 0;
      p.enregistre = true;
    });

    // §5
    $("chkDecharge").addEventListener("change", function (e) { sim.energie.decharge = e.target.checked; });
  }

  // -------------------------------------------------------------------
  // Boucle principale : environ 30 fois par seconde.
  // Un minuteur (et pas requestAnimationFrame) pour que la simulation
  // continue quand l'onglet passe en arrière-plan : le navigateur le
  // ralentit alors à 1 fois par seconde, d'où la limite de 1 s par tour.
  // -------------------------------------------------------------------
  var dernierInstant = null;
  var dernierAffichagePanneaux = 0;

  function sectionOuverte(id) {
    return !$(id).hidden;
  }

  function boucle() {
    var instant = performance.now();
    if (dernierInstant !== null && !sim.enPause) {
      var dtReel = Math.min(instant - dernierInstant, 1000);
      avancer(dtReel * sim.facteur);
    }
    dernierInstant = instant;

    afficherBanc();
    // Les tableaux texte sont rafraîchis 5 fois par seconde : c'est assez,
    // et seulement pour la section visible.
    if (instant - dernierAffichagePanneaux > 200) {
      dernierAffichagePanneaux = instant;
      afficherReleveBanc();
      afficherJournal();
      if (sectionOuverte("s1")) { afficherCapteurs(); afficherRegistres(); afficherTrafic(); }
      if (sectionOuverte("s2")) afficherStats();
      if (sectionOuverte("s3")) afficherLiaison();
      if (sectionOuverte("s4")) { afficherCyber(); afficherTrafic(); }
      if (sectionOuverte("s5")) { afficherEnergie(); afficherBilan(); }
    }
  }

  POSITIONS.forEach(construireCapteur);
  POSITIONS.forEach(construireRegistre);
  construireProtections();
  brancherCommandes();
  synchroniserReglages();
  afficherFormulairePirate();
  afficherPiles();
  setInterval(boucle, 33);
})();
