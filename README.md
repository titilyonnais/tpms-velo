# Capteur de pression des pneus de vélo (TPMS)

[![Tests](https://github.com/titilyonnais/tpms-velo/actions/workflows/tests.yml/badge.svg)](https://github.com/titilyonnais/tpms-velo/actions/workflows/tests.yml)

Projet de BTS CIEL option IR, épreuve E6 « Valorisation de la donnée et cybersécurité ».
Auteur : Thibault MORRETTON.

Le projet est un **logiciel de simulation complète** du kit : tout est calculé comme dans la réalité (physique des pneus, vélo et parcours, radio Bluetooth, électronique, batterie), sans matériel.

Le kit simulé comprend deux capteurs TPMS en Bluetooth Low Energy, vissés sur les valves, un boîtier de guidon avec un écran e-paper, et une application.
Le boîtier affiche la pression et la température de chaque pneu, ainsi que la vitesse et la distance. Il émet une alerte (bip et LED) en cas de pression anormale, de fuite lente ou de faux capteur.

## En ligne

- Application : https://titilyonnais.github.io/tpms-velo/app/ (sur iPhone, à ouvrir dans Bluefy)
- Simulateur : https://titilyonnais.github.io/tpms-velo/simulateur/
- Supervision de la flotte (mode démo, sans serveur) : https://titilyonnais.github.io/tpms-velo/flotte/
- Présentation : https://titilyonnais.github.io/tpms-velo/presentation/

## Dossier E6

- Rapport : [`docs/rapport-e6.md`](docs/rapport-e6.md)
- Présentation pour la soutenance : [`presentation/index.html`](presentation/index.html) (à ouvrir dans un navigateur, ou en ligne, lien ci-dessus)
- Documentation technique : [`docs/`](docs/README.md) (cahier des charges, architecture, protocole BLE, analyse de risques, schéma électrique, bilan énergétique)

## Organisation du dépôt

| Dossier       | Contenu                                                                      |
|---------------|------------------------------------------------------------------------------|
| `logique/`    | Logique partagée, sans dépendance : trames (v1 et v2 proposée), vitesse, fuite lente et prévision du regonflage, alertes, sécurité, SHA-256 et journal chaîné, protocole BLE, énergie, statistiques, pression conseillée |
| `simulateur/` | La simulation : monde physique (`monde/`, `moteur.js`), boîtier simulé (`boitier/`), attaquants (`sources/` : pirate, espions), affichage (`vues/`, `app.js`) |
| `app/`        | Application Web Bluetooth (pneus, historique, fuite lente, réglages)          |
| `firmware/`   | Programme du boîtier (Seeed XIAO nRF52840), traduction en C++ de la logique, testée sur PC (`tests_pc/`) |
| `serveur/`    | Serveur de flotte (Node.js 24 sans dépendance, SQLite), API REST, lots signés HMAC-SHA256 : voir [`serveur/README.md`](serveur/README.md) |
| `flotte/`     | Simulation de 20 vélos de location et page de supervision (tournée du technicien, fuites lentes sur plusieurs jours) |
| `boitier-3d/` | Boîtier de guidon modélisé avec OpenSCAD (étanche IPX7 visé, fixation quart de tour) : voir [`boitier-3d/README.md`](boitier-3d/README.md) |
| `docs/`       | Rapport E6, cahier des charges, analyse de risques, bilan énergétique, protocole, architecture, schéma électrique |
| `presentation/` | Présentation pour la soutenance (page web)                                 |

Le principe : la logique (`logique/` et `simulateur/boitier/`) ne connaît ni la page web ni la radio. Le simulateur lui fournit des données simulées, l'application et le firmware lui fournissent les vraies.

## Mode flotte (entreprise de location)

Une société de location équipe 20 vélos du kit ; les boîtiers envoient leurs mesures à un serveur, qui repère les fuites lentes sur plusieurs jours et trie la tournée du technicien. Chaque lot est signé (HMAC-SHA256) et protégé contre le rejeu ; les requêtes SQL sont paramétrées.

```bash
node serveur/serveur.js                  # puis http://localhost:8080/flotte/
node serveur/flotte-vers-serveur.js      # 20 vélos, 14 jours simulés et envoyés
```

Sans serveur, la page `flotte/` tourne en mode démo dans le navigateur (lien « En ligne » ci-dessus). Détails : [`serveur/README.md`](serveur/README.md). Le passage du boîtier au serveur (passerelle en station ou LTE-M) est une hypothèse, et la démonstration a des limites assumées (HTTP, clés de démo publiques, lecture sans compte).

## Boîtier imprimé en 3D

`boitier-3d/boitier.scad` : modèle OpenSCAD paramétré, 46,0 × 64,4 × 28,0 mm, joint torique radial, fixation quart de tour. Il n'a pas encore été rendu ni imprimé. Détails : [`boitier-3d/README.md`](boitier-3d/README.md).

## Lancer le simulateur

Double-cliquer sur `simulateur/index.html` : la page s'ouvre dans le navigateur, sans rien installer.

- **Vue d'ensemble** : pneus avant et arrière (crevaison, fuite lente, regonflage), vélo, boîtier de guidon (écran e-paper au pixel près, boutons 1 et 2, LED, buzzer), carte, batterie, sécurité, événements.
- **Configuration** : parcours réels autour de Lyon, une sortie ou une semaine type, météo, heure, chambres à air, pressions, poids du cycliste et pression conseillée, plage des capteurs (3,5, 5 ou 8 bar), capteurs du commerce ou « version 2 » ; réglages du boîtier.
- **Pneus** : pression réelle et pression affichée, trames des capteurs.
- **Radio et sécurité** : propagation, collisions, brouillage, vélos voisins ; pirate (usurpation, rejeu, brouillage, pirate synchronisé, inondation) et protections ; journal de sécurité chaîné par SHA-256.
- **Vie privée** : 20 récepteurs espions posés en ville reconstituent les trajets et les horaires du cycliste à partir de l'adresse fixe des capteurs.
- **Électronique** : schéma animé, courants, LiPo et recharge, autonomie sur une journée type.
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

7 suites, 539 tests : logique et boîtier (158), pneu, météo et capteur (72), vélo et parcours (62), radio (62), électronique (80), monde complet de bout en bout (38), serveur et flotte (67).

On peut aussi ouvrir `simulateur/tests/tests.html` dans le navigateur.

La traduction C++ de la logique du boîtier a ses propres tests (109), compilés et exécutés sur PC (`firmware/tests_pc`, commande dans [`firmware/README.md`](firmware/README.md)).

À chaque `git push`, GitHub Actions lance les deux séries de tests (`.github/workflows/tests.yml`) ; le badge en haut de cette page indique le résultat.

## Application sur téléphone

Web Bluetooth exige une page en HTTPS : l'app est publiée par GitHub Pages à chaque `git push`.
- **iPhone** : Safari ne gère pas Web Bluetooth, il faut ouvrir la page dans le navigateur gratuit **Bluefy**.
- **PC et Android** : Chrome.
