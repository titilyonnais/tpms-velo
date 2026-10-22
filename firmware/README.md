# Firmware du boîtier de guidon

Programme Arduino du **Seeed XIAO nRF52840**, la carte du boîtier de guidon.

Il est écrit **avant** l'arrivée du matériel. Il n'a donc jamais été compilé avec le vrai cœur Arduino de la carte. Tout ce qui reste incertain est marqué `// À VÉRIFIER :` dans le code et repris dans la liste à la fin de ce document.

## Organisation

Le firmware est organisé comme le simulateur : la **logique** est séparée du **matériel**.

```
firmware/
  README.md            ce document
  platformio.ini       facultatif : compilation avec PlatformIO
  tpms_boitier/
    tpms_boitier.ino   setup() et loop() : relient la logique au matériel
    config.h           broches et constantes matérielles
    src/logique/       traduction fidèle en C++ de la logique JS (aucun appel Arduino)
    src/materiel/      radio BLE, écran, reed, boutons, sorties, batterie, veille, flash
```

Les dossiers sont dans `src/` pour une raison pratique : l'Arduino IDE ne compile que les fichiers posés à côté du `.ino` et ceux du sous-dossier `src/`. Un dossier `logique/` placé directement à côté du `.ino` serait ignoré.

### Correspondance avec les fichiers JavaScript

Chaque fichier de `src/logique/` indique en tête le fichier JS dont il est la traduction. Les noms de fonctions et de constantes sont les mêmes.

| C++ (`src/logique/`)             | JavaScript                                   |
|----------------------------------|----------------------------------------------|
| `trame`                          | `logique/trame.js`                           |
| `vitesse`                        | `logique/vitesse.js`                         |
| `fuite`                          | `logique/fuite.js`                           |
| `alertes`                        | `logique/alertes.js`                         |
| `securite`                       | `logique/securite.js`                        |
| `protocole`                      | `logique/protocole.js` (sans `decoderMesures`, qui ne sert qu'à l'application) |
| `police5x7`, `epaper`, `ecran`   | `simulateur/boitier/police5x7.js`, `epaper.js`, `ecran.js` |
| `liaison`                        | `simulateur/boitier/liaison.js`              |
| `boitier`, `vue`                 | `simulateur/boitier/boitier.js`              |
| `outils`                         | `Math.round` et `toFixed` du JavaScript      |
| `tests_logique`                  | une partie de `simulateur/tests/tests.js`    |

`logique/energie.js` n'est pas traduit, parce que le bilan énergétique sert au dossier et pas au boîtier.

La table de la police a été recopiée automatiquement depuis `police5x7.js`. L'écran réel est donc identique à celui du simulateur, au pixel près.

## Compiler avec l'Arduino IDE (méthode conseillée)

1. Arduino IDE 2 → *Fichier → Préférences → URL de gestionnaire de cartes supplémentaires* : ajouter
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
2. *Outils → Carte → Gestionnaire de cartes* : installer **« Seeed nRF52 Boards »**.
   Il ne faut **pas** installer « Seeed nRF52 mbed-enabled Boards » : cette version n'a pas la bibliothèque Bluefruit.
3. *Outils → Carte* : choisir **« Seeed XIAO nRF52840 »**.
4. *Gestionnaire de bibliothèques* : installer **GxEPD2** (Jean-Marc Zingg). Accepter l'installation d'Adafruit GFX, qu'elle utilise.
   Bluefruit et InternalFileSystem sont fournies avec la carte.
5. Ouvrir `tpms_boitier/tpms_boitier.ino`, téléverser, puis ouvrir le moniteur série à **115200 bauds**.

Avec PlatformIO, voir `platformio.ini`. La plateforme qu'il utilise est communautaire, donc à vérifier.

## Câblage

Le XIAO n'a que 11 broches (D0 à D10), et il en faut 13. Les deux **plots NFC** sous la carte (P0.09 et P0.10) servent donc de sorties ordinaires. Les deux LED d'éclairage partagent une même broche : elles s'allument toujours ensemble.

| Broche XIAO | GPIO nRF | Raccordement |
|-------------|----------|--------------|
| D0          | P0.02    | e-paper BUSY |
| D1          | P0.03    | e-paper RST |
| D2          | P0.28    | e-paper DC |
| D3          | P0.29    | e-paper CS |
| D4          | P0.04    | reed → GND (pull-up interne) |
| D5          | P0.05    | bouton 1 → GND (pull-up interne) |
| D6          | P1.11    | bouton 2 → GND (pull-up interne) |
| D7          | P1.12    | 270 Ω → LED rouge d'alerte → GND |
| D8          | P1.13    | e-paper CLK (SPI SCK) |
| D9          | P1.14    | non câblée (MISO, réservée par le bus SPI) |
| D10         | P1.15    | e-paper DIN (SPI MOSI) |
| plot NFC1   | P0.09    | 100 Ω → grille du MOSFET du buzzer |
| plot NFC2   | P0.10    | 100 Ω → grille du MOSFET de l'éclairage |
| 3V3 / GND   |          | alimentation de l'e-paper, du buzzer |
| BAT+ / BAT− |          | LiPo 500 mAh (plots au dos du XIAO) |

```
 Buzzer actif 3 V (≈ 25 mA)              Éclairage : 2 LED blanches (5 mA chacune)
 3V3 ──┬──────────┐                       BAT+ ──150 Ω──▶|──┐
       │        1N4148 (cathode vers 3V3) BAT+ ──150 Ω──▶|──┤
     [BUZ]        │                                          │
       └────┬─────┘                                          D
            D   MOSFET N (AO3400 ou 2N7002)   P0.10 ─100 Ω─ G   MOSFET N
 P0.09 ─100 Ω─ G                                    100 kΩ │  S
          100 kΩ│ S                                        GND
               GND
```

**Composants à ajouter** à la commande : 2 MOSFET canal N de niveau logique (AO3400 en CMS ou 2N7002), 1 diode 1N4148, des résistances de 100 Ω, 100 kΩ, 150 Ω et 270 Ω. En option, une résistance de 1 MΩ et un condensateur de 10 nF pour le reed (voir plus bas).

Justification des valeurs :
- **LED d'alerte** : (3,3 V − 2,0 V) / 270 Ω ≈ 5 mA. Une broche normale du nRF52840 ne fournit qu'environ 2 mA. La broche D7 est donc réglée en sortie « forte » (*high drive*, jusqu'à environ 10 mA).
- **Buzzer** : environ 25 mA, ce qui est trop pour une broche. Un MOSFET commande le courant. La résistance de 100 kΩ maintient le MOSFET bloqué au démarrage et en veille. La diode protège le transistor de la surtension que crée la bobine du buzzer à la coupure.
- **LED blanches** : leur tension de seuil est d'environ 3 V, ce qui laisse trop peu de marge sur 3,3 V. On les alimente donc par la batterie (3,7 à 4,2 V) : (3,7 − 3,0) / 150 Ω ≈ 5 mA.
- **Plots NFC** : le programme les transforme en broches ordinaires au premier démarrage, en écrivant le registre `UICR.NFCPINS` (la carte redémarre alors une fois). Quand ces deux broches sont à des niveaux différents, un petit courant de fuite circule entre elles. On y a donc mis deux sorties qui sont **à 0 au repos**, buzzer et éclairage, pour qu'il n'y ait aucune fuite la plupart du temps.

### Le reed et l'aimant arrêté devant

Le reed relie D4 à GND quand l'aimant passe. Si le vélo s'arrête **avec l'aimant pile devant le reed**, le reed reste fermé. Il circule alors 3,3 V / 13 kΩ = **0,25 mA** en permanence dans le pull-up interne (`reedColleMa` dans `energie.js`). C'est 12 fois la consommation du boîtier éveillé, et 50 fois celle de la veille.

- **Parade logicielle (choix par défaut)** : si le reed reste fermé plus de 3 s, la broche est débranchée (plus de pull-up, plus d'interruption). Une fois par seconde, le pull-up est rebranché pendant 50 µs pour voir si le reed s'est rouvert. En veille, si l'aimant est devant le reed, la roue ne peut plus réveiller le boîtier : c'est un bouton qui le fera. Ce cas est rare, car la zone sensible du reed fait environ 1 % du tour de roue.
- **Parade matérielle (option)** : on met un pull-up **externe de 1 MΩ** avec 10 nF vers GND, et `REED_PULLUP_INTERNE = false` dans `config.h`. Avec l'aimant arrêté devant le reed, il ne circule plus que 3,3 µA, et le boîtier se réveille quand l'aimant s'éloigne.

## Choix techniques (à expliquer au jury)

- **Logique pure et portable.** `src/logique/` n'appelle jamais Arduino. Le temps lui est passé en paramètre (`maintenantMs`), exactement comme dans le simulateur. On peut donc la tester sans matériel. Avec `AUTOTEST 1` dans `config.h`, les tests du simulateur sont **rejoués sur la carte** au démarrage, et le résultat s'affiche sur le moniteur série.
- **Image 1 bit par pixel.** Le simulateur garde un octet par pixel (40 000 octets) pour rester lisible. Le firmware range 8 pixels par octet, comme l'écran : 5 000 octets par image. Le boîtier garde deux images, celle en préparation et celle affichée. Une simple comparaison `memcmp` dit alors s'il faut rafraîchir l'écran.
- **Pas d'allocation dynamique.** En JavaScript, `creerXxx()` crée un nouvel objet. En C++, `creerXxx(&structure)` remplit une structure déjà réservée. Les tableaux qui grandissent en JS (historique, anomalies) deviennent des tableaux de taille fixe accompagnés d'un compteur.
- **Temps en `int32_t`.** On garde ainsi la valeur −1 pour « jamais », comme en JS. La limite est de 24,8 jours sans redémarrage, ce qui n'arrive pas en pratique : le boîtier s'éteint après 5 min immobile, et chaque réveil remet `millis()` à 0.
- **Files d'attente.** L'interruption du reed, le scanner BLE et les rappels de la liaison BLE ne touchent jamais à la logique. Ils rangent l'événement dans une file d'attente, et c'est `loop()` qui le transmet à la logique. Il n'y a donc jamais deux morceaux de programme qui modifient l'état du boîtier en même temps.
- **Tâche de fond pour la LED et le buzzer.** Un rafraîchissement complet de l'e-paper bloque `loop()` jusqu'à 2 s. Une petite tâche FreeRTOS fait clignoter la LED et biper le buzzer, pour que les bips gardent leur durée.
- **Veille = System OFF.** La carte consomme alors environ 5 µA, et seuls le reed et les boutons peuvent la réveiller. Le réveil est un redémarrage : les réglages et le trajet sont sauvegardés en flash (LittleFS) avant l'extinction, puis relus au démarrage.
- **Écoute par fenêtres.** Le scanner BLE est démarré et arrêté selon `boitierEcoute()` : 2 s d'écoute toutes les 5 s. Les copies d'une même annonce reçues à moins de 100 ms d'écart sont ignorées. Sans ce filtre, le contrôle du rythme les prendrait pour un second émetteur.
- **Sécurité de la liaison avec l'application.**
  - L'appairage se fait en LE Secure Connections avec un code à 6 chiffres. Ce code est tiré par la pile BLE et affiché sur l'e-paper.
  - Les trois caractéristiques ont la permission `SECMODE_ENC_WITH_MITM` : la pile refuse tout accès sans lien chiffré et authentifié par le code. Notre logique le revérifie, par défense en profondeur.
  - Après 3 échecs d'appairage, l'appairage est bloqué 1 min.
  - Le boîtier accepte une seule connexion à la fois.
  - Les réglages reçus sont vérifiés avant d'être appliqués. Les réglages relus en flash sont vérifiés de la même façon.
- **Oublier les téléphones appairés** : il faut maintenir les deux boutons enfoncés pendant le démarrage.

### Différences assumées avec le simulateur

| Simulateur | Firmware | Pourquoi |
|------------|----------|----------|
| La veille garde tout en mémoire | Après la veille, les pressions sont en « EN ATTENTE » jusqu'à la 1re trame (5 s au plus). Le trajet et les réglages sont relus en flash | Le System OFF efface la RAM |
| Le code d'appairage est tiré par `Math.random` et n'est pas remplacé tant qu'il est valide | Le code est tiré par la pile BLE, une fois par tentative. Le dernier reçu est toujours affiché | C'est la pile qui fixe le code ; la limite à une connexion empêche un tiers de le changer |
| Un code faux laisse le même code affiché | Un échec efface le code, et la tentative suivante en aura un nouveau | Fonctionnement de BLE |
| Les trames de toute longueur sont comptées « invalides » | Seules les annonces de 18 octets sont transmises à la logique | Il y a des dizaines d'objets BLE autour de nous |
| Le 1er affichage est un rafraîchissement partiel | Le 1er affichage après l'allumage est complet | L'écran a perdu l'image précédente |
| Nombres en `double` | Nombres en `float` | Le nRF52840 calcule les `float` en matériel. Les tolérances des tests embarqués sont un peu plus larges |

## Première mise en service, à la réception du matériel

1. **Carte seule, USB branché.** Téléverser le programme et ouvrir le moniteur série. La carte redémarre une fois (libération des plots NFC). Les tests s'affichent ensuite et doivent finir par « 0 en échec ».
2. **Capteurs TPMS.** Passer `MODE_DECOUVERTE` à 1, puis approcher les capteurs vissés sur une valve. Relever leur adresse, la longueur et le contenu de leurs annonces, et comparer avec le format supposé dans `trame.h`. Corriger `trame.h` et `ID_FABRICANT` si besoin, puis les adresses par défaut dans `boitier.cpp`, ou les régler depuis l'application.
3. **Écran.** Vérifier l'image : sens, couleurs pas inversées, partiels propres. Régler `ECRAN_ROTATION` si besoin.
4. **Reed, boutons, LED, buzzer**, puis la **veille** : attendre 5 min sans rouler, puis réveiller avec la roue et avec un bouton.
5. **Application.** Appairer le téléphone avec le code affiché, puis lire la MTU obtenue sur le moniteur série. Écrire des réglages et vérifier qu'ils survivent à une veille.
6. **Consommation**, à l'oscilloscope avec une résistance de 10 Ω en série : en veille, éveillé radio coupée, en écoute, pendant un rafraîchissement. Reporter les valeurs mesurées dans `energie.js`.
7. Remettre `AUTOTEST` à 0, ainsi que `JOURNAL_TRAMES` si on veut moins de messages.

## Points À VÉRIFIER

**Format des capteurs TPMS (le plus important)**
- Le format des trames reste une hypothèse : 18 octets, identifiant fabricant `00 01`, numéro 0x80/0x81, pression en Pa, température en centièmes de °C (`trame.h`).
- Les adresses des capteurs (`boitier.cpp`) sont pour l'instant celles du simulateur.
- Le rythme d'émission des capteurs est supposé de 3 s (`RYTHME_MIN_MS` = 2000 dans `securite.h`).
- Il faut aussi vérifier la plage de pression maximale des capteurs.

**Bluefruit (noms exacts des fonctions, à confirmer à la première compilation)**
- `Bluefruit.configPrphConn`, `begin(1, 1)` (le scan doit fonctionner avec ce réglage).
- `Security.setIOCaps`, `setMITM`, `setPairPasskeyCallback`, `setPairCompleteCallback`, `setSecuredCallback`.
- `Periph.setConnectCallback`, `setDisconnectCallback`, `setConnInterval`, `clearBonds`.
- `BLEConnection::requestMtuExchange` et `getMtu`.
- `Scanner.resume`, `parseReportByType`.

**Sécurité de la liaison**
- L'appairage obtenu doit être **LESC** et non *Legacy* (à contrôler avec nRF Connect).
- La **MTU** doit être suffisante pour écrire les 23 octets de REGLAGES depuis Chrome Android et depuis Bluefy.
- L'ordre des octets des UUID doit être vérifié dans nRF Connect : le service doit apparaître sous `6e7a0001-…`.

**Écran**
- La classe `GxEPD2_154_D67` doit convenir au module WeAct.
- L'impulsion de reset de 2 ms est à confirmer.
- Il faut voir si les rafraîchissements partiels restent propres après `powerOff()`, et comparer la consommation entre deux images avec `powerOff` et avec `hibernate`.

**Carte XIAO (schéma Seeed)**
- `PIN_VBAT` (P0.31), le pont 1 MΩ / 510 kΩ, `AR_INTERNAL_2_4`, et le temps d'acquisition de l'ADC sur une source de 340 kΩ : calibrer `BATTERIE_CORRECTION` au multimètre.
- La polarité de P0.17 (charge) et de P0.13 (courant de charge).
- `g_ADigitalPinMap` doit être disponible dans le cœur Seeed.
- Les plots NFC doivent être reliés sans condensateur. Il faut aussi confirmer que l'écriture d'`UICR.NFCPINS` fonctionne et ne déclenche pas de redémarrage en boucle.

**Veille**
- Il reste à mesurer le courant réel en System OFF.
- Les registres `RESETREAS` et `LATCH` doivent encore être lisibles au réveil.
- Le réveil doit marcher par le reed, et aussi par le bouton 2 (port P1).

**Divers**
- La priorité de la tâche des sorties.
- L'appel de `millis()` dans l'interruption du reed.
- Le comportement de `FILE_O_WRITE` (on efface le fichier avant d'écrire).

**Postes absents de `energie.js`, à ajouter au bilan**
- Les annonces BLE vers le téléphone : environ 10 à 20 µA.
- Le pont diviseur de la batterie, toujours actif : environ 2,8 µA, y compris en veille.
- Le canal d'interruption GPIOTE du reed quand le boîtier est éveillé : quelques µA, voire plus.
