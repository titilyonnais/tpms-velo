# Firmware du boîtier de guidon

Programme Arduino du **Seeed XIAO nRF52840**, la carte du boîtier de guidon.

Il est écrit **avant** l'arrivée du matériel. Il n'a donc jamais été compilé avec le vrai cœur Arduino de la carte. Tout ce qui reste incertain est marqué `// À VÉRIFIER :` dans le code et repris dans la liste à la fin de ce document.

La partie **logique** (`src/logique/`), en revanche, est compilée et testée sur un ordinateur : 109 tests, lancés automatiquement par GitHub Actions à chaque push (voir « Tester la logique sur PC »).

## Organisation

Le firmware est organisé comme le simulateur : la **logique** est séparée du **matériel**.

```
firmware/
  README.md            ce document
  platformio.ini       facultatif : compilation avec PlatformIO
  tests_pc/main.cpp    lance les tests de la logique C++ sur un ordinateur
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
| `trame2`                         | `logique/trame2.js` (capteurs « version 2 » : **proposition**, voir `docs/protocole-ble.md`, § 2.7) |
| `sha256`                         | `logique/sha256.js` (SHA-256 et HMAC-SHA256) |
| `journal`                        | `logique/journal.js` (journal de sécurité chaîné) |
| `vitesse`                        | `logique/vitesse.js`                         |
| `fuite`                          | `logique/fuite.js` (fuite lente et prévision du regonflage) |
| `alertes`                        | `logique/alertes.js`                         |
| `securite`                       | `logique/securite.js`                        |
| `barometre`                      | `logique/barometre.js` (correction d'altitude, recharge par grand froid, attente de l'écran) |
| `boutons`                        | `logique/boutons.js` (deux boutons sur une broche) |
| `protocole`                      | `logique/protocole.js` (sans `decoderMesures`, qui ne sert qu'à l'application) |
| `police5x7`, `epaper`, `ecran`   | `simulateur/boitier/police5x7.js`, `epaper.js`, `ecran.js` |
| `liaison`                        | `simulateur/boitier/liaison.js`              |
| `boitier`, `vue`                 | `simulateur/boitier/boitier.js`              |
| `outils`                         | `Math.round` et `toFixed` du JavaScript      |
| `tests_logique`                  | une partie de `simulateur/tests/tests.js`    |

`logique/energie.js` n'est pas traduit, parce que le bilan énergétique sert au dossier et pas au boîtier. `logique/statistiques.js` et `logique/conseil.js` non plus : ils servent au simulateur et à l'application.

## Tester la logique sur PC (sans la carte)

`src/logique/` n'utilise que du C++ standard. On peut donc la compiler pour un ordinateur et lancer les mêmes tests que ceux que la carte rejoue au démarrage avec `AUTOTEST 1` (`lancerTestsLogique`, dans `tests_logique.cpp`). Sur la carte, c'est le `.ino` qui affiche le résultat sur le moniteur série ; sur PC, c'est `tests_pc/main.cpp`, qui renvoie le code de sortie 1 si un test échoue.

Depuis la racine du dépôt, avec g++ :

```
g++ -std=c++11 -Wall -I firmware/tpms_boitier/src/logique firmware/tests_pc/main.cpp firmware/tpms_boitier/src/logique/*.cpp -o tests_pc -lm
./tests_pc
```

Résultat attendu : `109 reussis, 0 en echec`. C'est la commande lancée par GitHub Actions à chaque push (`.github/workflows/tests.yml`, tâche « Logique C++ du firmware ») ; le badge « Tests » du README de la racine passe au rouge si un test échoue. Avant, la traduction C++ était seulement compilée ; elle est maintenant exécutée sur un vrai processeur.

La table de la police a été recopiée automatiquement depuis `police5x7.js`. L'écran réel est donc identique à celui du simulateur, au pixel près.

## Compiler avec l'Arduino IDE (méthode conseillée)

1. Arduino IDE 2 → *Fichier → Préférences → URL de gestionnaire de cartes supplémentaires* : ajouter
   `https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
2. *Outils → Carte → Gestionnaire de cartes* : installer **« Seeed nRF52 Boards »**.
   Il ne faut **pas** installer « Seeed nRF52 mbed-enabled Boards » : cette version n'a pas la bibliothèque Bluefruit.
3. *Outils → Carte* : choisir **« Seeed XIAO nRF52840 »**.
4. *Gestionnaire de bibliothèques* : installer **GxEPD2** (Jean-Marc Zingg), puis **Adafruit BMP280 Library**. Accepter l'installation d'Adafruit GFX et d'Adafruit Unified Sensor, qu'elles utilisent.
   Bluefruit et InternalFileSystem sont fournies avec la carte.
5. Ouvrir `tpms_boitier/tpms_boitier.ino`, téléverser, puis ouvrir le moniteur série à **115200 bauds**.

Avec PlatformIO, voir `platformio.ini`. La plateforme qu'il utilise est communautaire, donc à vérifier.

## Câblage

Le XIAO n'a que 11 broches (D0 à D10), et il en faudrait 15. Quatre astuces :

- les deux **plots NFC** sous la carte (P0.09 et P0.10) servent de sorties ordinaires, et les deux LED d'éclairage partagent une broche (elles s'allument toujours ensemble) ;
- depuis le 24/10/2026, le **baromètre BMP280** partage le bus SPI de l'écran : sa sortie SDO arrive sur **D9 (MISO)**, réservée mais jusqu'ici inutilisée ;
- le **fil BUSY de l'écran est supprimé** : le programme attend une durée fixe, plus longue par temps froid (`attenteEcranMs`). **D0** sélectionne le baromètre ;
- les **deux boutons partagent D5**, lue en analogique (SW2 passe par une résistance de 2,2 kΩ, `boutons.h`) : **D6** commande la coupure de la recharge par grand froid.

| Broche XIAO | GPIO nRF | Raccordement |
|-------------|----------|--------------|
| D0          | P0.02    | CSB du baromètre BMP280 (l'e-paper BUSY n'est plus câblée) |
| D1          | P0.03    | e-paper RST |
| D2          | P0.28    | e-paper DC |
| D3          | P0.29    | e-paper CS |
| D4          | P0.04    | reed → GND (pull-up interne) |
| D5          | P0.05    | bouton 1 → GND, et bouton 2 → 2,2 kΩ → GND (pull-up interne, lecture analogique AIN3) |
| D6          | P1.11    | grille de Q3 (2N7002, 100 kΩ vers GND) : 1 = recharge coupée |
| D7          | P1.12    | 270 Ω → LED rouge d'alerte → GND |
| D8          | P1.13    | e-paper CLK et BMP280 SCL (SPI SCK) |
| D9          | P1.14    | BMP280 SDO (SPI MISO) |
| D10         | P1.15    | e-paper DIN et BMP280 SDA (SPI MOSI) |
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

```
 Recharge (grand froid)                     Baromètre (bus SPI partagé)
 J1+ ─ SS14 ─┬─ IN [U4 TPS22918] OUT ─ 5V    3V3 ─ VCC [BMP280] CSB ─ D0
             │          EN                    GND ─ GND          SDO ─ D9 (MISO)
           100 kΩ (R10)  │                    D8 ─ SCL           SDA ─ D10 (MOSI)
             └───────────┤
                         D  2N7002 (Q3)
          D6 ───────┬─── G
              100 kΩ (R11) S
                   GND    GND
```

**Composants à ajouter** à la commande : 2 MOSFET canal N de niveau logique (AO3400 en CMS ou 2N7002) pour le buzzer et l'éclairage, 1 diode 1N4148, des résistances de 100 Ω, 100 kΩ, 150 Ω et 270 Ω. Depuis le 24/10/2026, en plus : une carte **GY-BMP280** (baromètre, version 3,3 V à 6 broches, utilisée en SPI), un interrupteur de puissance **TPS22918** (U4, SOT-23-6), un **2N7002** (Q3), deux résistances de **100 kΩ** (R10, R11), une de **2,2 kΩ** (R12) et une **pastille autocollante de membrane ePTFE** de Ø 10 mm pour l'évent du boîtier. En option, une résistance de 1 MΩ et un condensateur de 10 nF pour le reed (voir plus bas).

Justification des valeurs :
- **LED d'alerte** : (3,3 V − 2,0 V) / 270 Ω ≈ 5 mA. Une broche normale du nRF52840 ne fournit qu'environ 2 mA. La broche D7 est donc réglée en sortie « forte » (*high drive*, jusqu'à environ 10 mA).
- **Buzzer** : environ 25 mA, ce qui est trop pour une broche. Un MOSFET commande le courant. La résistance de 100 kΩ maintient le MOSFET bloqué au démarrage et en veille. La diode protège le transistor de la surtension que crée la bobine du buzzer à la coupure.
- **LED blanches** : leur tension de seuil est d'environ 3 V, ce qui laisse trop peu de marge sur 3,3 V. On les alimente donc par la batterie (3,7 à 4,2 V) : (3,7 − 3,0) / 150 Ω ≈ 5 mA.
- **Coupure de recharge** : la LiPo ne doit pas se recharger hors de 0-45 °C, et le chargeur du XIAO ne surveille pas la température. U4 est passant tant que R10 tire sa broche EN au 5 V. Par grand froid, D6 rend Q3 passant : EN tombe à 0 et U4 coupe le 5 V. **Carte éteinte, R11 bloque Q3 : la recharge reste possible**, sinon une batterie vide ne pourrait plus jamais se recharger. R10 consomme alors 50 µA, pris sur le chargeur et non sur la batterie.
- **Deux boutons sur D5** : SW1 tire D5 à 0 V, SW2 à environ 0,48 V à travers 2,2 kΩ (12 à 17 % de VDD selon le tirage interne). Les deux restent sous le seuil de 30 % de VDD : les deux boutons réveillent la carte. Le convertisseur analogique, réglé sur une pleine échelle égale à VDD (`AR_VDD4`), ne sert que pendant un appui, pour savoir lequel.
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
- **Tâche de fond pour la LED et le buzzer.** Un rafraîchissement complet de l'e-paper bloque `loop()` jusqu'à 2,5 s (5 s sous 0 °C : attente fixe, sans fil BUSY). Une petite tâche FreeRTOS fait clignoter la LED et biper le buzzer, pour que les bips gardent leur durée.
- **Veille = System OFF.** La carte consomme alors environ 5 µA, et seuls le reed, les boutons et l'arrivée du 5 V du chargeur (détection de VBUS) peuvent la réveiller. Avant de s'éteindre, le boîtier relâche toujours la coupure de recharge : si le câble est branché, le 5 V revient aussitôt, le réveille, et il remesure la température. Le réveil est un redémarrage : les réglages et le trajet sont sauvegardés en flash (LittleFS) avant l'extinction, puis relus au démarrage.
- **Écoute par fenêtres.** Le scanner BLE est démarré et arrêté selon `boitierEcoute()` : 3 s d'écoute toutes les 5 s, à une position qui change à chaque période, et écoute continue pendant 15 s après une trame douteuse (`boitierEcouteRenforcee()`). Les copies d'une même annonce reçues à moins de 100 ms d'écart sont ignorées. Sans ce filtre, le contrôle du rythme les prendrait pour un second émetteur.
- **Délai de perte d'un capteur.** 60 s sans trame quand le vélo roule à plus de 10 km/h (`VITESSE_ROULAGE_SURE_KMH`), 10 min en dessous et à l'arrêt. Sous ce seuil, un capteur qui ne sent plus la rotation (montée lente) n'annonce plus qu'une fois par minute : avec 60 s, il y avait de fausses alertes « capteur perdu » (`docs/analyse-de-risques.md`, § 6.7). Contrepartie : un vrai capteur perdu à moins de 10 km/h est signalé en 10 min.
- **Hystérésis des alertes** (`alertes`). Une alerte « pression basse » ne s'éteint qu'au-dessus du seuil bas + 0,05 bar (`HYSTERESIS_ALERTE_BAR`), et l'inverse pour la pression haute : une pression qui oscille autour du seuil la nuit ne fait plus biper le boîtier en boucle.
- **Journal de sécurité chaîné** (`journal`, `sha256`). Chaque ligne du journal du boîtier est recopiée avec l'empreinte SHA-256 de la précédente : une ligne modifiée se voit. 64 lignes de 234 octets, soit environ 15 Ko de RAM sur 256 Ko.
- **Radio saturée.** Plus de 50 annonces inconnues par seconde pendant 5 s : « SATURE » s'affiche dans la barre d'état de l'écran, sans bip, et le journal le note.
- **Sécurité de la liaison avec l'application.**
  - L'appairage se fait en LE Secure Connections avec un code à 6 chiffres. Ce code est tiré par la pile BLE et affiché sur l'e-paper.
  - Les trois caractéristiques ont la permission `SECMODE_ENC_WITH_MITM` : la pile refuse tout accès sans lien chiffré et authentifié par le code. Notre logique le revérifie, par défense en profondeur.
  - Après 3 échecs d'appairage, l'appairage est bloqué 1 min.
  - Le boîtier accepte une seule connexion à la fois.
  - Les réglages reçus sont vérifiés avant d'être appliqués. Les réglages relus en flash sont vérifiés de la même façon.
- **Baromètre** (`barometre`, `barometre_bmp280.cpp`). Une mesure toutes les 10 s, boîtier éveillé. La pression de l'air corrige l'erreur d'altitude des capteurs (affichage et alertes) ; la température décide si la recharge est permise (2 à 43 °C, hystérésis de 3 °C). BMP280 absent ou hors plage : pas de correction, recharge jamais coupée.
- **Sur son chargeur par grand froid**, le boîtier n'écoute plus les capteurs (il n'est pas sur le vélo) : 0,02 mA au lieu de 3 mA. La roue ou un bouton rallument l'écoute.
- **Oublier les téléphones appairés** : maintenir le **bouton 1 pendant 5 s** au démarrage. (Avant le 24/10/2026 : les deux boutons à la fois. Sur une seule broche, « les deux » se lit comme le bouton 1.)

### Différences assumées avec le simulateur

| Simulateur | Firmware | Pourquoi |
|------------|----------|----------|
| La veille garde tout en mémoire | Après la veille, les pressions sont en « EN ATTENTE » jusqu'à la 1re trame (5 s au plus). Le trajet et les réglages sont relus en flash | Le System OFF efface la RAM |
| Le code d'appairage est tiré par `Math.random` et n'est pas remplacé tant qu'il est valide | Le code est tiré par la pile BLE, une fois par tentative. Le dernier reçu est toujours affiché | C'est la pile qui fixe le code ; la limite à une connexion empêche un tiers de le changer |
| Un code faux laisse le même code affiché | Un échec efface le code, et la tentative suivante en aura un nouveau | Fonctionnement de BLE |
| Les trames de toute longueur sont comptées « invalides » | Seules les annonces de 18 octets (capteurs du commerce) et de 26 octets (capteurs « v2 ») sont transmises à la logique | Il y a des dizaines d'objets BLE autour de nous. Pour des capteurs « version 2 » (proposition), il faudrait aussi laisser passer les annonces de 26 octets (`capteurs_ble.cpp`) |
| La veille garde le journal chaîné et le dernier compteur des capteurs v2 | Le System OFF efface la RAM : `stockage.cpp` sauvegarde donc en flash, à chaque mise en veille, le dernier compteur accepté de chaque capteur v2 (dans `/tpms.bin`, format version 2) et le journal chaîné (dans `/journal.bin`, ≈ 15 Ko, avec somme de contrôle), puis les relit au réveil | Sinon le journal repartirait de zéro (effacer une trace = attendre la veille) et, avec des capteurs v2, la première trame rejouée après un réveil serait acceptée. Écrit le 23/10/2026, vérifié en syntaxe seulement : à essayer sur la carte |
| Le 1er affichage est un rafraîchissement partiel | Le 1er affichage après l'allumage est complet | L'écran a perdu l'image précédente |
| Nombres en `double` | Nombres en `float` | Le nRF52840 calcule les `float` en matériel. Les tolérances des tests embarqués sont un peu plus larges |

## Première mise en service, à la réception du matériel

1. **Carte seule, USB branché.** Téléverser le programme et ouvrir le moniteur série. La carte redémarre une fois (libération des plots NFC). Les tests s'affichent ensuite et doivent finir par « 0 en échec ».
2. **Capteurs TPMS.** Passer `MODE_DECOUVERTE` à 1, puis approcher les capteurs vissés sur une valve. Relever leur adresse, la longueur et le contenu de leurs annonces, et comparer avec le format supposé dans `trame.h`. Corriger `trame.h` et `ID_FABRICANT` si besoin, puis les adresses par défaut dans `boitier.cpp`, ou les régler depuis l'application.
3. **Écran.** Vérifier l'image : sens, couleurs pas inversées, partiels propres. Régler `ECRAN_ROTATION` si besoin.
4. **Reed, boutons, LED, buzzer**, puis la **veille** : attendre 5 min sans rouler, puis réveiller avec la roue et avec chaque bouton. Relever la tension de D5 avec SW2 appuyé (attendue : 0,40 à 0,55 V).
5. **Fil BUSY, AVANT de le couper** : le câbler provisoirement et mesurer sa durée à l'oscilloscope, pour un rafraîchissement complet et un partiel, à 20 °C, au réfrigérateur (5 °C) puis au congélateur (−18 °C). Régler `ATTENTE_ECRAN_COMPLET_MS`, `ATTENTE_ECRAN_PARTIEL_MS` et les coefficients de froid dans `barometre.h` et `barometre.js`, avec au moins 30 % de marge.
6. **Baromètre et recharge** : comparer la pression lue à celle d'une station météo proche (au niveau du lieu, pas ramenée à la mer) ; boîtier sorti du réfrigérateur et branché : vérifier « FROID » à l'écran et l'absence de courant de charge (multimètre en série sur le câble), puis la reprise vers 5 °C.
7. **Application.** Appairer le téléphone avec le code affiché, puis lire la MTU obtenue sur le moniteur série. Écrire des réglages et vérifier qu'ils survivent à une veille.
8. **Consommation**, à l'oscilloscope avec une résistance de 10 Ω en série : en veille, éveillé radio coupée, en écoute, pendant un rafraîchissement. Reporter les valeurs mesurées dans `energie.js`.
9. Remettre `AUTOTEST` à 0, ainsi que `JOURNAL_TRAMES` si on veut moins de messages.

## Points À VÉRIFIER

**Format des capteurs TPMS (le plus important)**
- Le format des trames reste une hypothèse : 18 octets, identifiant fabricant `00 01`, numéro 0x80/0x81, pression en Pa, température en centièmes de °C (`trame.h`).
- Les adresses des capteurs (`boitier.cpp`) sont pour l'instant celles du simulateur.
- Le rythme d'émission des capteurs est supposé de 3 s (`RYTHME_MIN_MS` = 2000 dans `securite.h`).
- Il faut aussi vérifier la plage de pression maximale des capteurs.
- La vitesse à partir de laquelle les capteurs détectent la rotation est inconnue (4,4 km/h dans le simulateur) : vérifier qu'elle reste sous `VITESSE_ROULAGE_SURE_KMH` = 10 km/h.

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
- Le réveil doit marcher par le reed, par chaque bouton (SW2 à travers R12) et par l'arrivée du 5 V (bit `VBUS` de `RESETREAS`).

**Baromètre, boutons, écran sans BUSY (ajoutés le 24/10/2026)**
- `Adafruit_BMP280(cs)` sur le bus SPI partagé avec GxEPD2 ; le type de retour de `takeForcedMeasurement()` dépend de la version de la bibliothèque.
- GxEPD2 avec BUSY = −1 : vérifier qu'il attend bien une durée fixe et que l'image reste propre au froid.
- `AR_VDD4`, et le maintien du tirage interne de D5 par `analogRead()`.
- `sd_power_usbregstatus_get` pour lire VBUS quand le SoftDevice est actif.
- Courant de repos de U4 (TPS22918) et chute de tension à 100 mA de charge.

**Divers**
- La priorité de la tâche des sorties.
- L'appel de `millis()` dans l'interruption du reed.
- Le comportement de `FILE_O_WRITE` (on efface le fichier avant d'écrire).

**Postes absents de `energie.js`, à ajouter au bilan**
- Les annonces BLE vers le téléphone : environ 10 à 20 µA.
- Le pont diviseur de la batterie, toujours actif : environ 2,8 µA, y compris en veille.
- Le canal d'interruption GPIOTE du reed quand le boîtier est éveillé : quelques µA, voire plus.
