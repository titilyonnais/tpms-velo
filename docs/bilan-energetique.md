# Bilan énergétique

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».

Objectif du cahier des charges (ENF-01) : **autonomie du boîtier d'au moins une semaine**, en visant plusieurs semaines.

Toutes les valeurs de ce document viennent de `logique/energie.js`. Les chiffres des calculs ont été obtenus en **exécutant** les fonctions `TPMS.bilanJournee`, `TPMS.consoInstantaneeMa` et `TPMS.dureeViePileCapteurJours` avec Node.js, et non recopiés à la main. Le matériel n'étant pas encore reçu, les consommations sont des **hypothèses** tirées des fiches techniques ; le § 8 décrit comment les mesurer.

Unités : courant en mA, charge en mAh (1 mAh = 3,6 C = 3 600 mA·s). Pour les événements brefs (rafraîchir l'écran, biper), on raisonne en **charge par événement**, en mA·s : courant × durée.

**Mise à jour du 24/10/2026** (révision C du schéma électrique) : baromètre BMP280, écran sans fil BUSY et coupure de la recharge par grand froid. Le baromètre n'est **pas encore compté** dans `logique/energie.js` : c'est un poste à ajouter (§ 3.5). Conclusion : **l'autonomie annoncée ne change pas** (63,7 jours pour la journée type).

---

## 1. Consommations par état du boîtier

### 1.1 Consommations continues (`TPMS.CONSO`)

| État ou organe | Courant | Source ou hypothèse (commentaire du code) |
|---|---|---|
| Veille (`veilleMa`) | 0,005 mA (5 µA) | nRF52840 en mode System OFF, réveil par le reed ; ordre de grandeur annoncé par Seeed pour le XIAO |
| Éveillé, radio coupée (`reposMa`) | 0,02 mA | Processeur entre deux fenêtres d'écoute |
| Écoute radio BLE (`radioEcouteMa`) | 5 mA | Réception BLE ≈ 4,6 mA avec le convertisseur DC/DC (fiche nRF52840), plus le processeur |
| Liaison avec l'application (`liaisonAppMa`) | 0,25 mA | Téléphone connecté, intervalle de connexion de 100 ms |
| LED d'éclairage (`ledsEclairageMa`) | 10 mA | 2 LED blanches × 5 mA |
| LED d'alerte (`ledAlerteMa`) | 2,5 mA en moyenne | LED rouge à 5 mA, clignotante (50 %) ; 5 mA si fixe |
| Reed resté fermé (`reedColleMa`) | 0,25 mA | 3,3 V dans la résistance de tirage de 13 kΩ (voir § 6) |

### 1.2 Charges par événement

| Événement | Charge | Hypothèse |
|---|---|---|
| Rafraîchissement partiel de l'e-paper (`ecranPartielMas`) | 1,5 mA·s | ≈ 3 mA pendant 0,5 s |
| Rafraîchissement complet (`ecranCompletMas`) | 6 mA·s | ≈ 3 mA pendant 2 s |
| Bip d'alerte (`bipMas`) | 9 mA·s | Buzzer 25 mA pendant 3 × 0,12 s |

Un rafraîchissement complet a lieu toutes les 20 mises à jour partielles (`TPMS.PARTIELS_AVANT_COMPLET`, `simulateur/boitier/boitier.js`), pour effacer les traces d'image (« ghosting »). Une image affichée sur l'e-paper ne consomme plus rien.

### 1.3 Batterie et piles

| Élément | Valeur | Constante |
|---|---|---|
| Batterie du boîtier | LiPo 500 mAh | `TPMS.LIPO_MAH` |
| Part utilisable | 90 % (on ne vide pas une LiPo complètement), soit **450 mAh** | `TPMS.LIPO_UTILE` |
| Pile d'un capteur | CR1632, 130 mAh | `TPMS.CR1632_MAH` |

### 1.4 Courant instantané dans quelques situations

Calculé avec `TPMS.consoInstantaneeMa` :

| Situation | Courant |
|---|---|
| Veille | 0,005 mA |
| Éveillé, radio coupée | 0,02 mA |
| Éveillé, radio en écoute | 5,02 mA |
| Radio + éclairage | 15,02 mA |
| Radio + éclairage + app connectée + LED d'alerte fixe | 20,27 mA |
| Veille avec le reed resté fermé | 0,255 mA |

---

## 2. Les choix qui économisent l'énergie

| Choix | Où | Effet |
|---|---|---|
| Écoute radio par **fenêtres** : 3 s toutes les 5 s, à une position qui change d'une période à l'autre ; écoute continue de 15 s seulement quand une trame est douteuse | `ecouteFenetreMs`, `ecoutePeriodeMs` dans `TPMS.creerBoitier` ; `TPMS.boitierEcoute`, `TPMS.ECOUTE_RENFORCEE_MS` | La radio, premier poste de consommation, ne fonctionne que 60 % du temps éveillé |
| Écran rafraîchi **au plus toutes les 2 s** en roulant, et **seulement si l'image change** | `periodeEcranMs` ; `TPMS.ecransDifferents` dans `TPMS.boitierMiseAJour` | Pas de rafraîchissement inutile ; à l'arrêt, l'écran ne consomme rien |
| **Hystérésis** de 0,03 bar sur la pression affichée | `TPMS.HYSTERESIS_AFFICHAGE_BAR` | Le bruit du capteur (±0,01 bar) ne provoque pas de rafraîchissement |
| **Veille** après 5 min sans tour de roue ni appui | `delaiVeilleMs` ; `TPMS.boitierMiseAJour` | Le boîtier passe à 5 µA ; réveil par la roue, un bouton ou l'arrivée du 5 V du chargeur |
| **Baromètre** lu toutes les 10 s seulement, boîtier éveillé | `TPMS.PERIODE_BAROMETRE_MS` | ≈ 0,4 µA en moyenne, 0,1 µA en veille (§ 3.5) |
| **Pas d'écoute radio sur un chargeur bloqué** par le froid | `TPMS.boitierEcoute` (`surChargeur`) | 0,05 mA au lieu de 3 mA tant que la recharge est coupée (§ 4.7) |

---

## 3. Journée type

### 3.1 Profil

| Paramètre | Valeur |
|---|---|
| Durée de roulage | 1 h |
| Nombre de sorties | 2 |
| Éclairage | 15 min (0,25 h) |
| Application connectée | 6 min (0,1 h) |
| Alertes | 0 |
| Fenêtre d'écoute / période | 3 000 ms / 5 000 ms |
| Période d'écran en roulant | 2 000 ms |
| Délai avant veille | 5 min (300 000 ms) |

### 3.2 Calcul détaillé (`TPMS.bilanJournee`)

**Durée d'éveil.** Le boîtier est éveillé pendant le roulage, puis pendant le délai de veille après chaque sortie :

heures d'éveil = 1 + 2 × 5 min = 1 + 0,1667 = **1,1667 h** ; heures de veille = 24 − 1,1667 = **22,833 h**.

**Écran.** En roulant, un rafraîchissement toutes les 2 s au plus : 3 600 / 2 = **1 800 rafraîchissements** par heure de roulage. Hypothèse pessimiste : en roulant, la vitesse change sans arrêt, donc l'image change à chaque fois. Charge moyenne par rafraîchissement, en comptant un complet pour 20 partiels : 1,5 + 6 / 20 = 1,8 mA·s.

| Poste | Calcul | mAh par jour | Part |
|---|---|---|---|
| Veille | 22,833 h × 0,005 mA | 0,114 | 1,6 % |
| Processeur éveillé | 1,1667 h × 0,02 mA | 0,023 | 0,3 % |
| Écoute radio des capteurs | 1,1667 h × (3/5) × 5 mA | 3,500 | 49,6 % |
| Écran e-paper | 1 800 × 1,8 mA·s / 3 600 | 0,900 | 12,7 % |
| Éclairage LED | 0,25 h × 10 mA | 2,500 | 35,4 % |
| Liaison avec l'app | 0,1 h × 0,25 mA | 0,025 | 0,4 % |
| Alertes (bip + LED) | 0 alerte | 0,000 | 0 % |
| **Total** | | **7,063 mAh/jour** | 100 % |

### 3.3 Autonomie

autonomie = 450 mAh / 7,063 mAh par jour = **63,7 jours**, soit environ 9 semaines.

L'exigence ENF-01 (≥ 7 jours) est respectée avec une marge d'un facteur 9 environ, **selon le modèle**. Le test « énergie : autonomie supérieure à 1 semaine (cahier des charges) » de `simulateur/tests/tests.js` vérifie ce résultat, et le test « énergie : poste radio » vérifie le calcul du poste radio (1,1667 h × 60 % × 5 mA = 3,5 mAh).

Deux postes représentent à eux seuls 85 % de la consommation : **l'écoute radio** et **l'éclairage**. Ce sont eux qu'il faudra mesurer en priorité.

### 3.4 Pourquoi une fenêtre de 3 s plutôt que 2 s

La fenêtre de 2 s donnait 76,3 jours. Mais la fenêtre doit maintenant changer de position d'une période à l'autre (voir § 4.1), et avec 2 s à position variable, le pire délai d'alerte d'une crevaison montait à 34 s. On accepte donc de perdre 12,6 jours d'autonomie (1,167 mAh/jour de plus) parce que la fenêtre de 3 s, avec l'écoute renforcée, ramène ce pire délai à 9 s (mesures détaillées au § 6.5 de `analyse-de-risques.md`). Une fenêtre de 3 s dure au moins une période d'annonce d'un capteur en roulage (3 s) : chaque fenêtre entend donc forcément le capteur.

L'écoute renforcée (15 s de radio continue après une trame douteuse) n'est pas comptée dans ce bilan : elle ne se déclenche que lors d'un événement rare (crevaison, regonflage, attaque). Une écoute renforcée coûte au plus 15 s × 5 mA × 40 % (part du temps où la radio aurait été coupée) = 30 mA·s ≈ 0,008 mAh, soit environ 0,1 % de la journée type.

### 3.5 Baromètre BMP280 : poste à ajouter à `energie.js`

Le baromètre ajouté le 24/10/2026 (U3, `schema-electrique.md` § 4.14) n'apparaît **pas** dans `TPMS.CONSO` ni dans `TPMS.bilanJournee` : il est seulement compté dans le circuit simulé (`TPMS.CIRCUIT.barometre`). Le code n'a pas été modifié ; il faudra y ajouter ce poste.

| Grandeur | Valeur | Source |
|---|---|---|
| Sommeil (boîtier en veille, aucune mesure) | **0,1 µA** | fiche Bosch BMP280 |
| Une mesure toutes les 10 s, boîtier éveillé | **≈ 0,4 µA en moyenne** | fiche Bosch : 2,74 µA pour une mesure par seconde, soit ≈ 0,27 µA pour une toutes les 10 s, plus le sommeil, arrondi par excès |

Pour la journée type (22,833 h de veille, 1,1667 h d'éveil) : 22,833 h × 0,1 µA + 1,1667 h × 0,4 µA = **0,003 mAh par jour** (calcul exécuté avec Node.js), soit 0,04 % des 7,063 mAh/jour. L'autonomie passe de 63,72 à 63,69 jours : **elle reste de 63,7 jours**. Le circuit simulé, avec et sans le baromètre, donne la même autonomie au jour près ; seule la veille seule perd 12 jours sur environ 4 ans (1 478 jours au lieu de 1 490, `schema-electrique.md` § 4.12).

### 3.6 Écran sans fil BUSY : l'attente fixe ne coûte presque rien

Le fil BUSY de l'écran, qui signalait la fin d'un rafraîchissement, est supprimé pour libérer une broche (D0 sélectionne maintenant le baromètre). Le programme attend une durée fixe, plus longue que le vrai rafraîchissement : 2,5 s pour un complet et 0,6 s pour un partiel, × 1,5 sous 10 °C et × 2 sous 0 °C (`TPMS.attenteEcranMs`, **hypothèses** à mesurer à l'oscilloscope avant de couper le fil).

Pendant cette attente (`delay()`), **le processeur dort** : il consomme comme « éveillé, radio coupée » (0,02 mA), et l'écran a fini son rafraîchissement bien avant la fin de l'attente. La charge réelle d'un rafraîchissement reste donc celle du § 1.2. Pour borner l'erreur, cas très pessimiste où l'écran tirerait 3 mA pendant **toute** l'attente (calcul exécuté avec `TPMS.bilanJournee` en remplaçant les charges par événement) :

| Hypothèse | Poste écran (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|
| **Modèle actuel** (0,5 s / 2 s à 3 mA) | **0,900** | **7,063** | **63,7 jours** |
| 3 mA pendant toute l'attente, à 20 °C (0,6 s / 2,5 s) | 1,087 | 7,250 | 62,1 jours |
| 3 mA pendant toute l'attente, sous 0 °C (1,2 s / 5 s) | 2,175 | 8,338 | 54,0 jours |

Même dans ce cas pessimiste, l'exigence d'une semaine est largement tenue. Le vrai prix de l'attente fixe n'est pas l'énergie mais le temps : un rafraîchissement complet bloque `loop()` jusqu'à 2,5 s (5 s sous 0 °C) ; la LED et le buzzer gardent leur rythme grâce à leur tâche de fond.

---

## 4. Influence des réglages

Chaque ligne modifie un seul paramètre du profil de base ; les autres restent identiques.

### 4.1 Fenêtre d'écoute radio (période de 5 s)

| Fenêtre | Part du temps en écoute | Poste radio (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|---|
| 1 s | 20 % | 1,167 | 4,729 | 95,2 jours |
| 2 s | 40 % | 2,333 | 5,896 | 76,3 jours |
| **3 s (défaut)** | **60 %** | **3,500** | **7,063** | **63,7 jours** |
| 5 s (écoute continue) | 100 % | 5,833 | 9,396 | 47,9 jours |

Une fenêtre plus courte économise de l'énergie, mais le boîtier entend moins de trames : avec une annonce toutes les 3 s, une fenêtre de 2 s ne contient pas toujours une annonce, et une crevaison est signalée plus tard (§ 3.4).

La position de la fenêtre dans la période de 5 s change à chaque période (pseudo-hasard calculé à partir du numéro de période, `TPMS.melangerEntier`). Avec une fenêtre toujours au même endroit, un capteur garé, qui n'annonce plus qu'une fois par minute (un multiple de 5 s), retombait toujours au même moment du cycle : s'il tombait hors de la fenêtre, il n'était jamais entendu, et le boîtier affichait une fausse alerte « capteur perdu ». Ce défaut (verrouillage de phase) a été révélé par la simulation d'une semaine. Il ne change pas la consommation.

L'écoute par fenêtres a aussi eu une conséquence sur la sécurité : elle a révélé une faille, corrigée depuis, décrite au § 6.4 de `analyse-de-risques.md`.

### 4.2 Période de rafraîchissement de l'écran en roulant

| Période | Poste écran (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|
| 1 s | 1,800 | 7,963 | 56,5 jours |
| **2 s (défaut)** | **0,900** | **7,063** | **63,7 jours** |
| 5 s | 0,360 | 6,523 | 69,0 jours |

### 4.3 Éclairage

| Éclairage par jour | Poste éclairage (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|
| 0 | 0 | 4,563 | 98,6 jours |
| **15 min (défaut)** | **2,5** | **7,063** | **63,7 jours** |
| 1 h | 10 | 14,563 | 30,9 jours |
| 2 h | 20 | 24,563 | 18,3 jours |

L'éclairage est le poste le plus sensible : 2 h d'éclairage par jour divisent l'autonomie par 3,5 environ. Elle reste cependant supérieure à une semaine.

### 4.4 Délai avant veille, roulage, alertes

| Variante | Total (mAh/j) | Autonomie |
|---|---|---|
| Veille après 10 s (minimum autorisé par `TPMS.verifierReglages`) | 6,577 | 68,4 jours |
| Veille après 30 s | 6,610 | 68,1 jours |
| Veille après 1 min | 6,661 | 67,6 jours |
| Veille après 15 min | 8,068 | 55,8 jours |
| Veille après 1 h (maximum autorisé par `TPMS.verifierReglages`) | 12,590 | 35,7 jours |
| 2 h de roulage par jour | 10,977 | 41,0 jours |
| 5 alertes par jour (bip + 60 s de LED clignotante chacune) | 7,283 | 61,8 jours |

### 4.5 Cas défavorable

2 h de roulage, 2 h d'éclairage et radio en écoute continue : **32,8 mAh/jour**, soit **13,7 jours**. Même dans ce cas, l'exigence d'une semaine est tenue.

### 4.6 Vérification par la simulation d'une semaine

Le bilan ci-dessus est un calcul à partir de durées moyennes. Le simulateur permet de le recouper avec une semaine complète calculée pas à pas (`simulateur/moteur.js`, planning « semaine type ») : du lundi au vendredi, trajet domicile-travail à 7 h 45 et à 17 h 30 ; samedi à 10 h et dimanche à 9 h 30, une sortie sur le parcours choisi ; dimanche de 20 h à 23 h, boîtier en charge. Le boîtier, la radio, le circuit électrique et la LiPo (avec son autodécharge et son circuit de protection) sont simulés comme pendant une sortie.

Résultats (parcours lyon-ville, 1 semaine, graine 8) :

| Grandeur | Valeur |
|---|---|
| Sorties effectuées | 12, soit 462 min de roulage |
| Temps passé en veille | 94,9 % |
| Temps en alerte | 0 minute |
| Trames acceptées par le boîtier | 8 685 |
| Batterie avant la recharge du dimanche | 92,6 % (≈ 37 mAh consommés en 6,6 jours, soit ≈ 5,6 mAh/jour) |
| Batterie après la recharge | 99,6 % |
| Durée du calcul | ≈ 41 s |

Comparaison avec le modèle : la semaine simulée **ne comporte ni éclairage ni application connectée**. On ne peut donc pas la comparer directement aux 7,063 mAh/jour de la journée type, dont 2,5 mAh viennent de l'éclairage. Avec le profil de la semaine (462 min de roulage et 12 sorties en 6,6 jours, soit 1,17 h et 1,8 sortie par jour, sans éclairage ni application), `TPMS.bilanJournee` donne 5,14 mAh/jour, soit 34 mAh en 6,6 jours. La simulation consomme environ 10 % de plus (37 mAh). L'écart (≈ 0,5 mAh/jour) est du même ordre que les postes que le simulateur ajoute au modèle : autodécharge de la LiPo (≈ 0,5 mAh/jour) et circuit de protection (3 µA, ≈ 0,07 mAh/jour), voir `schema-electrique.md` § 4.12.

La semaine simulée confirme donc l'ordre de grandeur du modèle, sans vérifier le poste éclairage. Elle a surtout servi à révéler des défauts invisibles sur une seule sortie (verrouillage de phase de la fenêtre d'écoute, fausse fuite lente due au refroidissement du pneu, vélo garé qui dévalait la pente), tous corrigés.

### 4.7 Boîtier sur son chargeur par grand froid

Depuis le 24/10/2026, le boîtier coupe sa recharge hors de 2 à 43 °C (température lue par le BMP280, hystérésis de 3 °C : reprise à 5 °C). C'est une mesure de **sûreté** pour la LiPo, détaillée dans `schema-electrique.md` § 4.13. Côté énergie, deux conséquences :

1. **Radio coupée.** Réveillé par le 5 V du chargeur, le boîtier n'est pas sur le vélo : tant que la recharge est coupée, il n'écoute plus les capteurs. Sinon, il tirerait sur sa batterie ≈ 3 mA en moyenne (3/5 × 5 mA + 0,02 mA, calcul avec `TPMS.CONSO`), soit 30 mAh pour une nuit de 10 h, alors qu'il ne peut pas se recharger. La roue ou un bouton rallument l'écoute.
2. **Ce qui reste.** Radio coupée et recharge coupée, le circuit simulé donne **0,024 mA** sur la batterie : 0,020 mA du processeur éveillé, **3,3 µA dans R11** (3,3 V / 1 MΩ tant que D6 est à 1) et 0,4 µA de baromètre. `energie.js` donnerait 0,02 mA : R11 est un poste qu'il ne connaît pas. (Avec la première valeur de R11, 100 kΩ, c'était 0,054 mA : d'où le passage à 1 MΩ.) Les 50 µA de R10 sont pris sur le chargeur, pas sur la batterie.

Avant chaque veille, la coupure est relâchée : le 5 V revient, réveille le boîtier, qui remesure et recoupe. Il en résulte un cycle toutes les 5 min avec une très courte impulsion de charge.

Vérification par le simulateur (`simulateur/moteur.js`, météo « hiver_gel », départ à 6 h, option « recharge dehors », batterie à 50 %, calcul exécuté avec Node.js) :

| Grandeur | Valeur |
|---|---|
| Température du boîtier après 90 min | −5,7 °C |
| Recharge coupée | pendant les 90 min |
| État de charge | 50,0 % → 50,1 % (+0,4 mAh) : la batterie reste stable |
| Heure suivante (pas de 1 s) | 12 impulsions de 5 V d'environ 1 s, une toutes les 5 min ; +0,27 mAh |

La batterie ne se vide donc pas sur un chargeur bloqué : les impulsions de charge compensent un peu plus que la consommation de 0,024 mA. Limite : ces impulsions ont lieu **au froid** (≈ 12 s par heure à 100 mA dans la simulation, dont le pas est de 1 s). Leur durée réelle (démarrage du programme et première mesure du baromètre) est à mesurer à la réception du matériel.

Le même essai avec la recharge à la maison (19 °C) : coupée tant que le boîtier est froid, puis reprise après ≈ 11 min, et batterie rechargée (test « à la maison : reprise une fois réchauffé » de `moteur.tests.js`).

---

## 5. Piles CR1632 des capteurs

Les capteurs sont des produits du commerce : leur consommation n'est pas connue. Le modèle `TPMS.CONSO_CAPTEUR` utilise des valeurs typiques d'un émetteur BLE :

- 2 µA entre deux annonces (`sommeilMa` = 0,002 mA) ;
- 0,025 mA·s par annonce (`annonceMas`), soit environ 25 µC (émission sur 3 canaux et mesure de pression).

Courant moyen = 0,002 + 0,025 / intervalle (en s) ; durée de vie = 130 mAh / courant moyen.

| Intervalle d'annonce | Courant moyen | Durée de vie |
|---|---|---|
| 1 s | 27,0 µA | 201 jours (0,55 an) |
| 2 s | 14,5 µA | 374 jours (1,0 an) |
| **3 s (hypothèse retenue)** | **10,3 µA** | **524 jours (1,4 an)** |
| 5 s | 7,0 µA | 774 jours (2,1 ans) |
| 10 s | 4,5 µA | 1 204 jours (3,3 ans) |
| 30 s | 2,8 µA | 1 912 jours (5,2 ans) |
| 60 s | 2,4 µA | 2 241 jours (6,1 ans) |

Le test « énergie : pile CR1632 de capteur > 1 an » vérifie le cas à 3 s.

Remarques :
- Au-delà d'environ 10 s d'intervalle, le courant de sommeil (2 µA) devient prépondérant et la durée de vie progresse peu.
- Certains capteurs du commerce ralentissent leurs annonces quand la roue ne tourne pas. Si c'est le cas des nôtres, la durée de vie réelle sera plus longue. À observer à la réception.
- Le modèle ne tient pas compte de l'effet du froid sur la capacité de la pile, ni de son autodécharge.

---

## 6. Le piège du reed resté fermé

L'interrupteur reed (ILS) est relié à une entrée du microcontrôleur avec une résistance de tirage (« pull-up ») interne d'environ 13 kΩ. Quand l'aimant passe devant, le contact se ferme et l'entrée passe à 0 V : c'est un top.

Si le vélo s'arrête **avec l'aimant pile devant le reed**, le contact reste fermé et un courant traverse en permanence la résistance de tirage :

I = 3,3 V / 13 kΩ ≈ 0,25 mA (`TPMS.CONSO.reedColleMa`)

C'est **environ 50 fois** le courant de veille (0,255 mA au lieu de 0,005 mA) :

| Situation | Courant en veille | Batterie de 450 mAh vidée en… |
|---|---|---|
| Veille normale | 0,005 mA | 3 750 jours en théorie (l'autodécharge de la LiPo, non modélisée, sera alors le vrai facteur limitant) |
| Veille, reed resté fermé | 0,255 mA | 73,5 jours |
| Journée type + reed fermé 24 h sur 24 | 7,063 + 6,0 = 13,1 mAh/j | 34,4 jours |

L'autonomie reste supérieure à une semaine, mais elle est **presque divisée par deux** dans le cas de la journée type (34,4 jours au lieu de 63,7). Pistes pour le firmware (non encore réalisées) :

- utiliser une résistance de tirage externe de forte valeur à la place de la résistance interne : avec 1 MΩ, le courant tombe à 3,3 µA ;
- détecter qu'aucun top n'est arrivé alors que l'entrée reste à 0 depuis plusieurs secondes, puis désactiver la résistance de tirage avant la mise en veille ;
- à vérifier sur le nRF52840 : le réveil depuis la veille se fait sur un **niveau** de l'entrée. Si le reed est fermé au moment de la mise en veille, il faudra configurer le réveil sur le niveau opposé, sinon le boîtier risque de se réveiller aussitôt.

---

## 7. Limites du modèle

- Les consommations sont des valeurs de fiches techniques ou des estimations, pas des mesures.
- Ne sont pas modélisés : l'autodécharge de la LiPo, le courant de repos du régulateur et du circuit de charge de la carte XIAO, un éventuel pont diviseur de mesure de la tension batterie, la consommation de l'écran au repos s'il n'est pas mis hors tension.
- En roulant, le modèle suppose que l'écran change toutes les 2 s (hypothèse pessimiste).
- Le modèle de journée ne compte pas le cas du reed resté fermé (traité à part au § 6), ni l'écoute renforcée (négligeable, § 3.4).
- Postes du 24/10/2026 absents de `energie.js`, comptés seulement par le circuit simulé : le baromètre BMP280 (0,003 mAh/jour, § 3.5) et R11 pendant une coupure de recharge (3,3 µA, § 4.7). Ils ne changent pas l'autonomie annoncée.

---

## 8. Protocole de mesure réel, sans PPK2

Le lycée ne dispose pas de mesureur de consommation dédié (Nordic PPK2). On utilise le matériel disponible : **oscilloscope**, **résistance de mesure (shunt)** et un multimètre.

### 8.1 Principe

Une résistance de faible valeur R est placée **en série** dans l'alimentation du boîtier. La tension à ses bornes est proportionnelle au courant (loi d'Ohm) : I = U / R. L'oscilloscope affiche donc le courant en fonction du temps.

### 8.2 Montage

```
 LiPo (+) ─────────────────────────────── BAT+ du XIAO
 LiPo (−) ───┬──[ R shunt ]──┬─────────── GND du XIAO
             │               │
        masse sonde      pointe sonde
```

- Shunt **côté masse** (entre le − de la batterie et la masse de la carte) : la masse de la sonde se branche au − de la batterie et la pointe mesure directement U = R × I.
- **Boîtier alimenté uniquement par la LiPo**, câble USB débranché : sinon la masse de l'oscilloscope (reliée à la terre) et celle du PC se retrouvent en parallèle sur le shunt et faussent la mesure.
- Choix du shunt : la chute de tension doit rester faible pour ne pas perturber le régulateur 3,3 V (LiPo entre 3,7 et 4,2 V).

| Grandeur à mesurer | Courant attendu | Shunt conseillé | Tension mesurée |
|---|---|---|---|
| Écoute radio, rafraîchissement de l'e-paper | 3 à 5 mA | 10 Ω (valeur citée dans `logique/energie.js`) | 30 à 50 mV |
| Éclairage, buzzer | 10 à 25 mA | 1 Ω | 10 à 25 mV |
| Veille | 5 µA | — | 50 µV avec 10 Ω : trop faible pour l'oscilloscope |

Le **courant de veille** (et celui du reed resté fermé) se mesure donc au **multimètre en série**, calibre µA : c'est un courant constant, l'oscilloscope n'apporte rien.

Réglages de l'oscilloscope : couplage DC, limitation de bande passante à 20 MHz pour réduire le bruit, mode moyenne ou haute résolution si disponible, base de temps adaptée à l'événement (1 s/div pour voir les fenêtres d'écoute de 3 s toutes les 5 s, dont la position change d'une période à l'autre, 100 ms/div pour un rafraîchissement d'écran).

### 8.3 Mesure de la charge par intégration

Pour un événement bref (rafraîchissement de l'écran, bip), on veut la **charge** Q en mA·s, à comparer aux valeurs de `TPMS.CONSO` :

Q = ∫ I(t) dt = (1/R) × ∫ U(t) dt

Deux méthodes :

1. **Fonction mathématique d'intégration** de l'oscilloscope, si elle existe : lire la valeur de l'intégrale de U à la fin de l'événement (en V·s), diviser par R (en Ω) pour obtenir des A·s, puis multiplier par 1 000 pour des mA·s.
2. **Export des points** (fichier CSV sur clé USB) puis calcul dans un tableur : Q ≈ Σ (Uᵢ / R) × Δt, avec Δt l'intervalle entre deux points. Penser à retrancher le courant de fond (mesuré juste avant l'événement) pour isoler la charge propre à l'événement.

### 8.4 Plan de mesures

| Mesure | Valeur du modèle à vérifier | Méthode |
|---|---|---|
| Courant de veille | `veilleMa` = 0,005 mA | Multimètre, calibre µA |
| Courant reed fermé, en veille | `reedColleMa` = 0,25 mA | Multimètre, aimant maintenu devant le reed |
| Éveillé, radio coupée | `reposMa` = 0,02 mA | Oscilloscope (shunt 10 Ω) entre deux fenêtres, ou multimètre avec un firmware de test qui coupe la radio |
| Écoute radio | `radioEcouteMa` = 5 mA | Oscilloscope, shunt 10 Ω, hauteur du plateau pendant la fenêtre de 3 s |
| Rafraîchissement partiel / complet | 1,5 / 6 mA·s | Intégration (§ 8.3) |
| Bip | 9 mA·s | Intégration, shunt 1 Ω |
| LED d'éclairage | 10 mA | Shunt 1 Ω ou multimètre |
| Boîtier sur un chargeur bloqué par le froid | 0,024 mA sur la batterie (circuit simulé, § 4.7) | Multimètre en série dans le fil de la batterie, boîtier sorti du réfrigérateur et branché |
| Annonce d'un capteur TPMS | 0,025 mA·s | Difficile : la pile est dans le bouchon de valve. Possibilité à étudier : alimenter un capteur ouvert par une alimentation de laboratoire à travers un shunt |

### 8.5 Validation globale

Une fois les valeurs mesurées reportées dans `logique/energie.js`, le bilan est recalculé automatiquement (tests, et carte « Autonomie sur une journée type » de la page Électronique du simulateur). Pour une validation de bout en bout sans attendre deux mois : charger complètement la LiPo, faire fonctionner le boîtier en écoute radio continue (environ 5 mA, soit environ 90 h pour 450 mAh selon le modèle), relever la tension de la batterie à intervalles réguliers et comparer la durée obtenue à la prévision.
