// =====================================================================
// chariots.js — Page de supervision de l'entrepôt (affichage seulement)
// ---------------------------------------------------------------------
// Version industrielle : 8 chariots élévateurs à pneus gonflables, 3
// passerelles BLE → MQTT. Deux sources de données, avec la MÊME forme :
//   - « api »  : le serveur Node répond (maquette Docker, même origine)
//     → on lit /api/chariots, /api/passerelles, /api/refus ;
//   - « demo » : pas de serveur (GitHub Pages, fichier ouvert directement)
//     → l'entrepôt tourne dans le navigateur (entrepot/chariots.js) et ses
//     lots passent par la MÊME logique de réception que le serveur
//     (entrepot/reception.js).
// Connexion et session : comme la page des vélos (flotte/page.js), avec
// le même jeton (même serveur) gardé dans sessionStorage.
// =====================================================================
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var E = TPMS.ENTREPOT;
  var POSITIONS = TPMS.POSITIONS_PNEU_CHARIOT;
  var NOMS_POSITIONS = { AVG: "Avant gauche", AVD: "Avant droit", ARG: "Arrière gauche", ARD: "Arrière droit" };

  var etat = {
    mode: null,                 // "api", "connexion" ou "demo"
    choisi: "C01",
    jeton: null, compte: null, minuteur: null, occupe: false,
    // Dernières données lues (même forme dans les deux modes)
    donnees: { maintenantMs: 0, chariots: [], alertes: [], compteurs: null, passerelles: [], mqtt: null, refus: null },
    demo: null                  // simulation (mode démo)
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
  function heure(t, secondes) {
    return new Date(t).toLocaleTimeString("fr-FR", Object.assign({ hour: "2-digit", minute: "2-digit" }, secondes ? { second: "2-digit" } : {}, FUSEAU));
  }
  function depuis(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return "il y a " + Math.max(0, s) + " s";
    if (s < 3600) return "il y a " + Math.round(s / 60) + " min";
    return "il y a " + Math.round(s / 3600) + " h";
  }

  var TYPES = {
    OK: "OK", ATTENTE: "En attente", BASSE: "Pression basse", HAUTE: "Pression haute", FUITE: "Fuite rapide",
    FUITE_LENTE: "Fuite lente", CREVAISON: "Crevaison", PERDU: "Capteur perdu", INTRUSION: "Signal suspect"
  };
  // Classe de couleur d'un état (mêmes pastilles que la flotte de vélos).
  function classeEtat(e) {
    if (e === "OK") return "ok";
    if (e === "ATTENTE" || !e) return "muet";
    if (e === "BASSE" || e === "HAUTE" || e === "FUITE" || e === "FUITE_LENTE") return "regonfler";
    return "urgent";
  }
  function classePuce(e) {
    var c = classeEtat(e);
    return c === "ok" ? "ok" : c === "regonfler" ? "attention" : c === "urgent" ? "alerte" : "muet";
  }
  var NOMS_ZONES = {};
  E.zones.forEach(function (z) { NOMS_ZONES[z.id] = z.nom; });
  var MOTIFS = { "lot-mqtt": "Lot MQTT refusé", "capteur-inconnu": "Capteur inconnu" };

  // -------------------------------------------------------------------
  // Jeton de session (le même que la page des vélos : même serveur)
  // -------------------------------------------------------------------
  var CLE_JETON = "tpms-flotte-jeton";
  function jetonGarde() { try { return sessionStorage.getItem(CLE_JETON); } catch (e) { return null; } }
  function garderJeton(jeton) {
    try { if (jeton) sessionStorage.setItem(CLE_JETON, jeton); else sessionStorage.removeItem(CLE_JETON); }
    catch (e) { /* stockage indisponible : le jeton reste en mémoire */ }
  }
  function enTetes(jeton) {
    var j = jeton === undefined ? etat.jeton : jeton;
    return j ? { Authorization: "Bearer " + j } : {};
  }

  // -------------------------------------------------------------------
  // Source « api » : le serveur de la maquette
  // -------------------------------------------------------------------
  function lireJson(adresse) {
    return fetch(adresse, { cache: "no-store", headers: enTetes() }).then(function (r) {
      if (r.status === 401) {
        var e = new Error("Session terminée (15 min sans activité, ou 8 h atteintes) : se reconnecter.");
        e.deconnecte = true;
        throw e;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function lireApi() {
    var lireRefus = etat.compte && etat.compte.droits.indexOf("refus") >= 0;
    return Promise.all([
      lireJson("../api/chariots?limite=40"),
      lireJson("../api/passerelles"),
      lireRefus ? lireJson("../api/refus?limite=8") : null,
      lireJson("../api/chariots/" + encodeURIComponent(etat.choisi) + "/historique?heures=8")
    ]).then(function (r) {
      return {
        maintenantMs: r[0].maintenantMs, chariots: r[0].chariots, alertes: r[0].alertes, compteurs: r[0].compteurs,
        passerelles: r[1].passerelles, mqtt: r[1].mqtt, refus: r[2] ? r[2].refus : null, historique: r[3].mesures
      };
    });
  }

  // Le serveur répond-il ? (2 s au plus) — même principe que flotte/page.js.
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
            if (jeton) garderJeton(null);
            return { mode: "connexion", message: jeton ? "La session précédente est terminée : se reconnecter." : "" };
          }
          if (r.status === 429) return { mode: "connexion", message: "Adresse bloquée par le serveur après trop d'essais : réessayer dans quelques minutes." };
          return { mode: "demo" };
        });
      })
      .catch(function () { clearTimeout(minuteur); return { mode: "demo" }; });
  }

  // -------------------------------------------------------------------
  // Source « demo » : l'usine simulée dans la page (entrepot/usine.js)
  // -------------------------------------------------------------------
  // Le MÊME modèle que le simulateur de l'usine : chariots, radio,
  // passerelles (NTP, MQTT, lots, testament), pare-feu, courtier,
  // supervision (entrepot/reception.js), technicien. La page n'affiche que
  // ce que voit la supervision, comme sur la vraie maquette.
  function creerDemo() {
    var u = TPMS.creerUsine({ graine: 2026 });
    return { usine: u, cibleMs: u.tMs, facteur: 10, pause: false, coupees: {} };
  }
  function sujet(id, type) { return "entrepot/lyon/passerelle/" + id + "/" + type; }
  function hexa(octets) { return Array.prototype.map.call(octets, function (o) { return (o < 16 ? "0" : "") + o.toString(16); }).join(""); }
  function avancerDemo(d, dtS) {
    d.cibleMs += dtS * 1000;
    TPMS.usineAvancer(d.usine, d.cibleMs);
  }
  function lireDemo() {
    var u = etat.demo.usine, s = u.machines.supervision.supervision, t = TPMS.usineHeure(u, "supervision");
    var pneus = s.reception.etatDesPneus(t);
    var courtier = u.machines.courtier;
    return Promise.resolve({
      maintenantMs: t,
      chariots: u.monde.chariots.map(function (c) {
        var p = pneus[c.id] || { etat: "ATTENTE", pneus: {} };
        return { id: c.id, nom: "Chariot " + c.id.slice(1), zone: s.reception.zoneDe(c.id), etat: p.etat, pneus: p.pneus };
      }),
      alertes: s.alertes, compteurs: s.reception.compteurs,
      passerelles: Object.keys(s.passerelles).map(function (id) { return s.passerelles[id]; }),
      mqtt: { configure: true, connecte: !!(s.connexion && s.connexion.ouverte && courtier.alimentee && courtier.programme) },
      refus: s.refus, historique: s.historique[etat.choisi] || []
    });
  }

  // -------------------------------------------------------------------
  // Rafraîchissement
  // -------------------------------------------------------------------
  function rafraichir() {
    if (etat.occupe) return Promise.resolve();
    etat.occupe = true;
    var lecture = etat.mode === "api" ? lireApi() : lireDemo();
    return lecture.then(function (donnees) {
      etat.donnees = donnees;
      afficherTout();
      if (etat.mode === "api") $("txtActualise").textContent = "Actualisé à " + heure(Date.now(), true);
    }).catch(function (e) {
      if (e.deconnecte) {
        garderJeton(null);
        etat.jeton = null;
        clearInterval(etat.minuteur);
        afficherConnexion(e.message);
      } else if (etat.mode === "api") {
        $("txtActualise").textContent = "Serveur injoignable (" + e.message + ")";
      }
    }).then(function () { etat.occupe = false; });
  }

  function afficherTout() {
    var d = etat.donnees;
    $("horloge").textContent = heure(d.maintenantMs);
    afficherIndicateurs(d);
    afficherPlan(d);
    afficherTableau(d);
    afficherDetail(d);
    afficherPasserelles(d);
    afficherAlertes(d);
    afficherSecurite(d);
  }

  // -------------------------------------------------------------------
  // Indicateurs et état global
  // -------------------------------------------------------------------
  function afficherIndicateurs(d) {
    var enEtat = d.chariots.filter(function (c) { return c.etat === "OK"; }).length;
    var attente = 0;
    d.chariots.forEach(function (c) { POSITIONS.forEach(function (p) { if (!c.pneus[p] || c.pneus[p].etat === "ATTENTE") attente++; }); });
    $("kpiChariots").textContent = enEtat + " / " + d.chariots.length;
    $("kpiChariotsDetail").textContent = attente ? attente + " pneu(s) en attente de mesures" : "Tous les capteurs ont parlé";

    var alertes = [];
    d.chariots.forEach(function (c) {
      POSITIONS.forEach(function (p) {
        var pn = c.pneus[p];
        if (pn && TPMS.estAlerte(pn.etat)) alertes.push(c.id + " " + p + " : " + (TYPES[pn.etat] || pn.etat).toLowerCase());
      });
    });
    $("kpiPneus").textContent = alertes.length;
    $("kpiPneusTotal").textContent = d.chariots.length * POSITIONS.length;
    $("kpiPneusDetail").textContent = alertes.length ? alertes.slice(0, 2).join(" · ") + (alertes.length > 2 ? "…" : "") : "Aucun pneu à traiter";

    var enLigne = d.passerelles.filter(function (p) { return p.etat === "en ligne"; }).length;
    $("kpiPasserelles").textContent = enLigne + " / " + E.passerelles.length;
    var decalages = d.passerelles.map(function (p) { return Math.abs(p.decalage_ntp_ms || 0); });
    $("kpiPasserellesDetail").textContent = d.passerelles.length ? "Écart d'horloge NTP max : " + Math.max.apply(null, decalages) + " ms" : "";

    var c = d.compteurs || {};
    var rejets = (c.inconnues || 0) + (c.invraisemblables || 0) + (c.invalides || 0);
    $("kpiRejets").textContent = rejets + (c.lotsRefuses || 0);
    $("kpiRejetsDetail").textContent = rejets + " annonce(s) et " + (c.lotsRefuses || 0) + " lot(s) entier(s) · " + ((c.acceptees || 0) + (c.enRetard || 0)) + " annonces acceptées";

    // État global : le plus grave d'abord.
    var urgents = d.chariots.filter(function (ch) { return classeEtat(ch.etat) === "urgent"; });
    var aTraiter = d.chariots.filter(function (ch) { return classeEtat(ch.etat) === "regonfler"; });
    var horsLigne = d.passerelles.filter(function (p) { return p.etat !== "en ligne"; });
    var g = $("etatGlobal");
    g.className = "etat-global " + (urgents.length || horsLigne.length ? "alerte" : aTraiter.length ? "attention" : enEtat ? "" : "repos");
    $("etatTitre").textContent = urgents.length ? urgents.length + " chariot(s) à immobiliser"
      : horsLigne.length ? "Passerelle " + horsLigne.map(function (p) { return p.id; }).join(", ") + " hors ligne"
      : aTraiter.length ? aTraiter.length + " chariot(s) à regonfler" : enEtat ? "Tous les chariots sont en état" : "En attente des premières mesures";
    $("etatDetail").textContent = urgents.concat(aTraiter).map(function (ch) { return ch.id + " (" + (TYPES[ch.etat] || ch.etat).toLowerCase() + ")"; }).join(" · ")
      || (horsLigne.length ? "Les chariots de sa zone ne sont entendus que par les passerelles voisines, s'ils sont à portée." : "");
  }

  // -------------------------------------------------------------------
  // Plan de l'entrepôt
  // -------------------------------------------------------------------
  // 1 m = 8 px. La supervision ne connaît que la ZONE de chaque chariot
  // (la passerelle qui l'entend le mieux), pas sa position exacte : les
  // chariots sont donc rangés dans leur zone, pas placés au mètre près.
  var ECHELLE = 8, HAUT = 30;
  function afficherPlan(d) {
    var svg = $("plan"), S = TPMS.svgElement;
    svg.innerHTML = "";
    var defs = S("defs", {});
    var clip = S("clipPath", { id: "clipPlan" });
    clip.appendChild(S("rect", { x: 0, y: HAUT, width: E.largeurM * ECHELLE, height: E.profondeurM * ECHELLE, rx: 12 }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    E.zones.forEach(function (z) {
      var x = z.x0 * ECHELLE, l = (z.x1 - z.x0) * ECHELLE;
      svg.appendChild(S("rect", { x: x + 2, y: HAUT, width: l - 4, height: E.profondeurM * ECHELLE, rx: 12, "class": "zone-plan" + (z.exterieur ? " exterieur" : "") }));
      svg.appendChild(S("text", { x: x + 14, y: HAUT - 10, "class": "zone-nom" }, z.nom + (z.exterieur ? " (dehors)" : "")));
    });
    // Racks de stockage dans les allées (décor).
    for (var r = 0; r < 4; r++) svg.appendChild(S("rect", { x: 44 * ECHELLE + r * 9 * ECHELLE, y: HAUT + 40, width: 18, height: 70, rx: 3, "class": "rack" }));

    // Passerelles et leur portée radio.
    var portee = S("g", { "clip-path": "url(#clipPlan)" });
    d.passerelles.forEach(function (p) {
      var pos = E.passerelles[p.id - 1];
      if (!pos) return;
      var cx = pos.x * ECHELLE, cy = HAUT + pos.y * ECHELLE, enLigne = p.etat === "en ligne";
      portee.appendChild(S("circle", { cx: cx, cy: cy, r: 24 * ECHELLE, "class": "portee" + (enLigne ? "" : " coupee") }));
      portee.appendChild(S("circle", { cx: cx, cy: cy, r: 9, "class": "passerelle-plan" + (enLigne ? "" : " coupee") }));
      portee.appendChild(S("text", { x: cx + 14, y: cy + 4, "class": "passerelle-texte" }, "P" + p.id + (enLigne ? "" : " hors ligne")));
    });
    svg.appendChild(portee);

    // Chariots, rangés dans leur zone.
    var parZone = {};
    d.chariots.forEach(function (c) { (parZone[c.zone || "?"] = parZone[c.zone || "?"] || []).push(c); });
    E.zones.forEach(function (z) {
      (parZone[z.id] || []).forEach(function (c, i) {
        var x = z.x0 * ECHELLE + 24 + (i % 4) * 76, y = HAUT + 168 + Math.floor(i / 4) * 34;
        var g = S("g", { "class": "chariot-plan" + (c.id === etat.choisi ? " choisi" : ""), "data-id": c.id, tabindex: 0 });
        g.appendChild(S("rect", { x: x, y: y, width: 62, height: 24, rx: 8, "class": "velo " + classeEtat(c.etat) }));
        g.appendChild(S("text", { x: x + 31, y: y + 16, "class": "chariot-texte" }, c.id));
        g.appendChild(S("title", {}, c.nom + " : " + (TYPES[c.etat] || c.etat)));
        svg.appendChild(g);
      });
    });
    var sansZone = parZone["?"] || [];
    if (sansZone.length) svg.appendChild(S("text", { x: 8, y: HAUT + E.profondeurM * ECHELLE + 22, "class": "zone-nom" },
      "Pas encore entendus : " + sansZone.map(function (c) { return c.id; }).join(", ")));
  }

  // -------------------------------------------------------------------
  // Tableau des pneus
  // -------------------------------------------------------------------
  function cellulePneu(pn) {
    if (!pn || pn.pression === undefined) return "<td class=\"pneu muet\">–</td>";
    var titre = nombre(pn.temperature, 1) + " °C · pile " + pn.pile + " % · " + (TYPES[pn.etat] || pn.etat);
    return "<td class=\"pneu " + classeEtat(pn.etat) + "\" title=\"" + echapper(titre) + "\">" + nombre(pn.pression) + "</td>";
  }
  function afficherTableau(d) {
    $("corpsChariots").innerHTML = d.chariots.map(function (c) {
      return "<tr data-id=\"" + echapper(c.id) + "\"" + (c.id === etat.choisi ? " class=\"choisi\"" : "") + ">" +
        "<td>" + echapper(c.id) + "</td><td>" + echapper(NOMS_ZONES[c.zone] || "–") + "</td>" +
        POSITIONS.map(function (p) { return cellulePneu(c.pneus[p]); }).join("") +
        "<td><span class=\"puce " + classePuce(c.etat) + "\">" + echapper(TYPES[c.etat] || c.etat) + "</span></td></tr>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Détail d'un chariot : courbes des 4 pneus
  // -------------------------------------------------------------------
  function afficherDetail(d) {
    var c = d.chariots.find(function (x) { return x.id === etat.choisi; });
    if (!c) return;
    $("detailTitre").textContent = c.nom + (c.zone ? " · " + (NOMS_ZONES[c.zone] || c.zone) : "");
    $("detailEtat").className = "puce " + classePuce(c.etat);
    $("detailEtat").textContent = TYPES[c.etat] || c.etat;
    var t0 = d.maintenantMs, h = d.historique || [];
    var classes = { AVG: "", AVD: "s2", ARG: "s3", ARD: "s4" };
    TPMS.grapheLignes($("grapheDetail"), {
      series: POSITIONS.map(function (p) {
        return { classe: classes[p], points: h.filter(function (m) { return m.position === p; }).map(function (m) { return [(m.t - t0) / 3600000, m.pression]; }) };
      }),
      xMax: 0, pasY: 0.25,
      reperes: [{ y: TPMS.RECEPTION.seuils.basBar, texte: "bas 7,8" }],
      formatX: function (v) { return v > -0.05 ? "maintenant" : "−" + nombre(-v, 1).replace(",0", "") + " h"; },
      formatY: function (v) { return nombre(v, 2); },
      vide: "Pas encore de mesures (une par minute et par pneu)"
    });
    $("detailMesures").innerHTML = POSITIONS.map(function (p) {
      var pn = c.pneus[p];
      var texte = pn && pn.pression !== undefined
        ? nombre(pn.pression) + " bar <small>" + nombre(pn.temperature, 1) + " °C · " + pn.pile + " % · " +
          (pn.pression20 !== undefined ? nombre(pn.pression20) + " à 20 °C" : "") +
          (pn.tendanceBarJour !== null && pn.tendanceBarJour !== undefined ? " · " + nombre(pn.tendanceBarJour, 3) + " bar/j" : "") + "</small>" : "en attente";
      var cls = pn ? classeEtat(pn.etat) : "muet";
      return "<div><dt>" + NOMS_POSITIONS[p] + "</dt><dd class=\"" + (cls === "urgent" ? "alerte-texte" : cls === "regonfler" ? "attention-texte" : "") + "\">" + texte + "</dd></div>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Passerelles
  // -------------------------------------------------------------------
  function afficherPasserelles(d) {
    $("corpsPasserelles").innerHTML = d.passerelles.map(function (p) {
      var enLigne = p.etat === "en ligne";
      return "<tr><td>P" + p.id + "</td><td>" + echapper(NOMS_ZONES[p.zone] || p.zone || "–") + "</td>" +
        "<td><span class=\"puce " + (enLigne ? "ok" : "alerte") + "\">" + echapper(p.etat) + "</span></td>" +
        "<td>" + (p.decalage_ntp_ms === null || p.decalage_ntp_ms === undefined ? "–" : "écart " + p.decalage_ntp_ms + " ms") + "</td>" +
        "<td>" + p.lots + "</td><td>" + p.annonces + "</td><td>" + depuis(d.maintenantMs - p.t) + "</td></tr>";
    }).join("") || "<tr><td colspan=\"7\">Aucune passerelle ne s'est encore annoncée.</td></tr>";
    var m = d.mqtt;
    var puce = $("txtMqtt");
    if (!m) { puce.className = "puce accent"; puce.textContent = "MQTT simulé"; }
    else if (!m.configure) { puce.className = "puce muet"; puce.textContent = "MQTT non configuré"; }
    else if (m.connecte) { puce.className = "puce ok"; puce.textContent = "Courtier connecté (TLS)"; }
    else { puce.className = "puce alerte"; puce.textContent = "Courtier injoignable"; }
    if (etat.demo) $("btnCouper").textContent = etat.demo.coupees[2] ? "Rétablir le courant de la passerelle 2" : "Couper le courant de la passerelle 2 (testament après 45 s)";
  }

  // -------------------------------------------------------------------
  // Alertes
  // -------------------------------------------------------------------
  function afficherAlertes(d) {
    $("listeAlertes").innerHTML = (d.alertes || []).slice(0, 40).map(function (a) {
      var grave = classeEtat(a.type) === "urgent";
      return "<li class=\"" + (grave ? "alerte" : "") + "\" data-id=\"" + echapper(a.chariot_id) + "\"><span class=\"heure\">" + heure(a.t) + "</span><span>" +
        "<b>" + echapper(a.chariot_id) + "</b> · " + echapper(NOMS_POSITIONS[a.position] || a.position) + " · " +
        echapper(TYPES[a.type] || a.type) + (a.pression !== null && a.pression !== undefined ? " (" + nombre(a.pression) + " bar)" : "") + "</span></li>";
    }).join("");
  }

  // -------------------------------------------------------------------
  // Sécurité : compteurs de la réception, refus, banc d'essai
  // -------------------------------------------------------------------
  function afficherSecurite(d) {
    var c = d.compteurs || {};
    var lignes = [
      { nom: "Annonces acceptées", n: c.acceptees || 0, classe: "" },
      { nom: "Doublons (2 passerelles)", n: c.doublons || 0, classe: "" },
      { nom: "En retard (déjà plus récentes)", n: c.enRetard || 0, classe: "" },
      { nom: "Capteurs inconnus", n: c.inconnues || 0, classe: "alerte" },
      { nom: "Invraisemblables", n: c.invraisemblables || 0, classe: "alerte" },
      { nom: "Trames invalides", n: c.invalides || 0, classe: "alerte" },
      { nom: "Lots entiers refusés", n: c.lotsRefuses || 0, classe: "alerte" }
    ];
    var max = Math.max.apply(null, lignes.map(function (l) { return l.n; }).concat([1]));
    $("secuCompteurs").innerHTML = lignes.map(function (l) {
      return "<div class=\"barre-ligne\"><span class=\"nom\">" + l.nom + "</span>" +
        "<span class=\"piste\"><span class=\"plein " + l.classe + "\" style=\"display:block;width:" + Math.max(l.n ? 2 : 0, Math.round(l.n / max * 100)) + "%\"></span></span>" +
        "<span class=\"val\">" + l.n + "</span></div>";
    }).join("");
    var voitRefus = d.refus !== null && d.refus !== undefined;
    $("secuRefusBloc").hidden = !voitRefus;
    $("secuReserve").hidden = voitRefus || etat.mode !== "api";
    if (voitRefus) {
      $("secuRefus").innerHTML = d.refus.slice(0, 8).map(function (r) {
        return "<tr><td>" + heure(r.t, true) + "</td><td class=\"mono\">" + echapper(r.ip || "–") + "</td><td>" +
          echapper(MOTIFS[r.motif] || r.motif) + "<span class=\"raison\">" + echapper(r.detail) + "</span></td></tr>";
      }).join("") || "<tr><td colspan=\"3\">Aucun refus.</td></tr>";
    }
  }

  // Banc d'essai (mode démo) : des lots piégés, comme entrepot/intrus.js,
  // remis à la même logique de réception que le serveur.
  function bancEssai(nom) {
    var u = etat.demo.usine, rec = u.machines.supervision.supervision.reception, t = TPMS.usineHeure(u, "supervision");
    var registre = TPMS.entrepotRegistreCapteurs(u.monde)[0];        // C01, AVG
    function trame(adresse, pressionBar) {
      var octets = adresse.split(":").map(function (x) { return parseInt(x, 16); });
      return hexa(TPMS.encoderTrame({ numero: 1, adresse: octets, pressionBar: pressionBar, temperatureC: 15, batteriePct: 80, alarme: 0 }));
    }
    var annonce = { t: t, rssi: -60, trame: trame(registre.adresse, 8.5) }, lot = { passerelle: 1, site: "lyon", zone: "quais", envoiMs: t };
    var titres = {
      "faux-lot": "Lot « de la passerelle 2 » sur le sujet de la 1", "capteur-inconnu": "Trame du capteur C4:10:99:00:01",
      "valeur-aberrante": "Pneu AVG de C01 annoncé à 20 bar", "rejeu": "Annonces vieilles de 3 h", "injection": "Trame « zz' OR 1=1 -- »"
    };
    if (nom === "faux-lot") lot.passerelle = 2;
    if (nom === "capteur-inconnu") annonce.trame = trame("C4:10:99:00:01", 8.5);
    if (nom === "valeur-aberrante") annonce.trame = trame(registre.adresse, 20);
    if (nom === "rejeu") annonce.t = t - 3 * 3600000;
    if (nom === "injection") annonce.trame = "zz' OR 1=1 --";
    lot.annonces = [annonce];

    var avant = Object.assign({}, rec.compteurs);
    var probleme = rec.recevoirMessage(sujet(1, "trames"), JSON.stringify(lot), t);
    var apres = rec.compteurs, verdict;
    if (probleme) verdict = "lot refusé : " + probleme;
    else if (apres.inconnues > avant.inconnues) verdict = "annonce rejetée : capteur absent du registre (liste blanche)";
    else if (apres.invraisemblables > avant.invraisemblables) verdict = "annonce rejetée : invraisemblable (plage 0-13 bar) ; la pression affichée ne change pas";
    else verdict = "ACCEPTÉ";
    var li = document.createElement("li");
    li.innerHTML = "<span class=\"heure\">" + heure(t, true) + "</span><span>" + echapper(titres[nom]) + " → <span class=\"" +
      (verdict === "ACCEPTÉ" ? "verdict-ok" : "verdict-refus") + "\">" + echapper(verdict) + "</span></span>";
    $("secuEssais").insertBefore(li, $("secuEssais").firstChild);
    rafraichir();
  }

  // -------------------------------------------------------------------
  // Schéma du réseau (fixe) : zones, pare-feu et conduits numérotés
  // -------------------------------------------------------------------
  function dessinerReseau() {
    var svg = $("schemaReseau"), S = TPMS.svgElement;
    function boite(x, y, l, h, titre, lignes, classe) {
      svg.appendChild(S("rect", { x: x, y: y, width: l, height: h, rx: 12, "class": "boite-reseau " + (classe || "") }));
      svg.appendChild(S("text", { x: x + 12, y: y + 20, "class": "boite-titre" }, titre));
      lignes.forEach(function (t, i) { svg.appendChild(S("text", { x: x + 12, y: y + 40 + i * 16, "class": "boite-texte" }, t)); });
    }
    function conduit(x1, y1, x2, y2, texte, tx, ty, refuse) {
      svg.appendChild(S("line", { x1: x1, y1: y1, x2: x2, y2: y2, "class": "conduit" + (refuse ? " refuse" : "") }));
      if (texte) svg.appendChild(S("text", { x: tx, y: ty, "class": "conduit-texte" + (refuse ? " refuse" : "") }, texte));
    }
    conduit(170, 60, 205, 140, "1 MQTT TLS · 2 NTP · 3 syslog", 12, 128);
    conduit(315, 140, 350, 75, "", 0, 0);
    conduit(170, 240, 205, 160, "4 HTTPS", 120, 196);
    conduit(350, 240, 315, 160, "5 HTTPS (prévu)", 362, 196);
    conduit(95, 100, 95, 200, "✕ OT ↔ bureautique", 102, 156, true);
    boite(10, 10, 160, 90, "VLAN 10 · atelier (OT)", ["3 passerelles BLE → MQTT", "10.10.10.0/24"], "ot");
    boite(350, 10, 160, 120, "VLAN 20 · serveurs", ["courtier MQTT :8883", "supervision :8443", "NTP · syslog", "10.10.20.0/24"], "serveurs");
    boite(10, 200, 160, 90, "VLAN 30 · bureautique", ["postes du bureau", "10.10.30.0/24"], "bureau");
    boite(350, 200, 160, 90, "VLAN 40 · DMZ", ["accès distant (prévu)", "10.10.40.0/24"], "dmz");
    svg.appendChild(S("rect", { x: 205, y: 130, width: 110, height: 40, rx: 10, "class": "boite-reseau pare-feu" }));
    svg.appendChild(S("text", { x: 260, y: 148, "class": "boite-titre centre" }, "Pare-feu"));
    svg.appendChild(S("text", { x: 260, y: 163, "class": "boite-texte centre" }, "tout refusé par défaut"));
  }

  // -------------------------------------------------------------------
  // Événements
  // -------------------------------------------------------------------
  function choisir(id) {
    etat.choisi = id;
    if (etat.mode === "api") rafraichir(); else afficherTout();
  }
  function brancherEvenements() {
    $("plan").addEventListener("click", function (e) {
      var g = e.target.closest(".chariot-plan");
      if (g) choisir(g.getAttribute("data-id"));
    });
    $("corpsChariots").addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (tr && tr.dataset.id) choisir(tr.dataset.id);
    });
    $("listeAlertes").addEventListener("click", function (e) {
      var li = e.target.closest("li");
      if (li && li.dataset.id) choisir(li.dataset.id);
    });
    $("btnPause").addEventListener("click", function () {
      etat.demo.pause = !etat.demo.pause;
      $("btnPause").querySelector("use").setAttribute("href", etat.demo.pause ? "#i-play" : "#i-pause");
    });
    document.querySelectorAll("#choixFacteur button").forEach(function (b) {
      b.addEventListener("click", function () {
        etat.demo.facteur = Number(b.dataset.facteur);
        document.querySelectorAll("#choixFacteur button").forEach(function (x) { x.classList.toggle("actif", x === b); });
      });
    });
    // Couper la passerelle 2 : plus rien n'en sort ; le courtier publie
    // son testament « hors ligne », comme dans la maquette Docker.
    // Couper le courant de la passerelle 2 : le courtier ne le voit qu'à la
    // fin du délai de garde (45 s), puis publie son testament « hors ligne ».
    $("btnCouper").addEventListener("click", function () {
      var d = etat.demo;
      d.coupees[2] = !d.coupees[2];
      TPMS.usinePanne(d.usine, "passerelle-2", d.coupees[2] ? "couper-courant" : "rebrancher");
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
    $("bandeauDemo").hidden = false;
    $("commandesTemps").hidden = false;
    $("commandesPasserelles").hidden = false;
    $("secuBanc").hidden = false;
    $("txtSource").textContent = "Mode démo (sans serveur)";
    $("txtSecuMode").textContent = "démo";
    $("etatTitre").textContent = "Simulation du début du poste…";
    setTimeout(function () {
      etat.demo = creerDemo();
      avancerDemo(etat.demo, 3 * 3600);                 // de 6 h à 9 h : des courbes dès l'ouverture
      rafraichir();
      var tour = 0;
      setInterval(function () {
        var d = etat.demo;
        if (!d.pause) avancerDemo(d, d.facteur * 0.25);
        tour++;
        if (!d.pause && tour % 4 === 0) rafraichir();
      }, 250);
    }, 30);
  }

  function demarrerApi(jeton, compte) {
    etat.mode = "api";
    etat.jeton = jeton;
    etat.compte = compte;
    $("ecranConnexion").hidden = true;
    $("txtActualise").hidden = false;
    $("txtSource").textContent = location.protocol === "https:" ? "Serveur · HTTPS chiffré" : "Serveur · HTTP non chiffré";
    $("txtCompte").textContent = "Compte " + compte.compte + (compte.compte === compte.role ? "" : " (" + compte.role + ")");
    $("zoneCompte").hidden = false;
    $("txtSecuMode").textContent = "serveur";
    rafraichir();
    clearInterval(etat.minuteur);
    etat.minuteur = setInterval(rafraichir, 5000);
  }

  function afficherConnexion(message) {
    etat.mode = "connexion";
    $("txtSource").textContent = "Serveur · connexion requise";
    $("zoneCompte").hidden = true;
    $("etatTitre").textContent = "Connexion requise";
    $("etatDetail").textContent = "Les données de l'entrepôt sont réservées aux comptes identifiés.";
    $("ecranConnexion").hidden = false;
    $("avertHttp").hidden = location.protocol === "https:";
    $("erreurConnexion").textContent = message || "";
    $("erreurConnexion").hidden = !message;
    $("champMotDePasse").value = "";
    $("champCompte").focus();
  }

  function brancherConnexion() {
    $("formConnexion").addEventListener("submit", function (e) {
      e.preventDefault();                       // le mot de passe ne va jamais dans l'adresse
      var compte = $("champCompte").value.trim(), motDePasse = $("champMotDePasse").value;
      $("champMotDePasse").value = "";
      var bouton = $("btnConnexion");
      bouton.disabled = true;
      fetch("../api/connexion", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compte: compte, motDePasse: motDePasse }) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (json) {
            if (r.ok) { garderJeton(json.jeton); demarrerApi(json.jeton, json); return; }
            $("erreurConnexion").textContent = r.status === 401 ? "Compte ou mot de passe incorrect."
              : r.status === 429 ? "Trop d'essais : adresse bloquée quelques minutes par le serveur." : "Erreur du serveur (HTTP " + r.status + ").";
            $("erreurConnexion").hidden = false;
          });
        })
        .catch(function () { $("erreurConnexion").textContent = "Serveur injoignable."; $("erreurConnexion").hidden = false; })
        .then(function () { bouton.disabled = false; });
    });
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

  dessinerReseau();
  brancherEvenements();
  brancherConnexion();
  detecterServeur().then(function (r) {
    if (r.mode === "api") demarrerApi(r.jeton, r.compte);
    else if (r.mode === "connexion") afficherConnexion(r.message);
    else demarrerDemo();
  });
})();
