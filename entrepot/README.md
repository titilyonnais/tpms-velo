# Entrepôt : la version industrielle et sa maquette réseau

Surveillance des pneus gonflables d'une flotte de **chariots élévateurs** : chaque pneu porte un capteur TPMS Bluetooth (le même principe que sur le vélo, en version « poids lourd » 0-13 bar), des **passerelles** fixées au plafond écoutent les capteurs et remontent les trames en **MQTT sur TLS** jusqu'à la **supervision**, à travers un réseau d'usine découpé en zones par un **pare-feu**. La conception est expliquée dans [`docs/orientation-industrielle.md`](../docs/orientation-industrielle.md).

Ce dossier contient deux choses :

- le **code** de la version industrielle, en JavaScript simple, testé sans Docker (`node entrepot/entrepot.tests.js`) ;
- la **maquette Docker** : tout le réseau de l'usine sur un PC, lancé par une seule commande.

## 1. Les programmes

| Fichier | Rôle |
|---|---|
| `chariots.js` | Modèle de l'entrepôt simulé (120 m × 30 m, 3 zones, 8 chariots à 4 pneus, physique des pneus du simulateur, radio) ; marche aussi dans le navigateur |
| `monde.js` | Conteneur « monde » : fait vivre l'entrepôt et diffuse chaque annonce Bluetooth sur le réseau « air » (la radio simulée) |
| `passerelle.js` | Une passerelle BLE → MQTT : heure par SNTP, connexion TLS avec son certificat et un testament, un lot toutes les 10 s en QoS 1, 1 h de lots gardés si le courtier tombe, journal syslog |
| `mqtt.js` | Client MQTT 3.1.1 écrit à la main (sans bibliothèque, pour pouvoir l'expliquer octet par octet) |
| `reseau.js` | Client SNTP (RFC 4330) et envoi au syslog (RFC 5424) |
| `reception.js` | **Logique pure** de réception des lots (vérification, décodage, liste blanche, vraisemblance, dédoublonnage, zone, état des pneus) : utilisée par le serveur (`serveur/chariots.js`, qui enregistre en SQLite) et par le mode démo de la page `flotte/chariots.html` |
| `intrus.js` | Ce que tente un pirate branché sur l'atelier (lancé par la démonstration) |
| `demonstration.js` | Les 13 essais de sécurité commentés |
| `generer-certificats.js` | Autorité de certification de l'usine, certificats du courtier, de la supervision et des passerelles, plus une « AC pirate » pour la démonstration |
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
| `node demonstration.js` | les 13 essais de sécurité (≈ 3 min) ; `node demonstration.js 6` pour un seul |
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
| 7 | Certificat **volé** de la passerelle 1, publié au nom de la 2 | courtier (ACL) | la supervision, à l'écoute, ne reçoit rien |
| 8 | Certificat volé : lot qui se dit de la passerelle 2 | serveur | lot refusé (sujet ≠ contenu) |
| 9 | Certificat volé : capteur absent du registre | serveur (liste blanche) | compteur « capteurs inconnus » |
| 10 | Certificat volé : pneu annoncé à 20 bar | serveur (vraisemblance) | compteur « invraisemblables », pression affichée inchangée |
| 11 | Certificat volé : annonces vieilles de 3 h | serveur (anti-rejeu, heure NTP) | lot refusé |
| 12 | La passerelle 2 s'arrête net | courtier (testament) | « hors ligne » sur la supervision en moins d'une seconde |
| 13 | Le courtier est arrêté 30 s | passerelles (stocker puis transmettre) | « N lot(s) à rattraper » dans le journal central |

Résultat du 24/10/2026 : **13 / 13 essais conformes**. Les essais 7 à 11 montrent la **défense en profondeur** : même avec un certificat volé, un pirate ne peut ni usurper une autre passerelle, ni fausser les pressions.

## 5. Ce que la maquette nous a appris (pièges rencontrés)

- **Réseaux Docker « internes »** : Docker y jette tout paquet destiné à un autre réseau, même confié à un routeur. Les réseaux sont donc ordinaires, et chaque conteneur supprime sa route par défaut au démarrage (`ip route del default`) pour ne garder qu'une route « 10.10.0.0/16 via le pare-feu ». Résultat équivalent : pas d'Internet, un seul passage.
- **Masquage de Docker** : Docker réécrit l'adresse source des paquets qui quittent un réseau. Un paquet routé par notre pare-feu arrivait à la supervision avec l'adresse de l'hôte (10.10.20.1), et la réponse se perdait. Option `enable_ip_masquerade: "false"` sur chaque réseau.
- **Port publié** : Docker choisit lui-même par quel réseau arrive le port 8443 publié sur le pare-feu (bureautique un jour, DMZ le lendemain). La redirection vers la supervision vise donc les adresses de l'hôte (.1) dans tous les réseaux (règle n° 6), avec une traduction d'adresse source pour que la réponse revienne par le pare-feu.
- **Faille trouvée** : le serveur sert les fichiers du dépôt, et dans la maquette le dépôt est monté en entier : `https://localhost:8443/entrepot/certificats/courtier.cle` donnait la **clé privée du courtier**. Corrigé (dossiers et extensions interdits, comparaison en minuscules car le disque Windows ne distingue pas la casse) et ajouté à la démonstration (essai 4). Le port n'étant publié que sur 127.0.0.1, la clé n'est pas sortie du PC.
- **Redémarrages** : un fichier de PID laissé par chrony ou rsyslog empêchait leur redémarrage ; il est effacé au lancement.
- **curl sous Windows** (Schannel) exige une vérification de révocation que notre AC ne fournit pas : `curl --ssl-no-revoke --cacert certificats/ac.pem ...`.

## 6. Limites

La maquette reproduit le **découpage** et le **filtrage** d'un vrai réseau, mais tous les « VLAN » tournent sur le même PC : elle ne remplace ni un commutateur administrable ni un vrai pare-feu. Le réseau « air » simule la radio Bluetooth (portée calculée, pas mesurée). Les capteurs « poids lourd » et le format de leurs trames restent à vérifier.
