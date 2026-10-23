// =====================================================================
// sha256.cpp — Empreinte SHA-256 et signature HMAC-SHA256
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/sha256.js
// En JS, le message entier est recopié dans un tableau rallongé. En C,
// on n'a pas la mémoire pour ça : on traite le message bloc par bloc
// (64 octets), et seul le DERNIER bloc reçoit le remplissage.
// =====================================================================
#include "sha256.h"
#include <string.h>

static const uint32_t K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

static uint32_t rotd(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

// Brasse un bloc de 64 octets dans les 8 valeurs h.
static void traiterBloc(uint32_t h[8], const uint8_t* m) {
  uint32_t w[64];
  for (int t = 0; t < 16; t++) {
    w[t] = ((uint32_t)m[t * 4] << 24) | ((uint32_t)m[t * 4 + 1] << 16) | ((uint32_t)m[t * 4 + 2] << 8) | m[t * 4 + 3];
  }
  for (int t = 16; t < 64; t++) {
    uint32_t s0 = rotd(w[t - 15], 7) ^ rotd(w[t - 15], 18) ^ (w[t - 15] >> 3);
    uint32_t s1 = rotd(w[t - 2], 17) ^ rotd(w[t - 2], 19) ^ (w[t - 2] >> 10);
    w[t] = w[t - 16] + s0 + w[t - 7] + s1;
  }
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int t = 0; t < 64; t++) {
    uint32_t S1 = rotd(e, 6) ^ rotd(e, 11) ^ rotd(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t temp1 = hh + S1 + ch + K[t] + w[t];
    uint32_t S0 = rotd(a, 2) ^ rotd(a, 13) ^ rotd(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temp2 = S0 + maj;
    hh = g; g = f; f = e; e = d + temp1;
    d = c; c = b; b = a; a = temp1 + temp2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

void sha256(const uint8_t* octets, uint32_t longueur, uint8_t sortie[32]) {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  uint32_t i = 0;
  for (; i + 64 <= longueur; i += 64) traiterBloc(h, octets + i);
  // Dernier(s) bloc(s) : reste du message, 0x80, zéros, longueur en bits.
  uint8_t fin[128];
  uint32_t reste = longueur - i;
  memset(fin, 0, sizeof(fin));
  memcpy(fin, octets + i, reste);
  fin[reste] = 0x80;
  int nbBlocs = (reste + 9 <= 64) ? 1 : 2;
  uint64_t bits = (uint64_t)longueur * 8;
  for (int j = 0; j < 8; j++) fin[nbBlocs * 64 - 1 - j] = (uint8_t)(bits >> (8 * j));
  for (int k = 0; k < nbBlocs; k++) traiterBloc(h, fin + k * 64);
  for (int v = 0; v < 8; v++) {
    sortie[v * 4] = (uint8_t)(h[v] >> 24);
    sortie[v * 4 + 1] = (uint8_t)(h[v] >> 16);
    sortie[v * 4 + 2] = (uint8_t)(h[v] >> 8);
    sortie[v * 4 + 3] = (uint8_t)h[v];
  }
}

// HMAC = SHA256( (clé ⊕ opad) ‖ SHA256( (clé ⊕ ipad) ‖ message ) )
// Message limité à 192 octets (nos trames et nos lignes de journal tiennent).
void hmacSha256(const uint8_t* cle, int longueurCle, const uint8_t* message, uint32_t longueur, uint8_t sortie[32]) {
  uint8_t bloc[64];
  memset(bloc, 0, sizeof(bloc));
  memcpy(bloc, cle, longueurCle > 64 ? 64 : longueurCle);
  uint8_t interne[64 + 192];
  if (longueur > 192) longueur = 192;
  for (int j = 0; j < 64; j++) interne[j] = bloc[j] ^ 0x36;
  memcpy(interne + 64, message, longueur);
  uint8_t h[32];
  sha256(interne, 64 + longueur, h);
  uint8_t externe[64 + 32];
  for (int j = 0; j < 64; j++) externe[j] = bloc[j] ^ 0x5c;
  memcpy(externe + 64, h, 32);
  sha256(externe, sizeof(externe), sortie);
}

void enHexa(const uint8_t* octets, int n, char* texte) {
  static const char chiffres[] = "0123456789abcdef";
  for (int i = 0; i < n; i++) {
    texte[i * 2] = chiffres[octets[i] >> 4];
    texte[i * 2 + 1] = chiffres[octets[i] & 15];
  }
  texte[n * 2] = '\0';
}
