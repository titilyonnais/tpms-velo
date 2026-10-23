// =====================================================================
// presentation.js — Navigation du diaporama et dessin des écrans e-paper
// ---------------------------------------------------------------------
// Aucune bibliothèque : JavaScript simple, sans framework.
//
// 1. Mise à l'échelle : chaque diapositive mesure 1600 × 900 pixels
//    « virtuels » ; on agrandit ou réduit la scène pour remplir la
//    fenêtre en gardant le format 16:9.
// 2. Navigation : flèches, espace, Page préc./suiv., Début/Fin, clic,
//    glissement au doigt. L'adresse garde la diapositive courante (#7).
// 3. Écrans e-paper : dessinés par les VRAIS fichiers du projet
//    (police5x7.js, epaper.js, ecran.js, alertes.js, fuite.js), c'est-à-dire le
//    code qui sera traduit dans le firmware du boîtier.
// 4. Notes d'orateur : attribut data-notes de chaque diapositive,
//    affichées seulement à la demande (touche N).
// =====================================================================
(function () {
  "use strict";

  var LARGEUR = 1600;
  var HAUTEUR = 900;

  var scene = document.getElementById("scene");
  var diapos = Array.prototype.slice.call(document.querySelectorAll(".diapo"));
  var total = diapos.length;
  var courante = 0;                       // index à partir de 0
  var compteur = document.getElementById("compteur");
  var progression = document.getElementById("progression");
  var panneauNotes = document.getElementById("notes");

  // Sur téléphone (fenêtre étroite), les diapositives sont empilées
  // par la feuille de style : on fait défiler au lieu de changer de vue.
  var modeTelephone = window.matchMedia("(max-width: 760px)");

  // -------------------------------------------------------------------
  // Pied de chaque diapositive (auteur + numéro), ajouté une fois pour
  // toutes : il apparaît aussi à l'impression.
  // -------------------------------------------------------------------
  diapos.forEach(function (d, i) {
    d.id = "d" + (i + 1);
    var pied = document.createElement("div");
    pied.className = "pied";
    pied.innerHTML = "<span>Kit TPMS vélo · Thibault MORRETTON · BTS CIEL IR · E6</span>" +
      "<span>" + (i + 1) + " / " + total + "</span>";
    d.appendChild(pied);
  });

  // -------------------------------------------------------------------
  // Mise à l'échelle 16:9
  // -------------------------------------------------------------------
  function ajusterEchelle() {
    if (modeTelephone.matches) {
      scene.style.transform = "";
      return;
    }
    var echelle = Math.min(window.innerWidth / LARGEUR, window.innerHeight / HAUTEUR);
    scene.style.transform = "translate(-50%, -50%) scale(" + echelle + ")";
  }

  // -------------------------------------------------------------------
  // Affichage d'une diapositive
  // -------------------------------------------------------------------
  function numeroDepuisAdresse() {
    var n = parseInt(window.location.hash.replace("#", ""), 10);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(total - 1, n - 1));
  }

  function afficher(index) {
    courante = Math.max(0, Math.min(total - 1, index));
    diapos.forEach(function (d, i) {
      d.classList.toggle("active", i === courante);
    });
    compteur.textContent = (courante + 1) + " / " + total;
    progression.style.width = ((courante + 1) / total * 100) + "%";
    // replaceState : l'adresse suit la diapositive sans remplir
    // l'historique du navigateur d'une entrée par diapositive.
    var adresse = "#" + (courante + 1);
    if (window.location.hash !== adresse) history.replaceState(null, "", adresse);
    majNotes();
  }

  function suivante() { afficher(courante + 1); }
  function precedente() { afficher(courante - 1); }

  // -------------------------------------------------------------------
  // Notes d'orateur (touche N)
  // -------------------------------------------------------------------
  function majNotes() {
    if (panneauNotes.hidden) return;
    var texte = diapos[courante].getAttribute("data-notes") || "(pas de note)";
    panneauNotes.innerHTML = "";
    var num = document.createElement("b");
    num.textContent = (courante + 1) + "/" + total;
    panneauNotes.appendChild(num);
    panneauNotes.appendChild(document.createTextNode(texte));
  }

  // -------------------------------------------------------------------
  // Clavier
  // -------------------------------------------------------------------
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // laisse Ctrl+P, etc.
    if (modeTelephone.matches) return;
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case "Enter":
        suivante(); break;
      case " ":
        if (e.shiftKey) precedente(); else suivante();
        break;
      case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace":
        precedente(); break;
      case "Home": afficher(0); break;
      case "End": afficher(total - 1); break;
      case "n": case "N":
        panneauNotes.hidden = !panneauNotes.hidden;
        majNotes();
        break;
      case "f": case "F":
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        break;
      default: return;
    }
    e.preventDefault();
  });

  // -------------------------------------------------------------------
  // Clic : tiers gauche de l'écran = précédente, ailleurs = suivante.
  // Les liens et boutons gardent leur comportement normal.
  // -------------------------------------------------------------------
  var ignorerClic = false;
  document.addEventListener("click", function (e) {
    if (modeTelephone.matches) return;
    if (e.target.closest("a, button, .commandes, .notes")) return;
    if (ignorerClic) { ignorerClic = false; return; }
    if (window.getSelection && String(window.getSelection()).length > 0) return;
    if (e.clientX < window.innerWidth * 0.3) precedente(); else suivante();
  });

  document.getElementById("btnPrec").addEventListener("click", precedente);
  document.getElementById("btnSuiv").addEventListener("click", suivante);

  // -------------------------------------------------------------------
  // Glissement au doigt (tablette, téléphone tenu en paysage)
  // -------------------------------------------------------------------
  var departX = null, departY = null;
  document.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { departX = null; return; }
    departX = e.touches[0].clientX;
    departY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (departX === null || modeTelephone.matches) return;
    var dx = e.changedTouches[0].clientX - departX;
    var dy = e.changedTouches[0].clientY - departY;
    departX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      ignorerClic = true;               // le navigateur enverra aussi un clic
      setTimeout(function () { ignorerClic = false; }, 400);
      if (dx < 0) suivante(); else precedente();
    }
  }, { passive: true });

  // -------------------------------------------------------------------
  // Adresse modifiée à la main (#12) ou boutons précédent/suivant
  // -------------------------------------------------------------------
  window.addEventListener("hashchange", function () {
    if (modeTelephone.matches) return;
    afficher(numeroDepuisAdresse());
  });

  // -------------------------------------------------------------------
  // Mode téléphone : on fait défiler jusqu'à la diapositive demandée,
  // puis l'adresse suit la diapositive visible.
  // -------------------------------------------------------------------
  function initTelephone() {
    var cible = window.location.hash ? diapos[numeroDepuisAdresse()] : null;
    if (cible) {
      cible.scrollIntoView();
      // Les polices et l'image du schéma arrivent après : la page
      // s'allonge, on se replace donc une seconde fois à la fin du chargement.
      window.addEventListener("load", function () { cible.scrollIntoView(); });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { cible.scrollIntoView(); });
      }
    }
    if (!("IntersectionObserver" in window)) return;
    var observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (entree) {
        if (!entree.isIntersecting || !modeTelephone.matches) return;
        var n = diapos.indexOf(entree.target) + 1;
        history.replaceState(null, "", "#" + n);
      });
    }, { rootMargin: "-45% 0px -45% 0px" });
    diapos.forEach(function (d) { observateur.observe(d); });
  }

  // -------------------------------------------------------------------
  // Écrans e-paper dessinés par le code du boîtier
  // -------------------------------------------------------------------
  // Vues d'exemple (valeurs reprises des commentaires de ecran.js et
  // des exemples de trames de docs/protocole-ble.md).
  function vueDeBase() {
    return {
      page: 0, veille: false, eclairage: false, enCharge: false,
      batterieBoitierPct: 87, appConnectee: false, codeAppairage: null,
      vitesseKmh: 23.4, distanceKm: 12.34, moyenneKmh: 0, maxKmh: 0, dureeRoulageS: 0,
      roues: {
        AV: { etat: "OK", pressionBar: 2.10, temperatureC: 21, batteriePct: 95 },
        AR: { etat: "OK", pressionBar: 2.35, temperatureC: 21, batteriePct: 94 }
      }
    };
  }

  var VUES = {
    // Sortie normale
    roulage: function () { return vueDeBase(); },
    // Vraie crevaison à l'arrière : colonne en négatif
    crevaison: function () {
      var v = vueDeBase();
      v.roues.AR = { etat: "CREVAISON", pressionBar: 0.00, temperatureC: 21, batteriePct: 94 };
      return v;
    },
    // Pirate sans protection : sa fausse valeur (0,3 bar) est affichée
    pirate: function () {
      var v = vueDeBase();
      v.roues.AV = { etat: "CREVAISON", pressionBar: 0.30, temperatureC: 21, batteriePct: 95 };
      return v;
    },
    // Avec les protections : deux émetteurs détectés, pression masquée
    suspect: function () {
      var v = vueDeBase();
      v.roues.AV = { etat: "INTRUSION", pressionBar: null };
      return v;
    },
    // Page 2 : statistiques du trajet + prévision du regonflage
    // (exemple « REGONFLER AV 12J  AR 15J » de la documentation)
    trajet: function () {
      var v = vueDeBase();
      v.page = 1;
      v.moyenneKmh = 18.6; v.maxKmh = 34.2; v.dureeRoulageS = 2388;
      v.roues.AV.joursRegonflage = 12;
      v.roues.AR.joursRegonflage = 15;
      return v;
    }
  };

  // Couleurs de l'e-paper, les mêmes que dans simulateur/app.js
  function peindre(canvas, ecran) {
    var ctx = canvas.getContext("2d");
    var image = ctx.createImageData(TPMS.ECRAN_LARGEUR, TPMS.ECRAN_HAUTEUR);
    for (var i = 0; i < ecran.pixels.length; i++) {
      var noir = ecran.pixels[i] === TPMS.NOIR;
      image.data[i * 4] = noir ? 0x1C : 0xD9;
      image.data[i * 4 + 1] = noir ? 0x1C : 0xD7;
      image.data[i * 4 + 2] = noir ? 0x1F : 0xCF;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function dessinerEcrans() {
    var disponible = window.TPMS && TPMS.creerEcran && TPMS.dessinerEcran && TPMS.texteEtat;
    var canevas = document.querySelectorAll("canvas[data-ecran]");
    for (var i = 0; i < canevas.length; i++) {
      var c = canevas[i];
      var fabrique = VUES[c.getAttribute("data-ecran")];
      if (!disponible || !fabrique) {
        // Scripts du dépôt introuvables (page copiée seule, par exemple)
        c.setAttribute("aria-label", "Écran non disponible : scripts du simulateur introuvables");
        continue;
      }
      var ecran = TPMS.creerEcran();
      TPMS.dessinerEcran(ecran, fabrique());
      peindre(c, ecran);
    }
  }

  // La trame d'exemple est recalculée par TPMS.encoderTrame (logique/trame.js) :
  // si le codage changeait dans le projet, la diapositive suivrait.
  function remplirTrame() {
    if (!window.TPMS || !TPMS.encoderTrame) return;
    var octets = TPMS.encoderTrame({
      numero: 1, adresse: [0xEA, 0xCA, 0x3F, 0x1B, 0x07],
      pressionBar: 2.1, temperatureC: 20.5, batteriePct: 95, alarme: 0
    });
    var cases = document.querySelectorAll("[data-octet]");
    for (var i = 0; i < cases.length; i++) {
      var k = parseInt(cases[i].getAttribute("data-octet"), 10);
      cases[i].textContent = TPMS.octetEnHexa(octets[k]);
    }
  }

  // -------------------------------------------------------------------
  // Démarrage
  // -------------------------------------------------------------------
  dessinerEcrans();
  remplirTrame();
  ajusterEchelle();
  window.addEventListener("resize", ajusterEchelle);
  if (modeTelephone.addEventListener) {
    modeTelephone.addEventListener("change", function () { ajusterEchelle(); afficher(courante); });
  }
  afficher(numeroDepuisAdresse());
  if (modeTelephone.matches) initTelephone();
})();
