// =====================================================================
// protocole.js — Liaison BLE entre le boîtier et l'application
// ---------------------------------------------------------------------
// LOGIQUE PURE, partagée par le firmware (serveur GATT), l'application
// (client Web Bluetooth) et le simulateur.
//
// Le boîtier expose UN service BLE avec trois « caractéristiques »
// (des cases mémoire que le téléphone peut lire, écrire ou écouter) :
//
//   MESURES   (lecture + notification) : 20 octets envoyés toutes les 5 s
//   REGLAGES  (lecture + écriture)     : 23 octets, CHIFFRÉ et APPAIRÉ
//   COMMANDE  (écriture)               : 1 octet,   CHIFFRÉ et APPAIRÉ
//
// Contrairement aux capteurs TPMS, cette liaison est maîtrisée : elle
// utilise BLE Secure Connections (appairage par code à 6 chiffres affiché
// sur l'écran du boîtier). Une fois appairé, tout est chiffré en AES-CCM ;
// le compteur de paquets de la couche liaison empêche le rejeu.
//
// Tous les nombres sont en little-endian, comme dans les trames TPMS.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// UUID 128 bits tirés au hasard pour ce projet.
TPMS.UUID = {
  SERVICE:  "6e7a0001-5a1e-4b8f-9c3d-2f1e0a9b8c7d",
  MESURES:  "6e7a0002-5a1e-4b8f-9c3d-2f1e0a9b8c7d",
  REGLAGES: "6e7a0003-5a1e-4b8f-9c3d-2f1e0a9b8c7d",
  COMMANDE: "6e7a0004-5a1e-4b8f-9c3d-2f1e0a9b8c7d"
};

TPMS.TAILLE_MESURES = 20;
TPMS.TAILLE_REGLAGES = 23;

TPMS.COMMANDE = {
  RAZ_TRAJET: 0x01,
  ACQUITTER:  0x02
};

// Les états de roue voyagent sous forme d'un numéro (1 octet).
TPMS.CODES_ETAT = ["ATTENTE", "INTRUSION", "PERDU", "CREVAISON", "BASSE", "HAUTE", "FUITE", "OK"];

TPMS.PRESSION_INCONNUE = 0xFFFF;

// ---------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------
TPMS.lireUint16LE = function (o, i) {
  return o[i] | (o[i + 1] << 8);
};

TPMS.ecrireUint16LE = function (o, i, valeur) {
  o[i] = valeur & 0xFF;
  o[i + 1] = (valeur >> 8) & 0xFF;
};

// "EA:CA:3F:1B:07" → [0xEA, 0xCA, 0x3F, 0x1B, 0x07]
TPMS.adresseDepuisTexte = function (texte) {
  var morceaux = texte.split(":");
  var octets = [];
  for (var i = 0; i < 5; i++) octets.push(parseInt(morceaux[i], 16) || 0);
  return octets;
};

// Un entier signé sur 1 octet (-128 à 127), pour la température.
function versInt8(valeur) {
  var v = Math.max(-128, Math.min(127, Math.round(valeur)));
  return v & 0xFF;
}
function depuisInt8(octet) {
  return octet > 127 ? octet - 256 : octet;
}

// ---------------------------------------------------------------------
// MESURES (20 octets)
//   0-1   pression AV en mbar (0xFFFF = inconnue)
//   2-3   pression AR en mbar
//   4     température AV en °C (signée)
//   5     température AR en °C
//   6     pile capteur AV en %
//   7     pile capteur AR en %
//   8     état AV (index dans CODES_ETAT)
//   9     état AR
//   10-11 vitesse en 0,1 km/h
//   12-15 distance du trajet en mètres
//   16    batterie du boîtier en %
//   17    drapeaux : bit 0 veille, bit 1 en charge, bit 2 éclairage
//   18-19 numéro de séquence (détecte les notifications perdues)
// ---------------------------------------------------------------------
TPMS.encoderMesures = function (m) {
  var o = new Uint8Array(TPMS.TAILLE_MESURES);
  var roues = [m.AV, m.AR];
  for (var i = 0; i < 2; i++) {
    var r = roues[i];
    var connue = r.pressionBar !== null;
    TPMS.ecrireUint16LE(o, i * 2, connue ? Math.round(r.pressionBar * 1000) : TPMS.PRESSION_INCONNUE);
    o[4 + i] = connue ? versInt8(r.temperatureC) : 0;
    o[6 + i] = connue ? r.batteriePct : 0;
    o[8 + i] = Math.max(0, TPMS.CODES_ETAT.indexOf(r.etat));
  }
  TPMS.ecrireUint16LE(o, 10, Math.round(m.vitesseKmh * 10));
  TPMS.ecrireInt32LE(o, 12, Math.round(m.distanceKm * 1000));
  o[16] = Math.round(m.batterieBoitierPct);
  o[17] = (m.veille ? 1 : 0) | (m.enCharge ? 2 : 0) | (m.eclairage ? 4 : 0);
  TPMS.ecrireUint16LE(o, 18, m.sequence & 0xFFFF);
  return o;
};

TPMS.decoderMesures = function (o) {
  if (!o || o.length !== TPMS.TAILLE_MESURES) return null;
  function roue(i) {
    var mbar = TPMS.lireUint16LE(o, i * 2);
    return {
      pressionBar: mbar === TPMS.PRESSION_INCONNUE ? null : mbar / 1000,
      temperatureC: depuisInt8(o[4 + i]),
      batteriePct: o[6 + i],
      etat: TPMS.CODES_ETAT[o[8 + i]] || "ATTENTE"
    };
  }
  return {
    AV: roue(0),
    AR: roue(1),
    vitesseKmh: TPMS.lireUint16LE(o, 10) / 10,
    distanceKm: (TPMS.lireInt32LE(o, 12) >>> 0) / 1000,
    batterieBoitierPct: o[16],
    veille: (o[17] & 1) !== 0,
    enCharge: (o[17] & 2) !== 0,
    eclairage: (o[17] & 4) !== 0,
    sequence: TPMS.lireUint16LE(o, 18)
  };
};

// ---------------------------------------------------------------------
// REGLAGES (23 octets)
//   0-1   circonférence de roue en mm
//   2-3   seuil bas AV en mbar      4-5  seuil haut AV
//   6-7   seuil bas AR en mbar      8-9  seuil haut AR
//   10-11 délai avant veille en secondes
//   12    protections : bit 0 liste blanche, bit 1 vraisemblance, bit 2 rythme
//   13-17 adresse du capteur AV
//   18-22 adresse du capteur AR
// ---------------------------------------------------------------------
TPMS.encoderReglages = function (r) {
  var o = new Uint8Array(TPMS.TAILLE_REGLAGES);
  TPMS.ecrireUint16LE(o, 0, r.circonferenceMm);
  TPMS.ecrireUint16LE(o, 2, Math.round(r.seuils.AV.basBar * 1000));
  TPMS.ecrireUint16LE(o, 4, Math.round(r.seuils.AV.hautBar * 1000));
  TPMS.ecrireUint16LE(o, 6, Math.round(r.seuils.AR.basBar * 1000));
  TPMS.ecrireUint16LE(o, 8, Math.round(r.seuils.AR.hautBar * 1000));
  TPMS.ecrireUint16LE(o, 10, Math.round(r.delaiVeilleMs / 1000));
  o[12] = (r.protections.listeBlanche ? 1 : 0) |
          (r.protections.vraisemblance ? 2 : 0) |
          (r.protections.rythme ? 4 : 0);
  var av = TPMS.adresseDepuisTexte(r.appairage.AV);
  var ar = TPMS.adresseDepuisTexte(r.appairage.AR);
  for (var i = 0; i < 5; i++) {
    o[13 + i] = av[i];
    o[18 + i] = ar[i];
  }
  return o;
};

TPMS.decoderReglages = function (o) {
  if (!o || o.length !== TPMS.TAILLE_REGLAGES) return null;
  return {
    circonferenceMm: TPMS.lireUint16LE(o, 0),
    seuils: {
      AV: { basBar: TPMS.lireUint16LE(o, 2) / 1000, hautBar: TPMS.lireUint16LE(o, 4) / 1000 },
      AR: { basBar: TPMS.lireUint16LE(o, 6) / 1000, hautBar: TPMS.lireUint16LE(o, 8) / 1000 }
    },
    delaiVeilleMs: TPMS.lireUint16LE(o, 10) * 1000,
    protections: {
      listeBlanche: (o[12] & 1) !== 0,
      vraisemblance: (o[12] & 2) !== 0,
      rythme: (o[12] & 4) !== 0
    },
    appairage: {
      AV: TPMS.adresseEnTexte([o[13], o[14], o[15], o[16], o[17]]),
      AR: TPMS.adresseEnTexte([o[18], o[19], o[20], o[21], o[22]])
    }
  };
};

// Le boîtier ne fait pas confiance aveuglément à ce qu'on lui écrit,
// même chiffré : il vérifie que les réglages ont du sens.
// Retourne "" si tout va bien, sinon la raison du refus.
TPMS.verifierReglages = function (r) {
  if (r.circonferenceMm < 1000 || r.circonferenceMm > 3000) return "circonférence hors plage (1000 à 3000 mm)";
  var positions = ["AV", "AR"];
  for (var i = 0; i < 2; i++) {
    var s = r.seuils[positions[i]];
    if (s.basBar < 0.5 || s.hautBar > 6) return "seuils hors plage (0,5 à 6 bar)";
    if (s.basBar >= s.hautBar) return "seuil bas supérieur au seuil haut";
  }
  if (r.delaiVeilleMs < 10000 || r.delaiVeilleMs > 3600000) return "délai de veille hors plage (10 s à 1 h)";
  return "";
};
