// =====================================================================
// liaison_ble.h — Service BLE du boîtier pour l'application (GATT)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE : met en place le service décrit dans protocole.h
// avec la pile Bluefruit, et transmet les événements radio (connexion,
// code d'appairage, écriture des réglages...) à la logique de liaison.cpp.
// =====================================================================
#ifndef LIAISON_BLE_H
#define LIAISON_BLE_H

#include <stdint.h>
#include "../logique/boitier.h"

// Démarre la pile BLE (Bluefruit.begin), la sécurité, le service GATT et
// les annonces (advertising) pour que le téléphone trouve le boîtier.
void liaisonBleDemarrer(const Boitier* b);

// Traite les événements BLE arrivés depuis le dernier appel.
void liaisonBleTraiter(Boitier* b, int32_t maintenantMs);

// Envoie la notification MESURES (si l'application est connectée).
void liaisonBleEnvoyerMesures(Boitier* b, int32_t maintenantMs);

// Efface les clés d'appairage de tous les téléphones.
void liaisonBleOublierTelephones(Boitier* b, int32_t maintenantMs);

// Coupe la liaison et les annonces (avant la veille).
void liaisonBleArreter();

#endif
