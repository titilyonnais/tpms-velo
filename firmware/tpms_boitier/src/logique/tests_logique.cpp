// =====================================================================
// tests_logique.cpp — Les tests du simulateur, rejoués sur la carte
// ---------------------------------------------------------------------
// Traduction en C++ d'une partie de : simulateur/tests/tests.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "tests_logique.h"
#include "journal.h"
#include "sha256.h"
#include "trame2.h"
#include "boitier.h"
#include "ecran.h"
#include "outils.h"
#include "boutons.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static void (*sortie)(const char*) = 0;
static int reussis = 0;
static int rates = 0;

static void verifier(const char* nom, bool condition) {
  char ligne[120];
  if (condition) {
    reussis++;
    snprintf(ligne, sizeof(ligne), "OK     %s", nom);
  } else {
    rates++;
    snprintf(ligne, sizeof(ligne), "ECHEC  %s", nom);
  }
  if (sortie != 0) sortie(ligne);
}

static bool proche(float a, float b, float tolerance) {
  return fabsf(a - b) <= tolerance;
}

// Fabrique une trame comme le ferait un capteur (TPMS.encoderTrame en JS).
static void fabriquerTrame(uint8_t* o, uint8_t numero, const uint8_t* adresse,
                           float pressionBar, float temperatureC, uint8_t pile) {
  Mesure m;
  m.numero = numero;
  memcpy(m.adresse, adresse, TAILLE_ADRESSE);
  m.pressionBar = pressionBar;
  m.temperatureC = temperatureC;
  m.batteriePct = pile;
  m.alarme = 0;
  encoderTrame(&m, o);
}

static const uint8_t ADRESSE_AV[TAILLE_ADRESSE] = {0xEA, 0xCA, 0x3F, 0x1B, 0x07};

// Un seul boîtier de test, réservé une fois pour toutes (≈ 11 Ko) :
// pas d'allocation dynamique, même dans les tests.
static Boitier bt;

// ---------------------------------------------------------------------
static void testsTrames() {
  uint8_t trame[TAILLE_TRAME];
  char hexa[3 * TAILLE_TRAME];
  fabriquerTrame(trame, 1, ADRESSE_AV, 2.1f, 20.5f, 95);

  // 2,1 bar = 210 000 Pa = 0x00033450 → 50 34 03 00
  trameEnHexa(trame + 8, 4, hexa);
  verifier("trame : pression en Pa little-endian", strcmp(hexa, "50 34 03 00") == 0);
  // 20,5 °C = 2050 centièmes = 0x0802 → 02 08 00 00
  trameEnHexa(trame + 12, 4, hexa);
  verifier("trame : temperature en centiemes", strcmp(hexa, "02 08 00 00") == 0);
  verifier("trame : octet capteur 1 = 0x80", trame[2] == 0x80);

  Mesure m;
  char adresse[TAILLE_ADRESSE_TEXTE];
  verifier("decodage : trame acceptee", decoderTrame(trame, TAILLE_TRAME, &m));
  verifier("decodage : pression", proche(m.pressionBar, 2.1f, 1e-6f));
  verifier("decodage : temperature", proche(m.temperatureC, 20.5f, 1e-6f));
  adresseEnTexte(m.adresse, adresse);
  verifier("decodage : adresse", strcmp(adresse, "EA:CA:3F:1B:07") == 0);
  verifier("decodage : numero", m.numero == 1);
  verifier("decodage : pile", m.batteriePct == 95);

  // Température négative : -5,25 °C = -525 = 0xFFFFFDF3 → F3 FD FF FF
  const uint8_t adresse2[TAILLE_ADRESSE] = {0xEA, 0xCA, 0, 0, 1};
  uint8_t froide[TAILLE_TRAME];
  fabriquerTrame(froide, 2, adresse2, 2.0f, -5.25f, 50);
  trameEnHexa(froide + 12, 4, hexa);
  verifier("trame : temperature negative codee", strcmp(hexa, "F3 FD FF FF") == 0);
  decoderTrame(froide, TAILLE_TRAME, &m);
  verifier("decodage : temperature negative", m.temperatureC == -5.25f);
  verifier("decodage : capteur 2", m.numero == 2);

  verifier("decodage : trame trop courte refusee", !decoderTrame(trame, 10, &m));
  trame[0] = 0x4C;
  verifier("decodage : autre fabricant refuse", !decoderTrame(trame, TAILLE_TRAME, &m));
}

// ---------------------------------------------------------------------
static void testsVitesse() {
  Compteur c;
  creerCompteur(&c, 2100);
  for (int i = 0; i < 10; i++) compteurTop(&c, i * 300);
  // 2100 mm en 300 ms = 7 m/s = 25,2 km/h
  verifier("vitesse : 25,2 km/h", proche(compteurVitesseKmh(&c, 2700), 25.2f, 1e-4f));
  verifier("distance : 10 tops = 9 tours = 18,9 m", c.distanceMm == 18900);
  verifier("rebond ignore", compteurTop(&c, 2710) == false);
  verifier("ralentissement : 12,6 km/h", proche(compteurVitesseKmh(&c, 3300), 12.6f, 1e-4f));
  verifier("arret apres 3 s", compteurVitesseKmh(&c, 2700 + 3001) == 0.0f);
  verifier("moyenne : 25,2 km/h", proche(compteurMoyenneKmh(&c), 25.2f, 1e-4f));
  compteurRemiseAZero(&c);
  verifier("remise a zero : distance nulle", c.distanceMm == 0);
  verifier("remise a zero : circonference gardee", c.circonferenceMm == 2100);
}

// ---------------------------------------------------------------------
static void testsFuite() {
  // 20 minutes de mesures, la pression perd 0,3 bar/h, avec du bruit.
  static Historique h;
  creerHistorique(&h);
  for (int32_t s = 0; s <= 1200; s += 30) {
    float bruit = ((s * 7919) % 11 - 5) / 1000.0f;   // bruit fixe de ±0,005 bar
    historiqueAjouter(&h, s * 1000, 2.2f - 0.3f * s / 3600.0f + bruit);
  }
  verifier("fuite : pente = -0,3 bar/h", proche(historiquePenteBarH(&h), -0.3f, 0.03f));

  static Historique stable;
  creerHistorique(&stable);
  for (int32_t t = 0; t <= 1200; t += 30) historiqueAjouter(&stable, t * 1000, 2.2f);
  verifier("pneu stable : pente nulle", proche(historiquePenteBarH(&stable), 0.0f, 1e-4f));

  static Historique court;
  creerHistorique(&court);
  for (int32_t u = 0; u <= 120; u += 30) historiqueAjouter(&court, u * 1000, 2.2f - u / 100.0f);
  verifier("moins de 10 min : pas de conclusion", historiquePenteBarH(&court) == 0.0f);

  historiqueAjouter(&h, 1230 * 1000, 2.5f);
  verifier("regonflage : historique remis a zero", h.n == 1);

  // Prévision : -0,03 bar par jour, un relevé toutes les 12 h pendant 4 jours.
  static Releves r;
  creerReleves(&r);
  for (int k = 0; k <= 8; k++) relevesAjouter(&r, k * 43200000L, 2.2f - 0.03f * k / 2.0f);
  float jours = predireRegonflage(&r, 1.8f);
  verifier("prevision : seuil bas dans 9,3 jours", proche(jours, 9.333f, 0.02f));
  char texte[8];
  texteJours(jours, texte);
  verifier("prevision : texte ecran 9J", strcmp(texte, "9J") == 0);
  texteJours(JOURS_INCONNU, texte);
  verifier("prevision : texte ecran -- sans prevision", strcmp(texte, "--") == 0);
  verifier("prevision : stable -> infini", isinf(joursAvantSeuil(2.2f, 0.0f, 1.8f)));
  relevesAjouter(&r, 5 * 86400000L, 2.5f);
  verifier("prevision : regonflage -> releves effaces", r.n == 1);

  // SHA-256 et HMAC : vecteurs officiels (mêmes résultats qu'en JS)
  uint8_t emp[32];
  char hexa[65];
  sha256((const uint8_t*)"abc", 3, emp);
  enHexa(emp, 32, hexa);
  verifier("sha256 abc", strcmp(hexa, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0);
  const char* long_ = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  sha256((const uint8_t*)long_, strlen(long_), emp);
  enHexa(emp, 32, hexa);
  verifier("sha256 2 blocs", strcmp(hexa, "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1") == 0);
  const char* msg = "what do ya want for nothing?";
  hmacSha256((const uint8_t*)"Jefe", 4, (const uint8_t*)msg, strlen(msg), emp);
  enHexa(emp, 32, hexa);
  verifier("hmac-sha256 RFC 4231", strcmp(hexa, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843") == 0);

  // Journal chaîné
  static JournalSecurise j;
  creerJournalSecurise(&j);
  journalAjouter(&j, 0, "Reveil");
  journalAjouter(&j, 1000, "AV : SIGNAL SUSPECT");
  journalAjouter(&j, 2000, "Mise en veille");
  verifier("journal : chaine intacte", journalVerifier(&j) == -1);
  strcpy(j.lignes[1].texte, "Rien a signaler");
  verifier("journal : ligne modifiee reperee", journalVerifier(&j) == 1);

  // Rythme : rafale d'une vraie crevaison (pression qui baisse) acceptée
  static Rythme ry;
  creerRythme(&ry);
  bool intrusion = false;
  for (int k = 0; k < 10; k++) intrusion = controlerRythme(&ry, k * 1000, 2.2f - 0.25f * k) || intrusion;
  verifier("rythme : rafale de crevaison sans fausse intrusion", !intrusion);
}

// ---------------------------------------------------------------------
static void testsAlertes() {
  Seuils seuils;
  seuilsParDefaut(&seuils);
  static Roue r;
  creerRoue(&r);
  r.aMesure = true;
  r.dernierRecuMs = 0;

  r.mesure.pressionBar = 2.2f;
  verifier("alerte : OK", evaluerRoue(&r, POS_AV, &seuils, 1000, 0) == ETAT_OK);
  r.mesure.pressionBar = 1.5f;
  verifier("alerte : basse", evaluerRoue(&r, POS_AV, &seuils, 1000, 0) == ETAT_BASSE);
  r.mesure.pressionBar = 3.5f;
  verifier("alerte : haute", evaluerRoue(&r, POS_AV, &seuils, 1000, 0) == ETAT_HAUTE);
  r.mesure.pressionBar = 0.2f;
  verifier("alerte : crevaison", evaluerRoue(&r, POS_AV, &seuils, 1000, 0) == ETAT_CREVAISON);
  r.mesure.pressionBar = 2.2f;
  r.penteBarH = -0.3f;
  verifier("alerte : fuite", evaluerRoue(&r, POS_AV, &seuils, 1000, 0) == ETAT_FUITE);
  r.penteBarH = 0.0f;
  r.mesure.pressionBar = 1.9f;
  verifier("alerte : seuil arriere different", evaluerRoue(&r, POS_AR, &seuils, 1000, 0) == ETAT_BASSE);
  r.mesure.pressionBar = 2.2f;
  verifier("alerte : capteur perdu", evaluerRoue(&r, POS_AV, &seuils, 61000, 0) == ETAT_PERDU);
  verifier("alerte : pas perdu juste apres un reveil",
           evaluerRoue(&r, POS_AV, &seuils, 61000, 60000) == ETAT_OK);
  r.aMesure = false;
  verifier("alerte : en attente", evaluerRoue(&r, POS_AV, &seuils, 0, 0) == ETAT_ATTENTE);
}

// ---------------------------------------------------------------------
static void testsBoitier() {
  creerBoitier(&bt);
  uint8_t trameAV[TAILLE_TRAME], trameInconnue[TAILLE_TRAME];
  const uint8_t adresseInconnue[TAILLE_ADRESSE] = {0xEA, 0xCA, 0x00, 0x00, 0x99};
  fabriquerTrame(trameAV, 1, ADRESSE_AV, 1.2f, 18.0f, 90);
  fabriquerTrame(trameInconnue, 1, adresseInconnue, 2.2f, 18.0f, 90);

  verifier("boitier : radio coupee hors fenetre",
           boitierRecevoirTrame(&bt, trameAV, TAILLE_TRAME, 3000) == RESULTAT_RADIO_COUPEE);
  verifier("boitier : capteur inconnu ignore",
           boitierRecevoirTrame(&bt, trameInconnue, TAILLE_TRAME, 1000) == RESULTAT_INCONNUE);
  verifier("boitier : capteur appaire accepte",
           boitierRecevoirTrame(&bt, trameAV, TAILLE_TRAME, 1000) == RESULTAT_ACCEPTEE);

  Sorties s = boitierMiseAJour(&bt, 1000);
  verifier("boitier : AV en pression basse", bt.roues[POS_AV].etat == ETAT_BASSE);
  verifier("boitier : bip demande", s.bip == true);
  verifier("boitier : LED clignote", s.ledAlerte == LED_CLIGNOTE);
  verifier("boitier : premier ecran affiche", s.rafraichissement == RAFRAICHISSEMENT_PARTIEL);

  boitierBouton(&bt, 2, true, 1500);
  s = boitierMiseAJour(&bt, 2000);
  verifier("boitier : alerte acquittee -> LED fixe", s.ledAlerte == LED_FIXE);
  verifier("boitier : pas de bip repete", s.bip == false);
  verifier("boitier : ecran inchange -> pas de rafraichissement",
           s.rafraichissement == RAFRAICHISSEMENT_AUCUN);

  boitierMiseAJour(&bt, 2000 + bt.reglages.delaiVeilleMs);
  verifier("boitier : veille apres 5 min immobile", bt.veille == true);
  boitierTopRoue(&bt, 2000 + bt.reglages.delaiVeilleMs + 1000);
  verifier("boitier : reveil par la roue", bt.veille == false);
}

// ---------------------------------------------------------------------
// Scénario : le vrai capteur annonce 2,2 bar toutes les 3 s, un pirate
// annonce 0,3 bar avec la même identité toutes les secondes.
// Retourne le nombre de fausses trames acceptées.
static int scenarioPirate(bool listeBlanche, bool vraisemblance, bool rythme) {
  creerBoitier(&bt);
  bt.reglages.ecouteFenetreMs = bt.reglages.ecoutePeriodeMs;   // radio toujours allumée
  bt.reglages.protections.listeBlanche = listeBlanche;
  bt.reglages.protections.vraisemblance = vraisemblance;
  bt.reglages.protections.rythme = rythme;
  uint8_t vraie[TAILLE_TRAME], fausse[TAILLE_TRAME];
  fabriquerTrame(vraie, 1, ADRESSE_AV, 2.2f, 20.0f, 90);
  fabriquerTrame(fausse, 1, ADRESSE_AV, 0.3f, 20.0f, 90);
  int faussesAcceptees = 0;
  for (int32_t t = 0; t <= 30000; t += 500) {
    if (t % 3000 == 0) boitierRecevoirTrame(&bt, vraie, TAILLE_TRAME, t);
    if (t % 1000 == 500 &&
        boitierRecevoirTrame(&bt, fausse, TAILLE_TRAME, t) == RESULTAT_ACCEPTEE) faussesAcceptees++;
    if (t % 1000 == 0) boitierMiseAJour(&bt, t);
  }
  return faussesAcceptees;
}

// Le pirate (0,3 bar, une trame par seconde à partir de 30 s) face à
// l'écoute par fenêtres réglée par défaut.
static int scenarioFenetres(int32_t decalageMs) {
  creerBoitier(&bt);
  uint8_t vraie[TAILLE_TRAME], fausse[TAILLE_TRAME];
  fabriquerTrame(vraie, 1, ADRESSE_AV, 2.2f, 20.0f, 90);
  fabriquerTrame(fausse, 1, ADRESSE_AV, 0.3f, 20.0f, 90);
  int faussesAcceptees = 0;
  for (int32_t t = 0; t <= 90000; t += 10) {
    if (t % 3000 == 0) boitierRecevoirTrame(&bt, vraie, TAILLE_TRAME, t);
    if (t >= 30000 && (t - decalageMs) % 1000 == 0 &&
        boitierRecevoirTrame(&bt, fausse, TAILLE_TRAME, t) == RESULTAT_ACCEPTEE) faussesAcceptees++;
    if (t % 1000 == 0) boitierMiseAJour(&bt, t);
  }
  return faussesAcceptees;
}

static void testsSecurite() {
  verifier("sans liste blanche : le capteur n1 devient l'avant", positionParNumero(1) == POS_AV);
  verifier("sans liste blanche : numero inconnu", positionParNumero(7) == POSITION_AUCUNE);

  Mesure ref, m;
  memset(&ref, 0, sizeof(ref));
  ref.pressionBar = 2.2f;
  ref.temperatureC = 20.0f;
  m = ref;
  Verification v;
  creerVerification(&v);
  m.pressionBar = 2.1f;
  verifier("vraisemblance : petite baisse acceptee", verifierVraisemblance(&v, &ref, 0, &m, 3000, true) == VERDICT_OK);
  m.pressionBar = 0.3f;
  verifier("vraisemblance : chute brutale suspecte", verifierVraisemblance(&v, &ref, 0, &m, 1000, true) == VERDICT_SUSPECTE);
  m.pressionBar = 0.32f;
  verifier("vraisemblance : 2e trame encore suspecte", verifierVraisemblance(&v, &ref, 0, &m, 1500, true) == VERDICT_SUSPECTE);
  m.pressionBar = 0.31f;
  verifier("vraisemblance : confirmee par la 3e trame", verifierVraisemblance(&v, &ref, 0, &m, 2000, true) == VERDICT_CONFIRMEE);

  Verification v2;
  creerVerification(&v2);
  m.pressionBar = 0.3f; verifierVraisemblance(&v2, &ref, 0, &m, 1000, true);
  m.pressionBar = 1.0f; verifierVraisemblance(&v2, &ref, 0, &m, 1500, true);   // autre valeur : on recommence
  m.pressionBar = 0.3f;
  verifier("vraisemblance : valeurs contradictoires jamais confirmees",
           verifierVraisemblance(&v2, &ref, 0, &m, 2000, true) == VERDICT_SUSPECTE);

  creerVerification(&v);
  m.pressionBar = 9.0f;
  verifier("vraisemblance : hors limites", verifierVraisemblance(&v, &ref, 0, &m, 3000, true) == VERDICT_HORS_LIMITES);
  creerVerification(&v);
  m.pressionBar = 3.0f;
  verifier("vraisemblance : grand ecart apres 1 h accepte", verifierVraisemblance(&v, &ref, 0, &m, 3600000, true) == VERDICT_OK);

  Rythme normal;
  creerRythme(&normal);
  bool alerte = false;
  for (int32_t t = 0; t <= 60000; t += 3000) alerte = controlerRythme(&normal, t) || alerte;
  verifier("rythme : un capteur toutes les 3 s -> pas d'alerte", alerte == false);

  Rythme double_;
  creerRythme(&double_);
  bool d0 = controlerRythme(&double_, 0);
  bool d1 = controlerRythme(&double_, 1000);
  bool d2 = controlerRythme(&double_, 2000);
  bool d3 = controlerRythme(&double_, 3000);
  verifier("rythme : 3 trames trop rapprochees -> intrusion", !d0 && !d1 && !d2 && d3);

  verifier("pirate sans protection : fausses trames acceptees", scenarioPirate(true, false, false) > 0);
  verifier("pirate + vraisemblance seule : le pirate rapide finit par passer",
           scenarioPirate(true, true, false) > 0);
  int fausses = scenarioPirate(true, true, true);
  verifier("pirate + toutes protections : SIGNAL SUSPECT", bt.roues[POS_AV].etat == ETAT_INTRUSION);
  verifier("pirate + toutes protections : fausse pression jamais acceptee", fausses == 0);
  verifier("pirate + toutes protections : derniere valeur de confiance gardee",
           proche(bt.roues[POS_AV].mesure.pressionBar, 2.2f, 1e-6f));
  VueRoue vueAV;
  vueRoue(&bt.roues[POS_AV], bt.reglages.seuils.roue[POS_AV].basBar, &vueAV);
  verifier("signal suspect : pression non affichee (-.--)", vueAV.connue == false);

  // En cas de doute sur l'émetteur, la 3e trame concordante ne confirme pas.
  creerVerification(&v);
  m.pressionBar = 0.3f;
  verifierVraisemblance(&v, &ref, 0, &m, 1000, false);
  verifierVraisemblance(&v, &ref, 0, &m, 1500, false);
  verifier("vraisemblance : pas de confirmation en cas de doute",
           verifierVraisemblance(&v, &ref, 0, &m, 2000, false) == VERDICT_SUSPECTE);

  // Même attaque, mais avec l'écoute par fenêtres du boîtier (2 s toutes
  // les 5 s) et le pirate décalé par rapport au vrai capteur.
  // Le JS essaie 30 décalages (pas de 100 ms) ; ici 10 (pas de 300 ms),
  // pour que les tests ne durent pas trop longtemps sur la carte.
  int decalagesTrompes = 0;
  for (int32_t d = 0; d < 3000; d += 300) {
    if (scenarioFenetres(d) > 0) decalagesTrompes++;
  }
  verifier("pirate + ecoute par fenetres : aucun decalage ne trompe le boitier", decalagesTrompes == 0);

  // Un vrai regonflage (1,2 → 2,2 bar d'un coup) finit par être accepté.
  creerBoitier(&bt);
  bt.reglages.ecouteFenetreMs = bt.reglages.ecoutePeriodeMs;
  uint8_t basse[TAILLE_TRAME], haute[TAILLE_TRAME];
  fabriquerTrame(basse, 1, ADRESSE_AV, 1.2f, 20.0f, 90);
  fabriquerTrame(haute, 1, ADRESSE_AV, 2.2f, 20.0f, 90);
  boitierRecevoirTrame(&bt, basse, TAILLE_TRAME, 0);
  Resultat r1 = boitierRecevoirTrame(&bt, haute, TAILLE_TRAME, 3000);
  boitierRecevoirTrame(&bt, haute, TAILLE_TRAME, 6000);
  Resultat r3 = boitierRecevoirTrame(&bt, haute, TAILLE_TRAME, 9000);
  verifier("regonflage reel : suspect puis accepte", r1 == RESULTAT_SUSPECTE && r3 == RESULTAT_ACCEPTEE);
}

// ---------------------------------------------------------------------
static void testsProtocole() {
  MesuresApp mesures;
  memset(&mesures, 0, sizeof(mesures));
  mesures.roues[POS_AV].connue = true;
  mesures.roues[POS_AV].pressionBar = 2.15f;
  mesures.roues[POS_AV].temperatureC = -3.0f;
  mesures.roues[POS_AV].batteriePct = 80;
  mesures.roues[POS_AV].etat = ETAT_BASSE;
  mesures.roues[POS_AR].connue = false;
  mesures.roues[POS_AR].etat = ETAT_ATTENTE;
  mesures.vitesseKmh = 23.4f;
  mesures.distanceKm = 12.345f;
  mesures.batterieBoitierPct = 76.0f;
  mesures.enCharge = true;
  mesures.eclairage = true;
  mesures.sequence = 65535;
  uint8_t o[TAILLE_MESURES];
  encoderMesures(&mesures, o);
  verifier("MESURES : pression en mbar", lireUint16LE(o, 0) == 2150);
  verifier("MESURES : temperature negative", (int8_t)o[4] == -3);
  verifier("MESURES : pression inconnue", lireUint16LE(o, 2) == PRESSION_INCONNUE);
  verifier("MESURES : etat", o[8] == 4 && o[9] == 0);   // BASSE = 4, ATTENTE = 0 (CODES_ETAT)
  verifier("MESURES : vitesse et distance", lireUint16LE(o, 10) == 234 && lireInt32LE(o, 12) == 12345);
  verifier("MESURES : drapeaux", o[17] == 6);
  verifier("MESURES : sequence sur 1 octet, pas de correction d'altitude", o[18] == 0xFF && o[19] == 0);

  creerBoitier(&bt);
  uint8_t octets[TAILLE_REGLAGES];
  encoderReglages(&bt.reglages, octets);
  Reglages r;
  memset(&r, 0, sizeof(r));
  verifier("REGLAGES : decodage", decoderReglages(octets, TAILLE_REGLAGES, &r));
  verifier("REGLAGES : aller-retour circonference", r.circonferenceMm == 2105);
  verifier("REGLAGES : aller-retour seuils",
           r.seuils.roue[POS_AR].basBar == 2.0f && proche(r.seuils.roue[POS_AV].hautBar, 3.2f, 1e-6f));
  char adresse[TAILLE_ADRESSE_TEXTE];
  adresseEnTexte(r.appairage.adresse[POS_AV], adresse);
  verifier("REGLAGES : aller-retour appairage", strcmp(adresse, "EA:CA:3F:1B:07") == 0);
  verifier("REGLAGES : aller-retour protections", r.protections.rythme == true);
  r.seuils.roue[POS_AV].basBar = 4.0f;
  verifier("REGLAGES : seuil bas > seuil haut refuse", verifierReglages(&r)[0] != '\0');

  uint8_t uuid[16];
  verifier("UUID : texte -> octets a l'envers",
           uuidDepuisTexte(UUID_SERVICE, uuid) && uuid[0] == 0x7D && uuid[15] == 0x6E && uuid[12] == 0x01);
}

// ---------------------------------------------------------------------
static void testsLiaison() {
  creerBoitier(&bt);
  uint8_t reglages[TAILLE_REGLAGES];
  encoderReglages(&bt.reglages, reglages);
  verifier("liaison : reglages refuses sans appairage",
           strcmp(liaisonEcrireReglages(&bt, reglages, TAILLE_REGLAGES, 0), "refuse") == 0);
  verifier("liaison : code demande par la pile BLE", liaisonDemandeCode(&bt, "123456", 0));
  Vue vue;
  boitierVue(&bt, 0, &vue);
  verifier("liaison : code affiche a l'ecran", strcmp(vue.codeAppairage, "123456") == 0);
  verifier("liaison : mauvais code -> pas encore bloque", liaisonEchecAppairage(&bt, 0) == false);
  liaisonDemandeCode(&bt, "654321", 0);
  liaisonSecurisee(&bt, 0);
  uint8_t mesures[TAILLE_MESURES];
  verifier("liaison : mesures disponibles", liaisonMesures(&bt, 0, mesures));

  Reglages r = bt.reglages;
  r.circonferenceMm = 2288;
  encoderReglages(&r, reglages);
  verifier("liaison : reglages acceptes une fois appaire",
           strcmp(liaisonEcrireReglages(&bt, reglages, TAILLE_REGLAGES, 0), "ok") == 0);
  verifier("liaison : circonference appliquee au compteur", bt.compteur.circonferenceMm == 2288);

  liaisonDeconnexion(&bt, 0);
  verifier("liaison : deconnecte -> commandes refusees",
           strcmp(liaisonCommande(&bt, COMMANDE_RAZ_TRAJET, 0), "refuse") == 0);

  creerBoitier(&bt);
  liaisonDemandeCode(&bt, "111111", 0);
  liaisonEchecAppairage(&bt, 0);
  liaisonDemandeCode(&bt, "222222", 0);
  liaisonEchecAppairage(&bt, 0);
  liaisonDemandeCode(&bt, "333333", 0);
  verifier("liaison : 3 codes faux -> bloque", liaisonEchecAppairage(&bt, 0) == true);
  verifier("liaison : toujours bloque 30 s apres", liaisonDemandeCode(&bt, "444444", 30000) == false);
}

// ---------------------------------------------------------------------
// Confirmation par bouton des changements sensibles
// ---------------------------------------------------------------------
// Un boîtier appairé, et une demande de l'app qui coupe la liste blanche.
static const char* demanderSansListeBlanche(int32_t maintenantMs) {
  uint8_t reglages[TAILLE_REGLAGES];
  Reglages r = bt.reglages;
  r.protections.listeBlanche = false;
  encoderReglages(&r, reglages);
  return liaisonEcrireReglages(&bt, reglages, TAILLE_REGLAGES, maintenantMs);
}

static void testsConfirmation() {
  const char* resultat;
  Reglages ancien, nouveau;
  creerBoitier(&bt);
  ancien = bt.reglages;
  nouveau = ancien;
  nouveau.seuils.roue[POS_AV].basBar = 1.5f;
  verifier("sensible : seuil change -> rien de sensible", changementSensible(&ancien, &nouveau) == 0);
  nouveau.protections.rythme = false;
  nouveau.appairage.adresse[POS_AR][4] = 0x55;
  verifier("sensible : rythme coupe + capteur AR change",
           changementSensible(&ancien, &nouveau) == (SENSIBLE_SANS_RYTHME | SENSIBLE_CAPTEUR_AR));

  liaisonDemandeCode(&bt, "123456", 0);
  liaisonSecurisee(&bt, 0);
  resultat = demanderSansListeBlanche(1000);
  verifier("confirmation : liste blanche coupee -> attente du bouton",
           strcmp(resultat, "attente-bouton") == 0 && bt.reglages.protections.listeBlanche);
  Vue vue;
  boitierVue(&bt, 1000, &vue);
  verifier("confirmation : demande affichee a l'ecran", vue.confirmation == SENSIBLE_SANS_LISTE_BLANCHE);
  uint8_t mesures[TAILLE_MESURES];
  liaisonMesures(&bt, 1000, mesures);
  verifier("confirmation : drapeau d'attente dans MESURES", (mesures[17] & 8) != 0);
  liaisonCommande(&bt, COMMANDE_ACQUITTER, 2000);
  verifier("confirmation : la commande ACQUITTER de l'app ne confirme pas",
           bt.reglages.protections.listeBlanche && bt.liaison.enAttente);
  boitierBouton(&bt, 2, true, 3000);
  verifier("confirmation : appui long bouton 2 -> applique",
           !bt.reglages.protections.listeBlanche && !bt.liaison.enAttente && bt.liaison.reglagesChanges);

  creerBoitier(&bt);
  liaisonDemandeCode(&bt, "123456", 0);
  liaisonSecurisee(&bt, 0);
  demanderSansListeBlanche(0);
  boitierBouton(&bt, 1, false, 1000);
  verifier("confirmation : autre bouton -> refuse",
           bt.reglages.protections.listeBlanche && !bt.liaison.enAttente && bt.page == 0);

  demanderSansListeBlanche(2000);
  boitierMiseAJour(&bt, 31000);
  verifier("confirmation : toujours en attente a 29 s", bt.liaison.enAttente);
  boitierMiseAJour(&bt, 33000);
  verifier("confirmation : abandon apres 30 s",
           !bt.liaison.enAttente && bt.reglages.protections.listeBlanche);

  demanderSansListeBlanche(40000);
  liaisonDeconnexion(&bt, 41000);
  verifier("confirmation : deconnexion -> abandon", !bt.liaison.enAttente);
}

// ---------------------------------------------------------------------
// Baromètre : correction d'altitude, recharge par grand froid, boutons
// ---------------------------------------------------------------------
static void testsBarometre() {
  verifier("altitude : 846 hPa -> +0,167 bar", proche(correctionAltitudeBar(true, 846.0f), 0.16725f, 1e-5f));
  verifier("altitude : mesure absente ou hors plage -> 0",
           correctionAltitudeBar(false, 846.0f) == 0.0f && correctionAltitudeBar(true, 200.0f) == 0.0f);
  verifier("altitude : pneu vide reste a 0", pressionCorrigeeBar(0.0f, 0.167f) == 0.0f);
  verifier("recharge : 1 C -> FROID, 3 C -> permise",
           blocageCharge(BLOCAGE_AUCUN, true, 1.0f) == BLOCAGE_FROID && blocageCharge(BLOCAGE_AUCUN, true, 3.0f) == BLOCAGE_AUCUN);
  verifier("recharge : hysteresis (FROID garde a 4 C, permise a 5,5 C)",
           blocageCharge(BLOCAGE_FROID, true, 4.0f) == BLOCAGE_FROID && blocageCharge(BLOCAGE_FROID, true, 5.5f) == BLOCAGE_AUCUN);
  verifier("recharge : 44 C -> CHAUD ; sans mesure -> jamais coupee",
           blocageCharge(BLOCAGE_AUCUN, true, 44.0f) == BLOCAGE_CHAUD && blocageCharge(BLOCAGE_FROID, false, 0.0f) == BLOCAGE_AUCUN);
  verifier("ecran sans BUSY : attente plus longue au froid",
           attenteEcranMs(true, true, 20.0f) == 2500 && attenteEcranMs(true, true, 5.0f) == 3750 &&
           attenteEcranMs(false, true, -5.0f) == 1200 && attenteEcranMs(false, false, 0.0f) == 1200);

  // Boîtier en altitude : affichage et alertes corrigés, historique du capteur.
  creerBoitier(&bt);
  boitierBarometre(&bt, true, 846.0f, 12.0f, 0);
  uint8_t trame[TAILLE_TRAME];
  fabriquerTrame(trame, 1, bt.reglages.appairage.adresse[POS_AV], 1.70f, 12.0f, 90);
  boitierRecevoirTrame(&bt, trame, TAILLE_TRAME, 1000);
  boitierMiseAJour(&bt, 2000);
  verifier("altitude : pression affichee corrigee (1,70 -> 1,87 bar)",
           proche(bt.roues[POS_AV].pressionAffichee, 1.86725f, 1e-3f));
  verifier("altitude : pas d'alerte basse (1,87 reels > seuil 1,8)", bt.roues[POS_AV].etat == ETAT_OK);
  liaisonDemandeCode(&bt, "123456", 2000);
  liaisonSecurisee(&bt, 2000);
  uint8_t mesures[TAILLE_MESURES];
  liaisonMesures(&bt, 2000, mesures);
  verifier("altitude : correction envoyee a l'app (octet 19 = 42 pas de 4 mbar)", mesures[19] == 42);
  boitierBarometre(&bt, false, 0.0f, 0.0f, 12000);
  verifier("barometre muet : plus de correction", bt.correctionBar == 0.0f && bt.baroEnPanne);

  // Grand froid : D6 coupe la recharge, sauf en veille.
  creerBoitier(&bt);
  boitierBarometre(&bt, true, 1000.0f, -2.0f, 0);
  verifier("grand froid : recharge coupee", boitierMiseAJour(&bt, 1000).coupureCharge);
  Vue vue;
  boitierVue(&bt, 1000, &vue);
  verifier("grand froid : FROID a l'ecran", strcmp(vue.blocageCharge, "FROID") == 0);
  boitierMiseAJour(&bt, bt.reglages.delaiVeilleMs + 2000);
  verifier("grand froid : coupure relachee en veille",
           bt.veille && !boitierMiseAJour(&bt, bt.reglages.delaiVeilleMs + 3000).coupureCharge);
  boitierChargeurBranche(&bt, bt.reglages.delaiVeilleMs + 4000);
  bt.reglages.ecouteFenetreMs = bt.reglages.ecoutePeriodeMs;   // écoute permanente, pour le test
  verifier("grand froid : reveil par le 5 V, recoupe, radio coupee",
           !bt.veille && boitierMiseAJour(&bt, bt.reglages.delaiVeilleMs + 5000).coupureCharge &&
           !boitierEcoute(&bt, bt.reglages.delaiVeilleMs + 5000));

  // Deux boutons sur D5 (tirage 11 à 16 kΩ, R12 = 2,2 kΩ).
  verifier("boutons : aucun, SW1, SW2 (tirages extremes)",
           boutonDepuisTension(3.3f, 3.3f) == 0 && boutonDepuisTension(0.02f, 3.3f) == 1 &&
           boutonDepuisTension(3.3f * 2200.0f / 13200.0f, 3.3f) == 2 &&
           boutonDepuisTension(3.3f * 2200.0f / 18200.0f, 3.3f) == 2);
}

// ---------------------------------------------------------------------
static void testsEcran() {
  static Ecran e;
  creerEcran(&e);
  ecranTexte(&e, 0, 0, "A", 1, NOIR);
  // Colonne 0 du "A" = 0x7E : ligne 0 éteinte, lignes 1 à 6 allumées
  verifier("ecran : pixel (0,0) du A blanc", ecranLirePixel(&e, 0, 0) == BLANC);
  verifier("ecran : pixel (0,1) du A noir", ecranLirePixel(&e, 0, 1) == NOIR);
  verifier("ecran : largeur de \"2.10\" taille 4 = 80 px", largeurTexte("2.10", 4) == 80);
  ecranPixel(&e, 500, 500, NOIR);   // ne doit pas planter
  verifier("ecran : pixel hors ecran ignore", true);
  char texte[16];
  dureeEnTexte(4965, texte);
  verifier("duree en texte", strcmp(texte, "1:22:45") == 0);
  nombreEnTexte(2.1f, 2, texte);
  verifier("toFixed : 2.1 -> \"2.10\"", strcmp(texte, "2.10") == 0);
  nombreEnTexte(23.45f, 1, texte);
  verifier("toFixed : 23.45 -> \"23.5\" ou \"23.4\" (arrondi float)",
           strcmp(texte, "23.5") == 0 || strcmp(texte, "23.4") == 0);
}

// ---------------------------------------------------------------------
int lancerTestsLogique(void (*afficher)(const char* ligne)) {
  sortie = afficher;
  reussis = 0;
  rates = 0;
  testsTrames();
  testsVitesse();
  testsFuite();
  testsAlertes();
  testsBoitier();
  testsSecurite();
  testsProtocole();
  testsLiaison();
  testsConfirmation();
  testsBarometre();
  testsEcran();
  char bilan[64];
  snprintf(bilan, sizeof(bilan), "%d reussis, %d en echec", reussis, rates);
  if (sortie != 0) sortie(bilan);
  return rates;
}
