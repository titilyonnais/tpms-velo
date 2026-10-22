# Capteur de pression des pneus de vélo (TPMS)

Projet de BTS CIEL option IR, épreuve E6 « Valorisation de la donnée et cybersécurité ».
Auteur : Thibault MORRETTON.

Le kit comprend deux capteurs TPMS en Bluetooth Low Energy, vissés sur les valves, un boîtier de guidon avec un écran e-paper, et une application.
Le boîtier affiche la pression et la température de chaque pneu, ainsi que la vitesse et la distance. Il émet une alerte (bip et LED) en cas de pression anormale, de fuite lente ou de faux capteur.

## En ligne

- Application : https://titilyonnais.github.io/tpms-velo/app/ (sur iPhone, à ouvrir dans Bluefy)
- Simulateur : https://titilyonnais.github.io/tpms-velo/simulateur/

## Organisation du dépôt

| Dossier       | Contenu                                                                      |
|---------------|------------------------------------------------------------------------------|
| `logique/`    | Logique partagée, sans dépendance : trames, vitesse, fuite, alertes, sécurité, protocole BLE, énergie |
| `simulateur/` | Jumeau numérique : boîtier virtuel, capteurs simulés, pirate, banc de mesure d'énergie |
| `app/`        | Application Web Bluetooth (pneus, historique, fuite lente, réglages)          |
| `firmware/`   | Programme du boîtier (Seeed XIAO nRF52840), traduction en C++ de la logique   |
| `docs/`       | Cahier des charges, analyse de risques, bilan énergétique, protocole, architecture |

Le principe : la logique (`logique/` et `simulateur/boitier/`) ne connaît ni la page web ni la radio. Le simulateur lui fournit des données simulées, l'application et le firmware lui fournissent les vraies.

## Lancer le simulateur

Double-cliquer sur `simulateur/index.html` : la page s'ouvre dans le navigateur, sans rien installer.

- **Boîtier**, à gauche : écran e-paper au pixel près, boutons SW1/SW2, LED, buzzer, roue et aimant.
- **§1 Capteurs et trames** : pression, température, pile, fuite, crevaison ; trames décodées octet par octet.
- **§2 Boîtier** : réglages du banc, compteurs, journal.
- **§3 Application** : la vraie app (`app/`), reliée au boîtier virtuel avec les mêmes octets que par radio.
- **§4 Cybersécurité** : pirate (usurpation, rejeu) et protections activables.
- **§5 Autonomie** : consommation mesurée dans la simulation et bilan d'une journée type.

## Tests

```bash
node simulateur/tests/tests.js
```

On peut aussi ouvrir `simulateur/tests/tests.html` dans le navigateur.

## Application sur téléphone

Web Bluetooth exige une page en HTTPS : l'app est publiée par GitHub Pages à chaque `git push`.
- **iPhone** : Safari ne gère pas Web Bluetooth, il faut ouvrir la page dans le navigateur gratuit **Bluefy**.
- **PC et Android** : Chrome.
