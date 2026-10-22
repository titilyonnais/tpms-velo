// =====================================================================
// securite.js — Protections contre les faux capteurs
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++ dans le firmware.
//
// Les capteurs TPMS diffusent leurs mesures EN CLAIR, sans signature :
// n'importe qui peut écouter les trames, et un émetteur BLE peut en
// fabriquer de fausses. Le boîtier doit donc trier ce qu'il reçoit.
//
// Niveau 1 (ici) : liste blanche. Seuls les deux capteurs appairés
// sont écoutés. Les trames des capteurs de la voiture ou du vélo d'à
// côté sont ignorées.
//
// D'autres protections viendront dans le module 4 du simulateur :
// contrôle de vraisemblance et détection du rejeu.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// appairage = { AV: "EA:CA:3F:1B:07", AR: "EA:CA:3F:1B:08" }
// Retourne "AV", "AR", ou null si le capteur n'est pas dans la liste.
TPMS.positionCapteur = function (appairage, adresse) {
  if (appairage.AV === adresse) return "AV";
  if (appairage.AR === adresse) return "AR";
  return null;
};
