// =====================================================================
// transport-ble.js — Joindre le VRAI boîtier par Web Bluetooth
// ---------------------------------------------------------------------
// Fonctionne dans Chrome (PC, Android) et, sur iPhone, dans le
// navigateur Bluefy (Safari ne connaît pas Web Bluetooth).
// La page doit être servie en HTTPS (par exemple GitHub Pages).
//
// L'appairage (code à 6 chiffres) est géré par le système du téléphone :
// il le demande tout seul dès qu'on lit une caractéristique chiffrée.
//
// Le transport simulé (transport-simule.js) offre exactement les mêmes
// fonctions : app.js ne sait pas à qui il parle.
// =====================================================================
var TransportBLE = (function () {
  "use strict";

  var appareil = null;
  var car = { mesures: null, reglages: null, commande: null };
  var rappelMesures = function () {};
  var rappelDeconnexion = function () {};

  function disponible() {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  function versOctets(dataView) {
    return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength).slice();
  }

  // Ouvre la fenêtre de choix du navigateur, puis se connecte.
  async function connecter() {
    appareil = await navigator.bluetooth.requestDevice({
      filters: [{ services: [TPMS.UUID.SERVICE] }]
    });
    appareil.addEventListener("gattserverdisconnected", function () { rappelDeconnexion(); });
    var serveur = await appareil.gatt.connect();
    var service = await serveur.getPrimaryService(TPMS.UUID.SERVICE);
    car.mesures = await service.getCharacteristic(TPMS.UUID.MESURES);
    car.reglages = await service.getCharacteristic(TPMS.UUID.REGLAGES);
    car.commande = await service.getCharacteristic(TPMS.UUID.COMMANDE);

    car.mesures.addEventListener("characteristicvaluechanged", function (e) {
      rappelMesures(versOctets(e.target.value));
    });
    await car.mesures.startNotifications();
    return "connecte";
  }

  // Avec la vraie radio, le code se tape dans la fenêtre du système.
  async function saisirCode() {
    return "ok";
  }

  async function lireReglages() {
    return versOctets(await car.reglages.readValue());
  }

  async function ecrireReglages(octets) {
    try {
      await car.reglages.writeValueWithResponse(octets);
      return "ok";
    } catch (e) {
      // Le boîtier refuse (réglages incohérents ou lien non chiffré).
      return "refusé par le boîtier (" + e.message + ")";
    }
  }

  async function commande(octet) {
    await car.commande.writeValueWithResponse(new Uint8Array([octet]));
    return "ok";
  }

  function deconnecter() {
    if (appareil && appareil.gatt.connected) appareil.gatt.disconnect();
  }

  // On ne peut pas effacer la clé d'appairage depuis une page web :
  // il faut passer par les réglages Bluetooth du téléphone.
  function oublier() {
    deconnecter();
    return "Pour oublier complètement le boîtier, supprime-le aussi dans les réglages Bluetooth du téléphone.";
  }

  return {
    nom: "Bluetooth",
    cleHistorique: "tpms-historique",
    disponible: disponible,
    connecter: connecter,
    saisirCode: saisirCode,
    lireReglages: lireReglages,
    ecrireReglages: ecrireReglages,
    commande: commande,
    deconnecter: deconnecter,
    oublier: oublier,
    surMesures: function (f) { rappelMesures = f; },
    surDeconnexion: function (f) { rappelDeconnexion = f; },
    maintenant: function () { return Date.now(); }
  };
})();
