# Serveur de flotte (mode « location de vélos »)

Une entreprise de location équipe 20 vélos du kit TPMS. Chaque boîtier envoie ses mesures au serveur, qui les stocke, repère ce que le boîtier seul ne peut pas voir (fuites lentes sur plusieurs jours) et prépare la tournée du technicien.

Node.js 24, **aucune dépendance** : `node:http`, `node:sqlite`, `node:crypto`.

## Lancer

```bash
node serveur/serveur.js                       # http://localhost:8080/flotte/ (base : serveur/flotte.db)
node serveur/flotte-vers-serveur.js           # 20 vélos, 14 derniers jours simulés et envoyés (≈ 30 s)
node serveur/flotte-vers-serveur.js --attaque-rejeu --attaque-signature
node serveur/flotte-vers-serveur.js --continu # puis la flotte continue en temps réel
node serveur/serveur.tests.js                 # 67 tests
```

Options du script : `--jours 28`, `--graine 7`, `--lot-heures 6`, `--url http://localhost:8080`.
Node affiche « SQLite is an experimental feature » : c'est un simple avertissement de Node 24.

Sans serveur (GitHub Pages, fichier ouvert directement), `flotte/index.html` passe en **mode démo** : la même flotte tourne dans le navigateur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `serveur.js` | Serveur HTTP : routes, authentification, limitation de débit, en-têtes, fichiers statiques |
| `base.js` | Schéma SQL commenté et requêtes paramétrées (tables `velos`, `mesures`, `alertes`, `regonflages`, `refus`) |
| `cles-demo.json` | Clés HMAC des 20 vélos **de démonstration** (publiques), créées par `generer-cles-demo.js` |
| `flotte-vers-serveur.js` | Client : simule la flotte (`flotte/flotte.js`) et envoie des lots signés ; démonstrations d'attaques |
| `serveur.tests.js` | Tests : sécurité, débit, simulation, bout en bout |
| `../flotte/flotte-logique.js` | Règles partagées serveur / page : validation, signature, tendances, statut, priorité |

## API

| Méthode | Adresse | Réponse |
|---|---|---|
| POST | `/api/mesures` | Lot de mesures d'un vélo, **signé**. `201 { acceptees, ignorees, alertes, regonflages }` |
| GET | `/api/velos` | Dernier état de chaque vélo : pressions, statut, priorité, fuite, prochain regonflage |
| GET | `/api/velos/V07/historique?jours=7` | Mesures, regonflages et tendance d'un vélo |
| GET | `/api/alertes?limite=50` | Dernières alertes (boîtier et serveur) |
| GET | `/api/statistiques` | Indicateurs : vélos à regonfler, fuites lentes, temps moyen entre regonflages, km, refus… |
| GET | `/api/refus?limite=20` | Journal des requêtes refusées |

```bash
curl http://localhost:8080/api/velos
curl "http://localhost:8080/api/velos/V07/historique?jours=3"
curl http://localhost:8080/api/statistiques
# Requête non signée : refusée (400, en-têtes manquants), et notée dans le journal
curl -X POST -H "Content-Type: application/json" -H "X-Velo-Id: V01" -d '{"mesures":[]}' http://localhost:8080/api/mesures
```

Un envoi signé porte quatre en-têtes :

```
X-Velo-Id:    V07
X-Horodatage: 1792737359168              (ms, horloge du vélo)
X-Sequence:   1792737359168              (toujours croissante)
X-Signature:  HMAC-SHA256(clé du vélo, "V07\n<horodatage>\n<séquence>\n<corps>") en hexadécimal
```

Corps : `{ "mesures": [ { "t", "pAv", "pAr", "tAv", "tAr", "pileAv", "pileAr", "batterie", "lat", "lon", "km", "etatAv", "etatAr", "enLocation" } ] }`.

## Sécurité

| Menace | Protection | Où |
|---|---|---|
| Faux vélo, données inventées | Signature HMAC-SHA256 avec la clé secrète du vélo ; comparaison à temps constant | `flotteControlerRequete` |
| Lot modifié en chemin | Le corps fait partie du texte signé : un seul caractère changé → `401 signature` | idem |
| Rejeu d'une requête capturée | Horodatage à ±60 s **et** séquence strictement croissante, gardée en base | idem, colonne `velos.derniere_sequence` |
| Valeurs absurdes ou piégées | Liste blanche des champs, types et plages (limites de `logique/securite.js`), dates croissantes | `flotteValiderLot` |
| Injection SQL | Identifiant `V` + 2 chiffres, puis requêtes **paramétrées** uniquement (`?`) | `base.js` |
| Inondation | 120 requêtes/min par vélo authentifié ; IP bloquée 5 min après 30 refus/min ; corps ≤ 64 Kio ; délais de lecture (slowloris) | `serveur.js` |
| XSS, clickjacking | En-têtes CSP, `nosniff`, `X-Frame-Options`, `no-referrer` ; la page échappe tout texte reçu | `serveur.js`, `flotte/page.js` |
| Fuite de secrets | `serveur/` (clés, base) et fichiers cachés jamais servis ; `../` impossible | `servirFichier` |
| Traçabilité | Chaque refus : table `refus` + console (heure, IP, vélo annoncé, motif) | `refuser()` |

## Limites (à dire au jury)

- **Démo en HTTP** : en production, HTTPS obligatoire (la signature protège l'intégrité, pas la confidentialité).
- **Clés de démo publiques** dans le dépôt : en vrai, une clé par boîtier gravée à la fabrication et un coffre à secrets côté serveur ; une clé partagée (HMAC) peut aussi être remplacée par une signature à clé publique (ECDSA).
- **Lecture sans compte** : `GET /api/...` n'exige pas d'identification ; il faudrait un compte « technicien » et un compte « gestionnaire ».
- La limitation de débit est en mémoire (remise à zéro au redémarrage) et ne vaut que pour un seul serveur.
- Le boîtier réel n'a pas de modem : on suppose une passerelle dans chaque station (ou un module LTE-M) ; le format des envois est indépendant de ce choix.
- Défaut révélé par la simulation de la flotte, puis corrigé : une alerte « pression basse » se rallumait en boucle quand la pression oscillait autour du seuil la nuit. Le boîtier applique désormais une hystérésis de 0,05 bar (`TPMS.HYSTERESIS_ALERTE_BAR` dans `logique/alertes.js`, et en C++).
