# Capteur de pression des pneus de vélo (TPMS)

Projet de BTS CIEL option IR, épreuve E6 « Valorisation de la donnée et cybersécurité ».
Auteur : Thibault MORRETTON.

Le projet est un **logiciel de simulation complète** du kit : tout est calculé comme dans la réalité (physique des pneus, vélo et parcours, radio Bluetooth, électronique, batterie), sans matériel.

Le kit simulé comprend deux capteurs TPMS en Bluetooth Low Energy, vissés sur les valves, un boîtier de guidon avec un écran e-paper, et une application.
Le boîtier affiche la pression et la température de chaque pneu, ainsi que la vitesse et la distance. Il émet une alerte (bip et LED) en cas de pression anormale, de fuite lente ou de faux capteur.

## En ligne

- Application : https://titilyonnais.github.io/tpms-velo/app/ (sur iPhone, à ouvrir dans Bluefy)
- Simulateur : https://titilyonnais.github.io/tpms-velo/simulateur/

## Organisation du dépôt

| Dossier       | Contenu                                                                      |
|---------------|------------------------------------------------------------------------------|
| `logique/`    | Logique partagée, sans dépendance : trames, vitesse, fuite, alertes, sécurité, protocole BLE, énergie |
| `simulateur/` | La simulation : monde physique (`monde/`, `moteur.js`), boîtier simulé (`boitier/`), affichage (`vues/`, `app.js`) |
| `app/`        | Application Web Bluetooth (pneus, historique, fuite lente, réglages)          |
| `firmware/`   | Programme du boîtier (Seeed XIAO nRF52840), traduction en C++ de la logique   |
| `docs/`       | Cahier des charges, analyse de risques, bilan énergétique, protocole, architecture |

Le principe : la logique (`logique/` et `simulateur/boitier/`) ne connaît ni la page web ni la radio. Le simulateur lui fournit des données simulées, l'application et le firmware lui fournissent les vraies.

## Lancer le simulateur

Double-cliquer sur `simulateur/index.html` : la page s'ouvre dans le navigateur, sans rien installer.

- **Boîtier**, à gauche : écran e-paper au pixel près, boutons SW1/SW2, LED, buzzer.
- **§1 Sortie** : parcours réels autour de Lyon, météo, heure, pressions ; carte et profil d'altitude.
- **§2 Pneus** : gaz parfait, chaleur, altitude, crevaisons, fuite lente, pompe ; capteurs et leur pile.
- **§3 Radio** : propagation, masquage par la jante, collisions, brouillage, vélos voisins.
- **§4 Boîtier** : réglages, compteurs, journal.
- **§5 Électronique** : schéma animé, courants, LiPo et recharge, bilan d'énergie.
- **§6 Application** : l'app (`app/`) reliée au boîtier simulé.
- **§7 Cybersécurité** : pirate (usurpation, rejeu, brouillage) et protections.
- **§8 Données** : courbes, statistiques, export CSV, sauvegarde et rejeu de scénarios.

Le temps peut être accéléré jusqu'à ×3600 pour simuler plusieurs jours.

## Tests

```bash
node simulateur/tests/tout.js
```

6 suites, 399 tests.

On peut aussi ouvrir `simulateur/tests/tests.html` dans le navigateur.

## Application sur téléphone

Web Bluetooth exige une page en HTTPS : l'app est publiée par GitHub Pages à chaque `git push`.
- **iPhone** : Safari ne gère pas Web Bluetooth, il faut ouvrir la page dans le navigateur gratuit **Bluefy**.
- **PC et Android** : Chrome.
