// =====================================================================
// trame.js — Codage et décodage des trames BLE des capteurs TPMS
// ---------------------------------------------------------------------
// LOGIQUE PURE : ce fichier ne touche ni à la page web ni à l'horloge.
// Il sera traduit tel quel en C++ dans le firmware du boîtier.
//
// Format SUPPOSÉ (18 octets de "manufacturer data"), d'après
// github.com/schlumpf2009/TPMS — à confirmer à la réception des capteurs :
//
//   octets 0-1   identifiant fabricant
//   octet  2     numéro du capteur (0x80 = capteur 1, 0x81 = capteur 2...)
//   octets 3-4   préfixe d'adresse
//   octets 5-7   adresse du capteur
//   octets 8-11  pression en Pa (pascals), little-endian
//   octets 12-15 température en centièmes de °C, little-endian, signée
//   octet  16    niveau de pile en %
//   octet  17    alarme (0x00 = OK, 0x01 = pas de pression)
//
// "Little-endian" = l'octet de poids faible est écrit en premier.
// Exemple : 210000 Pa = 0x00033450 s'écrit 50 34 03 00.
// =====================================================================

// Toutes nos fonctions sont rangées dans un seul objet global "TPMS".
// On n'utilise pas les modules ES pour que la page s'ouvre par
// double-clic, sans serveur web.
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.TAILLE_TRAME = 18;
TPMS.ID_FABRICANT = [0x00, 0x01];   // valeur supposée, à vérifier
TPMS.PA_PAR_BAR = 100000;           // 1 bar = 100 000 Pa

// Lit un entier 32 bits signé, little-endian, à partir de l'octet i.
// En C : (int32_t)(o[i] | o[i+1]<<8 | o[i+2]<<16 | o[i+3]<<24)
TPMS.lireInt32LE = function (o, i) {
  return o[i] | (o[i + 1] << 8) | (o[i + 2] << 16) | (o[i + 3] << 24);
};

// Écrit un entier 32 bits, little-endian, à partir de l'octet i.
TPMS.ecrireInt32LE = function (o, i, valeur) {
  o[i]     = valeur & 0xFF;
  o[i + 1] = (valeur >> 8) & 0xFF;
  o[i + 2] = (valeur >> 16) & 0xFF;
  o[i + 3] = (valeur >> 24) & 0xFF;
};

// Transforme 5 octets d'adresse en texte "EA:CA:3F:1B:07".
TPMS.adresseEnTexte = function (octets) {
  var morceaux = [];
  for (var i = 0; i < octets.length; i++) {
    morceaux.push(TPMS.octetEnHexa(octets[i]));
  }
  return morceaux.join(":");
};

TPMS.octetEnHexa = function (octet) {
  return (octet < 16 ? "0" : "") + octet.toString(16).toUpperCase();
};

// Affiche une trame complète en hexadécimal : "00 01 80 EA ...".
TPMS.trameEnHexa = function (octets) {
  var morceaux = [];
  for (var i = 0; i < octets.length; i++) {
    morceaux.push(TPMS.octetEnHexa(octets[i]));
  }
  return morceaux.join(" ");
};

// ---------------------------------------------------------------------
// CODAGE : ce que fait le capteur (utilisé seulement par le simulateur).
// mesure = { numero, adresse: [5 octets], pressionBar, temperatureC,
//            batteriePct, alarme }
// Retourne un tableau de 18 octets.
// ---------------------------------------------------------------------
TPMS.encoderTrame = function (mesure) {
  var o = new Uint8Array(TPMS.TAILLE_TRAME);

  o[0] = TPMS.ID_FABRICANT[0];
  o[1] = TPMS.ID_FABRICANT[1];
  o[2] = 0x80 + (mesure.numero - 1);
  for (var i = 0; i < 5; i++) {
    o[3 + i] = mesure.adresse[i];
  }

  var pressionPa = Math.round(Math.max(0, mesure.pressionBar) * TPMS.PA_PAR_BAR);
  TPMS.ecrireInt32LE(o, 8, pressionPa);

  var temperatureCentiemes = Math.round(mesure.temperatureC * 100);
  TPMS.ecrireInt32LE(o, 12, temperatureCentiemes);

  o[16] = Math.max(0, Math.min(100, Math.round(mesure.batteriePct)));
  o[17] = mesure.alarme ? 0x01 : 0x00;
  return o;
};

// ---------------------------------------------------------------------
// DÉCODAGE : ce que fait le boîtier à chaque annonce BLE reçue.
// Retourne null si la trame n'a pas le bon format.
// ---------------------------------------------------------------------
TPMS.decoderTrame = function (o) {
  if (!o || o.length !== TPMS.TAILLE_TRAME) return null;
  if (o[0] !== TPMS.ID_FABRICANT[0] || o[1] !== TPMS.ID_FABRICANT[1]) return null;
  if (o[2] < 0x80) return null;

  return {
    numero: o[2] - 0x80 + 1,
    adresse: TPMS.adresseEnTexte([o[3], o[4], o[5], o[6], o[7]]),
    pressionBar: TPMS.lireInt32LE(o, 8) / TPMS.PA_PAR_BAR,
    temperatureC: TPMS.lireInt32LE(o, 12) / 100,
    batteriePct: o[16],
    alarme: o[17]
  };
};
