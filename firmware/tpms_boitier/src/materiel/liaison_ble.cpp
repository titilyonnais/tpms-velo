// =====================================================================
// liaison_ble.cpp — Service BLE du boîtier pour l'application (GATT)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE. Bibliothèque : Bluefruit (fournie avec le cœur).
//
// Ce que fait la PILE BLE (le "SoftDevice" de Nordic, piloté par Bluefruit) :
//   - l'appairage LE Secure Connections : échange de clés par
//     Diffie-Hellman sur courbe elliptique, puis vérification par un code
//     à 6 chiffres TIRÉ AU HASARD par la pile et AFFICHÉ sur l'e-paper ;
//   - le chiffrement AES-CCM de tous les échanges, avec un compteur de
//     paquets qui rend le rejeu impossible ;
//   - le refus, AVANT même que notre code ne soit appelé, de toute
//     lecture ou écriture des caractéristiques par un téléphone dont le
//     lien n'est pas chiffré avec une clé authentifiée par le code
//     (permission SECMODE_ENC_WITH_MITM).
// Ce que fait NOTRE code (logique/liaison.cpp) : afficher le code,
// compter les échecs, bloquer 1 min après 3 échecs, revérifier que le
// lien est appairé (défense en profondeur), vérifier les réglages reçus.
//
// Comme pour les capteurs, les fonctions appelées par Bluefruit
// ("rappels") tournent dans une autre tâche : elles ne font que poser un
// événement dans une file d'attente, traitée par loop().
//
// À VÉRIFIER (noms et signatures des fonctions Bluefruit, d'après les
// exemples du cœur Adafruit nRF52 ; à confirmer à la première compilation) :
//   Bluefruit.configPrphConn, Bluefruit.Security.setIOCaps / setMITM /
//   setPairPasskeyCallback / setPairCompleteCallback / setSecuredCallback,
//   Bluefruit.Periph.setConnectCallback / setDisconnectCallback /
//   setConnInterval / clearBonds, BLEConnection::requestMtuExchange.
// À VÉRIFIER aussi : que l'appairage obtenu est bien LESC (« LE Secure
// Connections ») et pas « Legacy » ; avec nRF Connect sur Android, l'onglet
// de la connexion l'indique. En Legacy, le code à 6 chiffres peut être
// retrouvé par quelqu'un qui a enregistré l'appairage.
// =====================================================================
#include "liaison_ble.h"
#include "stockage.h"
#include "../../config.h"
#include <bluefruit.h>
#include <string.h>

// ---------------------------------------------------------------------
// Service et caractéristiques
// ---------------------------------------------------------------------
// Bluefruit garde un POINTEUR vers les 16 octets de chaque UUID : ces
// tableaux doivent exister pendant toute la vie du programme (static).
static uint8_t uuidService[16];
static uint8_t uuidMesures[16];
static uint8_t uuidReglages[16];
static uint8_t uuidCommande[16];

static BLEService serviceTpms;
static BLECharacteristic carMesures;
static BLECharacteristic carReglages;
static BLECharacteristic carCommande;

static uint16_t connexionCourante = BLE_CONN_HANDLE_INVALID;

// MTU demandée : 247 octets. La MTU par défaut (23) ne laisse que 20
// octets de données par paquet ; REGLAGES en fait 23. À VÉRIFIER avec
// l'application (Chrome Android, Bluefy sur iPhone) : la MTU réellement
// obtenue s'affiche sur le moniteur série à la connexion.
static const uint16_t MTU_DEMANDEE = 247;

// ---------------------------------------------------------------------
// File d'événements : rappels Bluefruit → loop()
// ---------------------------------------------------------------------
enum TypeEvenement {
  EV_CONNEXION,
  EV_DECONNEXION,
  EV_CODE,            // la pile demande d'afficher un code
  EV_APPAIRAGE_RATE,
  EV_SECURISE,        // lien chiffré avec une clé authentifiée
  EV_REGLAGES,        // l'application écrit REGLAGES
  EV_COMMANDE         // l'application écrit COMMANDE
};

struct EvenementBle {
  uint8_t type;
  uint16_t connexion;
  uint16_t longueur;
  uint8_t donnees[TAILLE_REGLAGES];   // code (6 chiffres), réglages ou commande
};

static QueueHandle_t fileEvenements = NULL;

static void poserEvenement(uint8_t type, uint16_t connexion, const uint8_t* donnees, uint16_t longueur) {
  EvenementBle ev;
  memset(&ev, 0, sizeof(ev));
  ev.type = type;
  ev.connexion = connexion;
  ev.longueur = longueur;   // la longueur RÉELLE, même si elle est trop grande :
                            // decoderReglages refusera une mauvaise longueur.
  uint16_t aCopier = (longueur < TAILLE_REGLAGES) ? longueur : TAILLE_REGLAGES;
  if (donnees != NULL && aCopier > 0) memcpy(ev.donnees, donnees, aCopier);
  if (fileEvenements != NULL) xQueueSend(fileEvenements, &ev, 0);
}

// ---------------------------------------------------------------------
// Rappels Bluefruit (autre tâche : on ne fait que poser un événement)
// ---------------------------------------------------------------------
static void rappelConnexion(uint16_t connexion) {
  poserEvenement(EV_CONNEXION, connexion, NULL, 0);
}

static void rappelDeconnexion(uint16_t connexion, uint8_t raison) {
  (void)raison;
  poserEvenement(EV_DECONNEXION, connexion, NULL, 0);
}

// La pile a tiré un code à 6 chiffres (6 caractères ASCII '0' à '9').
static bool rappelCode(uint16_t connexion, uint8_t const code[6], bool demandeComparaison) {
  (void)demandeComparaison;   // seulement pour le mode « comparer deux codes »
  poserEvenement(EV_CODE, connexion, code, 6);
  return true;
}

static void rappelAppairageTermine(uint16_t connexion, uint8_t statut) {
  if (statut != BLE_GAP_SEC_STATUS_SUCCESS) {
    poserEvenement(EV_APPAIRAGE_RATE, connexion, NULL, 0);
  }
  // En cas de succès, rappelSecurise est appelé juste après.
}

static void rappelSecurise(uint16_t connexion) {
  poserEvenement(EV_SECURISE, connexion, NULL, 0);
}

static void rappelEcritureReglages(uint16_t connexion, BLECharacteristic* car, uint8_t* donnees, uint16_t longueur) {
  (void)car;
  poserEvenement(EV_REGLAGES, connexion, donnees, longueur);
}

static void rappelEcritureCommande(uint16_t connexion, BLECharacteristic* car, uint8_t* donnees, uint16_t longueur) {
  (void)car;
  poserEvenement(EV_COMMANDE, connexion, donnees, longueur);
}

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
void liaisonBleDemarrer(const Boitier* b) {
  fileEvenements = xQueueCreate(8, sizeof(EvenementBle));

  // MTU plus grande (à régler AVANT Bluefruit.begin).
  // Paramètres : MTU max, durée d'un échange radio, tailles des files
  // d'envoi (valeurs par défaut de la pile Nordic).
  Bluefruit.configPrphConn(MTU_DEMANDEE, BLE_GAP_EVENT_LENGTH_DEFAULT,
                           BLE_GATTS_HVN_TX_QUEUE_SIZE_DEFAULT,
                           BLE_GATTC_WRITE_CMD_TX_QUEUE_SIZE_DEFAULT);

  // 1 connexion « périphérique » (le téléphone) au plus, et le rôle
  // « central » pour pouvoir scanner les capteurs.
  // Une seule connexion à la fois : un second téléphone ne peut pas
  // perturber un appairage en cours.
  Bluefruit.begin(1, 1);
  Bluefruit.setTxPower(PUISSANCE_BLE_DBM);
  Bluefruit.setName(NOM_BLE);
  Bluefruit.autoConnLed(false);   // pas de LED bleue qui clignote : économie

  // ---- Sécurité ----
  // Le boîtier sait AFFICHER (écran) mais n'a ni clavier ni bouton oui/non :
  // display = true, yes/no = false, keyboard = false. Le téléphone, lui,
  // a un clavier : c'est le mode « passkey entry » (on tape le code affiché).
  Bluefruit.Security.setIOCaps(true, false, false);
  Bluefruit.Security.setMITM(true);   // protection contre l'homme du milieu exigée
  Bluefruit.Security.setPairPasskeyCallback(rappelCode);
  Bluefruit.Security.setPairCompleteCallback(rappelAppairageTermine);
  Bluefruit.Security.setSecuredCallback(rappelSecurise);

  Bluefruit.Periph.setConnectCallback(rappelConnexion);
  Bluefruit.Periph.setDisconnectCallback(rappelDeconnexion);
  // Intervalle de connexion 100 à 200 ms (unités de 1,25 ms) :
  // c'est la valeur du bilan énergétique (liaisonAppMa dans energie.js).
  Bluefruit.Periph.setConnInterval(80, 160);

  // ---- Service GATT (protocole.h) ----
  uuidDepuisTexte(UUID_SERVICE, uuidService);
  uuidDepuisTexte(UUID_MESURES, uuidMesures);
  uuidDepuisTexte(UUID_REGLAGES, uuidReglages);
  uuidDepuisTexte(UUID_COMMANDE, uuidCommande);

  serviceTpms.setUuid(BLEUuid(uuidService));
  serviceTpms.begin();   // les caractéristiques créées ensuite lui appartiennent

  // MESURES : lecture + notification, CHIFFRÉ et APPAIRÉ.
  carMesures.setUuid(BLEUuid(uuidMesures));
  carMesures.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  carMesures.setPermission(SECMODE_ENC_WITH_MITM, SECMODE_NO_ACCESS);
  carMesures.setFixedLen(TAILLE_MESURES);
  carMesures.begin();

  // REGLAGES : lecture + écriture, CHIFFRÉ et APPAIRÉ.
  carReglages.setUuid(BLEUuid(uuidReglages));
  carReglages.setProperties(CHR_PROPS_READ | CHR_PROPS_WRITE);
  carReglages.setPermission(SECMODE_ENC_WITH_MITM, SECMODE_ENC_WITH_MITM);
  carReglages.setFixedLen(TAILLE_REGLAGES);
  carReglages.setWriteCallback(rappelEcritureReglages);
  carReglages.begin();

  // COMMANDE : écriture seule, CHIFFRÉ et APPAIRÉ.
  carCommande.setUuid(BLEUuid(uuidCommande));
  carCommande.setProperties(CHR_PROPS_WRITE);
  carCommande.setPermission(SECMODE_NO_ACCESS, SECMODE_ENC_WITH_MITM);
  carCommande.setFixedLen(1);
  carCommande.setWriteCallback(rappelEcritureCommande);
  carCommande.begin();

  // Valeur de départ de REGLAGES (lisible seulement par un téléphone appairé,
  // grâce à la permission ci-dessus).
  uint8_t reglages[TAILLE_REGLAGES];
  encoderReglages(&b->reglages, reglages);
  carReglages.write(reglages, TAILLE_REGLAGES);

  // ---- Annonces : pour que le téléphone trouve le boîtier ----
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(serviceTpms);   // UUID 128 bits : l'app filtre dessus
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  // Rapide (20 ms) pendant 30 s après le démarrage, puis lent (1 s) :
  // la connexion reste facile sans vider la batterie.
  // À VÉRIFIER : ce poste (≈ 10 à 20 µA) n'est pas encore dans energie.js.
  Bluefruit.Advertising.setInterval(32, 1600);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

// ---------------------------------------------------------------------
// Traitement des événements, dans loop()
// ---------------------------------------------------------------------
static void deconnecter(uint16_t connexion) {
  Bluefruit.disconnect(connexion);
}

void liaisonBleTraiter(Boitier* b, int32_t maintenantMs) {
  if (fileEvenements == NULL) return;

  // Un changement sensible vient d'être confirmé par un appui long sur
  // le bouton 2 (logique/liaison.cpp) : on le sauve en flash et on met
  // la caractéristique REGLAGES à jour, pour que l'app le relise.
  if (b->liaison.reglagesChanges) {
    b->liaison.reglagesChanges = false;
    stockageSauver(b);
    uint8_t reglages[TAILLE_REGLAGES];
    encoderReglages(&b->reglages, reglages);
    carReglages.write(reglages, TAILLE_REGLAGES);
  }

  EvenementBle ev;
  while (xQueueReceive(fileEvenements, &ev, 0) == pdTRUE) {
    switch (ev.type) {

      case EV_CONNEXION: {
        connexionCourante = ev.connexion;
        if (liaisonBloquee(b, maintenantMs)) {
          boitierJournal(b, maintenantMs, "Connexion refusée : appairage bloqué");
          deconnecter(ev.connexion);
          break;
        }
        // Demande d'une MTU plus grande (voir MTU_DEMANDEE).
        BLEConnection* connexion = Bluefruit.Connection(ev.connexion);
        if (connexion != NULL) {
          connexion->requestMtuExchange(MTU_DEMANDEE);
          Serial.print("[ble] téléphone connecté, MTU = ");
          Serial.println(connexion->getMtu());
        }
        break;
      }

      case EV_CODE: {
        char code[7];
        memcpy(code, ev.donnees, 6);
        code[6] = '\0';
        if (!liaisonDemandeCode(b, code, maintenantMs)) deconnecter(ev.connexion);
        break;
      }

      case EV_APPAIRAGE_RATE:
        if (liaisonEchecAppairage(b, maintenantMs)) deconnecter(ev.connexion);
        break;

      case EV_SECURISE: {
        liaisonSecurisee(b, maintenantMs);
        uint8_t reglages[TAILLE_REGLAGES];
        if (liaisonLireReglages(b, reglages)) carReglages.write(reglages, TAILLE_REGLAGES);
        break;
      }

      case EV_DECONNEXION:
        if (ev.connexion == connexionCourante) connexionCourante = BLE_CONN_HANDLE_INVALID;
        liaisonDeconnexion(b, maintenantMs);
        break;

      case EV_REGLAGES: {
        const char* resultat = liaisonEcrireReglages(b, ev.donnees, ev.longueur, maintenantMs);
        Serial.print("[ble] écriture REGLAGES : ");
        Serial.println(resultat);
        if (strcmp(resultat, "ok") == 0) {
          stockageSauver(b);   // les nouveaux réglages survivront à la veille
        }
        // "attente-bouton" : rien n'est encore changé ; le drapeau de
        // MESURES prévient l'app, et la sauvegarde se fera à la
        // confirmation (début de cette fonction).
        // On remet dans la caractéristique les réglages EN VIGUEUR
        // (les nouveaux si acceptés, les anciens sinon).
        uint8_t reglages[TAILLE_REGLAGES];
        encoderReglages(&b->reglages, reglages);
        carReglages.write(reglages, TAILLE_REGLAGES);
        break;
      }

      case EV_COMMANDE: {
        const char* resultat = (ev.longueur == 1)
          ? liaisonCommande(b, ev.donnees[0], maintenantMs)
          : "format invalide";
        Serial.print("[ble] commande : ");
        Serial.println(resultat);
        break;
      }
    }
  }
}

void liaisonBleEnvoyerMesures(Boitier* b, int32_t maintenantMs) {
  uint8_t mesures[TAILLE_MESURES];
  if (!liaisonMesures(b, maintenantMs, mesures)) return;   // app non connectée
  if (connexionCourante == BLE_CONN_HANDLE_INVALID) return;
  if (carMesures.notifyEnabled(connexionCourante)) {
    carMesures.notify(connexionCourante, mesures, TAILLE_MESURES);
  } else {
    carMesures.write(mesures, TAILLE_MESURES);   // au moins lisible par une lecture
  }
}

void liaisonBleOublierTelephones(Boitier* b, int32_t maintenantMs) {
  if (connexionCourante != BLE_CONN_HANDLE_INVALID) deconnecter(connexionCourante);
  Bluefruit.Periph.clearBonds();
  liaisonOublier(b, maintenantMs);
  boitierJournal(b, maintenantMs, "Téléphones appairés oubliés");
}

void liaisonBleArreter() {
  Bluefruit.Advertising.restartOnDisconnect(false);
  Bluefruit.Advertising.stop();
  if (connexionCourante != BLE_CONN_HANDLE_INVALID) {
    deconnecter(connexionCourante);
    delay(100);   // laisse le temps à la pile d'envoyer la déconnexion
  }
}
