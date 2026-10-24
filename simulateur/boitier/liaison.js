// =====================================================================
// liaison.js — Côté boîtier de la liaison avec l'application
// ---------------------------------------------------------------------
// Dans le firmware, c'est la pile BLE (Bluefruit) qui gère l'appairage
// et le chiffrement. Notre code se contente de :
//   - afficher sur l'écran le code à 6 chiffres que la pile lui donne ;
//   - refuser les réglages tant que le lien n'est pas appairé et chiffré ;
//   - vérifier que les réglages reçus ont du sens ;
//   - garder en attente un changement SENSIBLE (protection coupée,
//     capteur remplacé) jusqu'à un appui long sur le bouton 2.
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
TPMS.CONFIRMATION_DUREE_MS = 30000;   // 30 s pour confirmer un changement sensible

TPMS.creerLiaison = function () {
  return {
    connecte: false,
    appaire: false,        // téléphone déjà appairé (clé mémorisée)
    code: null,            // code affiché pendant l'appairage
    codeJusquaMs: 0,
    essais: 0,
    bloqueJusquaMs: 0,
    sequence: 0,           // numéro de la prochaine notification MESURES
    enAttente: null,       // réglages sensibles reçus, en attente de l'appui sur le bouton
    masqueAttente: 0,      // ce qu'ils changent (TPMS.SENSIBLE)
    attenteJusquaMs: 0
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
  // Le téléphone qui a demandé le changement est parti : on l'oublie.
  TPMS.liaisonAnnulerAttente(b, maintenantMs, "téléphone déconnecté");
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
    attenteConfirmation: b.liaison.enAttente !== null,
    chargeCoupee: vue.blocageCharge !== "",
    correctionBar: vue.correctionBar,
    sequence: b.liaison.sequence
  };
  b.liaison.sequence = (b.liaison.sequence + 1) & 0xFF;
  return TPMS.encoderMesures(mesures);
};

// Lecture des réglages : réservée à un téléphone appairé.
TPMS.liaisonLireReglages = function (b) {
  if (!b.liaison.connecte || !b.liaison.appaire) return null;
  return TPMS.encoderReglages(b.reglages);
};

// Écriture des réglages. Retourne "ok", "attente-bouton" (changement
// sensible : il faut un appui long sur le bouton 2 du boîtier), "refuse"
// ou la raison du rejet.
TPMS.liaisonEcrireReglages = function (b, octets, maintenantMs) {
  var l = b.liaison;
  if (!l.connecte || !l.appaire) return "refuse";
  var r = TPMS.decoderReglages(octets);
  if (r === null) return "format invalide";
  var probleme = TPMS.verifierReglages(r);
  if (probleme !== "") {
    TPMS.boitierJournal(b, maintenantMs, "Réglages refusés : " + probleme);
    return probleme;
  }
  // Une nouvelle demande remplace celle qui attendait encore.
  TPMS.liaisonAnnulerAttente(b, maintenantMs, "remplacé par une nouvelle demande");
  var masque = TPMS.changementSensible(b.reglages, r);
  if (masque !== 0) {
    l.enAttente = r;
    l.masqueAttente = masque;
    l.attenteJusquaMs = maintenantMs + TPMS.CONFIRMATION_DUREE_MS;
    b.ecranUrgent = true;
    // Une ligne de journal par raison.
    TPMS.lignesSensibles(masque).forEach(function (ligne) {
      TPMS.boitierJournal(b, maintenantMs, "App demande : " + ligne + " (à confirmer)");
    });
    return "attente-bouton";
  }
  TPMS.liaisonAppliquerReglages(b, r, maintenantMs);
  TPMS.boitierJournal(b, maintenantMs, "Réglages reçus de l'app");
  return "ok";
};

// Appui long sur le bouton 2 pendant l'attente : on applique.
// Appelée seulement par boitierBouton (un VRAI appui), jamais par l'app.
TPMS.liaisonConfirmer = function (b, maintenantMs) {
  var l = b.liaison;
  if (l.enAttente === null) return false;
  var r = l.enAttente;
  l.enAttente = null;
  l.masqueAttente = 0;
  TPMS.liaisonAppliquerReglages(b, r, maintenantMs);
  TPMS.boitierJournal(b, maintenantMs, "Changement sensible confirmé sur le boîtier");
  return true;
};

// Abandon d'un changement sensible : autre bouton, délai dépassé,
// déconnexion, veille ou nouvelle demande. Les réglages ne changent pas.
TPMS.liaisonAnnulerAttente = function (b, maintenantMs, raison) {
  var l = b.liaison;
  if (l.enAttente === null) return;
  l.enAttente = null;
  l.masqueAttente = 0;
  b.ecranUrgent = true;
  TPMS.boitierJournal(b, maintenantMs, "Changement sensible annulé (" + raison + ")");
};

// Recopie des réglages déjà vérifiés dans ceux du boîtier.
TPMS.liaisonAppliquerReglages = function (b, r, maintenantMs) {
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
};

// Les commandes de l'app passent par boitierAction et NON par
// boitierBouton : la commande ACQUITTER (= appui long sur le bouton 2)
// ne doit jamais pouvoir confirmer un changement sensible à la place
// du cycliste.
TPMS.liaisonCommande = function (b, octet, maintenantMs) {
  if (!b.liaison.connecte || !b.liaison.appaire) return "refuse";
  if (octet === TPMS.COMMANDE.RAZ_TRAJET) {
    TPMS.boitierAction(b, 1, true, maintenantMs);
    return "ok";
  }
  if (octet === TPMS.COMMANDE.ACQUITTER) {
    TPMS.boitierAction(b, 2, true, maintenantMs);
    return "ok";
  }
  return "commande inconnue";
};

// ---------------------------------------------------------------------
// Démonstration : attaque de l'homme du milieu pendant l'appairage
// ---------------------------------------------------------------------
// Le pirate s'intercale : il se fait passer pour le boîtier auprès du
// téléphone, et pour le téléphone auprès du boîtier. Tout dépend alors de
// la méthode d'appairage :
//   "sans-code" (Just Works) : aucune vérification humaine, les deux
//       appairages réussissent ; le pirate lit tout et écrit ses réglages.
//   "code" (notre choix, BLE Secure Connections avec code affiché) : le
//       code n'apparaît que sur l'écran du boîtier. Le pirate ne le voit
//       pas et doit le deviner : 1 chance sur 1 000 000 par essai, et le
//       boîtier se bloque 1 min après 3 codes faux.
// tirerCode() : code à 6 chiffres essayé par le pirate.
// Retourne { reussie, etapes: [textes] }.
TPMS.liaisonAttaqueHommeDuMilieu = function (b, mode, maintenantMs, tirerCode) {
  var etapes = ["Le pirate se place entre le téléphone et le boîtier et relaie leurs messages."];
  if (mode === "sans-code") {
    etapes.push("Appairage sans code : rien ne permet de voir l'intrus. Les deux appairages réussissent.");
    b.liaison.appaire = true;
    b.reglages.seuils.AV.basBar = 0.5;
    b.reglages.seuils.AR.basBar = 0.5;
    TPMS.boitierJournal(b, maintenantMs, "Réglages reçus d'un appareil appairé : seuils bas à 0,5 bar");
    etapes.push("Le pirate écrit ses réglages : seuils bas à 0,5 bar. Le boîtier les accepte, le lien est « appairé ».");
    etapes.push("Résultat : une pression basse ne déclenche plus d'alerte. Le cycliste ne voit rien.");
    return { reussie: true, etapes: etapes };
  }
  var l = b.liaison;
  if (maintenantMs < l.bloqueJusquaMs) {
    etapes.push("Le boîtier refuse : appairage bloqué après trop d'essais.");
    return { reussie: false, etapes: etapes };
  }
  // Nouvelle demande d'appairage : le boîtier affiche un code (sans
  // remplacer un code encore valide).
  if (l.code === null || maintenantMs > l.codeJusquaMs) {
    l.code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    l.codeJusquaMs = maintenantMs + TPMS.CODE_DUREE_MS;
    b.ecranUrgent = true;
  }
  etapes.push("Le boîtier affiche un code sur son écran. Le pirate, à quelques mètres, ne peut pas le lire.");
  for (var i = 0; i < TPMS.CODE_ESSAIS_MAX; i++) {
    var essai = tirerCode();
    var r = TPMS.liaisonSaisirCode(b, essai, maintenantMs);
    etapes.push("Essai " + (i + 1) + " : " + essai + " → " + (r === "ok" ? "accepté" : (r === "bloque" ? "faux, appairage bloqué 1 min" : "faux")));
    if (r === "ok") return { reussie: true, etapes: etapes };
    if (r !== "faux") break;
  }
  etapes.push("Échec : 3 chances sur 1 000 000 par minute de blocage, soit environ 5 mois d'essais sans interruption pour avoir une chance sur deux.");
  return { reussie: false, etapes: etapes };
};
