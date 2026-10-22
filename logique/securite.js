// =====================================================================
// securite.js — Protections contre les faux capteurs
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++ dans le firmware.
//
// Les capteurs TPMS du commerce diffusent leurs mesures EN CLAIR, sans
// signature ni compteur. N'importe qui peut écouter les trames, et un
// émetteur BLE à 5 € peut en fabriquer de fausses. Le boîtier ne peut
// donc pas « prouver » qu'une trame vient du vrai capteur : il ne peut
// que trier ce qu'il reçoit. On empile trois protections (défense en
// profondeur), chacune activable séparément pour la démonstration :
//
//   1. LISTE BLANCHE   : seuls les 2 capteurs appairés sont écoutés.
//   2. VRAISEMBLANCE   : une pression ne peut pas changer n'importe
//                        comment ; un changement brutal doit être confirmé.
//   3. RYTHME          : un capteur émet toutes les ~3 s. Des trames plus
//                        rapprochées avec la même adresse veulent dire
//                        que DEUX émetteurs l'utilisent : usurpation ou
//                        rejeu. Le boîtier passe alors en « signal suspect ».
//
// Un vrai anti-rejeu (compteur + signature) est impossible avec ces
// capteurs : leurs trames n'ont ni l'un ni l'autre. Il est appliqué sur
// la liaison boîtier ↔ application, que l'on maîtrise.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.protectionsParDefaut = function () {
  return { listeBlanche: true, vraisemblance: true, rythme: true };
};

// ---------------------------------------------------------------------
// 1. Liste blanche
// ---------------------------------------------------------------------

// appairage = { AV: "EA:CA:3F:1B:07", AR: "EA:CA:3F:1B:08" }
// Retourne "AV", "AR", ou null si le capteur n'est pas dans la liste.
TPMS.positionCapteur = function (appairage, adresse) {
  if (appairage.AV === adresse) return "AV";
  if (appairage.AR === adresse) return "AR";
  return null;
};

// SANS liste blanche, le boîtier n'a que le numéro du capteur pour
// savoir de quelle roue il s'agit. Le capteur n°1 d'un autre vélo
// passerait alors pour notre roue avant.
TPMS.positionParNumero = function (numero) {
  if (numero === 1) return "AV";
  if (numero === 2) return "AR";
  return null;
};

// ---------------------------------------------------------------------
// 2. Vraisemblance
// ---------------------------------------------------------------------

// Limites physiques du capteur (fiche technique supposée).
TPMS.PRESSION_MAX_BAR = 8;
TPMS.TEMPERATURE_MIN_C = -40;
TPMS.TEMPERATURE_MAX_C = 85;

// Variation maximale « normale ». Un pneu crevé perd environ 0,15 bar/s,
// une pompe à pied gonfle à environ 0,05 bar/s : 0,3 bar/s laisse de la marge.
TPMS.VARIATION_MAX_BAR_S = 0.3;
TPMS.VARIATION_MAX_C_S = 1;
// Plafond du temps qui sert à juger une variation (voir verifierVraisemblance).
// Compromis mesuré dans le simulateur, écoute par fenêtres :
//   5 s : vraie crevaison signalée en 11 s au pire ; une fausse pression
//         entre 0,8 et 1,5 bar peut s'afficher 6 s avant « SIGNAL SUSPECT ».
//   3 s : la fausse pression ne passe presque plus, mais la vraie
//         crevaison n'est signalée qu'en 32 à 36 s.
// On choisit 5 s : prévenir vite d'une vraie crevaison passe d'abord.
// Dans les deux cas, masquer une crevaison par rejeu échoue (alerte en 7 s).
TPMS.VARIATION_DT_MAX_S = 5;

// Un changement brutal n'est accepté que s'il est confirmé par
// 3 trames de suite qui donnent la même valeur (à 0,1 bar près).
// Pourquoi 3 ? Il faut que la protection « rythme », qui demande
// 3 anomalies, détecte un pirate AVANT que ses fausses valeurs ne soient
// confirmées. Pour un vrai regonflage, cela retarde l'affichage
// d'environ 10 s seulement.
TPMS.CONFIRMATIONS = 3;
TPMS.ECART_CONFIRMATION_BAR = 0.1;

TPMS.creerVerification = function () {
  return { candidatBar: 0, nbConfirmations: 0 };
};

// v         : mémoire de la vérification (une par roue)
// ancienne  : dernière mesure acceptée (ou null)
// ancienneMs: instant de cette mesure
// nouvelle  : mesure qui vient d'arriver
// confirmationPermise : false quand on doute de l'émetteur (le contrôle
//   du rythme a vu des trames trop rapprochées dans la dernière minute).
//   On n'accepte alors que des valeurs à moins de 0,1 bar de la dernière
//   valeur de confiance, et aucune confirmation : sinon un pirate obtient
//   ses 3 trames de confirmation avant que le rythme ait réuni ses
//   3 anomalies.
// Retourne "ok", "hors-limites", "suspecte" ou "confirmee".
TPMS.verifierVraisemblance = function (v, ancienne, ancienneMs, nouvelle, maintenantMs, confirmationPermise) {
  if (nouvelle.pressionBar > TPMS.PRESSION_MAX_BAR ||
      nouvelle.temperatureC < TPMS.TEMPERATURE_MIN_C ||
      nouvelle.temperatureC > TPMS.TEMPERATURE_MAX_C) {
    return "hors-limites";
  }
  if (ancienne === null) return "ok";   // rien à comparer

  // En cas de doute sur l'émetteur, seules les valeurs quasi identiques
  // à la dernière valeur de confiance passent.
  if (confirmationPermise === false &&
      Math.abs(nouvelle.pressionBar - ancienne.pressionBar) > TPMS.ECART_CONFIRMATION_BAR) {
    return "suspecte";
  }

  // On divise l'écart par le temps écoulé, compris entre 1 s et 5 s.
  // Pourquoi un plafond ? Avec l'écoute par fenêtres, la radio reste
  // coupée 3 s sur 5 : sans plafond, le silence « dilue » l'écart, et un
  // pirate qui annonce 0,3 bar juste après ce silence passe pour une
  // baisse lente. Avec le plafond, un grand écart doit toujours être
  // confirmé par 3 trames, ce qui laisse au contrôle du rythme le temps
  // de détecter le second émetteur.
  var dtS = Math.min(TPMS.VARIATION_DT_MAX_S, Math.max(1, (maintenantMs - ancienneMs) / 1000));
  var vitessePression = Math.abs(nouvelle.pressionBar - ancienne.pressionBar) / dtS;
  var vitesseTemperature = Math.abs(nouvelle.temperatureC - ancienne.temperatureC) / dtS;

  if (vitessePression <= TPMS.VARIATION_MAX_BAR_S && vitesseTemperature <= TPMS.VARIATION_MAX_C_S) {
    v.nbConfirmations = 0;
    return "ok";
  }

  // Changement brutal : on attend une confirmation.
  if (v.nbConfirmations > 0 &&
      Math.abs(nouvelle.pressionBar - v.candidatBar) < TPMS.ECART_CONFIRMATION_BAR) {
    v.nbConfirmations++;
  } else {
    v.candidatBar = nouvelle.pressionBar;
    v.nbConfirmations = 1;
  }
  if (v.nbConfirmations >= TPMS.CONFIRMATIONS && confirmationPermise !== false) {
    v.nbConfirmations = 0;
    return "confirmee";
  }
  return "suspecte";
};

// Le contrôle du rythme a-t-il un doute sur cette roue ?
TPMS.rythmeDouteux = function (r) {
  return r.anomaliesMs.length > 0;
};

// ---------------------------------------------------------------------
// 3. Rythme (détection d'un second émetteur : usurpation ou rejeu)
// ---------------------------------------------------------------------

// Le vrai capteur émet toutes les 3 s environ (à mesurer sur les vrais
// capteurs). Deux trames de la même adresse à moins de 2 s d'écart
// sont une anomalie.
// Attention, sur le matériel réel : une même annonce BLE est envoyée
// sur 3 canaux en quelques millisecondes. Il faudra ignorer les copies
// identiques reçues à moins de 100 ms d'écart.
TPMS.RYTHME_MIN_MS = 2000;
TPMS.RYTHME_ANOMALIES_MAX = 3;      // 3 anomalies en 1 min = intrusion
TPMS.RYTHME_FENETRE_MS = 60000;
TPMS.QUARANTAINE_MS = 60000;        // durée du « signal suspect »

TPMS.creerRythme = function () {
  return { dernierMs: -1, anomaliesMs: [] };
};

// À appeler pour CHAQUE trame portant l'adresse d'un capteur appairé.
// Retourne true si une intrusion vient d'être détectée.
TPMS.controlerRythme = function (r, maintenantMs) {
  if (r.dernierMs >= 0 && maintenantMs - r.dernierMs < TPMS.RYTHME_MIN_MS) {
    r.anomaliesMs.push(maintenantMs);
  }
  r.dernierMs = maintenantMs;
  // On oublie les anomalies de plus d'une minute.
  while (r.anomaliesMs.length > 0 && maintenantMs - r.anomaliesMs[0] > TPMS.RYTHME_FENETRE_MS) {
    r.anomaliesMs.shift();
  }
  if (r.anomaliesMs.length >= TPMS.RYTHME_ANOMALIES_MAX) {
    r.anomaliesMs = [];
    return true;
  }
  return false;
};
