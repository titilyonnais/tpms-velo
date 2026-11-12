# État de l'art, concurrence et réglementation (version industrielle)

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6. Recherche documentaire du 12/11/2026, en complément de l'[orientation industrielle](orientation-industrielle.md) (le besoin, l'architecture et la maquette réseau) et de l'[analyse de risques](analyse-de-risques.md).

**Méthode.** Les pages de fabricants sont des sources commerciales : elles ne valent pas mesure indépendante. Les constructeurs de chariots ne publient pas leurs prix. « Non trouvé » veut dire « non trouvé pendant cette recherche », pas « n'existe pas ».

---

## 1. Ce qu'il faut retenir

1. La **télématique des constructeurs de chariots** suit l'accès par badge, les chocs, les heures, la batterie, la check-list et la vitesse par zones. Aucune des pages consultées (Linde/Fenwick, Toyota, STILL, Jungheinrich, Crown, ELOKON) ne parle de **pression des pneus**.
2. La pression des pneus est vendue **à part**, par des spécialistes (Kalmar, Continental, Goodyear), sur devis et sur des portails fermés. Le créneau du projet : **une chaîne ouverte, peu chère et à la sécurité documentée**, pas une mesure nouvelle.
3. **Accidents** : en France, les chariots automoteurs causent en moyenne **8 300 accidents avec arrêt, 580 avec séquelles et 10 morts par an** ; **un décès sur deux vient d'un renversement latéral** (INRS ED 979). Les essais de stabilité des chariots (ISO 5766, ISO 8379) se font pneus gonflés à la pression du constructeur : la stabilité annoncée suppose la bonne pression.
4. **Seuls les engins à pneus gonflés sont concernés** : chariots frontaux d'extérieur ou mixtes, tout-terrain et télescopiques, engins portuaires, tracteurs de piste. Les chariots d'entrepôt intérieurs roulent en général sur bandages pleins.
5. **Les capteurs de vélo ne suffisent pas** : environ 3,5 bar, contre 9 à 10 bar pour un pneu de chariot frontal (Trelleborg). D'où les capteurs « poids lourd » 0–13 bar de la version industrielle ; le Bosch SMP290 (BLE, jusqu'à 15 bar) montre que cette gamme existe.
6. **Réglementation** : volet cybersécurité de la directive RED en vigueur depuis le **1er août 2025** (normes EN 18031) ; **Cyber Resilience Act** : signalement des vulnérabilités exploitées depuis le **11/09/2026**, application complète le **11/12/2027** ; guides ANSSI sur l'IoT ; recommandations de la CNIL sur la surveillance des salariés.

## 2. Télématique des chariots du commerce

| Solution | Ce qu'elle mesure | Communication | Prix |
|---|---|---|---|
| Linde / Fenwick « connect » | Heures, chocs (avec le conducteur), maintenance, CACES ; vitesse réduite par zones (connect:zi) | GPRS, Bluetooth ou Wi-Fi | Non publié (abonnement) |
| Toyota I_Site | Chocs et score de sécurité, check-list, accès par PIN ou carte, batterie, utilisation | Boîtier en ligne (réseau non précisé) | Non publié (abonnement) |
| Jungheinrich ISM Online | Flotte, accès, productivité ; aussi d'autres marques | Passerelles M2M dans les halls | Non publié |
| STILL FleetManager | Accès par puce ou PIN, détection des chocs | Portail web | Non publié |
| Crown InfoLink (article de 2013) | Chocs, autorisation des caristes, batterie, maintenance | Wi-Fi du site, hébergé avec SSL | « Le prix d'un café par jour et par chariot » |
| ELOKON ELOfleet | Badge, check-lists, chocs, **mode « conducteur anonyme »** | Bluetooth vers smartphone, puis cellulaire ou Wi-Fi | Non publié |

Ordres de grandeur génériques : **13 à 50 $ par engin et par mois**, plus **50 à 200 $** de matériel par boîtier (Hapn, AirPinpoint, GPS Insight, Geotab).

## 3. Surveillance de pression pour engins industriels

| Produit | Engins | Technologie |
|---|---|---|
| Kalmar Tyre Pressure Monitor System | Reach stackers, chariots élévateurs, tracteurs de terminal, cavaliers | Capteurs **Bluetooth** sur chaque pneu, afficheur en cabine, alertes à −12,5 % et −25 % |
| Continental ContiPressureCheck / ContiConnect | Pneus industriels gonflés (jante de 15″ et plus) | Capteur dans le pneu ; **borne fixe qui relève les engins au passage** (Yard) ou boîtier télématique |
| Goodyear DrivePoint Heavy Duty (2023) | Reach stackers, cavaliers, véhicules autoguidés | Capteurs sur la valve ; **récepteurs fixes dans la cour qui lisent au passage** |
| COMATRA TP2AGRIC | Télescopiques, tout-terrain | 4 capteurs de valve, 0,4–7 bar, pile de 5 ans |
| Port de Lyttelton (2013) | 18 cavaliers | Capteurs de valve ; pneu trop bas → vitesse bridée par l'automate |
| Bosch SMP290 (composant) | Véhicules utilitaires | BLE, jusqu'à 15 bar |

Aucun prix n'est publié. Les **récepteurs fixes qui lisent au passage** (Continental, Goodyear) sont exactement le principe des passerelles au plafond de la maquette : le choix d'architecture du projet correspond à ce que fait l'industrie.

## 4. Comparaison

| | Projet (démonstrateur vélo + entrepôt) | SKS Airspy TL | Quarq TyreWiz 2.0 | Télématique de chariots | TPMS industriels |
|---|---|---|---|---|---|
| Coût | 86,61 € TTC de matériel pour le démonstrateur | 59 à 71 € la paire | 129 € la paire | Non publié ; ~13–50 $/mois/engin | Sur devis |
| Pression des pneus | **Oui** | Oui (max 8,3 bar) | Oui | **Non** | Oui |
| Afficheur sans smartphone | **Oui (e-paper)** | Non | Non | Écran du chariot ou portail | Cabine ou lecture au passage |
| Supervision | **Ouverte** : MQTT/TLS, API, page web | Application | Application | Portail propriétaire | Portail propriétaire |
| Réseau | VLAN, pare-feu « tout refusé », TLS mutuel, NTP, syslog (maquette Docker) | — | — | Hébergé (SSL) | Non documenté |
| Sécurité publiée et testée | Analyse de risques, 14 essais réseau, 777 tests JS + 139 C++ | Non | Non | Peu documentée | Non |

**Ce que le projet apporte, dit honnêtement** : une chaîne ouverte, peu chère, qui alerte sans smartphone, dont la sécurité est **documentée et vérifiée**. **Ses limites** : pas de certification, capteurs « poids lourd » non encore choisis, portée radio en entrepôt à mesurer, maquette réseau sur un seul PC.

## 5. Réglementation et référentiels

### 5.1 Directive RED et Cyber Resilience Act

- **RED 2014/53/UE, art. 3.3 (d)(e)(f)**, rendus obligatoires par le règlement délégué (UE) 2022/30 depuis le **1er août 2025**. Le point (d) (ne pas nuire au réseau) vise tout équipement radio relié à Internet « directement ou via un autre équipement » ; le point (e) vise ceux qui traitent des données personnelles. Normes harmonisées **EN 18031-1/2/3:2024**, avec une restriction notable : pas de présomption de conformité si l'utilisateur peut **ne pas mettre de mot de passe**.
- Pour le projet : les **passerelles** (Wi-Fi ou Ethernet, reliées au réseau) sont dans le champ ; le **boîtier** BLE l'est dès que ses données remontent par elles.
- Le règlement délégué (UE) 2026/339 abroge le 2022/30 au **11/12/2027**, date d'application complète du **Cyber Resilience Act** (règlement (UE) 2024/2847) : exigences essentielles, documentation, gestion des vulnérabilités, marquage CE. L'obligation de **signaler les vulnérabilités activement exploitées et les incidents graves** s'applique déjà depuis le **11/09/2026**.
- Un prototype de BTS n'est pas mis sur le marché : l'analyse est faite « comme si le produit était vendu ».

### 5.2 ANSSI

- **PG-109 « Approche SSI pour l'Internet des objets industriels » (30/05/2025)** : ne pas interconnecter ce qui n'a pas besoin de communiquer, concentrer les données côté informatique de gestion, passerelle filtrante, et ne pas renvoyer d'ordres calculés vers le procédé. La supervision du projet est **en lecture seule** : elle n'envoie aucun ordre aux chariots.
- **PA-087 « Sécurité des (systèmes d') objets connectés » (27/08/2021)** : recommandations reprises ci-dessous.

### 5.3 Mesures du projet et référentiels

| Mesure réalisée | Référence |
|---|---|
| Un certificat par passerelle, révocation par liste (CRL), aucun mot de passe par défaut | ANSSI PA-087 R 17 et R 19 ; ETSI EN 303 645 §5.1-1 ; EN 18031 |
| MQTT sur TLS mutuel, HTTPS, anti-rejeu | ANSSI PA-087 R 5, R 23, R 53 ; RED art. 3.3 (d)(e) |
| Droits par sujet MQTT (ACL), serveur en lecture seule | ANSSI PA-087 R 4 ; ANSSI PG-109 |
| Zones et conduits, pare-feu « tout refusé », aucun accès Internet depuis l'atelier | IEC 62443 ; ANSSI PA-087 R 51 ; guide d'hygiène de l'ANSSI (cloisonnement) |
| Heure commune (NTP), journal centralisé (syslog), journal chaîné SHA-256 | ANSSI PA-087 R 43 |
| Détection d'inondation et de brouillage radio, capteurs v2 à adresse privée (proposition) | ANSSI PA-087 R 55, R 56 |
| Liste blanche des capteurs, contrôle de vraisemblance, confirmation par bouton | ANSSI PA-087 R 4, R 5 |

### 5.4 RGPD : les caristes sont des salariés

La fiche CNIL « La géolocalisation des véhicules des salariés » (2023) :

- **interdit** d'utiliser ces données pour **contrôler le respect des limitations de vitesse** et de surveiller un salarié en permanence ;
- limite la conservation à **2 mois** en principe ;
- impose d'**informer le CSE** avant la mise en place, et **chaque salarié**.

La surveillance constante de l'activité des employés figure aussi dans la liste des traitements qui exigent une **analyse d'impact (AIPD)**.

Conséquences pour le projet :

- **La pression d'un pneu décrit le véhicule, pas le cariste.** La supervision suit des chariots, pas des conducteurs.
- **Aucun identifiant de cariste** n'est collecté. La vitesse n'est pas remontée, et la zone donnée par la passerelle sert à retrouver l'engin à regonfler.
- **Aucune sanction automatique.**
- **Conservation courte** : 30 jours pour les mesures du mode flotte des vélos, durée à reprendre pour les chariots, sous les 2 mois de la CNIL.
- Si un suivi par conducteur était un jour ajouté, il faudrait informer le CSE et faire une AIPD.
- ELOKON propose le même principe avec son mode « conducteur anonyme ».

Appliquer aux chariots la règle de la CNIL sur les véhicules routiers est une **interprétation prudente**.

## 6. Limites à annoncer au jury

- **Capteurs** : ceux du démonstrateur vont jusqu'à environ 3,5 bar. Les capteurs « poids lourd » 0–13 bar et le format de leurs trames sont des hypothèses.
- **Montage** : un bouchon de valve est exposé aux chocs ; les industriels préfèrent souvent un capteur dans le pneu (Continental, Goodyear).
- **Marché** plus étroit que « tous les chariots » : seulement les engins à pneus gonflés. Leur nombre en France n'a pas été trouvé.
- **Radio en entrepôt** : le métal gêne le BLE. Les passerelles fixes et le stockage des lots (1 h) répondent en partie au problème ; la portée reste à mesurer.
- **Conformité** : RED / EN 18031 puis CRA, marquage CE, ATEX selon les sites, accord du constructeur du chariot. Rien de cela n'est faisable dans un BTS : c'est présenté comme une analyse.
- **Chiffres non vérifiés à la source** : « 5 % de pression en moins = 30 % de stabilité en moins » (cité par un article sponsorisé) et le parc de 200 000 à 250 000 chariots en France. Ils ne sont pas utilisés dans le dossier.

## Sources

- INRS ED 979, *Chariots automoteurs de manutention – Comment éviter le renversement* : https://inrs.fr/dam/inrs/CataloguePapier/ED/TI-ED-979.pdf
- Linde connect : https://www.linde-mh.com/en/technical/News-Detail_59392.html · Fenwick-Linde (Préventica 2023) : https://www.preventica.com/presse/2023/fenwick-linde-cp-preventica-paris.pdf · Toyota I_Site : https://toyota-forklifts.eu/solutions/i_site-fleet-management/i_site-my-fleet · Jungheinrich ISM : https://logisticsmatters.co.uk/Jungheinrich-to-continue-ISM-Online · STILL : https://still.co.uk/forklift-trucks/safety/access-and-user-control · Crown InfoLink : https://www.mmh.com/article/crown_equipment_moves_its_infolink_fleet_management_system_to_the_cloud · ELOKON ELOfleet : https://www.elokon.com/files/produkte/ELOfleet/2022/flyers/ELOfleet_Flyer_FR_2022.pdf
- Prix génériques : https://gethapn.com/pricing/ · https://airpinpoint.com/equipment-tracking/forklift-tracking-system · https://www.gpsinsight.com/blog/what-is-the-cost-of-telematics/
- Kalmar : https://www.kalmarglobal.com/parts-services/equipment-upgrades/tyre-pressure-system/ · Continental : https://www.continental-tires.com/au/en/continental-for-business/services-and-solutions/digital-tyre-monitoring-industrial-pneumatic-tyres/ · Goodyear DrivePoint : https://www.tyrepress.com/2023/04/goodyear-launches-drivepoint-industrial-tyre-monitoring/ · COMATRA : https://www.forkliftaction.com/news/under-inflated-tires-impact-your-telehandlers-stability-keep-it-safe.aspx?n=15774 · Lyttelton : https://container-mag.com/2013/11/06/lyttelton-automates-straddle-carrier-tyre-monitoring/ · Bosch SMP290 : https://www.bosch-semiconductors.com/stories-and-events/smp290/
- Pression des pneus de chariots (Trelleborg) : https://www.trelleborg-tires.com/en-au/products-and-solutions/material-handling/forklift-tyres/pneumatic-tyres/t-800
- Capteurs vélo : https://www.bike-components.de/fr/SKS/Airspy-TL-Set-capteur-de-pression-d-air-p89881/ · https://www.bike-components.de/fr/QUARQ/Capteur-de-Pression-TyreWiz-2-0-p92175
- RED 2022/30 : https://www.gov.uk/government/publications/radio-equipment-regulations-2017/regulation-eu-202230-factsheet · EN 18031 (restrictions) : https://intertek.se/kunskapsbank/blogg/new-series-of-cyber-security-standards-now-harmonised-with-red-article-33 · Abrogation 2026/339 : https://eur-lex.europa.eu/eli/reg_del/2026/339/oj/eng · Cyber Resilience Act : https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act
- ANSSI PG-109 : https://messervices.cyber.gouv.fr/guides/approche-ssi-pour-linternet-des-objets-industriels · ANSSI PA-087 : https://messervices.cyber.gouv.fr/guides/recommandations-relatives-la-securite-des-systemes-dobjets-connectes
- CNIL, géolocalisation des véhicules des salariés : https://www.cnil.fr/fr/node/84420 · liste des traitements soumis à AIPD : https://www.cnil.fr/sites/default/files/atoms/files/liste-traitements-avec-aipd-requise-v2.pdf
