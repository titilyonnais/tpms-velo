// =====================================================================
// transport-simule.js — Joindre le boîtier VIRTUEL du simulateur
// ---------------------------------------------------------------------
// Quand l'app est ouverte dans le simulateur (dans un cadre <iframe>),
// elle dialogue avec le boîtier virtuel par messages (postMessage) au
// lieu de la radio. Les octets échangés sont exactement ceux de la
// vraie liaison BLE (voir logique/protocole.js).
//
// Le temps aussi vient du simulateur : si on accélère la simulation,
// l'historique de l'app avance au même rythme.
// =====================================================================
var TransportSimule = (function () {
  "use strict";

  var DEBUT_SIMULATION = Date.UTC(2026, 9, 22, 6, 0, 0);   // date fictive du début
  var tempsSimuleMs = 0;
  var enAttente = {};          // réponses attendues, par type de message
  var rappelMesures = function () {};
  var rappelDeconnexion = function () {};

  function envoyer(message) {
    window.parent.postMessage(message, "*");
  }

  // Envoie une demande et attend la réponse du simulateur.
  function demander(type, donnees, typeReponse) {
    return new Promise(function (resoudre) {
      enAttente[typeReponse] = resoudre;
      var message = donnees || {};
      message.type = type;
      envoyer(message);
    });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;   // on n'écoute que le simulateur
    var m = e.data;
    if (typeof m.tMs === "number") tempsSimuleMs = m.tMs;
    if (m.type === "mesures") {
      rappelMesures(new Uint8Array(m.octets));
    } else if (m.type === "deconnecte") {
      rappelDeconnexion();
    } else if (enAttente[m.type]) {
      var resoudre = enAttente[m.type];
      delete enAttente[m.type];
      resoudre(m.octets ? new Uint8Array(m.octets) : m.resultat);
    }
  });

  return {
    nom: "Simulateur",
    cleHistorique: "tpms-historique-simule",
    disponible: function () { return window.parent !== window; },
    connecter: function () { return demander("connexion", null, "connexion-resultat"); },
    saisirCode: function (code) { return demander("code", { code: code }, "code-resultat"); },
    lireReglages: function () { return demander("lireReglages", null, "reglages"); },
    ecrireReglages: function (octets) {
      return demander("ecrireReglages", { octets: Array.from(octets) }, "ecriture-resultat");
    },
    commande: function (octet) { return demander("commande", { octet: octet }, "commande-resultat"); },
    deconnecter: function () { envoyer({ type: "deconnexion" }); },
    oublier: function () { envoyer({ type: "oublier" }); return ""; },
    surMesures: function (f) { rappelMesures = f; },
    surDeconnexion: function (f) { rappelDeconnexion = f; },
    maintenant: function () { return DEBUT_SIMULATION + tempsSimuleMs; }
  };
})();
