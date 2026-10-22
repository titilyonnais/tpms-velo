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

---

## 3. Exigences fonctionnelles

Chaque exigence porte un critère de validation mesurable. La colonne « Vérification actuelle » indique ce qui est déjà vérifié dans le simulateur ou par les tests (`node simulateur/tests/tests.js`) ; la vérification sur le matériel réel sera faite à sa réception.

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| EF-01 | Le boîtier reçoit et décode les annonces BLE des deux capteurs de roue. | Une trame de 18 octets est décodée sans erreur (pression, température, pile, alarme, adresse). Sur le matériel : la pression affichée diffère de moins de 0,1 bar de celle d'un manomètre de référence (objectif à valider). | Tests « Trames » (14 tests), `logique/trame.js` |
| EF-02 | L'écran affiche la pression avant et arrière, la température, le niveau de pile de chaque capteur et le niveau de batterie du boîtier. | Toutes ces valeurs sont visibles sur l'écran 200×200 sans changer de page. | Rendu du simulateur, `simulateur/boitier/ecran.js` |
| EF-03 | Le boîtier mesure la vitesse et la distance à partir de l'aimant de rayon et du reed ; la circonférence de roue est réglable. | Un tour de 2 100 mm en 300 ms donne 25,2 km/h ; 10 tops donnent 9 tours. Circonférence acceptée de 1 000 à 3 000 mm. Sur le vélo : écart de distance inférieur à 2 % sur un parcours mesuré (objectif à valider). | Tests « Vitesse et distance », `logique/vitesse.js` |
| EF-04 | Le boîtier affiche les statistiques du trajet (vitesse moyenne, vitesse maximale, durée) et permet de les remettre à zéro. | Bouton 1 appui court : page suivante ; appui long : remise à zéro, la circonférence est conservée. | Test « remise à zéro », `TPMS.boitierBouton` |
| EF-05 | Le boîtier signale une crevaison, une pression basse ou haute, un capteur perdu et un signal suspect. | États évalués du plus grave au moins grave. Crevaison si pression < 0,5 bar ou alarme du capteur ; seuils par défaut AV 1,8 à 3,2 bar, AR 2,0 à 3,4 bar ; capteur perdu après 60 s sans trame. | Tests « Alertes » (9 tests), `logique/alertes.js` |
| EF-06 | Une alerte déclenche un bip et le clignotement de la LED ; la colonne de la roue concernée passe en négatif à l'écran. | Bip à l'apparition de l'alerte ; LED clignotante tant que l'alerte n'est pas acquittée. | Tests « Boîtier complet » |
| EF-07 | L'utilisateur peut acquitter une alerte. | Bouton 2 appui long : plus de bip, LED fixe tant que le problème dure. | Test « alerte acquittée → LED fixe » |
| EF-08 | Le boîtier détecte une fuite lente. | Pente calculée par régression linéaire sur 20 min au plus (1 point toutes les 30 s), après au moins 10 min de données (`TPMS.HISTO_DUREE_MIN_MS`) ; alerte si pente < −0,15 bar/h. Une fuite de −0,3 bar/h est mesurée à ±0,03 bar/h et signalée environ 10 min après le début de l'historique. Un regonflage (+0,2 bar) remet l'historique à zéro. | Tests « Fuite lente », `logique/fuite.js` |
| EF-09 | Le boîtier détecte une crevaison rapidement. | Alerte CREVAISON affichée moins de 10 s après le passage sous 0,5 bar (objectif). | Simulation : 0,6 à 9,6 s selon le moment de l'annonce (30 décalages), avec l'écoute par fenêtres par défaut |
| EF-10 | Le boîtier offre un éclairage de nuit latéral. | Bouton 2 appui court : 2 LED blanches allumées ou éteintes ; l'indication « ECLAIRAGE » apparaît à l'écran. | `TPMS.boitierBouton`, `ecran.js` |
| EF-11 | Le boîtier se met en veille quand le vélo ne roule plus et se réveille seul. | Veille après le délai réglé (10 s à 1 h, 5 min par défaut) sans tour de roue ni appui ; réveil par un tour de roue ou un bouton. | Tests « veille après 5 min », « réveil par la roue » |
| EF-12 | Le boîtier fonctionne sans smartphone. | Toutes les fonctions EF-01 à EF-11 sont disponibles sans application connectée. | Par construction (`boitier.js`) |
| EF-13 | L'application se connecte au boîtier par Web Bluetooth et affiche les mesures en temps réel. | Fonctionne sur Chrome (PC ou Android) et sur Bluefy (iPhone de Thibault) ; une notification de mesures toutes les 5 s. | Format testé (`protocole.js`) ; application en cours dans `app/` (`transport-ble.js`), à essayer sur le matériel |
| EF-14 | L'application permet de régler les seuils, la circonférence, le délai de veille, les protections et les capteurs appairés. | Les réglages écrits sont relus à l'identique ; un réglage hors plage est refusé par le boîtier. | Tests « Protocole » et « Liaison » ; formulaire de réglages dans `app/`, avec contrôle `TPMS.verifierReglages` avant envoi |
| EF-15 | L'application conserve l'historique des pressions et l'affiche sous forme de courbes ; elle détecte les fuites lentes sur plusieurs jours. | Courbe AV/AR consultable ; même calcul de pente que le boîtier (`TPMS.penteMoindresCarresParHeure`, `logique/fuite.js`), exprimé en bar par jour. | En cours dans `app/app.js` (historique local, courbes, tendance, export CSV) |
| EF-16 | Un simulateur (page web) reproduit le fonctionnement du kit avant l'arrivée du matériel. | Les modules capteurs, boîtier, application, cybersécurité et autonomie sont manipulables dans le navigateur. | Les cinq sections figurent dans `simulateur/index.html` ; l'application y est intégrée dans un cadre et dialogue avec le boîtier virtuel |

---

## 4. Exigences non fonctionnelles

### 4.1 Énergie, robustesse, ergonomie

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-01 | Autonomie du boîtier d'au moins une semaine (viser plusieurs semaines). | Journée type (1 h de vélo, 2 sorties, 15 min d'éclairage, 6 min d'application) : autonomie calculée ≥ 7 jours, puis confirmée par mesure. | Modèle : 76 jours (`bilan-energetique.md`) ; test « autonomie supérieure à 1 semaine » |
| ENF-02 | Durée de vie des piles CR1632 des capteurs d'au moins un an. | Durée calculée ≥ 365 jours pour l'intervalle d'annonce réel des capteurs. | Modèle : 524 jours pour une annonce toutes les 3 s (hypothèse) |
| ENF-03 | Écran lisible en plein soleil. | Écran e-paper réflectif ; chiffres de pression de 28 pixels de haut (police 5×7 agrandie 4 fois), soit environ 3,9 mm sur un écran de 27,7 mm de côté. | `ecran.js` |
| ENF-04 | L'écran ne se rafraîchit que si nécessaire. | Au plus un rafraîchissement toutes les 2 s en roulant ; aucun si l'image n'a pas changé ; un rafraîchissement complet toutes les 20 mises à jour partielles. | Test « écran inchangé → pas de rafraîchissement » |
| ENF-05 | Boîtier étanche IPX7. | Immersion temporaire à 1 m pendant 30 min sans entrée d'eau (définition IPX7 de la norme IEC 60529). | À tester sur le boîtier imprimé (joints toriques NBR) |
| ENF-06 | Fixation au guidon démontable sans outil. | Fixation quart de tour ; le boîtier ne bouge pas sur un parcours pavé (objectif à valider). | À tester |
| ENF-07 | Recharge sans ouvrir le boîtier. | Connecteur magnétique 2 broches accessible de l'extérieur. | À tester |

### 4.2 Logiciel

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-08 | La logique est séparée des sources de données et portable en C++. | Les fichiers de `logique/` n'utilisent ni la page web ni l'horloge ; le temps est passé en paramètre. | Revue du code ; architecture décrite dans `architecture.md` |
| ENF-09 | La logique est vérifiée par des tests automatiques. | `node simulateur/tests/tests.js` affiche « 102 réussis, 0 en échec ». | Vérifié |
| ENF-10 | Le code est commenté en français et explicable par l'étudiant. | Chaque fichier commence par un en-tête qui explique son rôle ; chaque constante est justifiée. | Revue du code |
| ENF-11 | Le simulateur et l'application ne demandent aucune installation. | Ouverture par double-clic (simulateur) ; navigateur Chrome ou Bluefy (application). | Aucune bibliothèque JavaScript externe ; seules les polices de caractères sont chargées depuis Google Fonts (sans connexion, le navigateur utilise une police de remplacement) |

### 4.3 Cybersécurité

Le détail est dans `analyse-de-risques.md`.

| N° | Exigence | Critère de validation | Vérification actuelle |
|---|---|---|---|
| ENF-12 | Seuls les deux capteurs appairés sont pris en compte (liste blanche). | Une trame d'adresse inconnue est ignorée, même si elle porte le numéro de capteur 1. | Test « capteur inconnu ignoré », `TPMS.positionCapteur` |
| ENF-13 | Une valeur physiquement impossible est rejetée ; un changement brutal doit être confirmé. | Rejet si pression > 8 bar ou température hors −40 à +85 °C ; variation > 0,3 bar/s (temps de calcul plafonné à 5 s) acceptée seulement après 3 trames concordantes (à 0,1 bar près), et jamais tant que le contrôle du rythme a un doute. | Tests « vraisemblance », `TPMS.verifierVraisemblance` |
| ENF-14 | Un second émetteur utilisant l'adresse d'un capteur appairé est détecté. | 3 trames espacées de moins de 2 s en 1 min → état « SIGNAL SUSPECT » pendant 60 s ; une fausse crevaison n'est jamais acceptée, en écoute continue comme en écoute par fenêtres. | Tests « rythme », scénario pirate et « pirate + écoute par fenêtres », `TPMS.controlerRythme` |
| ENF-15 | La liaison boîtier ↔ application est appairée et chiffrée. | Appairage BLE Secure Connections par code à 6 chiffres affiché sur l'e-paper ; réglages et commandes refusés sans appairage. | Tests « Liaison » ; à valider sur le matériel |
| ENF-16 | Le code d'appairage ne peut pas être trouvé par essais successifs. | Code tiré au hasard, valable 60 s, non remplacé tant qu'il est valide ; après 3 codes faux, appairage bloqué 60 s. | Test « 3 codes faux → bloqué » |
| ENF-17 | Le boîtier vérifie les réglages qu'il reçoit, même d'un téléphone appairé. | Circonférence 1 000 à 3 000 mm, seuils 0,5 à 6 bar avec seuil bas < seuil haut, délai de veille 10 s à 1 h ; sinon refus motivé. | Test « seuil bas > seuil haut refusé », `TPMS.verifierReglages` |
| ENF-18 | Les données de l'utilisateur restent sur ses appareils. | Pas de compte, pas de serveur : l'historique reste dans le navigateur du téléphone. | `app/app.js` : historique dans le stockage local du navigateur |

---

## 5. Contraintes

| Type | Contrainte |
|---|---|
| Organisation | Projet réalisé seul ; date de soutenance, établissement et professeur référent encore à préciser. |
| Budget | Matériel commandé pour 86,61 € TTC (voir § 6). |
| Matériel | Capteurs TPMS du commerce : le format des trames et la sécurité des capteurs ne sont pas modifiables. |
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
| Plage de mesure des capteurs | Souvent annoncée autour de 3,5 bar pour ce type de capteur : convient au VTT et au vélo de ville, pas aux pneus de route. Le code accepte jusqu'à 8 bar (`TPMS.PRESSION_MAX_BAR`) et des seuils jusqu'à 6 bar. | `logique/securite.js`, `logique/protocole.js` | Fiche du vendeur et essai au gonfleur ; ajuster `PRESSION_MAX_BAR` et la plage des seuils |
| Intervalle d'annonce des capteurs | 3 s | `simulateur/monde/capteur.js`, `securite.js` (`RYTHME_MIN_MS` = 2 s) | Mesurer l'écart entre annonces ; vérifier qu'il reste supérieur à 2 s, sinon la protection « rythme » donnerait de fausses alertes |
| Copies d'une même annonce | Une annonce BLE est émise sur 3 canaux en quelques millisecondes | Commentaire de `securite.js` | Le firmware devra ignorer les copies identiques reçues à moins de 100 ms d'écart |
| Consommations du boîtier | Valeurs de fiches techniques | `logique/energie.js` | Protocole de mesure de `bilan-energetique.md` |
| Compatibilité Bluefy | Web Bluetooth, notifications et appairage avec code disponibles sur iPhone | – | Essai sur l'iPhone de Thibault avec le boîtier réel |

### Points de vigilance relevés dans le simulateur

- **Fuite lente et bruit de mesure** : avec un bruit de ±0,01 bar sur chaque mesure, une simulation de 2 000 sorties de 30 min sur un pneu parfaitement stable donnait environ 1 % de fausses alertes « FUITE LENTE » quand le boîtier concluait après 5 min d'historique. La durée minimale a été portée à 10 min : la même simulation ne donne plus aucune fausse alerte (0 sur 2 000), au prix d'une détection plus tardive (environ 10 min pour une fuite de 0,3 bar/h). Le bruit réel des capteurs reste à mesurer.
- **Température** : la pression d'un pneu varie avec sa température (un pneu chauffé au soleil puis refroidi perd de la pression sans fuir). La détection de fuite ne corrige pas cet effet pour l'instant.
- **Circonférence par défaut** : 2 105 mm (pneu de route 700×25C), alors que la plage supposée des capteurs (environ 3,5 bar) vise plutôt le VTT et la ville. À ajuster selon le vélo de test.
