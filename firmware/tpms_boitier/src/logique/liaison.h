// =====================================================================
// liaison.h — Côté boîtier de la liaison avec l'application
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/liaison.js
// LOGIQUE PURE : aucun appel Arduino. Les appels à la pile BLE
// (Bluefruit) sont dans materiel/liaison_ble.cpp, qui appelle ces
// fonctions quand un événement arrive.
//
// Dans le firmware, c'est la pile BLE qui gère l'appairage et le
// chiffrement. Notre code se contente de :
//   - afficher sur l'écran le code à 6 chiffres que la pile lui donne ;
//   - compter les échecs et bloquer l'appairage 1 min après 3 échecs ;
//   - refuser les réglages tant que le lien n'est pas appairé et chiffré ;
//   - vérifier que les réglages reçus ont du sens.
//
// Pourquoi un code affiché ? Sans lui, l'appairage « Just Works » ne
// protège pas d'une attaque de l'homme du milieu : un pirate pourrait
// s'intercaler entre le téléphone et le boîtier. Le code n'est visible
// que par la personne qui a le vélo sous les yeux.
//
// CORRESPONDANCE avec le simulateur (qui simule aussi la pile BLE) :
//   JS liaisonConnexion → "connecte"     ⇒ C liaisonSecurisee
//                         (téléphone déjà appairé : la pile rétablit le
//                          chiffrement avec la clé mémorisée)
//   JS liaisonConnexion → "code-requis"  ⇒ C liaisonDemandeCode
//                         (le code vient de la pile BLE, qui le tire au
//                          hasard, et non de Math.random)
//   JS liaisonConnexion → "bloque"       ⇒ liaisonDemandeCode retourne false
//   JS liaisonSaisirCode → "ok"          ⇒ C liaisonSecurisee
//   JS liaisonSaisirCode → "faux"/"bloque" ⇒ C liaisonEchecAppairage
//   La COMPARAISON du code est faite par la pile BLE : en LE Secure
//   Connections, le code n'est jamais transmis en clair.
// =====================================================================
#ifndef LIAISON_H
#define LIAISON_H

#include <stdint.h>

const int32_t CODE_DUREE_MS = 60000;     // le code reste affiché 1 min
const uint8_t CODE_ESSAIS_MAX = 3;       // 3 codes faux...
const int32_t CODE_BLOCAGE_MS = 60000;   // ... et l'appairage est bloqué 1 min

struct Liaison {
  bool connecte;           // téléphone connecté ET lien chiffré
  bool appaire;            // un téléphone a déjà été appairé (clé mémorisée)
  char code[7];            // code affiché pendant l'appairage ("" = aucun)
  int32_t codeJusquaMs;
  uint8_t essais;
  int32_t bloqueJusquaMs;
  uint16_t sequence;       // numéro de la prochaine notification MESURES
};

struct Boitier;   // décrit dans boitier.h

void creerLiaison(Liaison* l);

// L'appairage est-il bloqué (trop de codes faux) ?
bool liaisonBloquee(const Boitier* b, int32_t maintenantMs);

// La pile BLE demande d'afficher un code à 6 chiffres.
// Retourne false si l'appairage est bloqué : il faut alors couper la connexion.
//
// Différence avec le JS : le simulateur ne remplace pas un code encore
// valide (sinon n'importe qui à portée pourrait changer le code sous les
// yeux du cycliste). Dans le firmware, le code est choisi par la pile BLE
// pour CHAQUE tentative : c'est celui-là que le téléphone doit taper, il
// faut donc toujours afficher le dernier reçu. La même protection est
// obtenue autrement : le boîtier n'accepte qu'UNE connexion à la fois
// (Bluefruit.begin(1, ...)), donc un second téléphone ne peut pas lancer
// d'appairage pendant qu'un premier est en cours.
bool liaisonDemandeCode(Boitier* b, const char* code6chiffres, int32_t maintenantMs);

// L'appairage a échoué (code faux tapé sur le téléphone, abandon...).
// Retourne true si l'appairage vient d'être bloqué.
// Différence avec le JS : en BLE, un échec termine la tentative ; la
// suivante aura un NOUVEAU code. On efface donc le code affiché.
bool liaisonEchecAppairage(Boitier* b, int32_t maintenantMs);

// Le lien est chiffré avec une clé d'appairage (nouvel appairage, ou
// reconnexion d'un téléphone déjà appairé).
void liaisonSecurisee(Boitier* b, int32_t maintenantMs);

void liaisonDeconnexion(Boitier* b, int32_t maintenantMs);

// Oublier le téléphone : il devra refaire l'appairage.
// (La couche matérielle efface aussi les clés gardées par Bluefruit.)
void liaisonOublier(Boitier* b, int32_t maintenantMs);

// Notification MESURES (toutes les 5 s quand l'app est connectée).
// Remplit "o" (TAILLE_MESURES octets). Retourne false si l'app n'est
// pas connectée (en JS : null).
bool liaisonMesures(Boitier* b, int32_t maintenantMs, uint8_t* o);

// Lecture des réglages : réservée à un téléphone appairé.
bool liaisonLireReglages(const Boitier* b, uint8_t* o);

// Écriture des réglages. Retourne "ok", "refuse", "format invalide"
// ou la raison du rejet (comme en JS).
const char* liaisonEcrireReglages(Boitier* b, const uint8_t* octets, int longueur, int32_t maintenantMs);

// Retourne "ok", "refuse" ou "commande inconnue".
const char* liaisonCommande(Boitier* b, uint8_t octet, int32_t maintenantMs);

#endif
