# Documentation

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».
Kit de surveillance de la pression des pneus de vélo : 2 capteurs TPMS BLE, un boîtier de guidon à écran e-paper, une application web ; extension « flotte de location » avec serveur et supervision.

## Sommaire

| Document | Contenu |
|---|---|
| [Rapport E6](rapport-e6.md) | Rapport de l'épreuve E6 : synthèse du projet, qui renvoie aux documents ci-dessous pour le détail |
| [Cahier des charges](cahier-des-charges.md) | Besoin, produit et concurrence, exigences fonctionnelles (EF-01 à EF-26, dont le mode flotte, la correction d'altitude et la recharge par grand froid) et non fonctionnelles (ENF-01 à ENF-32, dont le boîtier imprimé, la sécurité du serveur, le RGPD, la confirmation par bouton et les sessions de la flotte) avec leurs critères de validation, contraintes, matériel et budget (86,61 € TTC), hypothèses à confirmer |
| [Architecture](architecture.md) | Les trois parties du kit et le simulateur, principe « logique séparée des sources de données », rôle de chaque fichier, mode flotte (schéma de l'architecture « entreprise »), boîtier imprimé en 3D, organisation du dépôt, lancement du simulateur et des tests (JavaScript, C++ sur PC, GitHub Actions) |
| [Protocole BLE](protocole-ble.md) | Liaison boîtier ↔ application (service, caractéristiques octet par octet, sécurité, déroulé de l'appairage) et format supposé des trames des capteurs TPMS, avec exemples en hexadécimal ; proposition de trame « version 2 » privée et signée (26 octets) |
| [Analyse de risques](analyse-de-risques.md) | Analyse de cybersécurité inspirée d'EBIOS Risk Manager : biens essentiels, sources de menace, 23 scénarios (dont le pistage du cycliste, les attaques contre le serveur de flotte et la position des clients de la location), gravité × vraisemblance avant et après mesures, matrice des risques, défense en profondeur, journal chaîné, attaques simulées et résultats, proposition de capteurs v2, défauts corrigés, risques résiduels assumés |
| [Schéma électrique](schema-electrique.md) | Schéma du boîtier (SVG, révision C du 24/10/2026 : baromètre BMP280, coupure de la recharge par grand froid, deux boutons sur une broche, fil BUSY de l'écran supprimé), liaisons broche par broche, nomenclature, calculs justifiés |
| [Bilan énergétique](bilan-energetique.md) | Consommation par état, journée type, autonomie du boîtier, influence des réglages, baromètre et attente fixe de l'écran, boîtier sur son chargeur par grand froid, durée de vie des piles CR1632, piège du reed resté fermé, protocole de mesure sans PPK2 |
| [Serveur de flotte](../serveur/README.md) | Mode « location de vélos » : lancement du serveur (HTTP ou HTTPS), connexion par mot de passe, sessions qui expirent et rôles, RGPD (minimisation, durée de conservation), API REST, format des lots signés, sécurité et limites. Page de supervision en ligne (mode démo) : https://titilyonnais.github.io/tpms-velo/flotte/ |
| [Fiche pour le professeur](fiche-professeur.md) | Une page pour faire valider l'orientation industrielle : remarque, adaptation, réseau, résultats, limites, questions |
| [Orientation industrielle](orientation-industrielle.md) | Version industrielle : chariots élévateurs, passerelles BLE → MQTT, réseau d'usine en zones, plan d'adressage, matrice des flux, maquette Docker |
| [Fiche de préparation à l'oral](fiche-jury.md) | 38 questions probables du jury (dont 10 sur la version industrielle et le réseau) avec une réponse courte et le document où trouver le détail, démonstrations à avoir prêtes, ce qui reste à compléter avant la soutenance |
| [Boîtier imprimé en 3D](../boitier-3d/README.md) | Modèle OpenSCAD paramétré : choix de conception (forme, joint radial, collier de cintre et glissière à cran), tolérances d'impression et pièce `test_jeux`, contrôles d'interférences, impression, quincaillerie, montage, essais d'étanchéité, cotes à vérifier |

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
- La simulation, le serveur, la flotte et la version industrielle sont vérifiés par 777 tests automatiques en 9 suites (`node simulateur/tests/tout.js`), et la traduction C++ de la logique du boîtier par 139 tests exécutés sur PC (`firmware/tests_pc`). Les deux séries sont lancées par GitHub Actions à chaque envoi de code.
- Évolutions du 24/10/2026 : confirmation par un appui long sur le bouton 2 du boîtier avant de couper une protection ou de changer de capteur depuis l'application (analyse de risques, § 6.13) ; baromètre BMP280 qui corrige l'erreur d'altitude des capteurs et coupe la recharge de la LiPo hors de 2 à 43 °C (schéma électrique, révision C ; bilan énergétique) ; connexion par mot de passe et sessions qui expirent pour le serveur de flotte (analyse de risques, § 5.6 et § 6.14). Les durées d'attente de l'écran sans fil BUSY sont des hypothèses à mesurer.
- Version industrielle du 24/10/2026 : flotte de chariots élévateurs, passerelles BLE → MQTT, réseau d'usine découpé en zones (orientation industrielle ; analyse de risques, S24 à S31, § 5.7 et § 6.15 ; cahier des charges, EF-25 à 30 et ENF-33 à 41 ; rapport, chapitre 10). Maquette Docker et démonstration : `entrepot/README.md`.
- Les capteurs « version 2 » (adresse privée, compteur, signature) décrits dans le protocole BLE et l'analyse de risques sont une **proposition** pour une future version du produit, simulée seulement.
- La présentation pour la soutenance est dans `presentation/index.html` (en ligne : https://titilyonnais.github.io/tpms-velo/presentation/).

- Le boîtier imprimé en 3D (version 2 : 46 × 64 × 28 mm, collier de cintre et glissière à cran) est conçu, rendu et contrôlé (OpenSCAD 2021.01, 10 pièces, STL prêts dans `boitier-3d/stl/`, aucune interférence entre pièces et composants à leurs cotes nominales), pas encore imprimé ; plusieurs cotes de composants restent des hypothèses ; la liaison boîtier → serveur du mode flotte est une hypothèse.

## À venir

- Impression et essais du boîtier : pièce `test_jeux` (réglage des tolérances), puis `essai_joint`, puis le boîtier et les essais d'étanchéité.
- Résultats des mesures sur le matériel réel (trames, consommations).
