# Capteur de pression des pneus de vélo (TPMS)

Projet de BTS CIEL option IR, épreuve E6 « Valorisation de la donnée et cybersécurité ».
Auteur : Thibault MORRETTON.

Le projet est un **logiciel de simulation complète** du kit : tout est calculé comme dans la réalité (physique des pneus, vélo et parcours, radio Bluetooth, électronique, batterie), sans matériel.

Le kit simulé comprend deux capteurs TPMS en Bluetooth Low Energy, vissés sur les valves, un boîtier de guidon avec un écran e-paper, et une application.
Le boîtier affiche la pression et la température de chaque pneu, ainsi que la vitesse et la distance. Il émet une alerte (bip et LED) en cas de pression anormale, de fuite lente ou de faux capteur.

## En ligne

- Application : https://titilyonnais.github.io/tpms-velo/app/ (sur iPhone, à ouvrir dans Bluefy)
- Simulateur : https://titilyonnais.github.io/tpms-velo/simulateur/
- Présentation : https://titilyonnais.github.io/tpms-velo/presentation/

## Dossier E6

- Rapport : [`docs/rapport-e6.md`](docs/rapport-e6.md)
- Présentation pour la soutenance : [`presentation/index.html`](presentation/index.html) (à ouvrir dans un navigateur, ou en ligne, lien ci-dessus)
- Documentation technique : [`docs/`](docs/README.md) (cahier des charges, architecture, protocole BLE, analyse de risques, schéma électrique, bilan énergétique)

## Organisation du dépôt

| Dossier       | Contenu                                                                      |
|---------------|------------------------------------------------------------------------------|
| `logique/`    | Logique partagée, sans dépendance : trames, vitesse, fuite, alertes, sécurité, protocole BLE, énergie |
| `simulateur/` | La simulation : monde physique (`monde/`, `moteur.js`), boîtier simulé (`boitier/`), affichage (`vues/`, `app.js`) |
| `app/`        | Application Web Bluetooth (pneus, historique, fuite lente, réglages)          |
| `firmware/`   | Programme du boîtier (Seeed XIAO nRF52840), traduction en C++ de la logique   |
| `docs/`       | Rapport E6, cahier des charges, analyse de risques, bilan énergétique, protocole, architecture, schéma électrique |
| `presentation/` | Présentation pour la soutenance (page web)                                 |

Le principe : la logique (`logique/` et `simulateur/boitier/`) ne connaît ni la page web ni la radio. Le simulateur lui fournit des données simulées, l'application et le firmware lui fournissent les vraies.

## Lancer le simulateur

Double-cliquer sur `simulateur/index.html` : la page s'ouvre dans le navigateur, sans rien installer.

- **Vue d'ensemble** : pneus avant et arrière (crevaison, fuite lente, regonflage), vélo, boîtier de guidon (écran e-paper au pixel près, boutons 1 et 2, LED, buzzer), carte, batterie, sécurité, événements.
- **Configuration** : parcours réels autour de Lyon, une sortie ou une semaine type, météo, heure, chambres à air, pressions, plage des capteurs (3,5, 5 ou 8 bar) ; réglages du boîtier.
- **Pneus** : pression réelle et pression affichée, trames des capteurs.
- **Radio et sécurité** : propagation, collisions, brouillage, vélos voisins ; pirate (usurpation, rejeu, brouillage) et protections.
- **Électronique** : schéma animé, courants, LiPo et recharge, autonomie sur une journée type.
- **Application** : l'app (`app/`) reliée au boîtier simulé.
- **Données** : courbes, statistiques, export CSV, sauvegarde et rejeu de scénarios.

À la création d'une simulation, la circonférence de roue du boîtier est réglée sur la vraie roue, et les seuils d'alerte à 80 % et 125 % des pressions choisies.

Le temps peut être accéléré jusqu'à ×3600. Avec la **semaine type** (trajets domicile-travail en semaine, une sortie le samedi et le dimanche, recharge le dimanche soir), le bouton « Avancer jusqu'à … » passe directement à l'événement suivant et s'arrête si une alerte apparaît.

## Tests

```bash
node simulateur/tests/tout.js
```

6 suites, 412 tests : logique et boîtier (102), pneu, météo et capteur (72), vélo et parcours (62), radio (62), électronique (80), monde complet de bout en bout (34).

On peut aussi ouvrir `simulateur/tests/tests.html` dans le navigateur.

## Application sur téléphone

Web Bluetooth exige une page en HTTPS : l'app est publiée par GitHub Pages à chaque `git push`.
- **iPhone** : Safari ne gère pas Web Bluetooth, il faut ouvrir la page dans le navigateur gratuit **Bluefy**.
- **PC et Android** : Chrome.
