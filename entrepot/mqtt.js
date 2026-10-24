// =====================================================================
// mqtt.js — Client MQTT 3.1.1 minimal, sans bibliothèque (Node.js 24)
// ---------------------------------------------------------------------
// MQTT est le protocole de messagerie de l'IoT industriel. Trois rôles :
//   - les PASSERELLES publient (« publish ») des messages sur des sujets,
//     par exemple « entrepot/lyon/passerelle/1/trames » ;
//   - le SERVEUR s'abonne (« subscribe ») aux sujets qui l'intéressent ;
//   - le COURTIER (« broker », ici Mosquitto) reçoit et redistribue.
// Les messages passent sur une connexion TCP, chiffrée par TLS (port 8883).
//
// Ce fichier est écrit à la main, à partir de la norme OASIS MQTT 3.1.1,
// pour pouvoir expliquer chaque octet. Il ne fait que ce dont le projet a
// besoin : connexion avec « testament », publication en QoS 0 et 1,
// abonnement, ping, déconnexion.
//
// Un paquet MQTT :
//   octet 1        type (4 bits de poids fort) + drapeaux (4 bits)
//   octets 2 à 5   « longueur restante », codée sur 1 à 4 octets : 7 bits
//                  par octet, le bit de poids fort dit « il y a un octet de plus »
//   ensuite        en-tête variable (selon le type) puis contenu
// Les textes sont précédés de leur longueur sur 2 octets (big-endian :
// MQTT, comme les protocoles réseau, écrit l'octet de poids fort d'abord,
// au contraire des trames TPMS).
// =====================================================================
"use strict";
var net = require("node:net");
var tls = require("node:tls");

var TYPE = {
  CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9,
  PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14
};

// Codes de retour du CONNACK (norme, § 3.2.2.3).
var REFUS_CONNEXION = {
  1: "version du protocole refusée", 2: "identifiant de client refusé", 3: "serveur indisponible",
  4: "nom d'utilisateur ou mot de passe incorrect", 5: "non autorisé"
};

// ---------------------------------------------------------------------
// Briques de codage
// ---------------------------------------------------------------------
function encoderLongueur(n) {
  if (n < 0 || n > 268435455) throw new Error("longueur MQTT hors limites");
  var octets = [];
  do {
    var octet = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) octet |= 0x80;          // « il y a encore un octet »
    octets.push(octet);
  } while (n > 0);
  return Buffer.from(octets);
}

// Retourne { valeur, taille } ou null si les octets ne sont pas encore tous arrivés.
function decoderLongueur(tampon, debut) {
  var valeur = 0, multiplicateur = 1;
  for (var i = 0; i < 4; i++) {
    if (debut + i >= tampon.length) return null;
    var octet = tampon[debut + i];
    valeur += (octet & 0x7F) * multiplicateur;
    if ((octet & 0x80) === 0) return { valeur: valeur, taille: i + 1 };
    multiplicateur *= 128;
  }
  throw new Error("longueur MQTT mal codée (plus de 4 octets)");
}

function texte(chaine) {
  var octets = Buffer.from(chaine, "utf8");
  var longueur = Buffer.alloc(2);
  longueur.writeUInt16BE(octets.length, 0);
  return Buffer.concat([longueur, octets]);
}

function entier16(n) {
  var b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function paquet(octet1, corps) {
  return Buffer.concat([Buffer.from([octet1]), encoderLongueur(corps.length), corps]);
}

// ---------------------------------------------------------------------
// Fabrication des paquets
// ---------------------------------------------------------------------
// options = { idClient, gardeS (keepalive), testament: { sujet, message, qos, retenu },
//             utilisateur, motDePasse }
function paquetConnect(o) {
  var drapeaux = 0x02;                                        // session propre
  var contenu = [texte(o.idClient)];
  if (o.testament) {
    drapeaux |= 0x04 | ((o.testament.qos || 0) << 3) | (o.testament.retenu ? 0x20 : 0);
    contenu.push(texte(o.testament.sujet), texte(String(o.testament.message)));
  }
  if (o.utilisateur !== undefined) { drapeaux |= 0x80; contenu.push(texte(o.utilisateur)); }
  if (o.motDePasse !== undefined) { drapeaux |= 0x40; contenu.push(texte(o.motDePasse)); }
  var entete = Buffer.concat([texte("MQTT"), Buffer.from([4, drapeaux]), entier16(o.gardeS || 30)]);
  return paquet(TYPE.CONNECT << 4, Buffer.concat([entete].concat(contenu)));
}

function paquetPublish(sujet, contenu, qos, retenu, idPaquet) {
  var octet1 = (TYPE.PUBLISH << 4) | ((qos || 0) << 1) | (retenu ? 1 : 0);
  var morceaux = [texte(sujet)];
  if (qos > 0) morceaux.push(entier16(idPaquet));
  morceaux.push(Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu), "utf8"));
  return paquet(octet1, Buffer.concat(morceaux));
}

function paquetPuback(idPaquet) { return paquet(TYPE.PUBACK << 4, entier16(idPaquet)); }

function paquetSubscribe(idPaquet, filtre, qos) {
  // Les 4 bits de drapeaux d'un SUBSCRIBE valent 0010 (exigé par la norme).
  return paquet((TYPE.SUBSCRIBE << 4) | 0x02, Buffer.concat([entier16(idPaquet), texte(filtre), Buffer.from([qos || 0])]));
}

function paquetPingreq() { return Buffer.from([TYPE.PINGREQ << 4, 0]); }
function paquetDisconnect() { return Buffer.from([TYPE.DISCONNECT << 4, 0]); }

// ---------------------------------------------------------------------
// Lecture des paquets reçus
// ---------------------------------------------------------------------
// Les octets arrivent par morceaux de taille quelconque (TCP ne garde pas
// les limites des paquets). On les accumule et on découpe les paquets
// complets. Retourne { paquets: [...], reste: Buffer }.
function decouper(tampon) {
  var paquets = [];
  var pos = 0;
  while (pos + 2 <= tampon.length) {
    var lg = decoderLongueur(tampon, pos + 1);
    if (lg === null) break;
    var debutCorps = pos + 1 + lg.taille, fin = debutCorps + lg.valeur;
    if (fin > tampon.length) break;                          // paquet incomplet : on attend la suite
    paquets.push(lirePaquet(tampon[pos], tampon.subarray(debutCorps, fin)));
    pos = fin;
  }
  return { paquets: paquets, reste: tampon.subarray(pos) };
}

function lirePaquet(octet1, corps) {
  var type = octet1 >> 4;
  switch (type) {
    case TYPE.CONNACK:
      return { type: "connack", sessionPresente: (corps[0] & 1) === 1, code: corps[1] };
    case TYPE.PUBLISH: {
      var qos = (octet1 >> 1) & 3;
      var lgSujet = corps.readUInt16BE(0);
      var sujet = corps.subarray(2, 2 + lgSujet).toString("utf8");
      var pos = 2 + lgSujet, idPaquet = null;
      if (qos > 0) { idPaquet = corps.readUInt16BE(pos); pos += 2; }
      return { type: "publish", sujet: sujet, contenu: corps.subarray(pos), qos: qos, retenu: (octet1 & 1) === 1, idPaquet: idPaquet };
    }
    case TYPE.PUBACK: return { type: "puback", idPaquet: corps.readUInt16BE(0) };
    case TYPE.SUBACK: return { type: "suback", idPaquet: corps.readUInt16BE(0), codes: Array.from(corps.subarray(2)) };
    case TYPE.PINGRESP: return { type: "pingresp" };
    default: return { type: "inconnu", code: type };
  }
}

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------
// options = { hote, port, tls (true par défaut), ca, cert, cle (contenus PEM),
//             idClient, gardeS, testament, utilisateur, motDePasse, delaiMs }
// Retourne une promesse résolue quand le courtier a accepté la connexion.
function connecter(options) {
  var o = Object.assign({ port: 8883, tls: true, gardeS: 30, delaiMs: 10000 }, options);
  return new Promise(function (ok, echec) {
    var socket = o.tls
      ? tls.connect({ host: o.hote, port: o.port, ca: o.ca, cert: o.cert, key: o.cle, servername: o.nomServeur || o.hote })
      : net.connect({ host: o.hote, port: o.port });
    var tampon = Buffer.alloc(0);
    var prochainId = 1;
    var attentes = new Map();            // idPaquet → { ok, echec } (PUBACK, SUBACK)
    var abonnements = [];                // { filtre, rappel }
    var connecte = false, ferme = false, minuteurPing = null;
    var surFermeture = [];
    var delai = setTimeout(function () { socket.destroy(new Error("délai de connexion MQTT dépassé")); }, o.delaiMs);

    function nouvelId() {
      var id = prochainId;
      prochainId = prochainId === 65535 ? 1 : prochainId + 1;   // jamais 0 (interdit par la norme)
      return id;
    }
    function envoyer(octets) { if (!ferme) socket.write(octets); }

    var client = {
      // QoS 0 : envoyé une fois, sans accusé. QoS 1 : la promesse attend le PUBACK.
      publier: function (sujet, contenu, opts) {
        var p = opts || {};
        var qos = p.qos || 0;
        if (qos === 0) { envoyer(paquetPublish(sujet, contenu, 0, p.retenu)); return Promise.resolve(); }
        var id = nouvelId();
        return new Promise(function (ok2, echec2) {
          attentes.set(id, { ok: ok2, echec: echec2 });
          envoyer(paquetPublish(sujet, contenu, qos, p.retenu, id));
        });
      },
      // rappel(sujet, contenu Buffer). Retourne la promesse du SUBACK (code accordé).
      abonner: function (filtre, qos, rappel) {
        abonnements.push({ filtre: filtre, rappel: rappel });
        var id = nouvelId();
        return new Promise(function (ok2, echec2) {
          attentes.set(id, { ok: function (codes) {
            if (codes[0] === 0x80) echec2(new Error("abonnement refusé par le courtier : " + filtre));
            else ok2(codes[0]);
          }, echec: echec2 });
          envoyer(paquetSubscribe(id, filtre, qos));
        });
      },
      fermer: function () {
        if (ferme) return;
        envoyer(paquetDisconnect());             // fin propre : le testament n'est PAS publié
        ferme = true;
        socket.end();
      },
      // Coupure brutale (simule une passerelle débranchée : le courtier publie le testament).
      couper: function () { ferme = true; socket.destroy(); },
      surFermeture: function (f) { surFermeture.push(f); }
    };

    socket.once(o.tls ? "secureConnect" : "connect", function () {
      envoyer(paquetConnect(o));
    });
    socket.on("data", function (morceau) {
      tampon = Buffer.concat([tampon, morceau]);
      var r;
      try { r = decouper(tampon); } catch (e) { socket.destroy(e); return; }
      tampon = r.reste;
      r.paquets.forEach(traiter);
    });
    socket.on("error", function (e) {
      clearTimeout(delai);
      if (!connecte) echec(e);
    });
    socket.on("close", function () {
      clearTimeout(delai);
      clearInterval(minuteurPing);
      ferme = true;
      attentes.forEach(function (a) { a.echec(new Error("connexion MQTT fermée")); });
      attentes.clear();
      if (!connecte) echec(new Error("connexion MQTT fermée par le courtier"));
      surFermeture.forEach(function (f) { f(); });
    });

    function traiter(p) {
      if (p.type === "connack") {
        clearTimeout(delai);
        if (p.code !== 0) {
          echec(new Error("connexion MQTT refusée : " + (REFUS_CONNEXION[p.code] || "code " + p.code)));
          socket.destroy();
          return;
        }
        connecte = true;
        // « Garde » : sans trafic, un PINGREQ avant la fin du délai pour que
        // le courtier sache que la passerelle est toujours là.
        minuteurPing = setInterval(function () { envoyer(paquetPingreq()); }, o.gardeS * 1000 * 0.75);
        ok(client);
      } else if (p.type === "puback") {
        var a = attentes.get(p.idPaquet);
        if (a) { attentes.delete(p.idPaquet); a.ok(); }
      } else if (p.type === "suback") {
        var s = attentes.get(p.idPaquet);
        if (s) { attentes.delete(p.idPaquet); s.ok(p.codes); }
      } else if (p.type === "publish") {
        if (p.qos === 1) envoyer(paquetPuback(p.idPaquet));
        abonnements.forEach(function (ab) { if (filtreCorrespond(ab.filtre, p.sujet)) ab.rappel(p.sujet, p.contenu); });
      }
    }
  });
}

// « entrepot/+/passerelle/# » correspond-il à « entrepot/lyon/passerelle/2/trames » ?
// + : exactement un niveau ; # : tous les niveaux restants (en dernier seulement).
function filtreCorrespond(filtre, sujet) {
  var f = filtre.split("/"), s = sujet.split("/");
  for (var i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= s.length) return false;
    if (f[i] !== "+" && f[i] !== s[i]) return false;
  }
  return f.length === s.length;
}

module.exports = {
  TYPE: TYPE, encoderLongueur: encoderLongueur, decoderLongueur: decoderLongueur,
  paquetConnect: paquetConnect, paquetPublish: paquetPublish, paquetPuback: paquetPuback,
  paquetSubscribe: paquetSubscribe, paquetPingreq: paquetPingreq, paquetDisconnect: paquetDisconnect,
  decouper: decouper, filtreCorrespond: filtreCorrespond, connecter: connecter
};
