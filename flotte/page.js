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
    occupe: false
  };

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
    return fetch(adresse, { cache: "no-store" }).then(function (r) {
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

  // Le serveur répond-il ? (2 s au plus)
  function detecterServeur() {
    if (location.protocol === "file:") return Promise.resolve(false);
    var controle = new AbortController();
    var minuteur = setTimeout(function () { controle.abort(); }, 2000);
    return fetch("../api/velos", { cache: "no-store", signal: controle.signal })
      .then(function (r) {
        clearTimeout(minuteur);
        return r.ok && (r.headers.get("content-type") || "").indexOf("application/json") === 0;
      })
      .catch(function () { clearTimeout(minuteur); return false; });
  }

  // -------------------------------------------------------------------
  // Rafraîchissement
  // -------------------------------------------------------------------
  function rafraichir() {
    if (etat.occupe) return Promise.resolve();
    etat.occupe = true;
    var s = source();
    return Promise.all([s.velos(), s.statistiques(), s.alertes(60), etat.mode === "api" ? s.refus(8) : null])
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

    var libres = [];
    etat.velos.forEach(function (v) {
      if (v.lat === null) return;
      if (!v.enLocation && v.station && parStation[v.station]) parStation[v.station].velos.push(v);
      else libres.push(v);
    });
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
    // Vélos en location : à leur position
    libres.forEach(function (v) { var p = projeter(v.lat, v.lon); dessinerVelo(v, p.x, p.y); });
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
      ["Position", r.enLocation ? "En location" : (r.station || "–"), ""],
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
    debit: "Trop de requêtes", taille: "Corps trop gros", type: "Mauvais type"
  };

  function afficherSecurite() {
    if (etat.mode !== "api") return;
    var motifs = etat.stats.securite ? etat.stats.securite.refusParMotif : [];
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

  function demarrerApi() {
    etat.mode = "api";
    $("txtActualise").hidden = false;
    $("txtSource").textContent = "Connecté au serveur";
    $("txtSecuMode").textContent = "serveur";
    $("secuServeur").hidden = false;
    rafraichir();
    setInterval(rafraichir, 5000);
  }

  brancherEvenements();
  detecterServeur().then(function (present) { if (present) demarrerApi(); else demarrerDemo(); });
})();
