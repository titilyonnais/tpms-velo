// =====================================================================
// boitier.cpp — Le « cerveau » du boîtier de guidon
// ---------------------------------------------------------------------
// Traduction en C++ de : simulateur/boitier/boitier.js
// LOGIQUE PURE : aucun appel Arduino.
// =====================================================================
#include "boitier.h"
#include "ecran.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

void creerRoue(Roue* roue) {
  roue->aMesure = false;
  memset(&roue->mesure, 0, sizeof(roue->mesure));
  roue->pressionAfficheeConnue = false;
  roue->pressionAffichee = 0.0f;
  roue->dernierRecuMs = -1;
  roue->nbTrames = 0;
  creerHistorique(&roue->historique);
  creerReleves(&roue->releves);
  roue->penteBarH = 0.0f;
  roue->etat = ETAT_ATTENTE;
  roue->acquittee = false;
  creerVerification(&roue->verification);
  creerRythme(&roue->rythme);
  roue->intrusionJusquaMs = -1;
  roue->compteurConnu = false;
  roue->dernierCompteur = 0;
  roue->dernierRefusJournalMs = -1000000;
}

void creerBoitier(Boitier* b) {
  // On commence par tout mettre à zéro (compteurs de stats, etc.).
  memset(b, 0, sizeof(Boitier));

  uint16_t circonference = 2105;   // 700×25C, valeur par défaut
  Reglages* r = &b->reglages;
  // À VÉRIFIER : adresses du simulateur. Remplacer par celles des vrais
  // capteurs (affichées en MODE_DECOUVERTE), ou les régler depuis l'app.
  adresseDepuisTexte("EA:CA:3F:1B:07", r->appairage.adresse[POS_AV]);
  adresseDepuisTexte("EA:CA:3F:1B:08", r->appairage.adresse[POS_AR]);
  protectionsParDefaut(&r->protections);
  seuilsParDefaut(&r->seuils);
  r->circonferenceMm = circonference;
  r->ecoutePeriodeMs = 5000;      // la radio s'allume toutes les 5 s...
  r->ecouteFenetreMs = 3000;      // ... et écoute pendant 3 s (60 % du temps)
  r->delaiVeilleMs = 5L * 60000;  // veille après 5 min sans rouler
  r->periodeEcranMs = 2000;       // en roulant, au plus un rafraîchissement toutes les 2 s

  creerRoue(&b->roues[POS_AV]);
  creerRoue(&b->roues[POS_AR]);
  creerCompteur(&b->compteur, circonference);
  b->page = 0;
  b->eclairage = false;
  b->veille = false;
  b->dernierMouvementMs = 0;
  b->ecouteDepuisMs = 0;
  b->ecouteContinueJusquaMs = -1;
  b->batteriePct = 100.0f;
  b->enCharge = false;
  b->bipDemande = false;
  creerEcran(&b->ecran);
  creerEcran(&b->ecranAffiche);
  b->partielsDepuisComplet = 0;
  b->dernierDessinMs = -1000000;
  b->ecranUrgent = true;
  creerLiaison(&b->liaison);
  b->journal = 0;
  r->capteursV2 = false;
  b->inconnuesSeconde = 0;
  b->secondesSaturees = 0;
  b->secondesCalmes = 0;
  b->radioSaturee = false;
  creerJournalSecurise(&b->journalSecurise);
}

void boitierJournal(Boitier* b, int32_t maintenantMs, const char* texte) {
  if (b->journal != 0) b->journal(maintenantMs, texte);
  journalAjouter(&b->journalSecurise, maintenantMs, texte);   // copie chaînée
}

// Inondation : plus de 50 annonces inconnues/s pendant 5 s → radio saturée
// (information seulement, pas de bip). Appelée une fois par seconde.
static void surveillerSaturation(Boitier* b, int32_t maintenantMs) {
  char texte[96];
  int n = b->inconnuesSeconde;
  b->inconnuesSeconde = 0;
  if (n > SEUIL_INONDATION_PAR_S) {
    b->secondesSaturees++;
    b->secondesCalmes = 0;
    if (!b->radioSaturee && b->secondesSaturees >= DUREE_INONDATION_S) {
      b->radioSaturee = true;
      b->ecranUrgent = true;
      snprintf(texte, sizeof(texte), "Radio saturée : %d annonces inconnues par seconde (inondation ?)", n);
      boitierJournal(b, maintenantMs, texte);
    }
  } else {
    b->secondesSaturees = 0;
    if (b->radioSaturee && ++b->secondesCalmes >= DUREE_RETOUR_CALME_S) {
      b->radioSaturee = false;
      b->ecranUrgent = true;
      boitierJournal(b, maintenantMs, "Radio redevenue normale");
    }
  }
}

// Journal d'un refus, au plus une fois par minute et par roue.
static void journalRefus(Boitier* b, Roue* roue, int32_t maintenantMs, const char* texte) {
  if (maintenantMs - roue->dernierRefusJournalMs < 60000) return;
  roue->dernierRefusJournalMs = maintenantMs;
  boitierJournal(b, maintenantMs, texte);
}

const char* texteResultat(Resultat r) {
  switch (r) {
    case RESULTAT_ACCEPTEE:     return "acceptee";
    case RESULTAT_RADIO_COUPEE: return "radio-coupee";
    case RESULTAT_INVALIDE:     return "invalide";
    case RESULTAT_INCONNUE:     return "inconnue";
    case RESULTAT_INTRUSION:    return "intrusion";
    case RESULTAT_HORS_LIMITES: return "hors-limites";
    case RESULTAT_SIGNATURE_FAUSSE: return "signature-fausse";
    case RESULTAT_REJEU:        return "rejeu";
    default:                    return "suspecte";
  }
}

// Mélange un entier (même calcul que TPMS.melangerEntier en JS).
static uint32_t melangerEntier(uint32_t x) {
  x = (x ^ (x >> 16)) * 0x45d9f3bu;
  x = (x ^ (x >> 16)) * 0x45d9f3bu;
  return x ^ (x >> 16);
}

// Fenêtre d'écoute à position pseudo-aléatoire dans chaque période :
// évite le verrouillage de phase avec un capteur qui annonce toutes les
// 60 s (multiple de la période), révélé par la simulation.
bool boitierEcoute(const Boitier* b, int32_t maintenantMs) {
  if (b->veille) return false;
  if (maintenantMs < b->ecouteContinueJusquaMs) return true;   // écoute renforcée
  int32_t periode = b->reglages.ecoutePeriodeMs, fenetre = b->reglages.ecouteFenetreMs;
  if (fenetre >= periode) return true;
  int32_t cycle = maintenantMs / periode;
  int32_t decalage = (int32_t)(melangerEntier((uint32_t)cycle) % (uint32_t)(periode - fenetre));
  int32_t dansCycle = maintenantMs - cycle * periode;
  return dansCycle >= decalage && dansCycle < decalage + fenetre;
}

// Écoute renforcée : après une trame douteuse (changement brutal à
// confirmer, deux émetteurs), radio allumée en continu pendant
// ECOUTE_RENFORCEE_MS pour ne manquer aucune trame de confirmation.
static const int32_t ECOUTE_RENFORCEE_MS = 15000;

void boitierEcouteRenforcee(Boitier* b, int32_t maintenantMs) {
  int32_t fin = maintenantMs + ECOUTE_RENFORCEE_MS;
  if (fin > b->ecouteContinueJusquaMs) b->ecouteContinueJusquaMs = fin;
}

Resultat boitierRecevoirTrame(Boitier* b, const uint8_t* octets, int longueur, int32_t maintenantMs) {
  const Protections* protections = &b->reglages.protections;
  char texte[96];

  // Une trame reçue alors que la fenêtre d'écoute est fermée (la radio
  // vient juste d'être coupée) est comptée comme manquée, comme dans le
  // simulateur.
  if (!boitierEcoute(b, maintenantMs)) {
    b->stats.tramesManquees++;
    return RESULTAT_RADIO_COUPEE;
  }

  Mesure mesure;
  Position position = POSITION_AUCUNE;
  bool authentifiee = false;
  if (b->reglages.capteursV2) {
    // Capteurs v2 : seules les trames signées par NOS capteurs comptent.
    MesureV2 v2;
    if (decoderTrameV2(octets, longueur, &v2)) {
      if (adresseResolue(b->reglages.clesV2[POS_AV], v2.mesure.adresse)) position = POS_AV;
      else if (adresseResolue(b->reglages.clesV2[POS_AR], v2.mesure.adresse)) position = POS_AR;
    }
    if (position == POSITION_AUCUNE) {
      b->stats.tramesInconnues++;
      b->inconnuesSeconde++;
      return RESULTAT_INCONNUE;
    }
    Roue* r2 = &b->roues[position];
    if (!signatureValide(b->reglages.clesV2[position], octets)) {
      b->stats.signaturesFausses++;
      snprintf(texte, sizeof(texte), "%s : trame mal signée refusée (usurpation ?)", NOM_POSITION[position]);
      journalRefus(b, r2, maintenantMs, texte);
      return RESULTAT_SIGNATURE_FAUSSE;
    }
    if (r2->compteurConnu && v2.compteur <= r2->dernierCompteur) {
      b->stats.rejeux++;
      snprintf(texte, sizeof(texte), "%s : trame rejouée refusée (compteur déjà vu)", NOM_POSITION[position]);
      journalRefus(b, r2, maintenantMs, texte);
      return RESULTAT_REJEU;
    }
    r2->compteurConnu = true;
    r2->dernierCompteur = v2.compteur;
    mesure = v2.mesure;
    authentifiee = true;   // signée par notre capteur : pas besoin du contrôle du rythme
  } else {
    if (!decoderTrame(octets, longueur, &mesure)) {
      b->stats.tramesInvalides++;
      b->inconnuesSeconde++;
      return RESULTAT_INVALIDE;
    }
    // 1. De quelle roue s'agit-il ?
    position = protections->listeBlanche
      ? positionCapteur(&b->reglages.appairage, mesure.adresse)
      : positionParNumero(mesure.numero);
    if (position == POSITION_AUCUNE) {
      b->stats.tramesInconnues++;
      b->inconnuesSeconde++;
      return RESULTAT_INCONNUE;
    }
  }
  Roue* roue = &b->roues[position];

  // 2. Rythme : deux émetteurs avec la même identité ?
  if (protections->rythme && !authentifiee) {
    if (controlerRythme(&roue->rythme, maintenantMs, mesure.pressionBar)) {
      if (roue->intrusionJusquaMs <= maintenantMs) {
        b->stats.intrusions++;
        snprintf(texte, sizeof(texte), "%s : trames trop rapprochées, deux émetteurs → SIGNAL SUSPECT",
                 NOM_POSITION[position]);
        boitierJournal(b, maintenantMs, texte);
      }
      roue->intrusionJusquaMs = maintenantMs + QUARANTAINE_MS;
      boitierEcouteRenforcee(b, maintenantMs);
    }
    // Pendant le signal suspect, on garde la dernière valeur de confiance.
    if (roue->intrusionJusquaMs > maintenantMs) {
      b->stats.rejetsRythme++;
      return RESULTAT_INTRUSION;
    }
  }

  // 3. Vraisemblance : la nouvelle valeur est-elle physiquement possible ?
  if (protections->vraisemblance) {
    // Si le contrôle du rythme a déjà un doute sur cet émetteur, aucun
    // changement brutal ne peut être confirmé.
    bool doute = protections->rythme && rythmeDouteux(&roue->rythme);
    Verdict verdict = verifierVraisemblance(&roue->verification,
      roue->aMesure ? &roue->mesure : 0,        // en JS : roue.mesure (ou null)
      roue->dernierRecuMs, &mesure, maintenantMs, !doute);
    if (verdict == VERDICT_HORS_LIMITES) {
      b->stats.rejetsVraisemblance++;
      return RESULTAT_HORS_LIMITES;
    }
    if (verdict == VERDICT_SUSPECTE) {
      boitierEcouteRenforcee(b, maintenantMs);
      b->stats.rejetsVraisemblance++;
      return RESULTAT_SUSPECTE;
    }
    if (verdict == VERDICT_CONFIRMEE) {
      snprintf(texte, sizeof(texte), "%s : changement brutal confirmé par %d trames",
               NOM_POSITION[position], (int)CONFIRMATIONS);
      boitierJournal(b, maintenantMs, texte);
    }
  }

  roue->mesure = mesure;
  roue->aMesure = true;
  if (!roue->pressionAfficheeConnue ||
      fabsf(mesure.pressionBar - roue->pressionAffichee) >= HYSTERESIS_AFFICHAGE_BAR) {
    roue->pressionAffichee = mesure.pressionBar;
    roue->pressionAfficheeConnue = true;
  }
  roue->dernierRecuMs = maintenantMs;
  roue->nbTrames++;
  float compensee = pressionCompenseeBar(mesure.pressionBar, mesure.temperatureC);
  historiqueAjouter(&roue->historique, maintenantMs, compensee);
  relevesAjouter(&roue->releves, maintenantMs, compensee);
  roue->penteBarH = historiquePenteBarH(&roue->historique);
  b->stats.tramesAcceptees++;
  return RESULTAT_ACCEPTEE;
}

void boitierReveiller(Boitier* b, int32_t maintenantMs, const char* raison) {
  if (!b->veille) return;
  b->veille = false;
  b->ecouteDepuisMs = maintenantMs;
  b->ecranUrgent = true;
  char texte[64];
  snprintf(texte, sizeof(texte), "Réveil (%s)", raison);
  boitierJournal(b, maintenantMs, texte);
}

bool boitierTopRoue(Boitier* b, int32_t maintenantMs) {
  bool accepte = compteurTop(&b->compteur, maintenantMs);
  if (accepte) {
    b->dernierMouvementMs = maintenantMs;
    boitierReveiller(b, maintenantMs, "la roue tourne");
  }
  return accepte;
}

void boitierBouton(Boitier* b, int numero, bool appuiLong, int32_t maintenantMs) {
  b->dernierMouvementMs = maintenantMs;
  b->ecranUrgent = true;
  if (b->veille) {
    char raison[16];
    snprintf(raison, sizeof(raison), "bouton %d", numero);
    boitierReveiller(b, maintenantMs, raison);
    return;
  }
  if (numero == 1 && !appuiLong) {
    b->page = (b->page + 1) % 2;
  } else if (numero == 1 && appuiLong) {
    compteurRemiseAZero(&b->compteur);
    boitierJournal(b, maintenantMs, "Trajet remis à zéro");
  } else if (numero == 2 && !appuiLong) {
    b->eclairage = !b->eclairage;
  } else if (numero == 2 && appuiLong) {
    for (int i = 0; i < NB_ROUES; i++) {
      Roue* roue = &b->roues[i];
      if (estAlerte(roue->etat) && !roue->acquittee) {
        roue->acquittee = true;
        char texte[48];
        snprintf(texte, sizeof(texte), "%s : alerte acquittée", NOM_POSITION[i]);
        boitierJournal(b, maintenantMs, texte);
      }
    }
  }
}

void boitierVue(const Boitier* b, int32_t maintenantMs, Vue* vue) {
  const Compteur* c = &b->compteur;
  vue->page = b->page;
  vue->veille = b->veille;
  vue->eclairage = b->eclairage && !b->veille;
  vue->enCharge = b->enCharge;
  vue->batterieBoitierPct = b->batteriePct;
  vue->appConnectee = b->liaison.connecte;
  vue->radioSaturee = b->radioSaturee;
  strcpy(vue->codeAppairage, b->liaison.code);
  vueRoue(&b->roues[POS_AV], b->reglages.seuils.roue[POS_AV].basBar, &vue->roues[POS_AV]);
  vueRoue(&b->roues[POS_AR], b->reglages.seuils.roue[POS_AR].basBar, &vue->roues[POS_AR]);
  vue->vitesseKmh = b->veille ? 0.0f : compteurVitesseKmh(c, maintenantMs);
  vue->distanceKm = compteurDistanceKm(c);
  vue->moyenneKmh = compteurMoyenneKmh(c);
  vue->maxKmh = c->vitesseMaxKmh;
  vue->dureeRoulageS = c->tempsRoulageMs / 1000.0f;
}

void vueRoue(const Roue* roue, float seuilBasBar, VueRoue* vue) {
  vue->etat = roue->etat;
  // Signal suspect : la dernière valeur a peut-être été fabriquée par le
  // pirate. On n'affiche plus de pression plutôt qu'une valeur douteuse.
  if (!roue->aMesure || roue->etat == ETAT_INTRUSION) {
    vue->connue = false;
    vue->pressionBar = 0.0f;
    vue->temperatureC = 0.0f;
    vue->batteriePct = 0;
    vue->joursRegonflage = JOURS_INCONNU;
    return;
  }
  vue->connue = true;
  vue->pressionBar = roue->pressionAffichee;
  vue->temperatureC = roue->mesure.temperatureC;
  vue->batteriePct = roue->mesure.batteriePct;
  vue->joursRegonflage = predireRegonflage(&roue->releves, seuilBasBar);
}

Sorties boitierMiseAJour(Boitier* b, int32_t maintenantMs) {
  char texte[64];
  if (!b->veille) surveillerSaturation(b, maintenantMs);

  // 1. Veille si le vélo ne roule plus depuis longtemps.
  if (!b->veille && maintenantMs - b->dernierMouvementMs > b->reglages.delaiVeilleMs) {
    b->veille = true;
    b->ecranUrgent = true;
    boitierJournal(b, maintenantMs, "Mise en veille (vélo immobile)");
  }
  // Le code d'appairage disparaît au bout d'une minute.
  if (b->liaison.code[0] != '\0' && maintenantMs > b->liaison.codeJusquaMs) {
    b->liaison.code[0] = '\0';
    b->ecranUrgent = true;
  }

  // 2. État de chaque pneu (pas en veille : la radio est coupée).
  bool alerteEnCours = false;
  bool alerteNonAcquittee = false;
  for (int i = 0; i < NB_ROUES; i++) {
    Position pos = (Position)i;
    Roue* roue = &b->roues[i];
    if (!b->veille) {
      // Au-dessus de 10 km/h seulement : plus lentement, le capteur peut ne
      // pas sentir la rotation et n'émettre qu'une fois par minute
      // (défaut révélé par la semaine type du simulateur).
      bool enMouvement = compteurVitesseKmh(&b->compteur, maintenantMs) > VITESSE_ROULAGE_SURE_KMH;
      Etat etat = evaluerRoue(roue, pos, &b->reglages.seuils, maintenantMs, b->ecouteDepuisMs, enMouvement);
      if (etat != roue->etat) {
        roue->etat = etat;
        roue->acquittee = false;
        b->ecranUrgent = true;
        snprintf(texte, sizeof(texte), "%s : %s", NOM_POSITION[i], texteEtat(etat));
        boitierJournal(b, maintenantMs, texte);
        if (estAlerte(etat)) b->bipDemande = true;
      }
    }
    if (estAlerte(roue->etat)) {
      alerteEnCours = true;
      if (!roue->acquittee) alerteNonAcquittee = true;
    }
  }

  // 3. Sorties : la LED clignote tant qu'une alerte n'est pas acquittée,
  //    puis reste allumée tant que le problème dure.
  Sorties sorties;
  sorties.ledAlerte = alerteNonAcquittee ? LED_CLIGNOTE : (alerteEnCours ? LED_FIXE : LED_ETEINTE);
  sorties.bip = b->bipDemande;
  sorties.ledsEclairage = b->eclairage && !b->veille;
  sorties.radio = boitierEcoute(b, maintenantMs);
  sorties.appConnectee = b->liaison.connecte;
  sorties.rafraichissement = RAFRAICHISSEMENT_AUCUN;
  b->bipDemande = false;
  if (b->veille) sorties.ledAlerte = LED_ETEINTE;

  // 4. Écran : au plus un dessin toutes les periodeEcranMs, sauf urgence.
  //    On n'envoie l'image à l'écran que si elle a changé.
  if (!b->ecranUrgent && maintenantMs - b->dernierDessinMs < b->reglages.periodeEcranMs) {
    return sorties;
  }
  b->ecranUrgent = false;
  b->dernierDessinMs = maintenantMs;
  Vue vue;
  boitierVue(b, maintenantMs, &vue);
  dessinerEcran(&b->ecran, &vue);
  if (ecransDifferents(&b->ecran, &b->ecranAffiche)) {
    ecranCopier(&b->ecranAffiche, &b->ecran);
    if (b->partielsDepuisComplet >= PARTIELS_AVANT_COMPLET) {
      b->partielsDepuisComplet = 0;
      b->stats.rafraichissementsComplets++;
      sorties.rafraichissement = RAFRAICHISSEMENT_COMPLET;
    } else {
      b->partielsDepuisComplet++;
      b->stats.rafraichissementsPartiels++;
      sorties.rafraichissement = RAFRAICHISSEMENT_PARTIEL;
    }
  }
  return sorties;
}
