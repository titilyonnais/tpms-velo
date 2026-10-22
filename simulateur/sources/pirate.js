// =====================================================================
// pirate.js — Un attaquant avec un émetteur BLE
// ---------------------------------------------------------------------
// SOURCE DE DONNÉES simulée, pour la démonstration de cybersécurité.
// Matériel réaliste pour l'attaquant : une carte ESP32 ou nRF52 à
// quelques euros, posée à moins de 10 m du vélo.
//
// Deux attaques possibles :
//
//   USURPATION : le pirate a écouté l'air et connaît l'adresse et le
//                numéro du capteur visé. Il fabrique des trames avec
//                cette identité et la pression de son choix.
//                Exemple : annoncer 0,3 bar pour faire croire à une
//                crevaison et pousser le cycliste à s'arrêter.
//
//   REJEU      : le pirate a enregistré de vraies trames du capteur
//                (par exemple la veille, pneu bien gonflé) et les
//                renvoie telles quelles, octet pour octet. Exemple :
//                masquer une crevaison en cours.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.PIRATE_TAILLE_ENREGISTREMENT = 20;

TPMS.creerPirate = function () {
  return {
    actif: false,
    cible: "AV",                  // roue visée
    attaque: "usurpation",        // "usurpation" ou "rejeu"
    pressionFausseBar: 0.3,       // pour l'usurpation
    intervalleMs: 1000,           // le pirate émet plus souvent que le vrai capteur
    prochaineEmissionMs: 0,
    enregistre: false,            // en train d'enregistrer ?
    enregistrement: [],           // trames capturées (pour le rejeu)
    indexRejeu: 0
  };
};

// Le pirate écoute en permanence (il n'a pas de souci de batterie).
// S'il enregistre, il garde les trames de la roue visée.
TPMS.pirateEcouter = function (p, source, octets) {
  if (!p.enregistre || source !== p.cible) return;
  p.enregistrement.push(octets.slice());
  if (p.enregistrement.length >= TPMS.PIRATE_TAILLE_ENREGISTREMENT) {
    p.enregistre = false;   // enregistrement complet
  }
};

// Fabrique la prochaine trame du pirate (ou null s'il n'a rien à envoyer).
// capteurVise : le vrai capteur, dont il a appris l'identité en écoutant.
TPMS.pirateTrame = function (p, capteurVise) {
  if (p.attaque === "rejeu") {
    if (p.enregistrement.length === 0) return null;
    var trame = p.enregistrement[p.indexRejeu % p.enregistrement.length];
    p.indexRejeu++;
    return trame;
  }
  // Usurpation : bonne identité, fausse pression. Il recopie la
  // température et la pile entendues, pour avoir l'air crédible.
  return TPMS.encoderTrame({
    numero: capteurVise.numero,
    adresse: capteurVise.adresse,
    pressionBar: p.pressionFausseBar,
    temperatureC: capteurVise.temperatureC,
    batteriePct: capteurVise.batteriePct,
    alarme: p.pressionFausseBar < 0.05 ? 0x01 : 0x00
  });
};
