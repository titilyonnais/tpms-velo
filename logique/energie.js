// =====================================================================
// energie.js — Bilan énergétique du boîtier et des capteurs
// ---------------------------------------------------------------------
// LOGIQUE PURE : sert au simulateur (module 5) et au bilan énergétique
// du dossier. Pas de mesureur de courant (PPK2) au lycée : ces valeurs
// viennent des fiches techniques et devront être vérifiées, par exemple
// à l'oscilloscope avec une résistance de mesure de 10 Ω en série.
//
// Unités : courant en mA, charge en mAh (1 mAh = 3,6 C).
// Pour les événements brefs (rafraîchir l'écran, biper), on raisonne en
// charge par événement, en mA·s : courant (mA) × durée (s).
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.CONSO = {
  // Consommations continues (mA)
  veilleMa: 0.005,          // nRF52840 en System OFF, réveil par le reed (~5 µA, Seeed)
  reposMa: 0.02,            // éveillé mais radio coupée, entre deux fenêtres d'écoute
  radioEcouteMa: 5.0,       // réception BLE (≈ 4,6 mA avec le convertisseur DC/DC) + processeur
  liaisonAppMa: 0.25,       // téléphone connecté, intervalle de connexion de 100 ms
  ledsEclairageMa: 10,      // 2 LED blanches × 5 mA
  ledAlerteMa: 2.5,         // LED rouge 5 mA, clignotante (50 %)
  reedColleMa: 0.25,        // aimant arrêté pile devant le reed : 3,3 V dans le pull-up de 13 kΩ

  // Charges par événement (mA·s)
  ecranPartielMas: 1.5,     // rafraîchissement partiel : ≈ 3 mA pendant 0,5 s
  ecranCompletMas: 6,       // rafraîchissement complet : ≈ 3 mA pendant 2 s
  bipMas: 9                 // buzzer : 25 mA pendant 3 × 0,12 s
};

TPMS.LIPO_MAH = 500;
TPMS.LIPO_UTILE = 0.9;      // on ne vide pas une LiPo à 100 %
TPMS.CR1632_MAH = 130;

// Capteur TPMS (pile CR1632) : valeurs typiques d'un émetteur BLE.
TPMS.CONSO_CAPTEUR = {
  sommeilMa: 0.002,         // 2 µA entre deux annonces
  annonceMas: 0.025         // ≈ 25 µC par annonce (3 canaux + mesure de pression)
};

// Courant consommé à un instant donné par le boîtier, hors événements brefs.
// etat = { veille, radio, appConnectee, eclairage, ledAlerte, reedColle }
TPMS.consoInstantaneeMa = function (etat) {
  var c = TPMS.CONSO;
  var total = etat.veille ? c.veilleMa : c.reposMa;
  if (etat.radio) total += c.radioEcouteMa;
  if (etat.appConnectee) total += c.liaisonAppMa;
  if (etat.eclairage) total += c.ledsEclairageMa;
  if (etat.ledAlerte === "clignote") total += c.ledAlerteMa;
  if (etat.ledAlerte === "fixe") total += c.ledAlerteMa * 2;
  if (etat.reedColle) total += c.reedColleMa;
  return total;
};

// Bilan d'une journée type.
// profil = {
//   heuresRoulage, sortiesParJour, heuresEclairage, heuresApp, alertesParJour,
//   fenetreMs, periodeMs,            // écoute radio
//   periodeEcranMs,                  // un rafraîchissement toutes les N ms en roulant
//   delaiVeilleMs
// }
// Retourne { postes: [{ nom, mAhJour }], totalMAhJour, autonomieJours }
TPMS.bilanJournee = function (p) {
  var c = TPMS.CONSO;
  // Le boîtier reste éveillé pendant le roulage, puis jusqu'à la veille
  // après chaque sortie.
  var heuresEveil = Math.min(24, p.heuresRoulage + p.sortiesParJour * p.delaiVeilleMs / 3600000);
  var rapportEcoute = p.fenetreMs / p.periodeMs;
  var rafraichissements = p.heuresRoulage * 3600000 / p.periodeEcranMs;
  var partielsParComplet = TPMS.PARTIELS_AVANT_COMPLET || 20;   // défini dans boitier.js

  var postes = [
    { nom: "Veille", mAhJour: (24 - heuresEveil) * c.veilleMa },
    { nom: "Processeur éveillé", mAhJour: heuresEveil * c.reposMa },
    { nom: "Écoute radio des capteurs", mAhJour: heuresEveil * rapportEcoute * c.radioEcouteMa },
    { nom: "Écran e-paper", mAhJour: rafraichissements *
        (c.ecranPartielMas + c.ecranCompletMas / partielsParComplet) / 3600 },
    { nom: "Éclairage LED", mAhJour: p.heuresEclairage * c.ledsEclairageMa },
    { nom: "Liaison avec l'app", mAhJour: p.heuresApp * c.liaisonAppMa },
    { nom: "Alertes (bip + LED)", mAhJour: p.alertesParJour * (c.bipMas + 60 * c.ledAlerteMa) / 3600 }
  ];
  var total = 0;
  for (var i = 0; i < postes.length; i++) total += postes[i].mAhJour;
  return {
    postes: postes,
    totalMAhJour: total,
    autonomieJours: TPMS.LIPO_MAH * TPMS.LIPO_UTILE / total
  };
};

// Durée de vie de la pile d'un capteur, selon son intervalle d'annonce.
TPMS.dureeViePileCapteurJours = function (intervalleMs) {
  var k = TPMS.CONSO_CAPTEUR;
  var courantMoyenMa = k.sommeilMa + k.annonceMas / (intervalleMs / 1000);
  return TPMS.CR1632_MAH / courantMoyenMa / 24;
};
