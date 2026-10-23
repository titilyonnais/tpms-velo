// =====================================================================
// sha256.h — Empreinte SHA-256 et signature HMAC-SHA256
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/sha256.js (norme FIPS 180-4, RFC 2104)
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#ifndef SHA256_H
#define SHA256_H

#include <stdint.h>

// Empreinte de "longueur" octets → 32 octets dans "sortie".
void sha256(const uint8_t* octets, uint32_t longueur, uint8_t sortie[32]);

// Signature HMAC-SHA256 (clé de 64 octets au plus) → 32 octets.
void hmacSha256(const uint8_t* cle, int longueurCle, const uint8_t* message, uint32_t longueur, uint8_t sortie[32]);

// 32 octets → 64 caractères hexadécimaux + '\0' (texte : 65 octets).
void enHexa(const uint8_t* octets, int n, char* texte);

#endif
