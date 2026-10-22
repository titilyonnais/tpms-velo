# Projet BTS CIEL – Capteur de pression des pneus de vélo

Contexte de reprise : ce fichier résume tout ce qui a été décidé dans une conversation précédente avec Claude (20–22/10/2026). Lis-le en entier avant de commencer.

## L'étudiant
- Thibault MORRETTON, BTS CIEL option IR (Informatique et Réseaux), projet réalisé **seul**.
- Épreuve E6 « Valorisation de la donnée et cybersécurité ».
- Langue : français. Questions de clarification **sous forme de choix à cocher**.
- Claude écrit le code, mais Thibault doit pouvoir **l'expliquer au jury** : code simple, commenté en français, choix justifiés.
- Ambition déclarée : projet ambitieux, quitte à prendre des risques.

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

## Prochain chantier : le simulateur numérique (« jumeau numérique »)
Demande de Thibault : un logiciel qui centralise tout et permet de faire **en numérique tout ce qui sera faisable en réel**, avant d'avoir le matériel.
- Usage : **outil de conception ET démo pour le jury**.
- Format : **page web** (rien à installer).
- Modules demandés :
  1. **Capteurs + trames BLE** : régler pression / température / pile de chaque roue, voir la trame hexadécimale générée et décodée, simuler une crevaison ou une fuite lente.
  2. **Boîtier virtuel** : écran e-paper 200×200 noir et blanc rendu au pixel près, boutons, buzzer, LED d'alerte et de nuit, vitesse/distance via une roue virtuelle et l'aimant, veille, niveau de batterie.
  3. **App + historique** : seuils, circonférence, courbes de pression, détection de fuite lente.
  4. **Cybersécurité** : capteur pirate qui usurpe une adresse ou rejoue des trames, et protections activables (liste blanche, vraisemblance, compteur anti-rejeu) pour montrer l'attaque puis la parade.
  5. À ajouter : estimation d'autonomie (consommation par état, durée de vie batterie et piles CR1632).
- Principe d'architecture : séparer la **logique** (décodage de trame, alertes, calcul de vitesse, détection de fuite, sécurité) des **sources de données** (simulées vs vraies). Cette logique doit pouvoir être portée telle quelle dans le firmware Arduino du XIAO et dans l'app Web Bluetooth.

## Organisation du dépôt
```
logique/      logique partagée (trames, vitesse, fuite, alertes, sécurité, protocole BLE, énergie)
simulateur/   jumeau numérique (boîtier virtuel dans simulateur/boitier/, sources simulées, tests)
app/          application Web Bluetooth (transport réel ou simulé)
firmware/     programme du boîtier (Arduino, XIAO nRF52840), traduction C++ de la logique
docs/         cahier des charges, analyse de risques, bilan énergétique, protocole, architecture
```
Le simulateur est l'outil de travail de Thibault (pas un support de soutenance). Style visuel : « fiche technique » (papier crème, encre noire, rouge de repère).
Initialiser git dès le départ : l'historique des commits sert de preuve d'avancement pour le jury.

## Points encore ouverts
- Nom de l'établissement, professeur référent, date de soutenance.
- Plage de pression réelle des capteurs TPMS et format exact des trames.
