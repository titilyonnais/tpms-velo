# Analyse de risques – Cybersécurité du kit TPMS vélo

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».

## 0. Méthode

L'analyse suit une version **simplifiée** de la méthode **EBIOS Risk Manager** de l'ANSSI. Les cinq ateliers de la méthode sont ramenés à cinq étapes adaptées à un objet connecté de petite taille :

1. **Cadrage** : périmètre, biens essentiels (ce qu'on veut protéger) et biens supports (ce qui les porte).
2. **Sources de risque** : qui pourrait attaquer, pourquoi, avec quel matériel.
3. **Scénarios** : comment l'attaque se déroule concrètement.
4. **Évaluation** : gravité × vraisemblance, avant puis après les mesures.
5. **Traitement** : mesures mises en place et **risques résiduels assumés**.

Chaque mesure citée renvoie au fichier du dépôt qui l'implémente, et au test automatique qui la vérifie (`node simulateur/tests/tout.js` lance les 6 suites ; la plupart des tests cités sont dans `simulateur/tests/tests.js`, ceux de bout en bout dans `simulateur/tests/moteur.tests.js`).

Point de départ : les études publiques sur les TPMS automobiles, en particulier **Rouf et al., « Security and Privacy Vulnerabilities of In-Car Wireless Networks: A Tire Pressure Monitoring System Case Study », USENIX Security 2010**, ont montré que les messages des capteurs de pression n'étaient ni chiffrés ni authentifiés, que leur identifiant fixe permettait de suivre un véhicule, et que de faux messages pouvaient déclencher le voyant d'alerte du tableau de bord. Les capteurs TPMS BLE du commerce utilisés ici présentent le même défaut de conception : ils diffusent leurs mesures en clair, sans signature ni compteur.

---

## 1. Cadrage

### 1.1 Périmètre

- Les deux capteurs TPMS BLE (bouchons de valve).
- Le boîtier de guidon (XIAO nRF52840, e-paper, buzzer, LED).
- La liaison radio capteurs → boîtier (annonces BLE).
- La liaison radio boîtier ↔ application (connexion BLE GATT).
- L'application web (Chrome ou Bluefy) et les données qu'elle conserve.

### 1.2 Biens essentiels

| Bien essentiel | Description | Besoin de sécurité principal |
|---|---|---|
| Pression affichée | Pression AV/AR montrée sur l'e-paper et dans l'app | **Intégrité** : la valeur doit être vraie ou signalée comme douteuse |
| Alertes | Crevaison, pression basse/haute, fuite lente, capteur perdu, signal suspect (bip + LED) | **Intégrité et disponibilité** : pas de fausse alerte, pas d'alerte masquée |
| Réglages | Seuils, circonférence, délai de veille, protections actives, adresses des capteurs appairés | **Intégrité** : seul le propriétaire peut les modifier |
| Données d'historique | Pressions dans le temps, distances, horaires d'utilisation (dans l'app) | **Confidentialité** (vie privée) |

### 1.3 Biens supports

| Bien support | Faiblesse connue |
|---|---|
| Capteurs TPMS du commerce | Émettent en clair, identifiant fixe, aucune authentification ; programme non modifiable |
| Boîtier (firmware, mémoire flash) | Stocke les réglages et les clés d'appairage |
| Liaison capteurs → boîtier | Annonces BLE : n'importe qui peut les lire et en émettre |
| Liaison boîtier ↔ application | Maîtrisée par nous : appairage et chiffrement possibles |
| Téléphone et navigateur | Hors de notre contrôle (système de l'utilisateur) |

---

## 2. Sources de risque

| Source | Motivation | Compétences | Matériel |
|---|---|---|---|
| Curieux, bidouilleur | Défi technique, jeu | Moyennes (tutoriels publics) | Smartphone avec une application de scan BLE ; carte ESP32 à environ 5 € programmée avec l'environnement Arduino |
| Personne malveillante ciblant un cycliste | Faire s'arrêter le cycliste (fausse crevaison), lui faire croire que tout va bien, ou savoir quand le vélo est présent | Moyennes | Même matériel ; l'ESP32 sait à la fois écouter les annonces BLE et en émettre avec un contenu choisi |
| Voleur de vélo | Repérer un vélo équipé et savoir s'il est dans un local | Faibles à moyennes | Scanner BLE posé à proximité |
| Source non malveillante | Aucune | – | Vélo voisin équipé des mêmes capteurs, perturbations de la bande 2,4 GHz (Wi-Fi…) |

Hypothèse réaliste retenue : l'attaquant dispose d'une carte ESP32 ou nRF52 à quelques euros, à moins d'une dizaine de mètres du vélo. C'est exactement ce que simule `simulateur/sources/pirate.js`.

---

## 3. Scénarios

### S1 – Écoute passive et traçage

Les capteurs diffusent en clair la pression, la température, le niveau de pile et leur **adresse fixe** (octets 3 à 7 de la trame, voir `protocole-ble.md`). Une simple application de scan BLE suffit à les lire. Ces mesures ne sont pas sensibles en elles-mêmes, mais l'adresse fixe permet de **reconnaître un vélo** : un scanner placé dans un local à vélos ou sur un trajet peut savoir quand ce vélo passe ou est présent.

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

Le pirate tente de se connecter au boîtier pour **modifier les réglages** (désactiver les protections, remplacer les adresses des capteurs appairés par celles de ses propres émetteurs), ou de s'intercaler entre le téléphone et le boîtier pendant l'appairage (homme du milieu) pour lire ou modifier les échanges.

### S8 – Recherche du code d'appairage par essais successifs (brute-force)

Le pirate essaie des codes à 6 chiffres jusqu'à tomber sur le bon.

### S9 – Écriture de réglages absurdes

Une application défectueuse ou malveillante, même appairée, écrit des réglages incohérents : circonférence nulle (vitesse fausse), seuil bas supérieur au seuil haut (alerte permanente ou jamais), délai de veille très court ou très long.

### S10 – Vol des données de l'application

Lecture des mesures transmises par le boîtier, ou des données d'historique conservées par l'application (pressions, distances, horaires de sortie, qui renseignent sur les habitudes du cycliste).

### S11 – Déni de service par fausse intrusion

Conséquence de nos propres protections : le pirate émet volontairement des trames rapprochées avec l'adresse d'un capteur, pour maintenir le boîtier en « SIGNAL SUSPECT ». Il n'obtient pas de fausse valeur, mais prive le cycliste de l'information.

---

## 4. Évaluation

### 4.1 Échelles

Échelles à 4 niveaux, inspirées d'EBIOS Risk Manager.

| Gravité | Signification pour ce produit |
|---|---|
| 1 – Mineure | Gêne sans conséquence, ou information peu sensible exposée |
| 2 – Significative | Information fausse ou absente, mais **signalée** à l'utilisateur ; ou atteinte limitée à la vie privée |
| 3 – Grave | Information fausse **non signalée** (fausse crevaison ou crevaison masquée), ou réglages modifiés par un tiers |
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

| Scénario | Événement redouté | Avant (G × V) | Mesures | Après (G × V) |
|---|---|---|---|---|
| S1 Écoute et traçage | Le vélo est reconnu et suivi | 2 × 3 = **6 moyen** | Aucune possible côté capteurs (voir § 6) | 2 × 3 = **6 moyen** (résiduel assumé) |
| S2 Vélo voisin | Pression d'un autre vélo affichée | 2 × 3 = **6 moyen** | Liste blanche | 2 × 1 = **2 faible** |
| S3 Usurpation | Fausse pression acceptée sans alerte | 3 × 3 = **9 élevé** | Vraisemblance avec confirmation, rythme et quarantaine | 3 × 1 = **3 faible** |
| S4 Rejeu | Ancienne pression acceptée sans alerte | 3 × 3 = **9 élevé** | Rythme et quarantaine ; vraisemblance si la valeur rejouée diffère beaucoup | 3 × 1 = **3 faible** |
| S5 Brouillage | Plus aucune mesure | 2 × 2 = **4 moyen** | État « CAPTEUR PERDU » après 60 s sans trame en roulant (600 s à l'arrêt), avec bip et LED | 1 × 2 = **2 faible** |
| S6 Brouillage + imitation du rythme | Fausse pression acceptée sans alerte | 3 × 1 = **3 faible** | Seule la vraisemblance limite les variations brusques | 3 × 1 = **3 faible** (résiduel assumé) |
| S7 Appairage malveillant, homme du milieu | Un tiers modifie les réglages | 3 × 2 = **6 moyen** | BLE Secure Connections, code affiché sur l'e-paper ; réglages refusés sans appairage | 3 × 1 = **3 faible** |
| S8 Brute-force du code | Un tiers s'appaire | 3 × 2 = **6 moyen** | Code aléatoire valable 60 s ; blocage 60 s après 3 codes faux | 3 × 1 = **3 faible** |
| S9 Réglages absurdes | Boîtier inutilisable ou alertes faussées | 2 × 2 = **4 moyen** | Vérification des réglages par le boîtier | 2 × 1 = **2 faible** |
| S10 Vol des données | Habitudes du cycliste exposées | 1 × 2 = **2 faible** | Liaison chiffrée ; données locales, sans serveur ni compte | 1 × 1 = **1 faible** |
| S11 Fausse intrusion | Information indisponible, mais signalée | – (créé par la mesure S3) | Aucune : c'est le prix de la détection | 2 × 3 = **6 moyen** (résiduel assumé) |

Pour S3 et S4, la vraisemblance « après » porte sur une attaque **réussie sans être signalée** : la tentative reste facile, mais elle déclenche l'état « SIGNAL SUSPECT » (voir § 5.2, et le § 6.4 pour une fausse valeur proche de la vraie, affichée quelques secondes avant la détection).

---

## 5. Traitement : mesures mises en place

### 5.1 Tableau des mesures

| Mesure | Contre | Implémentation | Paramètres | Tests |
|---|---|---|---|---|
| **Liste blanche** des capteurs appairés | S2, S3 (en partie) | `TPMS.positionCapteur` (`logique/securite.js`) ; sans elle, `TPMS.positionParNumero` n'utilise que le numéro | Adresses AV et AR mémorisées dans les réglages | « capteur inconnu ignoré », « sans liste blanche : le capteur n°1 devient l'avant » |
| **Vraisemblance** avec confirmation par 3 trames | S3, S4 | `TPMS.verifierVraisemblance` (`logique/securite.js`) | Rejet si > 8 bar ou température hors −40/+85 °C ; variation max 0,3 bar/s et 1 °C/s, l'écart étant divisé par le temps écoulé plafonné à 5 s (`VARIATION_DT_MAX_S`) ; au-delà, 3 trames concordantes à 0,1 bar près (`CONFIRMATIONS` = 3) ; aucune confirmation tant que le rythme est douteux (`TPMS.rythmeDouteux`) | 7 tests « vraisemblance », « regonflage réel : suspect puis accepté », « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » |
| **Contrôle du rythme** et **quarantaine** « SIGNAL SUSPECT » | S3, S4 | `TPMS.controlerRythme` (`logique/securite.js`), appliqué dans `TPMS.boitierRecevoirTrame` (`simulateur/boitier/boitier.js`) | Anomalie si deux trames d'une même adresse à moins de 2 s ; 3 anomalies en 60 s = intrusion ; quarantaine 60 s pendant laquelle toutes les trames de cette adresse sont refusées | 2 tests « rythme », 3 tests « pirate + toutes protections » |
| **Écoute renforcée** | S3, S4 ; détection rapide d'une vraie crevaison | `TPMS.boitierEcouteRenforcee` (`simulateur/boitier/boitier.js`), appelée quand une trame est « suspecte » ou qu'une intrusion est détectée | Radio allumée en continu pendant 15 s (`TPMS.ECOUTE_RENFORCEE_MS`) : les trames de confirmation ne tombent plus hors de la fenêtre d'écoute (voir § 6.5) | « rejeu pour masquer une vraie crevaison : alerte en moins de 10 s », « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » |
| **Capteur perdu** | S5 | `TPMS.evaluerRoue` (`logique/alertes.js`) | 60 s sans trame en roulant (`delaiPerteMs`), 600 s à l'arrêt (`delaiPerteArretMs`), car un capteur à l'arrêt n'annonce plus qu'une fois par minute. Le silence est compté depuis le plus récent de ces instants : dernière trame acceptée, réveil du boîtier, fin de la quarantaine « SIGNAL SUSPECT » (pendant la quarantaine, même le vrai capteur est refusé) | « capteur perdu », « pas perdu juste après un réveil », « arrêt : aucune fausse alerte « capteur perdu » », « fin d'attaque : pas de fausse alerte « capteur perdu » » |
| **BLE Secure Connections**, code à 6 chiffres affiché sur l'e-paper | S7 | Firmware : pile BLE du nRF52840. Simulé par `TPMS.liaisonConnexion` et `TPMS.liaisonSaisirCode` (`simulateur/boitier/liaison.js`), affichage par `TPMS.dessinerCodeAppairage` (`ecran.js`) | Code tiré au hasard, affiché 60 s ; un code encore valide n'est pas remplacé par une nouvelle demande (sinon n'importe qui à portée pourrait changer le code sous les yeux du cycliste et l'empêcher de s'appairer) | « premier contact → code requis », « code affiché à l'écran », « bon code », « mauvais code » |
| **Réglages et commandes réservés** au téléphone appairé | S7 | `TPMS.liaisonEcrireReglages`, `TPMS.liaisonLireReglages`, `TPMS.liaisonCommande` | Refus si le lien n'est pas appairé | « réglages refusés sans appairage » |
| **Blocage après 3 codes faux** | S8 | `TPMS.liaisonSaisirCode` | `CODE_ESSAIS_MAX` = 3, `CODE_BLOCAGE_MS` = 60 s | « 3 codes faux → bloqué », « toujours bloqué 30 s après » |
| **Vérification des réglages** par le boîtier | S9 | `TPMS.verifierReglages` (`logique/protocole.js`), appelée par `TPMS.liaisonEcrireReglages` | Circonférence 1 000 à 3 000 mm ; seuils 0,5 à 6 bar, bas < haut ; veille 10 s à 1 h | « seuil bas > seuil haut refusé » |
| **MESURES chiffrée et appairée** | S10 | En-tête de `logique/protocole.js` ; dans le simulateur, `TPMS.liaisonMesures` n'envoie rien à un téléphone non connecté | Vitesse, distance et horaires de sortie renseignent sur les habitudes du cycliste | « mesures disponibles » (après appairage) |
| **Numéro de séquence** des notifications MESURES | Fiabilité de S10 | `TPMS.encoderMesures` (octets 18-19), incrémenté par `TPMS.liaisonMesures` | 16 bits, repart à 0 après 65 535 | « MESURES : séquence » |
| **Données locales** | S10 | `app/app.js` : historique conservé dans le stockage local du navigateur (`localStorage`), export CSV à la demande de l'utilisateur | Pas de compte, pas de serveur | – |
| **Contrôle des réglages avant envoi** | S9 | `app/app.js` appelle aussi `TPMS.verifierReglages` avant d'écrire ; le boîtier refait le contrôle de son côté | Mêmes plages | – |

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

Le test « Scénario complet » de `simulateur/tests/tests.js` rejoue la même attaque avec plusieurs combinaisons de protections. Le vrai capteur annonce 2,2 bar toutes les 3 s ; le pirate annonce 0,3 bar avec la même identité toutes les secondes, pendant 30 s, radio du boîtier en écoute continue. Un test supplémentaire rejoue l'attaque avec l'écoute par fenêtres réelle du boîtier (voir § 6.4).

| Protections actives | Résultat | Test |
|---|---|---|
| Liste blanche seule | Fausses trames acceptées : le pirate a recopié l'adresse, la liste blanche ne le distingue pas | « pirate sans protection : fausses trames acceptées » |
| Liste blanche + vraisemblance | Le pirate finit par passer : il émet 3 fois entre deux vraies trames, ce qui suffit à « confirmer » sa fausse valeur | « pirate + vraisemblance seule : le pirate rapide finit par passer » |
| Les trois protections | État « SIGNAL SUSPECT », aucune fausse pression acceptée, la dernière valeur de confiance (2,2 bar) est conservée | « pirate + toutes protections : SIGNAL SUSPECT », « … fausse pression jamais acceptée », « … dernière valeur de confiance gardée » |
| Les trois protections, écoute par fenêtres par défaut (3 s toutes les 5 s, position variable, écoute renforcée), 30 décalages du pirate | Aucune fausse pression acceptée, quel que soit le décalage | « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier » |
| Les trois protections, vrai regonflage (1,2 → 2,2 bar) | Accepté après un court délai : la protection ne bloque pas un usage normal | « regonflage réel : suspect puis accepté » |

Le réglage `CONFIRMATIONS` = 3 n'est pas arbitraire : la protection « rythme » demande 3 anomalies pour conclure à une intrusion. Avec 3 confirmations exigées, le rythme détecte le pirate **avant** que ses fausses valeurs ne soient confirmées. En contrepartie, un vrai changement brutal (regonflage) est affiché avec environ 10 s de retard.

---

## 6. Risques résiduels assumés

Ces risques sont connus, expliqués et acceptés. Ils découlent principalement du choix de capteurs du commerce, imposé par le budget et le calendrier.

### 6.1 Aucun anti-rejeu cryptographique possible sur les capteurs

Un véritable anti-rejeu suppose que chaque trame contienne un **compteur** et une **signature** (code d'authentification calculé avec une clé secrète). Les trames des capteurs TPMS du commerce n'ont ni l'un ni l'autre, et leur programme n'est pas modifiable. Le boîtier ne pourra donc jamais prouver l'origine d'une trame : les protections mises en place détectent des **comportements anormaux** (deux émetteurs, variations impossibles), pas des trames falsifiées en tant que telles. L'anti-rejeu cryptographique est en revanche appliqué sur la liaison boîtier ↔ application, que nous maîtrisons.

### 6.2 Un pirate qui brouille le vrai capteur et imite son rythme n'est pas détecté (S6)

Si le boîtier ne reçoit plus que les trames du pirate, au rythme normal, la protection « rythme » ne voit qu'un seul émetteur. La vraisemblance n'arrête que les variations de plus de 0,3 bar/s : une pression qui descend ou monte lentement est acceptée. Cette attaque demande cependant de brouiller de façon ciblée et de se synchroniser, ce qui la rend peu vraisemblable.

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

**7. Un compromis entre sécurité et sûreté.** Plafonner le temps de division à 3 s au lieu de 5 s supprime presque tous ces cas (0 / 75 jusqu'à 1,0 bar), mais retarde l'alerte d'une **vraie** crevaison : 32 à 36 s au lieu de 11 s au pire. Le plafond est donc laissé à 5 s : prévenir vite d'une vraie crevaison passe avant quelques secondes d'affichage faux, toujours suivies d'une alerte. Le cas le plus dangereux reste couvert : **masquer** une vraie crevaison en rejouant 2,2 bar échoue toujours, et le cycliste était prévenu en 7 s au pire avec la fenêtre fixe de 2 s ; avec la fenêtre actuelle et l'écoute renforcée, en 4 s au pire (test « rejeu pour masquer une vraie crevaison », § 6.5).

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
- rejeu de 2,2 bar pour masquer une vraie crevaison : le cycliste est prévenu dans tous les cas (0 cas sans alerte sur 120), **4 s au pire**, contre 13 s avant la correction (test « rejeu pour masquer une vraie crevaison : alerte en moins de 10 s ») ;
- pirate qui usurpe l'adresse (une trame par seconde, 300 décalages) : **aucune fausse valeur acceptée** (test « pirate + écoute par fenêtres : aucun décalage ne trompe le boîtier », 30 décalages, avec l'écoute par défaut) ;
- la semaine simulée ne donne plus aucune minute en alerte (test « semaine : aucune minute en alerte » de `simulateur/tests/moteur.tests.js`).

**5. Ce qui reste.**
- La fenêtre de 3 s coûte de l'énergie : 7,063 mAh/jour au lieu de 5,896, soit une autonomie modélisée de 63,7 jours au lieu de 76,3 (`bilan-energetique.md`, § 3.4). L'objectif d'une semaine reste largement tenu.
- Le pire délai (9 s) reste supérieur à celui de l'écoute permanente (6 s) : c'est le prix de l'économie d'énergie.
- Un pirate peut déclencher volontairement l'écoute renforcée en continu. Cela ne fonctionne que pendant que le boîtier est éveillé (en veille, la radio est coupée) et ajoute au plus 40 % × 5 mA = 2 mA : l'effet sur l'autonomie reste faible. L'attaque est par ailleurs signalée (« SIGNAL SUSPECT »).

### 6.6 Traçage par l'adresse fixe (S1)

L'adresse des capteurs est fixe et transmise en clair dans chaque trame. Rien dans le boîtier ne peut l'empêcher. La seule parade serait de retirer les capteurs, ou d'utiliser des capteurs qui changent régulièrement d'identifiant ; nous n'en avons pas identifié dans la gamme de prix visée. Ce risque devra être signalé à l'utilisateur dans la notice du produit.

### 6.7 Déni de service par fausse intrusion (S11) et brouillage (S5)

Un pirate peut maintenir le boîtier en « SIGNAL SUSPECT » ou le priver de mesures par brouillage. Ce risque est accepté : l'information est perdue mais le cycliste **le sait** (alerte affichée), ce qui est préférable à une fausse valeur présentée comme vraie.

### 6.8 Un téléphone appairé peut désactiver les protections

L'octet 12 de la caractéristique REGLAGES permet d'activer ou de désactiver chaque protection, pour la démonstration devant le jury. `TPMS.verifierReglages` ne contrôle ni ce champ ni les adresses des capteurs : c'est un choix assumé, le propriétaire appairé reste maître de ses réglages. En contrepartie, un téléphone appairé, volé et déverrouillé, pourrait affaiblir le boîtier. Dans un produit commercial, on pourrait imposer les protections, ou demander une confirmation par appui sur un bouton du boîtier pour ce type de changement.

### 6.9 Hors périmètre

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

---

## 8. Références

- ANSSI, *EBIOS Risk Manager – Le guide*, méthode d'analyse de risques (utilisée ici en version simplifiée).
- I. Rouf et al., « Security and Privacy Vulnerabilities of In-Car Wireless Networks: A Tire Pressure Monitoring System Case Study », *19th USENIX Security Symposium*, 2010.
- Bluetooth SIG, *Bluetooth Core Specification*, partie Security Manager (appairage LE Secure Connections).
- Format de trame supposé des capteurs : github.com/schlumpf2009/TPMS.
