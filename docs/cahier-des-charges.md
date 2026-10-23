# Cahier des charges – Kit de surveillance de la pression des pneus de vélo

Projet BTS CIEL option IR – Thibault MORRETTON (projet individuel) – Épreuve E6 « Valorisation de la donnée et cybersécurité ».

Le projet est traité comme le développement d'un produit par une entreprise : un kit vendu environ 89 €, comprenant deux capteurs de pression, un boîtier de guidon et une application.

---

## 1. Expression du besoin

### 1.1 Constat

Un pneu de vélo perd de la pression avec le temps, et une crevaison lente ne se remarque souvent qu'au moment où le pneu est déjà presque à plat. Rouler sous-gonflé augmente la résistance au roulement, use le pneu et expose au pincement de la chambre à air. Vérifier la pression demande un manomètre et du temps : en pratique, beaucoup de cyclistes ne le font pas avant chaque sortie.

### 1.2 Besoin

Le cycliste veut **connaître en permanence la pression de ses deux pneus**, être **prévenu** en cas de pression anormale, de crevaison ou de fuite lente, sans dépendre de son smartphone pendant qu'il roule.

### 1.3 Bête à cornes

| Question | Réponse |
|---|---|
| À qui le produit rend-il service ? | Au cycliste (tous types de vélos) |
| Sur quoi agit-il ? | Sur l'information de pression et de température des pneus |
| Dans quel but ? | Rouler avec une pression correcte et détecter tôt une crevaison ou une fuite |

---

## 2. Le produit

### 2.1 Composition du kit

- **2 capteurs TPMS BLE** du commerce, en forme de bouchon de valve, qui diffusent pression, température et niveau de pile en annonces Bluetooth Low Energy.
- **1 boîtier de guidon** : microcontrôleur Seeed XIAO nRF52840, écran e-paper 1,54″ 200×200 pixels, batterie LiPo 500 mAh rechargeable par connecteur magnétique, buzzer, LED d'alerte, 2 LED blanches latérales, 2 boutons étanches, capteur de vitesse (aimant de rayon + interrupteur reed filaire), boîtier imprimé en 3D visé IPX7, fixation quart de tour.
- **1 application web** utilisant Web Bluetooth : Chrome sur PC et Android, navigateur Bluefy sur iPhone.

Prix de vente visé : environ 89 €.

### 2.2 Concurrence

| Produit | Prix indicatif | Afficheur dédié | Remarque |
|---|---|---|---|
| SKS Airspy | environ 100 € la paire de capteurs | Non | Lecture sur smartphone ou compteur compatible |
| Quarq TyreWiz | environ 250 £ la paire | Non | Lecture sur smartphone ou compteur compatible |
| **Ce projet** | environ 89 € le kit | **Oui (e-paper)** | Fonctionne sans smartphone |

Les prix sont des relevés indicatifs faits pendant la préparation du projet.

### 2.3 Différenciation

- **Afficheur dédié** lisible en plein soleil (e-paper, sans rétroéclairage).
- **Très basse consommation** : l'e-paper ne consomme rien pour garder une image affichée.
- **Fonctionne sans smartphone** : l'application ne sert qu'aux réglages et à l'historique.
- **Vitesse et distance** intégrées (fonction compteur).
- **Prévision du prochain regonflage** affichée sur le boîtier (« REGONFLER AV 12J AR 15J »).

---

## 3. Exigences fonctionnelles

Chaque exigence porte un critère de validation mesurable. La colonne « Vérification actuelle » indique ce qui est déjà vérifié dans le simulateur ou par les tests (`node simulateur/tests/tout.js`, qui lance les 7 suites ; les tests de la logique sont dans `simulateur/tests/tests.js`) ; la vérification sur le matériel réel sera faite à sa réception.

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| EF-01 | Le boîtier reçoit et décode les annonces BLE des deux capteurs de roue. | Une trame de 18 octets est décodée sans erreur (pression, température, pile, alarme, adresse). Sur le matériel : la pression affichée diffère de moins de 0,1 bar de celle d'un manomètre de référence (objectif à valider). | Tests « Trames » (14 tests), `logique/trame.js` |
| EF-02 | L'écran affiche la pression avant et arrière, la température, le niveau de pile de chaque capteur et le niveau de batterie du boîtier. | Toutes ces valeurs sont visibles sur l'écran 200×200 sans changer de page. | Rendu du simulateur, `simulateur/boitier/ecran.js` |
| EF-03 | Le boîtier mesure la vitesse et la distance à partir de l'aimant de rayon et du reed ; la circonférence de roue est réglable. | Un tour de 2 100 mm en 300 ms donne 25,2 km/h ; 10 tops donnent 9 tours. Circonférence acceptée de 1 000 à 3 000 mm. Sur le vélo : écart de distance inférieur à 2 % sur un parcours mesuré (objectif à valider). | Tests « Vitesse et distance », `logique/vitesse.js` |
| EF-04 | Le boîtier affiche les statistiques du trajet (vitesse moyenne, vitesse maximale, durée) et permet de les remettre à zéro. | Bouton 1 appui court : page suivante ; appui long : remise à zéro, la circonférence est conservée. | Test « remise à zéro », `TPMS.boitierBouton` |
| EF-05 | Le boîtier signale une crevaison, une pression basse ou haute, un capteur perdu et un signal suspect. | États évalués du plus grave au moins grave. Crevaison si pression < 0,5 bar ou alarme du capteur ; seuils par défaut AV 1,8 à 3,2 bar, AR 2,0 à 3,4 bar ; hystérésis de 0,05 bar (`TPMS.HYSTERESIS_ALERTE_BAR`) : une alerte « pression basse » ne s'éteint qu'au-dessus du seuil bas + 0,05 bar (exemple : seuil 1,8 bar, alerte à 1,78 bar, toujours en alerte à 1,82 bar, fin à 1,86 bar), et une alerte « pression haute » qu'en dessous du seuil haut − 0,05 bar, pour qu'une pression qui oscille autour du seuil ne rallume pas l'alerte en boucle ; capteur perdu après 60 s sans trame au-dessus de 10 km/h, 600 s (10 min) en dessous de 10 km/h et à l'arrêt (le capteur n'annonce plus qu'une fois par minute quand il ne sent pas la rotation). | Tests « Alertes » (9 tests), `logique/alertes.js` ; simulation de bout en bout : « arrêt : aucune fausse alerte « capteur perdu » », « fin d'attaque : pas de fausse alerte « capteur perdu » » (`moteur.tests.js`) ; « perte : 90 s sans trame à 5 km/h → pas « capteur perdu » » et « … à 20 km/h → « capteur perdu » » ; montée lente (3,5 à 4,3 km/h) : 0 fausse perte en 60 h simulées (§ 6.7 de `analyse-de-risques.md`) ; 3 tests « hystérésis » |
| EF-06 | Une alerte déclenche un bip et le clignotement de la LED ; la colonne de la roue concernée passe en négatif à l'écran. | Bip à l'apparition de l'alerte ; LED clignotante tant que l'alerte n'est pas acquittée. | Tests « Boîtier complet » |
| EF-07 | L'utilisateur peut acquitter une alerte. | Bouton 2 appui long : plus de bip, LED fixe tant que le problème dure. | Test « alerte acquittée → LED fixe » |
| EF-08 | Le boîtier détecte une fuite lente. | Pente calculée par régression linéaire sur 20 min au plus (1 point toutes les 30 s), après au moins 10 min de données (`TPMS.HISTO_DUREE_MIN_MS`) ; alerte si pente < −0,15 bar/h. Chaque point est ramené à 20 °C par la loi des gaz parfaits (`TPMS.pressionCompenseeBar`), pour qu'un pneu qui refroidit ne passe pas pour un pneu qui fuit. Une fuite de −0,3 bar/h est mesurée à ±0,03 bar/h et signalée environ 10 min après le début de l'historique. Un regonflage (+0,2 bar) remet l'historique à zéro. | Tests « Fuite lente », `logique/fuite.js` |
| EF-09 | Le boîtier détecte une crevaison rapidement. | Alerte CREVAISON affichée moins de 10 s après le passage sous 0,5 bar (objectif). | Simulation, avec l'écoute par défaut (fenêtre de 3 s à position variable + écoute renforcée) : 0,7 s au mieux, 1,7 s en médiane, 6,7 s au pire (60 décalages) ; voir § 6.5 de `analyse-de-risques.md` |
| EF-10 | Le boîtier offre un éclairage de nuit latéral. | Bouton 2 appui court : 2 LED blanches allumées ou éteintes ; l'indication « ECLAIRAGE » apparaît à l'écran. | `TPMS.boitierBouton`, `ecran.js` |
| EF-11 | Le boîtier se met en veille quand le vélo ne roule plus et se réveille seul. | Veille après le délai réglé (10 s à 1 h, 5 min par défaut) sans tour de roue ni appui ; réveil par un tour de roue ou un bouton. | Tests « veille après 5 min », « réveil par la roue » |
| EF-12 | Le boîtier fonctionne sans smartphone. | Toutes les fonctions EF-01 à EF-11, ainsi que la prévision du regonflage (EF-17), sont disponibles sans application connectée. | Par construction (`boitier.js`) |
| EF-13 | L'application se connecte au boîtier par Web Bluetooth et affiche les mesures en temps réel. | Fonctionne sur Chrome (PC ou Android) et sur Bluefy (iPhone de Thibault) ; une notification de mesures toutes les 5 s. | Format testé (`protocole.js`) ; application en cours dans `app/` (`transport-ble.js`), à essayer sur le matériel |
| EF-14 | L'application permet de régler les seuils, la circonférence, le délai de veille, les protections et les capteurs appairés. | Les réglages écrits sont relus à l'identique ; un réglage hors plage est refusé par le boîtier. | Tests « Protocole » et « Liaison » ; formulaire de réglages dans `app/`, avec contrôle `TPMS.verifierReglages` avant envoi |
| EF-15 | L'application conserve l'historique des pressions et l'affiche sous forme de courbes ; elle détecte les fuites lentes sur plusieurs jours. | Courbe AV/AR consultable ; même calcul de pente que le boîtier (`TPMS.penteMoindresCarresParHeure`, `logique/fuite.js`), exprimé en bar par jour ; jours avant le seuil bas calculés par la même fonction que le boîtier (`TPMS.joursAvantSeuil`). | En cours dans `app/app.js` (historique local, courbes, tendance, prévision, export CSV) |
| EF-16 | Un simulateur (page web) reproduit le fonctionnement du kit avant l'arrivée du matériel. | Les modules capteurs, boîtier, application, cybersécurité, vie privée et autonomie sont manipulables dans le navigateur. | Pages Vue d'ensemble, Configuration, Pneus, Radio et sécurité, Vie privée, Électronique, Application et Données de `simulateur/index.html` ; l'application y est intégrée dans un cadre et dialogue avec le boîtier virtuel ; planning « semaine type » pour simuler plusieurs semaines |
| EF-17 | Le boîtier prévoit dans combien de jours chaque pneu passera sous son seuil bas (prochain regonflage). | Un relevé de pression compensée en température au plus toutes les 3 h (en pratique un par sortie), 30 relevés au plus (environ 2 semaines) ; perte en bar/jour par régression linéaire ; jours restants = (pression − seuil bas) / perte par jour. Pas de prévision avant 4 relevés et 2 jours de recul ; pression « stable » si la perte est inférieure à 0,005 bar/jour (le bruit du capteur est de ±0,01 bar) ; un regonflage (+0,2 bar) efface les relevés. Écran, page 2 : « REGONFLER AV 12J  AR 15J » (« -- » sans prévision, « >60J » au-delà de 60 jours). Objectif : erreur de 2 jours au plus à l'approche du seuil. | 9 tests « prévision » (`tests.js`, `logique/fuite.js`) ; test « semaine : prochain regonflage prévu dans 3 à 60 jours » (`moteur.tests.js`). Mesure sur 3 semaines simulées (chambre butyle, perte d'environ 0,03 bar/jour, 2,2 bar, seuil 1,8 bar) : au 3e jour le boîtier annonce 16 jours, le seuil est atteint vers le 18e jour ; la prévision se resserre ensuite jusqu'au jour J (erreur de 1 à 2 jours) |
| EF-18 | Le simulateur présente des statistiques par jour et par semaine à partir de l'enregistrement. | Distance, minutes de roulage, pression moyenne en roulant (pondérée par le temps), pression minimale, regonflages repérés (hausse brusque de plus de 0,2 bar), minutes en alerte, énergie consommée par le boîtier (baisses de l'état de charge × 500 mAh). | 8 tests « stats » (`logique/statistiques.js`) ; tableau « Statistiques » de la page Données (par jour / par semaine). Logique réutilisable par l'application |
| EF-19 | Le simulateur conseille une pression avant et arrière selon le poids du cycliste, la largeur des pneus et la répartition du poids. | Pression proportionnelle à la charge de chaque roue (règle de Frank Berto : environ 15 % d'écrasement du pneu) ; référence pour 50 kg sur la roue : 6,5 bar pour un pneu de 25 mm, 3,9 bar pour 38 mm, 2,4 bar pour 57 mm ; garde-fous 1 à 9 bar ; arrondi au dixième. Avertissement si la pression conseillée dépasse la plage des capteurs. **Hypothèse** : ordre de grandeur, pas la recommandation d'un fabricant (pas de source fiable trouvée pour les constantes de la formule de Berto qui circule) ; il faut rester dans la plage écrite sur le flanc du pneu. | 5 tests « conseil » (`logique/conseil.js`) ; champ « Poids du cycliste » et bouton « Utiliser les pressions conseillées » de la page Configuration. Exemples pour 75 kg : route 25 mm → 4,3 bar AV / 6,5 bar AR ; ville 38 mm → 2,5 / 4,7 bar (au-dessus de la plage de 3,5 bar : le bouton choisit alors des capteurs 0-5 ou 0-8 bar) ; VTT 57 mm → 1,7 / 2,6 bar |

### Extension « flotte de location » (mode entreprise)

Une entreprise de location équipe 20 vélos du kit ; les boîtiers envoient leurs mesures à un serveur, et un technicien fait sa tournée selon les priorités calculées. Le passage du boîtier au serveur (passerelle en station ou module LTE-M) est une **hypothèse** : le boîtier commandé n'a pas de modem. Tout est vérifié en simulation (`flotte/`, `serveur/`, tests de `serveur/serveur.tests.js`).

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| EF-20 | Les boîtiers d'une flotte envoient leurs mesures par lots au serveur, qui les enregistre. | Un lot signé toutes les 30 min par vélo, sur `POST /api/mesures` ; enregistrement dans une base SQLite (tables `velos`, `mesures`, `alertes`, `regonflages`, `refus`) ; tous les lots valides acceptés, aucune mesure en double si un lot est renvoyé. | Essai réel : 14 jours simulés en 31 s, 1 120 lots acceptés sur 1 120 (40 356 mesures) ; tests « bout en bout : tous les lots de 10 jours acceptés », « lot déjà reçu renvoyé : accepté mais aucune mesure en double » |
| EF-21 | Le serveur détecte les fuites lentes que le boîtier ne peut pas voir. | Pente sur plusieurs jours (moindres carrés, pression ramenée à 20 °C, une mesure par demi-heure, au moins 24 h et au plus 14 jours depuis le dernier regonflage) ; fuite si la perte dépasse 0,10 bar/jour ; pas de fausse alerte pour une chambre butyle normale. | Fuites de −0,15 à −0,5 bar/jour repérées en général en moins d'un jour et demi ; 0 fausse alerte de fuite sur 6 graines × 21 jours (pentes naturelles de −0,02 à −0,056 bar/jour) ; tests « tendance : −0,30 bar/j retrouvé et classé « fuite lente » », « tendance : −0,04 bar/j (butyle normal) n'est pas une fuite », « pas de fausse fuite lente sur les 19 autres vélos » |
| EF-22 | La supervision donne l'état de chaque vélo et trie la tournée du technicien par priorité. | Statuts du plus grave au moins grave : immobilisé, urgent, à regonfler (dès 90 % de la pression nominale, avant l'alerte du boîtier à 80 %), muet (plus de nouvelles depuis 26 h), à surveiller (regonflage prévu dans moins de 3 jours), OK ; détail d'un vélo avec sa courbe ramenée à 20 °C. | Tests « vélo qui fuit : V05 repéré « à regonfler » (ou pire) », « vélo qui fuit : V05 en tête de la tournée », « chaque vélo a le même statut côté serveur et côté démo » |
| EF-23 | Le serveur calcule les indicateurs de la flotte. | Vélos à regonfler, fuites lentes, vélos immobilisés, temps moyen entre deux regonflages, kilomètres, refus par motif ; calculs en SQL (`GROUP BY`, `LAG`) identiques à ceux de la démo en JavaScript. | Temps moyen entre deux regonflages : 8,7 jours (essai de 14 jours) ; 7 tests « statistiques : … » comparant SQL et registre JavaScript |
| EF-24 | La supervision peut être montrée sans serveur. | Sur GitHub Pages ou en fichier local, la page fait tourner la flotte dans le navigateur avec les mêmes règles, et le signale par un bandeau. | Mode démo de `flotte/index.html`, en ligne : https://titilyonnais.github.io/tpms-velo/flotte/ |

---

## 4. Exigences non fonctionnelles

### 4.1 Énergie, robustesse, ergonomie

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-01 | Autonomie du boîtier d'au moins une semaine (viser plusieurs semaines). | Journée type (1 h de vélo, 2 sorties, 15 min d'éclairage, 6 min d'application) : autonomie calculée ≥ 7 jours, puis confirmée par mesure. | Modèle : 63,7 jours avec la fenêtre d'écoute de 3 s (`bilan-energetique.md`) ; test « autonomie supérieure à 1 semaine » ; semaine simulée (sans éclairage) : batterie à 92,6 % avant la recharge du dimanche, test « semaine : batterie jamais sous 90 % » |
| ENF-02 | Durée de vie des piles CR1632 des capteurs d'au moins un an. | Durée calculée ≥ 365 jours pour l'intervalle d'annonce réel des capteurs. | Modèle : 524 jours pour une annonce toutes les 3 s (hypothèse) |
| ENF-03 | Écran lisible en plein soleil. | Écran e-paper réflectif ; chiffres de pression de 28 pixels de haut (police 5×7 agrandie 4 fois), soit environ 3,9 mm sur un écran de 27,7 mm de côté. | `ecran.js` |
| ENF-04 | L'écran ne se rafraîchit que si nécessaire. | Au plus un rafraîchissement toutes les 2 s en roulant ; aucun si l'image n'a pas changé ; un rafraîchissement complet toutes les 20 mises à jour partielles. | Test « écran inchangé → pas de rafraîchissement » |
| ENF-05 | Boîtier étanche IPX7. | Immersion temporaire à 1 m pendant 30 min sans entrée d'eau (définition IPX7 de la norme IEC 60529). | Conception faite (`boitier-3d/`) : joint torique NBR 53 × 2 **radial**, dans une gorge de la jupe du couvercle ; écrasement calculé ≈ 22,5 % (17,5 à 27,6 % avec ±0,1 mm d'erreur d'impression) ; vis hors du joint ; vitre PMMA collée ; LED et connecteur collés à l'époxy. Essais prévus (bulles, puis immersion 1 m 30 min) décrits dans `boitier-3d/README.md`. **Non vérifié** : boîtier ni rendu ni imprimé |
| ENF-06 | Fixation au guidon démontable sans outil. | Fixation quart de tour ; le boîtier ne bouge pas sur un parcours pavé (objectif à valider). | Modélisée : tenons sous la coque, butées et crans de 0,35 mm, collier de cintre 31,8 ou 25,4 mm. À tester ; compatibilité avec un vrai support Garmin non vérifiée (cotes non officielles) |
| ENF-07 | Recharge sans ouvrir le boîtier. | Connecteur magnétique 2 broches accessible de l'extérieur. | Modélisé : connecteur affleurant sur la face avant, noyé dans l'époxy à l'intérieur. À tester |
| ENF-22 | Le boîtier se fabrique avec l'imprimante 3D disponible et loge tous les composants. | Modèle paramétré dont les dimensions sont calculées à partir des composants ; épaisseurs et dégagements contrôlés ; matière qui tient au soleil (pas de PLA, qui flue vers 60 °C). | `boitier-3d/boitier.scad` : extérieur 46,0 × 64,4 × 28,0 mm (33,2 mm avec les tenons), hauteur imposée par les écrous des boutons ; PETG (ou ASA), remplissage 100 % ; 42 règles de cotes vérifiées par script (`boitier-3d/outils/`). **Non vérifié** : le modèle n'a jamais été rendu (OpenSCAD absent du PC), son du buzzer à travers 1,2 mm de paroi et portée BLE dans le boîtier à mesurer |

### 4.2 Logiciel

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-08 | La logique est séparée des sources de données et portable en C++. | Les fichiers de `logique/` n'utilisent ni la page web ni l'horloge ; le temps est passé en paramètre. | Revue du code ; architecture décrite dans `architecture.md` |
| ENF-09 | La logique est vérifiée par des tests automatiques, lancés à chaque modification du code. | `node simulateur/tests/tout.js` : 539 tests JavaScript en 7 suites, tous réussis (logique et boîtier 158, pneu, météo et capteur 72, vélo et parcours 62, radio 62, électronique 80, monde complet 38, serveur et flotte 67). Traduction C++ de la logique : 109 tests, compilés avec g++ et exécutés sur PC (`firmware/tests_pc`), tous réussis. Les deux séries sont lancées automatiquement par GitHub Actions à chaque envoi de code (push) sur GitHub. | Vérifié ; badge « Tests » en tête du README, résultat visible sur chaque commit (`.github/workflows/tests.yml`) |
| ENF-10 | Le code est commenté en français et explicable par l'étudiant. | Chaque fichier commence par un en-tête qui explique son rôle ; chaque constante est justifiée. | Revue du code |
| ENF-11 | Le simulateur et l'application ne demandent aucune installation. | Ouverture par double-clic (simulateur) ; navigateur Chrome ou Bluefy (application). | Aucune bibliothèque JavaScript externe ; seules les polices de caractères sont chargées depuis Google Fonts (sans connexion, le navigateur utilise une police de remplacement) |

### 4.3 Cybersécurité

Le détail est dans `analyse-de-risques.md`.

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-12 | Seuls les deux capteurs appairés sont pris en compte (liste blanche). | Une trame d'adresse inconnue est ignorée, même si elle porte le numéro de capteur 1. | Test « capteur inconnu ignoré », `TPMS.positionCapteur` |
| ENF-13 | Une valeur physiquement impossible est rejetée ; un changement brutal doit être confirmé. | Rejet si pression > 8 bar ou température hors −40 à +85 °C ; variation > 0,3 bar/s (temps de calcul plafonné à 5 s) acceptée seulement après 3 trames concordantes (à 0,1 bar près), et jamais tant que le contrôle du rythme a un doute. | Tests « vraisemblance », `TPMS.verifierVraisemblance` |
| ENF-14 | Un second émetteur utilisant l'adresse d'un capteur appairé est détecté, sans prendre une vraie crevaison pour une attaque. | 3 trames espacées de moins de 2 s en 1 min → état « SIGNAL SUSPECT » pendant 60 s ; deux trames rapprochées dont la pression baisse de plus de 0,05 bar ne comptent pas (rafale d'une vraie crevaison) ; une fausse crevaison n'est jamais acceptée, en écoute continue comme en écoute par fenêtres. | Tests « rythme », scénario pirate et « pirate + écoute par fenêtres », `TPMS.controlerRythme` ; 0 fausse intrusion sur 12 crevaisons simulées (§ 6.6 de `analyse-de-risques.md`) |
| ENF-15 | La liaison boîtier ↔ application est appairée et chiffrée. | Appairage BLE Secure Connections par code à 6 chiffres affiché sur l'e-paper ; réglages et commandes refusés sans appairage. | Tests « Liaison » ; à valider sur le matériel |
| ENF-16 | Le code d'appairage ne peut pas être trouvé par essais successifs. | Code tiré au hasard, valable 60 s, non remplacé tant qu'il est valide ; après 3 codes faux, appairage bloqué 60 s. | Test « 3 codes faux → bloqué » |
| ENF-17 | Le boîtier vérifie les réglages qu'il reçoit, même d'un téléphone appairé. | Circonférence 1 000 à 3 000 mm, seuils 0,5 à 6 bar avec seuil bas < seuil haut, délai de veille 10 s à 1 h ; sinon refus motivé. | Test « seuil bas > seuil haut refusé », `TPMS.verifierReglages` |
| ENF-18 | Les données de l'utilisateur restent sur ses appareils. | Pas de compte, pas de serveur : l'historique reste dans le navigateur du téléphone. | `app/app.js` : historique dans le stockage local du navigateur |
| ENF-19 | Le journal de sécurité du boîtier est traçable : une modification se voit. | Chaque ligne contient l'empreinte SHA-256 de la précédente ; une ligne modifiée est repérée par la vérification ; une réécriture complète est repérée en comparant avec la dernière empreinte copiée sur le téléphone. SHA-256 et HMAC-SHA256 conformes aux vecteurs officiels (FIPS 180-4, RFC 4231). | 10 tests de la section « SHA-256, HMAC et journal chaîné » de `tests.js` (`logique/sha256.js`, `logique/journal.js`) ; tuile « Journal de sécurité chaîné » de la page Radio et sécurité |
| ENF-20 | Une inondation d'annonces est détectée et n'empêche pas de recevoir les capteurs appairés. | Plus de 50 annonces inconnues par seconde pendant 5 s → « SATURE » sur l'écran et ligne au journal, sans bip ; retour à la normale après 10 s de calme ; les capteurs appairés restent reçus. | 3 tests « inondation » ; simulation à 500 annonces/s : détection en 16 s, 22 à 24 trames de nos capteurs acceptées en 60 s |
| ENF-21 | **Proposition pour une version 2** (hors kit actuel) : les capteurs ne permettent ni le pistage du cycliste, ni l'usurpation, ni le rejeu. | Adresse privée changée toutes les 15 min ; aucune adresse vue sur plus d'un trajet par un réseau de récepteurs espions ; trame mal signée ou au compteur déjà vu refusée. | Simulation seulement : non réalisable avec les capteurs du commerce (adresse fixe, programme non modifiable). 12 tests « v2 », 3 tests « pistage » ; 5 jours simulés : 77 adresses, aucun trajet relié (contre 10 trajets reliés avec les capteurs du commerce) ; 163 à 173 trames rejouées refusées en 4 min (§ 5.5 de `analyse-de-risques.md`) |

### 4.4 Cybersécurité du serveur de flotte

Le détail est dans `analyse-de-risques.md` (scénarios S16 à S22, § 5.6 et § 6.14).

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-23 | Le serveur n'accepte que les lots signés par le vélo annoncé. | Signature HMAC-SHA256, avec la clé secrète du vélo, de l'identifiant, de l'horodatage, du numéro de séquence et du corps ; comparaison à temps constant ; lot modifié ou signé avec la clé d'un autre vélo → 401, rien n'est enregistré. | Tests « corps modifié après signature : refusé (401 signature) », « corps modifié : rien n'est enregistré », « signé avec la clé de V02 en se disant V01 : refusé » ; essai réel avec `--attaque-signature` |
| ENF-24 | Un lot capturé ne peut pas être rejoué. | Horodatage à ±60 s de l'horloge du serveur et numéro de séquence strictement croissant, gardé en base (tient après un redémarrage). | Tests « rejeu de la même requête : refusé (401 rejeu) », « horodatage vieux de 2 min : refusé (401 horodatage) », « séquence plus petite que la dernière : refusée (rejeu) » ; essai réel avec `--attaque-rejeu` |
| ENF-25 | Les données reçues sont validées ; une injection SQL est sans effet. | Liste blanche des champs, types et plages (limites de `logique/securite.js`), dates croissantes ; identifiant « V + 2 chiffres » ; requêtes SQL toujours paramétrées. | Tests « injection SQL dans X-Velo-Id : refusée (400) », « requête paramétrée : « V01' OR '1'='1 » ne renvoie aucune mesure », « injection SQL : tables intactes » ; banc d'essai de la page : pression à 12 bar → 400 |
| ENF-26 | Le serveur résiste à un envoi massif de requêtes. | 120 requêtes par minute et par vélo authentifié (au-delà : 429) ; adresse IP bloquée 5 min après 30 refus en une minute ; corps ≤ 64 Kio (au-delà : 413) ; délais de lecture contre les requêtes lentes. | Tests « limitation de débit : 5 requêtes acceptées, puis 429 », « limitation par vélo : V07 n'est pas pénalisé par V06 », « après 4 signatures fausses, l'adresse IP est bloquée (429) », « corps de plus de 64 Kio : refusé (413) » |
| ENF-27 | En production : échanges chiffrés, lecture réservée aux comptes autorisés, clé secrète propre à chaque boîtier. | HTTPS ; comptes « technicien » et « gestionnaire » ; clé gravée à la fabrication et coffre à secrets côté serveur. | **Non tenue par la démonstration** (limites assumées) : HTTP, lecture de l'API sans compte, clés de démonstration publiques dans `serveur/cles-demo.json`, limitation de débit en mémoire |

---

## 5. Contraintes

| Type | Contrainte |
|---|---|
| Organisation | Projet réalisé seul ; date de soutenance, établissement et professeur référent encore à préciser. |
| Budget | Matériel commandé pour 86,61 € TTC (voir § 6). |
| Matériel | Capteurs TPMS du commerce : le format des trames et la sécurité des capteurs ne sont pas modifiables (adresse fixe, émission en clair). Des capteurs « version 2 » sécurisés sont seulement proposés et simulés (ENF-21). |
| Vélo de test | Valves Schrader, chambre à air. |
| Téléphone | iPhone : Safari n'implémente pas Web Bluetooth, d'où l'utilisation du navigateur Bluefy ; Flutter écarté car la compilation pour iOS exige un Mac. Sur PC et Android : Chrome. |
| Web Bluetooth | L'application doit être servie dans un contexte sécurisé (HTTPS ou `localhost`). |
| Outillage | Disponible : imprimante 3D, fer à souder fin/CMS, oscilloscope. Pas de mesureur de consommation (PPK2) : les mesures de courant se feront avec une résistance shunt et l'oscilloscope (voir `bilan-energetique.md`). |
| Calendrier | Le matériel n'est pas encore reçu : la conception est menée dans le simulateur. |

---

## 6. Matériel et budget

Commande AliExpress, total du panier relevé le 20/10/2026.

| # | Article | Référence (fr.aliexpress.com/item/…) | Prix |
|---|---|---|---|
| 1 | Lot de 2 capteurs TPMS BLE | 1005012304143952 | 22,19 € |
| 2 | Seeed XIAO nRF52840 | 1005006988954136 | 11,99 € |
| 3 | Écran e-paper WeAct 1,54″ 200×200 (SSD1681) | 1005006291142235 | 8,49 € |
| 4 | Batterie LiPo 3,7 V 500 mAh (503035) | 1005007061357307 | 5,59 € |
| 5 | Connecteur magnétique 2 broches | 1005005754091146 | 1,23 € |
| 6 | Interrupteur reed PS-3150 | 4000396271354 | 1,26 € |
| 7 | Aimant de rayon | 1005008909051101 | 2,69 € |
| 8 | 2 boutons étanches 12 mm | 1005012547081256 | 2 × 1,18 € = 2,36 € |
| 9 | Buzzer actif 3 V | 1005006603437309 | 0,81 € |
| 10 | Kit de 100 LED 3 mm | 1005007476457957 | 2,27 € |
| 11 | Joints toriques NBR | 1005006417147355 | 0,85 € |
| | **Sous-total articles** | | **59,73 €** |
| | Frais de port | | 26,88 € |
| | **Total TTC** | | **86,61 €** |

Remarques :
- Ce coût est celui d'un prototype unique, au prix de détail et avec les frais de port ; il ne représente pas le coût de revient d'un produit fabriqué en série.
- Le filament pour le boîtier imprimé en 3D, les fils et la visserie ne sont pas comptés dans ce total.

---

## 7. Hypothèses à confirmer à la réception du matériel

| Hypothèse | Valeur retenue dans le code | Où | Comment la confirmer |
|---|---|---|---|
| Format de trame des capteurs | 18 octets de « manufacturer data », format documenté pour des capteurs similaires (github.com/schlumpf2009/TPMS) | `logique/trame.js` | Capturer les annonces avec une application de scan BLE et comparer avec une pression connue |
| Identifiant fabricant (octets 0-1) | `00 01` | `TPMS.ID_FABRICANT` | Même capture |
| Unité de la pression | Pa, little-endian (÷ 100 000 → bar) | `TPMS.PA_PAR_BAR` | Comparer avec un manomètre à plusieurs pressions |
| Plage de mesure des capteurs | Souvent annoncée autour de 3,5 bar pour ce type de capteur : convient au VTT et au vélo de ville, pas aux pneus de route. La fiche AliExpress ne la donne pas. Le simulateur suppose 0 à 3,5 bar par défaut, réglable à 0-5 ou 0-8 bar dans la page Configuration ; au-delà, la mesure sature, et la configuration avertit si la pression choisie dépasse la plage. Le boîtier accepte jusqu'à 8 bar (`TPMS.PRESSION_MAX_BAR`) et des seuils jusqu'à 6 bar. | `simulateur/monde/capteur.js` (`plageMaxBar`), `logique/securite.js`, `logique/protocole.js` | Fiche du vendeur et essai au gonfleur ; régler la plage du simulateur, ajuster `PRESSION_MAX_BAR` et la plage des seuils |
| Intervalle d'annonce des capteurs | 3 s | `simulateur/monde/capteur.js`, `securite.js` (`RYTHME_MIN_MS` = 2 s) | Mesurer l'écart entre annonces ; vérifier qu'il reste supérieur à 2 s, sinon la protection « rythme » donnerait de fausses alertes |
| Copies d'une même annonce | Une annonce BLE est émise sur 3 canaux en quelques millisecondes | Commentaire de `securite.js` | Le firmware devra ignorer les copies identiques reçues à moins de 100 ms d'écart |
| Vitesse à partir de laquelle les capteurs sentent la rotation | 4,4 km/h dans le simulateur ; le boîtier n'applique le délai de perte « en roulant » (60 s) qu'au-dessus de 10 km/h, par prudence | `simulateur/monde/capteur.js`, `TPMS.VITESSE_ROULAGE_SURE_KMH` (`boitier.js`) | Rouler de plus en plus vite et noter quand l'intervalle d'annonce passe de 60 s à 3 s |
| Liaison boîtier → serveur (mode flotte) | Une passerelle dans chaque station, ou un module LTE-M ; un lot toutes les 30 min | `flotte/flotte.js`, `serveur/README.md` | Choisir la solution et mesurer sa consommation ; le format des lots n'en dépend pas |
| Pression conseillée | Courbe de référence du simulateur (6,5 bar pour 25 mm à 50 kg sur la roue), pression proportionnelle à la charge | `logique/conseil.js` | Comparer avec les tableaux des fabricants de pneus ; c'est un ordre de grandeur |
| Consommations du boîtier | Valeurs de fiches techniques | `logique/energie.js` | Protocole de mesure de `bilan-energetique.md` |
| Compatibilité Bluefy | Web Bluetooth, notifications et appairage avec code disponibles sur iPhone | – | Essai sur l'iPhone de Thibault avec le boîtier réel |

### Points de vigilance relevés dans le simulateur

- **Fuite lente et bruit de mesure** : avec un bruit de ±0,01 bar sur chaque mesure, une simulation de 2 000 sorties de 30 min sur un pneu parfaitement stable donnait environ 1 % de fausses alertes « FUITE LENTE » quand le boîtier concluait après 5 min d'historique. La durée minimale a été portée à 10 min : la même simulation ne donne plus aucune fausse alerte (0 sur 2 000), au prix d'une détection plus tardive (environ 10 min pour une fuite de 0,3 bar/h). Le bruit réel des capteurs reste à mesurer.
- **Température** : la pression d'un pneu varie avec sa température (un pneu chauffé au soleil puis refroidi perd de la pression sans fuir). La semaine simulée a montré que ce refroidissement déclenchait une fausse alerte « FUITE LENTE ». Corrigé : l'historique du boîtier stocke la pression ramenée à 20 °C (`TPMS.pressionCompenseeBar`, `logique/fuite.js`). La correction reste partielle, car le capteur mesure la température dans le bouchon de valve, qui suit imparfaitement celle de l'air du pneu.
- **Circonférence et seuils** : la circonférence par défaut du boîtier (2 105 mm, pneu de route 700×25C) donnait une vitesse fausse d'environ 4 % sur la roue simulée, et les seuils fixes (AV 1,8 à 3,2 bar) ne convenaient pas à un vélo de route gonflé plus fort. Dans le simulateur, à la création d'une simulation, la circonférence est maintenant réglée sur la circonférence réelle de la roue avant, et les seuils d'alerte à 80 % et 125 % des pressions choisies (`simulateur/moteur.js`). On peut ensuite dérégler la circonférence dans la page Configuration pour voir l'erreur produite. Sur le vrai vélo, la circonférence pourra être mesurée (un tour de roue au sol) puis réglée depuis l'application (EF-14).
- **Vélo garé** : dans la simulation, un vélo garé en pente dévalait la pente et réveillait le boîtier. Corrigé : un vélo garé est tenu sur sa béquille.
- **Montée lente** : dans la montée de la Croix-Rousse (trajet domicile-travail, 3,5 à 4,3 km/h), le capteur ne sentait plus la rotation et n'annonçait plus qu'une fois par minute, alors que le boîtier gardait le délai de perte de 60 s : 8 fausses alertes « capteur perdu » en 60 h simulées. Corrigé : délai de 60 s seulement au-dessus de 10 km/h, 10 min en dessous (`analyse-de-risques.md`, § 6.7). Contrepartie : un vrai capteur perdu à moins de 10 km/h est signalé en 10 min.
- **Alerte rallumée en boucle** : la simulation de la flotte (vélos garés la nuit) a montré qu'une pression qui oscille autour du seuil bas, à cause du refroidissement nocturne et du bruit du capteur, rallumait l'alerte « pression basse » (bip et LED) à chaque passage du seuil. Corrigé : hystérésis de 0,05 bar (EF-05 ; `analyse-de-risques.md`, § 6.8).
- **Crevaison prise pour une intrusion** : pendant une vraie crevaison, le capteur annonce environ une fois par seconde ; le contrôle du rythme prenait cette rafale pour un second émetteur (« SIGNAL SUSPECT » au lieu de « CREVAISON » pendant 60 s, 1 cas sur 6). Corrigé : deux trames rapprochées ne sont une anomalie que si la pression ne baisse pas (`analyse-de-risques.md`, § 6.6).
- **Vie privée** : la simulation d'un réseau de récepteurs espions montre que les capteurs du commerce permettent de relier 10 trajets sur 5 jours et de retrouver l'heure de départ et le quartier de départ du matin. Aucune parade n'est possible avec ces capteurs ; c'est un risque élevé assumé, à signaler dans la notice (ENF-21 pour la proposition v2).
