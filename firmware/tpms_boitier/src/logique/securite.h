// =====================================================================
// securite.h — Protections contre les faux capteurs
// ---------------------------------------------------------------------
// Traduction en C++ de : logique/securite.js
// LOGIQUE PURE : aucun appel Arduino.
//
// Les capteurs TPMS du commerce diffusent leurs mesures EN CLAIR, sans
// signature ni compteur. N'importe qui peut écouter les trames, et un
// émetteur BLE à 5 € peut en fabriquer de fausses. Le boîtier ne peut
// donc pas « prouver » qu'une trame vient du vrai capteur : il ne peut
// que trier ce qu'il reçoit. On empile trois protections (défense en
// profondeur), chacune activable séparément :
//
//   1. LISTE BLANCHE   : seuls les 2 capteurs appairés sont écoutés.
//   2. VRAISEMBLANCE   : une pression ne peut pas changer n'importe
//                        comment ; un changement brutal doit être confirmé.
//   3. RYTHME          : un capteur émet toutes les ~3 s. Des trames plus
//                        rapprochées avec la même adresse veulent dire
//                        que DEUX émetteurs l'utilisent : usurpation ou
//                        rejeu. Le boîtier passe alors en « signal suspect ».
//
// Un vrai anti-rejeu (compteur + signature) est impossible avec ces
// capteurs : leurs trames n'ont ni l'un ni l'autre. Il est appliqué sur
// la liaison boîtier ↔ application, que l'on maîtrise.
// =====================================================================
#ifndef SECURITE_H
#define SECURITE_H

#include <stdint.h>
#include "trame.h"

// ---------------------------------------------------------------------
// Positions des roues
// ---------------------------------------------------------------------
// En JS, une position est un texte "AV" ou "AR" (ou null).
// En C, un numéro, qui sert aussi d'indice dans les tableaux à 2 cases.
enum Position {
  POSITION_AUCUNE = -1,   // en JS : null
  POS_AV = 0,
  POS_AR = 1
};
const int NB_ROUES = 2;
extern const char* const NOM_POSITION[NB_ROUES];   // { "AV", "AR" }

struct Protections {
  bool listeBlanche;
  bool vraisemblance;
  bool rythme;
};

void protectionsParDefaut(Protections* p);

// ---------------------------------------------------------------------
// 1. Liste blanche
// ---------------------------------------------------------------------

// En JS : appairage = { AV: "EA:CA:3F:1B:07", AR: "EA:CA:3F:1B:08" }
// En C  : adresse[POS_AV] et adresse[POS_AR], 5 octets chacune.
struct Appairage {
  uint8_t adresse[NB_ROUES][TAILLE_ADRESSE];
};

// Retourne POS_AV, POS_AR, ou POSITION_AUCUNE si le capteur n'est pas
// dans la liste.
Position positionCapteur(const Appairage* appairage, const uint8_t* adresse);

// SANS liste blanche, le boîtier n'a que le numéro du capteur pour
// savoir de quelle roue il s'agit. Le capteur n°1 d'un autre vélo
// passerait alors pour notre roue avant.
Position positionParNumero(uint8_t numero);

// ---------------------------------------------------------------------
// 2. Vraisemblance
// ---------------------------------------------------------------------

// Limites physiques du capteur (fiche technique supposée, À VÉRIFIER).
const float PRESSION_MAX_BAR = 8.0f;
const float TEMPERATURE_MIN_C = -40.0f;
const float TEMPERATURE_MAX_C = 85.0f;

// Variation maximale « normale ». Un pneu crevé perd environ 0,15 bar/s,
// une pompe à pied gonfle à environ 0,05 bar/s : 0,3 bar/s laisse de la marge.
const float VARIATION_MAX_BAR_S = 0.3f;
const float VARIATION_MAX_C_S = 1.0f;
// Plafond du temps qui sert à juger une variation (voir verifierVraisemblance).
// Compromis mesuré dans le simulateur, écoute par fenêtres :
//   5 s : vraie crevaison signalée en 11 s au pire ; une fausse pression
//         entre 0,8 et 1,5 bar peut s'afficher 6 s avant « SIGNAL SUSPECT ».
//   3 s : la fausse pression ne passe presque plus, mais la vraie
//         crevaison n'est signalée qu'en 32 à 36 s.
// On choisit 5 s : prévenir vite d'une vraie crevaison passe d'abord.
// Dans les deux cas, masquer une crevaison par rejeu échoue (alerte en 7 s).
const float VARIATION_DT_MAX_S = 5.0f;

// Un changement brutal n'est accepté que s'il est confirmé par
// 3 trames de suite qui donnent la même valeur (à 0,1 bar près).
// Pourquoi 3 ? Il faut que la protection « rythme », qui demande
// 3 anomalies, détecte un pirate AVANT que ses fausses valeurs ne soient
// confirmées. Pour un vrai regonflage, cela retarde l'affichage
// d'environ 10 s seulement.
const uint8_t CONFIRMATIONS = 3;
const float ECART_CONFIRMATION_BAR = 0.1f;

struct Verification {
  float candidatBar;
  uint8_t nbConfirmations;
};

void creerVerification(Verification* v);

// En JS, le verdict est un texte ; en C, une liste de valeurs (enum).
enum Verdict {
  VERDICT_OK,             // "ok"
  VERDICT_HORS_LIMITES,   // "hors-limites"
  VERDICT_SUSPECTE,       // "suspecte"
  VERDICT_CONFIRMEE       // "confirmee"
};

// v         : mémoire de la vérification (une par roue)
// ancienne  : dernière mesure acceptée (0 = aucune, en JS : null)
// ancienneMs: instant de cette mesure
// nouvelle  : mesure qui vient d'arriver
// confirmationPermise : false quand on doute de l'émetteur (le contrôle
//   du rythme a vu des trames trop rapprochées dans la dernière minute).
//   On ne laisse alors confirmer aucun changement brutal : sinon un
//   pirate obtient ses 3 trames de confirmation avant que le rythme ait
//   réuni ses 3 anomalies. Seules passent alors les valeurs à moins de
//   0,1 bar de la dernière valeur de confiance.
Verdict verifierVraisemblance(Verification* v, const Mesure* ancienne, int32_t ancienneMs,
                              const Mesure* nouvelle, int32_t maintenantMs,
                              bool confirmationPermise);

// ---------------------------------------------------------------------
// 3. Rythme (détection d'un second émetteur : usurpation ou rejeu)
// ---------------------------------------------------------------------

// Le vrai capteur émet toutes les 3 s environ (À VÉRIFIER sur les vrais
// capteurs). Deux trames de la même adresse à moins de 2 s d'écart
// sont une anomalie.
// Une même annonce BLE est envoyée sur 3 canaux en quelques
// millisecondes : les copies identiques reçues à moins de 100 ms
// d'écart sont déjà éliminées par materiel/capteurs_ble.cpp.
const int32_t RYTHME_MIN_MS = 2000;
const int RYTHME_ANOMALIES_MAX = 3;      // 3 anomalies en 1 min = intrusion
const int32_t RYTHME_FENETRE_MS = 60000;
const int32_t QUARANTAINE_MS = 60000;    // durée du « signal suspect »

// En JS, anomaliesMs est un tableau sans limite. Il est vidé dès qu'il
// atteint 3 cases : un tableau C de 3 cases suffit donc.
// Une vraie crevaison fait émettre le capteur en rafale (une trame par
// seconde) avec une pression qui ne fait que BAISSER : ce n'est pas une
// anomalie (défaut révélé par la simulation). Un pirate mêlé au vrai
// capteur fait remonter la valeur une fois sur deux : il reste détecté.
const float RYTHME_DESCENTE_BAR = 0.05f;

struct Rythme {
  int32_t dernierMs;                            // -1 = aucune trame
  float dernierePressionBar;                    // -1 = inconnue (en JS : null)
  int32_t anomaliesMs[RYTHME_ANOMALIES_MAX];
  int nbAnomalies;
};

void creerRythme(Rythme* r);

// À appeler pour CHAQUE trame portant l'adresse d'un capteur appairé.
// Retourne true si une intrusion vient d'être détectée.
// pressionBar : pression de cette trame (-1 = inconnue).
bool controlerRythme(Rythme* r, int32_t maintenantMs, float pressionBar = -1.0f);

// Le contrôle du rythme a-t-il un doute sur cette roue ?
// (au moins une anomalie dans la dernière minute)
bool rythmeDouteux(const Rythme* r);

#endif
