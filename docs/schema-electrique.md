# Schéma électrique du boîtier de guidon

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6.

Ce document décrit le câblage du boîtier de guidon : schéma, liaisons broche par broche, nomenclature et calculs qui justifient chaque valeur. Le câblage est celui de `firmware/tpms_boitier/config.h` et de `firmware/README.md`.

Le matériel n'est pas encore reçu. Les valeurs viennent des fiches techniques ; celles qui restent à vérifier sont marquées **hypothèse**. Les chiffres des calculs ont été obtenus en exécutant le modèle du simulateur (`simulateur/monde/circuit.js` et `simulateur/monde/lipo.js`) avec Node.js, et non recopiés à la main.

![Schéma électrique du boîtier de guidon](schema/schema-boitier.svg)

**Un seul dessin pour le dossier et pour le simulateur.** Le schéma est dessiné par `simulateur/vues/schema.js`. Le simulateur l'affiche dans sa section « Électronique » et l'anime : les fils parcourus par un courant défilent en rouge, les LED s'allument, le buzzer vibre, les MOSFET passants sont mis en évidence, et chaque composant affiche son courant. Pour le dossier, la commande suivante écrit l'image ci-dessus :

```
node docs/schema/genere-schema.js
```

Les tests de l'électronique se lancent avec `node simulateur/tests/electronique.tests.js` (86 vérifications).

**Révision C du 24/10/2026.** Ajout du baromètre BMP280 (U3) sur le bus SPI de l'écran, de la coupure de la recharge par grand froid (U4, Q3, R10, R11) et des deux boutons sur une seule broche (R12). Pour libérer les broches nécessaires, le fil BUSY de l'écran est supprimé (§ 4.15). Le schéma compte maintenant 34 composants repérés.

---

## 1. Vue d'ensemble

| Bloc | Composants | Alimentation |
|---|---|---|
| Carte microcontrôleur | U1 Seeed XIAO nRF52840 : nRF52840, régulateur 3,3 V, chargeur LiPo BQ25101, pont de mesure de la batterie | LiPo (plots BAT+/BAT−) ou 5 V (broche 5V) |
| Batterie | BT1 LiPo 500 mAh avec sa protection | — |
| Recharge | J1 connecteur magnétique, D2 diode Schottky | 5 V extérieur |
| Coupure de la recharge par grand froid | U4 interrupteur de puissance TPS22918, R10 ; Q3 2N7002 commandé par D6, R11 | 5 V du chargeur (U4, R10) ; D6 (Q3) |
| Écran | U2 e-paper WeAct 1,54″ (SSD1681), bus SPI ; fil BUSY non câblé | +3V3 |
| Baromètre | U3 BMP280 (carte GY-BMP280), sur le même bus SPI, sous l'évent à membrane du boîtier | +3V3 |
| Roue | S1 interrupteur reed sur la fourche, câble 2 fils, J2, R8 | tirage interne du nRF52840 |
| Boutons | SW1, SW2 (avec R12), tous deux sur D5 | tirage interne du nRF52840 |
| Alerte | LED1 rouge + R1 ; buzzer BZ1 commandé par Q1 | +3V3 |
| Éclairage | LED2, LED3 blanches + R6, R7, commandées par Q2 | +VBAT |

Les étiquettes rouges (`+3V3`, `+VBAT`, `SCK`, `MOSI`, `MISO`, `CSB`, `D4`, `D6`) relient les fils qui portent le même nom, sans tracer le fil, comme sur tout schéma industriel.

**Pourquoi le câblage a changé le 24/10/2026.** Le XIAO n'a que 11 broches (D0 à D10) et il en faudrait 15 : 6 pour l'écran, 2 pour le baromètre (sélection et données), 1 pour le reed, 2 pour les boutons, 1 pour la coupure de recharge, 1 pour le buzzer, 1 pour la LED d'alerte et 1 pour l'éclairage. Solutions retenues (`config.h`) : les plots NFC deviennent des sorties (buzzer, éclairage) ; le baromètre partage le bus SPI de l'écran et sa sortie arrive sur D9 (MISO), réservée mais inutilisée jusque-là ; le fil BUSY est supprimé, ce qui libère D0 pour la sélection du baromètre ; les deux boutons partagent D5, lue en analogique, ce qui libère D6 pour la coupure de la recharge.

---

## 2. Liaisons broche par broche

### 2.1 Carte XIAO (U1)

| Broche XIAO | GPIO nRF52840 | Équipotentielle | Raccordée à | Sens | Au repos |
|---|---|---|---|---|---|
| D0 | P0.02 | CSB | U3 CSB (sélection du baromètre) ; la broche BUSY de U2 n'est plus câblée | sortie | 1 (baromètre non sélectionné) |
| D1 | P0.03 | RES | U2 RES | sortie | 1 |
| D2 | P0.28 | DC | U2 DC | sortie | 0 |
| D3 | P0.29 | CS | U2 CS | sortie | 1 |
| D4 | P0.04 | reed | R8 → J2.1 → S1 → J2.2 → GND | entrée, tirage interne | 1 (reed ouvert) |
| D5 | P0.05 (AIN3) | boutons 1 et 2 | SW1 → GND ; SW2 → R12 (2,2 kΩ) → GND | entrée, tirage interne, lue en analogique pendant un appui | 1 (3,3 V) |
| D6 | P1.11 | coupure de recharge | grille de Q3 (R11 1 MΩ vers GND) | sortie | 0 (recharge permise) |
| D7 | P1.12 | LED d'alerte | R1 → LED1 → GND | sortie forte (*high drive*) | 0 |
| D8 | P1.13 | SCK | U2 SCL, U3 SCL | sortie (SPI) | 0 |
| D9 | P1.14 | MISO | U3 SDO (données du baromètre) | entrée (SPI) | en l'air hors lecture |
| D10 | P1.15 | MOSI | U2 SDA, U3 SDA | sortie (SPI) | 0 |
| 5V | VBUS | 5V | sortie OUT de U4 | entrée d'alimentation | 0 V sans câble ou recharge coupée |
| 3V3 | sortie du régulateur | +3V3 | U2 VCC, U3 VCC, BZ1 +, C2, C3, (R9) | sortie d'alimentation | 3,3 V |
| GND | — | GND | masse commune | — | 0 V |
| plot BAT+ (dessous) | — | +VBAT | BT1 +, R6, R7 | entrée/sortie | 3,0 à 4,2 V |
| plot BAT− (dessous) | — | GND | BT1 − | — | 0 V |
| plot NFC1 (dessous) | P0.09 | commande buzzer | R2 → grille de Q1 | sortie | 0 |
| plot NFC2 (dessous) | P0.10 | commande éclairage | R3 → grille de Q2 | sortie | 0 |

Broches internes de la carte, utilisées par le programme : P0.14 (active le pont de mesure, à 0), P0.31 (mesure de VBAT, AIN7), P0.17 (état de charge), P0.13 (courant de charge 100 ou 50 mA).

### 2.2 Autres composants

| Composant | Broche | Reliée à |
|---|---|---|
| U2 e-paper | VCC / GND | +3V3 / GND |
| U2 e-paper | SDA / SCL | MOSI (D10) / SCK (D8) |
| U2 e-paper | CS / DC / RES | D3 / D2 / D1 |
| U2 e-paper | BUSY | non câblée (NC) : le programme attend une durée fixe (§ 4.15) |
| U3 BMP280 | VCC / GND | +3V3 / GND |
| U3 BMP280 | SCL / SDA / SDO / CSB | SCK (D8) / MOSI (D10) / MISO (D9) / D0 |
| J1 connecteur magnétique | 1 (+5 V) / 2 | anode de D2 / GND |
| D2 SS14 | anode / cathode | J1.1 / IN de U4 |
| U4 TPS22918 | IN / OUT / EN | cathode de D2 / broche 5V du XIAO / R10 et drain de Q3 |
| U4 TPS22918 | GND, CT, QOD | GND ; CT et QOD : raccordement à décider avec la fiche TI (**à vérifier**, non dessinées) |
| R10 100 kΩ | 1 / 2 | IN de U4 (après D2) / EN de U4 |
| Q3 2N7002 | G / D / S | D6 / EN de U4 / GND |
| R11 1 MΩ | 1 / 2 | grille de Q3 (D6) / GND |
| BT1 LiPo | + / − | plot BAT+ / plot BAT− |
| R1 270 Ω | 1 / 2 | D7 / anode de LED1 |
| LED1 rouge | cathode | GND |
| R2 100 Ω | 1 / 2 | NFC1 / grille de Q1 |
| R4 100 kΩ | 1 / 2 | grille de Q1 / GND |
| Q1 AO3400A | D / S | − de BZ1 et anode de D1 / GND |
| BZ1 buzzer actif | + / − | +3V3 / drain de Q1 |
| D1 1N4148 | anode / cathode | drain de Q1 / +3V3 |
| C2 10 µF | + / − | +3V3 / GND (au plus près de BZ1) |
| C3 100 nF | 1 / 2 | 3V3 / GND (au plus près de U1) |
| R3 100 Ω | 1 / 2 | NFC2 / grille de Q2 |
| R5 100 kΩ | 1 / 2 | grille de Q2 / GND |
| R6, R7 150 Ω | 1 / 2 | +VBAT / anode de LED2, de LED3 |
| LED2, LED3 blanches | cathodes | drain de Q2 |
| Q2 AO3400A | S | GND |
| R8 1 kΩ | 1 / 2 | D4 / J2.1 |
| J2 connecteur 2 points | 1 / 2 | R8 / GND (côté boîtier) ; les 2 fils du reed (côté fourche) |
| S1 reed PS-3150 | 1 / 2 | J2.1 / J2.2 par le câble |
| SW1 | 1 / 2 | D5 / GND |
| SW2 | 1 / 2 | D5 / R12 |
| R12 2,2 kΩ | 1 / 2 | SW2 / GND |
| R9 1 MΩ (non monté) | 1 / 2 | +3V3 / D4 |
| C1 10 nF (non monté) | 1 / 2 | D4 / GND |

---

## 3. Nomenclature

| Repère | Désignation | Valeur / référence | Boîtier | Rôle | Statut |
|---|---|---|---|---|---|
| U1 | Carte microcontrôleur | Seeed XIAO nRF52840 | module 21 × 17,5 mm | processeur, radio BLE, chargeur, régulateur | commandé (11,99 €) |
| U2 | Afficheur e-paper | WeAct 1,54″ 200 × 200, SSD1681 | module | écran | commandé (8,49 €) |
| BT1 | Batterie LiPo | 3,7 V 500 mAh 503035, protection intégrée | 5 × 30 × 35 mm | énergie | commandée (5,59 €) |
| J1 | Connecteur magnétique | 2 broches | — | recharge étanche | commandé (1,23 €) |
| S1 | Interrupteur reed (ILS) | PS-3150 | ampoule de verre | détection du tour de roue | commandé (1,26 €) |
| — | Aimant de rayon | — | — | déclenche S1 | commandé (2,69 €) |
| SW1, SW2 | Boutons poussoirs étanches | 12 mm, contact travail | — | interface | commandés (2 × 1,18 €) |
| BZ1 | Buzzer actif | 3 V, électromagnétique, oscillateur intégré | Ø 12 mm | bip d'alerte | commandé (0,81 €) |
| LED1 | LED rouge | 3 mm | traversant | alerte | kit de 100 LED (2,27 €) |
| LED2, LED3 | LED blanches | 3 mm | traversant | éclairage latéral | même kit |
| Q1, Q2 | MOSFET canal N, niveau logique | AO3400A (30 V, 5,7 A) ou 2N7002 | SOT-23 | commande du buzzer et de l'éclairage | **à commander** |
| D1 | Diode de signal rapide | 1N4148 (ou 1N4148W) | DO-35 / SOD-123 | roue libre du buzzer | **à commander** |
| D2 | Diode Schottky | SS14 (1 A, 40 V) | SMA | entrée de recharge | **à commander** |
| R1 | Résistance | 270 Ω 1 % | 0603 ou ¼ W | courant de LED1 | **à commander** |
| R2, R3 | Résistances | 100 Ω 1 % | 0603 ou ¼ W | résistance de grille | **à commander** |
| R4, R5 | Résistances | 100 kΩ 5 % | 0603 ou ¼ W | grille tirée à 0 | **à commander** |
| R6, R7 | Résistances | 150 Ω 1 % | 0603 ou ¼ W | courant de LED2, LED3 | **à commander** |
| R8 | Résistance | 1 kΩ 1 % | 0603 ou ¼ W | protection de l'entrée du reed | **à commander** |
| R9 | Résistance (option, non montée) | 1 MΩ 5 % | 0603 ou ¼ W | tirage externe du reed | option |
| C1 | Condensateur (option, non monté) | 10 nF X7R | 0603 | filtre du reed | option |
| C2 | Condensateur | 10 µF 10 V (céramique X5R ou tantale) | 0805 | réserve locale du buzzer | **à commander** |
| C3 | Condensateur | 100 nF X7R | 0603 | découplage de +3V3 | **à commander** |
| J2 | Connecteur 2 points | JST-PH 2 broches (**hypothèse**) ou soudure directe | — | câble du reed | **à choisir** |
| U3 | Baromètre et thermomètre | Bosch BMP280 sur carte GY-BMP280 (version 3,3 V à 6 broches, utilisée en SPI) | module ≈ 11,5 × 15 mm (**hypothèse**) | correction d'altitude, température de la recharge | **à commander** |
| U4 | Interrupteur de puissance (*load switch*) | TI TPS22918 | SOT-23-6 | coupure de l'entrée de recharge | **à commander** |
| Q3 | MOSFET canal N | 2N7002 | SOT-23 | commande de la broche EN de U4 | **à commander** |
| R10 | Résistance | 100 kΩ 5 % | 0603 ou ¼ W | EN de U4 tirée au 5 V | **à commander** |
| R11 | Résistance | 1 MΩ 5 % | 0603 ou ¼ W | grille de Q3 tirée à 0 | **à commander** |
| R12 | Résistance | 2,2 kΩ 1 % | 0603 ou ¼ W | distinguer SW2 de SW1 sur D5 | **à commander** |
| — | Membrane d'évent | pastille autocollante ePTFE Ø 10 mm | — | laisse passer l'air jusqu'au baromètre, pas l'eau | **à commander** |

Les composants passifs peuvent être en traversant (¼ W) : le fer à souder fin et l'imprimante 3D permettent les deux. Les AO3400A n'existent qu'en CMS (SOT-23) ; le 2N7002 convient aussi (RDS(on) plus élevée, ≈ 2 à 3 Ω, sans conséquence pour 25 mA).

---

## 4. Calculs justifiés

### 4.1 LED d'alerte rouge (R1)

Une broche ordinaire du nRF52840 ne garantit qu'environ 0,5 mA pour 0,4 V de chute. La broche D7 est donc réglée en **sortie forte** (*high drive*, fiche nRF52840 : VOH ≥ VDD − 0,4 V à 5 mA).

LED rouge 3 mm : VF ≈ 1,85 V à 5 mA (≈ 2,0 V à 20 mA d'après les fiches de LED 3 mm, **hypothèse**).

R1 = (3,3 − 1,85) / 5 mA = 290 Ω → valeur normalisée **270 Ω**.

Le modèle du simulateur, qui tient compte de la résistance de sortie de la broche (≈ 30 Ω, **hypothèse**) et de la courbe de la LED, donne **4,84 mA**, D7 à 3,16 V et l'anode à 1,85 V. Puissance dans R1 : 270 × (4,84 mA)² = 6,3 mW.

### 4.2 LED d'éclairage blanches (R6, R7)

Une LED blanche a une tension de seuil d'environ 3 V : sur 3,3 V, il ne resterait que 0,3 V pour la résistance, et le courant dépendrait énormément de la LED. On les alimente donc par la **batterie** (3,0 à 4,2 V), avec un MOSFET en commutation côté masse.

R6 = (3,7 − 2,95) / 5 mA = 150 Ω, avec VF ≈ 2,95 V à 5 mA (**hypothèse**, LED blanche 3 mm ≈ 3,0 à 3,2 V à 20 mA).

Conséquence voulue et montrée par le simulateur : le courant des LED **suit la tension de la batterie**.

| État de charge | VBAT | Courant par LED | VF de la LED |
|---|---|---|---|
| 100 % | 4,20 V | 7,8 mA | 3,02 V |
| 50 % | 3,84 V | 5,8 mA | 2,97 V |
| 20 % | 3,73 V | 5,2 mA | 2,96 V |
| 5 % | 3,55 V | 4,2 mA | 2,92 V |
| 2 % | 3,30 V | 2,8 mA | 2,87 V |

Une résistance par LED (et non une seule pour les deux) : deux LED en parallèle n'ont jamais exactement la même VF, et celle qui a la plus faible prendrait presque tout le courant. Le simulateur le montre en tirant les composants avec leurs tolérances (`TPMS.circuitTirerComposants`).

### 4.3 MOSFET en commutation (Q1, Q2)

Le buzzer (25 mA) et l'éclairage (≈ 12 mA à mi-charge) demandent plus qu'une broche ne peut fournir. Un MOSFET canal N, placé entre la charge et la masse, sert d'interrupteur commandé par la broche.

**Choix de l'AO3400A** (fiche Alpha & Omega) : VDS max 30 V, ID max 5,7 A, **VGS(th) = 0,65 à 1,45 V** (1,05 V typique), **RDS(on) < 32 mΩ à VGS = 4,5 V et < 48 mΩ à 2,5 V**. Il est donc « niveau logique » : 3,3 V sur la grille suffisent à le rendre complètement passant. Un MOSFET ordinaire (IRF540, VGS(th) jusqu'à 4 V) ne conviendrait pas.

- **VGS** : la broche fournit 3,3 V ; le pont R2/R4 (100 Ω / 100 kΩ) n'en perd que 0,1 % → VGS = 3,29 V, soit 2,2 V au-dessus du seuil.
- **RDS(on)** à 3,29 V : ≈ 31 mΩ (modèle du simulateur, entre les deux points de la fiche).
- **Chute dans Q1** : 25 mA × 31 mΩ = **0,79 mV** ; puissance 25 mA × 0,79 mV ≈ 20 µW. Le transistor ne chauffe pas. Pour Q2 : 0,36 mV à 11,5 mA.
- **Bloqué** (grille à 0) : il ne passe que le courant de fuite IDSS (< 1 µA garanti, quelques nA en pratique). Le simulateur vérifie qu'aucune LED ne s'allume et que le buzzer reste muet sans tension de grille.
- **R4, R5 = 100 kΩ (grille tirée à 0)** : au démarrage, pendant la réinitialisation ou en veille, la broche est en haute impédance. Sans ces résistances, la grille « flotte », se charge par couplage et peut rendre le MOSFET à moitié passant : le buzzer sifflerait au démarrage et l'éclairage viderait la batterie. Courant quand la sortie est à 1 : 3,3 V / 100 kΩ = 33 µA.
- **R2, R3 = 100 Ω (résistance de grille)** : la grille est un condensateur (Ciss ≈ 0,6 nF pour l'AO3400A). R2 limite la pointe de courant demandée à la broche à la commutation et amortit les oscillations du câblage. Constante de temps : 100 Ω × 0,6 nF = 60 ns, négligeable devant la durée d'un bip (120 ms).

### 4.4 Diode de roue libre D1 (1N4148)

Le buzzer actif est électromagnétique : une bobine. Quand Q1 se bloque, le courant de la bobine ne peut pas s'arrêter net (u = L·di/dt) : la tension du drain monterait jusqu'à ce que quelque chose cède, éventuellement au-delà des 30 V du MOSFET. D1, branchée en inverse aux bornes du buzzer (cathode vers +3V3), offre un chemin à ce courant, qui s'éteint alors doucement. La tension du drain est limitée à 3,3 + 0,7 ≈ 4 V.

En régime établi, D1 est polarisée en inverse et ne conduit pas (courant nul dans le simulateur). La 1N4148 convient : diode rapide (trr = 4 ns), 300 mA en continu et 450 mA en pointe répétitive, pour une pointe égale au courant du buzzer (25 mA).

### 4.5 Diode Schottky D2 sur l'entrée de recharge (SS14)

Le wiki Seeed du XIAO demande de mettre une **diode entre une alimentation extérieure et la broche 5V** : la broche 5V est reliée directement au VBUS de l'USB-C. Sans diode :
- quand on branche l'USB-C pour programmer la carte, le 5 V de l'ordinateur sortirait sur les contacts **à nu** du connecteur magnétique J1. Une goutte d'eau ou un objet métallique les court-circuiterait ;
- une alimentation de recharge mal réglée pourrait renvoyer du courant vers le port USB de l'ordinateur.

D2 laisse passer le courant de J1 vers le XIAO et le bloque dans l'autre sens. On choisit une **Schottky** pour sa faible tension de seuil :

| Situation | Courant dans D2 | VF | VBUS | Puissance dans D2 |
|---|---|---|---|---|
| Recharge seule | 101 mA | 0,32 V | 4,68 V | 32 mW |
| Recharge + radio + éclairage | 106 mA | 0,32 V | 4,68 V | 34 mW |

(SS14, fiche : VF ≤ 0,5 V à 1 A ; modèle du simulateur calé sur ≈ 0,3 V à 100 mA, **hypothèse**.) Une diode silicium ordinaire (1N4001, ≈ 0,8 V) laisserait 4,2 V : juste suffisant pour le chargeur en fin de charge. Avec 4,68 V, le BQ25101 garde une marge confortable au-dessus de VBAT (il doit avoir VIN > VBAT + ≈ 0,1 V pour charger).

### 4.6 Découplage (C2, C3)

- **C3 = 100 nF** au plus près de la broche 3V3 : il fournit les pointes de courant très brèves (fronts du bus SPI, convertisseur de l'e-paper) que le régulateur, trop lent, ne peut pas suivre. Le module WeAct a déjà ses propres condensateurs ; C3 découple le fil qui y mène.
- **C2 = 10 µF** près du buzzer : à la mise en marche, le courant passe de 0 à 25 mA d'un coup, et le buzzer actif le hache ensuite à la fréquence de son oscillateur (≈ 2 à 4 kHz). Le régulateur met quelques dizaines de µs à réagir. Pendant 20 µs, C2 seul fournit le courant et sa tension baisse de ΔU = I·Δt / C = 25 mA × 20 µs / 10 µF = **0,05 V**. Sans C2, ce creux apparaîtrait sur le +3V3 de l'écran et du nRF52840. Le « + » sur le schéma ne sert que si l'on monte un condensateur tantale ; un condensateur céramique X5R 10 V n'a pas de sens.

### 4.7 Reed, tirage, et piège de l'aimant arrêté devant

Le reed relie D4 à la masse quand l'aimant passe. La broche est tirée à 3,3 V par la **résistance de tirage interne** du nRF52840 (11 à 16 kΩ, 13 kΩ typique). **R8 = 1 kΩ** en série protège l'entrée : le câble de la fourche (≈ 60 cm) capte les décharges électrostatiques, et R8 limite le courant injecté dans la broche.

- Reed ouvert : D4 = 3,3 V (état 1).
- Reed fermé : D4 = 3,3 × 1 / (13 + 1) = **0,24 V**, bien en dessous du seuil bas (0,3 × VDD = 0,99 V).
- Courant reed fermé : 3,3 V / 14 kΩ = **0,236 mA** (simulateur : 235,7 µA ; `energie.js` arrondit à 0,25 mA en négligeant R8).

**Le piège** : si le vélo s'arrête avec l'aimant pile devant le reed, ces 0,24 mA circulent en permanence. En veille, le boîtier passe de 5 µA à **241 µA**, et sa veille tiendrait 3 mois au lieu de plusieurs années.

- **Parade logicielle (choix par défaut)** : au-delà de 3 s fermé, le programme débranche le tirage (entrée `reedPullupActif = false` du simulateur : courant 0), puis le rebranche 50 µs par seconde pour voir si le reed s'est rouvert.
- **Parade matérielle (option, non montée)** : R9 = 1 MΩ vers +3V3 et C1 = 10 nF vers la masse, avec `REED_PULLUP_INTERNE = false`. Aimant arrêté devant : 3,3 V / 1 MΩ = **3,3 µA**. Contrainte de vitesse : C1 se décharge par le reed et R8 en 1 kΩ × 10 nF = 10 µs, et se recharge par R9 en τ = 1 MΩ × 10 nF = 10 ms (état 1 atteint après ≈ 1,2 τ = 12 ms). À 60 km/h, une roue de 2,1 m fait un tour en 126 ms : la marge est suffisante. C1 filtre en plus les rebonds de la lame.

### 4.8 Boutons : deux boutons sur une seule broche (R12)

Depuis la révision C, SW1 et SW2 partagent D5, tirée à 3,3 V par la résistance de tirage interne (11 à 16 kΩ, 13 kΩ typique). SW1 relie D5 directement à la masse ; SW2 la relie à la masse à travers **R12 = 2,2 kΩ**. Pendant un appui, le convertisseur analogique (entrée AIN3, pleine échelle égale à VDD, `AR_VDD4`) lit la tension de D5 et `logique/boutons.js` décide quel bouton est appuyé, en proportion de VDD (la tension de la batterie varie).

Tension de D5 avec SW2 appuyé : U = 3,3 × 2,2 / (2,2 + R tirage). Calcul exécuté avec Node.js (formule ci-dessus et `TPMS.boutonDepuisTension`) :

| Tirage interne | Tension de D5 | Part de VDD | Courant pendant l'appui | Bouton reconnu |
|---|---|---|---|---|
| 11 kΩ (minimum) | 0,550 V | 16,7 % | 250 µA | SW2 |
| 13 kΩ (typique) | 0,478 V | 14,5 % | 217 µA | SW2 |
| 16 kΩ (maximum) | 0,399 V | 12,1 % | 181 µA | SW2 |

Le circuit simulé donne bien 0,478 V pour SW2 seul et 0 V pour SW1 (tests de `electronique.tests.js`).

- **Réveil.** En veille (System OFF), le réveil se fait sur un **niveau bas** de D5 : il faut que la tension descende sous le seuil bas du nRF52840, **30 % de VDD** (0,99 V). Avec SW2, elle reste entre 12 et 17 % de VDD : les deux boutons réveillent le boîtier, avec une marge confortable. Avec 3,3 kΩ, on monterait jusqu'à 23 %, trop près du seuil : c'est pourquoi R12 vaut 2,2 kΩ.
- **Décision.** Les seuils de `logique/boutons.js` sont placés au milieu des intervalles possibles : sous 6 % de VDD, SW1 (0 V, résistance du contact comprise) ; de 6 à 45 %, SW2 ; au-dessus, aucun bouton. Les deux boutons appuyés ensemble donnent 0 V : ils sont lus comme SW1.
- **Conséquence.** Le geste « oublier les téléphones appairés » change : il faut maintenir le **bouton 1 pendant 5 s** au démarrage (avant : les deux boutons, devenus impossibles à distinguer du bouton 1 seul).
- **Courant.** Au plus 0,25 mA, seulement pendant l'appui (SW1 : 3,3 V / 13 kΩ = 0,254 mA dans le simulateur ; SW2 : 0,217 mA). Les tirages restent actifs en veille : un appui réveille le boîtier.

### 4.9 Pont de mesure de la batterie (dans le XIAO)

La carte mesure VBAT par un pont **1 MΩ / 510 kΩ** (valeurs de `config.h`, **à vérifier** sur le schéma Seeed) relié à P0.31 (entrée analogique AIN7), et activé en mettant P0.14 à 0.

- Tension mesurée : VBAT × 510 / 1 510 = 0,338 × VBAT, soit **1,42 V à 4,2 V**. Elle reste sous la référence interne de 2,4 V choisie dans le programme (`AR_INTERNAL_2_4`).
- Courant consommé : VBAT / 1,51 MΩ = **2,8 µA à 4,2 V** (2,5 µA à 3,8 V). C'est la moitié de la consommation en veille ! Le programme laisse pourtant P0.14 à 0 en permanence : si P0.14 était à 1, l'entrée P0.31 recevrait VBAT à travers 1 MΩ sans le pont, soit plus que la tension d'alimentation du nRF52840.
- Impédance vue par le convertisseur : 1 MΩ // 510 kΩ = 338 kΩ. Le temps d'acquisition du convertisseur doit être réglé à 40 µs (fiche nRF52840 : 40 µs pour une source jusqu'à 800 kΩ).

### 4.10 Régulateur 3,3 V et brownout

Le régulateur linéaire (LDO) de la carte abaisse VBAT à 3,3 V. Quand la batterie descend, il n'a plus assez de tension d'entrée : il entre « en déchet » et +3V3 suit VBAT, avec une chute qui augmente avec le courant (modèle : 10 mV + 1,5 Ω × I, **hypothèse**).

| VBAT | +3V3 (écoute radio) | +3V3 (écoute + buzzer) |
|---|---|---|
| 3,40 V | 3,30 V | 3,30 V |
| 3,30 V | 3,28 V | 3,25 V |
| 3,20 V | 3,18 V | 3,15 V |
| 3,00 V | 2,98 V | 2,95 V |

Seuils de fonctionnement :
- **nRF52840** : 1,7 à 3,6 V. Sous 1,7 V, il est remis à zéro (*brownout*).
- **E-paper SSD1681** : VCI de 2,2 à 3,7 V. Sous 2,2 V, un rafraîchissement échoue.

Avec une protection de batterie à 3,0 V, ces seuils ne sont jamais atteints : la batterie est coupée avant, et +3V3 tombe à 0 V d'un coup. Le simulateur affiche alors « Brownout : aucune alimentation ». Les deux autres alertes (« Brownout de l'e-paper », « le nRF52840 est remis à zéro ») apparaissent si l'on alimente le montage sous une tension plus basse (essai sans LiPo, `vbatV`).

### 4.11 Chargeur et batterie

**Chargeur BQ25101** (fiche TI) intégré au XIAO, sortie reliée directement à la batterie :
1. **précharge** à 20 % du courant si la cellule est sous ≈ 3,0 V ;
2. **courant constant (CC)** : 100 mA (P0.13 à 0) ou 50 mA ;
3. **tension constante (CV)** : 4,20 V, le courant diminue ;
4. **fin de charge** quand le courant passe sous 10 % (10 mA) ; nouvelle charge si VBAT redescend sous ≈ 4,1 V.

Le simulateur (batterie vide, 20 °C) donne **4 h 53 min en CC**, puis **20 min en CV**, soit **5 h 13 min** au total. Le chargeur alimente aussi ce qui est branché sur VBAT : avec l'éclairage allumé, la batterie ne reçoit plus que 88 mA, et la fin de charge (moins de 10 mA) n'arrive jamais tant que les LED restent allumées.

**Protection de la cellule** (circuit DW01A + double MOSFET FS8205A, le plus courant, **hypothèse**) : coupure en surdécharge (seuil retenu 3,0 V, voir `lipo.js`), en surcharge (4,25 V) et en surintensité. Elle consomme ≈ 3 µA en permanence. Après une coupure en surdécharge, elle ne se réarme que lorsqu'un chargeur est branché.

Le BQ25101 a une entrée de température (TS) que le XIAO ne relie pas à une thermistance (**hypothèse**) : le chargeur seul n'empêche pas de recharger sous 0 °C, ce qui abîme une LiPo. Depuis la révision C, c'est le boîtier qui coupe l'entrée de recharge hors de 2 à 43 °C, d'après la température mesurée par le BMP280 (§ 4.13). Le simulateur affiche toujours une alerte si une recharge a lieu hors de 0 à 45 °C.

### 4.12 Autonomie

Courant tiré sur la batterie (simulateur, VBAT ≈ 3,73 V), comparé à `logique/energie.js` :

| Situation | `energie.js` | Circuit simulé |
|---|---|---|
| Veille (System OFF) | 0,005 mA | 0,0050 mA (nRF 0,6 µA + e-paper 0,8 µA + baromètre 0,1 µA + régulateur 1 µA + pont 2,5 µA) |
| Éveillé, radio coupée | 0,020 mA | 0,020 mA |
| Écoute radio | 5,02 mA | 5,02 mA |
| Écoute + application connectée | 5,27 mA | 5,27 mA |
| LED d'alerte fixe | 5,02 mA | 4,86 mA |
| Éclairage | 10,02 mA | 10,36 mA (15,7 mA à 4,2 V) |
| Reed resté fermé | 0,27 mA | 0,256 mA |

Les tests vérifient que chaque situation reste à moins de 10 % du bilan de `energie.js`.

**Journée type** (profil de `docs/bilan-energetique.md` : 1 h de roulage, 2 sorties, 15 min d'éclairage, 6 min d'application, écoute radio 3 s toutes les 5 s) simulée pas à pas (0,5 s éveillé, 1 min en veille) jusqu'à la coupure de la batterie :

| Calcul | Consommation | Autonomie |
|---|---|---|
| `energie.js` (450 mAh utiles, courants fixes) | 7,06 mAh/jour | 64 jours |
| Circuit + LiPo simulés, 20 °C | 8,4 mAh/jour au début, moins quand la batterie baisse | **66 jours** |
| Circuit + LiPo simulés, 0 °C | — | 59 jours |
| Veille seule, 20 °C | 0,12 mAh/jour + autodécharge | ≈ 4 ans (1 478 jours ; 1 490 jours sans le baromètre) |

Le baromètre de la révision C (0,1 µA en sommeil, ≈ 0,4 µA en moyenne boîtier éveillé, § 4.14) a été ajouté au circuit simulé et le calcul refait avec Node.js : la journée type donne la **même autonomie au jour près** avec et sans lui (le poste vaut 0,003 mAh/jour, 0,04 % de la journée). Seule la veille seule perd 12 jours sur 4 ans.

Le circuit consomme davantage que le bilan au début, parce que les LED blanches tirent 7,8 mA chacune sur une batterie pleine au lieu de 5 mA. Mais il descend jusqu'à 3,0 V au lieu de s'arrêter à 90 % de la capacité. Les deux résultats se rejoignent : l'exigence d'**au moins une semaine** est largement tenue.

Postes absents de `energie.js` et pris en compte par le simulateur : la protection de la batterie (3 µA), le pont de mesure (2,5 à 2,8 µA), l'autodécharge de la LiPo (≈ 3 % par mois, soit 0,5 mAh par jour) et, depuis la révision C, le baromètre U3 (0,1 à 0,4 µA) et R11 quand la recharge est coupée (3,3 µA, § 4.13). En veille, ces trois postes consomment plus que tout le reste du boîtier. Ce sont eux qui limitent la durée de stockage à environ 4 ans.

### 4.13 Coupure de la recharge par grand froid (U4, Q3, R10, R11)

Une LiPo ne se recharge qu'entre 0 et 45 °C : en dessous, le lithium se dépose en métal sur l'électrode (« plaquage »), la batterie perd de la capacité et peut se mettre en court-circuit interne. Le chargeur du XIAO ne surveille pas la température (§ 4.11) : le boîtier coupe donc lui-même le 5 V du chargeur, hors de **2 à 43 °C** (marges : BMP280 précis à ±1 °C, batterie parfois un peu plus froide que l'air du boîtier), avec une **hystérésis de 3 °C** (reprise à 5 °C, ou sous 40 °C), `TPMS.blocageCharge` dans `logique/barometre.js`.

Chemin du courant de recharge : J1 → D2 → **U4** (interrupteur de puissance TPS22918) → broche 5V du XIAO.

- **U4 passant par défaut.** Sa broche de commande EN (appelée ON sur la fiche TI) est tirée au 5 V (pris après D2) par **R10 = 100 kΩ**. Le TPS22918 est donné pour RON ≈ 52 mΩ : à 101 mA de recharge, la chute est de 5 mV (simulateur : 4,681 V à l'entrée de U4, 4,676 V sur la broche 5V). Son courant de repos (≈ 8 µA passant, 0,5 µA bloqué, valeurs du modèle, **à vérifier**) est pris sur le 5 V du chargeur, jamais sur la batterie.
- **Coupure.** Par grand froid, le programme met **D6 à 1** : Q3 (2N7002, VGS(th) de 1 à 2,5 V, donc passant sous 3,3 V) relie EN à la masse et U4 coupe le 5 V. Simulateur : VBUS = 0 V, courant de charge nul.
- **R10 et les 50 µA.** Pendant la coupure, R10 se retrouve entre le 5 V et la masse (à travers Q3) : 5 V / 100 kΩ = **50 µA** au plus (simulateur : 48,9 µA sous 4,89 V). Ce courant est fourni par le chargeur, pas par la batterie, et ne dure que pendant la coupure. Quand U4 est passant, EN ne consomme presque rien et R10 ne coûte rien.
- **R11 et la recharge toujours permise carte éteinte.** R11 = 1 MΩ tire la grille de Q3 à 0. Quand le nRF52840 ne commande plus D6 (veille System OFF, démarrage, batterie vide, carte en panne), D6 est en haute impédance : sans R11, la grille flotterait et Q3 pourrait rester passant. Avec R11, Q3 est bloqué et U4 passant : **carte éteinte, la recharge reste toujours possible**. C'est voulu : sinon, une batterie vidée jusqu'à la coupure de sa protection ne pourrait plus jamais se recharger, puisque le programme ne démarrerait pas pour relâcher la coupure. Le simulateur le vérifie (test « carte endormie ou éteinte : la coupure se relâche toute seule »).
- **Pourquoi 1 MΩ pour R11.** Tant que D6 est à 1, R11 consomme 3,3 V / R11 sur la batterie. Avec 100 kΩ (première version du 24/10/2026), c'était **33 µA** : boîtier éveillé, radio coupée et recharge coupée, la batterie fournissait 0,054 mA au lieu de 0,020 mA. Avec **1 MΩ**, ce n'est plus que **3,3 µA** (simulateur : 3,30 µA, batterie à 0,024 mA). La grille d'un MOSFET ne consomme pas de courant continu : 1 MΩ suffit largement à la tenir à 0 quand D6 est en haute impédance (la fuite de grille du 2N7002 est inférieure à 100 nA, soit moins de 0,1 V sur 1 MΩ, loin de son seuil de 1 V).
- **Avant la veille**, le programme relâche la coupure (D6 à 0). Si le câble est toujours branché, le 5 V revient, réveille le nRF52840 (détection de VBUS, raison « chargeur branché »), qui remesure la température : cycle toutes les 5 min (délai de veille) tant qu'il fait froid, avec de très courtes impulsions de charge. Sur un chargeur bloqué, le boîtier n'écoute plus la radio (voir `bilan-energetique.md`).

C'est une mesure de **sûreté** (protéger la batterie et l'utilisateur d'un accident), pas de sécurité au sens de la cybersécurité : elle ne protège contre aucun attaquant.

### 4.14 Baromètre BMP280 (U3)

Le BMP280 mesure la pression de l'air (300 à 1 100 hPa, ±1 hPa) et la température (±1 °C). Il est placé sous un **évent Ø 3 mm** du fond du boîtier, fermé par une pastille de membrane ePTFE (l'air passe, l'eau non) : sans évent, il mesurerait l'air enfermé à la fermeture et ne verrait jamais l'altitude (`boitier-3d/README.md`). Il sert à corriger l'erreur d'altitude des capteurs TPMS (qui retirent 1 013,25 hPa fixes : à 1 500 m, 846 hPa, ils annoncent 0,17 bar de moins qu'un manomètre), à décider si la recharge est permise (§ 4.13) et à allonger l'attente de l'écran par temps froid (§ 4.15).

- **Bus SPI partagé avec l'écran.** SCL sur SCK (D8), SDA sur MOSI (D10), SDO sur MISO (D9, réservée par le bus SPI et inutilisée jusque-là), CSB sur D0. L'écran et le baromètre ont chacun leur broche de sélection (D3 et D0) : un seul est actif à la fois. CSB est à 1 au repos (baromètre non sélectionné) ; SDO est en haute impédance hors lecture.
- **Alimentation** : +3V3 (le BMP280 accepte 1,71 à 3,6 V). La carte GY-BMP280 choisie est la version **3,3 V à 6 broches**, sans régulateur ni adaptateur de niveau (**à vérifier** à la réception).
- **Consommation** (fiche Bosch) : **0,1 µA en sommeil** ; 2,74 µA en moyenne pour une mesure par seconde en mode basse consommation. Le programme fait **une mesure toutes les 10 s**, boîtier éveillé : 2,74 / 10 ≈ 0,27 µA, plus le sommeil entre deux mesures, soit **≈ 0,4 µA en moyenne** (valeur arrondie par excès retenue dans `TPMS.CIRCUIT.barometre`). En veille, aucune mesure : 0,1 µA.
- **Effet sur l'autonomie** : 0,1 µA × 22,8 h + 0,4 µA × 1,17 h ≈ **0,003 mAh par jour** pour la journée type, soit 0,04 % des 7,06 mAh/jour : négligeable (§ 4.12).

### 4.15 Écran sans fil BUSY : attente fixe

La broche BUSY de l'écran signalait la fin d'un rafraîchissement. Elle n'est plus câblée (D0 sert au baromètre) : le programme attend une **durée fixe**, choisie plus longue que le vrai rafraîchissement (`TPMS.attenteEcranMs`, `logique/barometre.js`) : **2,5 s** pour un complet et **0,6 s** pour un partiel, multipliées par **1,5 sous 10 °C** et par **2 sous 0 °C** (ou si la température est inconnue), car le contrôleur SSD1681 choisit des formes d'onde plus lentes au froid. Exemple : sous 0 °C, 5 s pour un complet et 1,2 s pour un partiel.

Ces durées sont des **hypothèses** : il faut mesurer BUSY à l'oscilloscope **avant de couper le fil**, à 20 °C, au réfrigérateur puis au congélateur, et garder au moins 30 % de marge (`firmware/README.md`). Pendant l'attente (`delay()`), le processeur dort : l'attente ne coûte presque rien en énergie (voir `bilan-energetique.md`).

---

## 5. Comment le simulateur calcule le circuit

`TPMS.circuitResoudre(entrees, lipo)` reçoit l'état des organes (veille, radio, écran, LED, buzzer, reed, boutons, câble de recharge, commande de la coupure de recharge) et rend la tension de chaque nœud et le courant de chaque composant, avec les mêmes repères que le schéma.

1. **Point de fonctionnement.** Le courant tiré fait baisser la tension de la batterie (résistance interne), et cette tension change le courant des LED blanches et la sortie du régulateur. Le calcul est donc refait en boucle jusqu'à ce que plus rien ne bouge (méthode du point fixe, 2 à 5 tours).
2. **Composants non linéaires.** Une LED suit la loi VF = n·Vt·ln(1 + I/Is) + Rs·I. Pour trouver le courant dans « résistance + LED », on cherche I tel que R·I + VF(I) = U, par la méthode de Newton protégée par un encadrement (dichotomie si un pas sort de l'encadrement).
3. **MOSFET.** Bloqué si VGS < VGS(th), sinon résistance RDS(on) qui dépend de VGS, avec une limite de courant (saturation) si la grille est trop basse.
4. **Batterie** (`lipo.js`) : tension à vide selon l'état de charge, résistance interne et polarisation (la tension remonte quand le courant s'arrête), effet du froid, autodécharge, protection.

Tableau des hypothèses principales :

| Grandeur | Valeur | Source |
|---|---|---|
| nRF52840 System OFF | 0,6 µA | fiche Nordic (0,4 µA) + détection de broche |
| nRF52840 réception BLE | 4,6 mA + 0,4 mA de traitement | fiche Nordic (DC/DC, 1 Mbit/s) |
| nRF52840 émission 0 dBm | 4,8 mA en salve, 0,25 mA en moyenne connecté | fiche Nordic ; `energie.js` |
| Tirage interne | 13 kΩ (11 à 16 kΩ) | fiche Nordic |
| Sortie forte | ≈ 30 Ω équivalents | fiche Nordic (VOH ≥ VDD − 0,4 V à 5 mA) |
| E-paper | 3 mA en rafraîchissement, 0,8 µA en sommeil | fiche SSD1681 / GDEY0154D67, **hypothèse** |
| Régulateur | 3,3 V, 1 µA de repos, chute 10 mV + 1,5 Ω × I | **hypothèse** (référence à lire sur le schéma Seeed) |
| Diode carte VBUS → régulateur | 0,3 V | **hypothèse** |
| LED rouge | 1,85 V à 5 mA, n = 2, Rs = 8 Ω | fiches LED 3 mm, **hypothèse** |
| LED blanche | 2,95 V à 5 mA, n = 3,5, Rs = 12 Ω | fiches LED 3 mm, **hypothèse** |
| AO3400A | VGS(th) 1,05 V, RDS(on) 31 mΩ à 3,3 V | fiche Alpha & Omega |
| Buzzer | 132 Ω équivalents (25 mA sous 3,3 V) | fiche (≤ 30 mA à 3 V), `energie.js` |
| SS14 | 0,32 V à 100 mA | fiche (≤ 0,5 V à 1 A), **hypothèse** |
| LiPo | 0,18 Ω, courbe 3,0 – 4,2 V, 3 %/mois | fiches 503035, **hypothèse** |
| Chargeur | 100 mA, 4,20 V, fin à 10 % | fiche TI BQ25101, wiki Seeed |
| BMP280 (U3) | 0,1 µA en sommeil, 0,4 µA en moyenne éveillé (1 mesure / 10 s) | fiche Bosch (2,74 µA à 1 mesure par seconde) |
| TPS22918 (U4) | RON 52 mΩ, repos 8 µA passant, 0,5 µA bloqué | fiche TI, **hypothèse** |
| 2N7002 (Q3) | passant au-dessus de 2,5 V de grille | fiche (VGS(th) 1 à 2,5 V) |

---

## 6. À vérifier à la réception du matériel

1. **Schéma Seeed du XIAO nRF52840** : référence du régulateur, présence d'une diode entre VBUS et le régulateur, valeurs du pont de mesure, polarité de P0.13 et P0.17, broche TS du BQ25101.
2. **Tension de coupure de la protection de la LiPo** : décharger lentement la batterie sous surveillance (multimètre) et noter la tension à laquelle elle se coupe (entre 2,4 et 3,0 V selon le circuit). Reporter la valeur dans `TPMS.LIPO.seuilSurdechargeV`.
3. **VF des LED** à 5 mA, avec le kit reçu (alimentation de laboratoire + résistance de 150 Ω). Ajuster `TPMS.CIRCUIT.leds`.
4. **Courant du buzzer** sous 3,3 V : il varie beaucoup d'un modèle à l'autre.
5. **Consommations** à l'oscilloscope, avec une résistance de 10 Ω en série dans le fil de la batterie : veille, éveillé, écoute, rafraîchissement, bip, éclairage. Reporter les mesures dans `logique/energie.js` et `TPMS.CIRCUIT.nrf`.
6. **Courbe de décharge réelle** de la LiPo : relever VBAT toutes les heures avec le programme, et comparer à `TPMS.LIPO.courbeOcv`.
7. **Tension de D5 avec SW2 appuyé** (attendue : 0,40 à 0,55 V) et réveil de la veille par chacun des deux boutons.
8. **Fil BUSY, avant de le couper** : durée réelle d'un rafraîchissement complet et d'un partiel à 20 °C, 5 °C et −18 °C, pour régler les attentes du § 4.15.
9. **Baromètre et recharge** : pression lue comparée à une station météo proche ; boîtier refroidi au réfrigérateur puis branché : absence de courant de charge (multimètre en série sur le câble), puis reprise vers 5 °C. Courant de repos de U4 et chute de tension à 100 mA.

## 7. Composants à ajouter à la commande

La demande d'achat initiale ne contient ni les MOSFET ni les composants passifs. Il faut ajouter : 2 × AO3400A (ou 2N7002), 1 × 1N4148, 1 × SS14, résistances 270 Ω, 2 × 100 Ω, 2 × 100 kΩ, 2 × 150 Ω, 1 kΩ, condensateurs 10 µF et 100 nF, un connecteur 2 points pour le câble du reed. En option : 1 MΩ et 10 nF.

Depuis la révision C (24/10/2026), en plus : 1 carte GY-BMP280 (3,3 V, 6 broches, SPI), 1 × TPS22918 (SOT-23-6), 1 × 2N7002, 1 × 100 kΩ (R10), 1 × 1 MΩ (R11), 1 × 2,2 kΩ (R12) et 1 pastille autocollante de membrane ePTFE Ø 10 mm pour l'évent.
