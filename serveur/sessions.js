// =====================================================================
// sessions.js — Comptes à mot de passe et sessions à durée limitée
// ---------------------------------------------------------------------
// Avant le 24/10/2026, chaque compte avait un JETON FIXE, envoyé à chaque
// requête et valable pour toujours : volé une fois (poste partagé,
// capture d'écran, fichier oublié), il ouvrait l'API indéfiniment.
//
// Maintenant :
//   1. la personne se CONNECTE avec son nom de compte et son mot de passe
//      (POST /api/connexion) ;
//   2. le serveur lui donne un JETON DE SESSION tiré au hasard, qu'elle
//      présente ensuite (« Authorization: Bearer <jeton> ») ;
//   3. la session EXPIRE : après 15 min sans requête (inactivité), et de
//      toute façon 8 h après la connexion (une journée de travail) ;
//   4. « Se déconnecter » (POST /api/deconnexion) la détruit VRAIMENT côté
//      serveur : le jeton ne vaut plus rien, même recopié ailleurs.
//
// Mots de passe : le serveur n'en garde que l'empreinte scrypt, avec un
// sel. scrypt est une fonction LENTE et gourmande en mémoire, faite pour
// les mots de passe choisis par des humains : chaque essai coûte cher à
// un attaquant qui aurait volé le fichier. (Pour un jeton de session de
// 256 bits tiré au hasard, un simple SHA-256 suffit : impossible à deviner.)
//
// Le temps est toujours passé en paramètre (maintenantMs), comme dans la
// logique du boîtier : les tests peuvent « avancer l'horloge ».
// =====================================================================
"use strict";
var crypto = require("node:crypto");

var REGLES = {
  inactiviteMs: 15 * 60000,      // 15 min sans requête : session fermée
  dureeMaxMs: 8 * 3600000,       // 8 h au plus après la connexion
  maxParCompte: 3,               // au-delà, la plus ancienne session est fermée
  motDePasseMin: 12              // longueur minimale d'un mot de passe
};

// scrypt : N = 2^14 (≈ 16 Mo de mémoire, ≈ 50 ms par essai sur un PC).
var SCRYPT = { N: 16384, r: 8, p: 1, longueur: 32 };

function empreinteMotDePasse(motDePasse, sel) {
  return crypto.scryptSync(motDePasse, sel, SCRYPT.longueur, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
}

// Prépare un compte à partir de la configuration :
//   { role, motDePasse }        démo : mot de passe en clair, haché dès la lecture ;
//   { role, sel, empreinte }    production : seulement le sel et l'empreinte (hexadécimal).
// Retourne { nom, role, sel, empreinte } ou null si le compte est inutilisable.
function preparerCompte(nom, c) {
  if (typeof c.sel === "string" && /^[0-9a-f]{32}$/.test(c.sel) &&
      typeof c.empreinte === "string" && /^[0-9a-f]{64}$/.test(c.empreinte)) {
    return { nom: nom, role: c.role, sel: Buffer.from(c.sel, "hex"), empreinte: Buffer.from(c.empreinte, "hex") };
  }
  if (typeof c.motDePasse === "string" && c.motDePasse.length >= REGLES.motDePasseMin) {
    var sel = crypto.randomBytes(16);
    // Le mot de passe en clair n'est PAS gardé : seulement le sel et l'empreinte.
    return { nom: nom, role: c.role, sel: sel, empreinte: empreinteMotDePasse(c.motDePasse, sel) };
  }
  return null;
}

// Compte fictif : sert quand le nom de compte est inconnu, pour que la
// réponse prenne le même temps (sinon, la rapidité de la réponse dirait
// à un attaquant quels noms de comptes existent).
var COMPTE_FICTIF = { nom: null, sel: crypto.randomBytes(16), empreinte: crypto.randomBytes(32) };

// Retourne le compte si le nom et le mot de passe sont bons, sinon null.
function verifierMotDePasse(comptes, nom, motDePasse) {
  var compte = null;
  comptes.forEach(function (c) { if (c.nom === nom) compte = c; });
  var cible = compte || COMPTE_FICTIF;
  var essai = empreinteMotDePasse(String(motDePasse), cible.sel);
  var bon = crypto.timingSafeEqual(essai, cible.empreinte);   // comparaison à temps constant
  return bon && compte ? compte : null;
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------
// Le serveur ne garde pas les jetons de session eux-mêmes, seulement leur
// empreinte SHA-256 (en hexadécimal, clé de la Map) : une copie de la
// mémoire ne permettrait pas de les réutiliser.
function empreinteJeton(jeton) {
  return crypto.createHash("sha256").update(jeton, "utf8").digest("hex");
}

function creerSessions(regles) {
  return { regles: Object.assign({}, REGLES, regles || {}), parEmpreinte: new Map() };
}

// Fin de validité d'une session : la plus proche des deux limites.
function finSession(s, session) {
  return Math.min(session.derniereMs + s.regles.inactiviteMs, session.debutMs + s.regles.dureeMaxMs);
}

// Retourne { jeton, finMs }. Le jeton n'est donné qu'une fois, ici.
function ouvrirSession(s, compte, maintenantMs) {
  purgerSessions(s, maintenantMs);
  // Trop de sessions ouvertes pour ce compte : on ferme la plus ancienne.
  var siennes = [];
  s.parEmpreinte.forEach(function (session, empreinte) {
    if (session.compte === compte) siennes.push({ empreinte: empreinte, debutMs: session.debutMs });
  });
  siennes.sort(function (a, b) { return a.debutMs - b.debutMs; });
  while (siennes.length >= s.regles.maxParCompte) s.parEmpreinte.delete(siennes.shift().empreinte);

  var jeton = crypto.randomBytes(32).toString("base64url");   // 256 bits, 43 caractères
  var session = { compte: compte, debutMs: maintenantMs, derniereMs: maintenantMs };
  s.parEmpreinte.set(empreinteJeton(jeton), session);
  return { jeton: jeton, finMs: finSession(s, session) };
}

// Retourne { compte, finMs } si la session est valable (et la prolonge :
// l'inactivité se compte depuis la DERNIÈRE requête), { expiree: true }
// si elle a existé mais a expiré, { inconnue: true } sinon.
function verifierSession(s, jeton, maintenantMs) {
  var empreinte = empreinteJeton(jeton);
  var session = s.parEmpreinte.get(empreinte);
  if (!session) return { inconnue: true };
  if (maintenantMs >= finSession(s, session)) {
    s.parEmpreinte.delete(empreinte);
    return { expiree: true };
  }
  session.derniereMs = maintenantMs;
  return { compte: session.compte, finMs: finSession(s, session) };
}

// Déconnexion : la session est détruite. Retourne true si elle existait.
function fermerSession(s, jeton) {
  return s.parEmpreinte.delete(empreinteJeton(jeton));
}

// Oublie les sessions expirées (la mémoire ne grossit pas indéfiniment).
function purgerSessions(s, maintenantMs) {
  s.parEmpreinte.forEach(function (session, empreinte) {
    if (maintenantMs >= finSession(s, session)) s.parEmpreinte.delete(empreinte);
  });
}

module.exports = {
  REGLES: REGLES, SCRYPT: SCRYPT,
  empreinteMotDePasse: empreinteMotDePasse, preparerCompte: preparerCompte, verifierMotDePasse: verifierMotDePasse,
  empreinteJeton: empreinteJeton, creerSessions: creerSessions, ouvrirSession: ouvrirSession,
  verifierSession: verifierSession, fermerSession: fermerSession, purgerSessions: purgerSessions
};
