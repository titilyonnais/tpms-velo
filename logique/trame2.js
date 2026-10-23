// =====================================================================
// trame2.js — Trame d'un capteur « version 2 » : privée et signée
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++.
//
// Les capteurs du commerce (trame.js) émettent en clair, toujours avec la
// même adresse et sans signature. Conséquences, montrées par le simulateur :
//   - n'importe quel récepteur posé dans la rue reconnaît le vélo à chaque
//     passage (PISTAGE, atteinte à la vie privée) ;
//   - un pirate peut fabriquer ou rejouer des trames (USURPATION, REJEU).
// Avec ces capteurs-là, on ne peut que limiter les dégâts (liste blanche,
// vraisemblance, rythme). La vraie correction demande un capteur dont on
// écrit le programme : c'est la PROPOSITION pour une version 2 du produit,
// simulée ici.
//
// Chaque capteur v2 partage avec le boîtier une clé secrète de 16 octets
// (donnée à l'appairage, par exemple par un QR code dans la boîte).
//
// 1. ADRESSE PRIVÉE, qui change toutes les 15 min (même idée que les
//    « adresses privées résolubles » de la norme Bluetooth) :
//       adresse = alea (2 octets) ‖ HMAC(clé, 01 ‖ alea) tronqué à 3 octets
//    Un espion voit une adresse nouvelle tous les quarts d'heure et ne
//    peut pas relier les morceaux. Le boîtier, qui a la clé, recalcule
//    le HMAC et reconnaît son capteur.
//
// 2. SIGNATURE et COMPTEUR (contre l'usurpation et le rejeu) :
//       compteur (4 octets) : +1 à chaque trame, jamais deux fois le même
//       signature (4 octets) = HMAC(clé, 02 ‖ octets 0 à 21) tronqué
//    Sans la clé, impossible de signer une fausse pression (1 chance sur
//    4 milliards par essai). Une trame rejouée a un compteur déjà vu.
//
// Format (26 octets, tient dans une annonce BLE de 31 octets) :
//   0-17  comme la trame v1, mais octet 2 = 0xC0 + numéro − 1 (bit « v2 »)
//         et octets 3-7 = adresse privée
//   18-21 compteur, little-endian
//   22-25 signature
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.TAILLE_TRAME_V2 = 26;
TPMS.ROTATION_ADRESSE_MS = 15 * 60000;   // nouvelle adresse tous les quarts d'heure

// Adresse privée (5 octets) à partir de la clé et de 2 octets au hasard.
TPMS.adressePrivee = function (cle, alea0, alea1) {
  var h = TPMS.hmacSha256(cle, [0x01, alea0, alea1]);
  return [alea0, alea1, h[0], h[1], h[2]];
};

// Le boîtier reconnaît-il cette adresse comme celle du capteur à cette clé ?
TPMS.adresseResolue = function (cle, adresse) {
  var attendue = TPMS.adressePrivee(cle, adresse[0], adresse[1]);
  return attendue[2] === adresse[2] && attendue[3] === adresse[3] && attendue[4] === adresse[4];
};

// Signature des 22 premiers octets.
TPMS.signatureTrame = function (cle, o) {
  var message = [0x02];
  for (var i = 0; i < 22; i++) message.push(o[i]);
  var h = TPMS.hmacSha256(cle, message);
  return [h[0], h[1], h[2], h[3]];
};

// mesure = { numero, pressionBar, temperatureC, batteriePct, alarme }
// adresse : 5 octets (adressePrivee) ; compteur : entier ≥ 0.
TPMS.encoderTrameV2 = function (mesure, cle, adresse, compteur) {
  var v1 = TPMS.encoderTrame({
    numero: mesure.numero, adresse: adresse, pressionBar: mesure.pressionBar,
    temperatureC: mesure.temperatureC, batteriePct: mesure.batteriePct, alarme: mesure.alarme
  });
  var o = new Uint8Array(TPMS.TAILLE_TRAME_V2);
  for (var i = 0; i < TPMS.TAILLE_TRAME; i++) o[i] = v1[i];
  o[2] = 0xC0 + (mesure.numero - 1);
  TPMS.ecrireInt32LE(o, 18, compteur);
  var s = TPMS.signatureTrame(cle, o);
  for (var k = 0; k < 4; k++) o[22 + k] = s[k];
  return o;
};

// Décodage du format seul (sans vérifier la signature).
// Retourne null si ce n'est pas une trame v2.
TPMS.decoderTrameV2 = function (o) {
  if (!o || o.length !== TPMS.TAILLE_TRAME_V2) return null;
  if (o[0] !== TPMS.ID_FABRICANT[0] || o[1] !== TPMS.ID_FABRICANT[1]) return null;
  if (o[2] < 0xC0) return null;
  return {
    numero: o[2] - 0xC0 + 1,
    adresseOctets: [o[3], o[4], o[5], o[6], o[7]],
    adresse: TPMS.adresseEnTexte([o[3], o[4], o[5], o[6], o[7]]),
    pressionBar: TPMS.lireInt32LE(o, 8) / TPMS.PA_PAR_BAR,
    temperatureC: TPMS.lireInt32LE(o, 12) / 100,
    batteriePct: o[16],
    alarme: o[17],
    compteur: TPMS.lireInt32LE(o, 18) >>> 0
  };
};

TPMS.signatureValide = function (cle, o) {
  var s = TPMS.signatureTrame(cle, o);
  return s[0] === o[22] && s[1] === o[23] && s[2] === o[24] && s[3] === o[25];
};
