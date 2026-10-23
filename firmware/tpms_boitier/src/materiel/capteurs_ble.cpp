// =====================================================================
// capteurs_ble.cpp — Écoute radio des capteurs TPMS (scan BLE)
// ---------------------------------------------------------------------
// COUCHE MATÉRIELLE. Bibliothèque : Bluefruit (fournie avec le cœur).
//
// Les capteurs TPMS ne se « connectent » pas : ils DIFFUSENT des
// annonces BLE (advertising), comme une balise. Le boîtier n'a qu'à
// écouter (scanner). Chaque annonce contient un champ "manufacturer
// specific data" (type 0xFF) : ce sont les 18 octets décodés par trame.cpp.
//
// ÉCOUTE PAR FENÊTRES : la radio en réception consomme ~5 mA. Elle n'est
// allumée que pendant la fenêtre décidée par la logique
// (boitierEcoute : 2 s toutes les 5 s), puis coupée.
//
// La fonction appelée par Bluefruit à chaque annonce (rappelScan) tourne
// dans une AUTRE tâche que loop(). Elle ne touche donc pas à la logique :
// elle range la trame et son heure dans une file d'attente FreeRTOS,
// que loop() vide ensuite (capteursTraiter). Même principe que le reed.
// =====================================================================
#include "capteurs_ble.h"
#include "../../config.h"
#include <bluefruit.h>
#include <string.h>

// Longueur maximale d'un champ dans une annonce BLE (31 octets en tout).
static const uint8_t TAILLE_DONNEES_MAX = 31;

struct TrameRecue {
  int32_t tMs;                          // heure de réception
  uint8_t longueur;
  uint8_t octets[TAILLE_DONNEES_MAX];
  uint8_t mac[6];                       // adresse radio de l'émetteur
  int8_t rssi;                          // puissance reçue (dBm)
};

static QueueHandle_t fileTrames = NULL;
static bool enEcoute = false;

// Mémoire des dernières trames, pour ignorer les copies.
static const int NB_DERNIERES = 4;
static uint8_t dernieresOctets[NB_DERNIERES][TAILLE_DONNEES_MAX];
static uint8_t dernieresLongueurs[NB_DERNIERES];
static int32_t dernieresMs[NB_DERNIERES];
static int prochaineCase = 0;

// ---------------------------------------------------------------------
// Appelée par Bluefruit (autre tâche) pour chaque annonce reçue.
// ---------------------------------------------------------------------
static void rappelScan(ble_gap_evt_adv_report_t* rapport) {
  uint8_t donnees[TAILLE_DONNEES_MAX];
  uint8_t n = Bluefruit.Scanner.parseReportByType(rapport, BLE_GAP_AD_TYPE_MANUFACTURER_SPECIFIC_DATA,
                                                  donnees, sizeof(donnees));
  // En temps normal, on ne garde que les annonces de 18 octets (capteurs
  // du commerce) ou de 26 octets (capteurs « v2 », trame2.h) : il y a des
  // dizaines d'objets BLE autour (téléphones, montres...) qui rempliraient
  // la file pour rien. En mode découverte, on garde tout.
  bool garder = (n == TAILLE_TRAME) || (n == TAILLE_TRAME_V2) || (MODE_DECOUVERTE && n > 0);
  if (garder && fileTrames != NULL) {
    TrameRecue t;
    t.tMs = (int32_t)millis();
    t.longueur = n;
    memcpy(t.octets, donnees, n);
    memcpy(t.mac, rapport->peer_addr.addr, 6);
    t.rssi = rapport->rssi;
    xQueueSend(fileTrames, &t, 0);   // 0 = ne pas attendre si la file est pleine
  }
  // Avec Bluefruit, le scanner se met en pause après chaque annonce :
  // il faut le relancer.
  Bluefruit.Scanner.resume();
}

void capteursDemarrer() {
  fileTrames = xQueueCreate(16, sizeof(TrameRecue));
  for (int i = 0; i < NB_DERNIERES; i++) dernieresMs[i] = -1000000;

  Bluefruit.Scanner.setRxCallback(rappelScan);
  // Écoute passive : on ne demande rien aux émetteurs (moins d'énergie,
  // et le boîtier ne révèle pas sa présence).
  Bluefruit.Scanner.useActiveScan(false);
  // Intervalle = fenêtre (en unités de 0,625 ms : 160 = 100 ms) : la
  // radio écoute en continu PENDANT la fenêtre décidée par la logique.
  Bluefruit.Scanner.setInterval(160, 160);
  enEcoute = false;
}

void capteursFenetre(bool ecouter) {
  if (ecouter && !enEcoute) {
    Bluefruit.Scanner.start(0);        // 0 = sans limite de durée
    enEcoute = true;
  } else if (!ecouter && enEcoute) {
    Bluefruit.Scanner.stop();
    enEcoute = false;
  }
}

// Une annonce BLE est émise sur 3 canaux en quelques millisecondes : la
// même trame peut arriver 2 ou 3 fois. Sans ce filtre, le contrôle du
// rythme (securite.cpp) y verrait un second émetteur !
static bool estUneCopie(const uint8_t* octets, uint8_t longueur, int32_t tMs) {
  for (int i = 0; i < NB_DERNIERES; i++) {
    if (tMs - dernieresMs[i] < COPIE_IGNOREE_MS && dernieresLongueurs[i] == longueur &&
        memcmp(dernieresOctets[i], octets, longueur) == 0) {
      return true;
    }
  }
  memcpy(dernieresOctets[prochaineCase], octets, longueur);
  dernieresLongueurs[prochaineCase] = longueur;
  dernieresMs[prochaineCase] = tMs;
  prochaineCase = (prochaineCase + 1) % NB_DERNIERES;
  return false;
}

static void ecrireTrame(const TrameRecue* t, const char* verdict) {
  char hexa[3 * TAILLE_DONNEES_MAX];
  char mac[18];
  trameEnHexa(t->octets, t->longueur, hexa);
  // L'adresse radio s'écrit à l'envers (octet de poids fort en premier).
  snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
           t->mac[5], t->mac[4], t->mac[3], t->mac[2], t->mac[1], t->mac[0]);
  Serial.print("[trame] ");
  Serial.print(mac);
  Serial.print(" rssi ");
  Serial.print(t->rssi);
  Serial.print(" (");
  Serial.print(t->longueur);
  Serial.print(" o) ");
  Serial.print(hexa);
  Serial.print(" → ");
  Serial.println(verdict);
}

void capteursTraiter(Boitier* b) {
  if (fileTrames == NULL) return;
  TrameRecue t;
  while (xQueueReceive(fileTrames, &t, 0) == pdTRUE) {
    if (t.longueur != TAILLE_TRAME && t.longueur != TAILLE_TRAME_V2) {
      // Seulement en mode découverte : on affiche, sans décoder.
      ecrireTrame(&t, "longueur différente de 18 et 26 : format inconnu");
      continue;
    }
    if (estUneCopie(t.octets, t.longueur, t.tMs)) continue;
    Resultat r = boitierRecevoirTrame(b, t.octets, t.longueur, t.tMs);
    if (JOURNAL_TRAMES || MODE_DECOUVERTE) ecrireTrame(&t, texteResultat(r));
  }
}
