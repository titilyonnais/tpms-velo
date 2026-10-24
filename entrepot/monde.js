// =====================================================================
// monde.js — Programme du conteneur « monde » de la maquette
// ---------------------------------------------------------------------
// Fait vivre l'entrepôt simulé (entrepot/chariots.js) en temps réel et
// diffuse chaque annonce des capteurs sur le réseau « air » de la
// maquette (10.10.99.0/24), qui joue le rôle de la radio Bluetooth : un
// datagramme UDP en diffusion par annonce, avec la position du chariot.
// Les passerelles, branchées sur ce réseau, décident ce qu'elles entendent.
//
// CE CONTENEUR N'EXISTE PAS DANS LA RÉALITÉ : dans un vrai entrepôt, ce
// sont de vrais chariots et la vraie radio. Il n'est relié à aucun autre
// réseau de la maquette (ni OT, ni serveurs).
//
// Variables d'environnement : GRAINE (2026), NB_CHARIOTS (8),
//   AIR_DIFFUSION (10.10.99.255), AIR_PORT (5555).
// Lancer hors Docker : AIR_DIFFUSION=127.0.0.1 node entrepot/monde.js
// =====================================================================
"use strict";
var dgram = require("node:dgram");
var TPMS = require("./node.js");

var graine = Number(process.env.GRAINE || 2026);
var nbChariots = Number(process.env.NB_CHARIOTS || 8);
var adresse = process.env.AIR_DIFFUSION || "10.10.99.255";
var port = Number(process.env.AIR_PORT || 5555);

var monde = TPMS.creerEntrepot({ graine: graine, nbChariots: nbChariots, debutMs: Math.floor(Date.now() / 1000) * 1000 });
var socket = dgram.createSocket("udp4");
var envoyees = 0;

socket.bind(function () {
  socket.setBroadcast(true);
  console.log("Monde simulé : " + nbChariots + " chariots, graine " + graine + " ; annonces diffusées sur " + adresse + ":" + port);
  setInterval(function () {
    var annonces = TPMS.entrepotAvancer(monde, Date.now(), 1);
    annonces.forEach(function (a) {
      var message = JSON.stringify({ t: a.tMs, x: Math.round(a.x * 10) / 10, y: Math.round(a.y * 10) / 10, trame: Buffer.from(a.octets).toString("hex") });
      socket.send(message, port, adresse);
      envoyees++;
    });
  }, 1000);
  setInterval(function () {
    var zones = monde.chariots.map(function (c) { return c.id + ":" + TPMS.entrepotZone(c.x); }).join(" ");
    console.log(new Date().toISOString() + " " + envoyees + " annonces diffusées · " + zones);
  }, 60000);
});

// Arrêt propre (docker compose down envoie SIGTERM).
process.on("SIGTERM", function () { socket.close(); process.exit(0); });
