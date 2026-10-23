# Serveur de flotte (mode « location de vélos »)

Une entreprise de location équipe 20 vélos du kit TPMS. Chaque boîtier envoie ses mesures au serveur, qui les stocke, repère ce que le boîtier seul ne peut pas voir (fuites lentes sur plusieurs jours) et prépare la tournée du technicien.

Node.js 24, **aucune dépendance** : `node:http`, `node:https`, `node:sqlite`, `node:crypto`.

## Lancer

```bash
node serveur/serveur.js                       # HTTP : http://localhost:8080/flotte/ (base : serveur/flotte.db)
node serveur/flotte-vers-serveur.js           # 20 vélos, 14 derniers jours simulés et envoyés (≈ 30 s)
node serveur/flotte-vers-serveur.js --attaque-rejeu --attaque-signature
node serveur/flotte-vers-serveur.js --continu # puis la flotte continue en temps réel
node serveur/serveur.tests.js                 # 117 tests
```

### En HTTPS

```bash
node serveur/generer-certificat.js            # certificat AUTO-SIGNÉ de démo (appelle openssl, livré avec Git Bash)
node serveur/serveur.js                       # le certificat est trouvé : https://localhost:8443/flotte/
node serveur/flotte-vers-serveur.js --https   # le script fait confiance à CE certificat (option ca)
```

- Le serveur démarre en HTTPS dès que `serveur/certificats/cert.pem` et `cle.pem` existent ; `--https` l'exige, `--http` force HTTP. Sans certificat, il démarre en HTTP et affiche un **avertissement** (jetons et mesures en clair).
- Le certificat est auto-signé : le navigateur affiche un avertissement (et le navigateur intégré de Claude refuse la page). Le chiffrement est réel ; seule l'identité du serveur n'est garantie par aucune autorité. En production : un certificat Let's Encrypt pour le vrai nom de domaine.
- `serveur/certificats/` est exclu de Git (`serveur/.gitignore`) : **jamais de clé privée dans le dépôt**.

Options du script : `--jours 28`, `--graine 7`, `--lot-heures 6`, `--url http://localhost:8080`, `--jeton <jeton>`, `--ca <certificat>`.
Options du serveur : `--port 9000`, `--base essai.db`, `--https`, `--http`.
Node affiche « SQLite is an experimental feature » : c'est un simple avertissement de Node 24.

Sans serveur (GitHub Pages, fichier ouvert directement), `flotte/index.html` passe en **mode démo** : la même flotte tourne dans le navigateur, sans compte.

## Comptes de lecture (jetons de démo)

Toutes les routes `GET /api/*` exigent l'en-tête `Authorization: Bearer <jeton>`. Les fichiers statiques (la page) restent publics.

| Compte | Jeton de **démonstration** (public) | Droits |
|---|---|---|
| `technicien` | `fbI2sv3BKPhVMHtRpWiGc66cpZRegZwq` | vélos, historique, alertes, statistiques (sans les chiffres de sécurité) |
| `gestionnaire` | `L0mwayAUqAnU7c2is1vCv_SiU2R15Bpj` | tout, plus le journal de sécurité `/api/refus` |

- Ils sont dans `cles-demo.json` (champ `comptes`), créés par `generer-cles-demo.js` (`--nouveaux-jetons` pour en tirer d'autres ; les clés des vélos sont gardées).
- Le serveur ne garde **que l'empreinte SHA-256** de chaque jeton (le jeton en clair est oublié dès la lecture du fichier) et compare à temps constant (`crypto.timingSafeEqual`). En production, le fichier ne contiendrait que `"empreinte": "<sha256 hex>"`.
- Sans jeton ou jeton faux : `401` (en-tête `WWW-Authenticate: Bearer`) ; hors des droits du rôle : `403`. Un jeton faux ou un accès hors des droits est noté dans la table `refus` et compte pour le blocage d'adresse IP (5 min après 30 refus par minute) : deviner un jeton par force brute est impossible en pratique (192 bits). Une simple visite **sans** jeton (la page ouverte avant la connexion) reçoit aussi un `401`, mais n'est ni journalisée ni comptée : ce n'est pas une attaque, et le journal de sécurité ne doit pas se remplir de bruit.
- La page de supervision demande le jeton (gardé dans `sessionStorage`, oublié à la fermeture de l'onglet) et propose « Se déconnecter ». Pour **révoquer** un jeton, on retire son empreinte de la configuration.

```bash
curl -H "Authorization: Bearer fbI2sv3BKPhVMHtRpWiGc66cpZRegZwq" http://localhost:8080/api/velos
curl http://localhost:8080/api/velos            # 401 : authentification requise
curl --cacert serveur/certificats/cert.pem -H "Authorization: Bearer L0mwayAUqAnU7c2is1vCv_SiU2R15Bpj" https://localhost:8443/api/refus
```

## RGPD

| Principe | Règle | Où |
|---|---|---|
| Minimisation | Pendant une location (`enLocation` vrai), la position est celle du client : le boîtier ne l'envoie pas, et si un boîtier l'envoie quand même, `lat`/`lon` sont mis à `null` **avant** stockage. Le technicien n'a besoin que des vélos rendus en station. | `TPMS.flotteMinimiserPosition` (flotte-logique.js), appliquée par `base.js` et `registre.js` ; boîtier simulé : `flotte.js` |
| Durée de conservation | Mesures détaillées et alertes : **30 jours** (assez pour la tendance sur 14 jours et le temps entre regonflages). Journal des refus (adresses IP) : **6 mois** (recommandation CNIL pour les journaux de sécurité). Les données agrégées (regonflages, tendances) restent. | `TPMS.FLOTTE_CONSERVATION` ; `DELETE ... WHERE t < ?` dans `base.js` ; `registrePurger` |
| Référence de temps | La date limite se compte depuis la **mesure la plus récente reçue**, pas l'horloge de l'ordinateur : la simulation compresse le temps, et rejouer d'anciennes données ne les efface pas aussitôt. | `TPMS.flotteLimiteConservation` |

Une ancienne base (où `lat`/`lon` étaient obligatoires) est mise à jour au démarrage : table reconstruite, positions prises en location effacées.
Sur la page, les vélos en location ne sont plus placés sur la carte : ils sont listés dessous (« En location · position non conservée »).

## Fichiers

| Fichier | Rôle |
|---|---|
| `serveur.js` | Serveur HTTP/HTTPS : routes, comptes et rôles, limitation de débit, en-têtes (HSTS en HTTPS), fichiers statiques |
| `base.js` | Schéma SQL commenté et requêtes paramétrées (tables `velos`, `mesures`, `alertes`, `regonflages`, `refus`), purge RGPD |
| `cles-demo.json` | Clés HMAC des 20 vélos et jetons des comptes **de démonstration** (publics), créés par `generer-cles-demo.js` |
| `generer-certificat.js` | Certificat HTTPS auto-signé de démo pour localhost (openssl), dans `certificats/` (hors Git) |
| `flotte-vers-serveur.js` | Client : simule la flotte (`flotte/flotte.js`) et envoie des lots signés, en HTTP ou HTTPS ; démonstrations d'attaques |
| `serveur.tests.js` | Tests : sécurité, débit, simulation, bout en bout, comptes, RGPD, conservation, HTTPS |
| `../flotte/flotte-logique.js` | Règles partagées serveur / page : validation, signature, RGPD, tendances, statut, priorité |

## API

| Méthode | Adresse | Compte | Réponse |
|---|---|---|---|
| POST | `/api/mesures` | signature du vélo | Lot de mesures d'un vélo, **signé**. `201 { acceptees, ignorees, alertes, regonflages, purgees }` |
| GET | `/api/moi` | tous | `{ compte, role, droits }` |
| GET | `/api/velos` | tous | Dernier état de chaque vélo : pressions, statut, priorité, fuite, prochain regonflage (position `null` en location) |
| GET | `/api/velos/V07/historique?jours=7` | tous | Mesures, regonflages et tendance d'un vélo |
| GET | `/api/alertes?limite=50` | tous | Dernières alertes (boîtier et serveur) |
| GET | `/api/statistiques` | tous | Indicateurs ; `securite` (refus par motif) pour le gestionnaire seulement |
| GET | `/api/refus?limite=20` | gestionnaire | Journal des requêtes refusées |

Un envoi signé porte quatre en-têtes :

```
X-Velo-Id:    V07
X-Horodatage: 1792737359168              (ms, horloge du vélo)
X-Sequence:   1792737359168              (toujours croissante)
X-Signature:  HMAC-SHA256(clé du vélo, "V07\n<horodatage>\n<séquence>\n<corps>") en hexadécimal
```

Corps : `{ "mesures": [ { "t", "pAv", "pAr", "tAv", "tAr", "pileAv", "pileAr", "batterie", "lat", "lon", "km", "etatAv", "etatAr", "enLocation" } ] }` ; `lat` et `lon` sont facultatifs (absents ou `null`).

## Sécurité

| Menace | Protection | Où |
|---|---|---|
| Faux vélo, données inventées | Signature HMAC-SHA256 avec la clé secrète du vélo ; comparaison à temps constant | `flotteControlerRequete` |
| Lot modifié en chemin | Le corps fait partie du texte signé : un seul caractère changé → `401 signature` | idem |
| Rejeu d'une requête capturée | Horodatage à ±60 s **et** séquence strictement croissante, gardée en base | idem, colonne `velos.derniere_sequence` |
| Lecture des données par n'importe qui | Jeton par compte, rôles technicien / gestionnaire ; empreintes SHA-256 seulement ; `401` / `403` journalisés | `authentifier`, `DROITS` (`serveur.js`) |
| Écoute du réseau (jetons, mesures) | HTTPS (TLS 1.2 minimum) dès qu'un certificat est présent ; HSTS ; avertissement en HTTP | `serveur.js`, `generer-certificat.js` |
| Faux serveur (homme du milieu) | Le script vérifie le certificat (confiance explicite au certificat de démo via `ca`, jamais `rejectUnauthorized: false`) | `requeteJson` (`flotte-vers-serveur.js`) |
| Valeurs absurdes ou piégées | Liste blanche des champs, types et plages (limites de `logique/securite.js`), dates croissantes | `flotteValiderLot` |
| Injection SQL | Identifiant `V` + 2 chiffres, puis requêtes **paramétrées** uniquement (`?`) | `base.js` |
| Inondation, force brute | 120 requêtes/min par vélo authentifié ; IP bloquée 5 min après 30 refus/min (signatures ET jetons) ; corps ≤ 64 Kio ; délais de lecture (slowloris) | `serveur.js` |
| XSS, clickjacking | En-têtes CSP, `nosniff`, `X-Frame-Options`, `no-referrer` ; la page échappe tout texte reçu | `serveur.js`, `flotte/page.js` |
| Fuite de secrets | `serveur/` (clés, base, certificats) et fichiers cachés jamais servis ; `../` impossible ; clé privée hors Git | `servirFichier`, `.gitignore` |
| Traçabilité | Chaque refus : table `refus` + console (heure, IP, vélo annoncé, motif), gardé 6 mois | `refuser()` |

**HSTS** : `max-age=86400` (1 jour) pour commencer, comme le recommande un déploiement prudent ; 1 an en production une fois HTTPS validé. L'en-tête vaut pour tout `localhost` (tous les ports) : ne pas installer le certificat de démo dans le magasin de confiance du système. Les navigateurs l'ignorent tant que le certificat n'est pas de confiance, et sur une adresse IP.

## Limites (à dire au jury)

- **Secrets de démo publics** dans le dépôt (clés des vélos, jetons des comptes) : en vrai, une clé par boîtier gravée à la fabrication, un coffre à secrets côté serveur, et seulement l'empreinte des jetons ; une clé partagée (HMAC) peut aussi être remplacée par une signature à clé publique (ECDSA).
- **Certificat auto-signé** : chiffrement réel, mais identité non garantie par une autorité (avertissement du navigateur).
- **Jetons fixes** : pas d'expiration ni de vrai mot de passe ; « Se déconnecter » fait seulement oublier le jeton par le navigateur. Étape suivante : sessions à durée limitée, ou authentification de l'entreprise (OpenID Connect).
- La limitation de débit est en mémoire (remise à zéro au redémarrage) et ne vaut que pour un seul serveur.
- Le boîtier réel n'a pas de modem : on suppose une passerelle dans chaque station (ou un module LTE-M) ; le format des envois est indépendant de ce choix.
- Défaut révélé par la simulation de la flotte, puis corrigé : une alerte « pression basse » se rallumait en boucle quand la pression oscillait autour du seuil la nuit. Le boîtier applique désormais une hystérésis de 0,05 bar (`TPMS.HYSTERESIS_ALERTE_BAR` dans `logique/alertes.js`, et en C++).
