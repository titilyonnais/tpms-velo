// =====================================================================
// liaison.js — Côté boîtier de la liaison avec l'application
// ---------------------------------------------------------------------
// Dans le firmware, c'est la pile BLE (Bluefruit) qui gère l'appairage
// et le chiffrement. Notre code se contente de :
//   - afficher sur l'écran le code à 6 chiffres que la pile lui donne ;
//   - refuser les réglages tant que le lien n'est pas appairé et chiffré ;
//   - vérifier que les réglages reçus ont du sens.
// Ici on simule aussi la partie « pile BLE », pour voir le déroulé.
//
// Pourquoi un code affiché ? Sans lui, l'appairage « Just Works » ne
// protège pas d'une attaque de l'homme du milieu : un pirate pourrait
// s'intercaler entre le téléphone et le boîtier. Le code n'est visible
// que par la personne qui a le vélo sous les yeux.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.CODE_DUREE_MS = 60000;      // le code reste affiché 1 min
TPMS.CODE_ESSAIS_MAX = 3;        // 3 codes faux...
TPMS.CODE_BLOCAGE_MS = 60000;    // ... et l'appairage est bloqué 1 min

TPMS.creerLiaison = function () {
  return {
    connecte: false,
    appaire: false,        // téléphone déjà appairé (clé mémorisée)
    code: null,            // code affiché pendant l'appairage
    codeJusquaMs: 0,
    essais: 0,
    bloqueJusquaMs: 0,
    sequence: 0            // numéro de la prochaine notification MESURES
  };
};

// Le téléphone demande la connexion.
// Retourne "connecte" (téléphone déjà appairé), "code-requis" ou "bloque".
TPMS.liaisonConnexion = function (b, maintenantMs) {
  var l = b.liaison;
  if (l.appaire) {
    l.connecte = true;
    b.ecranUrgent = true;
    TPMS.boitierJournal(b, maintenantMs, "App connectée (lien chiffré)");
    return "connecte";
  }
  if (maintenantMs < l.bloqueJusquaMs) return "bloque";
  // Un code déjà affiché et encore valide n'est pas remplacé : sinon
  // n'importe qui à portée pourrait changer le code sous les yeux du
  // cycliste à chaque tentative et l'empêcher de s'appairer.
  if (l.code !== null && maintenantMs <= l.codeJusquaMs) return "code-requis";
  // Dans le firmware : nombre tiré par le générateur aléatoire matériel du nRF52840.
  l.code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  l.codeJusquaMs = maintenantMs + TPMS.CODE_DUREE_MS;
  b.ecranUrgent = true;
  TPMS.boitierJournal(b, maintenantMs, "Demande d'appairage : code affiché à l'écran");
  return "code-requis";
};

// L'utilisateur tape le code sur son téléphone.
// Retourne "ok", "faux", "expire" ou "bloque".
TPMS.liaisonSaisirCode = function (b, code, maintenantMs) {
  var l = b.liaison;
  if (maintenantMs < l.bloqueJusquaMs) return "bloque";
  if (l.code === null || maintenantMs > l.codeJusquaMs) return "expire";
  if (code !== l.code) {
    l.essais++;
    TPMS.boitierJournal(b, maintenantMs, "Code d'appairage faux (" + l.essais + "/" + TPMS.CODE_ESSAIS_MAX + ")");
    if (l.essais >= TPMS.CODE_ESSAIS_MAX) {
      l.bloqueJusquaMs = maintenantMs + TPMS.CODE_BLOCAGE_MS;
      l.essais = 0;
      l.code = null;
      b.ecranUrgent = true;
      TPMS.boitierJournal(b, maintenantMs, "Appairage bloqué 1 min (trop d'essais)");
      return "bloque";
    }
    return "faux";
  }
  l.code = null;
  l.essais = 0;
  l.appaire = true;
  l.connecte = true;
  b.ecranUrgent = true;
  TPMS.boitierJournal(b, maintenantMs, "Téléphone appairé, lien chiffré");
  return "ok";
};

TPMS.liaisonDeconnexion = function (b, maintenantMs) {
  if (!b.liaison.connecte) return;
  b.liaison.connecte = false;
  b.ecranUrgent = true;
  TPMS.boitierJournal(b, maintenantMs, "App déconnectée");
};

// Oublier le téléphone : il devra refaire l'appairage.
TPMS.liaisonOublier = function (b, maintenantMs) {
  b.liaison.appaire = false;
  TPMS.liaisonDeconnexion(b, maintenantMs);
};

// Notification MESURES (toutes les 5 s quand l'app est connectée).
TPMS.liaisonMesures = function (b, maintenantMs) {
  if (!b.liaison.connecte) return null;
  var vue = TPMS.boitierVue(b, maintenantMs);
  var mesures = {
    AV: vue.roues.AV,
    AR: vue.roues.AR,
    vitesseKmh: vue.vitesseKmh,
    distanceKm: vue.distanceKm,
    batterieBoitierPct: vue.batterieBoitierPct,
    veille: vue.veille,
    enCharge: vue.enCharge,
    eclairage: vue.eclairage,
    sequence: b.liaison.sequence
  };
  b.liaison.sequence = (b.liaison.sequence + 1) & 0xFFFF;
  return TPMS.encoderMesures(mesures);
};

// Lecture des réglages : réservée à un téléphone appairé.
TPMS.liaisonLireReglages = function (b) {
  if (!b.liaison.connecte || !b.liaison.appaire) return null;
  return TPMS.encoderReglages(b.reglages);
};

// Écriture des réglages. Retourne "ok", "refuse" ou la raison du rejet.
TPMS.liaisonEcrireReglages = function (b, octets, maintenantMs) {
  if (!b.liaison.connecte || !b.liaison.appaire) return "refuse";
  var r = TPMS.decoderReglages(octets);
  if (r === null) return "format invalide";
  var probleme = TPMS.verifierReglages(r);
  if (probleme !== "") {
    TPMS.boitierJournal(b, maintenantMs, "Réglages refusés : " + probleme);
    return probleme;
  }
  // Si on change de capteur, on oublie tout ce qu'on savait de l'ancien.
  ["AV", "AR"].forEach(function (pos) {
    if (r.appairage[pos] !== b.reglages.appairage[pos]) b.roues[pos] = TPMS.creerRoue();
  });
  b.reglages.circonferenceMm = r.circonferenceMm;
  b.compteur.circonferenceMm = r.circonferenceMm;
  b.reglages.seuils.AV = r.seuils.AV;
  b.reglages.seuils.AR = r.seuils.AR;
  b.reglages.delaiVeilleMs = r.delaiVeilleMs;
  b.reglages.protections = r.protections;
  b.reglages.appairage = r.appairage;
  b.ecranUrgent = true;
  TPMS.boitierJournal(b, maintenantMs, "Réglages reçus de l'app");
  return "ok";
};

TPMS.liaisonCommande = function (b, octet, maintenantMs) {
  if (!b.liaison.connecte || !b.liaison.appaire) return "refuse";
  if (octet === TPMS.COMMANDE.RAZ_TRAJET) {
    TPMS.boitierBouton(b, 1, true, maintenantMs);
    return "ok";
  }
  if (octet === TPMS.COMMANDE.ACQUITTER) {
    TPMS.boitierBouton(b, 2, true, maintenantMs);
    return "ok";
  }
  return "commande inconnue";
};
