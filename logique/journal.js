// =====================================================================
// journal.js — Journal de sécurité chaîné (infalsifiable… ou presque)
// ---------------------------------------------------------------------
// LOGIQUE PURE, portable en C++.
//
// Le boîtier note les événements de sécurité : intrusion repérée, code
// d'appairage faux, réglages modifiés, inondation radio… Si quelqu'un
// modifie ce journal après coup (pour effacer la trace d'une attaque),
// on veut que ça se VOIE.
//
// Principe de la chaîne (comme une blockchain, sans le reste) :
//
//   empreinte(n) = SHA256( n | instant | texte | empreinte(n−1) )
//
// Chaque ligne contient l'empreinte de la précédente. Modifier une ligne
// change son empreinte, qui ne correspond plus à celle notée dans la
// ligne suivante : la vérification s'arrête sur la ligne trafiquée.
//
// Limite (dite honnêtement) : quelqu'un qui peut réécrire TOUT le
// journal peut aussi recalculer toutes les empreintes. La parade est de
// copier régulièrement la dernière empreinte ailleurs (sur le téléphone) :
// un journal réécrit en entier ne contient plus cette empreinte. Dans le
// simulateur, le bouton « Copier l'empreinte » joue ce rôle.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.JOURNAL_TAILLE = 64;   // lignes gardées en mémoire (le boîtier a peu de RAM)
TPMS.EMPREINTE_ZERO = "0000000000000000000000000000000000000000000000000000000000000000";

TPMS.creerJournalSecurise = function () {
  return {
    lignes: [],                       // { n, tMs, texte, precedente, empreinte }
    suivant: 0,                       // numéro de la prochaine ligne
    // Quand la mémoire est pleine, on oublie la plus ancienne ligne mais
    // on garde son empreinte : la chaîne continue de se vérifier.
    ancre: TPMS.EMPREINTE_ZERO
  };
};

// Empreinte d'une ligne (en hexadécimal, 64 caractères).
TPMS.empreinteLigne = function (n, tMs, texte, precedente) {
  return TPMS.enHexa(TPMS.sha256(TPMS.texteEnOctets(n + "|" + tMs + "|" + texte + "|" + precedente)));
};

TPMS.journalAjouter = function (j, tMs, texte) {
  var precedente = j.lignes.length > 0 ? j.lignes[j.lignes.length - 1].empreinte : j.ancre;
  var ligne = {
    n: j.suivant,
    tMs: tMs,
    texte: texte,
    precedente: precedente,
    empreinte: TPMS.empreinteLigne(j.suivant, tMs, texte, precedente)
  };
  j.suivant++;
  j.lignes.push(ligne);
  if (j.lignes.length > TPMS.JOURNAL_TAILLE) j.ancre = j.lignes.shift().empreinte;
  return ligne;
};

// Recalcule toute la chaîne.
// Retourne -1 si tout est intact, sinon l'indice de la première ligne fausse.
TPMS.journalVerifier = function (j) {
  var attendue = j.ancre;
  for (var i = 0; i < j.lignes.length; i++) {
    var l = j.lignes[i];
    if (l.precedente !== attendue) return i;
    if (TPMS.empreinteLigne(l.n, l.tMs, l.texte, l.precedente) !== l.empreinte) return i;
    attendue = l.empreinte;
  }
  return -1;
};

// Dernière empreinte : l'application la recopie à chaque connexion.
TPMS.journalDerniereEmpreinte = function (j) {
  return j.lignes.length > 0 ? j.lignes[j.lignes.length - 1].empreinte : j.ancre;
};
