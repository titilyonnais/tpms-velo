// =====================================================================
// usine.js — Simulation complète de l'usine : entrepôt, radio, réseau,
// pare-feu, courtier MQTT, horloges, journaux, supervision
// ---------------------------------------------------------------------
// MODÈLE PUR (le temps est passé en paramètre), utilisable dans Node et
// dans le navigateur (entrepot/simulateur.html). Il reproduit, machine
// par machine, ce que fait la maquette Docker (docker-compose.yml) :
//   - l'entrepôt et ses chariots (entrepot/chariots.js) émettent leurs
//     annonces Bluetooth ; un brouilleur peut en couvrir une partie ;
//   - 3 passerelles les entendent (portée calculée), règlent leur heure
//     par SNTP, publient un lot toutes les 10 s en MQTT sur TLS (QoS 1),
//     gardent 1 h de lots si le courtier est injoignable, publient leur
//     état toutes les minutes et journalisent sur le syslog central ;
//   - chaque paquet qui change de zone traverse le PARE-FEU, avec les
//     mêmes règles, dans le même ordre, que entrepot/pare-feu/regles.nft
//     (compteurs, suivi des connexions « à états ») ;
//   - le COURTIER vérifie le certificat (AC de l'usine, révocation),
//     applique les droits par sujet (ACL de entrepot/courtier/acl),
//     accuse réception (PUBACK), garde les messages retenus et publie le
//     testament d'un client disparu (fermeture franche ou fin du délai
//     de garde : 1,5 × 30 s) ;
//   - la SUPERVISION reçoit les messages et les traite avec la même
//     logique que le serveur réel (entrepot/reception.js) ;
//   - le poste du bureau consulte la page toutes les 5 s ; un intrus
//     peut être branché sur l'atelier pour les attaques ;
//   - un TECHNICIEN agit d'après ce que montre la supervision (et non
//     d'après la vérité de la simulation) : tournée de regonflage à 5 h 30,
//     intervention sur une crevaison signalée (le cariste arrête son
//     chariot), repose d'un capteur perdu. S'il ne voit rien, il ne fait rien.
// Nécessite : logique/*.js (trame, fuite, alertes, securite),
// simulateur/monde/(alea, atmosphere, pneu, capteur).js,
// entrepot/chariots.js, entrepot/reception.js.
//
// Tailles des paquets : en-têtes réels (IPv4 20 octets, TCP 32 octets
// avec l'option d'horodatage, UDP 8 octets, enregistrement TLS 1.3 :
// 22 octets) ; les compteurs du pare-feu, comme ceux de nftables,
// comptent la longueur IP des paquets.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

// ---------------------------------------------------------------------
// 1. Plan d'adressage (docs/orientation-industrielle.md, § 3.3)
// ---------------------------------------------------------------------
TPMS.USINE = {
  zones: {
    ot:          { nom: "Atelier (OT)",  vlan: 10, reseau: "10.10.10.0/24" },
    serveurs:    { nom: "Serveurs",      vlan: 20, reseau: "10.10.20.0/24" },
    bureautique: { nom: "Bureautique",   vlan: 30, reseau: "10.10.30.0/24" },
    dmz:         { nom: "DMZ",           vlan: 40, reseau: "10.10.40.0/24" }
  },
  machines: {
    "passerelle-1": { zone: "ot", ip: "10.10.10.11" },
    "passerelle-2": { zone: "ot", ip: "10.10.10.12" },
    "passerelle-3": { zone: "ot", ip: "10.10.10.13" },
    "intrus":       { zone: "ot", ip: "10.10.10.66" },
    "courtier":     { zone: "serveurs", ip: "10.10.20.10" },
    "supervision":  { zone: "serveurs", ip: "10.10.20.20" },
    "ntp":          { zone: "serveurs", ip: "10.10.20.30" },
    "syslog":       { zone: "serveurs", ip: "10.10.20.40" },
    "poste":        { zone: "bureautique", ip: "10.10.30.50" }
  },
  // Ports ouverts (services) de chaque machine.
  services: {
    "courtier": { tcp: [8883] }, "supervision": { tcp: [8443] },
    "ntp": { udp: [123] }, "syslog": { udp: [514] }
  },
  // En-têtes (octets) : longueur IP = charge utile + en-têtes.
  enTetes: { ip: 20, tcp: 32, udp: 8, tls: 22, mss: 1448 },
  // Latences d'un réseau local câblé (HYPOTHÈSE réaliste) : traversée d'un
  // commutateur, et du pare-feu (routage + filtrage).
  latence: { commutateurMs: 0.08, pareFeuMs: 0.12, giguePct: 30 },
  mqtt: { gardeS: 30, lotS: 10, etatS: 60, lotsMax: 360, reconnexionMaxS: 30, delaiConnexionS: 3, supervisionReessaiS: 5 },
  ntp: { periodeS: 600, seuilAlerteMs: 2000 },
  // Quartz des passerelles : dérive de ±30 ppm au plus (HYPOTHÈSE courante).
  horloge: { derivePpmMax: 30, ecartDemarrageMs: 4000 },
  poste: { periodeS: 5, reponseOctets: 9200 }     // une lecture de /api/chariots ≈ 9 Kio
};

// Règles du pare-feu, DANS L'ORDRE de entrepot/pare-feu/regles.nft
// (chaîne « transit », après « ct state established,related accept »).
// Un test vérifie que chaque règle figure bien dans regles.nft.
TPMS.REGLES_PARE_FEU = [
  { nom: "6 PC de demonstration vers supervision", src: ["10.10.10.1", "10.10.20.1", "10.10.30.1", "10.10.40.1"], dst: "10.10.20.20", proto: "tcp", port: 8443, verdict: "accept" },
  { nom: "1 passerelles vers courtier MQTT TLS", src: "10.10.10.0/24", dst: "10.10.20.10", proto: "tcp", port: 8883, verdict: "accept" },
  { nom: "2 passerelles vers NTP", src: "10.10.10.0/24", dst: "10.10.20.30", proto: "udp", port: 123, verdict: "accept" },
  { nom: "3 passerelles vers syslog", src: "10.10.10.0/24", dst: "10.10.20.40", proto: "udp", port: 514, verdict: "accept" },
  { nom: "4 bureautique vers supervision HTTPS", src: "10.10.30.0/24", dst: "10.10.20.20", proto: "tcp", port: 8443, verdict: "accept" },
  { nom: "5 DMZ vers supervision HTTPS", src: "10.10.40.0/24", dst: "10.10.20.20", proto: "tcp", port: 8443, verdict: "accept" },
  { nom: "REFUS bureautique vers OT", src: "10.10.30.0/24", dst: "10.10.10.0/24", verdict: "drop" },
  { nom: "REFUS OT vers bureautique", src: "10.10.10.0/24", dst: "10.10.30.0/24", verdict: "drop" },
  { nom: "REFUS bureautique vers courtier", src: "10.10.30.0/24", dst: "10.10.20.10", verdict: "drop" },
  { nom: "REFUS OT vers supervision", src: "10.10.10.0/24", dst: "10.10.20.20", verdict: "drop" },
  { nom: "REFUS autres", verdict: "drop" }
];

// Droits par sujet du courtier (entrepot/courtier/acl). Tout le reste est interdit.
TPMS.ACL_COURTIER = [
  { utilisateur: "serveur-supervision", acces: "read", filtre: "entrepot/#" },
  { utilisateur: "passerelle-1", acces: "write", filtre: "entrepot/+/passerelle/1/#" },
  { utilisateur: "passerelle-2", acces: "write", filtre: "entrepot/+/passerelle/2/#" },
  { utilisateur: "passerelle-3", acces: "write", filtre: "entrepot/+/passerelle/3/#" }
];

// ---------------------------------------------------------------------
// 2. Outils
// ---------------------------------------------------------------------
function ipEnEntier(ip) {
  var p = ip.split(".").map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
// L'adresse ip appartient-elle à « a.b.c.d/n », à « a.b.c.d », ou à une liste ?
TPMS.ipCorrespond = function (ip, motif) {
  if (motif === undefined) return true;
  if (Array.isArray(motif)) return motif.some(function (m) { return TPMS.ipCorrespond(ip, m); });
  var morceaux = motif.split("/");
  if (morceaux.length === 1) return ip === motif;
  var bits = Number(morceaux[1]);
  var masque = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return ((ipEnEntier(ip) & masque) >>> 0) === ((ipEnEntier(morceaux[0]) & masque) >>> 0);
};

// Même logique que filtreCorrespond de entrepot/mqtt.js (+ : un niveau, # : la suite).
TPMS.mqttFiltreCorrespond = function (filtre, sujet) {
  var f = filtre.split("/"), s = sujet.split("/");
  for (var i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= s.length) return false;
    if (f[i] !== "+" && f[i] !== s[i]) return false;
  }
  return f.length === s.length;
};

// Taille d'un PUBLISH MQTT 3.1.1 : en-tête fixe, longueur restante (1 à 4
// octets), sujet, identifiant de paquet (QoS 1), contenu.
TPMS.mqttTaillePublish = function (sujet, contenuOctets, qos) {
  var reste = 2 + sujet.length + (qos > 0 ? 2 : 0) + contenuOctets;
  var lg = reste < 128 ? 1 : reste < 16384 ? 2 : reste < 2097152 ? 3 : 4;
  return 1 + lg + reste;
};

// Octets UTF-8 d'un texte (le JSON des lots contient des accents).
function octetsUtf8(texte) {
  var n = 0;
  for (var i = 0; i < texte.length; i++) {
    var c = texte.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3;
  }
  return n;
}

// ---------------------------------------------------------------------
// 3. Création de l'usine
// ---------------------------------------------------------------------
// options = { graine, debutMs, nbChariots }
TPMS.creerUsine = function (options) {
  var o = options || {};
  var graine = (o.graine || 2026) >>> 0;
  var debut = o.debutMs || Date.UTC(2026, 9, 26, 5, 0, 0);     // lundi 26/10/2026, 6 h à Paris (heure d'hiver : UTC + 1)
  var U = TPMS.USINE;
  var usine = {
    graine: graine, tMs: debut, debutMs: debut,
    alea: TPMS.creerAleaNomme(graine, "usine"),
    monde: TPMS.creerEntrepot({ graine: graine, nbChariots: o.nbChariots || 8, debutMs: debut, maintenanceAuto: false }),
    technicien: { interventions: [], derniereTourneeJour: null, prochainControleMs: debut, aReparer: {} },
    machines: {}, regles: [], conntrack: {}, compteurEtabli: { paquets: 0, octets: 0 },
    flux: [], journalCentral: [], journalCourtier: [], journalSupervision: [], journalPareFeu: [],
    brouilleur: null, revocations: {}, posteActif: true,
    courtier: { clients: {}, retenus: {}, abonnements: {}, enAttente: {}, messagesRecus: 0, refusAcl: 0, compteurId: 1 },
    stats: { annoncesEmises: 0, annoncesBrouillees: 0, annoncesEntendues: 0 },
    derniersRssi: {},              // chariot → passerelle → { rssi, t } (pour l'affichage)
    dernieresAnnonces: {},         // « C01 AVG » → ce que le capteur a annoncé en dernier
    essais: [], prochainId: 1
  };
  TPMS.REGLES_PARE_FEU.forEach(function (r) { usine.regles.push(Object.assign({ paquets: 0, octets: 0 }, r)); });
  Object.keys(U.machines).forEach(function (id) {
    var m = U.machines[id];
    usine.machines[id] = {
      id: id, ip: m.ip, zone: m.zone,
      alimentee: id !== "intrus", cable: id !== "intrus",      // l'intrus n'est branché que pour les attaques
      programme: id !== "intrus",                                // programme en marche
      horloge: { decalageMs: 0, derivePpm: 0, dernierReglageMs: null, dernierEcartMs: null }
    };
  });
  // Les passerelles : quartz imparfait, pas d'horloge sauvegardée (comme un
  // Raspberry Pi sans pile) : elles démarrent avec quelques secondes d'écart.
  TPMS.ENTREPOT.passerelles.forEach(function (p) {
    var m = usine.machines["passerelle-" + p.id];
    var a = TPMS.creerAleaNomme(graine, "horloge-passerelle" + p.id);
    m.horloge.derivePpm = Math.round((a() * 2 - 1) * U.horloge.derivePpmMax * 10) / 10;
    m.horloge.decalageMs = Math.round((a() * 2 - 1) * U.horloge.ecartDemarrageMs);
    m.passerelle = {
      id: p.id, position: p, aleaRadio: TPMS.creerAleaNomme(graine, "radio-passerelle" + p.id),
      annonces: [], lotsEnAttente: [], connexion: null, prochaineTentativeMs: debut, attenteS: 1,
      prochainLotMs: debut + U.mqtt.lotS * 1000, prochainEtatMs: debut, prochainNtpMs: debut, prochainPingMs: null,
      decalageNtpMs: null, compteurs: { entendues: 0, horsPortee: 0, lotsEnvoyes: 0, lotsPerdus: 0, tentatives: 0 }
    };
  });
  // La supervision : même logique de réception que le serveur réel.
  var sup = usine.machines.supervision;
  sup.supervision = {
    connexion: null, prochaineTentativeMs: debut, alertes: [], refus: [], historique: {}, passerelles: {},
    messages: 0, lotsRefusesMqtt: 0, sessionPersistante: true
  };
  usine.monde.chariots.forEach(function (c) { sup.supervision.historique[c.id] = []; });
  creerReceptionSupervision(usine);
  // Le poste du bureau garde une connexion HTTPS ouverte (page de supervision).
  usine.machines.poste.poste = { connexion: null, prochaineLectureMs: debut + 2000, lectures: 0, erreurs: 0 };
  journaliser(usine, "pare-feu", "info", "règles chargées : " + usine.regles.length + " règles, politique « tout refusé »");
  return usine;
};

// La logique de réception garde en MÉMOIRE l'état des pneus et des zones :
// un redémarrage du serveur la remet à zéro (l'historique, les alertes et
// les refus sont en base, ils restent).
function creerReceptionSupervision(usine) {
  var sup = usine.machines.supervision;
  sup.supervision.reception = TPMS.creerReceptionLots(TPMS.entrepotRegistreCapteurs(usine.monde), {
    refus: function (t, source, motif, detail) { ajouterBorne(sup.supervision.refus, { t: t, ip: source, motif: motif, detail: detail }, 50, true); },
    mesure: function (chariot, position, t, m) {
      var h = sup.supervision.historique[chariot];
      h.push({ position: position, t: t, pression: m.pressionBar, temperature: m.temperatureC });
      while (h.length && h[0].t < t - 12 * 3600000) h.shift();
    },
    alerte: function (chariot, t, position, type, pression) {
      ajouterBorne(sup.supervision.alertes, { chariot_id: chariot, t: t, position: position, type: type, pression: pression }, 80, true);
    },
    passerelle: function (id, p) {
      var q = sup.supervision.passerelles[id] || (sup.supervision.passerelles[id] = { id: id, zone: null, etat: "?", t: 0, version: null, decalage_ntp_ms: null, lots: 0, annonces: 0 });
      if (p.zone) q.zone = p.zone;
      q.etat = p.etat; q.t = p.t;
      if (p.version) q.version = p.version;
      if (p.decalageNtpMs !== null && p.decalageNtpMs !== undefined) q.decalage_ntp_ms = p.decalageNtpMs;
      if (p.annonces !== null) { q.lots++; q.annonces += p.annonces; }
    }
  });
}

function ajouterBorne(liste, element, max, enTete) {
  if (enTete) { liste.unshift(element); if (liste.length > max) liste.length = max; }
  else { liste.push(element); if (liste.length > max) liste.shift(); }
}

// Heure de la machine : l'heure vraie plus son décalage.
TPMS.usineHeure = function (usine, idMachine) {
  return usine.tMs + Math.round(usine.machines[idMachine].horloge.decalageMs);
};

function enMarche(m) { return m.alimentee && m.programme; }
function joignable(m) { return m.alimentee && m.cable; }

// Journaux : central (syslog, reçu par le réseau), courtier, supervision, pare-feu.
function journaliser(usine, source, gravite, texte) {
  var ligne = { t: usine.tMs, source: source, gravite: gravite, texte: texte };
  if (source === "courtier") ajouterBorne(usine.journalCourtier, ligne, 300);
  else if (source === "supervision") ajouterBorne(usine.journalSupervision, ligne, 300);
  else if (source === "pare-feu") ajouterBorne(usine.journalPareFeu, ligne, 300);
}

// ---------------------------------------------------------------------
// 4. Le réseau et le pare-feu
// ---------------------------------------------------------------------
// Envoie UN paquet IP. paquet = { src, dst (id de machine ou adresse IP),
// proto: "tcp"/"udp", sport, dport, octets (charge utile), syn (1er paquet
// d'une connexion TCP), reponse (paquet retour) }.
// Retourne { livre, verdict, regle, raison, latenceMs }.
TPMS.usineEnvoyer = function (usine, paquet) {
  var U = TPMS.USINE;
  var src = usine.machines[paquet.src], dst = usine.machines[paquet.dst];
  var ipSrc = src ? src.ip : paquet.src, ipDst = dst ? dst.ip : paquet.dst;
  var longueur = paquet.octets + U.enTetes.ip + (paquet.proto === "tcp" ? U.enTetes.tcp : U.enTetes.udp);
  var res = { livre: false, verdict: "direct", regle: null, raison: "", latenceMs: 0, longueur: longueur };
  if (src && !joignable(src)) { res.raison = "source débranchée"; return res; }
  var zoneSrc = src ? src.zone : null, zoneDst = dst ? dst.zone : null;
  var gigue = 1 + (U.latence.giguePct / 100) * (usine.alea() - 0.5);
  if (zoneSrc && zoneSrc === zoneDst) {
    // Même zone : le commutateur relie directement, le pare-feu ne voit rien.
    res.latenceMs = U.latence.commutateurMs * gigue;
  } else {
    res.latenceMs = (2 * U.latence.commutateurMs + U.latence.pareFeuMs) * gigue;
    var f = filtrer(usine, ipSrc, ipDst, paquet, longueur);
    res.verdict = f.verdict; res.regle = f.regle;
    if (f.verdict === "drop") { res.raison = "refusé par le pare-feu (" + f.regle + ")"; noterFlux(usine, paquet, ipSrc, ipDst, res); return res; }
  }
  if (!dst || !joignable(dst)) { res.raison = "destination injoignable"; noterFlux(usine, paquet, ipSrc, ipDst, res); return res; }
  res.livre = true;
  noterFlux(usine, paquet, ipSrc, ipDst, res);
  return res;
};

// Chaîne « transit » : d'abord les connexions déjà autorisées (suivi « à
// états »), puis les règles dans l'ordre ; la première qui correspond décide.
function filtrer(usine, ipSrc, ipDst, p, longueur) {
  var cle = p.proto + " " + ipSrc + ":" + p.sport + " > " + ipDst + ":" + p.dport;
  var cleRetour = p.proto + " " + ipDst + ":" + p.dport + " > " + ipSrc + ":" + p.sport;
  var ct = usine.conntrack[cle] || usine.conntrack[cleRetour];
  // UDP sans réponse : chaque datagramme reste « nouveau » (comme le syslog).
  var etabli = ct && (p.proto === "tcp" ? !p.syn : (ct.repondu || p.reponse));
  if (etabli) {
    usine.compteurEtabli.paquets++;
    usine.compteurEtabli.octets += longueur;
    if (p.reponse && ct) ct.repondu = true;
    ct.dernierMs = usine.tMs;
    return { verdict: "accept", regle: "établie" };
  }
  for (var i = 0; i < usine.regles.length; i++) {
    var r = usine.regles[i];
    if (!TPMS.ipCorrespond(ipSrc, r.src) || !TPMS.ipCorrespond(ipDst, r.dst)) continue;
    if (r.proto && (r.proto !== p.proto || r.port !== p.dport)) continue;
    r.paquets++;
    r.octets += longueur;
    if (r.verdict === "accept") usine.conntrack[cle] = { debutMs: usine.tMs, dernierMs: usine.tMs, repondu: false, regle: r.nom };
    else if (r.nom.indexOf("REFUS") === 0) journaliser(usine, "pare-feu", "attention", "refus " + p.proto.toUpperCase() + " " + ipSrc + " → " + ipDst + ":" + p.dport + " (" + r.nom + ")");
    return { verdict: r.verdict, regle: r.nom };
  }
  return { verdict: "drop", regle: "politique" };
}

function noterFlux(usine, p, ipSrc, ipDst, res) {
  ajouterBorne(usine.flux, { t: usine.tMs, src: p.src, dst: p.dst, ipSrc: ipSrc, ipDst: ipDst, proto: p.proto, dport: p.dport,
    longueur: res.longueur, verdict: res.verdict, regle: res.regle, livre: res.livre, quoi: p.quoi || "" }, 400);
}

// Envoie n octets d'application sur une connexion TCP ouverte : découpés
// en segments (MSS), chacun accusé (un ACK pour deux segments).
// Retourne false si un paquet n'est pas passé.
function tcpEnvoyer(usine, cx, octets, quoi, sens) {
  var U = TPMS.USINE;
  var aller = sens !== "retour";
  var a = aller ? cx.client : cx.serveur, b = aller ? cx.serveur : cx.client;
  var pa = aller ? cx.portClient : cx.port, pb = aller ? cx.port : cx.portClient;
  var segments = Math.max(1, Math.ceil(octets / U.enTetes.mss));
  for (var s = 0; s < segments; s++) {
    var taille = s < segments - 1 ? U.enTetes.mss : octets - U.enTetes.mss * (segments - 1);
    var r = TPMS.usineEnvoyer(usine, { src: a, dst: b, proto: "tcp", sport: pa, dport: pb, octets: taille, reponse: !aller, quoi: quoi });
    if (!r.livre) return false;
    if (s % 2 === 1 || s === segments - 1) TPMS.usineEnvoyer(usine, { src: b, dst: a, proto: "tcp", sport: pb, dport: pa, octets: 0, reponse: aller, quoi: "ACK" });
  }
  return true;
}

// Ouvre une connexion TCP (SYN, SYN-ACK, ACK). Résultat comme nmap :
// « open », « closed » (RST : machine joignable, port fermé), « filtered »
// (refusé en silence par le pare-feu), « injoignable ».
function tcpOuvrir(usine, client, serveur, port) {
  var portClient = 40000 + (usine.prochainId++ % 20000);
  var syn = TPMS.usineEnvoyer(usine, { src: client, dst: serveur, proto: "tcp", sport: portClient, dport: port, octets: 0, syn: true, quoi: "SYN" });
  if (!syn.livre) return { etat: syn.verdict === "drop" ? "filtered" : "injoignable", regle: syn.regle, raison: syn.raison };
  var srv = usine.machines[serveur];
  var services = TPMS.USINE.services[serveur];
  var ouvert = enMarche(srv) && services && services.tcp && services.tcp.indexOf(port) >= 0;
  TPMS.usineEnvoyer(usine, { src: serveur, dst: client, proto: "tcp", sport: port, dport: portClient, octets: 0, reponse: true, quoi: ouvert ? "SYN-ACK" : "RST" });
  if (!ouvert) {
    delete usine.conntrack["tcp " + usine.machines[client].ip + ":" + portClient + " > " + srv.ip + ":" + port];
    return { etat: "closed", regle: syn.regle };
  }
  TPMS.usineEnvoyer(usine, { src: client, dst: serveur, proto: "tcp", sport: portClient, dport: port, octets: 0, quoi: "ACK" });
  return { etat: "open", regle: syn.regle, cx: { client: client, serveur: serveur, port: port, portClient: portClient, ouverte: true, debutMs: usine.tMs } };
}

function tcpFermer(usine, cx, franche) {
  if (!cx || !cx.ouverte) return;
  cx.ouverte = false;
  if (franche) {
    // FIN de part et d'autre (si le chemin existe encore).
    TPMS.usineEnvoyer(usine, { src: cx.client, dst: cx.serveur, proto: "tcp", sport: cx.portClient, dport: cx.port, octets: 0, quoi: "FIN" });
    TPMS.usineEnvoyer(usine, { src: cx.serveur, dst: cx.client, proto: "tcp", sport: cx.port, dport: cx.portClient, octets: 0, reponse: true, quoi: "FIN" });
  }
  delete usine.conntrack["tcp " + usine.machines[cx.client].ip + ":" + cx.portClient + " > " + usine.machines[cx.serveur].ip + ":" + cx.port];
}

// ---------------------------------------------------------------------
// 5. TLS et certificats
// ---------------------------------------------------------------------
// Certificats de la maquette (entrepot/generer-certificats.js), valables
// 365 jours. « volé » : le même certificat, copié depuis une passerelle.
TPMS.usineCertificat = function (usine, nom) {
  if (!nom) return null;
  var pirate = nom === "passerelle-9";
  return { cn: nom, emetteur: pirate ? "AC pirate" : "AC de l'usine", debutMs: usine.debutMs - 86400000, finMs: usine.debutMs + 364 * 86400000 };
};

// Poignée de main TLS 1.3 avec le courtier (authentification mutuelle).
// Retourne { ok, alerte, texte } ; alertes TLS (RFC 8446) : 116
// certificate_required, 48 unknown_ca, 45 certificate_expired,
// 44 certificate_revoked.
function tlsCourtier(usine, cx, certificat) {
  // ClientHello (≈ 300 o) → ServerHello, certificat du courtier, Finished (≈ 1 500 o).
  if (!tcpEnvoyer(usine, cx, 310, "TLS ClientHello")) return { ok: false, texte: "connexion perdue" };
  tcpEnvoyer(usine, cx, 1480, "TLS ServerHello + certificat", "retour");
  var heure = TPMS.usineHeure(usine, "courtier");
  var verdict = null;
  if (!certificat) verdict = { alerte: 116, texte: "alerte TLS 116, certificat client exigé" };
  else if (certificat.emetteur !== "AC de l'usine") verdict = { alerte: 48, texte: "alerte TLS 48, certificat signé par une AC inconnue" };
  else if (heure < certificat.debutMs || heure > certificat.finMs) verdict = { alerte: 45, texte: "alerte TLS 45, certificat expiré (ou horloge fausse)" };
  else if (usine.revocations[certificat.cn]) verdict = { alerte: 44, texte: "alerte TLS 44, certificat révoqué" };
  // Le client envoie son certificat (≈ 800 o) puis Finished.
  tcpEnvoyer(usine, cx, certificat ? 860 : 120, "TLS certificat client + Finished");
  if (verdict) {
    tcpEnvoyer(usine, cx, 7 + TPMS.USINE.enTetes.tls, "TLS alerte " + verdict.alerte, "retour");
    tcpFermer(usine, cx, true);
    journaliser(usine, "courtier", "attention", "connexion refusée depuis " + usine.machines[cx.client].ip + " : " + verdict.texte);
    return { ok: false, alerte: verdict.alerte, texte: verdict.texte };
  }
  tcpEnvoyer(usine, cx, 80, "TLS NewSessionTicket", "retour");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 6. Le courtier MQTT
// ---------------------------------------------------------------------
function aclAutorise(utilisateur, acces, sujet) {
  return TPMS.ACL_COURTIER.some(function (r) {
    return r.utilisateur === utilisateur && (r.acces === acces || r.acces === "readwrite") && TPMS.mqttFiltreCorrespond(r.filtre, sujet);
  });
}

// Connexion MQTT complète d'une machine : TCP, TLS, CONNECT/CONNACK.
// options = { idClient, certificat (nom), testament: {sujet, message}, sessionPersistante }
// Retourne { ok, etape, texte, cx }.
function mqttConnecter(usine, machine, options) {
  var U = TPMS.USINE;
  var t = tcpOuvrir(usine, machine, "courtier", 8883);
  if (t.etat !== "open") return { ok: false, etape: "tcp", texte: t.etat === "filtered" ? "bloqué par le pare-feu" : t.etat === "closed" ? "courtier arrêté (port fermé)" : "courtier injoignable" };
  var cert = TPMS.usineCertificat(usine, options.certificat);
  var tls = tlsCourtier(usine, t.cx, cert);
  if (!tls.ok) return { ok: false, etape: "tls", alerte: tls.alerte, texte: "refusé par le courtier : " + tls.texte };
  // CONNECT (identifiant, testament) puis CONNACK.
  var octetsConnect = 14 + options.idClient.length + (options.testament ? 4 + options.testament.sujet.length + options.testament.message.length : 0);
  tcpEnvoyer(usine, t.cx, octetsConnect + U.enTetes.tls, "MQTT CONNECT");
  tcpEnvoyer(usine, t.cx, 4 + U.enTetes.tls, "MQTT CONNACK", "retour");
  var C = usine.courtier;
  var ancien = C.clients[options.idClient];
  if (ancien && ancien.cx.ouverte) {
    // Même identifiant : le courtier déconnecte l'ancien client (norme MQTT).
    tcpFermer(usine, ancien.cx, true);
    journaliser(usine, "courtier", "info", "client " + options.idClient + " déjà connecté : ancienne connexion fermée");
  }
  C.clients[options.idClient] = {
    idClient: options.idClient, utilisateur: cert.cn, ip: usine.machines[machine].ip, machine: machine, cx: t.cx,
    depuisMs: usine.tMs, dernierPaquetMs: usine.tMs, gardeS: U.mqtt.gardeS, testament: options.testament || null,
    sessionPersistante: !!options.sessionPersistante, publies: 0, refuses: 0
  };
  journaliser(usine, "courtier", "info", "nouvelle connexion de " + usine.machines[machine].ip + " : client " + options.idClient + ", certificat « " + cert.cn + " » (" + cert.emetteur + ")");
  return { ok: true, cx: t.cx, client: C.clients[options.idClient] };
}

// Le client publie ; le courtier applique l'ACL, distribue aux abonnés,
// garde le message s'il est « retenu », et accuse réception (QoS 1).
// Retourne { ok (PUBACK reçu), refuseAcl }.
function mqttPublier(usine, idClient, sujet, contenu, qos, retenu) {
  var U = TPMS.USINE;
  var C = usine.courtier, cl = C.clients[idClient];
  if (!cl || !cl.cx.ouverte) return { ok: false };
  var taille = TPMS.mqttTaillePublish(sujet, octetsUtf8(contenu), qos);
  if (!tcpEnvoyer(usine, cl.cx, taille + U.enTetes.tls, "MQTT PUBLISH " + sujet)) return { ok: false };
  if (!enMarche(usine.machines.courtier)) return { ok: false };
  cl.dernierPaquetMs = usine.tMs;
  C.messagesRecus++;
  var refuse = !aclAutorise(cl.utilisateur, "write", sujet);
  if (refuse) {
    cl.refuses++;
    C.refusAcl++;
    journaliser(usine, "courtier", "attention", "publication refusée (ACL) : « " + cl.utilisateur + " » sur " + sujet);
  } else {
    cl.publies++;
    if (retenu) C.retenus[sujet] = contenu;
    distribuer(usine, sujet, contenu);
  }
  // Mosquitto accuse réception même d'une publication refusée : MQTT 3.1.1
  // n'a pas de code de refus (MQTT 5 en a un).
  if (qos > 0 && !tcpEnvoyer(usine, cl.cx, 4 + U.enTetes.tls, "MQTT PUBACK", "retour")) return { ok: false };
  return { ok: true, refuseAcl: refuse };
}

// Distribution aux abonnés (la supervision, avec le droit de lecture).
function distribuer(usine, sujet, contenu) {
  var C = usine.courtier;
  Object.keys(C.abonnements).forEach(function (idClient) {
    var ab = C.abonnements[idClient];
    if (!ab.filtres.some(function (f) { return TPMS.mqttFiltreCorrespond(f, sujet); })) return;
    if (!aclAutorise(ab.utilisateur, "read", sujet)) return;
    var cl = C.clients[idClient];
    if (cl && cl.cx.ouverte) livrerAuClient(usine, cl, sujet, contenu);
    else if (ab.persistante) {
      // Client absent avec une session persistante : le courtier garde le
      // message (QoS 1), en mémoire (persistence false : perdu si le courtier redémarre).
      var file = C.enAttente[idClient] || (C.enAttente[idClient] = []);
      file.push({ sujet: sujet, contenu: contenu });
      if (file.length > 1000) file.shift();     // max_queued_messages de Mosquitto : 1 000 par défaut
    }
  });
}

function livrerAuClient(usine, cl, sujet, contenu) {
  var U = TPMS.USINE;
  var taille = TPMS.mqttTaillePublish(sujet, octetsUtf8(contenu), 1);
  if (!tcpEnvoyer(usine, cl.cx, taille + U.enTetes.tls, "MQTT PUBLISH " + sujet, "retour")) return false;
  tcpEnvoyer(usine, cl.cx, 4 + U.enTetes.tls, "MQTT PUBACK");
  cl.dernierPaquetMs = usine.tMs;
  if (cl.machine === "supervision") { usine.machines.supervision.supervision.derniereReponseMs = usine.tMs; recevoirSupervision(usine, sujet, contenu); }
  return true;
}

// Le courtier perd un client : fermeture franche (programme arrêté : le
// noyau envoie FIN/RST) ou silence (courant ou câble coupé : il ne le
// saura qu'à la fin du délai de garde). Sans DISCONNECT, il publie le testament.
function courtierPerdClient(usine, idClient, raison, proprement) {
  var C = usine.courtier, cl = C.clients[idClient];
  if (!cl) return;
  delete C.clients[idClient];
  if (!C.abonnements[idClient] || !C.abonnements[idClient].persistante) delete C.abonnements[idClient];
  journaliser(usine, "courtier", proprement ? "info" : "attention", "client " + idClient + " déconnecté : " + raison);
  if (!proprement && cl.testament && enMarche(usine.machines.courtier)) {
    journaliser(usine, "courtier", "attention", "testament de " + idClient + " publié sur " + cl.testament.sujet);
    C.retenus[cl.testament.sujet] = cl.testament.message;
    distribuer(usine, cl.testament.sujet, cl.testament.message);
  }
}

// ---------------------------------------------------------------------
// 7. Les passerelles
// ---------------------------------------------------------------------
function sujetPasserelle(id, type) { return "entrepot/lyon/passerelle/" + id + "/" + type; }

function etatPasserelle(usine, m, texte) {
  var p = m.passerelle;
  return JSON.stringify({ etat: texte, passerelle: p.id, zone: p.position.zone, version: "1.0", t: TPMS.usineHeure(usine, m.id),
    decalageNtpMs: p.decalageNtpMs, entendues: p.compteurs.entendues, lotsEnAttente: p.lotsEnAttente.length });
}

// Envoi au syslog central (UDP 514, format RFC 5424, sans accusé).
function syslog(usine, machine, gravite, texte) {
  var ligne = "<" + ({ erreur: 11, attention: 12, notice: 13, info: 14 }[gravite] || 14) + ">1 " +
    new Date(TPMS.usineHeure(usine, machine)).toISOString() + " " + machine + " passerelle - - - " + texte;
  var r = TPMS.usineEnvoyer(usine, { src: machine, dst: "syslog", proto: "udp", sport: 50514, dport: 514, octets: octetsUtf8(ligne), quoi: "syslog" });
  if (r.livre && enMarche(usine.machines.syslog)) {
    ajouterBorne(usine.journalCentral, { t: usine.tMs, tMachine: TPMS.usineHeure(usine, machine), source: machine, gravite: gravite, texte: texte }, 400);
  }
}

// SNTP : requête de 48 octets, réponse de 48 octets. La passerelle
// corrige son horloge ; l'écart mesuré est celui qu'elle annonce.
function reglerHeure(usine, m) {
  var p = m.passerelle;
  var req = TPMS.usineEnvoyer(usine, { src: m.id, dst: "ntp", proto: "udp", sport: 50123, dport: 123, octets: 48, quoi: "NTP requête" });
  if (!req.livre || !enMarche(usine.machines.ntp)) {
    syslog(usine, m.id, "attention", "NTP injoignable : délai dépassé");
    return false;
  }
  var rep = TPMS.usineEnvoyer(usine, { src: "ntp", dst: m.id, proto: "udp", sport: 123, dport: 50123, octets: 48, reponse: true, quoi: "NTP réponse" });
  if (!rep.livre) return false;
  // Écart mesuré = décalage réel de la passerelle par rapport au serveur
  // NTP, à l'asymétrie du chemin près (une fraction du temps d'aller-retour).
  var allerRetour = req.latenceMs + rep.latenceMs;
  var erreur = (req.latenceMs - rep.latenceMs) / 2;
  var ecart = -(m.horloge.decalageMs - usine.machines.ntp.horloge.decalageMs) + erreur;
  m.horloge.decalageMs += ecart;
  m.horloge.dernierReglageMs = usine.tMs;
  m.horloge.dernierEcartMs = ecart;
  p.decalageNtpMs = Math.round(ecart);
  var gravite = Math.abs(ecart) > TPMS.USINE.ntp.seuilAlerteMs ? "attention" : "info";
  syslog(usine, m.id, gravite, "heure NTP : décalage " + Math.round(ecart) + " ms (aller-retour " + allerRetour.toFixed(2).replace(".", ",") + " ms, strate 8)");
  return true;
}

function passerelleConnecter(usine, m) {
  var p = m.passerelle;
  p.compteurs.tentatives++;
  var r = mqttConnecter(usine, m.id, {
    idClient: m.id, certificat: m.id,
    testament: { sujet: sujetPasserelle(p.id, "etat"), message: JSON.stringify({ etat: "hors ligne", passerelle: p.id, zone: p.position.zone }) }
  });
  if (!r.ok) {
    syslog(usine, m.id, "erreur", "courtier injoignable ou connexion refusée : " + r.texte);
    p.prochaineTentativeMs = usine.tMs + p.attenteS * 1000 + (r.etape === "tcp" ? TPMS.USINE.mqtt.delaiConnexionS * 1000 : 0);
    p.attenteS = Math.min(TPMS.USINE.mqtt.reconnexionMaxS, p.attenteS * 2);
    return;
  }
  p.connexion = r.cx;
  p.attenteS = 1;
  p.derniereReponseMs = usine.tMs;
  p.prochainPingMs = usine.tMs + TPMS.USINE.mqtt.gardeS * 750;
  syslog(usine, m.id, "notice", "connectée au courtier (TLS, certificat " + m.id + ")" + (p.lotsEnAttente.length ? ", " + p.lotsEnAttente.length + " lot(s) à rattraper" : ""));
  mqttPublier(usine, m.id, sujetPasserelle(p.id, "etat"), etatPasserelle(usine, m, "en ligne"), 1, true);
  viderLots(usine, m);
}

// Vue de la PASSERELLE : sa connexion est ouverte (pas de FIN reçu). Elle ne
// voit pas qu'un courtier sans courant a disparu : seul le silence le dit
// (aucune réponse depuis 1,5 × la garde, voir passerelleUnPas).
function passerelleConnectee(usine, m) {
  var p = m.passerelle;
  return !!(p.connexion && p.connexion.ouverte);
}
function courtierConnait(usine, idClient, cx) {
  var cl = usine.courtier.clients[idClient];
  return !!(cl && cl.cx === cx && enMarche(usine.machines.courtier));
}

// Envoie les lots en attente dans l'ordre ; s'arrête au premier sans PUBACK.
// Sans PUBACK, le lot reste en tête de file : il sera renvoyé.
function viderLots(usine, m) {
  var p = m.passerelle;
  while (p.lotsEnAttente.length && passerelleConnectee(usine, m)) {
    var r = courtierConnait(usine, m.id, p.connexion) ? mqttPublier(usine, m.id, sujetPasserelle(p.id, "trames"), JSON.stringify(p.lotsEnAttente[0]), 1, false) : { ok: false };
    if (!r.ok) { tcpEnvoyerSansReponse(usine, m.id, p); return; }
    p.derniereReponseMs = usine.tMs;
    p.lotsEnAttente.shift();
    p.compteurs.lotsEnvoyes++;
  }
}
// Le paquet part quand même (le pare-feu le compte), mais rien ne revient.
function tcpEnvoyerSansReponse(usine, machine, p) {
  if (p.connexion) TPMS.usineEnvoyer(usine, { src: machine, dst: "courtier", proto: "tcp", sport: p.connexion.portClient, dport: 8883, octets: 200, quoi: "MQTT PUBLISH (sans réponse)" });
}

function perdreConnexionPasserelle(usine, m, raison) {
  var p = m.passerelle;
  if (!p.connexion) return;
  p.connexion.ouverte = false;
  p.connexion = null;
  syslog(usine, m.id, "attention", "connexion au courtier perdue (" + raison + ") : les lots sont gardés en attendant");
  p.prochaineTentativeMs = usine.tMs + p.attenteS * 1000;
  p.attenteS = Math.min(TPMS.USINE.mqtt.reconnexionMaxS, p.attenteS * 2);
}

// Démarrage (ou redémarrage) d'une passerelle : mémoire vide, horloge
// sans pile (quelques secondes d'écart), NTP, connexion.
function demarrerPasserelle(usine, m) {
  var p = m.passerelle;
  p.annonces = []; p.lotsEnAttente = []; p.connexion = null; p.attenteS = 1;
  p.prochaineTentativeMs = usine.tMs; p.prochainNtpMs = usine.tMs; p.prochainEtatMs = usine.tMs;
  p.prochainLotMs = usine.tMs + TPMS.USINE.mqtt.lotS * 1000; p.decalageNtpMs = null;
  m.horloge.decalageMs = Math.round((usine.alea() * 2 - 1) * TPMS.USINE.horloge.ecartDemarrageMs);
  syslog(usine, m.id, "info", "passerelle " + p.id + " (" + p.position.zone + ") démarrée, version 1.0");
}

// Un pas d'une passerelle (appelé chaque seconde).
function passerelleUnPas(usine, m) {
  var U = TPMS.USINE, p = m.passerelle, t = usine.tMs;
  if (!enMarche(m)) return;
  if (t >= p.prochainNtpMs) {
    reglerHeure(usine, m);
    p.prochainNtpMs = t + U.ntp.periodeS * 1000;
  }
  if (!passerelleConnectee(usine, m)) {
    if (p.connexion) perdreConnexionPasserelle(usine, m, "fermée par le courtier");
    if (t >= p.prochaineTentativeMs) passerelleConnecter(usine, m);
  }
  if (t >= p.prochainLotMs) {
    p.prochainLotMs += U.mqtt.lotS * 1000;
    if (p.annonces.length) {
      p.lotsEnAttente.push({ passerelle: p.id, site: "lyon", zone: p.position.zone, envoiMs: TPMS.usineHeure(usine, m.id), annonces: p.annonces });
      p.annonces = [];
      if (p.lotsEnAttente.length > U.mqtt.lotsMax) {
        p.lotsEnAttente.shift();
        p.compteurs.lotsPerdus++;
        syslog(usine, m.id, "erreur", "plus d'une heure de lots en attente : le plus ancien est perdu");
      }
      viderLots(usine, m);
    }
  }
  if (t >= p.prochainEtatMs) {
    p.prochainEtatMs = t + U.mqtt.etatS * 1000;
    if (passerelleConnectee(usine, m) && courtierConnait(usine, m.id, p.connexion) &&
        mqttPublier(usine, m.id, sujetPasserelle(p.id, "etat"), etatPasserelle(usine, m, "en ligne"), 1, true).ok) p.derniereReponseMs = t;
  }
  // Garde : un PINGREQ toutes les 22,5 s (0,75 × 30 s), même s'il y a du trafic.
  if (passerelleConnectee(usine, m) && t >= p.prochainPingMs) {
    p.prochainPingMs = t + U.mqtt.gardeS * 750;
    if (pinger(usine, m.id, p.connexion)) p.derniereReponseMs = t;
  }
  // Aucune réponse (PUBACK, PINGRESP) depuis 1,5 × la garde : courtier perdu.
  if (passerelleConnectee(usine, m) && t - p.derniereReponseMs > 1.5 * U.mqtt.gardeS * 1000) {
    tcpFermer(usine, p.connexion, false);
    perdreConnexionPasserelle(usine, m, "aucune réponse du courtier depuis " + 1.5 * U.mqtt.gardeS + " s");
  }
}

// PINGREQ / PINGRESP. Retourne true si la réponse est revenue.
function pinger(usine, idClient, cx) {
  var U = TPMS.USINE;
  if (!tcpEnvoyer(usine, cx, 2 + U.enTetes.tls, "MQTT PINGREQ")) return false;
  if (!courtierConnait(usine, idClient, cx)) return false;
  usine.courtier.clients[idClient].dernierPaquetMs = usine.tMs;
  return tcpEnvoyer(usine, cx, 2 + U.enTetes.tls, "MQTT PINGRESP", "retour");
}

// ---------------------------------------------------------------------
// 8. La supervision et le poste du bureau
// ---------------------------------------------------------------------
function recevoirSupervision(usine, sujet, contenu) {
  var s = usine.machines.supervision.supervision;
  if (!enMarche(usine.machines.supervision)) return;
  s.messages++;
  var probleme = s.reception.recevoirMessage(sujet, contenu, TPMS.usineHeure(usine, "supervision"));
  if (probleme) {
    s.lotsRefusesMqtt++;
    journaliser(usine, "supervision", "attention", "[mqtt] message refusé (" + sujet + ") : " + probleme);
  }
}

function supervisionUnPas(usine) {
  var U = TPMS.USINE, m = usine.machines.supervision, s = m.supervision, t = usine.tMs;
  if (!enMarche(m)) return;
  if (s.connexion && s.connexion.ouverte) {
    if (t >= s.prochainPingMs) {
      s.prochainPingMs = t + U.mqtt.gardeS * 750;
      if (pinger(usine, "serveur-supervision", s.connexion)) s.derniereReponseMs = t;
    }
    if (t - s.derniereReponseMs > 1.5 * U.mqtt.gardeS * 1000) {
      tcpFermer(usine, s.connexion, false);
      journaliser(usine, "supervision", "attention", "[mqtt] aucune réponse du courtier depuis " + 1.5 * U.mqtt.gardeS + " s : reconnexion");
      s.prochaineTentativeMs = t + U.mqtt.supervisionReessaiS * 1000;
    }
  }
  var connectee = s.connexion && s.connexion.ouverte;
  if (!connectee && t >= s.prochaineTentativeMs) {
    var r = mqttConnecter(usine, "supervision", { idClient: "serveur-supervision", certificat: "serveur-supervision", sessionPersistante: s.sessionPersistante });
    if (!r.ok) {
      journaliser(usine, "supervision", "attention", "[mqtt] courtier injoignable : " + r.texte);
      s.prochaineTentativeMs = t + TPMS.USINE.mqtt.supervisionReessaiS * 1000;
      return;
    }
    s.connexion = r.cx;
    s.derniereReponseMs = t;
    s.prochainPingMs = t + U.mqtt.gardeS * 750;
    journaliser(usine, "supervision", "info", "[mqtt] connecté au courtier 10.10.20.10:8883");
    // SUBSCRIBE aux trames et aux états ; le courtier envoie les messages retenus.
    var C = usine.courtier;
    tcpEnvoyer(usine, r.cx, 80 + TPMS.USINE.enTetes.tls, "MQTT SUBSCRIBE");
    tcpEnvoyer(usine, r.cx, 6 + TPMS.USINE.enTetes.tls, "MQTT SUBACK", "retour");
    var ab = C.abonnements["serveur-supervision"];
    C.abonnements["serveur-supervision"] = { utilisateur: "serveur-supervision", filtres: ["entrepot/+/passerelle/+/trames", "entrepot/+/passerelle/+/etat"], persistante: s.sessionPersistante };
    // Session persistante : les messages gardés pendant l'absence arrivent d'abord.
    var file = (ab && ab.persistante && C.enAttente["serveur-supervision"]) || [];
    if (file.length) journaliser(usine, "supervision", "info", "[mqtt] " + file.length + " message(s) gardés par le courtier pendant l'absence");
    delete C.enAttente["serveur-supervision"];
    var cl = C.clients["serveur-supervision"];
    file.forEach(function (msg) { livrerAuClient(usine, cl, msg.sujet, msg.contenu); });
    Object.keys(C.retenus).forEach(function (sujet) {
      if (/\/etat$/.test(sujet)) livrerAuClient(usine, cl, sujet, C.retenus[sujet]);
    });
  }
}

// Le responsable de maintenance garde la page ouverte : une lecture de
// l'API toutes les 5 s, sur une connexion HTTPS gardée ouverte.
function posteUnPas(usine) {
  var m = usine.machines.poste, P = m.poste, t = usine.tMs;
  if (!usine.posteActif || !enMarche(m) || t < P.prochaineLectureMs) return;
  P.prochaineLectureMs = t + TPMS.USINE.poste.periodeS * 1000;
  if (!P.connexion || !P.connexion.ouverte) {
    var o = tcpOuvrir(usine, "poste", "supervision", 8443);
    if (o.etat !== "open") { P.erreurs++; return; }
    P.connexion = o.cx;
    tcpEnvoyer(usine, o.cx, 520, "TLS ClientHello");
    tcpEnvoyer(usine, o.cx, 2400, "TLS ServerHello + certificat", "retour");
    tcpEnvoyer(usine, o.cx, 90, "TLS Finished");
  }
  if (!enMarche(usine.machines.supervision)) { P.erreurs++; tcpFermer(usine, P.connexion, false); P.connexion = null; return; }
  if (tcpEnvoyer(usine, P.connexion, 420 + TPMS.USINE.enTetes.tls, "HTTPS GET /api/chariots") &&
      tcpEnvoyer(usine, P.connexion, TPMS.USINE.poste.reponseOctets + TPMS.USINE.enTetes.tls, "HTTPS 200 /api/chariots", "retour")) P.lectures++;
  else P.erreurs++;
}

// Le courtier surveille le délai de garde : sans aucun paquet pendant
// 1,5 × la garde, le client est considéré comme disparu (testament).
function courtierUnPas(usine) {
  var C = usine.courtier;
  Object.keys(C.clients).forEach(function (id) {
    var cl = C.clients[id];
    if (usine.tMs - cl.dernierPaquetMs > 1.5 * cl.gardeS * 1000) {
      cl.cx.ouverte = false;
      courtierPerdClient(usine, id, "délai de garde dépassé (" + 1.5 * cl.gardeS + " s sans paquet)", false);
    }
  });
}

// ---------------------------------------------------------------------
// 9. La radio : qui entend quoi
// ---------------------------------------------------------------------
function diffuserAnnonces(usine, annonces) {
  var E = TPMS.ENTREPOT, b = usine.brouilleur;
  annonces.forEach(function (a) {
    usine.stats.annoncesEmises++;
    var d = TPMS.decoderTrame(a.octets);
    if (d) usine.dernieresAnnonces[a.chariot + " " + a.position] = { t: a.tMs, pression: d.pressionBar, temperature: d.temperatureC, pile: d.batteriePct };
    var trame = "";
    for (var i = 0; i < a.octets.length; i++) trame += (a.octets[i] < 16 ? "0" : "") + a.octets[i].toString(16);
    E.passerelles.forEach(function (pos) {
      var m = usine.machines["passerelle-" + pos.id], p = m.passerelle;
      if (!enMarche(m)) return;
      // Un brouilleur proche du chariot OU de la passerelle couvre l'annonce.
      if (b && (dist(b, a) < b.rayonM || dist(b, pos) < b.rayonM)) { usine.stats.annoncesBrouillees++; return; }
      var rssi = TPMS.entrepotRssi(pos, a.x, a.y, p.aleaRadio);
      if (rssi === null) { p.compteurs.horsPortee++; return; }
      p.compteurs.entendues++;
      usine.stats.annoncesEntendues++;
      (usine.derniersRssi[a.chariot] || (usine.derniersRssi[a.chariot] = {}))[pos.id] = { rssi: rssi, t: usine.tMs };
      p.annonces.push({ t: TPMS.usineHeure(usine, m.id), rssi: rssi, trame: trame });
    });
  });
}
function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

// ---------------------------------------------------------------------
// 10. Avancer le temps
// ---------------------------------------------------------------------
// Pas de 1 s : la radio, les passerelles, le courtier, la supervision et
// le poste avancent ensemble, dans cet ordre.
TPMS.usineAvancer = function (usine, jusquaMs) {
  while (usine.tMs + 1000 <= jusquaMs) {
    var annonces = TPMS.entrepotAvancer(usine.monde, usine.tMs + 1000, 1);
    usine.tMs = usine.monde.tMs;
    // Dérive des quartz.
    Object.keys(usine.machines).forEach(function (id) {
      var h = usine.machines[id].horloge;
      h.decalageMs += h.derivePpm * 1e-6 * 1000;
    });
    // Premier démarrage des passerelles AVANT la radio (sinon les annonces
    // entendues pendant la première seconde seraient effacées).
    TPMS.ENTREPOT.passerelles.forEach(function (pos) {
      var m = usine.machines["passerelle-" + pos.id];
      if (!m.demarree && enMarche(m)) { m.demarree = true; demarrerPasserelle(usine, m); }
    });
    diffuserAnnonces(usine, annonces);
    TPMS.ENTREPOT.passerelles.forEach(function (pos) { passerelleUnPas(usine, usine.machines["passerelle-" + pos.id]); });
    courtierUnPas(usine);
    supervisionUnPas(usine);
    posteUnPas(usine);
    technicienUnPas(usine);
    avancerEssais(usine);
    // Le suivi des connexions oublie les flux UDP inactifs depuis 30 s.
    if (usine.tMs % 30000 === 0) {
      Object.keys(usine.conntrack).forEach(function (cle) {
        if (cle.indexOf("udp") === 0 && usine.tMs - usine.conntrack[cle].dernierMs > 30000) delete usine.conntrack[cle];
      });
    }
  }
};

// ---------------------------------------------------------------------
// 10 bis. Le technicien de maintenance
// ---------------------------------------------------------------------
TPMS.USINE_TECHNICIEN = {
  heureTournee: 5.5,          // tournée de regonflage, chariots garés aux quais
  regonflerSousBar: 8.0,      // pression ramenée à 20 °C sous laquelle il regonfle
  controleMin: 5,             // il regarde la supervision toutes les 5 min pendant le poste
  delaiReparationMin: 20      // le temps d'aller au chariot et de réparer
};

function intervention(usine, chariot, position, texte) {
  var T = usine.technicien;
  ajouterBorne(T.interventions, { t: usine.tMs, chariot: chariot, position: position, texte: texte }, 200, true);
  journaliser(usine, "supervision", "info", "[maintenance] " + chariot + (position ? " " + position : "") + " : " + texte);
}

function technicienUnPas(usine) {
  var T = usine.technicien, U = TPMS.USINE_TECHNICIEN, E = TPMS.ENTREPOT;
  var sup = usine.machines.supervision;
  var h = TPMS.heureParis(usine.tMs);
  var jour = h.annee * 1000 + h.jourAn;
  function chariot(id) { return usine.monde.chariots.filter(function (c) { return c.id === id; })[0]; }
  var vue = enMarche(sup) ? sup.supervision.reception.etatDesPneus(TPMS.usineHeure(usine, "supervision")) : null;

  // Tournée du matin : il regonfle ce que la supervision lui montre.
  if (h.heure >= U.heureTournee && h.heure < U.heureTournee + 0.5 && T.derniereTourneeJour !== jour) {
    T.derniereTourneeJour = jour;
    if (!vue) { intervention(usine, "—", null, "tournée sans supervision (serveur arrêté) : rien à suivre"); }
    else Object.keys(vue).forEach(function (id) {
      var c = chariot(id);
      TPMS.POSITIONS_PNEU.forEach(function (pos) {
        var pn = vue[id].pneus[pos], pneu = c.pneus[pos];
        if (!pn || pn.etat === "ATTENTE" || pn.etat === "PERDU") {
          if (c.capteurs[pos].arrache) { c.capteurs[pos].arrache = false; intervention(usine, id, pos, "capteur manquant reposé"); }
          return;
        }
        var raison = pn.pression20 < U.regonflerSousBar ? "pression " + nombreFr(pn.pression20) + " bar à 20 °C"
          : (pn.etat === "BASSE" || pn.etat === "FUITE" || pn.etat === "FUITE_LENTE") ? "état « " + pn.etat + " »" : null;
        if (!raison) return;
        if (pneu.orifices.some(function (o) { return o.type === "micro"; }) && pn.etat === "FUITE_LENTE") {
          TPMS.pneuReparer(pneu);
          raison += ", fuite trouvée et réparée";
        }
        var avant = pneu.pressionRelBar;
        TPMS.regonflerPneu(pneu, E.pressionNominaleBar);
        intervention(usine, id, pos, "regonflé de " + nombreFr(avant) + " à " + nombreFr(pneu.pressionRelBar) + " bar (" + raison + ")");
      });
    });
  }

  // Pendant le poste : une crevaison signalée immobilise le chariot, le
  // technicien arrive, répare et regonfle.
  if (usine.tMs >= T.prochainControleMs) {
    T.prochainControleMs = usine.tMs + U.controleMin * 60000;
    if (vue) Object.keys(vue).forEach(function (id) {
      TPMS.POSITIONS_PNEU.forEach(function (pos) {
        var pn = vue[id].pneus[pos], cle = id + " " + pos;
        if (pn && pn.etat === "CREVAISON" && !T.aReparer[cle]) {
          T.aReparer[cle] = usine.tMs + U.delaiReparationMin * 60000;
          chariot(id).immobiliseJusquaMs = T.aReparer[cle];
          intervention(usine, id, pos, "crevaison signalée : chariot arrêté, intervention dans " + U.delaiReparationMin + " min");
        }
      });
    });
  }
  Object.keys(T.aReparer).forEach(function (cle) {
    if (usine.tMs < T.aReparer[cle]) return;
    var morceaux = cle.split(" "), c = chariot(morceaux[0]), pneu = c.pneus[morceaux[1]];
    TPMS.pneuReparer(pneu);
    TPMS.regonflerPneu(pneu, E.pressionNominaleBar);
    c.immobiliseJusquaMs = 0;
    delete T.aReparer[cle];
    intervention(usine, morceaux[0], morceaux[1], "crevaison réparée, pneu regonflé à " + nombreFr(pneu.pressionRelBar) + " bar");
  });
}
function nombreFr(x) { return (Math.round(x * 100) / 100).toFixed(2).replace(".", ","); }

// Événements sur les chariots (actions de l'opérateur du simulateur).
// type : « clou » (crevaison franche), « valve » (valve arrachée).
TPMS.usineCrevaison = function (usine, chariotId, position, type) {
  var c = usine.monde.chariots.filter(function (x) { return x.id === chariotId; })[0];
  if (!c) return;
  TPMS.pneuPercer(c.pneus[position], type === "valve" ? { type: "valve" } : { type: "epine", diametreMm: 1.5 });
  journaliser(usine, "supervision", "info", "[simulation] " + chariotId + " " + position + " : " + (type === "valve" ? "valve arrachée" : "clou dans le pneu"));
};
TPMS.usineArracherCapteur = function (usine, chariotId, position) {
  var c = usine.monde.chariots.filter(function (x) { return x.id === chariotId; })[0];
  if (!c) return;
  c.capteurs[position].arrache = true;
  journaliser(usine, "supervision", "info", "[simulation] " + chariotId + " " + position + " : capteur arraché (choc contre un rack)");
};

// ---------------------------------------------------------------------
// 11. Pannes (actions de l'opérateur du simulateur)
// ---------------------------------------------------------------------
// nom : « couper-courant », « plantage », « debrancher », « rebrancher »
// (rétablit courant, câble et programme), « derive-horloge ».
TPMS.usinePanne = function (usine, idMachine, nom) {
  var m = usine.machines[idMachine];
  if (!m) return;
  var C = usine.courtier;
  function clientsDe(machine) { return Object.keys(C.clients).filter(function (id) { return C.clients[id].machine === machine; }); }
  if (nom === "plantage") {
    // Programme arrêté : le système ferme ses connexions (FIN/RST), le
    // courtier le sait aussitôt.
    m.programme = false;
    clientsDe(idMachine).forEach(function (id) { tcpFermer(usine, C.clients[id].cx, true); courtierPerdClient(usine, id, "connexion fermée par le client sans DISCONNECT", false); });
    if (idMachine === "courtier") Object.keys(C.clients).forEach(function (id) { tcpFermer(usine, C.clients[id].cx, true); courtierPerdClient(usine, id, "courtier arrêté", true); });
    if (idMachine === "courtier") { C.retenus = {}; C.enAttente = {}; C.abonnements = {}; }
    if (m.passerelle) { m.passerelle.annonces = []; m.passerelle.lotsEnAttente = []; }
    if (m.supervision && m.supervision.connexion) m.supervision.connexion.ouverte = false;
  } else if (nom === "couper-courant" || nom === "debrancher") {
    // Plus rien ne sort : les autres ne le sauront qu'à la fin des délais.
    if (nom === "couper-courant") m.alimentee = false; else m.cable = false;
    if (idMachine === "courtier" && nom === "couper-courant") { C.clients = {}; C.retenus = {}; C.enAttente = {}; C.abonnements = {}; }
    if (m.passerelle && nom === "couper-courant") { m.passerelle.annonces = []; m.passerelle.lotsEnAttente = []; }
  } else if (nom === "rebrancher") {
    var redemarre = !m.alimentee || !m.programme;
    m.alimentee = true; m.cable = true; m.programme = true;
    if (m.passerelle && redemarre) demarrerPasserelle(usine, m);
    if (idMachine === "courtier" && redemarre) journaliser(usine, "courtier", "info", "mosquitto démarré : port 8883 (TLS, certificat client exigé)");
    if (idMachine === "supervision" && redemarre) {
      m.supervision.connexion = null; m.supervision.prochaineTentativeMs = usine.tMs;
      creerReceptionSupervision(usine);
      journaliser(usine, "supervision", "info", "serveur redémarré : état des pneus en mémoire remis à zéro (la base garde l'historique)");
    }
  } else if (nom === "derive-horloge") {
    // Horloge faussée (pile de l'horloge morte, réglage manuel erroné) : +90 s.
    m.horloge.decalageMs += 90000;
  }
  journaliser(usine, idMachine === "courtier" ? "courtier" : "supervision", "info", "[simulation] " + idMachine + " : " + nom);
};

// Brouilleur radio (x, y en mètres, rayon) ou null pour l'arrêter.
TPMS.usineBrouiller = function (usine, brouilleur) { usine.brouilleur = brouilleur; };

// Révocation d'un certificat (PROPOSITION : la maquette n'a pas encore de
// liste de révocation ; le courtier la consulterait à chaque connexion).
TPMS.usineRevoquer = function (usine, cn) {
  usine.revocations[cn] = true;
  var cl = usine.courtier.clients[cn];
  journaliser(usine, "courtier", "notice", "certificat « " + cn + " » ajouté à la liste de révocation");
  if (cl) { tcpFermer(usine, cl.cx, true); courtierPerdClient(usine, cn, "certificat révoqué", false); }
  Object.keys(usine.courtier.clients).forEach(function (id) {
    var c = usine.courtier.clients[id];
    if (c && c.utilisateur === cn) { tcpFermer(usine, c.cx, true); courtierPerdClient(usine, id, "certificat révoqué", false); }
  });
};

// ---------------------------------------------------------------------
// 12. Les essais de sécurité et de continuité (attaques jouables)
// ---------------------------------------------------------------------
// Les 13 essais de entrepot/demonstration.js, plus 6 que seule la
// simulation permet de rejouer. Chaque essai : ce qui est tenté, ce qu'on
// attend, puis ce qu'on obtient (avec sa preuve). Un essai « Limite »
// montre un risque résiduel assumé : il est conforme s'il le montre.

// Même règle que cheminInterdit de serveur/serveur.js (un test le vérifie).
TPMS.usineCheminInterdit = function (chemin) {
  var morceaux = chemin.split("/").filter(Boolean).map(function (m) { return m.toLowerCase(); });
  if (morceaux[0] === "serveur" || morceaux[0] === "node_modules") return true;
  if (morceaux[0] === "entrepot" && ["certificats", "donnees", "journaux"].indexOf(morceaux[1]) >= 0) return true;
  var dernier = morceaux[morceaux.length - 1] || "";
  var ext = dernier.lastIndexOf(".") > 0 ? dernier.slice(dernier.lastIndexOf(".")) : "";
  if ([".cle", ".key", ".db", ".sqlite", ".srl", ".csr"].indexOf(ext) >= 0) return true;
  return morceaux.some(function (m) { return m.charAt(0) === "."; });
};

function brancherIntrus(usine) {
  var m = usine.machines.intrus;
  if (!m.alimentee) journaliser(usine, "pare-feu", "info", "[simulation] un PC inconnu est branché sur une prise de l'atelier (10.10.10.66)");
  m.alimentee = true; m.cable = true; m.programme = true;
}
function compteur(usine, nom) { var r = usine.regles.filter(function (x) { return x.nom === nom; })[0]; return r ? r.paquets : 0; }
function compteurs(usine) { return Object.assign({}, usine.machines.supervision.supervision.reception.compteurs); }
function trameHexa(adresse, pressionBar) {
  var octets = TPMS.encoderTrame({ numero: 1, adresse: adresse.split(":").map(function (h) { return parseInt(h, 16); }),
    pressionBar: pressionBar, temperatureC: 15, batteriePct: 80, alarme: 0 });
  var s = "";
  for (var i = 0; i < octets.length; i++) s += (octets[i] < 16 ? "0" : "") + octets[i].toString(16);
  return s;
}
// L'intrus publie avec le certificat VOLÉ de la passerelle 1.
function publierVole(usine, sujet, objet) {
  brancherIntrus(usine);
  var id = "intrus-" + (usine.prochainId++);
  var r = mqttConnecter(usine, "intrus", { idClient: id, certificat: "passerelle-1" });
  if (!r.ok) return { connexion: r };
  var p = mqttPublier(usine, id, sujet, typeof objet === "string" ? objet : JSON.stringify(objet), 1, false);
  tcpEnvoyer(usine, r.cx, 2 + TPMS.USINE.enTetes.tls, "MQTT DISCONNECT");
  tcpFermer(usine, r.cx, true);
  courtierPerdClient(usine, id, "DISCONNECT", true);
  return { connexion: r, publication: p };
}
function lotVole(usine, annonces, passerelleAnnoncee) {
  return { passerelle: passerelleAnnoncee || 1, site: "lyon", zone: "quais", envoiMs: TPMS.usineHeure(usine, "intrus"), annonces: annonces };
}
function nmap(usine, depuis, cible, ports) {
  return ports.map(function (port) { var o = tcpOuvrir(usine, depuis, cible, port); if (o.cx) tcpFermer(usine, o.cx, true); return port + "/tcp " + o.etat; });
}
function attendreEtat(usine, idPasserelle, etat) {
  var q = usine.machines.supervision.supervision.passerelles[idPasserelle];
  return q && q.etat === etat;
}
function lotsPerdus(u) { return TPMS.ENTREPOT.passerelles.reduce(function (n, p) { return n + u.machines["passerelle-" + p.id].passerelle.compteurs.lotsPerdus; }, 0); }

TPMS.USINE_ESSAIS = [
  { id: "balayage-bureau", couche: "Pare-feu", titre: "Un poste du bureau balaie une passerelle de l'atelier (nmap)",
    attendu: "ports « filtered » : rien ne passe du bureau vers l'atelier",
    lancer: function (u) {
      var avant = compteur(u, "REFUS bureautique vers OT");
      var r = nmap(u, "poste", "passerelle-1", [22, 80, 1883, 8883]);
      var plus = compteur(u, "REFUS bureautique vers OT") - avant;
      return { ok: r.every(function (x) { return /filtered/.test(x); }) && plus === 4, obtenu: r.join(", ") + " ; compteur « REFUS bureautique vers OT » +" + plus };
    } },
  { id: "bureau-courtier", couche: "Pare-feu", titre: "Un poste du bureau vise le courtier MQTT",
    attendu: "refusé : seules les passerelles parlent au courtier",
    lancer: function (u) {
      var avant = compteur(u, "REFUS bureautique vers courtier");
      var r = nmap(u, "poste", "courtier", [8883]);
      var plus = compteur(u, "REFUS bureautique vers courtier") - avant;
      return { ok: /filtered/.test(r[0]) && plus === 1, obtenu: r[0] + " ; compteur « REFUS bureautique vers courtier » +" + plus };
    } },
  { id: "intrus-supervision", couche: "Pare-feu", titre: "L'intrus branché sur l'atelier vise la page de supervision",
    attendu: "refusé : l'atelier n'a pas à lire la supervision",
    lancer: function (u) {
      brancherIntrus(u);
      var avant = compteur(u, "REFUS OT vers supervision");
      var r = nmap(u, "intrus", "supervision", [8443]);
      var plus = compteur(u, "REFUS OT vers supervision") - avant;
      return { ok: /filtered/.test(r[0]) && plus === 1, obtenu: r[0] + " ; compteur « REFUS OT vers supervision » +" + plus };
    } },
  { id: "cle-privee", couche: "Serveur web", titre: "Un poste du bureau réclame la clé privée du courtier à la supervision",
    attendu: "403, même en changeant les majuscules",
    lancer: function (u) {
      var codes = ["/entrepot/certificats/courtier.cle", "/Entrepot/Certificats/courtier.cle", "/entrepot/journaux/central.log"].map(function (chemin) {
        var o = tcpOuvrir(u, "poste", "supervision", 8443);
        if (o.etat !== "open") return o.etat;
        tcpEnvoyer(u, o.cx, 600, "TLS + HTTPS GET " + chemin);
        var code = TPMS.usineCheminInterdit(chemin) ? 403 : 200;
        tcpEnvoyer(u, o.cx, code === 403 ? 160 : 4000, "HTTPS " + code, "retour");
        tcpFermer(u, o.cx, true);
        return String(code);
      });
      return { ok: codes.every(function (c) { return c === "403"; }), obtenu: "codes HTTP : " + codes.join(", ") };
    } },
  { id: "sans-certificat", couche: "Courtier", titre: "L'intrus se connecte au courtier sans certificat",
    attendu: "le pare-feu laisse passer (8883 est ouvert à l'atelier), le courtier refuse (TLS mutuel)",
    lancer: function (u) {
      brancherIntrus(u);
      var r = mqttConnecter(u, "intrus", { idClient: "intrus-anonyme" });
      return { ok: !r.ok && r.alerte === 116, obtenu: r.ok ? "ACCEPTÉ !" : r.texte };
    } },
  { id: "ac-pirate", couche: "Courtier", titre: "L'intrus présente un certificat fabriqué par une AC pirate",
    attendu: "refusé : le courtier ne fait confiance qu'à l'AC de l'usine",
    lancer: function (u) {
      brancherIntrus(u);
      var r = mqttConnecter(u, "intrus", { idClient: "passerelle-9", certificat: "passerelle-9" });
      return { ok: !r.ok && r.alerte === 48, obtenu: r.ok ? "ACCEPTÉ !" : r.texte };
    } },
  { id: "usurpation", couche: "Courtier", titre: "Avec le certificat volé de la passerelle 1, l'intrus publie au nom de la passerelle 2",
    attendu: "le courtier jette le message (ACL) : la supervision ne reçoit rien",
    lancer: function (u) {
      var s = u.machines.supervision.supervision, avant = s.messages, refusAvant = u.courtier.refusAcl;
      var r = publierVole(u, sujetPasserelle(2, "trames"), lotVole(u, [], 2));
      if (!r.publication) return { ok: false, obtenu: "connexion impossible : " + r.connexion.texte };
      return { ok: r.publication.refuseAcl && s.messages === avant, obtenu: "PUBACK reçu (MQTT 3.1.1 ne signale pas le refus) ; refus ACL au courtier +" + (u.courtier.refusAcl - refusAvant) + " ; messages reçus par la supervision +" + (s.messages - avant) };
    } },
  { id: "faux-lot", couche: "Serveur", titre: "Certificat volé : un lot qui se dit de la passerelle 2, publié sur le sujet de la 1",
    attendu: "accepté par le courtier, refusé par le serveur (sujet ≠ contenu)",
    lancer: function (u) {
      var avant = compteurs(u);
      var reg = TPMS.entrepotRegistreCapteurs(u.monde)[0];
      var r = publierVole(u, sujetPasserelle(1, "trames"), lotVole(u, [{ t: TPMS.usineHeure(u, "intrus"), rssi: -60, trame: trameHexa(reg.adresse, 8.5) }], 2));
      if (!r.publication) return { ok: false, obtenu: "connexion impossible : " + r.connexion.texte };
      var plus = compteurs(u).lotsRefuses - avant.lotsRefuses;
      return { ok: plus === 1, obtenu: "lots refusés par le serveur +" + plus };
    } },
  { id: "capteur-inconnu", couche: "Serveur", titre: "Certificat volé : la trame d'un capteur posé sur aucun chariot",
    attendu: "ignorée par la liste blanche du serveur",
    lancer: function (u) {
      var avant = compteurs(u);
      var r = publierVole(u, sujetPasserelle(1, "trames"), lotVole(u, [{ t: TPMS.usineHeure(u, "intrus"), rssi: -60, trame: trameHexa("C4:10:99:00:01", 8.5) }]));
      if (!r.publication) return { ok: false, obtenu: "connexion impossible : " + r.connexion.texte };
      var plus = compteurs(u).inconnues - avant.inconnues;
      return { ok: plus === 1, obtenu: "capteurs inconnus +" + plus };
    } },
  { id: "valeur-aberrante", couche: "Serveur", titre: "Certificat volé : un vrai pneu annoncé à 20 bar",
    attendu: "rejetée par la vraisemblance (capteurs 0-13 bar) : la pression affichée ne change pas",
    lancer: function (u) {
      var reg = TPMS.entrepotRegistreCapteurs(u.monde)[0];
      var s = u.machines.supervision.supervision;
      function pression() { var p = s.reception.etatDesPneus(TPMS.usineHeure(u, "supervision"))[reg.chariot]; return p && p.pneus[reg.position] ? p.pneus[reg.position].pression : undefined; }
      var avant = compteurs(u);
      var r = publierVole(u, sujetPasserelle(1, "trames"), lotVole(u, [{ t: TPMS.usineHeure(u, "intrus"), rssi: -60, trame: trameHexa(reg.adresse, 20) }]));
      if (!r.publication) return { ok: false, obtenu: "connexion impossible : " + r.connexion.texte };
      var pApres = pression();
      var plus = compteurs(u).invraisemblables - avant.invraisemblables;
      return { ok: plus === 1 && pApres !== 20, obtenu: "invraisemblables +" + plus + " ; pression affichée de " + reg.chariot + " " + reg.position + " : " + (pApres === undefined ? "en attente" : String(pApres).replace(".", ",") + " bar") };
    } },
  { id: "rejeu", couche: "Serveur", titre: "Certificat volé : des annonces vieilles de 3 h rejouées",
    attendu: "refusées : l'horodatage NTP trahit le rejeu",
    lancer: function (u) {
      var avant = compteurs(u);
      var reg = TPMS.entrepotRegistreCapteurs(u.monde)[0];
      var r = publierVole(u, sujetPasserelle(1, "trames"), lotVole(u, [{ t: TPMS.usineHeure(u, "intrus") - 3 * 3600000, rssi: -60, trame: trameHexa(reg.adresse, 8.5) }]));
      if (!r.publication) return { ok: false, obtenu: "connexion impossible : " + r.connexion.texte };
      var plus = compteurs(u).lotsRefuses - avant.lotsRefuses;
      return { ok: plus === 1, obtenu: "lots refusés +" + plus };
    } },
  { id: "plantage-passerelle", couche: "Continuité", titre: "Le programme de la passerelle 2 plante",
    attendu: "le système ferme la connexion : testament publié, « hors ligne » aussitôt",
    lancer: function (u, e) { TPMS.usinePanne(u, "passerelle-2", "plantage"); return null; },
    suivre: function (u, e) {
      if (attendreEtat(u, 2, "hors ligne")) { TPMS.usinePanne(u, "passerelle-2", "rebrancher"); return { ok: u.tMs - e.debutMs <= 1000, obtenu: "« hors ligne » sur la supervision après " + Math.round((u.tMs - e.debutMs) / 1000) + " s ; passerelle relancée" }; }
      if (u.tMs - e.debutMs > 120000) { TPMS.usinePanne(u, "passerelle-2", "rebrancher"); return { ok: false, obtenu: "jamais vue « hors ligne »" }; }
      return null;
    } },
  { id: "courtier-arrete", couche: "Continuité", titre: "Le courtier est arrêté 30 s",
    attendu: "les passerelles gardent leurs lots et les rattrapent : aucune mesure perdue",
    lancer: function (u, e) { e.perdus = lotsPerdus(u); TPMS.usinePanne(u, "courtier", "plantage"); return null; },
    suivre: function (u, e) {
      if (!e.relance && u.tMs - e.debutMs >= 30000) { e.relance = true; TPMS.usinePanne(u, "courtier", "rebrancher"); }
      if (!e.relance) return null;
      var rattrapages = u.journalCentral.filter(function (l) { return l.t > e.debutMs && /lot\(s\) à rattraper/.test(l.texte); });
      var attente = TPMS.ENTREPOT.passerelles.reduce(function (n, p) { return n + u.machines["passerelle-" + p.id].passerelle.lotsEnAttente.length; }, 0);
      if (rattrapages.length >= 3 && attente === 0) {
        return { ok: lotsPerdus(u) === e.perdus, obtenu: rattrapages.map(function (l) { return l.source + " : " + /(\d+) lot/.exec(l.texte)[1] + " lots"; }).join(", ") + " rattrapés ; " + (lotsPerdus(u) - e.perdus) + " lot perdu" };
      }
      if (u.tMs - e.debutMs > 180000) return { ok: false, obtenu: "rattrapage incomplet (" + attente + " lots encore en attente)" };
      return null;
    } },
  // ---- Essais que seule la simulation permet de rejouer ----
  { id: "courant-passerelle", couche: "Continuité", titre: "La passerelle 2 perd son alimentation (pas de FIN)",
    attendu: "le courtier ne le voit qu'à la fin du délai de garde (45 s), puis publie le testament",
    lancer: function (u, e) { TPMS.usinePanne(u, "passerelle-2", "couper-courant"); return null; },
    suivre: function (u, e) {
      if (attendreEtat(u, 2, "hors ligne")) {
        var d = Math.round((u.tMs - e.debutMs) / 1000);
        TPMS.usinePanne(u, "passerelle-2", "rebrancher");
        return { ok: d >= 20 && d <= 50, obtenu: "« hors ligne » après " + d + " s (dernier paquet reçu + 45 s) ; passerelle remise sous tension (ses lots en mémoire sont perdus)" };
      }
      if (u.tMs - e.debutMs > 180000) { TPMS.usinePanne(u, "passerelle-2", "rebrancher"); return { ok: false, obtenu: "jamais vue « hors ligne »" }; }
      return null;
    } },
  { id: "balayage-atelier", couche: "Limite", titre: "L'intrus balaie une passerelle voisine, dans l'atelier",
    attendu: "LIMITE : dans une même zone, le pare-feu ne voit rien ; les ports répondent « closed » (aucun service ouvert, rien à attaquer)",
    lancer: function (u) {
      brancherIntrus(u);
      var r = nmap(u, "intrus", "passerelle-3", [22, 80, 1883, 8883]);
      return { ok: r.every(function (x) { return /closed/.test(x); }), obtenu: r.join(", ") + " : joignable, mais rien n'écoute (une micro-segmentation serait l'étape suivante)" };
    } },
  { id: "horloge-faussee", couche: "Heure", titre: "L'horloge de la passerelle 3 avance soudain de 90 s",
    attendu: "ses lots sont refusés (« datés du futur ») jusqu'au prochain réglage NTP (10 min au plus)",
    lancer: function (u, e) { e.refus = compteurs(u).lotsRefuses; TPMS.usinePanne(u, "passerelle-3", "derive-horloge"); return null; },
    suivre: function (u, e) {
      var m = u.machines["passerelle-3"];
      if (m.horloge.dernierReglageMs > e.debutMs && Math.abs(m.horloge.decalageMs) < 1000) {
        var refus = compteurs(u).lotsRefuses - e.refus;
        return { ok: refus > 0, obtenu: refus + " lot(s) refusés pendant " + Math.round((m.horloge.dernierReglageMs - e.debutMs) / 1000) + " s, puis l'heure est corrigée par NTP (écart mesuré " + m.passerelle.decalageNtpMs + " ms)" };
      }
      if (u.tMs - e.debutMs > 700000) return { ok: false, obtenu: "horloge jamais corrigée" };
      return null;
    } },
  { id: "brouillage", couche: "Radio", titre: "Un brouilleur 2,4 GHz est allumé au milieu des allées (rayon 15 m), pendant 11 min",
    attendu: "les capteurs couverts deviennent « capteur perdu » après 10 min : on ne peut pas l'empêcher, mais on le voit",
    lancer: function (u, e) { TPMS.usineBrouiller(u, { x: 60, y: 15, rayonM: 15 }); return null; },
    suivre: function (u, e) {
      if (u.tMs - e.debutMs < 11 * 60000) return null;
      var pneus = u.machines.supervision.supervision.reception.etatDesPneus(TPMS.usineHeure(u, "supervision"));
      var perdus = Object.keys(pneus).filter(function (id) { return pneus[id].etat === "PERDU"; });
      TPMS.usineBrouiller(u, null);
      return { ok: true, obtenu: (perdus.length ? "chariots en « capteur perdu » : " + perdus.join(", ") : "aucun chariot resté 10 min dans la zone brouillée") + " ; " + u.stats.annoncesBrouillees + " annonces brouillées depuis le début ; brouilleur arrêté" };
    } },
  { id: "supervision-redemarre", couche: "Continuité", titre: "Le serveur de supervision redémarre (60 s d'arrêt)",
    attendu: "session MQTT persistante : le courtier garde les messages, rien n'est perdu",
    lancer: function (u, e) { TPMS.usinePanne(u, "supervision", "plantage"); return null; },
    suivre: function (u, e) {
      if (!e.relance && u.tMs - e.debutMs >= 60000) { e.relance = true; TPMS.usinePanne(u, "supervision", "rebrancher"); }
      if (!e.relance || u.tMs - e.debutMs < 75000) return null;
      var garde = u.journalSupervision.filter(function (l) { return l.t > e.debutMs && /gardés par le courtier/.test(l.texte); })[0];
      var n = garde ? Number(/(\d+) message/.exec(garde.texte)[1]) : 0;
      var persistante = u.machines.supervision.supervision.sessionPersistante;
      return { ok: persistante ? n > 0 : n === 0, obtenu: persistante ? n + " message(s) gardés par le courtier pendant l'arrêt, livrés au redémarrage" : "session propre : les messages de l'arrêt sont PERDUS (les passerelles ont pourtant reçu leur PUBACK)" };
    } },
  { id: "inondation", couche: "Limite", titre: "Certificat volé : 2 000 lots publiés d'un coup",
    attendu: "LIMITE : pas de limite de débit par client MQTT ; le serveur trie, mais encaisse tout",
    lancer: function (u) {
      var s = u.machines.supervision.supervision, avant = s.messages;
      brancherIntrus(u);
      var id = "intrus-" + (u.prochainId++);
      var r = mqttConnecter(u, "intrus", { idClient: id, certificat: "passerelle-1" });
      if (!r.ok) return { ok: false, obtenu: "connexion impossible : " + r.texte };
      for (var i = 0; i < 2000; i++) mqttPublier(u, id, sujetPasserelle(1, "trames"), JSON.stringify(lotVole(u, [])), 1, false);
      tcpFermer(u, r.cx, true); courtierPerdClient(u, id, "DISCONNECT", true);
      return { ok: s.messages - avant === 2000, obtenu: (s.messages - avant) + " lots reçus par la supervision en un instant (S31 : il faudrait une limite de débit au courtier et une alerte)" };
    } },
  { id: "revocation", couche: "Courtier", titre: "PROPOSITION : le certificat volé de la passerelle 1 est révoqué",
    attendu: "l'intrus est refusé (alerte TLS 44) ; la vraie passerelle 1 aussi, jusqu'à son nouveau certificat",
    lancer: function (u) {
      brancherIntrus(u);
      TPMS.usineRevoquer(u, "passerelle-1");
      var r = mqttConnecter(u, "intrus", { idClient: "intrus-revoque", certificat: "passerelle-1" });
      delete u.revocations["passerelle-1"];
      return { ok: !r.ok && r.alerte === 44, obtenu: (r.ok ? "ACCEPTÉ !" : r.texte) + " ; révocation levée ensuite (la simulation suppose un nouveau certificat posé)" };
    } }
];

// Lance un essai ; les essais instantanés ont leur résultat aussitôt.
TPMS.usineLancerEssai = function (usine, id) {
  var def = TPMS.USINE_ESSAIS.filter(function (d) { return d.id === id; })[0];
  if (!def) return null;
  var e = { id: id, def: def, debutMs: usine.tMs, resultat: null };
  e.resultat = def.lancer(usine, e);
  if (e.resultat) e.finMs = usine.tMs;
  usine.essais.unshift(e);
  return e;
};

function avancerEssais(usine) {
  usine.essais.forEach(function (e) {
    if (e.resultat || !e.def.suivre) return;
    e.resultat = e.def.suivre(usine, e);
    if (e.resultat) e.finMs = usine.tMs;
  });
}
