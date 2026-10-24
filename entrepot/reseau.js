// =====================================================================
// reseau.js — Petits services réseau des passerelles : heure (SNTP) et
// journal centralisé (syslog), écrits sans bibliothèque
// ---------------------------------------------------------------------
// HEURE : pourquoi une passerelle a besoin de l'heure exacte ?
//   - elle horodate les annonces qu'elle entend ;
//   - le serveur refuse les messages trop vieux ou venant du futur
//     (anti-rejeu) ;
//   - un certificat TLS n'est valable qu'entre deux dates.
// Le protocole NTP (RFC 5905) envoie un paquet UDP de 48 octets au port 123 ;
// le serveur répond avec son heure. SNTP (version simplifiée, RFC 4330)
// suffit ici : on compare l'heure du serveur NTP à celle de la passerelle.
// Les horodatages NTP comptent les secondes depuis le 1er janvier 1900,
// sur 32 bits, puis la fraction de seconde sur 32 bits.
//
// JOURNAL : syslog (RFC 5424) envoie une ligne de texte par datagramme UDP
// (port 514) à un serveur qui centralise les journaux de tout le réseau.
// En cas d'incident, on retrouve au même endroit ce qu'ont vu le pare-feu,
// le courtier et chaque passerelle.
// =====================================================================
"use strict";
var dgram = require("node:dgram");
var os = require("node:os");

var DECALAGE_1900_1970_S = 2208988800;   // secondes entre 1900 (NTP) et 1970 (Unix)

// Lit un horodatage NTP de 8 octets et le convertit en millisecondes Unix.
function lireHorodatageNtp(tampon, position) {
  var secondes = tampon.readUInt32BE(position);
  var fraction = tampon.readUInt32BE(position + 4);
  return (secondes - DECALAGE_1900_1970_S) * 1000 + Math.round(fraction / 4294967296 * 1000);
}

// Demande l'heure à un serveur NTP. Résout { heureServeurMs, decalageMs, allerRetourMs }.
// decalageMs > 0 : l'horloge locale est en retard sur le serveur.
function demanderHeure(hote, options) {
  var o = Object.assign({ port: 123, delaiMs: 3000, maintenant: Date.now }, options);
  return new Promise(function (ok, echec) {
    var socket = dgram.createSocket("udp4");
    var requete = Buffer.alloc(48);
    requete[0] = (0 << 6) | (4 << 3) | 3;   // pas d'alerte, version 4, mode 3 = client
    var envoiMs = o.maintenant();
    var minuteur = setTimeout(function () { socket.close(); echec(new Error("pas de réponse du serveur NTP " + hote)); }, o.delaiMs);
    socket.on("message", function (reponse) {
      var receptionMs = o.maintenant();
      clearTimeout(minuteur);
      socket.close();
      if (reponse.length < 48) return echec(new Error("réponse NTP trop courte"));
      var strate = reponse[1];
      if (strate === 0) return echec(new Error("serveur NTP non synchronisé (strate 0)"));
      var heureServeurMs = lireHorodatageNtp(reponse, 40);   // « transmit timestamp »
      var allerRetourMs = receptionMs - envoiMs;
      // On suppose l'aller et le retour de même durée.
      ok({ heureServeurMs: heureServeurMs, decalageMs: heureServeurMs + allerRetourMs / 2 - receptionMs, allerRetourMs: allerRetourMs, strate: strate });
    });
    socket.on("error", function (e) { clearTimeout(minuteur); socket.close(); echec(e); });
    socket.send(requete, o.port, hote);
  });
}

// Gravités syslog utilisées (RFC 5424, § 6.2.1).
var GRAVITE = { erreur: 3, attention: 4, notice: 5, info: 6 };

// Fabrique une ligne syslog RFC 5424 (catégorie 16 = « local0 »).
// <PRI>1 HORODATAGE MACHINE APPLICATION PID ID-MESSAGE DONNÉES MESSAGE
function ligneSyslog(gravite, application, message, maintenantMs) {
  var pri = 16 * 8 + (GRAVITE[gravite] === undefined ? 6 : GRAVITE[gravite]);
  var horodatage = new Date(maintenantMs || Date.now()).toISOString();
  return "<" + pri + ">1 " + horodatage + " " + os.hostname() + " " + application + " " + process.pid + " - - " + message;
}

// Retourne une fonction journal(gravite, message) qui écrit sur la
// console ET, si un serveur syslog est donné, l'envoie par UDP.
function creerJournal(application, hoteSyslog, portSyslog) {
  var socket = hoteSyslog ? dgram.createSocket("udp4") : null;
  if (socket) socket.unref();   // le journal ne doit pas empêcher le programme de s'arrêter
  return function (gravite, message) {
    console.log("[" + gravite + "] " + message);
    if (socket) socket.send(Buffer.from(ligneSyslog(gravite, application, message), "utf8"), portSyslog || 514, hoteSyslog);
  };
}

module.exports = {
  lireHorodatageNtp: lireHorodatageNtp, demanderHeure: demanderHeure,
  ligneSyslog: ligneSyslog, creerJournal: creerJournal, DECALAGE_1900_1970_S: DECALAGE_1900_1970_S
};
