# Bilan énergétique

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».

Objectif du cahier des charges (ENF-01) : **autonomie du boîtier d'au moins une semaine**, en visant plusieurs semaines.

Toutes les valeurs de ce document viennent de `logique/energie.js`. Les chiffres des calculs ont été obtenus en **exécutant** les fonctions `TPMS.bilanJournee`, `TPMS.consoInstantaneeMa` et `TPMS.dureeViePileCapteurJours` avec Node.js, et non recopiés à la main. Le matériel n'étant pas encore reçu, les consommations sont des **hypothèses** tirées des fiches techniques ; le § 7 décrit comment les mesurer.

Unités : courant en mA, charge en mAh (1 mAh = 3,6 C = 3 600 mA·s). Pour les événements brefs (rafraîchir l'écran, biper), on raisonne en **charge par événement**, en mA·s : courant × durée.

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
| Écoute radio par **fenêtres** : 2 s toutes les 5 s | `ecouteFenetreMs`, `ecoutePeriodeMs` dans `TPMS.creerBoitier` ; `TPMS.boitierEcoute` | La radio, premier poste de consommation hors éclairage, ne fonctionne que 40 % du temps éveillé |
| Écran rafraîchi **au plus toutes les 2 s** en roulant, et **seulement si l'image change** | `periodeEcranMs` ; `TPMS.ecransDifferents` dans `TPMS.boitierMiseAJour` | Pas de rafraîchissement inutile ; à l'arrêt, l'écran ne consomme rien |
| **Hystérésis** de 0,03 bar sur la pression affichée | `TPMS.HYSTERESIS_AFFICHAGE_BAR` | Le bruit du capteur (±0,01 bar) ne provoque pas de rafraîchissement |
| **Veille** après 5 min sans tour de roue ni appui | `delaiVeilleMs` ; `TPMS.boitierMiseAJour` | Le boîtier passe à 5 µA ; réveil par la roue ou un bouton |

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
| Fenêtre d'écoute / période | 2 000 ms / 5 000 ms |
| Période d'écran en roulant | 2 000 ms |
| Délai avant veille | 5 min (300 000 ms) |

### 3.2 Calcul détaillé (`TPMS.bilanJournee`)

**Durée d'éveil.** Le boîtier est éveillé pendant le roulage, puis pendant le délai de veille après chaque sortie :

heures d'éveil = 1 + 2 × 5 min = 1 + 0,1667 = **1,1667 h** ; heures de veille = 24 − 1,1667 = **22,833 h**.

**Écran.** En roulant, un rafraîchissement toutes les 2 s au plus : 3 600 / 2 = **1 800 rafraîchissements** par heure de roulage. Hypothèse pessimiste : en roulant, la vitesse change sans arrêt, donc l'image change à chaque fois. Charge moyenne par rafraîchissement, en comptant un complet pour 20 partiels : 1,5 + 6 / 20 = 1,8 mA·s.

| Poste | Calcul | mAh par jour | Part |
|---|---|---|---|
| Veille | 22,833 h × 0,005 mA | 0,114 | 1,9 % |
| Processeur éveillé | 1,1667 h × 0,02 mA | 0,023 | 0,4 % |
| Écoute radio des capteurs | 1,1667 h × (2/5) × 5 mA | 2,333 | 39,6 % |
| Écran e-paper | 1 800 × 1,8 mA·s / 3 600 | 0,900 | 15,3 % |
| Éclairage LED | 0,25 h × 10 mA | 2,500 | 42,4 % |
| Liaison avec l'app | 0,1 h × 0,25 mA | 0,025 | 0,4 % |
| Alertes (bip + LED) | 0 alerte | 0,000 | 0 % |
| **Total** | | **5,896 mAh/jour** | 100 % |

### 3.3 Autonomie

autonomie = 450 mAh / 5,896 mAh par jour = **76,3 jours**, soit environ 11 semaines.

L'exigence ENF-01 (≥ 7 jours) est respectée avec une marge d'un facteur 10 environ, **selon le modèle**. Le test « énergie : autonomie supérieure à 1 semaine (cahier des charges) » de `simulateur/tests/tests.js` vérifie ce résultat, et le test « énergie : poste radio » vérifie le calcul du poste radio (1,1667 h × 40 % × 5 mA = 2,33 mAh).

Deux postes représentent à eux seuls 82 % de la consommation : **l'écoute radio** et **l'éclairage**. Ce sont eux qu'il faudra mesurer en priorité.

---

## 4. Influence des réglages

Chaque ligne modifie un seul paramètre du profil de base ; les autres restent identiques.

### 4.1 Fenêtre d'écoute radio (période de 5 s)

| Fenêtre | Part du temps en écoute | Poste radio (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|---|
| 1 s | 20 % | 1,167 | 4,729 | 95,2 jours |
| **2 s (défaut)** | **40 %** | **2,333** | **5,896** | **76,3 jours** |
| 3 s | 60 % | 3,500 | 7,063 | 63,7 jours |
| 5 s (écoute continue) | 100 % | 5,833 | 9,396 | 47,9 jours |

Une fenêtre plus courte économise de l'énergie, mais le boîtier entend moins de trames : avec une annonce toutes les 3 s, une fenêtre de 2 s ne contient pas toujours une annonce. Le délai « capteur perdu » de 60 s et la mesure d'historique toutes les 30 s le tolèrent. L'écoute par fenêtres a aussi eu une conséquence sur la sécurité : elle a révélé une faille, corrigée depuis, décrite au § 6.4 de `analyse-de-risques.md`.

### 4.2 Période de rafraîchissement de l'écran en roulant

| Période | Poste écran (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|
| 1 s | 1,800 | 6,796 | 66,2 jours |
| **2 s (défaut)** | **0,900** | **5,896** | **76,3 jours** |
| 5 s | 0,360 | 5,356 | 84,0 jours |

### 4.3 Éclairage

| Éclairage par jour | Poste éclairage (mAh/j) | Total (mAh/j) | Autonomie |
|---|---|---|---|
| 0 | 0 | 3,396 | 132,5 jours |
| **15 min (défaut)** | **2,5** | **5,896** | **76,3 jours** |
| 1 h | 10 | 13,396 | 33,6 jours |
| 2 h | 20 | 23,396 | 19,2 jours |

L'éclairage est le poste le plus sensible : 2 h d'éclairage par jour divisent l'autonomie par 4. Elle reste cependant supérieure à une semaine.

### 4.4 Délai avant veille, roulage, alertes

| Variante | Total (mAh/j) | Autonomie |
|---|---|---|
| Veille après 30 s | 5,594 | 80,5 jours |
| Veille après 1 h (maximum autorisé par `TPMS.verifierReglages`) | 9,590 | 46,9 jours |
| 2 h de roulage par jour | 8,811 | 51,1 jours |
| 5 alertes par jour (bip + 60 s de LED clignotante chacune) | 6,117 | 73,6 jours |

### 4.5 Cas défavorable

2 h de roulage, 2 h d'éclairage et radio en écoute continue : **32,8 mAh/jour**, soit **13,7 jours**. Même dans ce cas, l'exigence d'une semaine est tenue.

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
| Journée type + reed fermé 24 h sur 24 | 5,896 + 6,0 = 11,9 mAh/j | 37,8 jours |

L'autonomie reste supérieure à une semaine, mais elle est **divisée par deux** dans le cas de la journée type. Pistes pour le firmware (non encore réalisées) :

- utiliser une résistance de tirage externe de forte valeur à la place de la résistance interne : avec 1 MΩ, le courant tombe à 3,3 µA ;
- détecter qu'aucun top n'est arrivé alors que l'entrée reste à 0 depuis plusieurs secondes, puis désactiver la résistance de tirage avant la mise en veille ;
- à vérifier sur le nRF52840 : le réveil depuis la veille se fait sur un **niveau** de l'entrée. Si le reed est fermé au moment de la mise en veille, il faudra configurer le réveil sur le niveau opposé, sinon le boîtier risque de se réveiller aussitôt.

---

## 7. Limites du modèle

- Les consommations sont des valeurs de fiches techniques ou des estimations, pas des mesures.
- Ne sont pas modélisés : l'autodécharge de la LiPo, le courant de repos du régulateur et du circuit de charge de la carte XIAO, un éventuel pont diviseur de mesure de la tension batterie, la consommation de l'écran au repos s'il n'est pas mis hors tension.
- En roulant, le modèle suppose que l'écran change toutes les 2 s (hypothèse pessimiste).
- Le modèle de journée ne compte pas le cas du reed resté fermé (traité à part au § 6).

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

Réglages de l'oscilloscope : couplage DC, limitation de bande passante à 20 MHz pour réduire le bruit, mode moyenne ou haute résolution si disponible, base de temps adaptée à l'événement (1 s/div pour voir les fenêtres d'écoute de 2 s toutes les 5 s, 100 ms/div pour un rafraîchissement d'écran).

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
| Écoute radio | `radioEcouteMa` = 5 mA | Oscilloscope, shunt 10 Ω, hauteur du plateau pendant la fenêtre de 2 s |
| Rafraîchissement partiel / complet | 1,5 / 6 mA·s | Intégration (§ 8.3) |
| Bip | 9 mA·s | Intégration, shunt 1 Ω |
| LED d'éclairage | 10 mA | Shunt 1 Ω ou multimètre |
| Annonce d'un capteur TPMS | 0,025 mA·s | Difficile : la pile est dans le bouchon de valve. Possibilité à étudier : alimenter un capteur ouvert par une alimentation de laboratoire à travers un shunt |

### 8.5 Validation globale

Une fois les valeurs mesurées reportées dans `logique/energie.js`, le bilan est recalculé automatiquement (tests et section §5 du simulateur). Pour une validation de bout en bout sans attendre deux mois : charger complètement la LiPo, faire fonctionner le boîtier en écoute radio continue (environ 5 mA, soit environ 90 h pour 450 mAh selon le modèle), relever la tension de la batterie à intervalles réguliers et comparer la durée obtenue à la prévision.
