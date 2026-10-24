# Surveillance de la pression des pneus (TPMS) : entrepôt et vélo

[![Tests](https://github.com/titilyonnais/tpms-velo/actions/workflows/tests.yml/badge.svg)](https://github.com/titilyonnais/tpms-velo/actions/workflows/tests.yml)

Projet de BTS CIEL option IR, épreuve E6 « Valorisation de la donnée et cybersécurité ».
Auteur : Thibault MORRETTON.

**Version industrielle (24/10/2026).** Les pneus gonflables d'une **flotte de chariots élévateurs** portent des capteurs TPMS Bluetooth ; des **passerelles** au plafond de l'entrepôt les écoutent et publient leurs trames en **MQTT sur TLS** jusqu'à une **supervision**, à travers un **réseau d'usine découpé en zones** (atelier, serveurs, bureautique, DMZ) par un pare-feu, avec NTP et syslog. Tout le réseau tourne dans une **maquette Docker** lancée en une commande, avec une démonstration de 13 essais de sécurité : voir [`entrepot/README.md`](entrepot/README.md) et [`docs/orientation-industrielle.md`](docs/orientation-industrielle.md). Le kit vélo ci-dessous sert de **démonstrateur** : mêmes capteurs, même logique.

Le projet est aussi un **logiciel de simulation complète** du kit : tout est calculé comme dans la réalité (physique des pneus, vélo et parcours, radio Bluetooth, électronique, batterie), sans matériel.

Le kit simulé comprend deux capteurs TPMS en Bluetooth Low Energy, vissés sur les valves, un boîtier de guidon avec un écran e-paper, et une application.
Le boîtier affiche la pression et la température de chaque pneu, ainsi que la vitesse et la distance. Il émet une alerte (bip et LED) en cas de pression anormale, de fuite lente ou de faux capteur.
Depuis le 24/10/2026, un baromètre BMP280 placé sous un évent corrige l'erreur d'altitude des capteurs (0,17 bar à 1 500 m) et coupe la recharge de la batterie par grand froid ; couper une protection ou changer de capteur depuis l'application demande un appui long sur un bouton du boîtier.

## En ligne

- Application : https://titilyonnais.github.io/tpms-velo/app/ (sur iPhone, à ouvrir dans Bluefy)
- Simulateur : https://titilyonnais.github.io/tpms-velo/simulateur/
- Supervision de l'entrepôt (mode démo, sans serveur) : https://titilyonnais.github.io/tpms-velo/flotte/chariots.html
- Supervision de la flotte de vélos (mode démo, sans serveur) : https://titilyonnais.github.io/tpms-velo/flotte/
- Présentation : https://titilyonnais.github.io/tpms-velo/presentation/

## Dossier E6

- Rapport : [`docs/rapport-e6.md`](docs/rapport-e6.md)
- Présentation pour la soutenance : [`presentation/index.html`](presentation/index.html) (à ouvrir dans un navigateur, ou en ligne, lien ci-dessus)
- Documentation technique : [`docs/`](docs/README.md) (orientation industrielle, cahier des charges, architecture, protocole BLE, analyse de risques, schéma électrique, bilan énergétique)

## Organisation du dépôt

| Dossier       | Contenu                                                                      |
|---------------|------------------------------------------------------------------------------|
| `logique/`    | Logique partagée, sans dépendance : trames (v1 et v2 proposée), vitesse, fuite lente et prévision du regonflage, alertes, sécurité, SHA-256 et journal chaîné, protocole BLE (dont la confirmation des changements sensibles), baromètre (correction d'altitude, recharge par grand froid), deux boutons sur une broche, énergie, statistiques, pression conseillée |
| `simulateur/` | La simulation : monde physique (`monde/`, `moteur.js`), boîtier simulé (`boitier/`), attaquants (`sources/` : pirate, espions), affichage (`vues/`, `app.js`) |
| `app/`        | Application Web Bluetooth (pneus, historique, fuite lente, réglages)          |
| `firmware/`   | Programme du boîtier (Seeed XIAO nRF52840), traduction en C++ de la logique, testée sur PC (`tests_pc/`) |
| `serveur/`    | Serveur de flotte (Node.js 24 sans dépendance, SQLite), API REST, lots signés HMAC-SHA256, connexion par mot de passe et sessions qui expirent, HTTPS en option, règles RGPD : voir [`serveur/README.md`](serveur/README.md) |
| `flotte/`     | Simulation de 20 vélos de location et page de supervision (tournée du technicien, fuites lentes sur plusieurs jours) ; supervision de l'entrepôt (`chariots.html`) |
| `entrepot/`   | Version industrielle : entrepôt simulé (8 chariots), passerelles BLE → MQTT, client MQTT écrit à la main, réception des lots, maquette Docker du réseau (pare-feu nftables, courtier Mosquitto en TLS mutuel, NTP, syslog), démonstration de sécurité : voir [`entrepot/README.md`](entrepot/README.md) |
| `boitier-3d/` | Boîtier de guidon modélisé avec OpenSCAD (étanche IPX7 visé, collier de cintre et glissière à cran) : voir [`boitier-3d/README.md`](boitier-3d/README.md) |
| `docs/`       | Rapport E6, cahier des charges, analyse de risques, bilan énergétique, protocole, architecture, schéma électrique |
| `presentation/` | Présentation pour la soutenance (page web)                                 |

Le principe : la logique (`logique/` et `simulateur/boitier/`) ne connaît ni la page web ni la radio. Le simulateur lui fournit des données simulées, l'application et le firmware lui fournissent les vraies.

## Version industrielle : la maquette réseau de l'entrepôt

Prérequis : Docker Desktop et Node.js 24. Depuis le dossier `entrepot/` :

```bash
node generer-certificats.js      # AC de l'usine et certificats (clés privées hors de Git)
docker compose up -d --build     # pare-feu, courtier, supervision, NTP, syslog, 3 passerelles, poste, entrepôt simulé
node demonstration.js            # 13 essais de sécurité commentés (13 / 13 conformes le 24/10/2026)
```

Supervision : https://localhost:8443/flotte/chariots.html (certificat signé par l'AC de la maquette). Sans Docker, la même page tourne en mode démo dans le navigateur.

## Mode flotte (entreprise de location)

Une société de location équipe 20 vélos du kit ; les boîtiers envoient leurs mesures à un serveur, qui repère les fuites lentes sur plusieurs jours et trie la tournée du technicien. Chaque lot est signé (HMAC-SHA256) et protégé contre le rejeu ; les requêtes SQL sont paramétrées. La lecture de l'API demande de se connecter par mot de passe (le serveur n'en garde que le sel et l'empreinte scrypt) ; le jeton de session obtenu expire après 15 min sans requête et 8 h au plus, et « Se déconnecter » le détruit côté serveur ; rôles « technicien » et « gestionnaire ». Le serveur passe en HTTPS dès qu'un certificat est présent. RGPD : aucune position gardée pendant une location, mesures et alertes effacées après 30 jours, journal des refus (adresses IP) après 6 mois.

```bash
node serveur/serveur.js                  # puis http://localhost:8080/flotte/ (mots de passe de démo : serveur/README.md)
node serveur/flotte-vers-serveur.js      # 20 vélos, 14 jours simulés et envoyés
node serveur/generer-certificat.js       # pour HTTPS : certificat auto-signé de démo (port 8443)
```

Sans serveur, la page `flotte/` tourne en mode démo dans le navigateur (lien « En ligne » ci-dessus). Détails : [`serveur/README.md`](serveur/README.md). Le passage du boîtier au serveur (passerelle en station ou LTE-M) est une hypothèse, et la démonstration a des limites assumées (clés et mots de passe de démo publics, sessions en mémoire, pas de second facteur, certificat auto-signé, limitation de débit en mémoire).

## Boîtier imprimé en 3D

`boitier-3d/boitier.scad` : modèle OpenSCAD paramétré (version 2 du 23/10/2026), boîtier de 46,0 × 64,0 × 28,0 mm en forme de compteur GPS, en PETG, imprimé sans support. Étanchéité IPX7 visée par un joint torique radial 53 × 1,8 NBR 70 (écrasement calculé 21,3 %). Fixation : collier fendu serré sur le cintre par une vis M3 (cales pour 22,2 / 23,8 / 25,4 / 31,8 mm) ; le boîtier s'y enclenche par une glissière en queue d'aronde à cran et s'enlève sans outil. Les tolérances d'impression sont des paramètres, réglés avec la pièce `test_jeux`.

Rendu avec OpenSCAD 2021.01 : 10 pièces fermées et d'un seul tenant, STL prêts dans `boitier-3d/stl/` ; un script vérifie qu'aucune pièce ne touche un composant ni une autre pièce, et que les parois font au moins 2 mm. Reste à imprimer, à régler les jeux et à essayer le joint. Détails : [`boitier-3d/README.md`](boitier-3d/README.md).

![Boîtier monté sur son collier de cintre (rendu OpenSCAD)](boitier-3d/rendus/tout.png)

## Lancer le simulateur

Double-cliquer sur `simulateur/index.html` : la page s'ouvre dans le navigateur, sans rien installer.

- **Vue d'ensemble** : pneus avant et arrière (crevaison, fuite lente, regonflage), vélo, boîtier de guidon (écran e-paper au pixel près, boutons 1 et 2, LED, buzzer), carte, batterie, sécurité, événements.
- **Configuration** : parcours réels autour de Lyon, une sortie ou une semaine type, météo, heure, chambres à air, pressions, poids du cycliste et pression conseillée, plage des capteurs (3,5, 5 ou 8 bar), capteurs du commerce ou « version 2 », baromètre du boîtier (avec évent, sans évent, aucun), recharge à la maison ou dehors ; réglages du boîtier.
- **Pneus** : pression réelle et pression affichée, trames des capteurs.
- **Radio et sécurité** : propagation, collisions, brouillage, vélos voisins ; pirate (usurpation, rejeu, brouillage, pirate synchronisé, inondation) et protections ; journal de sécurité chaîné par SHA-256.
- **Vie privée** : 20 récepteurs espions posés en ville reconstituent les trajets et les horaires du cycliste à partir de l'adresse fixe des capteurs.
- **Électronique** : schéma animé (révision C : baromètre, coupure de la recharge), courants, LiPo et recharge, température du boîtier, correction d'altitude, autonomie sur une journée type.
- **Application** : l'app (`app/`) reliée au boîtier simulé ; attaque de l'homme du milieu à l'appairage.
- **Données** : courbes, statistiques par jour et par semaine, export CSV, sauvegarde et rejeu de scénarios.

Le boîtier prévoit aussi dans combien de jours il faudra regonfler chaque pneu (« REGONFLER AV 12J AR 15J » sur l'écran), à partir d'un relevé de pression par sortie.

Les capteurs « version 2 » (adresse privée qui change tous les quarts d'heure, compteur et signature HMAC-SHA256) sont une **proposition** pour une future version du produit, simulée seulement : les capteurs du commerce émettent en clair, avec une adresse fixe.

À la création d'une simulation, la circonférence de roue du boîtier est réglée sur la vraie roue, et les seuils d'alerte à 80 % et 125 % des pressions choisies.

Le temps peut être accéléré jusqu'à ×3600. Avec la **semaine type** (trajets domicile-travail en semaine, une sortie le samedi et le dimanche, recharge le dimanche soir), le bouton « Avancer jusqu'à … » passe directement à l'événement suivant et s'arrête si une alerte apparaît.

## Tests

```bash
node simulateur/tests/tout.js
```

8 suites, 717 tests : logique et boîtier (208), pneu, météo et capteur (72), vélo et parcours (62), radio (62), électronique (86), monde complet de bout en bout (45), serveur et flotte (135), version industrielle (47 : MQTT, passerelles, réception des lots).

On peut aussi ouvrir `simulateur/tests/tests.html` dans le navigateur.

La traduction C++ de la logique du boîtier a ses propres tests (136), compilés et exécutés sur PC (`firmware/tests_pc`, commande dans [`firmware/README.md`](firmware/README.md)).

À chaque `git push`, GitHub Actions lance les deux séries de tests (`.github/workflows/tests.yml`) ; le badge en haut de cette page indique le résultat.

## Application sur téléphone

Web Bluetooth exige une page en HTTPS : l'app est publiée par GitHub Pages à chaque `git push`.
- **iPhone** : Safari ne gère pas Web Bluetooth, il faut ouvrir la page dans le navigateur gratuit **Bluefy**.
- **PC et Android** : Chrome.
