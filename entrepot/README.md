# Entrepôt : la version industrielle et sa maquette réseau

Surveillance des pneus gonflables d'une flotte de **chariots élévateurs** : chaque pneu porte un capteur TPMS Bluetooth (le même principe que sur le vélo, en version « poids lourd » 0-13 bar), des **passerelles** fixées au plafond écoutent les capteurs et remontent les trames en **MQTT sur TLS** jusqu'à la **supervision**, à travers un réseau d'usine découpé en zones par un **pare-feu**. La conception est expliquée dans [`docs/orientation-industrielle.md`](../docs/orientation-industrielle.md).

Ce dossier contient trois choses :

- le **code** de la version industrielle, en JavaScript simple, testé sans Docker (`node entrepot/entrepot.tests.js`) ;
- le **simulateur de l'usine** (`simulateur.html`, en ligne : https://titilyonnais.github.io/tpms-velo/entrepot/simulateur.html) : toute l'usine dans le navigateur, machine par machine et paquet par paquet, avec 20 attaques et pannes jouables (§ 7) ;
- la **maquette Docker** : tout le réseau de l'usine sur un PC, lancé par une seule commande.

## 1. Les programmes

| Fichier | Rôle |
|---|---|
| `chariots.js` | Modèle de l'entrepôt simulé (120 m × 30 m, 3 zones, 8 chariots à 4 pneus chargés jusqu'à 2 t, échauffement des pneus selon la charge, météo de la cour selon le mois, chauffage réduit la nuit, capteurs en mode rapide au démarrage, piles qui s'usent, heure de Paris) ; marche aussi dans le navigateur |
| `usine.js` | **Simulation complète de l'usine** (logique pure, testée) : radio et brouilleur, passerelles (SNTP, MQTT, stocker puis transmettre), pare-feu avec les règles de `regles.nft` et le suivi des connexions, courtier (certificats, ACL, QoS 1, testament, messages retenus, session persistante), horloges qui dérivent, journaux, supervision, poste du bureau, technicien qui suit la supervision, 20 essais |
| `simulateur.html`, `simulateur.js`, `simulateur.css` | Interface du simulateur de l'usine (8 pages) |
| `monde.js` | Conteneur « monde » : fait vivre l'entrepôt et diffuse chaque annonce Bluetooth sur le réseau « air » (la radio simulée) |
| `passerelle.js` | Une passerelle BLE → MQTT : heure par SNTP, connexion TLS avec son certificat et un testament, un lot toutes les 10 s en QoS 1, 1 h de lots gardés si le courtier tombe, journal syslog |
| `mqtt.js` | Client MQTT 3.1.1 écrit à la main (sans bibliothèque, pour pouvoir l'expliquer octet par octet) |
| `reseau.js` | Client SNTP (RFC 4330) et envoi au syslog (RFC 5424) |
| `reception.js` | **Logique pure** de réception des lots (vérification, décodage, liste blanche, vraisemblance, dédoublonnage, zone, état des pneus) : utilisée par le serveur (`serveur/chariots.js`, qui enregistre en SQLite) et par le mode démo de la page `flotte/chariots.html` |
| `intrus.js` | Ce que tente un pirate branché sur l'atelier (lancé par la démonstration) |
| `demonstration.js` | Les 14 essais de sécurité commentés, sur la maquette Docker |
| `usine.tests.js` | Tests du simulateur : fidélité à la maquette (règles de `regles.nft`, droits de `courtier/acl`, fichiers interdits du serveur, tailles des paquets MQTT), réception, pare-feu, technicien, les 20 essais |
| `generer-certificats.js` | Autorité de certification de l'usine, certificats du courtier, de la supervision et des passerelles, liste de révocation (`crl.pem`, avec l'ancien certificat de la passerelle 1 « volée »), plus une « AC pirate » pour la démonstration ; `--revoquer <nom>` révoque un certificat |
| `generer-registre.js` | Registre des capteurs posés sur les chariots (liste blanche du serveur) |

## 2. Lancer la maquette

Prérequis : Docker Desktop, Node.js 24, Git pour Windows (il fournit `openssl`). Depuis le dossier `entrepot/` :

```bash
node generer-certificats.js
```

```bash
docker compose up -d --build
```

Puis ouvrir **https://localhost:8443/flotte/chariots.html**. Le certificat est signé par l'AC de la maquette (`certificats/ac.pem`), inconnue du navigateur : il affiche un avertissement, sauf si on importe `ac.pem` dans ses autorités de confiance. Comptes de démonstration : `serveur/cles-demo.json`.

Commandes utiles :

| Commande | Effet |
|---|---|
| `docker compose ps` | état des conteneurs |
| `docker compose logs -f supervision` | journal du serveur (connexion MQTT, lots refusés) |
| `docker compose exec pare-feu nft list ruleset` | règles du pare-feu **avec leurs compteurs** |
| `node demonstration.js` | les 14 essais de sécurité (≈ 3 min) ; `node demonstration.js 6` pour un seul |
| type `journaux/central.log` (ou `cat`) | journal central : ce que racontent les passerelles |
| `docker compose down` | tout arrêter |

Les clés privées (`certificats/*.cle`), la base (`donnees/`) et les journaux (`journaux/`) ne vont jamais dans Git (`.gitignore`).

## 3. Les conteneurs

| Conteneur | Zone (réseau) | Adresse | Rôle |
|---|---|---|---|
| `pare-feu` | toutes | .254 dans chaque réseau | Alpine + nftables : seul passage entre les zones, politique « tout refusé », conduits numérotés avec compteurs (`pare-feu/regles.nft`) |
| `courtier` | serveurs | 10.10.20.10 | Mosquitto 2, port 8883 en TLS seulement, certificat client obligatoire, identité = nom du certificat, droits par sujet (`courtier/acl`) |
| `supervision` | serveurs | 10.10.20.20 | Le serveur Node du projet (`serveur/serveur.js`), abonné au courtier, page en HTTPS sur 8443 |
| `ntp` | serveurs | 10.10.20.30 | chrony : l'heure de référence de l'usine |
| `syslog` | serveurs | 10.10.20.40 | rsyslog : journal central, écrit dans `journaux/central.log` |
| `passerelle-1` à `-3` | OT + air | 10.10.10.11 à .13 | Passerelles des quais, des allées et de la cour |
| `poste` | bureautique | 10.10.30.50 | Poste du bureau, avec `curl`, `nmap`, `mosquitto-clients`, `openssl` |
| `monde` | air | 10.10.99.2 | La simulation de l'entrepôt (n'existe pas dans la réalité) |
| `intrus` | OT + air | 10.10.10.66 | Machine pirate branchée sur une prise de l'atelier (profil `attaques`, lancé par la démonstration) |

Plan d'adressage et matrice des flux : `docs/orientation-industrielle.md`, § 3.3 et 3.4.

## 4. La démonstration de sécurité

`node demonstration.js` vérifie chaque **couche** de défense et dit d'où vient la preuve :

| # | Essai | Défense | Preuve |
|---|---|---|---|
| 1 | Balayage `nmap` d'une passerelle depuis un poste du bureau | pare-feu | ports « filtered », compteur « REFUS bureautique vers OT » |
| 2 | Le poste vise le courtier MQTT | pare-feu | compteur « REFUS bureautique vers courtier » |
| 3 | L'intrus de l'atelier vise la supervision | pare-feu | compteur « REFUS OT vers supervision » |
| 4 | Le poste réclame la clé privée du courtier à la supervision | serveur | 403 (même en majuscules) |
| 5 | L'intrus se connecte au courtier sans certificat | courtier (TLS mutuel) | alerte TLS 116 « certificat exigé » |
| 6 | Certificat fabriqué par une AC pirate | courtier | alerte TLS 48 « AC inconnue » |
| 7 | L'ancien certificat de la passerelle 1, volé avec elle, puis révoqué | courtier (liste de révocation) | alerte TLS 44 « certificat révoqué » ; la passerelle de remplacement, avec son certificat neuf, reste connectée |
| 8 | Certificat **volé** de la passerelle 1, publié au nom de la 2 | courtier (ACL) | la supervision, à l'écoute, ne reçoit rien |
| 9 | Certificat volé : lot qui se dit de la passerelle 2 | serveur | lot refusé (sujet ≠ contenu) |
| 10 | Certificat volé : capteur absent du registre | serveur (liste blanche) | compteur « capteurs inconnus » |
| 11 | Certificat volé : pneu annoncé à 20 bar | serveur (vraisemblance) | compteur « invraisemblables », pression affichée inchangée |
| 12 | Certificat volé : annonces vieilles de 3 h | serveur (anti-rejeu, heure NTP) | lot refusé |
| 13 | Le programme de la passerelle 2 s'arrête net (`docker kill` : le système ferme la connexion) | courtier (testament) | « hors ligne » sur la supervision en moins d'une seconde ; une vraie coupure de courant (sans FIN) ne se voit qu'après 45 s (simulateur, § 7) |
| 14 | Le courtier est arrêté 30 s | passerelles (stocker puis transmettre) | « N lot(s) à rattraper » dans le journal central |

Résultat du 24/10/2026 : **14 / 14 essais conformes**. Les essais 7 à 12 montrent la **défense en profondeur** : même avec un certificat volé, un pirate ne peut ni usurper une autre passerelle, ni fausser les pressions.

## 5. Ce que la maquette nous a appris (pièges rencontrés)

- **Réseaux Docker « internes »** : Docker y jette tout paquet destiné à un autre réseau, même confié à un routeur. Les réseaux sont donc ordinaires, et chaque conteneur supprime sa route par défaut au démarrage (`ip route del default`) pour ne garder qu'une route « 10.10.0.0/16 via le pare-feu ». Résultat équivalent : pas d'Internet, un seul passage.
- **Masquage de Docker** : Docker réécrit l'adresse source des paquets qui quittent un réseau. Un paquet routé par notre pare-feu arrivait à la supervision avec l'adresse de l'hôte (10.10.20.1), et la réponse se perdait. Option `enable_ip_masquerade: "false"` sur chaque réseau.
- **Port publié** : Docker choisit lui-même par quel réseau arrive le port 8443 publié sur le pare-feu (bureautique un jour, DMZ le lendemain). La redirection vers la supervision vise donc les adresses de l'hôte (.1) dans tous les réseaux (règle n° 6), avec une traduction d'adresse source pour que la réponse revienne par le pare-feu.
- **Faille trouvée** : le serveur sert les fichiers du dépôt, et dans la maquette le dépôt est monté en entier : `https://localhost:8443/entrepot/certificats/courtier.cle` donnait la **clé privée du courtier**. Corrigé (dossiers et extensions interdits, comparaison en minuscules car le disque Windows ne distingue pas la casse) et ajouté à la démonstration (essai 4). Le port n'étant publié que sur 127.0.0.1, la clé n'est pas sortie du PC.
- **Redémarrages** : un fichier de PID laissé par chrony ou rsyslog empêchait leur redémarrage ; il est effacé au lancement.
- **curl sous Windows** (Schannel) exige une vérification de révocation que notre AC ne fournit pas : `curl --ssl-no-revoke --cacert certificats/ac.pem ...`.

## 6. Défauts de logique trouvés en simulant l'usine (et corrigés)

Écrire le simulateur de l'usine, puis faire auditer chaque valeur affichée, a révélé des défauts que ni les tests ni la maquette n'avaient montrés :

| Défaut | Effet | Correction |
|---|---|---|
| Le client MQTT envoyait ses PINGREQ sans jamais vérifier qu'un PINGRESP revenait | Courtier sans courant ou câble arraché : la passerelle se croyait connectée jusqu'à l'abandon de TCP (de longues minutes), sans rattraper ses lots | `mqtt.js` : sans réponse pendant 1,5 × la garde (45 s), la connexion est fermée et signalée ; un test avec un faux courtier muet |
| La supervision se connectait en « session propre » | Pendant un redémarrage du serveur, les lots publiés étaient **perdus**, alors que les passerelles avaient reçu leur PUBACK et ne les renverraient pas | Session persistante (`serveur/serveur.js`) : le courtier garde les lots ; ceux qui arrivent avant le SUBSCRIBE passent par `surMessage` ; essai « supervision redémarre » |
| Dédoublonnage par « dernière trame » seulement | Les lots arrivent passerelle par passerelle : une même annonce entendue deux fois était comptée deux fois (3,3 % d'acceptées en trop), et une annonce plus ancienne pouvait faire reculer la mesure | `reception.js` : trames des 15 dernières secondes de chaque capteur ; annonces en retard comptées à part |
| Zone fixée par n'importe quelle trame, même refusée | Une fausse trame à 20 bar émise près d'une passerelle déplaçait le chariot ; une seule annonce bruitée changeait la zone (jusqu'à 40 % de zones fausses en roulant) | Zone sur les trames acceptées, puissance lissée par passerelle, hystérésis de 3 dB |
| « Capteur perdu » jamais inscrit dans les alertes | L'état n'était réévalué qu'à l'arrivée d'une annonce : un pneu muet ne déclenchait aucune alerte | Contrôle des silences à chaque message |
| Seuils comparés à la pression brute | Un pneu qui sort dans la cour froide (−0,35 bar entre 16 °C et 5 °C) donnait des alertes « basse » en série | Seuils sur la pression ramenée à 20 °C, comme la flotte de vélos |
| Fuites lentes des chariots jamais détectées | Une fuite de 0,15 à 0,3 bar par jour est invisible sur 20 à 40 min (seuil en bar/h) | Tendance en bar/jour depuis le dernier regonflage, sur 12 h au moins : C03 et C06 repérés après 12 h, puis réparés par le technicien |
| Écart NTP inventé dans le mode démo de la page | 13, 17 et 21 ms affichés, fixes | La page démo utilise maintenant `usine.js` : vraie dérive des quartz, vrais réglages SNTP |
| Heure locale de l'ordinateur | Un visiteur hors de France voyait les postes décalés | `TPMS.heureParis` (heure d'été et d'hiver calculées) |

## 7. Le simulateur de l'usine

Ouvrir `entrepot/simulateur.html` (ou la version en ligne). Le temps démarre le lundi 26/10/2026 à 6 h ; vitesse ×1 à ×3600.

| Page | Ce qu'on y voit |
|---|---|
| Vue d'ensemble | Le plan avec les **vraies** positions des chariots (couleur = état vu par la supervision), la charge portée, le brouilleur ; la réalité face à ce que voit la supervision ; les événements de toutes les machines |
| Chariots et pneus | Les 32 pneus : pression réelle, air, dernière annonce du capteur, pression vue, ramenée à 20 °C, tendance en bar/jour, pile, état ; courbes réelles et mesures reçues ; crevaison (clou, valve), fuite lente, capteur arraché ; interventions du technicien |
| Radio | Ce qu'entend chaque passerelle, la puissance reçue chariot par chariot, la zone vraie et la zone vue, le brouilleur |
| Réseau et pare-feu | Le schéma animé des 4 zones avec les paquets, les règles et leurs compteurs (comme `nft list ruleset`), le suivi des connexions, chaque machine (courant, plantage, câble, horloge), les derniers paquets avec leur longueur IP |
| Courtier MQTT | Les clients connectés (certificat, adresse, publiés, refusés), les lots en attente des passerelles, les messages retenus, la file de la supervision, les certificats et les droits |
| Heure et journaux | Les horloges (écart, dérive en ppm, dernier réglage), le journal central syslog et ceux du courtier, de la supervision et du pare-feu |
| Attaques et pannes | Les 20 essais, un par un ou tous à la suite, avec l'attendu et l'obtenu |
| Supervision | Exactement ce que voit le serveur : pneus, passerelles, contrôles, refus, alertes |

Les 6 essais en plus de la maquette : coupure de courant d'une passerelle (testament après 45 s, contre aussitôt pour un plantage), balayage dans l'atelier (limite : pas de filtrage dans une zone), horloge faussée de 90 s (lots refusés jusqu'au réglage NTP), brouillage radio, redémarrage de la supervision (session persistante), inondation de 2 000 lots (30 traités par minute, le reste refusé pour débit anormal).

## 8. Restes traités le 25/10/2026

- **Révocation** : l'AC publie une liste de révocation (`certificats/crl.pem`) que le courtier consulte (`crlfile`) ; essai 7.
- **Limites du courtier** : messages de 256 Kio au plus, 20 messages en vol par client, 4 000 messages gardés pour un client absent (`mosquitto.conf`).
- **Débit** : la supervision ne traite pas plus de 30 lots par minute et par passerelle (6 en temps normal) ; au-delà, refus « débit » noté une fois par minute.

## 9. Limites

La maquette reproduit le **découpage** et le **filtrage** d'un vrai réseau, mais tous les « VLAN » tournent sur le même PC : elle ne remplace ni un commutateur administrable ni un vrai pare-feu. Le réseau « air » simule la radio Bluetooth (portée calculée, pas mesurée). Les capteurs « poids lourd » et le format de leurs trames restent à vérifier.
