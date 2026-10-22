# Documentation

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».
Kit de surveillance de la pression des pneus de vélo : 2 capteurs TPMS BLE, un boîtier de guidon à écran e-paper, une application web.

## Sommaire

| Document | Contenu |
|---|---|
| [Rapport E6](rapport-e6.md) | Rapport de l'épreuve E6 : synthèse du projet, qui renvoie aux documents ci-dessous pour le détail |
| [Cahier des charges](cahier-des-charges.md) | Besoin, produit et concurrence, exigences fonctionnelles (EF-01 à EF-16) et non fonctionnelles (ENF-01 à ENF-18) avec leurs critères de validation, contraintes, matériel et budget (86,61 € TTC), hypothèses à confirmer |
| [Architecture](architecture.md) | Les trois parties du kit et le simulateur, principe « logique séparée des sources de données », rôle de chaque fichier, organisation du dépôt, lancement du simulateur et des tests |
| [Protocole BLE](protocole-ble.md) | Liaison boîtier ↔ application (service, caractéristiques octet par octet, sécurité, déroulé de l'appairage) et format supposé des trames des capteurs TPMS, avec exemples en hexadécimal |
| [Analyse de risques](analyse-de-risques.md) | Analyse de cybersécurité inspirée d'EBIOS Risk Manager : biens essentiels, sources de menace, scénarios, gravité × vraisemblance avant et après mesures, défense en profondeur, risques résiduels assumés |
| [Schéma électrique](schema-electrique.md) | Schéma du boîtier (SVG), liaisons broche par broche, nomenclature, calculs justifiés |
| [Bilan énergétique](bilan-energetique.md) | Consommation par état, journée type, autonomie du boîtier, influence des réglages, durée de vie des piles CR1632, piège du reed resté fermé, protocole de mesure sans PPK2 |

## Ordre de lecture conseillé

1. Rapport E6 : la vue d'ensemble du projet.
2. Cahier des charges : ce que le produit doit faire.
3. Architecture : comment le projet est organisé.
4. Protocole BLE : ce qui circule entre les éléments.
5. Analyse de risques : ce qui peut être attaqué et comment on s'en protège.
6. Bilan énergétique : pourquoi l'autonomie tient l'objectif.

## Statut des informations

- Le matériel n'est pas encore reçu : tout ce qui concerne le comportement réel des capteurs (format des trames, plage de pression, intervalle d'annonce) et les consommations est une **hypothèse**, signalée comme telle dans chaque document.
- Les valeurs chiffrées (exemples de trames, bilans énergétiques, résultats de simulation) ont été obtenues en exécutant le code du dépôt.
- La simulation est vérifiée par 412 tests automatiques en 6 suites : `node simulateur/tests/tout.js`.
- La présentation pour la soutenance est dans `presentation/index.html` (en ligne : https://titilyonnais.github.io/tpms-velo/presentation/).

## À venir

- Plans du boîtier imprimé en 3D.
- Résultats des mesures sur le matériel réel (trames, consommations).
