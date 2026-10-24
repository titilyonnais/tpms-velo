// =====================================================================
// app.js — Application du kit TPMS (téléphone)
// ---------------------------------------------------------------------
// Rôles de l'application :
//   - afficher les pressions envoyées par le boîtier ;
//   - garder un HISTORIQUE long (plusieurs jours) des pressions ;
//   - repérer les fuites TRÈS lentes, invisibles pour le boîtier qui ne
//     garde que 20 minutes de mesures, et prévoir quand regonfler ;
//   - modifier les réglages du boîtier (lien chiffré obligatoire).
//
// L'app ne parle jamais directement à la radio : elle passe par un
// « transport » (vrai Bluetooth ou simulateur), qui offre les mêmes
// fonctions dans les deux cas.
// =====================================================================
(function () {
  "use strict";

  var transport = /[?&]transport=simule/.test(location.search) ? TransportSimule : TransportBLE;

  var HISTO_ECART_MS = 60000;      // un point d'historique par minute au plus
  var HISTO_MAX = 20000;           // ≈ 2 semaines à raison d'un point par minute
  var SAUT_REGONFLAGE_BAR = 0.2;   // même règle que logique/fuite.js
  var FUITE_BAR_JOUR = -0.05;      // une chambre à air perd naturellement ~0,02 bar/jour

  var TEXTE_ETAT = {
    ATTENTE: "En attente du capteur",
    INTRUSION: "Signal suspect : possible faux capteur",
    PERDU: "Capteur muet",
    CREVAISON: "Crevaison",
    BASSE: "Pression basse",
    HAUTE: "Pression trop haute",
    FUITE: "Fuite lente",
    OK: "Pression correcte"
  };

  var etat = {
    connecte: false,
    mesures: null,
    reglages: null,
    demandeSensible: null,   // réglages sensibles envoyés, en attente du bouton du boîtier
    derniereSequence: -1,
    perdues: 0,
    periodeHeures: 24,
    // En simulation, le temps repart de zéro à chaque ouverture :
    // on ne reprend pas l'ancien historique.
    historique: transport === TransportSimule ? [] : chargerHistorique()
  };

  function $(id) { return document.getElementById(id); }

  function nombre(x, decimales) {
    return x.toFixed(decimales).replace(".", ",");
  }

  function date(tMs, avecJour) {
    var d = new Date(tMs);
    var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (!avecJour) return hh;
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + " " + hh;
  }

  // -------------------------------------------------------------------
  // Navigation entre les vues
  // -------------------------------------------------------------------
  var VUES_ONGLETS = ["vuePneus", "vueHistorique", "vueReglages"];

  function afficherVue(id) {
    document.querySelectorAll(".vue").forEach(function (v) { v.hidden = v.id !== id; });
    $("onglets").hidden = VUES_ONGLETS.indexOf(id) < 0;
    document.querySelectorAll("#onglets button").forEach(function (b) {
      b.classList.toggle("actif", b.dataset.vue === id);
    });
    if (id === "vueHistorique") dessinerHistorique();
  }

  function vueActive() {
    var v = document.querySelector(".vue:not([hidden])");
    return v ? v.id : "";
  }

  function afficherLiaison() {
    $("etatLiaison").classList.toggle("on", etat.connecte);
    $("texteLiaison").textContent = etat.connecte ? "Boîtier connecté" : "Non connecté";
  }

  // -------------------------------------------------------------------
  // Connexion et appairage
  // -------------------------------------------------------------------
  async function connecter() {
    $("erreurConnexion").textContent = "";
    if (!transport.disponible()) {
      $("erreurConnexion").textContent = "Web Bluetooth n'est pas disponible dans ce navigateur.";
      return;
    }
    var resultat;
    try {
      resultat = await transport.connecter();
    } catch (e) {
      $("erreurConnexion").textContent = "Connexion impossible : " + e.message;
      return;
    }
    if (resultat === "code-requis") {
      $("champCode").value = "";
      $("erreurCode").textContent = "";
      afficherVue("vueCode");
      $("champCode").focus();
    } else if (resultat === "bloque") {
      $("erreurConnexion").textContent = "Trop de codes faux. Réessaie dans une minute.";
    } else if (resultat === "absent") {
      $("erreurConnexion").textContent = "Boîtier introuvable : il est sans doute en veille. Appuie sur un de ses boutons.";
    } else {
      connexionEtablie();
    }
  }

  async function validerCode() {
    var resultat = await transport.saisirCode($("champCode").value.trim());
    if (resultat === "ok") {
      connexionEtablie();
    } else if (resultat === "faux") {
      $("erreurCode").textContent = "Code faux. Vérifie l'écran du boîtier.";
    } else {
      afficherVue("vueConnexion");
      $("erreurConnexion").textContent = resultat === "bloque"
        ? "Trop de codes faux : appairage bloqué une minute."
        : "Le code a expiré. Recommence la connexion.";
    }
  }

  async function connexionEtablie() {
    etat.connecte = true;
    etat.derniereSequence = -1;
    etat.perdues = 0;
    afficherLiaison();
    afficherVue("vuePneus");
    try {
      remplirReglages(TPMS.decoderReglages(await transport.lireReglages()));
    } catch (e) {
      $("messageReglages").textContent = "Lecture des réglages impossible : " + e.message;
    }
  }

  function connexionPerdue() {
    etat.connecte = false;
    etat.demandeSensible = null;   // le boîtier l'annule aussi à la déconnexion
    afficherLiaison();
    afficherVue("vueConnexion");
  }

  // -------------------------------------------------------------------
  // Réception des mesures (toutes les 5 s)
  // -------------------------------------------------------------------
  function recevoirMesures(octets) {
    var m = TPMS.decoderMesures(octets);
    if (m === null) return;
    // Le numéro de séquence révèle les notifications perdues.
    if (etat.derniereSequence >= 0) {
      var ecart = (m.sequence - etat.derniereSequence + 65536) % 65536;
      if (ecart > 1) etat.perdues += ecart - 1;
    }
    etat.derniereSequence = m.sequence;
    etat.mesures = m;
    suivreDemandeSensible(m);
    enregistrerHistorique(m);
    afficherPneus();
    if (vueActive() === "vueHistorique") dessinerHistorique();
  }

  function afficherRoue(id, r) {
    var carte = $(id);
    carte.querySelector(".valeur").textContent = r.pressionBar === null ? "–,––" : nombre(r.pressionBar, 2);
    carte.querySelector(".details").textContent = r.pressionBar === null ? "" :
      r.temperatureC + " °C · pile " + r.batteriePct + " %";
    carte.querySelector(".etat").textContent = TEXTE_ETAT[r.etat] || r.etat;
    carte.classList.toggle("alerte", TPMS.estAlerte(r.etat));
  }

  function afficherPneus() {
    var m = etat.mesures;
    if (!m) return;
    afficherRoue("roueAV", m.AV);
    afficherRoue("roueAR", m.AR);
    $("valVitesse").textContent = nombre(m.vitesseKmh, 1) + " km/h";
    $("valDistance").textContent = nombre(m.distanceKm, 2) + " km";
    $("valBatterie").textContent = m.batterieBoitierPct + " %" + (m.enCharge ? " · charge" : "");
    $("metaSequence").textContent = (m.veille ? "boîtier en veille · " : "") +
      "séq. " + m.sequence + " · " + etat.perdues + " perdue" + (etat.perdues > 1 ? "s" : "");
  }

  // -------------------------------------------------------------------
  // Historique
  // -------------------------------------------------------------------
  function chargerHistorique() {
    try {
      return JSON.parse(localStorage.getItem(transport.cleHistorique)) || [];
    } catch (e) {
      return [];
    }
  }

  var sauvegardePrevue = null;
  function sauvegarderHistorique() {
    // On regroupe les écritures : au plus une toutes les 5 secondes.
    if (sauvegardePrevue) return;
    sauvegardePrevue = setTimeout(function () {
      sauvegardePrevue = null;
      try {
        localStorage.setItem(transport.cleHistorique, JSON.stringify(etat.historique));
      } catch (e) { /* stockage plein ou interdit : l'historique reste en mémoire */ }
    }, 5000);
  }

  function enregistrerHistorique(m) {
    var t = transport.maintenant();
    var h = etat.historique;
    var dernier = h[h.length - 1];
    if (dernier && t - dernier.t < HISTO_ECART_MS) return;
    if (m.AV.pressionBar === null && m.AR.pressionBar === null) return;
    h.push({ t: t, av: m.AV.pressionBar, ar: m.AR.pressionBar });
    if (h.length > HISTO_MAX) h.splice(0, h.length - HISTO_MAX);
    sauvegarderHistorique();
  }

  function pointsAffiches() {
    if (etat.periodeHeures === 0) return etat.historique;
    var debut = transport.maintenant() - etat.periodeHeures * 3600000;
    return etat.historique.filter(function (p) { return p.t >= debut; });
  }

  var SVG = "http://www.w3.org/2000/svg";
  function element(nom, attributs, texte) {
    var el = document.createElementNS(SVG, nom);
    for (var cle in attributs) el.setAttribute(cle, attributs[cle]);
    if (texte !== undefined) el.textContent = texte;
    return el;
  }

  function dessinerHistorique() {
    var svg = $("courbe");
    svg.innerHTML = "";
    var points = pointsAffiches();
    var L = 340, H = 200, G = 30, D = 6, Hh = 8, B = 20;   // marges gauche, droite, haut, bas

    if (points.length < 2) {
      svg.appendChild(element("text", { x: L / 2, y: H / 2, "text-anchor": "middle", class: "vide" },
        "Pas encore assez de mesures"));
      afficherTendance();
      return;
    }

    // Échelle verticale : arrondie au demi-bar, seuils compris.
    var valeurs = [];
    points.forEach(function (p) {
      if (p.av !== null) valeurs.push(p.av);
      if (p.ar !== null) valeurs.push(p.ar);
    });
    if (etat.reglages) valeurs.push(etat.reglages.seuils.AV.basBar, etat.reglages.seuils.AR.basBar);
    var yMin = Math.floor(Math.min.apply(null, valeurs) * 2) / 2;
    var yMax = Math.ceil(Math.max.apply(null, valeurs) * 2) / 2;
    if (yMax - yMin < 1) yMax = yMin + 1;
    var tMin = points[0].t, tMax = points[points.length - 1].t;

    function x(t) { return G + (t - tMin) / (tMax - tMin) * (L - G - D); }
    function y(v) { return Hh + (yMax - v) / (yMax - yMin) * (H - Hh - B); }

    // Quadrillage tous les 0,5 bar
    for (var v = yMin; v <= yMax + 1e-9; v += 0.5) {
      svg.appendChild(element("line", { x1: G, x2: L - D, y1: y(v), y2: y(v), class: "grille" }));
      svg.appendChild(element("text", { x: G - 4, y: y(v) + 3, "text-anchor": "end", class: "axe" }, nombre(v, 1)));
    }
    // Seuils bas
    if (etat.reglages) {
      [["AV", "bas AV"], ["AR", "bas AR"]].forEach(function (s) {
        var yy = y(etat.reglages.seuils[s[0]].basBar);
        svg.appendChild(element("line", { x1: G, x2: L - D, y1: yy, y2: yy, class: "seuil" }));
        svg.appendChild(element("text", { x: L - D, y: yy - 3, "text-anchor": "end", class: "axe seuil-texte" }, s[1]));
      });
    }
    // Axe du temps
    var avecJour = tMax - tMin > 20 * 3600000;
    svg.appendChild(element("text", { x: G, y: H - 5, class: "axe" }, date(tMin, avecJour)));
    svg.appendChild(element("text", { x: L - D, y: H - 5, "text-anchor": "end", class: "axe" }, date(tMax, avecJour)));

    // Une courbe par roue ; un trou dans les données coupe la ligne.
    ["av", "ar"].forEach(function (cle) {
      var d = "";
      var leverStylo = true;
      points.forEach(function (p) {
        if (p[cle] === null) { leverStylo = true; return; }
        d += (leverStylo ? "M" : "L") + x(p.t).toFixed(1) + " " + y(p[cle]).toFixed(1) + " ";
        leverStylo = false;
      });
      svg.appendChild(element("path", { d: d, class: "courbe-" + cle }));
    });
    afficherTendance();
  }

  // Pente depuis le dernier regonflage, en bar par jour.
  function tendance(cle) {
    var h = etat.historique;
    var t = [], p = [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i][cle] === null) continue;
      // En remontant le temps, une forte BAISSE vers le passé = un regonflage.
      if (p.length > 0 && p[0] - h[i][cle] > SAUT_REGONFLAGE_BAR) break;
      t.unshift(h[i].t);
      p.unshift(h[i][cle]);
    }
    if (t.length < 10) return null;
    var dureeH = (t[t.length - 1] - t[0]) / 3600000;
    return {
      dureeH: dureeH,
      penteJour: TPMS.penteMoindresCarresParHeure(t, p) * 24,
      derniere: p[p.length - 1]
    };
  }

  function afficherTendance() {
    var lignes = "<tr><th>Roue</th><th>Pente</th><th>Diagnostic</th></tr>";
    [["av", "AV", "Avant"], ["ar", "AR", "Arrière"]].forEach(function (r) {
      var tend = tendance(r[0]);
      var pente = "–", diagnostic = "Pas encore de mesures";
      if (tend && tend.dureeH < 2) {
        diagnostic = "Pas assez de recul (" + nombre(tend.dureeH * 60, 0) + " min sur 2 h)";
      } else if (tend) {
        pente = nombre(tend.penteJour, 3) + " bar/j";
        if (tend.penteJour < FUITE_BAR_JOUR) {
          diagnostic = "<b>Fuite lente probable.</b> ";
        } else {
          diagnostic = "Perte normale. ";
        }
        if (etat.reglages) {
          // Même calcul que la prévision du boîtier (logique/fuite.js).
          var jours = TPMS.joursAvantSeuil(tend.derniere, tend.penteJour, etat.reglages.seuils[r[1]].basBar);
          diagnostic += jours === Infinity ? "Pression stable."
            : jours <= 0 ? "Sous le seuil bas : regonfler."
            : "Seuil bas atteint vers le " + date(transport.maintenant() + jours * 86400000, true).slice(0, 5) +
              " (dans " + Math.floor(jours) + " j).";
        }
      }
      lignes += "<tr><td>" + r[2] + "</td><td class=\"nombre\">" + pente + "</td><td>" + diagnostic + "</td></tr>";
    });
    $("tableTendance").innerHTML = lignes;
  }

  // Export CSV : les données sortent du téléphone, pour un tableur.
  function exporter() {
    var csv = "date;avant_bar;arriere_bar\n";
    etat.historique.forEach(function (p) {
      csv += new Date(p.t).toISOString() + ";" +
        (p.av === null ? "" : p.av.toFixed(3)) + ";" +
        (p.ar === null ? "" : p.ar.toFixed(3)) + "\n";
    });
    var lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    lien.download = "historique-pressions.csv";
    lien.click();
    URL.revokeObjectURL(lien.href);
  }

  // -------------------------------------------------------------------
  // Réglages
  // -------------------------------------------------------------------
  function remplirReglages(r) {
    if (!r) return;
    etat.reglages = r;
    $("regCirconference").value = r.circonferenceMm;
    $("regAVbas").value = r.seuils.AV.basBar;
    $("regAVhaut").value = r.seuils.AV.hautBar;
    $("regARbas").value = r.seuils.AR.basBar;
    $("regARhaut").value = r.seuils.AR.hautBar;
    $("regVeille").value = r.delaiVeilleMs / 1000;
    $("regListeBlanche").checked = r.protections.listeBlanche;
    $("regVraisemblance").checked = r.protections.vraisemblance;
    $("regRythme").checked = r.protections.rythme;
    $("regAdresseAV").value = r.appairage.AV;
    $("regAdresseAR").value = r.appairage.AR;
  }

  function lireFormulaire() {
    function n(id) { return parseFloat($(id).value); }
    return {
      circonferenceMm: Math.round(n("regCirconference")),
      seuils: {
        AV: { basBar: n("regAVbas"), hautBar: n("regAVhaut") },
        AR: { basBar: n("regARbas"), hautBar: n("regARhaut") }
      },
      delaiVeilleMs: Math.round(n("regVeille")) * 1000,
      protections: {
        listeBlanche: $("regListeBlanche").checked,
        vraisemblance: $("regVraisemblance").checked,
        rythme: $("regRythme").checked
      },
      appairage: {
        AV: $("regAdresseAV").value.trim().toUpperCase(),
        AR: $("regAdresseAR").value.trim().toUpperCase()
      }
    };
  }

  async function envoyerReglages(e) {
    e.preventDefault();
    var message = $("messageReglages");
    var r = lireFormulaire();
    // Même vérification que le boîtier : on prévient avant d'envoyer.
    var probleme = TPMS.verifierReglages(r);
    if (probleme !== "") {
      message.textContent = "À corriger : " + probleme + ".";
      message.className = "message erreur";
      return;
    }
    // Couper une protection ou changer de capteur : le boîtier attendra
    // un appui long sur son bouton 2 (voir TPMS.changementSensible).
    var sensible = etat.reglages !== null && TPMS.changementSensible(etat.reglages, r) !== 0;
    var resultat = await transport.ecrireReglages(TPMS.encoderReglages(r));
    // Avec la vraie radio, l'écriture réussit toujours : c'est le drapeau
    // « attente » de MESURES qui dira la suite. Le simulateur répond
    // directement "attente-bouton".
    if (resultat === "attente-bouton" || (resultat === "ok" && sensible)) {
      etat.demandeSensible = r;
      message.textContent = "Changement sensible : confirme-le sur le boîtier par un appui long sur le bouton 2 (30 s). Un autre bouton l'annule.";
      message.className = "message attention";
    } else if (resultat === "ok") {
      etat.reglages = r;
      message.textContent = "Réglages enregistrés dans le boîtier.";
      message.className = "message";
    } else {
      message.textContent = "Refusé : " + resultat + ".";
      message.className = "message erreur";
    }
  }

  // Suivi d'un changement sensible : tant que le drapeau est levé, le
  // boîtier attend. Dès qu'il est baissé, on relit les réglages EN
  // VIGUEUR pour savoir si le cycliste a confirmé ou non.
  // Le boîtier traite l'écriture avant d'envoyer sa notification
  // suivante : toute notification reçue après l'écriture en tient compte,
  // même si le cycliste a déjà répondu (drapeau jamais vu levé).
  async function suivreDemandeSensible(m) {
    var demandes = etat.demandeSensible;
    if (!demandes || m.attenteConfirmation) return;
    etat.demandeSensible = null;
    var message = $("messageReglages");
    try {
      var actuels = TPMS.decoderReglages(await transport.lireReglages());
      var confirme = actuels && TPMS.trameEnHexa(TPMS.encoderReglages(actuels)) === TPMS.trameEnHexa(TPMS.encoderReglages(demandes));
      remplirReglages(actuels);
      message.textContent = confirme
        ? "Changement confirmé sur le boîtier et appliqué."
        : "Changement annulé sur le boîtier (autre bouton, délai dépassé ou veille). Les anciens réglages restent en vigueur.";
      message.className = confirme ? "message" : "message erreur";
    } catch (e) {
      message.textContent = "Lecture des réglages impossible : " + e.message;
    }
  }

  // -------------------------------------------------------------------
  // Branchement
  // -------------------------------------------------------------------
  transport.surMesures(recevoirMesures);
  transport.surDeconnexion(connexionPerdue);

  $("btnConnecter").addEventListener("click", connecter);
  $("btnValiderCode").addEventListener("click", validerCode);
  $("champCode").addEventListener("keydown", function (e) { if (e.key === "Enter") validerCode(); });
  $("btnRaz").addEventListener("click", function () { transport.commande(TPMS.COMMANDE.RAZ_TRAJET); });
  $("btnAcquitter").addEventListener("click", function () { transport.commande(TPMS.COMMANDE.ACQUITTER); });
  $("formReglages").addEventListener("submit", envoyerReglages);
  $("btnExporter").addEventListener("click", exporter);
  $("btnEffacer").addEventListener("click", function () {
    if (!confirm("Effacer tout l'historique des pressions ?")) return;
    etat.historique = [];
    sauvegarderHistorique();
    dessinerHistorique();
  });
  $("btnDeconnecter").addEventListener("click", function () {
    transport.deconnecter();
    connexionPerdue();
  });
  $("btnOublier").addEventListener("click", function () {
    var remarque = transport.oublier();
    connexionPerdue();
    $("erreurConnexion").textContent = remarque || "";
  });
  document.querySelectorAll("#onglets button").forEach(function (b) {
    b.addEventListener("click", function () { afficherVue(b.dataset.vue); });
  });
  document.querySelectorAll("#choixPeriode button").forEach(function (b) {
    b.addEventListener("click", function () {
      etat.periodeHeures = parseInt(b.dataset.heures, 10);
      document.querySelectorAll("#choixPeriode button").forEach(function (a) { a.classList.toggle("actif", a === b); });
      dessinerHistorique();
    });
  });

  $("noteTransport").textContent = transport === TransportSimule
    ? "Mode simulateur : l'app parle au boîtier virtuel, avec les mêmes octets que par radio."
    : (transport.disponible()
      ? "La page doit être ouverte en HTTPS. Sur iPhone, utilise le navigateur Bluefy."
      : "Web Bluetooth est absent de ce navigateur. Sur iPhone, ouvre cette page dans l'app Bluefy ; sur PC ou Android, utilise Chrome.");
  afficherLiaison();
  afficherVue("vueConnexion");
})();
