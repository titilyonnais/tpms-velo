# Capteur de pression des pneus de vélo (TPMS)

Projet de BTS CIEL option IR, épreuve E6 « Valorisation de la donnée et cybersécurité ».
Auteur : Thibault MORRETTON.

Le kit comprend deux capteurs TPMS en Bluetooth Low Energy, vissés sur les valves, un boîtier de guidon avec un écran e-paper, et une application web.
Le boîtier affiche la pression et la température de chaque pneu, ainsi que la vitesse et la distance. Il émet une alerte (bip et LED) en cas de pression anormale ou de fuite lente.

## Organisation du dépôt

| Dossier       | Contenu                                                                 |
|---------------|-------------------------------------------------------------------------|
| `simulateur/` | Jumeau numérique : une page web qui simule tout le kit avant d'avoir le matériel |
| `firmware/`   | Programme du boîtier (XIAO nRF52840), écrit quand le matériel arrivera  |
| `app/`        | Application Web Bluetooth (réglages, historique, fuite lente)           |
| `docs/`       | Cahier des charges, analyse de risques, bilan énergétique, schémas      |

## Lancer le simulateur

Double-cliquer sur `simulateur/index.html` : la page s'ouvre dans le navigateur, sans rien installer.

Les tests de la logique se lancent de deux façons :
- dans le navigateur, en ouvrant `simulateur/tests/tests.html` ;
- en ligne de commande, avec `node simulateur/tests/tests.js`.
