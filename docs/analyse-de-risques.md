# Analyse de risques – Cybersécurité du kit TPMS vélo

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».

## 0. Méthode

L'analyse suit une version **simplifiée** de la méthode **EBIOS Risk Manager** de l'ANSSI. Les cinq ateliers de la méthode sont ramenés à cinq étapes adaptées à un objet connecté de petite taille :

1. **Cadrage** : périmètre, biens essentiels (ce qu'on veut protéger) et biens supports (ce qui les porte).
2. **Sources de risque** : qui pourrait attaquer, pourquoi, avec quel matériel.
3. **Scénarios** : comment l'attaque se déroule concrètement.
4. **Évaluation** : gravité × vraisemblance, avant puis après les mesures.
5. **Traitement** : mesures mises en place et **risques résiduels assumés**.

Chaque mesure citée renvoie au fichier du dépôt qui l'implémente, et au test automatique qui la vérifie (`node simulateur/tests/tout.js` lance les 7 suites ; la plupart des tests cités sont dans `simulateur/tests/tests.js`, ceux de bout en bout dans `simulateur/tests/moteur.tests.js`, ceux du serveur de flotte dans `serveur/serveur.tests.js`). La traduction C++ de ces protections est vérifiée par ses propres tests (`firmware/tests_pc`), lancés comme les tests JavaScript par GitHub Actions à chaque envoi de code.

Point de départ : les études publiques sur les TPMS automobiles, en particulier **Rouf et al., « Security and Privacy Vulnerabilities of In-Car Wireless Networks: A Tire Pressure Monitoring System Case Study », USENIX Security 2010**, ont montré que les messages des capteurs de pression n'étaient ni chiffrés ni authentifiés, que leur identifiant fixe permettait de suivre un véhicule, et que de faux messages pouvaient déclencher le voyant d'alerte du tableau de bord. Les capteurs TPMS BLE du commerce utilisés ici présentent le même défaut de conception : ils diffusent leurs mesures en clair, sans signature ni compteur.

---

## 1. Cadrage

### 1.1 Périmètre

- Les deux capteurs TPMS BLE (bouchons de valve).
- Le boîtier de guidon (XIAO nRF52840, e-paper, buzzer, LED).
- La liaison radio capteurs → boîtier (annonces BLE).
- La liaison radio boîtier ↔ application (connexion BLE GATT).
- L'application web (Chrome ou Bluefy) et les données qu'elle conserve.
- Ce que des tiers peuvent capter le long des trajets du cycliste : les annonces des capteurs sont reçues bien au-delà du vélo (vie privée).
- Le **mode flotte** (entreprise de location, § 5.6) : serveur Node.js et base SQLite (`serveur/`), API REST, page de supervision (`flotte/`), et liaison boîtier → serveur. Cette liaison est une **hypothèse** : le boîtier n'a pas de modem, on suppose une passerelle dans chaque station ou un module LTE-M.

### 1.2 Biens essentiels

| Bien essentiel | Description | Besoin de sécurité principal |
|---|---|---|
| Pression affichée | Pression AV/AR montrée sur l'e-paper et dans l'app | **Intégrité** : la valeur doit être vraie ou signalée comme douteuse |
| Alertes | Crevaison, pression basse/haute, fuite lente, capteur perdu, signal suspect (bip + LED) | **Intégrité et disponibilité** : pas de fausse alerte, pas d'alerte masquée |
| Réglages | Seuils, circonférence, délai de veille, protections actives, adresses des capteurs appairés | **Intégrité** : seul le propriétaire peut les modifier |
| Données d'historique | Pressions dans le temps, distances, horaires d'utilisation (dans l'app) | **Confidentialité** (vie privée) |
| Trajets et habitudes du cycliste | Heures de départ et de retour, trajets répétés, quartier du domicile : déductibles des annonces des capteurs, sans rien demander au boîtier ni à l'app | **Confidentialité** (vie privée ; donnée personnelle au sens du RGPD) |
| Journal de sécurité | Événements notés par le boîtier : intrusions, codes d'appairage faux, réglages reçus, radio saturée | **Intégrité** (traçabilité : une trace effacée ou modifiée doit se voir) |
| Données de la flotte | Mesures des 20 vélos (pressions, positions, kilomètres, locations), alertes, regonflages, dans la base du serveur | **Intégrité** (la tournée du technicien en dépend) et **confidentialité** (positions et horaires des locations) |
| Service de supervision | API et page de la flotte, tournée triée par priorité | **Disponibilité** |

### 1.3 Biens supports

| Bien support | Faiblesse connue |
|---|---|
| Capteurs TPMS du commerce | Émettent en clair, identifiant fixe, aucune authentification ; programme non modifiable |
| Capteurs « version 2 » (**proposition**, simulés seulement) | Programme écrit par nous : adresse privée, compteur, signature (§ 5.5). Dépendent d'une clé secrète partagée avec le boîtier à l'appairage |
| Boîtier (firmware, mémoire flash) | Stocke les réglages et les clés d'appairage |
| Liaison capteurs → boîtier | Annonces BLE : n'importe qui peut les lire et en émettre |
| Liaison boîtier ↔ application | Maîtrisée par nous : appairage et chiffrement possibles |
| Téléphone et navigateur | Hors de notre contrôle (système de l'utilisateur) |
| Serveur de flotte et base SQLite | Exposés sur le réseau : reçoivent des requêtes de n'importe qui |
| Clés secrètes des vélos (HMAC) | En démonstration, publiques dans le dépôt (`serveur/cles-demo.json`) |
| Liaison boîtier → serveur | Supposée (passerelle ou LTE-M) ; en HTTP dans la démonstration |

---

## 2. Sources de risque

| Source | Motivation | Compétences | Matériel |
|---|---|---|---|
| Curieux, bidouilleur | Défi technique, jeu | Moyennes (tutoriels publics) | Smartphone avec une application de scan BLE ; carte ESP32 à environ 5 € programmée avec l'environnement Arduino |
| Personne malveillante ciblant un cycliste | Faire s'arrêter le cycliste (fausse crevaison), lui faire croire que tout va bien, ou savoir quand le vélo est présent | Moyennes | Même matériel ; l'ESP32 sait à la fois écouter les annonces BLE et en émettre avec un contenu choisi |
| Voleur de vélo | Repérer un vélo équipé et savoir s'il est dans un local | Faibles à moyennes | Scanner BLE posé à proximité |
| Collecteur de données (espion) | Connaître les trajets et les horaires d'une personne : harcèlement, repérage avant un cambriolage, revente de données de fréquentation | **Aucune en piratage** : il suffit de noter ce qui passe | Récepteurs BLE posés le long des rues (type Raspberry Pi, environ 40 € pièce), dans une vitrine, un abribus, une voiture garée |
| Attaquant sur Internet | Fausser les données de la flotte (cacher un vélo abîmé, vider la tournée), lire les positions des vélos, rendre le service indisponible | Moyennes : outils et listes d'attaques publics (injection SQL, envoi massif de requêtes) | Un PC, `curl`, des scripts |
| Source non malveillante | Aucune | – | Vélo voisin équipé des mêmes capteurs, perturbations de la bande 2,4 GHz (Wi-Fi…) |

Hypothèse réaliste retenue : l'attaquant dispose d'une carte ESP32 ou nRF52 à quelques euros, à moins d'une dizaine de mètres du vélo. C'est exactement ce que simule `simulateur/sources/pirate.js`. L'espion, lui, ne s'approche jamais du vélo : il est simulé par `simulateur/sources/mouchards.js` (page « Vie privée » du simulateur).

---

## 3. Scénarios

### S1 – Écoute passive et reconnaissance du vélo

Les capteurs diffusent en clair la pression, la température, le niveau de pile et leur **adresse fixe** (octets 3 à 7 de la trame, voir `protocole-ble.md`). Une simple application de scan BLE suffit à les lire. Ces mesures ne sont pas sensibles en elles-mêmes, mais l'adresse fixe permet de **reconnaître un vélo** : un scanner placé dans un local à vélos peut savoir quand ce vélo est présent. Le même défaut, exploité avec plusieurs récepteurs à l'échelle d'une ville, devient un pistage des déplacements : c'est le scénario S12.

### S2 – Confusion avec un vélo voisin (non malveillant)

Un autre cycliste équipé des mêmes capteurs passe à proximité. Son capteur n° 1 porte le même numéro que notre capteur avant. Sans contrôle de l'adresse, le boîtier afficherait la pression de l'autre vélo. Ce cas est simulable dans la page : case « Un vélo voisin équipé de capteurs passe à proximité ».

### S3 – Usurpation d'adresse

Le pirate écoute l'air, apprend l'adresse et le numéro du capteur visé, puis émet des trames avec **cette identité** et **la pression de son choix** : par exemple 0,3 bar pour simuler une crevaison et pousser le cycliste à s'arrêter, ou une pression normale pour masquer un pneu qui se dégonfle. Le vrai capteur continue d'émettre en parallèle. Implémenté par `TPMS.pirateTrame` en mode `"usurpation"`.

### S4 – Rejeu

Le pirate enregistre de vraies trames du capteur (par exemple la veille, pneu bien gonflé) et les renvoie **octet pour octet**. Comme les trames ne contiennent ni compteur ni signature, rien dans leur contenu ne les distingue d'une trame récente. Implémenté par `TPMS.pirateEcouter` et `TPMS.pirateTrame` en mode `"rejeu"`.

### S5 – Brouillage radio

Le pirate émet du bruit sur la bande 2,4 GHz : le boîtier ne reçoit plus rien. L'usage d'un brouilleur est interdit en France, mais le matériel reste accessible.

### S6 – Brouillage du vrai capteur et imitation de son rythme

Attaque combinée : le pirate empêche le boîtier de recevoir le vrai capteur, et émet à sa place des trames au même rythme (environ toutes les 3 s), en faisant varier la pression lentement. C'est l'attaque la plus difficile à mettre en œuvre, et aussi la plus difficile à détecter.

### S7 – Appairage malveillant avec le boîtier, homme du milieu

Le pirate tente de se connecter au boîtier pour **modifier les réglages** (désactiver les protections, remplacer les adresses des capteurs appairés par celles de ses propres émetteurs), ou de s'intercaler entre le téléphone et le boîtier pendant l'appairage (homme du milieu) pour lire ou modifier les échanges. L'homme du milieu est simulé par `TPMS.liaisonAttaqueHommeDuMilieu` (`simulateur/boitier/liaison.js`, page Application), avec et sans code d'appairage (résultats au § 5.4).

### S8 – Recherche du code d'appairage par essais successifs (brute-force)

Le pirate essaie des codes à 6 chiffres jusqu'à tomber sur le bon.

### S9 – Écriture de réglages absurdes

Une application défectueuse ou malveillante, même appairée, écrit des réglages incohérents : circonférence nulle (vitesse fausse), seuil bas supérieur au seuil haut (alerte permanente ou jamais), délai de veille très court ou très long.

### S10 – Vol des données de l'application

Lecture des mesures transmises par le boîtier, ou des données d'historique conservées par l'application (pressions, distances, horaires de sortie, qui renseignent sur les habitudes du cycliste).

### S11 – Déni de service par fausse intrusion

Conséquence de nos propres protections : le pirate émet volontairement des trames rapprochées avec l'adresse d'un capteur, pour maintenir le boîtier en « SIGNAL SUSPECT ». Il n'obtient pas de fausse valeur, mais prive le cycliste de l'information.

### S12 – Pistage du cycliste par un réseau de récepteurs (vie privée)

L'espion pose des récepteurs BLE le long des rues fréquentées et note chaque passage d'une adresse de capteur : adresse, récepteur, heure. Les capteurs du commerce annoncent toutes les 3 s en roulant, en clair, toujours avec la même adresse. En recoupant les passages, l'espion reconstitue les trajets, les heures de départ et de retour, et le quartier où le vélo part le matin (en général le domicile). Il ne s'approche jamais du vélo, n'émet rien et n'a besoin d'aucune compétence en piratage. Le boîtier ne peut ni le voir ni l'empêcher. Simulé par `simulateur/sources/mouchards.js` : 20 récepteurs posés environ tous les 700 m le long des parcours en ville (Lyon et trajet domicile-travail), antenne de 5 dBi, sensibilité de −98 dBm, réception calculée avec le modèle radio du simulateur. Un trou de plus de 30 min entre deux passages sépare deux trajets.

### S13 – Pirate synchronisé sur le vrai capteur

Variante de S3, dans le pire cas : le pirate a appris le rythme du capteur et émet sa fausse trame **en même temps** que la vraie, plus fort (essais à 1 m du vélo, à +10 et +20 dBm). Il espère que le boîtier ne reçoive que sa trame, pour que le rythme paraisse normal. Simulé dans `simulateur/moteur.js` (attaque « synchro »).

### S14 – Inondation d'annonces

Le pirate émet des centaines d'annonces par seconde (500 par seconde dans la simulation), avec des adresses tirées au hasard. Il occupe la radio (collisions) et oblige le boîtier à examiner chaque trame. Sans liste blanche, certaines fausses trames portent le numéro 1 ou 2 et passent pour nos roues. Simulé dans `simulateur/moteur.js` (attaque « inondation »).

### S15 – Effacement des traces dans le journal

Après une attaque, quelqu'un qui a accès à la mémoire du boîtier modifie ou supprime les lignes du journal de sécurité qui la décrivent, pour qu'on ne puisse plus prouver qu'elle a eu lieu. Simulé par le bouton « Falsifier une ligne » de la page Radio et sécurité.

### Scénarios du mode flotte (serveur)

Les scénarios S16 à S22 visent le serveur de la flotte de location (`serveur/`), pas le kit vendu au particulier. Ils sont démontrés par `serveur/flotte-vers-serveur.js` (options `--attaque-rejeu`, `--attaque-signature`), par le « banc d'essai de sécurité » de la page `flotte/` et par `serveur/serveur.tests.js`.

### S16 – Usurpation d'un vélo auprès du serveur

L'attaquant envoie à `POST /api/mesures` des lots de mesures inventés au nom d'un vélo (par exemple `V07`) : pressions normales pour cacher un pneu qui fuit, ou fausses alertes pour envoyer le technicien au mauvais endroit. Variante : modifier en chemin un vrai lot, ou signer avec la clé d'un autre vélo.

### S17 – Rejeu de lots

L'attaquant capture un vrai lot signé (en HTTP, il circule en clair) et le renvoie plus tard, tel quel, pour réécrire un ancien état du vélo.

### S18 – Injection SQL

L'attaquant place du code SQL dans un champ qui finit dans une requête : identifiant du vélo (`V01'; DROP TABLE…`), adresse de l'historique, contenu du lot. But : lire, modifier ou détruire la base.

### S19 – Déni de service par requêtes

L'attaquant envoie un grand nombre de requêtes, des corps énormes ou des requêtes très lentes (« slowloris ») pour occuper le serveur, ou essaie des signatures en masse.

### S20 – Lecture de l'API sans compte

Les adresses `GET /api/...` n'exigent aucune identification : n'importe qui peut lire la position, l'état et l'historique de chaque vélo, donc les heures et lieux des locations.

### S21 – Clés de démonstration publiques

Les clés HMAC des 20 vélos de démonstration sont dans le dépôt public (`serveur/cles-demo.json`, marquées « DÉMONSTRATION ») : n'importe qui peut signer un lot valide pour un vélo de démonstration.

### S22 – Trafic en HTTP

La démonstration fonctionne en HTTP (`http://localhost:8080`). Une personne placée sur le chemin du réseau peut lire les lots et les réponses de l'API.

---

## 4. Évaluation

### 4.1 Échelles

Échelles à 4 niveaux, inspirées d'EBIOS Risk Manager.

| Gravité | Signification pour ce produit |
|---|---|
| 1 – Mineure | Gêne sans conséquence, ou information peu sensible exposée |
| 2 – Significative | Information fausse ou absente, mais **signalée** à l'utilisateur ; ou atteinte limitée à la vie privée (présence du vélo à un endroit) |
| 3 – Grave | Information fausse **non signalée** (fausse crevaison ou crevaison masquée), ou réglages modifiés par un tiers ; ou atteinte importante à la vie privée (trajets, horaires et quartier du domicile reconstitués) |
| 4 – Critique | Atteinte directe à la sécurité physique du cycliste |

Aucun scénario n'est classé « critique » : le kit est une aide, le cycliste garde la sensation du pneu, et le boîtier n'agit sur rien d'autre que son propre affichage.

| Vraisemblance | Signification |
|---|---|
| 1 – Peu vraisemblable | Compétences avancées et conditions particulières (synchronisation, brouillage ciblé…) |
| 2 – Vraisemblable | Compétences moyennes, matériel spécifique, présence prolongée près du vélo |
| 3 – Très vraisemblable | Matériel à quelques euros et tutoriels publics suffisent |
| 4 – Quasi certain | Aucune compétence : une application gratuite suffit |

Niveau de risque = gravité × vraisemblance : **faible** de 1 à 3, **moyen** de 4 à 6, **élevé** de 8 à 16.

### 4.2 Tableau des risques avant et après mesures

La colonne « Après » correspond au produit actuel, avec les capteurs du commerce. La dernière colonne n'est **pas** le produit actuel : c'est l'effet de la **proposition** de capteurs « version 2 » (§ 5.5), mesuré dans le simulateur ; « = » signifie « inchangé ».

| Scénario | Événement redouté | Avant (G × V) | Mesures | Après (G × V) | Avec capteurs v2 (proposition) |
|---|---|---|---|---|---|
| S1 Écoute et reconnaissance | Le vélo est reconnu quand il est présent | 2 × 3 = **6 moyen** | Aucune possible côté capteurs (voir § 6.9) | 2 × 3 = **6 moyen** (résiduel assumé) | 2 × 1 = **2 faible** (adresse changée tous les quarts d'heure) |
| S2 Vélo voisin | Pression d'un autre vélo affichée | 2 × 3 = **6 moyen** | Liste blanche | 2 × 1 = **2 faible** | = |
| S3 Usurpation | Fausse pression acceptée sans alerte | 3 × 3 = **9 élevé** | Vraisemblance avec confirmation, rythme et quarantaine | 3 × 1 = **3 faible** | 3 × 1 = **3 faible**, mais la fausse trame est refusée (signature) au lieu d'être détectée par son comportement |
| S4 Rejeu | Ancienne pression acceptée sans alerte | 3 × 3 = **9 élevé** | Rythme et quarantaine ; vraisemblance si la valeur rejouée diffère beaucoup | 3 × 1 = **3 faible** | 3 × 1 = **3 faible**, trame refusée (compteur déjà vu) |
| S5 Brouillage | Plus aucune mesure | 2 × 2 = **4 moyen** | État « CAPTEUR PERDU » après 60 s sans trame au-dessus de 10 km/h (600 s en dessous ou à l'arrêt), avec bip et LED | 1 × 2 = **2 faible** | = |
| S6 Brouillage + imitation du rythme | Fausse pression acceptée sans alerte | 3 × 1 = **3 faible** | Seule la vraisemblance limite les variations brusques | 3 × 1 = **3 faible** (résiduel assumé) | 1 × 2 = **2 faible** : le pirate ne peut plus signer de fausse trame, il ne reste que le brouillage (S5), signalé |
| S7 Appairage malveillant, homme du milieu | Un tiers modifie les réglages | 3 × 2 = **6 moyen** | BLE Secure Connections, code affiché sur l'e-paper ; réglages refusés sans appairage | 3 × 1 = **3 faible** | = |
| S8 Brute-force du code | Un tiers s'appaire | 3 × 2 = **6 moyen** | Code aléatoire valable 60 s ; blocage 60 s après 3 codes faux | 3 × 1 = **3 faible** | = |
| S9 Réglages absurdes | Boîtier inutilisable ou alertes faussées | 2 × 2 = **4 moyen** | Vérification des réglages par le boîtier | 2 × 1 = **2 faible** | = |
| S10 Vol des données | Habitudes du cycliste exposées | 1 × 2 = **2 faible** | Liaison chiffrée ; données locales, sans serveur ni compte | 1 × 1 = **1 faible** | = |
| S11 Fausse intrusion | Information indisponible, mais signalée | – (créé par la mesure S3) | Aucune : c'est le prix de la détection | 2 × 3 = **6 moyen** (résiduel assumé) | sans objet : les trames du pirate sont ignorées, plus de quarantaine |
| S12 Pistage par un réseau de récepteurs | Trajets, horaires et quartier du domicile reconstitués | 3 × 3 = **9 élevé** | Aucune possible avec les capteurs du commerce ; information de l'utilisateur (notice) | 3 × 3 = **9 élevé** (résiduel assumé, § 6.9) | 3 × 1 = **3 faible** (aucune adresse vue sur plus d'un trajet) |
| S13 Pirate synchronisé | Vraie crevaison masquée | 3 × 1 = **3 faible** | Rythme et quarantaine (le délai aléatoire de la norme BLE empêche la superposition exacte) | 3 × 1 = **3 faible** (résiduel : crevaison masquée par moments, § 6.10) | 1 × 1 = **1 faible** (trames ignorées, crevaison signalée en 4 s) |
| S14 Inondation | Plus de mesures, ou fausses trames prises pour nos roues | 2 × 3 = **6 moyen** | Liste blanche ; détection « radio saturée » ; journal | 1 × 3 = **3 faible** (mesures toujours reçues, saturation affichée) | = |
| S15 Effacement des traces | Une attaque ne peut plus être prouvée | 2 × 1 = **2 faible** | Journal chaîné par SHA-256 ; empreinte copiée sur le téléphone | 1 × 1 = **1 faible** | = |
| S16 Usurpation d'un vélo (serveur) | Fausses données acceptées : vélo abîmé caché, tournée faussée | 3 × 3 = **9 élevé** | Signature HMAC-SHA256 de chaque lot avec la clé du vélo, comparée à temps constant ; validation des champs et des plages | 3 × 1 = **3 faible** | = |
| S17 Rejeu de lots | Ancien état du vélo réécrit | 2 × 3 = **6 moyen** | Horodatage à ±60 s et séquence strictement croissante gardée en base | 2 × 1 = **2 faible** | = |
| S18 Injection SQL | Base lue, modifiée ou détruite | 3 × 3 = **9 élevé** | Identifiant « V + 2 chiffres » ; requêtes SQL toujours paramétrées | 3 × 1 = **3 faible** | = |
| S19 Déni de service par requêtes | Supervision indisponible | 2 × 3 = **6 moyen** | 120 requêtes/min par vélo ; IP bloquée 5 min après 30 refus/min ; corps ≤ 64 Kio ; délais de lecture | 2 × 2 = **4 moyen** (résiduel : limitation en mémoire, un seul serveur) | = |
| S20 Lecture de l'API sans compte | Positions et horaires des locations exposés | 2 × 4 = **8 élevé** | Aucune dans la démonstration | 2 × 4 = **8 élevé** (démonstration ; comptes « technicien » et « gestionnaire » proposés, § 6.14) | = |
| S21 Clés de démo publiques | N'importe qui signe un lot pour un vélo de démo | 3 × 4 = **12 élevé** | Clés marquées « DÉMONSTRATION » ; en production : une clé par boîtier, gravée à la fabrication, et coffre à secrets côté serveur | **12 élevé en démonstration** ; sans objet en production (S16) | = |
| S22 Trafic en HTTP | Lots et réponses lus en chemin | 2 × 2 = **4 moyen** | La signature empêche de **modifier** un lot ; en production : HTTPS obligatoire | 2 × 2 = **4 moyen** (démonstration) ; 2 × 1 = **2 faible** en HTTPS | = |

Pour S3 et S4, la vraisemblance « après » porte sur une attaque **réussie sans être signalée** : la tentative reste facile, mais elle déclenche l'état « SIGNAL SUSPECT » (voir § 5.2, et le § 6.4 pour une fausse valeur proche de la vraie, affichée quelques secondes avant la détection). Avec les capteurs v2, la note ne baisse pas parce que l'échelle s'arrête à 1 ; la différence est que la fausse trame est refusée dès la première, avec une preuve (la signature), au lieu d'être repérée par son comportement.

### 4.3 Matrice des risques après mesures (produit actuel, capteurs du commerce)

| Gravité ↓ / Vraisemblance → | 1 – Peu vraisemblable | 2 – Vraisemblable | 3 – Très vraisemblable | 4 – Quasi certain |
|---|---|---|---|---|
| **4 – Critique** | – | – | – | – |
| **3 – Grave** | S3, S4, S6, S7, S8, S13, S16, S18 (3, faible) | – | **S12 (9, élevé)** | *S21 (12, élevé, démonstration)* |
| **2 – Significative** | S2, S9, S17 (2, faible) | S19, *S22* (4, moyen) | S1, S11 (6, moyen) | *S20 (8, élevé, démonstration)* |
| **1 – Mineure** | S10, S15 (1, faible) | S5 (2, faible) | S14 (3, faible) | – |

Les scénarios en italique ne concernent que la **démonstration** du serveur de flotte (§ 6.14) : ils disparaissent ou baissent avec les mesures prévues pour une mise en production (HTTPS, comptes, une clé secrète par boîtier).

Pour le kit vendu au particulier, le seul risque élevé restant est le **pistage (S12)**. Il ne vient pas d'une erreur de conception du boîtier mais des capteurs du commerce, qui émettent une adresse fixe en clair ; aucune mesure côté boîtier ou application ne peut le réduire (§ 6.9). C'est ce qui justifie la proposition de capteurs v2 (§ 5.5).

---

## 5. Traitement : mesures mises en place

### 5.1 Tableau des mesures

| Mesure | Contre | Implémentation | Paramètres | Tests |
|---|---|---|---|---|
| **Liste blanche** des capteurs appairés | S2, S3 (en partie) | `TPMS.positionCapteur` (`logique/securite.js`) ; sans elle, `TPMS.positionParNumero` n'utilise que le numéro | Adresses AV et AR mémorisées dans les réglages | « capteur inconnu ignoré », « sans liste blanche : le capteur n°1 devient l'avant » |
| **Vraisemblance** avec confirmation par 3 trames | S3, S4 | `TPMS.verifierVraisemblance` (`logique/securite.js`) | Rejet si > 8 bar ou température hors −40/+85 °C ; variation max 0,3 bar/s et 1 °C/s, l'écart étant divisé par le temps écoulé plafonné à 5 s (`VARIATION_DT_MAX_S`) ; au-delà, 3 trames concordantes à 0,1 bar près (`CONFIRMATIONS` = 3) ; aucune confirmation tant que le rythme est douteux (`TPMS.rythmeDouteux`) | 7 tests « vraisemblance », « regonflage réel : suspect puis accepté », « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » |
| **Contrôle du rythme** et **quarantaine** « SIGNAL SUSPECT » | S3, S4, S13 | `TPMS.controlerRythme` (`logique/securite.js`), appliqué dans `TPMS.boitierRecevoirTrame` (`simulateur/boitier/boitier.js`) | Anomalie si deux trames d'une même adresse à moins de 2 s, **sauf si la pression baisse** de plus de 0,05 bar (`RYTHME_DESCENTE_BAR` : rafale d'une vraie crevaison, § 6.6) ; 3 anomalies en 60 s = intrusion ; quarantaine 60 s pendant laquelle toutes les trames de cette adresse sont refusées | 2 tests « rythme », 3 tests « pirate + toutes protections », « rythme : la rafale d'une vraie crevaison n'est pas une intrusion », « rythme : pirate mêlé au vrai capteur toujours détecté » |
| **Écoute renforcée** | S3, S4 ; détection rapide d'une vraie crevaison | `TPMS.boitierEcouteRenforcee` (`simulateur/boitier/boitier.js`), appelée quand une trame est « suspecte » ou qu'une intrusion est détectée | Radio allumée en continu pendant 15 s (`TPMS.ECOUTE_RENFORCEE_MS`) : les trames de confirmation ne tombent plus hors de la fenêtre d'écoute (voir § 6.5) | « rejeu pour masquer une vraie crevaison : alerte en moins de 10 s », « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » |
| **Capteur perdu** | S5 | `TPMS.evaluerRoue` (`logique/alertes.js`), appelée par `TPMS.boitierMiseAJour` (`boitier.js`) | 60 s sans trame au-dessus de 10 km/h (`delaiPerteMs`, `TPMS.VITESSE_ROULAGE_SURE_KMH`), 600 s en dessous et à l'arrêt (`delaiPerteArretMs`), car un capteur à l'arrêt, ou qui ne sent pas la rotation, n'annonce plus qu'une fois par minute (§ 6.7). Le silence est compté depuis le plus récent de ces instants : dernière trame acceptée, réveil du boîtier, fin de la quarantaine « SIGNAL SUSPECT » (pendant la quarantaine, même le vrai capteur est refusé) | « capteur perdu », « pas perdu juste après un réveil », « arrêt : aucune fausse alerte « capteur perdu » », « fin d'attaque : pas de fausse alerte « capteur perdu » » |
| **BLE Secure Connections**, code à 6 chiffres affiché sur l'e-paper | S7 | Firmware : pile BLE du nRF52840. Simulé par `TPMS.liaisonConnexion` et `TPMS.liaisonSaisirCode` (`simulateur/boitier/liaison.js`), affichage par `TPMS.dessinerCodeAppairage` (`ecran.js`) ; attaque simulée par `TPMS.liaisonAttaqueHommeDuMilieu` | Code tiré au hasard, affiché 60 s ; un code encore valide n'est pas remplacé par une nouvelle demande (sinon n'importe qui à portée pourrait changer le code sous les yeux du cycliste et l'empêcher de s'appairer) | « premier contact → code requis », « code affiché à l'écran », « bon code », « mauvais code », « homme du milieu sans code : réussi, seuils changés », « homme du milieu avec code : échec après 3 essais, appairage bloqué » |
| **Réglages et commandes réservés** au téléphone appairé | S7 | `TPMS.liaisonEcrireReglages`, `TPMS.liaisonLireReglages`, `TPMS.liaisonCommande` | Refus si le lien n'est pas appairé | « réglages refusés sans appairage » |
| **Blocage après 3 codes faux** | S8 | `TPMS.liaisonSaisirCode` | `CODE_ESSAIS_MAX` = 3, `CODE_BLOCAGE_MS` = 60 s | « 3 codes faux → bloqué », « toujours bloqué 30 s après » |
| **Vérification des réglages** par le boîtier | S9 | `TPMS.verifierReglages` (`logique/protocole.js`), appelée par `TPMS.liaisonEcrireReglages` | Circonférence 1 000 à 3 000 mm ; seuils 0,5 à 6 bar, bas < haut ; veille 10 s à 1 h | « seuil bas > seuil haut refusé » |
| **MESURES chiffrée et appairée** | S10 | En-tête de `logique/protocole.js` ; dans le simulateur, `TPMS.liaisonMesures` n'envoie rien à un téléphone non connecté | Vitesse, distance et horaires de sortie renseignent sur les habitudes du cycliste | « mesures disponibles » (après appairage) |
| **Numéro de séquence** des notifications MESURES | Fiabilité de S10 | `TPMS.encoderMesures` (octets 18-19), incrémenté par `TPMS.liaisonMesures` | 16 bits, repart à 0 après 65 535 | « MESURES : séquence » |
| **Données locales** | S10 | `app/app.js` : historique conservé dans le stockage local du navigateur (`localStorage`), export CSV à la demande de l'utilisateur | Pas de compte, pas de serveur | – |
| **Contrôle des réglages avant envoi** | S9 | `app/app.js` appelle aussi `TPMS.verifierReglages` avant d'écrire ; le boîtier refait le contrôle de son côté | Mêmes plages | – |
| **Détection d'inondation** (« radio saturée ») | S14 | `TPMS.boitierSurveillerSaturation` (`boitier.js`), appelée chaque seconde ; chaque trame inconnue ou invalide est comptée | Plus de 50 annonces inconnues par seconde (`SEUIL_INONDATION_PAR_S`) pendant 5 s de suite (`DUREE_INONDATION_S`) ; fin après 10 s de calme (`DUREE_RETOUR_CALME_S`). « SATURE » dans la barre d'état de l'e-paper et ligne au journal, sans bip | « inondation : 80 annonces inconnues/s pendant 5 s → radio saturée », « … affichée sur l'écran (SATURE) », « … retour au calme après 10 s » |
| **Journal de sécurité chaîné** | S15 ; traçabilité de toutes les attaques | `logique/journal.js` (traduit dans `journal.cpp`), SHA-256 de `logique/sha256.js` ; `TPMS.boitierJournal` y copie chaque ligne du journal du boîtier | Empreinte de chaque ligne = SHA-256 de son numéro, de son instant, de son texte et de l'empreinte de la ligne précédente ; 64 lignes en mémoire, l'empreinte de la dernière ligne oubliée sert d'ancre ; dernière empreinte copiée sur le téléphone (§ 5.3) | « sha256 : message vide », « … « abc » », « … message de 2 blocs », « hmac-sha256 : vecteur RFC 4231 », 5 tests « journal » |
| **Capteurs v2** (**proposition**, simulée) | S1, S3, S4, S6, S11, S12, S13 | `logique/trame2.js` (traduit dans `trame2.cpp`) ; branche « capteurs v2 » de `TPMS.boitierRecevoirTrame` | Clé secrète de 16 octets par capteur ; adresse privée changée toutes les 15 min ; compteur de 4 octets ; signature HMAC-SHA256 tronquée à 4 octets (§ 5.5) | 12 tests « v2 », 3 tests « pistage » (`moteur.tests.js`) |

Précision sur le numéro de séquence : il permet à l'application de repérer une notification perdue. Il ne constitue pas à lui seul une protection contre le rejeu ; sur la liaison boîtier ↔ application, c'est le chiffrement AES-CCM de la couche liaison BLE, avec son compteur de paquets, qui empêche de rejouer un paquet (commentaire en tête de `logique/protocole.js`).

Précision sur l'appairage : sans code affiché (mode « Just Works »), l'appairage BLE ne protège pas d'un homme du milieu. Le code n'est visible que par la personne qui a le boîtier sous les yeux ; c'est ce qui authentifie le téléphone. Dans le firmware, le code sera tiré par le générateur aléatoire matériel du nRF52840 (le simulateur utilise `Math.random`).

Ordre de grandeur pour la recherche du code (S8) : avec 3 essais au plus par minute contre un code parmi 1 000 000, la probabilité de réussite est de 3 sur 1 000 000 par minute. Il faudrait environ 231 000 minutes, soit environ 160 jours d'essais ininterrompus à proximité du boîtier, pour avoir une chance sur deux ; et chaque demande fait apparaître un code sur l'écran du boîtier, donc se remarque.

### 5.2 La défense en profondeur, démontrée par le scénario pirate

Les capteurs ne permettent pas de **prouver** qu'une trame vient du vrai capteur. Le boîtier ne peut que **trier** ce qu'il reçoit. Aucune protection n'est suffisante seule ; c'est leur empilement qui arrête le pirate. Les trames traversent les protections dans l'ordre suivant (`TPMS.boitierRecevoirTrame`) ; la première qui refuse arrête la trame :

```
trame reçue
  → décodage (format, identifiant fabricant)        sinon « invalide »
  → 1. liste blanche (adresse appairée ?)           sinon « inconnue »
  → 2. rythme (deux émetteurs sur la même adresse ?) sinon « intrusion »
  → 3. vraisemblance (valeur physiquement possible ?) sinon « hors-limites » / « suspecte »
  → acceptée : mise à jour de la mesure, de l'historique et de la pente
```

Les trames refusées comme « invalides » ou « inconnues » sont aussi comptées pour la détection d'inondation (§ 5.4). Avec des capteurs v2 (§ 5.5), les étapes 1 et 2 sont remplacées par trois vérifications : l'adresse privée est-elle celle d'un de nos capteurs (recalcul avec la clé) ? la signature est-elle juste ? le compteur est-il plus grand que le dernier accepté ? Les trames en clair sont alors ignorées.

Le test « Scénario complet » de `simulateur/tests/tests.js` rejoue la même attaque avec plusieurs combinaisons de protections. Le vrai capteur annonce 2,2 bar toutes les 3 s ; le pirate annonce 0,3 bar avec la même identité toutes les secondes, pendant 30 s, radio du boîtier en écoute continue. Un test supplémentaire rejoue l'attaque avec l'écoute par fenêtres réelle du boîtier (voir § 6.4).

| Protections actives | Résultat | Test |
|---|---|---|
| Liste blanche seule | Fausses trames acceptées : le pirate a recopié l'adresse, la liste blanche ne le distingue pas | « pirate sans protection : fausses trames acceptées » |
| Liste blanche + vraisemblance | Le pirate finit par passer : il émet 3 fois entre deux vraies trames, ce qui suffit à « confirmer » sa fausse valeur | « pirate + vraisemblance seule : le pirate rapide finit par passer » |
| Les trois protections | État « SIGNAL SUSPECT », aucune fausse pression acceptée, la dernière valeur de confiance (2,2 bar) est conservée | « pirate + toutes protections : SIGNAL SUSPECT », « … fausse pression jamais acceptée », « … dernière valeur de confiance gardée » |
| Les trois protections, écoute par fenêtres par défaut (3 s toutes les 5 s, position variable, écoute renforcée), 30 décalages du pirate | Aucune fausse pression acceptée, quel que soit le décalage | « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » |
| Les trois protections, vrai regonflage (1,2 → 2,2 bar) | Accepté après un court délai : la protection ne bloque pas un usage normal | « regonflage réel : suspect puis accepté » |

Le réglage `CONFIRMATIONS` = 3 n'est pas arbitraire : la protection « rythme » demande 3 anomalies pour conclure à une intrusion. Avec 3 confirmations exigées, le rythme détecte le pirate **avant** que ses fausses valeurs ne soient confirmées. En contrepartie, un vrai changement brutal (regonflage) est affiché avec environ 10 s de retard.

### 5.3 Traçabilité : le journal de sécurité chaîné

Le boîtier note ses événements de sécurité : intrusion repérée, trame rejouée ou mal signée, code d'appairage faux, réglages reçus, radio saturée. Pour qu'on puisse prouver après coup qu'une attaque a eu lieu, ce journal doit être **infalsifiable**, ou du moins une falsification doit se voir. Toutes les lignes du journal du boîtier sont donc recopiées dans un journal chaîné (`logique/journal.js`, `journal.cpp`) :

```
empreinte(n) = SHA256( n | instant | texte | empreinte(n−1) )
```

Chaque ligne contient l'empreinte de la précédente. Si quelqu'un modifie une ligne, son empreinte change et ne correspond plus à celle notée dans la ligne suivante : la vérification (`TPMS.journalVerifier`) s'arrête sur la ligne trafiquée. Le boîtier garde 64 lignes en mémoire (environ 15 Ko en C++, sur les 256 Ko de RAM du nRF52840). Quand la mémoire est pleine, la plus ancienne ligne est oubliée mais son empreinte est gardée comme « ancre » : la chaîne continue de se vérifier.

SHA-256 et HMAC-SHA256 sont écrits sans bibliothèque, en JavaScript (`logique/sha256.js`) et en C++ (`sha256.cpp`). Ils sont vérifiés avec les vecteurs de test officiels : FIPS 180-4 (message vide, « abc », message de 2 blocs) et RFC 4231 (cas 2) pour le HMAC.

**Limite, dite honnêtement.** Quelqu'un qui peut réécrire **tout** le journal peut aussi recalculer toutes les empreintes : la vérification seule ne voit rien (test « journal : réécriture complète invisible à la vérification seule (limite) »). La parade est de copier régulièrement la dernière empreinte **ailleurs**, sur le téléphone : un journal réécrit ne contient plus cette empreinte (test « … mais l'empreinte copiée sur le téléphone ne correspond plus »). Dans le simulateur, la tuile « Journal de sécurité chaîné » de la page Radio et sécurité propose trois boutons : « Vérifier », « Falsifier une ligne » et « Copier l'empreinte sur le téléphone ».

### 5.4 Attaques ajoutées au simulateur : résultats

| Attaque | Ce que fait le pirate | Résultat mesuré | Limite |
|---|---|---|---|
| **Pirate synchronisé** (S13) | Émet sa fausse trame en même temps que le vrai capteur, à 1 m du vélo, à +10 et +20 dBm | La norme BLE ajoute un délai aléatoire de 0 à 10 ms à chaque annonce : les deux trames ne se superposent jamais exactement et le boîtier reçoit souvent les deux. Le contrôle du rythme repère le pirate et affiche « SIGNAL SUSPECT » (1 s après, dans notre essai) | Entre deux quarantaines, une vraie crevaison peut rester masquée : **98 s sur 240 s** dans notre essai (§ 6.10). Avec capteurs v2 : trames du pirate ignorées, crevaison signalée en 4 s |
| **Inondation** (S14) | 500 annonces par seconde, adresses tirées au hasard | « Radio saturée » détectée en **16 s** (le compte repart de zéro dès qu'une seconde passe sans écoute radio ; il faut que plusieurs fenêtres d'écoute se suivent de près), « SATURE » affiché, ligne au journal. Le boîtier continue de recevoir ses capteurs : 22 à 24 trames acceptées en 60 s, états OK (3 graines). **Sans liste blanche**, les fausses trames passent pour nos roues : 0 trame acceptée correctement, état INTRUSION | On ne peut pas empêcher une inondation (c'est physique), seulement la détecter. Pas de bip : une rue très fréquentée pourrait aussi dépasser le seuil |
| **Homme du milieu à l'appairage** (S7), sans code (« Just Works ») | Se place entre le téléphone et le boîtier et relaie leurs messages | Attaque **réussie** : le pirate écrit des seuils bas à 0,5 bar, plus aucune alerte de pression basse, le cycliste ne voit rien | C'est pourquoi le boîtier n'accepte que l'appairage avec code (§ 5.1) |
| **Homme du milieu à l'appairage** (S7), avec le code à 6 chiffres affiché sur l'e-paper (notre choix) | Doit deviner le code, qu'il ne voit pas | **Échec** : 3 essais faux, puis appairage bloqué 1 min. 3 chances sur 1 000 000 par minute, soit environ 5 mois d'essais sans interruption pour une chance sur deux (calcul détaillé au § 5.1) | Le code doit être tiré au hasard à chaque appairage : un code fixe ou réutilisé perdrait cette protection |
| **Rejeu face aux capteurs v2** (S4) | Enregistre de vraies trames signées et les renvoie pendant une crevaison | **163 à 173 trames rejouées refusées en 4 min** (« compteur déjà vu »), crevaison signalée | Voir § 5.5 (compteur à sauvegarder en flash dans le firmware) |

### 5.5 Proposition pour une version 2 : capteurs à adresse privée, signés

Les mesures des § 5.1 à 5.4 **limitent** les dégâts mais ne peuvent pas prouver l'origine d'une trame, ni empêcher le pistage (§ 6.9) : c'est une limite des capteurs du commerce. La vraie correction demande des capteurs dont **nous écrivons le programme**. C'est une **proposition pour une version 2 du produit**, simulée mais pas réalisée : les capteurs commandés restent en version 1. Le format de trame est détaillé dans `protocole-ble.md` (§ 2.7).

Principe (`logique/trame2.js`, traduit dans `trame2.cpp`) :
- chaque capteur a une **clé secrète de 16 octets**, partagée avec le boîtier à l'appairage (par exemple par un QR code dans la boîte) ;
- **adresse privée** qui change toutes les 15 min : 2 octets tirés au hasard, suivis de 3 octets de HMAC(clé, 01 ‖ ces 2 octets). C'est la même idée que les « adresses privées résolubles » de la norme Bluetooth, qui utilisent AES. Le boîtier, qui a la clé, recalcule le HMAC et reconnaît son capteur ; un espion voit une adresse nouvelle tous les quarts d'heure ;
- **compteur** de 4 octets, augmenté de 1 à chaque trame : une trame dont le compteur n'est pas plus grand que le dernier accepté est un **rejeu** et elle est refusée ;
- **signature** de 4 octets = HMAC(clé, 02 ‖ octets 0 à 21) tronqué. Sans la clé, un pirate a 1 chance sur 2³² (environ 4 milliards) par essai de fabriquer une trame acceptée.

Avec des capteurs v2, le boîtier ignore les trames en clair et n'a plus besoin du contrôle du rythme : l'origine de chaque trame est prouvée par sa signature. Dans le simulateur : option « Capteurs » de la page Configuration (« Du commerce » ou « Version 2 »), et bouton « Relancer avec des capteurs v2 » de la page Vie privée.

Résultats mesurés dans le simulateur :

| Attaque | Capteurs du commerce | Capteurs v2 |
|---|---|---|
| Pistage, 5 jours de semaine type (§ 6.9) | 2 adresses suivies, 10 trajets reliés sur 5 jours | 77 adresses différentes, aucune vue sur plus d'un trajet |
| Pirate synchronisé (§ 6.10) | Repéré, mais crevaison masquée 98 s sur 240 s | Trames du pirate ignorées, crevaison signalée en 4 s |
| Rejeu pendant une crevaison | Alerte dans 120 cas sur 120, 5 s au pire (§ 6.6) | 163 à 173 trames rejouées refusées en 4 min, crevaison signalée |

Tests : 12 tests « v2 » dans `tests.js` (adresse reconnue par la bonne clé et pas par une autre, deux adresses du même capteur sans rien en commun, un bit changé rend la signature fausse, trame rejouée refusée, trame en clair du pirate ignorée…) et 3 tests « pistage » dans `moteur.tests.js` (2 jours de trajets : avec les capteurs du commerce les 4 trajets sont reliés ; avec les capteurs v2 aucune adresse n'est vue sur plus d'un trajet, et le boîtier reçoit toujours ses capteurs).

Limites de la proposition :
- elle demande de **fabriquer** nos propres capteurs (électronique et programme), ce qui sort du budget et du calendrier du projet ;
- la sécurité repose sur la clé : si elle est lue dans le boîtier ou sur le QR code, l'attaquant peut signer ;
- la signature protège l'**intégrité**, pas la **confidentialité** : la pression, la température et le niveau de pile restent lisibles. Un espion plus habile que celui du simulateur pourrait essayer de relier deux adresses par ces valeurs, ou parce qu'une adresse disparaît au moment et à l'endroit où une autre apparaît. Ce cas n'est pas simulé ; on pourrait chiffrer aussi les mesures et changer l'adresse des deux capteurs au même instant ;
- défaut trouvé en relisant la traduction C++ : le dernier compteur accepté de chaque capteur est gardé en RAM (`dernierCompteur`, `compteurConnu` dans `boitier.cpp`). La veille du boîtier (System OFF) efface la RAM ; au réveil, le boîtier ne connaît plus aucun compteur et accepterait **la première trame rejouée**, même ancienne. **Remédiation, écrite dans le firmware le 23/10/2026 (pas encore essayée sur la carte)** : `stockage.cpp` sauvegarde en mémoire flash le dernier compteur accepté de chaque capteur au moment de la mise en veille, avec les réglages et le trajet qui y étaient déjà sauvegardés, puis le relit au réveil (10 octets de plus par mise en veille ; format de sauvegarde passé en version 2) ;
- le firmware laisse aussi passer les annonces de 26 octets (`capteurs_ble.cpp`) ; reste à mesurer le temps de calcul des HMAC pendant une inondation (chaque trame inconnue demande de recalculer l'adresse des deux capteurs).

### 5.6 Mode flotte : sécurité du serveur

**Contexte.** Une entreprise de location équipe 20 vélos du kit. Les boîtiers envoient leurs mesures par lots à un serveur (`serveur/serveur.js`, Node.js 24 sans aucune dépendance : `node:http`, `node:sqlite`, `node:crypto`), qui les range dans une base SQLite (`serveur/base.js`). Le serveur calcule ce que le boîtier seul ne voit pas (fuites lentes sur plusieurs jours) et trie la tournée du technicien par priorité ; la page `flotte/` l'affiche. Le passage du boîtier au serveur (passerelle en station ou module LTE-M) est une **hypothèse**. Le format des lots et l'API sont décrits dans `serveur/README.md`.

| Mesure | Contre | Implémentation | Paramètres | Tests (`serveur/serveur.tests.js`) |
|---|---|---|---|---|
| **Signature HMAC-SHA256** de chaque lot | S16 | `TPMS.flotteControlerRequete` (`flotte/flotte-logique.js`) | Clé secrète par vélo ; texte signé = identifiant, horodatage, numéro de séquence et corps ; comparaison à temps constant (`TPMS.egaliteTempsConstant`), pour qu'un attaquant ne puisse pas deviner la signature caractère par caractère en mesurant le temps de réponse | « signature valide : lot accepté (201) », « corps modifié après signature : refusé (401 signature) », « signé avec la clé de V02 en se disant V01 : refusé », « vélo inconnu (V99) : refusé (401) » |
| **Anti-rejeu en deux couches** | S17 | idem ; colonne `velos.derniere_sequence` de la base | Horodatage à ±60 s de l'horloge du serveur ; séquence strictement croissante, gardée en base (elle tient après un redémarrage du serveur). La signature est vérifiée avant : sans clé, impossible de rajeunir un lot ou de changer son numéro | « rejeu de la même requête : refusé (401 rejeu) », « horodatage vieux de 2 min : refusé », « séquence plus petite que la dernière : refusée (rejeu) » |
| **Validation par liste blanche** | S16, S18 | `TPMS.flotteValiderLot` | Champs, types et plages autorisés (limites reprises de `logique/securite.js`), dates croissantes ; tout le reste est refusé (400) | « JSON invalide (bien signé) : refusé (400 json) » ; banc d'essai de la page : pression à 12 bar → 400 |
| **Requêtes SQL paramétrées** | S18 | `serveur/base.js` | Identifiant de vélo « V + 2 chiffres » vérifié avant tout ; valeurs toujours passées par `?`, jamais collées dans le texte SQL | « injection SQL dans X-Velo-Id : refusée (400) », « requête paramétrée : « V01' OR '1'='1 » ne renvoie aucune mesure », « injection SQL : tables intactes » |
| **Limitation de débit et de taille** | S19 | `serveur/serveur.js` | 120 requêtes/min par vélo authentifié ; adresse IP bloquée 5 min après 30 refus/min ; corps ≤ 64 Kio ; délais de lecture (contre « slowloris ») | « limitation de débit : 5 requêtes acceptées, puis 429 », « limitation par vélo : V07 n'est pas pénalisé par V06 », « après 4 signatures fausses, l'adresse IP est bloquée (429) », « corps de plus de 64 Kio : refusé (413) » |
| **En-têtes de sécurité, fichiers protégés** | Page de supervision (XSS, clickjacking), fuite des clés | `serveur/serveur.js`, `flotte/page.js` | CSP, `nosniff`, `X-Frame-Options`, `no-referrer` ; la page échappe tout texte reçu ; `serveur/` et fichiers cachés jamais servis ; `../` impossible | « en-têtes de sécurité présents », « les clés de démo ne sont pas servies », « sortie du dépôt par ../ impossible », « fichiers cachés (.git) non servis » |
| **Journal des refus** | Traçabilité | Table `refus` et console | Heure, IP, vélo annoncé, motif ; l'identifiant piégé est gardé comme simple texte | « journal des refus : l'identifiant piégé est gardé comme simple texte », « statistiques : refus comptés par motif » |

**Résultats mesurés.**
- Essai réel avec `serveur/flotte-vers-serveur.js` : 14 jours de flotte simulés en 31 s, **1 120 lots acceptés sur 1 120** (40 356 mesures). Lot rejoué : refusé (401 rejeu) ; lot modifié : refusé (401 signature) ; lot signé avec la clé d'un autre vélo : refusé.
- L'identifiant `V01'; DROP TABLE…` est refusé et sans effet sur la base.
- Sans serveur (GitHub Pages), la page `flotte/` tourne en mode démo et propose un **banc d'essai de sécurité**, qui applique les mêmes règles avec le HMAC de `logique/sha256.js` : lot valide → 201 ; rejeu → 401 ; pression modifiée → 401 ; mauvaise clé → 401 ; lot vieux de 2 min → 401 ; pression à 12 bar → 400.

Les limites de la démonstration (HTTP, clés publiques, lecture sans compte, limitation de débit en mémoire) sont au § 6.14.

---

## 6. Risques résiduels assumés

Ces risques sont connus, expliqués et acceptés. Ils découlent principalement du choix de capteurs du commerce, imposé par le budget et le calendrier. Les § 6.4 à 6.8 racontent cinq défauts trouvés en relecture ou par la simulation, puis corrigés, et ce qu'il en reste.

### 6.1 Aucun anti-rejeu cryptographique possible sur les capteurs

Un véritable anti-rejeu suppose que chaque trame contienne un **compteur** et une **signature** (code d'authentification calculé avec une clé secrète). Les trames des capteurs TPMS du commerce n'ont ni l'un ni l'autre, et leur programme n'est pas modifiable. Le boîtier ne pourra donc jamais prouver l'origine d'une trame : les protections mises en place détectent des **comportements anormaux** (deux émetteurs, variations impossibles), pas des trames falsifiées en tant que telles. L'anti-rejeu cryptographique est en revanche appliqué sur la liaison boîtier ↔ application, que nous maîtrisons. Pour les capteurs, il n'est possible qu'avec des capteurs dont nous écrivons le programme : c'est la proposition de capteurs v2 (§ 5.5), simulée mais pas réalisée.

### 6.2 Un pirate qui brouille le vrai capteur et imite son rythme n'est pas détecté (S6)

Si le boîtier ne reçoit plus que les trames du pirate, au rythme normal, la protection « rythme » ne voit qu'un seul émetteur. La vraisemblance n'arrête que les variations de plus de 0,3 bar/s : une pression qui descend ou monte lentement est acceptée. Cette attaque demande cependant de brouiller de façon ciblée et de se synchroniser, ce qui la rend peu vraisemblable. Avec des capteurs v2 (§ 5.5), le pirate ne pourrait plus signer ses trames : il ne lui resterait que le brouillage, signalé par « CAPTEUR PERDU ».

### 6.3 La vraisemblance seule est contournée par un pirate rapide

C'est vérifié par le test « pirate + vraisemblance seule : le pirate rapide finit par passer ». C'est la raison d'être de la protection « rythme ». Si l'utilisateur désactive le rythme (les protections sont réglables depuis l'application, pour la démonstration), il retombe dans ce cas.

### 6.4 Faille trouvée en relecture et corrigée : l'écoute par fenêtres

Ce paragraphe retrace une faille découverte lors de la rédaction de ce dossier, son analyse, sa correction et la preuve par un test. Il montre que l'analyse de risques a servi à améliorer le code, et pas seulement à le décrire.

**1. Constat.** Le scénario pirate des premiers tests fonctionnait avec la radio en **écoute continue** (`ecouteFenetreMs = ecoutePeriodeMs`). Or, pour économiser la batterie, le boîtier n'écoutait alors que 2 s toutes les 5 s (3 s depuis, voir § 6.5). Une simulation complémentaire avec cette écoute par fenêtres (pirate à 0,3 bar, une trame par seconde, 300 décalages différents entre le vrai capteur et le pirate) a montré que, dans 145 cas sur 300, **une** fausse valeur était acceptée avant le passage en « SIGNAL SUSPECT ». L'écran affichait alors une fausse crevaison, puis gardait 0,3 bar comme dernière pression pendant toute la quarantaine.

Déroulé observé avant correction (vrai capteur à 2,2 bar, pirate à 0,3 bar à partir de t = 10 s) :

| Instant | Émetteur | Résultat avant correction |
|---|---|---|
| 6,1 s | vrai capteur | acceptée |
| 10,0 s | pirate | suspecte (1re confirmation) |
| 11,0 s | pirate | suspecte (2e) |
| 15,0 s | pirate | **acceptée** → état CREVAISON |
| 15,1 s | vrai capteur | suspecte |
| 16,0 s | pirate | intrusion → état SIGNAL SUSPECT |

**2. Analyse.** Deux causes se combinaient :
- la vraisemblance divisait l'écart de pression par le temps écoulé depuis la dernière valeur acceptée, sans limite. Après 3 s de radio coupée, ce temps atteignait 8,9 s, et 1,9 bar en 8,9 s (0,21 bar/s) passait sous la limite de 0,3 bar/s : le silence « diluait » l'écart ;
- avec l'écoute par fenêtres, le pirate pouvait réunir ses 3 trames de confirmation avant que le contrôle du rythme n'ait vu ses 3 anomalies.

**3. Correction** (`logique/securite.js` et `simulateur/boitier/boitier.js`) :
- le temps de division est plafonné à 5 s (`TPMS.VARIATION_DT_MAX_S`). Un écart de plus de 1,5 bar (0,3 bar/s × 5 s) doit donc toujours être confirmé par 3 trames, quelle que soit la durée du silence ;
- `TPMS.verifierVraisemblance` reçoit un paramètre `confirmationPermise`. Le boîtier le met à faux tant que le contrôle du rythme a vu au moins une anomalie dans la dernière minute (`TPMS.rythmeDouteux`). Tant qu'on doute de l'émetteur, aucun changement brutal ne peut être confirmé.

Avec le code corrigé, la même séquence donne : 15,0 s pirate **suspecte**, 15,1 s vrai capteur acceptée, 16,0 s intrusion. La pression affichée reste 2,2 bar.

**4. Preuve par le test.** Le test « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » (`simulateur/tests/tests.js`) rejoue l'attaque avec l'écoute par fenêtres par défaut, pour 30 décalages du pirate, et vérifie qu'aucune fausse valeur n'est acceptée. La suite compte désormais 102 tests. Une simulation plus large faite lors de la relecture (pirate à 0,3 bar, cadences de 0,5 s, 1 s et 3 s, 1 350 combinaisons de décalages) n'a donné aucun cas d'acceptation. Les tests de regonflage réel et la détection d'une vraie crevaison restent valides : dans nos simulations, l'alerte CREVAISON apparaissait entre 0,6 et 9,6 s après le passage sous 0,5 bar (30 décalages, fenêtre fixe de 2 s ; avec la fenêtre actuelle : 0,7 à 6,7 s, voir § 6.5).

**5. Ce qui reste : une fausse valeur proche de la vraie peut être affichée quelques secondes.** Le plafond de 5 s veut dire qu'un écart **inférieur à 1,5 bar** reste « plausible » sans confirmation si la dernière valeur acceptée date de 5 s ou plus, ce qui arrive souvent avec l'écoute par fenêtres. Une simulation complémentaire faite lors de la relecture, avec l'écoute par fenêtres et un pirate à une trame par seconde, donne :

| Fausse pression annoncée (vraie : 2,2 bar) | Fausse valeur acceptée au moins une fois | Durée maximale avec un état trompeur | Détection « SIGNAL SUSPECT » |
|---|---|---|---|
| 0,3 bar (fausse crevaison) | jamais | 0 s | toujours |
| 0,8 à 1,5 bar (fausse pression basse) | dans tous les cas simulés | environ 6 s, état PRESSION BASSE | toujours |

Une **fausse crevaison** n'est donc plus jamais acceptée. Une **fausse pression basse** pouvait en revanche être affichée quelques secondes avant le passage en « SIGNAL SUSPECT ».

**6. Deuxième correction.** Deux mesures ont été ajoutées :
- tant que le rythme est douteux, `TPMS.verifierVraisemblance` refuse **toute** variation de plus de 0,1 bar, et plus seulement les confirmations ;
- pendant le « SIGNAL SUSPECT », le boîtier n'affiche plus de pression (« -.-- ») au lieu de la dernière valeur, qui a peut-être été fabriquée (`TPMS.vueRoue`). L'app reçoit aussi « pression inconnue ».

Mesures après cette correction, écoute par fenêtres, pirate à une trame par seconde, 75 combinaisons de décalages :

| Fausse pression (vraie : 2,2 bar) | Acceptée au moins une fois | Durée max d'un état trompeur |
|---|---|---|
| 0,3 bar | 0 / 75 | 0 s |
| 0,8 bar | 30 / 75 | 6 s |
| 1,0 bar | 45 / 75 | 6 s |
| 1,5 bar | 60 / 75 | 6 s |

Le reste vient de la toute **première** fausse trame après un silence radio : aucune anomalie de rythme n'a encore été vue. Dans tous les cas, « SIGNAL SUSPECT » suit en 6 s au plus.

**7. Un compromis entre sécurité et sûreté.** Plafonner le temps de division à 3 s au lieu de 5 s supprime presque tous ces cas (0 / 75 jusqu'à 1,0 bar), mais retarde l'alerte d'une **vraie** crevaison : 32 à 36 s au lieu de 11 s au pire. Le plafond est donc laissé à 5 s : prévenir vite d'une vraie crevaison passe avant quelques secondes d'affichage faux, toujours suivies d'une alerte. Le cas le plus dangereux reste couvert : **masquer** une vraie crevaison en rejouant 2,2 bar échoue toujours, et le cycliste était prévenu en 7 s au pire avec la fenêtre fixe de 2 s ; avec la fenêtre actuelle et l'écoute renforcée, en 4 s au pire (test « rejeu pour masquer une vraie crevaison », § 6.5), 5 s depuis la correction du § 6.6.

### 6.5 Défaut trouvé par la simulation d'une semaine et corrigé : l'alerte de crevaison retardée

Ce paragraphe suit la même démarche que le § 6.4. Le défaut touche d'abord la **sûreté** (prévenir vite d'une vraie crevaison), mais sa correction renforce aussi la défense contre le pirate.

**1. Constat.** La simulation d'une semaine complète (planning « semaine type » de `simulateur/moteur.js`) a d'abord révélé un **verrouillage de phase** : un capteur garé n'annonce plus qu'une fois par minute, soit un multiple exact de la période d'écoute de 5 s. Avec une fenêtre toujours placée au même endroit de la période, une annonce qui tombait hors de la fenêtre y retombait à chaque fois : le capteur n'était jamais entendu, et le boîtier affichait une fausse alerte « capteur perdu ». La correction a été de changer la position de la fenêtre à chaque période (pseudo-hasard calculé à partir du numéro de période, `TPMS.melangerEntier`). Mais avec une fenêtre de 2 s à position variable, l'alerte d'une **vraie** crevaison pouvait arriver jusqu'à **34 s** après le début de la chute, contre 11 s avec la fenêtre fixe.

**2. Cause.** Une fenêtre de 2 s placée au hasard peut manquer plusieurs annonces de suite (le capteur annonce toutes les 3 s en roulant). Pendant ce temps, l'écart avec la dernière valeur acceptée grandit. Divisé par un temps plafonné à 5 s (§ 6.4), il dépasse 0,3 bar/s : la trame est jugée « suspecte » et doit être confirmée par 3 trames concordantes à 0,1 bar près. Or la pression continue de baisser, et les trames suivantes peuvent elles aussi tomber hors de la fenêtre : la confirmation traîne.

**3. Correction** (`simulateur/boitier/boitier.js`, traduite dans `firmware/tpms_boitier/src/logique/boitier.cpp`) :
- la fenêtre passe de 2 s à **3 s** toutes les 5 s. Elle dure au moins une période d'annonce du capteur en roulage (3 s) : chaque fenêtre entend donc forcément le capteur ;
- **écoute renforcée** : dès qu'une trame est jugée « suspecte » (changement brutal à confirmer) ou qu'un deuxième émetteur est détecté par le contrôle du rythme, la radio reste allumée en continu pendant 15 s (`TPMS.ECOUTE_RENFORCEE_MS`, `TPMS.boitierEcouteRenforcee`). Les trames de confirmation ne peuvent plus tomber hors de la fenêtre.

**4. Preuve par la mesure et le test.** Mesures faites avec la logique du boîtier : crevaison à 0,15 bar/s, capteur annonçant toutes les 3 s, 60 décalages entre le capteur et les fenêtres d'écoute ; délai entre le début de la chute et la première alerte :

| Stratégie d'écoute | Délai médian | Pire cas |
|---|---|---|
| Écoute permanente | 5 s | 6 s |
| Fenêtre fixe de 2 s | 7 s | 11 s |
| Fenêtre de 2 s à position variable, sans écoute renforcée | 9 s | 34 s |
| **Fenêtre de 3 s à position variable + écoute renforcée (retenue)** | **8 s** | **9 s** |

Avec la stratégie retenue :
- exigence EF-09 (état CREVAISON après le passage sous 0,5 bar) : **0,7 s au mieux, 1,7 s en médiane, 6,7 s au pire** (60 décalages), pour un objectif de moins de 10 s ;
- rejeu de 2,2 bar pour masquer une vraie crevaison : le cycliste est prévenu dans tous les cas (0 cas sans alerte sur 120), **4 s au pire**, contre 13 s avant la correction (test « rejeu pour masquer une vraie crevaison : alerte en moins de 10 s ») ; 5 s au pire depuis la correction du § 6.6 ;
- pirate qui usurpe l'adresse (une trame par seconde, 300 décalages) : **aucune fausse valeur acceptée** (test « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier », 30 décalages, avec l'écoute par défaut) ;
- la semaine simulée ne donne plus aucune minute en alerte (test « semaine : aucune minute en alerte » de `simulateur/tests/moteur.tests.js`).

**5. Ce qui reste.**
- La fenêtre de 3 s coûte de l'énergie : 7,063 mAh/jour au lieu de 5,896, soit une autonomie modélisée de 63,7 jours au lieu de 76,3 (`bilan-energetique.md`, § 3.4). L'objectif d'une semaine reste largement tenu.
- Le pire délai (9 s) reste supérieur à celui de l'écoute permanente (6 s) : c'est le prix de l'économie d'énergie.
- Un pirate peut déclencher volontairement l'écoute renforcée en continu. Cela ne fonctionne que pendant que le boîtier est éveillé (en veille, la radio est coupée) et ajoute au plus 40 % × 5 mA = 2 mA : l'effet sur l'autonomie reste faible. L'attaque est par ailleurs signalée (« SIGNAL SUSPECT »).

### 6.6 Défaut révélé par la simulation et corrigé : une vraie crevaison prise pour une intrusion

Ce paragraphe suit la même démarche que les § 6.4 et 6.5. Le défaut a été révélé en préparant les nouvelles attaques (§ 5.4), qui obligeaient à rejouer de nombreuses crevaisons complètes dans le simulateur.

**1. Constat.** Pendant une **vraie** crevaison, sans aucun pirate, le boîtier affichait parfois « SIGNAL SUSPECT » au lieu de « CREVAISON », pendant 60 s (la durée de la quarantaine) : 1 cas sur 6 essais (trou de 1,5 mm, graine 8). Le cycliste était prévenu qu'il se passait quelque chose, mais pas qu'il crevait.

**2. Cause.** Quand la pression varie vite, le capteur n'attend pas sa période normale de 3 s : il annonce tout de suite chaque variation, soit environ une trame par seconde. Or le contrôle du rythme considère deux trames d'une même adresse à moins de 2 s comme une anomalie, et 3 anomalies en 60 s comme une intrusion. La rafale d'annonces d'une vraie crevaison ressemblait donc à un second émetteur.

**3. Correction** (`logique/securite.js`, traduite dans `securite.cpp`). Deux trames rapprochées ne sont une anomalie que si la pression **ne baisse pas** de plus de 0,05 bar (`TPMS.RYTHME_DESCENTE_BAR`). Une vraie crevaison ne fait que baisser. Un pirate mêlé au vrai capteur, lui, fait forcément **remonter** la valeur une fois sur deux (fausse valeur puis vraie, ou l'inverse) : il reste détecté.

**4. Preuve par le test et la mesure.**
- Tests « rythme : la rafale d'une vraie crevaison n'est pas une intrusion » et « rythme : pirate mêlé au vrai capteur toujours détecté » (`tests.js`) ; le test « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » reste vert.
- Après correction : **0 fausse intrusion sur 12 crevaisons** (3 graines × 2 tailles de trou × capteurs du commerce et v2).
- Pirate qui usurpe l'adresse : 0 décalage sur 300 ne trompe le boîtier, comme avant.
- Rejeu pour masquer une vraie crevaison : alerte dans 120 cas sur 120, **5 s au pire** (4 s avant la correction).
- EF-09 inchangé : état CREVAISON 0,7 s au mieux, 1,7 s en médiane, 6,7 s au pire après le passage sous 0,5 bar.

**5. Ce qui reste.**
- Le rejeu masquant une crevaison est signalé 1 s plus tard au pire (5 s au lieu de 4 s).
- Un émetteur qui annonce une pression toujours en baisse n'est plus vu par le contrôle du rythme. Ce n'est possible pour un pirate que si le vrai capteur n'est plus reçu du tout, c'est-à-dire le scénario S6 (brouillage et imitation), déjà assumé au § 6.2.

### 6.7 Défaut révélé par la simulation et corrigé : fausse perte de capteur en montée lente

**1. Constat.** Dans la semaine type, le trajet domicile-travail passe par la montée de la Croix-Rousse, gravie entre 3,5 et 4,3 km/h. Le boîtier y affichait de fausses alertes « CAPTEUR PERDU » : **8 en 60 h** simulées (parcours Lyon en semaine type, graine 2026).

**2. Cause.** Un capteur TPMS ne sait qu'il roule que grâce à son détecteur de rotation, qui a un seuil (4,4 km/h dans le simulateur ; inconnu pour les vrais capteurs). En dessous, il se croit à l'arrêt et n'annonce plus qu'une fois par minute. Le boîtier, lui, voit la roue tourner grâce au reed : il se croyait « en roulant » et appliquait le délai de perte de 60 s. Une annonce par minute, reçue seulement si elle tombe dans une fenêtre d'écoute, laisse souvent passer plus de 60 s sans trame.

**3. Correction** (`simulateur/boitier/boitier.js`, traduite dans `boitier.cpp`). Le délai « en roulant » (60 s) ne s'applique qu'au-dessus de **10 km/h** (`TPMS.VITESSE_ROULAGE_SURE_KMH`), vitesse à laquelle on est sûr que le capteur est en mode roulage. En dessous, c'est le délai « à l'arrêt » (10 min) qui s'applique. La valeur de 10 km/h est une **hypothèse prudente**, choisie bien au-dessus du seuil simulé.

**4. Preuve par le test et la mesure.**
- Tests « perte : 90 s sans trame à 5 km/h (montée lente) → pas « capteur perdu » » et « perte : 90 s sans trame à 20 km/h → « capteur perdu » » (`tests.js`) : le premier reproduit la montée lente, le second vérifie que la correction n'a pas supprimé l'alerte au-dessus de 10 km/h.
- Après correction, les mêmes 60 h simulées ne donnent plus **aucune** fausse perte de capteur (graine 2026 ; même résultat avec la graine 8).

**5. Ce qui reste.** Un capteur réellement perdu (tombé, pile vide, brouillage) pendant qu'on roule à moins de 10 km/h n'est signalé qu'au bout de 10 min au lieu de 1 min. Le seuil de détection de rotation des vrais capteurs est à mesurer à la réception (§ 7).

### 6.8 Défaut révélé par la simulation de la flotte et corrigé : alerte rallumée en boucle

**1. Constat.** Dans la simulation de la flotte de location (§ 5.6), des vélos garés la nuit, à une pression proche de leur seuil bas, voyaient l'alerte « pression basse » s'allumer, s'éteindre, puis se rallumer plusieurs fois, avec un bip à chaque fois.

**2. Cause.** La pression oscille autour du seuil : elle baisse quand le pneu refroidit la nuit, et la mesure a un bruit de ±0,01 bar. Avec un seuil unique, chaque passage au-dessus puis au-dessous du seuil changeait l'état, donc relançait l'alerte. Un cycliste lassé de fausses alertes finit par ne plus les écouter, ce qui affaiblit aussi les vraies.

**3. Correction** (`logique/alertes.js`, traduite dans `alertes.cpp`). **Hystérésis** de 0,05 bar (`TPMS.HYSTERESIS_ALERTE_BAR`) : une alerte « pression basse » ne s'éteint qu'au-dessus du seuil bas + 0,05 bar ; une alerte « pression haute » qu'en dessous du seuil haut − 0,05 bar. Le seuil de déclenchement ne change pas.

**4. Preuve par le test.** 3 tests « hystérésis » (`tests.js`), seuil bas à 1,8 bar : 1,78 bar → BASSE ; 1,82 bar → reste BASSE (il faut 1,85 bar) ; 1,86 bar → OK.

**5. Ce qui reste.** Après un vrai regonflage léger, l'alerte peut rester allumée tant que la pression n'a pas dépassé le seuil de plus de 0,05 bar. C'est voulu : regonfler juste au seuil laisserait le pneu à la limite.

### 6.9 Pistage du cycliste par l'adresse fixe (S1, S12) : risque élevé, non traitable avec les capteurs du commerce

**Scénario.** Un espion pose des récepteurs BLE le long des rues et note chaque passage des capteurs (S12). Il ne s'approche jamais du vélo et n'a besoin d'aucune compétence en piratage.

**Évaluation.** Gravité 3 (trajets, horaires et quartier du domicile reconstitués : atteinte importante à la vie privée, donnée personnelle au sens du RGPD) × vraisemblance 3 (récepteurs à environ 40 € et logiciels de scan BLE publics) = **9, élevé**.

**Mesures possibles.** **Aucune** avec les capteurs du commerce : leur adresse est fixe, émise en clair dans chaque trame, et leur programme n'est pas modifiable. Le boîtier et l'application ne font que recevoir ces trames ; ils ne peuvent rien y changer. Il reste à **informer l'utilisateur** dans la notice (le cycliste peut dévisser les capteurs s'il ne veut pas être suivi) et à proposer des capteurs v2 (§ 5.5).

**Résultat mesuré** (`simulateur/sources/mouchards.js`, page « Vie privée ») : 20 récepteurs posés environ tous les 700 m le long des parcours en ville (Lyon et trajet domicile-travail), semaine type sur 5 jours (du lundi au vendredi, graine 8) :

| | Capteurs du commerce (produit actuel) | Capteurs v2 (proposition) |
|---|---|---|
| Adresses suivies par l'espion | 2 (une par capteur), 89 passages chacune | 77 adresses différentes |
| Trajets reliés à un même vélo | **10 trajets sur 5 jours** | aucune adresse vue sur plus d'un trajet |
| Ce que l'espion en déduit | Départ chaque matin à 7 h 46 près du même récepteur (M13), retour à 17 h 31 | Des passages isolés, qu'il ne peut pas relier entre eux |

Tests correspondants (`moteur.tests.js`, 2 jours de trajets) : « pistage : capteurs du commerce → les 4 trajets de 2 jours reliés », « pistage : capteurs v2 → aucune adresse vue sur plus d'un trajet », « pistage : capteurs v2 → le boîtier reconnaît toujours ses capteurs ».

**Ce qui reste.** Avec le produit actuel, le risque reste **élevé** et il est assumé : il vient du choix de capteurs du commerce, imposé par le budget et le calendrier. Il devra être signalé à l'utilisateur dans la notice du produit. Les limites de la proposition v2 sont au § 5.5.

### 6.10 Pirate synchronisé (S13) : repéré, mais une crevaison peut être masquée par moments

Même en émettant au même instant que le vrai capteur, le pirate ne peut pas superposer exactement ses trames : la norme BLE ajoute un délai aléatoire de 0 à 10 ms à chaque annonce. Le boîtier reçoit souvent les deux trames, et le contrôle du rythme le repère : « SIGNAL SUSPECT » 1 s après dans notre essai. Mais entre deux quarantaines, une vraie crevaison peut rester masquée : **98 s sur 240 s** dans notre essai (pirate à 1 m, à +10 et +20 dBm). Ce risque est assumé : l'attaque demande de suivre le cycliste à 1 m, et le cycliste voit « SIGNAL SUSPECT » à chaque détection. Avec des capteurs v2, les trames du pirate sont ignorées et la crevaison est signalée en 4 s.

### 6.11 Inondation (S14) : on peut la détecter, pas l'empêcher

Une inondation est un phénomène physique : aucune protection logicielle ne peut empêcher un émetteur d'occuper la radio. Le boîtier la **détecte** (« SATURE », journal) et continue de recevoir ses capteurs grâce à la liste blanche. Sans liste blanche, l'inondation suffit à faire passer de fausses trames pour nos roues : cette protection est **indispensable** (voir § 6.13). Le seuil de 50 annonces inconnues par seconde est une hypothèse : il faudra compter les annonces BLE dans une rue fréquentée pour vérifier qu'il ne donne pas de fausse détection (§ 7).

### 6.12 Déni de service par fausse intrusion (S11) et brouillage (S5)

Un pirate peut maintenir le boîtier en « SIGNAL SUSPECT » ou le priver de mesures par brouillage. Ce risque est accepté : l'information est perdue mais le cycliste **le sait** (alerte affichée), ce qui est préférable à une fausse valeur présentée comme vraie.

### 6.13 Un téléphone appairé peut désactiver les protections

L'octet 12 de la caractéristique REGLAGES permet d'activer ou de désactiver chaque protection, pour la démonstration devant le jury. `TPMS.verifierReglages` ne contrôle ni ce champ ni les adresses des capteurs : c'est un choix assumé, le propriétaire appairé reste maître de ses réglages. En contrepartie, un téléphone appairé, volé et déverrouillé, pourrait affaiblir le boîtier ; par exemple, sans liste blanche, une inondation fait accepter de fausses trames (§ 6.11). Dans un produit commercial, on pourrait imposer les protections, ou demander une confirmation par appui sur un bouton du boîtier pour ce type de changement.

### 6.14 Limites du serveur de flotte de démonstration (S19 à S22)

Le serveur de flotte est une démonstration. Ses limites sont connues et assumées ; pour chacune, la mesure à prendre en production est indiquée.

| Limite | Risque | En production |
|---|---|---|
| Démonstration en **HTTP** (S22) | Lots et réponses lisibles sur le réseau. La signature protège l'intégrité (un lot modifié est refusé), pas la confidentialité | HTTPS obligatoire |
| **Clés de démonstration publiques** dans le dépôt (S21) | N'importe qui peut signer un lot valide pour un vélo de démonstration | Une clé par boîtier, gravée à la fabrication ; coffre à secrets côté serveur. On pourrait aussi remplacer la clé partagée (HMAC) par une signature à clé publique (ECDSA) : le serveur ne garderait alors aucun secret capable de signer |
| **Lecture de l'API sans compte** (S20) | Positions, états et historiques des vélos lisibles par tous | Comptes « technicien » et « gestionnaire », chacun limité à ce dont il a besoin |
| **Limitation de débit en mémoire** (S19) | Remise à zéro à chaque redémarrage ; ne vaut que pour un seul serveur ; n'arrête pas une attaque venant de milliers d'adresses | Limitation partagée entre serveurs, protection anti-DDoS de l'hébergeur |
| **Liaison boîtier → serveur supposée** | Le boîtier réel n'a pas de modem | Passerelle dans chaque station ou module LTE-M ; le format des lots ne dépend pas de ce choix |

### 6.15 Hors périmètre

- **Accès physique au boîtier** : lecture de la mémoire du microcontrôleur pour en extraire les clés d'appairage. Non traité.
- **Téléphone compromis** : hors de notre contrôle.
- **Hébergement de l'application** : Web Bluetooth impose une page servie en HTTPS ; une page modifiée chez l'hébergeur ne pourrait cependant pas s'appairer sans le code affiché sur le boîtier.
- **Mise à jour du firmware par radio** : recommandation pour le firmware, ne pas exposer de service de mise à jour BLE ; la mise à jour se fera par USB, ce qui demande un accès physique.

---

## 7. Points à vérifier sur le matériel réel

| Point | Risque si non traité | Action prévue |
|---|---|---|
| Une annonce BLE est émise sur 3 canaux en quelques millisecondes | La protection « rythme » verrait 3 trames rapprochées et déclencherait de fausses intrusions | Ignorer les copies identiques reçues à moins de 100 ms (commentaire de `logique/securite.js`) |
| Intervalle d'annonce réel des capteurs | S'il est inférieur à 2 s, fausses intrusions permanentes | Mesurer, puis ajuster `RYTHME_MIN_MS` |
| Plage réelle des capteurs | `PRESSION_MAX_BAR` = 8 bar alors que les capteurs plafonnent peut-être vers 3,5 bar. Au-delà de sa plage, un capteur sature : le boîtier afficherait la limite de la plage au lieu de la vraie pression (le simulateur le reproduit, plage réglable 3,5, 5 ou 8 bar) | Mesurer la plage ; ajuster la limite de vraisemblance ; avertir l'utilisateur si la pression de gonflage dépasse la plage |
| Comportement de l'appairage avec code sur iPhone (Bluefy) et Chrome | Appairage impossible ou repli sur un mode sans code | Essai réel ; refuser toute connexion non authentifiée côté boîtier |
| Vitesse à partir de laquelle les capteurs détectent la rotation | Si elle dépasse 10 km/h, fausses pertes de capteur en roulant (§ 6.7) | Mesurer à quelle vitesse le rythme d'annonce passe de 60 s à 3 s ; ajuster `VITESSE_ROULAGE_SURE_KMH` |
| Nombre d'annonces BLE inconnues dans une rue fréquentée | Fausses détections « radio saturée » si le seuil de 50 par seconde est trop bas (§ 6.11) | Compter les annonces reçues en ville ; ajuster `SEUIL_INONDATION_PAR_S` |
| Journal chaîné dans le firmware | Il est en RAM, effacé à chaque veille (System OFF) | Fait dans le code (23/10/2026) : `stockage.cpp` le sauvegarde en flash (≈ 15 Ko, fichier `/journal.bin` avec somme de contrôle) à chaque mise en veille et le relit au réveil. À essayer sur la carte ; mesurer l'usure de la flash (quelques écritures par jour) |
| Capteurs v2 (si la proposition est réalisée) | Sans sauvegarde, le dernier compteur de chaque capteur serait perdu à chaque veille et la première trame rejouée après un réveil acceptée | Fait dans le code (23/10/2026) : annonces de 26 octets transmises, compteurs sauvegardés en flash à la mise en veille et relus au réveil (§ 5.5). À essayer sur la carte ; mesurer le temps de calcul des HMAC pendant une inondation |
| Liaison boîtier → serveur (mode flotte) | Aucune : le boîtier n'a pas de modem | Choisir entre une passerelle en station et un module LTE-M ; mesurer leur consommation |

---

## 8. Références

- ANSSI, *EBIOS Risk Manager – Le guide*, méthode d'analyse de risques (utilisée ici en version simplifiée).
- I. Rouf et al., « Security and Privacy Vulnerabilities of In-Car Wireless Networks: A Tire Pressure Monitoring System Case Study », *19th USENIX Security Symposium*, 2010.
- Bluetooth SIG, *Bluetooth Core Specification*, partie Security Manager (appairage LE Secure Connections) et adresses privées résolubles (idée reprise pour l'adresse privée des capteurs v2).
- NIST, *FIPS 180-4, Secure Hash Standard* (SHA-256) ; IETF, *RFC 2104* (HMAC) et *RFC 4231* (vecteurs de test HMAC-SHA256).
- Règlement (UE) 2016/679 (RGPD) : des trajets et horaires rattachés à un vélo sont des données personnelles.
- OWASP, *Top 10* et *API Security Top 10* (injection, authentification, limitation de débit) : liste de référence pour les scénarios S16 à S22 du serveur.
- Format de trame supposé des capteurs : github.com/schlumpf2009/TPMS.
