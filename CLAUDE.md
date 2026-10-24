# Projet BTS CIEL – Surveillance de la pression des pneus (TPMS) : entrepôt et vélo

Contexte de reprise : ce fichier résume tout ce qui a été décidé dans une conversation précédente avec Claude (20–22/10/2026). Lis-le en entier avant de commencer.

## L'étudiant
- Thibault MORRETTON, BTS CIEL option IR (Informatique et Réseaux), projet réalisé **seul**.
- Épreuve E6 « Valorisation de la donnée et cybersécurité ».
- Langue : français. Questions de clarification **sous forme de choix à cocher**.
- Claude écrit le code, mais Thibault doit pouvoir **l'expliquer au jury** : code simple, commenté en français, choix justifiés.
- Ambition déclarée : projet ambitieux, quitte à prendre des risques.

## Direction du projet (décision du 22/10/2026)
Le projet devient un **logiciel de simulation complète et réaliste** (page web) : tout se passe en simulation, aucun matériel réel n'est requis. Thibault veut que tout soit simulé « comme la réalité » : physique du pneu et du vélo (gaz parfait, température, altitude, fuites, pompe, dynamique, pentes), radio BLE réaliste (distance, RSSI, pertes, collisions, brouillage, plusieurs vélos), électronique simulée (schéma animé, tensions et courants, courbe LiPo, recharge) et sorties complètes (parcours sur carte, météo, plusieurs jours, enregistrement et rejeu, statistiques). Le firmware C++ et l'app Web Bluetooth réelle restent dans le dépôt mais ne sont plus prioritaires.

## Orientation industrielle (décision du 24/10/2026)
Un professeur a jugé le projet « pas assez industriel » et pauvre en réseau. Choix de Thibault (questions à cocher) : **flotte de chariots élévateurs** à pneus gonflables (8,5 bar, capteurs « poids lourd » 0-13 bar, hypothèse), **maquette Docker complète** du réseau, **vélo gardé comme démonstrateur**. On ne change pas le cœur du projet, on l'adapte. Conception : `docs/orientation-industrielle.md` ; maquette : `entrepot/README.md`.
- Passerelles BLE → MQTT (`entrepot/passerelle.js`, client MQTT 3.1.1 écrit à la main `entrepot/mqtt.js`) : SNTP, TLS mutuel avec testament, lot toutes les 10 s en QoS 1, 1 h de lots gardés, syslog. Réception des lots en logique pure `entrepot/reception.js` (partagée par `serveur/chariots.js` et le mode démo de `flotte/chariots.html`).
- Réseau : VLAN 10 OT 10.10.10.0/24, 20 serveurs 10.10.20.0/24 (courtier .10, supervision .20, NTP .30, syslog .40), 30 bureautique 10.10.30.0/24 (poste .50), 40 DMZ 10.10.40.0/24, réseau « air » 10.10.99.0/24 (radio simulée) ; pare-feu nftables en .254 partout, politique « tout refusé », conduits 1 à 5 (+ règle 6 : le PC de démonstration, adresses .1 de l'hôte, redirigé vers la supervision par DNAT + masquerade).
- Maquette (`entrepot/`) : `node generer-certificats.js` puis `docker compose up -d --build` ; https://localhost:8443/flotte/chariots.html ; `node demonstration.js` = 13 essais (13/13 conformes le 24/10/2026). Pièges : réseaux Docker « internes » inutilisables (routes supprimées à la place), masquage Docker désactivé (`enable_ip_masquerade: false`), Docker choisit le réseau du port publié, `MSYS_NO_PATHCONV=1` pour `docker exec` depuis Git Bash, `curl --ssl-no-revoke` sous Windows, fichiers de PID de chrony et rsyslog effacés au démarrage. Docker Desktop ne redémarre pas seul avec le PC.
- Faille trouvée et corrigée (commit 1d64634) : la supervision servait `entrepot/certificats/*.cle` ; dossiers et extensions interdits, comparaison en minuscules.
- **Simulateur de l'usine** (25/10/2026, choix de Thibault) : `entrepot/usine.js` (logique pure, testée par `entrepot/usine.tests.js`) + `entrepot/simulateur.html` (8 pages : vue d'ensemble réalité/supervision, chariots et pneus, radio, réseau et pare-feu, courtier MQTT, heure et journaux, attaques et pannes, supervision). Machine par machine et paquet par paquet ; règles lues dans `regles.nft`, droits dans `courtier/acl` (tests de fidélité) ; technicien qui agit d'après la supervision (tournée 5 h 30, crevaisons) ; 20 essais (13 de la maquette + coupure de courant, balayage dans l'atelier, horloge +90 s, brouillage, redémarrage de la supervision, inondation, révocation). La page `flotte/chariots.html` en mode démo utilise ce même modèle.
- Physique de l'entrepôt enrichie : charge jusqu'à 2 t (échauffement des pneus avant), météo de la cour selon le mois, 12 °C la nuit dedans, capteur rapide au démarrage et 60 s après l'arrêt, piles qui s'usent, heure de Paris (`TPMS.heureParis`), maintenance automatique à 5 h 30 (aux quais).
- Défauts de logique trouvés en simulant et corrigés : client MQTT sans contrôle des PINGRESP (fermeture après 1,5 × la garde), supervision en session propre (session persistante + `surMessage`), dédoublonnage, zone (puissance lissée, hystérésis 3 dB, trames acceptées seulement), alerte PERDU jamais notée, seuils sur la pression brute (maintenant ramenée à 20 °C), fuite lente des chariots (tendance bar/jour, état FUITE_LENTE). Détail : `entrepot/README.md` § 6.
- Documentation à jour : analyse de risques S24 à S31 (§ 5.7, § 6.15), cahier des charges EF-25 à 29 et ENF-33 à 41, rapport chapitre 10 (bilan en 11), présentation 33 diapositives, fiche de l'oral Q29 à Q38.

## Le produit (comme si c'était une entreprise)
Kit vendu environ 89 € : 2 capteurs de pression sur les valves + boîtier de guidon à écran e-paper + application.
Concurrents : SKS Airspy (~100 € la paire, sans afficheur), Quarq TyreWiz (~250 £ la paire).
Différenciation : afficheur dédié lisible au soleil, très basse consommation, fonctionne sans smartphone.

### Cahier des charges retenu
- Tous types de vélos ; vélo de test : valves **Schrader**, chambre à air.
- Capteurs de roue : **TPMS BLE du commerce** (bouchon de valve), trames diffusées en annonce BLE (manufacturer data), décodées par nous. Vérifier la plage max (souvent ~3,5 bar → OK VTT/ville, pas route).
- Boîtier guidon : Seeed XIAO nRF52840, e-paper 1,54″ 200×200 SPI (WeAct, SSD1681), LiPo 500 mAh, recharge par connecteur magnétique, IPX7, collier de cintre (vis M3) + glissière à cran (boîtier amovible sans outil).
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
**À commander en plus** (câblage retenu dans firmware/README.md) : 2 MOSFET canal N logique (AO3400 ou 2N7002) pour le buzzer et l'éclairage, 1 diode 1N4148, résistances 100 Ω, 100 kΩ, 150 Ω, 270 Ω ; option reed : 1 MΩ + 10 nF. Depuis le 24/10/2026, en plus : carte GY-BMP280 (SPI), interrupteur TPS22918 (U4), 1 × 2N7002 (Q3), 100 kΩ (R10), 1 MΩ (R11), 1 × 2,2 kΩ (R12), pastille ePTFE autocollante Ø 10 mm (évent) ; non chiffrés.

## Le simulateur (cœur du projet depuis le 22/10/2026)
Décision de Thibault : en attendant le matériel, le projet est un **logiciel de simulation complète et réaliste** (page web, rien à installer) : physique du pneu et du vélo, météo et altitude, radio BLE réaliste, électronique animée, sorties sur plusieurs jours (planning « semaine type »), enregistrement et rejeu exact (graine + actions horodatées), statistiques, export CSV. Le firmware C++ et l'app Web Bluetooth restent dans le dépôt mais ne sont plus prioritaires.
- Principe d'architecture : la **logique** (`logique/`, pure, temps passé en paramètre) est séparée des **sources de données** ; elle est traduite telle quelle en C++ dans `firmware/tpms_boitier/src/logique/` et réutilisée par l'app.
- Réglages clés du boîtier : écoute radio 3 s toutes les 5 s à position variable + écoute renforcée 15 s après une trame douteuse ; capteur perdu après 60 s au-dessus de 10 km/h, 10 min sinon ; historique de pression compensé en température ; hystérésis de 0,05 bar sur les alertes basse/haute ; contrôle du rythme qui tolère la rafale d'une vraie crevaison ; prévision du prochain regonflage ; journal de sécurité chaîné (SHA-256) ; détection d'inondation radio.
- Ajouts du 23/10/2026 : statistiques et pression conseillée, page « Vie privée » (pistage par récepteurs espions), capteurs « v2 » en proposition (adresse privée, compteur, signature HMAC), attaques synchronisée / inondation / homme du milieu, mode flotte (serveur Node + SQLite + supervision de 20 vélos), boîtier 3D OpenSCAD (rendu avec OpenSCAD 2021.01, STL prêts dans boitier-3d/stl/, pas encore imprimé).
- Boîtier 3D version 2 (23/10/2026, détails dans boitier-3d/README.md) : 46 × 64 × 28 mm, forme type compteur GPS, PETG sans support ; joint torique radial 53 × 1,8 NBR 70 (écrasement 21,3 %, remplissage 66 %), 4 vis M2 fraisées dans des inserts laiton ; collier fendu + bride serrés par une vis M3 sur le cintre (cales 22,2 / 23,8 / 25,4 / 31,8 mm ; 22,2 par défaut, près des poignées) ; boîtier enclenché sur le collier par une glissière en queue d'aronde à cran, retiré sans outil ; tolérances en paramètres réglées avec la pièce `test_jeux`, joint avec `essai_joint` ; 10 pièces ; contrôle d'interférences et de parois par `outils/verifier-interferences.js`. Imprimante encore inconnue. L'ancienne fixation de la version 1 et l'ancien aperçu SVG sont supprimés.
- Mode flotte (commit 1e0ec90) : lecture de l'API réservée aux comptes (rôles technicien / gestionnaire), HTTPS en option (certificat auto-signé de démo, HSTS), RGPD (aucune position pendant une location, mesures et alertes 30 jours, journal des refus 6 mois) ; détails dans `serveur/README.md`.
- Ajouts du 24/10/2026 (choix de Thibault) :
  - **Confirmation par bouton** (commit 25897c9) : couper une protection ou changer de capteur depuis l'app n'est appliqué qu'après un appui long sur le bouton 2 ; l'écran montre ce qui change ; 30 s, autre bouton, veille ou déconnexion annulent ; la commande ACQUITTER de l'app ne peut pas confirmer ; bit 3 de l'octet 17 de MESURES.
  - **Baromètre BMP280** (commit f15b7e5) derrière un **évent ePTFE** sous le fond du boîtier : affichage et alertes corrigés de l'altitude (+0,17 bar à 1 500 m), historique gardé en pression du capteur ; MESURES : séquence sur 1 octet (octet 18), octet 19 = correction (pas de 4 mbar), bit 4 = recharge coupée. **Recharge coupée hors de 2-43 °C** par U4 TPS22918 + Q3 sur D6 (toujours permise carte éteinte), relâchée avant la veille (réveil par le 5 V). Broches libérées : fil BUSY de l'écran supprimé (attente fixe à mesurer avant de couper le fil), D0 = CSB du BMP280, SDO sur D9, deux boutons sur D5 (R12 2,2 kΩ, lecture analogique). Oublier les téléphones : bouton 1 tenu 5 s au démarrage.
  - **Sessions de la flotte** (commit 46158e7) : connexion par mot de passe (sel + scrypt), jeton de session 256 bits fermé après 15 min d'inactivité et 8 h au plus, vraie déconnexion ; `serveur/sessions.js`.
- Tests : `node simulateur/tests/tout.js` (717 tests JS en 8 suites : 208, 72, 62, 62, 86, 45, 135 pour le serveur, 47 pour l'entrepôt) + 136 tests C++ (`firmware/tests_pc`), lancés par GitHub Actions à chaque push. Pas de compilateur C++ sur le PC fixe : on vérifie le C++ en poussant sur une branche de vérification (GitHub Actions), puis on la supprime.
- Chiffres à jour et défauts révélés par la simulation : voir `docs/` (analyse de risques, bilan énergétique) et `docs/rapport-e6.md`.

## Organisation du dépôt
```
logique/      logique partagée (trames, vitesse, fuite, alertes, sécurité, protocole BLE, énergie)
simulateur/   jumeau numérique (boîtier virtuel dans simulateur/boitier/, sources simulées, tests)
app/          application Web Bluetooth (transport réel ou simulé)
firmware/     programme du boîtier (Arduino, XIAO nRF52840), traduction C++ de la logique
docs/         cahier des charges, analyse de risques, bilan énergétique, protocole, architecture, schéma, rapport E6
presentation/ diaporama de soutenance (page web, publiée sur GitHub Pages)
serveur/      serveur Node.js + SQLite du mode flotte (API REST signée HMAC)
flotte/       simulation de 20 vélos de location et page de supervision (mode démo sans serveur)
boitier-3d/   modèle OpenSCAD du boîtier, STL, rendus, outils d'export et de contrôle d'interférences
entrepot/     version industrielle : entrepôt simulé, passerelles MQTT, réception des lots, maquette Docker du réseau, démonstration
```
Le simulateur est l'outil de travail de Thibault (pas de « mode jury »). Style visuel : tableau de bord sombre, fond noir, cartes arrondies, accent violet #A78BFA, barre latérale.
En ligne (GitHub Pages, dépôt public titilyonnais/tpms-velo) : https://titilyonnais.github.io/tpms-velo/ (page d'accueil), /simulateur/ , /app/ , /flotte/ , /flotte/chariots.html et /presentation/. Commits avec l'adresse noreply 107395514+titilyonnais@users.noreply.github.com.
Initialiser git dès le départ : l'historique des commits sert de preuve d'avancement pour le jury.

## Points encore ouverts
- Faire valider l'orientation industrielle par le professeur référent.
- Nom de l'établissement, professeur référent, date de soutenance : laissés en champs à remplir ([Établissement], [Professeur référent], [Date de soutenance]) dans le rapport et la présentation.
- Plage de pression réelle des capteurs TPMS et format exact des trames. La fiche AliExpress ne donne pas la plage (vérifié le 22/10/2026) ; la simulation suppose 3,5 bar par défaut, réglable dans Configuration.
