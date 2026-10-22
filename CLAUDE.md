# Projet BTS CIEL – Capteur de pression des pneus de vélo

Contexte de reprise : ce fichier résume tout ce qui a été décidé dans une conversation précédente avec Claude (20–22/10/2026). Lis-le en entier avant de commencer.

## L'étudiant
- Thibault MORRETTON, BTS CIEL option IR (Informatique et Réseaux), projet réalisé **seul**.
- Épreuve E6 « Valorisation de la donnée et cybersécurité ».
- Langue : français. Questions de clarification **sous forme de choix à cocher**.
- Claude écrit le code, mais Thibault doit pouvoir **l'expliquer au jury** : code simple, commenté en français, choix justifiés.
- Ambition déclarée : projet ambitieux, quitte à prendre des risques.

## Direction du projet (décision du 22/10/2026)
Le projet devient un **logiciel de simulation complète et réaliste** (page web) : tout se passe en simulation, aucun matériel réel n'est requis. Thibault veut que tout soit simulé « comme la réalité » : physique du pneu et du vélo (gaz parfait, température, altitude, fuites, pompe, dynamique, pentes), radio BLE réaliste (distance, RSSI, pertes, collisions, brouillage, plusieurs vélos), électronique simulée (schéma animé, tensions et courants, courbe LiPo, recharge) et sorties complètes (parcours sur carte, météo, plusieurs jours, enregistrement et rejeu, statistiques). Le firmware C++ et l'app Web Bluetooth réelle restent dans le dépôt mais ne sont plus prioritaires.

## Le produit (comme si c'était une entreprise)
Kit vendu environ 89 € : 2 capteurs de pression sur les valves + boîtier de guidon à écran e-paper + application.
Concurrents : SKS Airspy (~100 € la paire, sans afficheur), Quarq TyreWiz (~250 £ la paire).
Différenciation : afficheur dédié lisible au soleil, très basse consommation, fonctionne sans smartphone.

### Cahier des charges retenu
- Tous types de vélos ; vélo de test : valves **Schrader**, chambre à air.
- Capteurs de roue : **TPMS BLE du commerce** (bouchon de valve), trames diffusées en annonce BLE (manufacturer data), décodées par nous. Vérifier la plage max (souvent ~3,5 bar → OK VTT/ville, pas route).
- Boîtier guidon : Seeed XIAO nRF52840, e-paper 1,54″ 200×200 SPI (WeAct, SSD1681), LiPo 500 mAh, recharge par connecteur magnétique, IPX7, fixation quart de tour.
- Écran : pression AV/AR, température, niveau des piles/batterie, **vitesse et distance** (aimant de rayon + interrupteur reed filaire, circonférence de roue réglable).
- Alertes : **bip + LED**. Éclairage de nuit : 2 LED blanches latérales (pas de vrai front-light, trop cher).
- Autonomie boîtier : **≥ 1 semaine** (viser plusieurs) : écoute BLE par fenêtres, rafraîchissement écran seulement si changement, veille quand la roue ne tourne plus.
- Application : **page web Web Bluetooth**. Téléphone de Thibault : **iPhone** → la page s'utilise dans le navigateur **Bluefy** (Safari ne gère pas Web Bluetooth ; Flutter écarté car la compilation iOS exige un Mac). Réglage des seuils et de la circonférence, **historique des pressions**, **détection de fuite lente** sur plusieurs jours, export CSV.
- Cybersécurité (niveau modéré mais visible) : liste blanche des capteurs appairés, contrôle de vraisemblance (ex. saut de 2 bar en 1 s rejeté), liaison boîtier ↔ app appairée et chiffrée (BLE Secure Connections), page d'analyse de risques (les TPMS émettent en clair et peuvent être imités).

### Format de trame TPMS (hypothèse à confirmer à la réception des capteurs)
Format documenté pour des capteurs similaires (github.com/schlumpf2009/TPMS), 18 octets de manufacturer data :
- 0–1 : identifiant fabricant · 2 : n° de capteur (0x80 = 1, 0x81 = 2…) · 3–4 : préfixe d'adresse · 5–7 : adresse capteur
- 8–11 : pression en **Pa**, little-endian (à vérifier : diviser par 1000 → kPa)
- 12–15 : température en centièmes de °C, little-endian · 16 : batterie % · 17 : alarme (0x00 OK, 0x01 pas de pression)

## Matériel (commandé via la demande d'achat, pas encore reçu)
Total panier AliExpress relevé le 20/10/2026 : 59,73 € d'articles + 26,88 € de port = **86,61 € TTC**.
1. Lot 2 capteurs TPMS BLE – fr.aliexpress.com/item/1005012304143952.html – 22,19 €
2. Seeed XIAO nRF52840 – item/1005006988954136 – 11,99 €
3. E-paper WeAct 1,54″ – item/1005006291142235 – 8,49 €
4. LiPo 3,7 V 500 mAh 503035 – item/1005007061357307 – 5,59 €
5. Connecteur magnétique 2 broches – item/1005005754091146 – 1,23 €
6. Interrupteur reed PS-3150 – item/4000396271354 – 1,26 €
7. Aimant de rayon – item/1005008909051101 – 2,69 €
8. 2 boutons étanches 12 mm – item/1005012547081256 – 2 × 1,18 €
9. Buzzer actif 3 V – item/1005006603437309 – 0,81 €
10. Kit 100 LED 3 mm – item/1005007476457957 – 2,27 €
11. Joints toriques NBR – item/1005006417147355 – 0,85 €
Sur place : imprimante 3D, fer à souder fin/CMS, oscilloscope. Pas de mesureur de consommation (PPK2).
**À commander en plus** (câblage retenu dans firmware/README.md) : 2 MOSFET canal N logique (AO3400 ou 2N7002) pour le buzzer et l'éclairage, 1 diode 1N4148, résistances 100 Ω, 100 kΩ, 150 Ω, 270 Ω ; option reed : 1 MΩ + 10 nF.

## Le simulateur (cœur du projet depuis le 22/10/2026)
Décision de Thibault : en attendant le matériel, le projet est un **logiciel de simulation complète et réaliste** (page web, rien à installer) : physique du pneu et du vélo, météo et altitude, radio BLE réaliste, électronique animée, sorties sur plusieurs jours (planning « semaine type »), enregistrement et rejeu exact (graine + actions horodatées), statistiques, export CSV. Le firmware C++ et l'app Web Bluetooth restent dans le dépôt mais ne sont plus prioritaires.
- Principe d'architecture : la **logique** (`logique/`, pure, temps passé en paramètre) est séparée des **sources de données** ; elle est traduite telle quelle en C++ dans `firmware/tpms_boitier/src/logique/` et réutilisée par l'app.
- Réglages clés du boîtier : écoute radio 3 s toutes les 5 s à position variable + écoute renforcée 15 s après une trame douteuse ; capteur perdu après 60 s en roulant, 600 s à l'arrêt ; historique de pression compensé en température.
- Tests : `node simulateur/tests/tout.js` (412 tests en 6 suites, tous verts au 22/10/2026).
- Chiffres à jour et défauts révélés par la simulation : voir `docs/` (analyse de risques, bilan énergétique) et `docs/rapport-e6.md`.

## Organisation du dépôt
```
logique/      logique partagée (trames, vitesse, fuite, alertes, sécurité, protocole BLE, énergie)
simulateur/   jumeau numérique (boîtier virtuel dans simulateur/boitier/, sources simulées, tests)
app/          application Web Bluetooth (transport réel ou simulé)
firmware/     programme du boîtier (Arduino, XIAO nRF52840), traduction C++ de la logique
docs/         cahier des charges, analyse de risques, bilan énergétique, protocole, architecture, schéma, rapport E6
presentation/ diaporama de soutenance (page web, publiée sur GitHub Pages)
```
Le simulateur est l'outil de travail de Thibault (pas de « mode jury »). Style visuel : tableau de bord sombre, fond noir, cartes arrondies, accent violet #A78BFA, barre latérale.
En ligne (GitHub Pages, dépôt public titilyonnais/tpms-velo) : https://titilyonnais.github.io/tpms-velo/simulateur/ , /app/ et /presentation/. Commits avec l'adresse noreply 107395514+titilyonnais@users.noreply.github.com.
Initialiser git dès le départ : l'historique des commits sert de preuve d'avancement pour le jury.

## Points encore ouverts
- Nom de l'établissement, professeur référent, date de soutenance : laissés en champs à remplir ([Établissement], [Professeur référent], [Date de soutenance]) dans le rapport et la présentation.
- Plage de pression réelle des capteurs TPMS et format exact des trames. La fiche AliExpress ne donne pas la plage (vérifié le 22/10/2026) ; la simulation suppose 3,5 bar par défaut, réglable dans Configuration.
