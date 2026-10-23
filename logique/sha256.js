// =====================================================================
// sha256.js — Empreinte SHA-256 et signature HMAC-SHA256
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++ (même calcul avec des uint32_t).
//
// Une EMPREINTE (hash) résume n'importe quel message en 32 octets.
// Changer un seul bit du message change complètement l'empreinte, et on
// ne sait pas fabriquer un message qui donne une empreinte choisie.
// On s'en sert pour :
//   - le journal de sécurité chaîné (journal.js) : chaque ligne contient
//     l'empreinte de la précédente, une ligne modifiée casse la chaîne ;
//   - la SIGNATURE HMAC des trames des capteurs « version 2 » (trame.js) :
//     HMAC(clé, message) ne peut être calculé que par qui connaît la clé.
//
// Algorithme : norme FIPS 180-4. Le navigateur sait le faire
// (crypto.subtle), mais de façon asynchrone et pas sur le boîtier :
// on l'écrit donc en entier, en suivant la norme pas à pas.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// 64 constantes : parties fractionnaires des racines cubiques des 64
// premiers nombres premiers (fixées par la norme).
TPMS.SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

// Rotation à droite d'un entier de 32 bits.
function rotd(x, n) { return (x >>> n) | (x << (32 - n)); }

// octets : Uint8Array (ou tableau de nombres 0..255). Retourne 32 octets.
TPMS.sha256 = function (octets) {
  // 1. Remplissage : on ajoute 0x80, des zéros, puis la longueur en bits
  //    sur 8 octets, pour obtenir un multiple de 64 octets.
  var n = octets.length;
  var total = Math.ceil((n + 9) / 64) * 64;
  var m = new Uint8Array(total);
  for (var i = 0; i < n; i++) m[i] = octets[i];
  m[n] = 0x80;
  var bits = n * 8;
  for (var j = 0; j < 4; j++) m[total - 1 - j] = (bits >>> (8 * j)) & 0xff;
  m[total - 5] = Math.floor(bits / 0x100000000) & 0xff;   // messages < 512 Mo

  // 2. Valeurs de départ (racines carrées des 8 premiers nombres premiers).
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Array(64);

  // 3. Chaque bloc de 64 octets « brasse » les 8 valeurs en 64 tours.
  for (var bloc = 0; bloc < total; bloc += 64) {
    for (var t = 0; t < 16; t++) {
      var k = bloc + t * 4;
      w[t] = ((m[k] << 24) | (m[k + 1] << 16) | (m[k + 2] << 8) | m[k + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotd(w[t - 15], 7) ^ rotd(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = rotd(w[t - 2], 17) ^ rotd(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = rotd(e, 6) ^ rotd(e, 11) ^ rotd(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (hh + S1 + ch + TPMS.SHA256_K[t] + w[t]) >>> 0;
      var S0 = rotd(a, 2) ^ rotd(a, 13) ^ rotd(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  // 4. Résultat : les 8 valeurs, octet de poids fort en premier.
  var sortie = new Uint8Array(32);
  for (var v = 0; v < 8; v++) {
    sortie[v * 4] = h[v] >>> 24;
    sortie[v * 4 + 1] = (h[v] >>> 16) & 0xff;
    sortie[v * 4 + 2] = (h[v] >>> 8) & 0xff;
    sortie[v * 4 + 3] = h[v] & 0xff;
  }
  return sortie;
};

// HMAC-SHA256 (RFC 2104) : signature d'un message avec une clé secrète.
//   HMAC = SHA256( (clé ⊕ opad) ‖ SHA256( (clé ⊕ ipad) ‖ message ) )
TPMS.hmacSha256 = function (cle, message) {
  var bloc = new Uint8Array(64);
  var k = cle.length > 64 ? TPMS.sha256(cle) : cle;
  for (var i = 0; i < k.length; i++) bloc[i] = k[i];
  var interne = new Uint8Array(64 + message.length);
  var externe = new Uint8Array(64 + 32);
  for (var j = 0; j < 64; j++) {
    interne[j] = bloc[j] ^ 0x36;
    externe[j] = bloc[j] ^ 0x5c;
  }
  for (var n = 0; n < message.length; n++) interne[64 + n] = message[n];
  var h = TPMS.sha256(interne);
  for (var q = 0; q < 32; q++) externe[64 + q] = h[q];
  return TPMS.sha256(externe);
};

// Texte → octets UTF-8 (accents compris), sans dépendre du navigateur.
TPMS.texteEnOctets = function (texte) {
  var sortie = [];
  for (var i = 0; i < texte.length; i++) {
    var c = texte.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {   // caractère hors BMP
      c = 0x10000 + ((c - 0xd800) << 10) + (texte.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) sortie.push(c);
    else if (c < 0x800) sortie.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) sortie.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else sortie.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(sortie);
};

// Octets → texte hexadécimal ("ba7816bf…").
TPMS.enHexa = function (octets) {
  var s = "";
  for (var i = 0; i < octets.length; i++) s += (octets[i] < 16 ? "0" : "") + octets[i].toString(16);
  return s;
};
