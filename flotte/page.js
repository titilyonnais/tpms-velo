// =====================================================================
// page.js — Page de supervision de la flotte (affichage seulement)
// ---------------------------------------------------------------------
// Deux sources de données, avec la MÊME interface (des promesses) :
//   - « api »  : le serveur Node répond (même origine) → on lit l'API REST ;
//   - « demo » : pas de serveur (GitHub Pages, fichier ouvert directement)
//     → la flotte tourne dans le navigateur (flotte/flotte.js) et le
//     registre en mémoire (flotte/registre.js) joue le rôle du serveur.
// Toute la logique (statuts, priorités, tendances) est dans
// flotte-logique.js ; ce fichier ne fait que dessiner.
//
// Mode « api » : le serveur réserve ses données aux comptes identifiés.
// La page demande le nom du compte et son mot de passe, les envoie une
// seule fois (POST /api/connexion) et reçoit un JETON DE SESSION. Elle le
// garde dans sessionStorage (oublié à la fermeture de l'onglet, jamais
// dans l'adresse) et l'envoie dans l'en-tête « Authorization: Bearer ».
// La session expire (15 min sans activité, 8 h au plus) ; « Se
// déconnecter » la détruit sur le serveur (POST /api/deconnexion).
// =====================================================================
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var etat = {
    mode: null,                 // "api" ou "demo"
    flotte: null,               // simulation (mode démo)
    facteur: 60, pause: false,
    choisi: "V01",
    tri: { cle: "priorite", inverse: false },
    filtre: "traiter",
    velos: [], stats: null, alertes: [], refus: [], maintenantMs: 0,
    occupe: false,
    jeton: null,                // jeton de session (mode api)
    compte: null,               // { compte, role, droits } renvoyé par /api/moi
    minuteur: null
  };

  // -------------------------------------------------------------------
  // Jeton de session : sessionStorage (cet onglet seulement)
  // -------------------------------------------------------------------
  var CLE_JETON = "tpms-flotte-jeton";
  function jetonGarde() {
    try { return sessionStorage.getItem(CLE_JETON); } catch (e) { return null; }
  }
  function garderJeton(jeton) {
    try {
      if (jeton) sessionStorage.setItem(CLE_JETON, jeton);
      else sessionStorage.removeItem(CLE_JETON);
    } catch (e) { /* stockage indisponible : le jeton reste en mémoire */ }
  }
  function enTetes(jeton) {
    var j = jeton === undefined ? etat.jeton : jeton;
    return j ? { Authorization: "Bearer " + j } : {};
  }

  // -------------------------------------------------------------------
  // Mise en forme
  // -------------------------------------------------------------------
  function nombre(x, n) {
    if (x === null || x === undefined || isNaN(x)) return "–";
    return Number(x).toFixed(n === undefined ? 2 : n).replace(".", ",").replace("-", "−");
  }
  // Tout texte venu des données passe par ici avant innerHTML (anti-XSS).
  function echapper(texte) {
    return String(texte === null || texte === undefined ? "" : texte)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var FUSEAU = { timeZone: "Europe/Paris" };
  function dateCourte(t) {
    return new Date(t).toLocaleString("fr-FR", Object.assign({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }, FUSEAU));
  }
  function jourLong(t) {
    return new Date(t).toLocaleDateString("fr-FR", Object.assign({ weekday: "short", day: "numeric", month: "short" }, FUSEAU));
  }
  function heure(t) {
    return new Date(t).toLocaleTimeString("fr-FR", Object.assign({ hour: "2-digit", minute: "2-digit" }, FUSEAU));
  }
  function depuis(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) return "il y a " + Math.max(0, min) + " min";
    if (min < 48 * 60) return "il y a " + Math.round(min / 60) + " h";
    return "il y a " + Math.round(min / 1440) + " j";
  }

  var STATUTS = {
    immobilise: { texte: "Immobilisé", puce: "alerte" },
    urgent:     { texte: "Urgent",     puce: "alerte" },
    regonfler:  { texte: "À regonfler", puce: "attention" },
    muet:       { texte: "Muet",       puce: "muet" },
    surveiller: { texte: "À surveiller", puce: "surveiller" },
    ok:         { texte: "OK",         puce: "ok" }
  };
  var TYPES_ALERTE = {
    CREVAISON: "Crevaison", BASSE: "Pression basse", HAUTE: "Pression haute", FUITE: "Fuite rapide (boîtier)",
    PERDU: "Capteur perdu", INTRUSION: "Signal suspect", ATTENTE: "En attente",
    FUITE_LENTE: "Fuite lente (serveur)", BATTERIE: "Batterie du boîtier faible"
  };

  // -------------------------------------------------------------------
  // Sources de données
  // -------------------------------------------------------------------
  function lireJson(adresse) {
    return fetch(adresse, { cache: "no-store", headers: enTetes() }).then(function (r) {
      if (r.status === 401) {
        // Session expirée, ou jeton refusé (serveur relancé...) : on le dit.
        return r.json().catch(function () { return {}; }).then(function (json) {
          var e = new Error(json.motif === "session-expiree"
            ? "Session expirée (15 min sans activité, ou 8 h atteintes) : se reconnecter."
            : "Le serveur ne reconnaît plus la session : se reconnecter.");
          e.deconnecte = true;
          throw e;
        });
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  var sourceApi = {
    velos: function () { return lireJson("../api/velos"); },
    historique: function (id, jours) { return lireJson("../api/velos/" + encodeURIComponent(id) + "/historique?jours=" + jours); },
    alertes: function (n) { return lireJson("../api/alertes?limite=" + n); },
    statistiques: function () { return lireJson("../api/statistiques"); },
    refus: function (n) { return lireJson("../api/refus?limite=" + n); }
  };

  var sourceDemo = {
    velos: function () { return Promise.resolve(TPMS.registreVelos(etat.flotte.registre, etat.flotte.tMs)); },
    historique: function (id, jours) { return Promise.resolve(TPMS.registreHistorique(etat.flotte.registre, id, jours, etat.flotte.tMs)); },
    alertes: function (n) { return Promise.resolve(TPMS.registreAlertes(etat.flotte.registre, n)); },
    statistiques: function () { return Promise.resolve(TPMS.registreStatistiques(etat.flotte.registre, etat.flotte.tMs)); },
    refus: function () { return Promise.resolve({ refus: [] }); }
  };

  function source() { return etat.mode === "api" ? sourceApi : sourceDemo; }

  // Le serveur répond-il ? (2 s au plus). On demande « qui suis-je ? »
  // avec le jeton gardé, s'il y en a un. Résultat :
  //   { mode: "api", compte }   serveur présent, jeton accepté ;
  //   { mode: "connexion", message } serveur présent, il faut se connecter ;
  //   { mode: "demo" }          pas de serveur (GitHub Pages, fichier local...).
  function detecterServeur() {
    if (location.protocol === "file:") return Promise.resolve({ mode: "demo" });
    var controle = new AbortController();
    var minuteur = setTimeout(function () { controle.abort(); }, 2000);
    var jeton = jetonGarde();
    return fetch("../api/moi", { cache: "no-store", signal: controle.signal, headers: enTetes(jeton) })
      .then(function (r) {
        clearTimeout(minuteur);
        // Seul NOTRE serveur répond en JSON sur /api/ ; un simple serveur de fichiers répond 404.
        if ((r.headers.get("content-type") || "").indexOf("application/json") !== 0) return { mode: "demo" };
        return r.json().then(function (json) {
          if (r.ok) return { mode: "api", jeton: jeton, compte: json };
          if (r.status === 401) {
            if (jeton) garderJeton(null);           // session finie : on l'oublie
            return { mode: "connexion", message: jeton ? "La session précédente est terminée : se reconnecter." : "" };
          }
          if (r.status === 429) return { mode: "connexion", message: "Adresse bloquée par le serveur après trop d'essais : réessayer dans quelques minutes." };
          return { mode: "demo" };
        });
      })
      .catch(function () { clearTimeout(minuteur); return { mode: "demo" }; });
  }

  // -------------------------------------------------------------------
  // Rafraîchissement
  // -------------------------------------------------------------------
  function rafraichir() {
    if (etat.occupe) return Promise.resolve();
    etat.occupe = true;
    var s = source();
    // Le journal des refus n'est lu que par le gestionnaire (rôle vérifié par le serveur).
    var lireRefus = etat.mode === "api" && etat.compte && etat.compte.droits.indexOf("refus") >= 0;
    return Promise.all([s.velos(), s.statistiques(), s.alertes(60), lireRefus ? s.refus(8) : null])
      .then(function (r) {
        etat.velos = r[0].velos;
        etat.maintenantMs = r[0].maintenantMs;
        etat.stats = r[1];
        etat.alertes = r[2].alertes;
        etat.refus = r[3] ? r[3].refus : [];
        afficherEtatGlobal();
        afficherIndicateurs();
        afficherCarte();
        afficherPriorite();
        afficherJournal();
        afficherStatistiques();
        afficherSecurite();
        return s.historique(etat.choisi, 7);
      })
      .then(function (h) { if (h) afficherDetail(h); })
      .catch(function (e) {
        if (e.deconnecte) {
          // Plus de session : retour à la connexion, on arrête d'interroger.
          garderJeton(null);
          etat.jeton = null;
          clearInterval(etat.minuteur);
          afficherConnexion(e.message);
          return;
        }
        $("etatTitre").textContent = "Serveur injoignable";
        $("etatDetail").textContent = e.message;
        $("etatGlobal").className = "etat-global attention";
      })
      .then(function () { etat.occupe = false; });
  }

  // -------------------------------------------------------------------
  // Barre du haut et indicateurs
  // -------------------------------------------------------------------
  function afficherEtatGlobal() {
    var I = etat.stats.indicateurs;
    var classe = "ok", titre;
    if (I.immobilises + I.urgents > 0) {
      classe = "alerte";
      titre = (I.immobilises + I.urgents) + " vélo" + (I.immobilises + I.urgents > 1 ? "s" : "") + " à traiter d'urgence";
    } else if (I.aRegonfler > 0) {
      classe = "attention";
      titre = I.aRegonfler + " vélo" + (I.aRegonfler > 1 ? "s" : "") + " à regonfler";
    } else {
      titre = "Flotte en ordre";
    }
    $("etatGlobal").className = "etat-global " + classe;
    $("etatTitre").textContent = titre;
    $("etatDetail").textContent = I.nbVelos + " vélos · " + I.enLocation + " en location · " + I.fuitesLentes +
      " fuite" + (I.fuitesLentes > 1 ? "s" : "") + " lente" + (I.fuitesLentes > 1 ? "s" : "") +
      " · pression moyenne " + nombre(I.pressionMoyennePct, 0) + " % du nominal";
    $("horloge").textContent = heure(etat.maintenantMs);
    $("txtJour").textContent = jourLong(etat.maintenantMs);
    if (etat.mode === "api") $("txtActualise").textContent = "Serveur · actualisé à " + new Date().toLocaleTimeString("fr-FR");
  }

  function afficherIndicateurs() {
    var I = etat.stats.indicateurs;
    $("kpiRegonfler").textContent = I.aRegonfler;
    $("kpiRegonflerDetail").textContent = "dont " + I.urgents + " urgent" + (I.urgents > 1 ? "s" : "") +
      " · " + I.immobilises + " immobilisé" + (I.immobilises > 1 ? "s" : "");
    $("kpiFuites").textContent = I.fuitesLentes;
    var moyenne = etat.stats.regonflages.tempsMoyenEntreJ;
    $("kpiIntervalle").textContent = moyenne === null ? "–" : nombre(moyenne, 1);
    $("kpiIntervalleDetail").textContent = "Moyenne par roue · " + etat.stats.regonflages.total + " regonflages en tout";
    $("kpiLocation").textContent = I.enLocation;
    $("kpiLocationUnite").textContent = "/ " + I.nbVelos + " en location";
    $("kpiFlotteDetail").textContent = I.boitiersARecharger + " boîtier" + (I.boitiersARecharger > 1 ? "s" : "") +
      " à recharger · " + I.muets + " muet" + (I.muets > 1 ? "s" : "");
  }

  // -------------------------------------------------------------------
  // Carte schématique (SVG, sans tuiles externes)
  // -------------------------------------------------------------------
  var CARTE = { L: 640, H: 480, latC: 45.7575, lonC: 4.8390, demiLat: 0.021 };
  // Côté où écrire le nom de chaque station (pour ne pas chevaucher les vélos).
  var COTE_NOM = { CRX: -1, TER: 1, BEL: -1, PDI: 1, JMA: 1, CON: -1 };
  function projeter(lat, lon) {
    // Même échelle en x et en y : un degré de longitude est plus court
    // qu'un degré de latitude, d'un facteur cos(latitude).
    var echelle = (CARTE.H / 2 - 20) / CARTE.demiLat;
    var kx = Math.cos(CARTE.latC * Math.PI / 180);
    return { x: CARTE.L / 2 + (lon - CARTE.lonC) * kx * echelle, y: CARTE.H / 2 - (lat - CARTE.latC) * echelle };
  }
  function el(nom, attributs, texte) { return TPMS.svgElement(nom, attributs, texte); }

  function afficherCarte() {
    var svg = $("carte");
    svg.innerHTML = "";
    for (var x = 40; x < CARTE.L; x += 40) svg.appendChild(el("line", { x1: x, x2: x, y1: 0, y2: CARTE.H, class: "grille" }));
    for (var y = 40; y < CARTE.H; y += 40) svg.appendChild(el("line", { x1: 0, x2: CARTE.L, y1: y, y2: y, class: "grille" }));

    TPMS.FLOTTE_FLEUVES.forEach(function (f) {
      var d = f.points.map(function (p, i) { var q = projeter(p[0], p[1]); return (i ? "L" : "M") + q.x.toFixed(1) + " " + q.y.toFixed(1); }).join(" ");
      svg.appendChild(el("path", { d: d, class: "fleuve" }));
      var a = projeter(f.points[1][0], f.points[1][1]);
      svg.appendChild(el("text", { x: a.x + 12, y: a.y, class: "fleuve-nom" }, f.nom));
    });

    var parStation = {};
    TPMS.FLOTTE_STATIONS.forEach(function (s) {
      var p = projeter(s.lat, s.lon);
      var cote = COTE_NOM[s.id] || 1;
      svg.appendChild(el("circle", { cx: p.x, cy: p.y, r: 11, class: "station" }));
      svg.appendChild(el("text", { x: p.x + cote * 34, y: p.y + 4, "text-anchor": cote > 0 ? "start" : "end", class: "station-nom" }, s.nom));
      parStation[s.nom] = { p: p, velos: [] };
    });

    // RGPD : un vélo en location n'a PAS de position (non conservée) ; il
    // est listé sous la carte au lieu d'y être placé.
    var libres = [], sansPosition = [];
    etat.velos.forEach(function (v) {
      if (v.lat === null || v.lon === null) { sansPosition.push(v); return; }
      if (!v.enLocation && v.station && parStation[v.station]) parStation[v.station].velos.push(v);
      else libres.push(v);
    });
    afficherSansPosition(sansPosition);
    function dessinerVelo(v, x, y) {
      var classe = "velo " + v.statut + (v.enLocation ? " roule" : "") + (v.id === etat.choisi ? " choisi" : "");
      var c = el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 8, class: classe, "data-id": v.id });
      c.appendChild(el("title", {}, v.nom + " · " + STATUTS[v.statut].texte + " · " + v.raison));
      svg.appendChild(c);
      svg.appendChild(el("text", { x: x.toFixed(1), y: (y + 3).toFixed(1), "text-anchor": "middle", class: "velo-texte" }, v.id.slice(1)));
    }
    // Vélos garés : en couronne autour de leur station
    Object.keys(parStation).forEach(function (nom) {
      var g = parStation[nom];
      g.velos.forEach(function (v, i) {
        var angle = -Math.PI / 2 + i * 2 * Math.PI / Math.max(6, g.velos.length);
        var rayon = g.velos.length > 8 ? 26 : 21;
        dessinerVelo(v, g.p.x + rayon * Math.cos(angle), g.p.y + rayon * Math.sin(angle));
      });
    });
    // Vélos hors station dont on connaît la position (rare : rendus ailleurs)
    libres.forEach(function (v) { var p = projeter(v.lat, v.lon); dessinerVelo(v, p.x, p.y); });
  }

  // Sous la carte : les vélos sans position (en location, ou sans GPS).
  function afficherSansPosition(liste) {
    var zone = $("horsCarte");
    zone.hidden = liste.length === 0;
    if (liste.length === 0) { zone.innerHTML = ""; return; }
    var enLocation = liste.filter(function (v) { return v.enLocation; }).length;
    var titre = enLocation === liste.length
      ? "En location · position non conservée (RGPD)"
      : "Sans position connue · en location : position non conservée (RGPD)";
    zone.innerHTML = "<span class=\"hors-carte-titre\">" + titre + "</span>" + liste.map(function (v) {
      return "<button type=\"button\" class=\"puce-velo" + (v.id === etat.choisi ? " choisi" : "") + "\" data-id=\"" + echapper(v.id) + "\" title=\"" +
        echapper(v.nom + " · " + STATUTS[v.statut].texte + " · " + v.raison) + "\"><i class=\"pastille " + echapper(v.statut) +
        (v.enLocation ? " anneau" : "") + "\"></i>" + echapper(v.id) + "</button>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Tournée : liste triable des vélos à traiter
  // -------------------------------------------------------------------
  function ratioPression(v) {
    var a = v.p20Av === null ? Infinity : v.p20Av / TPMS.FLOTTE.nominalBar.AV;
    var b = v.p20Ar === null ? Infinity : v.p20Ar / TPMS.FLOTTE.nominalBar.AR;
    return Math.min(a, b);
  }
  var TRIS = {
    id: function (a, b) { return a.id < b.id ? -1 : 1; },
    priorite: function (a, b) { return b.priorite - a.priorite || (a.id < b.id ? -1 : 1); },   // la plus forte d'abord
    pression: function (a, b) { return ratioPression(a) - ratioPression(b); },
    prochain: function (a, b) {
      var x = a.prochainRegonflageMs === null ? Infinity : a.prochainRegonflageMs;
      var y = b.prochainRegonflageMs === null ? Infinity : b.prochainRegonflageMs;
      return x - y || (a.id < b.id ? -1 : 1);
    }
  };

  function afficherPriorite() {
    var liste = etat.velos.filter(function (v) { return etat.filtre === "tous" || v.statut !== "ok"; });
    // Sens naturel de chaque colonne (priorité la plus forte d'abord, le
    // reste croissant) ; un deuxième clic sur la même colonne inverse.
    liste.sort(TRIS[etat.tri.cle]);
    if (etat.tri.inverse) liste.reverse();

    $("corpsPriorite").innerHTML = liste.map(function (v) {
      var s = STATUTS[v.statut];
      var prochain = v.prochainRegonflageMs === null ? "–"
        : (v.prochainRegonflageMs <= etat.maintenantMs ? "maintenant" : "dans " + nombre((v.prochainRegonflageMs - etat.maintenantMs) / 86400000, 1) + " j");
      var lieu = v.enLocation ? "en location" : (v.station || "hors station");
      return "<tr data-id=\"" + echapper(v.id) + "\"" + (v.id === etat.choisi ? " class=\"choisi\"" : "") + ">" +
        "<td>" + echapper(v.id) + "<span class=\"raison\">" + echapper(lieu) + "</span></td>" +
        "<td><span class=\"puce " + s.puce + "\">" + s.texte + "</span> " +
        "<span class=\"jauge-priorite\"><i style=\"width:" + v.priorite + "%\"></i></span>" + v.priorite +
        "<span class=\"raison\">" + echapper(v.raison) + "</span></td>" +
        "<td>" + nombre(v.p20Av) + " / " + nombre(v.p20Ar) + "</td>" +
        "<td>" + prochain + "</td></tr>";
    }).join("") || "<tr><td colspan=\"4\">Rien à faire : tous les vélos sont en ordre.</td></tr>";
    $("txtPriorite").textContent = "Pressions ramenées à 20 °C (bar). Le technicien suit cette liste chaque matin à 9 h.";
    document.querySelectorAll("#zonePriorite th button").forEach(function (b) {
      b.classList.toggle("actif", b.dataset.tri === etat.tri.cle);
      // Flèche vers le haut quand l'ordre affiché est croissant
      b.classList.toggle("montant", (etat.tri.cle !== "priorite") !== etat.tri.inverse);
    });
  }

  // -------------------------------------------------------------------
  // Détail d'un vélo
  // -------------------------------------------------------------------
  function afficherDetail(h) {
    var r = h.resume;
    var s = STATUTS[r.statut];
    $("detailTitre").textContent = r.nom;
    $("detailStatut").className = "puce " + s.puce;
    $("detailStatut").textContent = s.texte;
    $("detailRaison").textContent = r.raison;

    var t0 = h.maintenantMs;
    var series = [["AV", ""], ["AR", "s2"]].map(function (x) {
      return {
        classe: x[1],
        points: h.mesures.map(function (m) { return [(m.t - t0) / 86400000, TPMS.flottePression20(m, x[0])]; })
      };
    });
    TPMS.grapheLignes($("grapheDetail"), {
      series: series, xMin: -7, xMax: 0, pasY: 0.25,
      reperes: [
        { y: TPMS.flotteSeuilRegonflerBar("AV"), texte: "AV 90 %" },
        { y: TPMS.flotteSeuilRegonflerBar("AR"), texte: "AR 90 %" }
      ],
      formatX: function (v) { return v > -0.01 ? "maintenant" : "il y a " + Math.round(-v) + " j"; },
      vide: "Pas encore de mesures"
    });

    function pression(roue) {
      var p = r[TPMS.flotteChamp("p", roue)], p20 = r[TPMS.flotteChamp("p20", roue)];
      return p === null ? "–" : nombre(p) + " bar <small>(" + nombre(p20) + " à 20 °C)</small>";
    }
    function tendance(roue) {
      var tr = h.tendance[roue];
      if (!tr || tr.penteBarJour === null || tr.penteBarJour === undefined) return ["Pas assez de recul (24 h)", ""];
      var texte = nombre(tr.penteBarJour, 3) + " bar/j";
      return tr.fuiteLente ? ["Fuite lente : " + texte, "alerte-texte"] : [texte + " (normal)", ""];
    }
    var tav = tendance("AV"), tar = tendance("AR");
    var prochain = r.prochainRegonflageMs === null ? "–" : (r.prochainRegonflageMs <= h.maintenantMs ? "maintenant" : dateCourte(r.prochainRegonflageMs));
    var lignes = [
      ["Pression avant", pression("AV"), ""],
      ["Pression arrière", pression("AR"), ""],
      ["Perte avant", tav[0], tav[1]],
      ["Perte arrière", tar[0], tar[1]],
      ["Prochain regonflage", prochain, r.prochainRegonflageMs !== null && r.prochainRegonflageMs - h.maintenantMs < 2 * 86400000 ? "attention-texte" : ""],
      ["Batterie du boîtier", r.batterie === null ? "–" : r.batterie + " %", r.batterie !== null && r.batterie < TPMS.FLOTTE.batterieFaiblePct ? "attention-texte" : ""],
      ["Piles des capteurs", (r.pileAv === null ? "–" : r.pileAv + " %") + " / " + (r.pileAr === null ? "–" : r.pileAr + " %"), ""],
      ["Compteur", r.km === null ? "–" : nombre(r.km, 0) + " km", ""],
      ["Position", r.enLocation ? "En location (position non conservée)" : (r.station || (r.lat === null ? "Inconnue" : "Hors station")), ""],
      ["Dernière mesure", r.t === null ? "–" : depuis(h.maintenantMs - r.t), ""],
      ["Regonflages (7 j)", String(h.regonflages.length), ""]
    ];
    $("detailMesures").innerHTML = lignes.map(function (l) {
      return "<div><dt>" + l[0] + "</dt><dd class=\"" + l[2] + "\">" + l[1] + "</dd></div>";
    }).join("");

    // Mode démo : ce que la simulation sait et que le serveur ignore
    var zone = $("detailVerite");
    if (etat.mode === "demo") {
      var v = TPMS.flotteVerite(etat.flotte, r.id);
      var defauts = v.defauts.length === 0 ? "aucun défaut" : v.defauts.map(function (d) {
        return d.type + " " + (d.roue === "AV" ? "avant" : "arrière") +
          (d.diametreMm ? " (trou de " + nombre(d.diametreMm * 1000, 1) + " µm)" : "") + " depuis le " + dateCourte(d.depuisMs);
      }).join(", ");
      zone.innerHTML = "<b>Vérité de la simulation</b> (inconnue du serveur) : " + echapper(defauts) +
        " · pression réelle " + nombre(v.pressionReelleBar.AV) + " / " + nombre(v.pressionReelleBar.AR) + " bar" +
        (v.trajet ? " · trajet " + echapper(v.trajet.depart) + " → " + echapper(v.trajet.arrivee) : "");
      zone.hidden = false;
    } else {
      zone.hidden = true;
    }
  }

  // -------------------------------------------------------------------
  // Journal des alertes (et du technicien en mode démo)
  // -------------------------------------------------------------------
  function afficherJournal() {
    var lignes = etat.alertes.map(function (a) {
      var roue = a.roue ? (a.roue === "AV" ? " avant" : " arrière") : "";
      var texte = (TYPES_ALERTE[a.type] || a.type) + roue + (a.pression !== null && a.pression !== undefined ? " · " + nombre(a.pression) + " bar" : "");
      return { t: a.t, id: a.veloId, classe: a.type === "BATTERIE" ? "" : "alerte", html: "<b>" + echapper(a.veloId) + "</b> · " + echapper(texte) };
    });
    if (etat.mode === "demo") {
      etat.flotte.interventions.slice(-40).forEach(function (i) {
        lignes.push({ t: i.t, id: i.veloId, classe: "ok", html: "<b>" + echapper(i.veloId) + "</b> · Technicien : " + echapper(i.actions.join(", ")) });
      });
      $("txtJournal").textContent = "Alertes et technicien";
    }
    lignes.sort(function (a, b) { return b.t - a.t; });
    $("listeAlertes").innerHTML = lignes.slice(0, 60).map(function (l) {
      return "<li class=\"" + l.classe + "\" data-id=\"" + echapper(l.id) + "\"><span class=\"heure\">" + dateCourte(l.t) + "</span><span>" + l.html + "</span></li>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Statistiques
  // -------------------------------------------------------------------
  function barres(conteneur, lignes, classe) {
    var max = Math.max.apply(null, [1].concat(lignes.map(function (l) { return l.n; })));
    conteneur.innerHTML = lignes.map(function (l) {
      return "<div class=\"barre-ligne\"><span class=\"nom\">" + echapper(l.nom) + "</span>" +
        "<span class=\"piste\"><span class=\"plein " + classe + "\" style=\"display:block;width:" + Math.round(l.n / max * 100) + "%\"></span></span>" +
        "<span class=\"val\">" + l.n + "</span></div>";
    }).join("") || "<p class=\"discret\">Aucune.</p>";
  }

  function afficherStatistiques() {
    var s = etat.stats;
    var lignes = [
      ["Mesures (24 h)", s.mesures.dernieres24h],
      ["Mesures en base", s.mesures.total],
      ["Regonflages (7 j)", s.regonflages.derniers7j],
      ["Kilomètres (7 j)", nombre(s.km7j, 0)],
      ["Pression moyenne", nombre(s.indicateurs.pressionMoyennePct, 1) + " %"],
      ["À surveiller", s.indicateurs.aSurveiller]
    ];
    $("statsMesures").innerHTML = lignes.map(function (l) { return "<div><dt>" + l[0] + "</dt><dd>" + l[1] + "</dd></div>"; }).join("");
    barres($("statsAlertes"), s.alertesParType7j.map(function (a) { return { nom: TYPES_ALERTE[a.type] || a.type, n: a.n }; }), "alerte");
  }

  // -------------------------------------------------------------------
  // Sécurité
  // -------------------------------------------------------------------
  var MOTIFS = {
    signature: "Signature invalide", rejeu: "Rejeu", horodatage: "Horodatage hors fenêtre", inconnu: "Vélo inconnu",
    identifiant: "Identifiant mal formé", "en-tetes": "En-têtes manquants", validation: "Valeurs refusées", json: "JSON invalide",
    debit: "Trop de requêtes", taille: "Corps trop gros", type: "Mauvais type",
    authentification: "Lecture sans jeton valide", droits: "Hors des droits du compte"
  };

  function afficherSecurite() {
    if (etat.mode !== "api") return;
    // Technicien : le serveur ne lui donne pas le journal de sécurité.
    var reserve = !etat.stats.securite;
    $("secuServeur").hidden = reserve;
    $("secuReserve").hidden = !reserve;
    if (reserve) return;
    var motifs = etat.stats.securite.refusParMotif;
    barres($("secuMotifs"), motifs.map(function (m) { return { nom: MOTIFS[m.motif] || m.motif, n: m.n }; }), "alerte");
    $("secuRefus").innerHTML = etat.refus.map(function (r) {
      return "<tr><td>" + dateCourte(r.t) + "</td><td class=\"mono\">" + echapper(r.velo || "–") + "</td><td>" +
        echapper(MOTIFS[r.motif] || r.motif) + "</td></tr>";
    }).join("") || "<tr><td colspan=\"3\">Aucun refus.</td></tr>";
  }

  // Banc d'essai du mode démo : la vérification du serveur, dans la page.
  var banc = null;
  function aleaOctets(n) {
    var o = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(o);
    else for (var i = 0; i < n; i++) o[i] = Math.floor(Math.random() * 256);
    return o;
  }
  function bancPreparer(mesures, options) {
    var o = options || {};
    var maintenant = Date.now() + (o.decalageMs || 0);
    banc.sequenceClient = TPMS.flotteProchaineSequence(banc.sequenceClient, Date.now());
    var corps = JSON.stringify({ mesures: mesures });
    var requete = { veloId: "V01", horodatage: String(maintenant), sequence: String(banc.sequenceClient), corps: corps };
    var message = TPMS.flotteMessageASigner(requete.veloId, requete.horodatage, requete.sequence, corps);
    requete.signature = TPMS.enHexa(TPMS.hmacSha256(o.cle || banc.cle, TPMS.texteEnOctets(message)));
    return requete;
  }
  function bancVerifier(requete) {
    var maintenant = Date.now();
    var attendue = TPMS.enHexa(TPMS.hmacSha256(banc.cle, TPMS.texteEnOctets(
      TPMS.flotteMessageASigner(requete.veloId, requete.horodatage, requete.sequence, requete.corps))));
    var probleme = TPMS.flotteControlerRequete({
      veloId: requete.veloId, horodatage: requete.horodatage, sequence: requete.sequence, signature: requete.signature,
      signatureAttendue: attendue, derniereSequence: banc.derniereSequence, maintenantMs: maintenant
    });
    if (probleme) return { ok: false, texte: probleme.statut + " · " + probleme.detail };
    var verdict = TPMS.flotteValiderLot(JSON.parse(requete.corps), maintenant);
    if (!verdict.ok) return { ok: false, texte: "400 · " + verdict.erreur };
    banc.derniereSequence = Number(requete.sequence);
    return { ok: true, texte: "201 · lot accepté" };
  }
  function bancMesure() {
    var liste = etat.flotte.registre.mesures.V01;
    var m = Object.assign({}, liste[liste.length - 1]);
    m.t = Date.now() - 1000;          // la porte d'entrée vérifie l'heure réelle
    return m;
  }
  function bancEssai(type) {
    if (!banc) banc = { cle: aleaOctets(32), autreCle: aleaOctets(32), sequenceClient: 0, derniereSequence: 0, derniere: null };
    var m = bancMesure();
    var requete, titre;
    if (type === "valide") {
      titre = "Lot signé par V01";
      requete = bancPreparer([m]);
      banc.derniere = requete;
    } else if (type === "rejeu") {
      if (!banc.derniere) { bancEssai("valide"); }
      titre = "Rejeu du dernier lot capturé";
      requete = banc.derniere;
    } else if (type === "falsifie") {
      titre = "Lot signé, pression avant changée en 3,00 bar";
      requete = bancPreparer([m]);
      var objet = JSON.parse(requete.corps);
      objet.mesures[0].pAv = 3.0;
      requete.corps = JSON.stringify(objet);
    } else if (type === "cle") {
      titre = "Signé avec la clé d'un autre vélo";
      requete = bancPreparer([m], { cle: banc.autreCle });
    } else if (type === "vieux") {
      titre = "Horodatage d'il y a 2 minutes";
      requete = bancPreparer([m], { decalageMs: -120000 });
    } else {
      titre = "Lot signé avec une pression de 12 bar";
      m.pAv = 12;
      requete = bancPreparer([m]);
    }
    var r = bancVerifier(requete);
    var li = document.createElement("li");
    li.className = r.ok ? "ok" : "alerte";
    li.innerHTML = "<span class=\"heure\">" + new Date().toLocaleTimeString("fr-FR") + "</span><span>" + echapper(titre) +
      " → <span class=\"" + (r.ok ? "verdict-ok" : "verdict-refus") + "\">" + echapper(r.texte) + "</span><br><small class=\"mono\">signature " +
      echapper(requete.signature.slice(0, 16)) + "…</small></span>";
    $("secuEssais").insertBefore(li, $("secuEssais").firstChild);
  }

  // -------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------
  function choisir(id) {
    if (!id) return;
    etat.choisi = id;
    afficherCarte();
    afficherPriorite();
    source().historique(id, 7).then(function (h) { if (h) afficherDetail(h); });
  }

  function brancherEvenements() {
    $("carte").addEventListener("click", function (e) {
      var id = e.target.getAttribute && e.target.getAttribute("data-id");
      if (id) choisir(id);
    });
    $("corpsPriorite").addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (tr && tr.dataset.id) { choisir(tr.dataset.id); $("zoneDetail").scrollIntoView(); }
    });
    $("horsCarte").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b && b.dataset.id) choisir(b.dataset.id);
    });
    $("listeAlertes").addEventListener("click", function (e) {
      var li = e.target.closest("li");
      if (li && li.dataset.id) choisir(li.dataset.id);
    });
    document.querySelectorAll("#zonePriorite th button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (etat.tri.cle === b.dataset.tri) etat.tri.inverse = !etat.tri.inverse;
        else { etat.tri.cle = b.dataset.tri; etat.tri.inverse = false; }
        afficherPriorite();
      });
    });
    document.querySelectorAll("#choixFiltre button").forEach(function (b) {
      b.addEventListener("click", function () {
        etat.filtre = b.dataset.filtre;
        document.querySelectorAll("#choixFiltre button").forEach(function (x) { x.classList.toggle("actif", x === b); });
        afficherPriorite();
      });
    });
    document.querySelectorAll("#navigation a").forEach(function (a) {
      a.addEventListener("click", function () {
        document.querySelectorAll("#navigation a").forEach(function (x) { x.classList.toggle("actif", x === a); });
      });
    });
    // Temps (mode démo)
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
    $("btnJour").addEventListener("click", function () {
      TPMS.flotteAvancer(etat.flotte, 86400);
      rafraichir();
    });
    document.querySelectorAll("[data-essai]").forEach(function (b) {
      b.addEventListener("click", function () { bancEssai(b.dataset.essai); });
    });
  }

  // -------------------------------------------------------------------
  // Démarrage
  // -------------------------------------------------------------------
  function demarrerDemo() {
    etat.mode = "demo";
    var graine = Number(new URLSearchParams(location.search).get("graine")) || 42;
    $("txtGraine").textContent = graine;
    $("bandeauDemo").hidden = false;
    $("commandesTemps").hidden = false;
    $("txtSource").textContent = "Mode démo (sans serveur)";
    $("txtSecuMode").textContent = "démo";
    $("secuDemo").hidden = false;
    $("etatTitre").textContent = "Simulation des 14 premiers jours…";
    setTimeout(function () {
      etat.flotte = TPMS.creerFlotte({ graine: graine });
      TPMS.flotteAvancer(etat.flotte, 14 * 86400);    // deux semaines d'historique avant d'afficher
      rafraichir();
      var tour = 0;
      setInterval(function () {
        if (!etat.pause) TPMS.flotteAvancer(etat.flotte, etat.facteur * 0.25);
        tour++;
        if (!etat.pause && tour % 2 === 0) rafraichir();
      }, 250);
    }, 30);
  }

  function demarrerApi(jeton, compte) {
    etat.mode = "api";
    etat.jeton = jeton;
    etat.compte = compte;
    $("ecranConnexion").hidden = true;
    $("txtActualise").hidden = false;
    // HTTP ou HTTPS : on le dit franchement (en HTTP, mot de passe et jeton circulent en clair).
    $("txtSource").textContent = location.protocol === "https:" ? "Serveur · HTTPS chiffré" : "Serveur · HTTP non chiffré";
    $("txtCompte").textContent = compte.compte === compte.role ? "Compte " + compte.role : "Compte " + compte.compte + " (" + compte.role + ")";
    $("zoneCompte").hidden = false;
    $("txtSecuMode").textContent = "serveur";
    rafraichir();
    clearInterval(etat.minuteur);
    etat.minuteur = setInterval(rafraichir, 5000);
  }

  // -------------------------------------------------------------------
  // Connexion et déconnexion (mode api)
  // -------------------------------------------------------------------
  function afficherConnexion(message) {
    etat.mode = "connexion";
    $("txtSource").textContent = "Serveur · connexion requise";
    $("zoneCompte").hidden = true;
    $("etatTitre").textContent = "Connexion requise";
    $("etatDetail").textContent = "Les données de la flotte sont réservées aux comptes identifiés.";
    $("ecranConnexion").hidden = false;
    $("avertHttp").hidden = location.protocol === "https:";
    var erreur = $("erreurConnexion");
    erreur.textContent = message || "";
    erreur.hidden = !message;
    $("champMotDePasse").value = "";
    $("champCompte").focus();
  }

  function brancherConnexion() {
    $("formConnexion").addEventListener("submit", function (e) {
      e.preventDefault();                       // pas d'envoi du formulaire : le mot de passe ne va jamais dans l'adresse
      var compte = $("champCompte").value.trim();
      var motDePasse = $("champMotDePasse").value;
      $("champMotDePasse").value = "";          // on ne le garde pas plus longtemps que nécessaire
      var bouton = $("btnConnexion");
      bouton.disabled = true;
      fetch("../api/connexion", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compte: compte, motDePasse: motDePasse })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (json) {
            if (r.ok) {
              garderJeton(json.jeton);
              demarrerApi(json.jeton, json);
              return;
            }
            var message = r.status === 401 ? "Compte ou mot de passe incorrect."
              : r.status === 429 ? "Trop d'essais : adresse bloquée quelques minutes par le serveur."
              : "Erreur du serveur (HTTP " + r.status + ").";
            $("erreurConnexion").textContent = message;
            $("erreurConnexion").hidden = false;
          });
        })
        .catch(function () {
          $("erreurConnexion").textContent = "Serveur injoignable.";
          $("erreurConnexion").hidden = false;
        })
        .then(function () { bouton.disabled = false; });
    });
    // Se déconnecter : le serveur détruit la session (le jeton ne vaut
    // plus rien, même recopié ailleurs), le navigateur l'oublie, et on
    // recharge la page pour effacer toutes les données affichées.
    $("btnDeconnexion").addEventListener("click", function () {
      var jeton = etat.jeton;
      garderJeton(null);
      etat.jeton = null;
      clearInterval(etat.minuteur);
      fetch("../api/deconnexion", { method: "POST", cache: "no-store", headers: enTetes(jeton) })
        .catch(function () { /* serveur injoignable : la session expirera seule */ })
        .then(function () { location.reload(); });
    });
  }

  brancherEvenements();
  brancherConnexion();
  detecterServeur().then(function (r) {
    if (r.mode === "api") demarrerApi(r.jeton, r.compte);
    else if (r.mode === "connexion") afficherConnexion(r.message);
    else demarrerDemo();
  });
})();
