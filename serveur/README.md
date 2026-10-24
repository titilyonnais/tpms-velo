# Serveur de flotte (mode « location de vélos »)

Une entreprise de location équipe 20 vélos du kit TPMS. Chaque boîtier envoie ses mesures au serveur, qui les stocke, repère ce que le boîtier seul ne peut pas voir (fuites lentes sur plusieurs jours) et prépare la tournée du technicien.

Node.js 24, **aucune dépendance** : `node:http`, `node:https`, `node:sqlite`, `node:crypto`.

## Lancer

```bash
node serveur/serveur.js                       # HTTP : http://localhost:8080/flotte/ (base : serveur/flotte.db)
node serveur/flotte-vers-serveur.js           # 20 vélos, 14 derniers jours simulés et envoyés (≈ 30 s)
node serveur/flotte-vers-serveur.js --attaque-rejeu --attaque-signature
node serveur/flotte-vers-serveur.js --continu # puis la flotte continue en temps réel
node serveur/serveur.tests.js                 # 133 tests
```

### En HTTPS

```bash
node serveur/generer-certificat.js            # certificat AUTO-SIGNÉ de démo (appelle openssl, livré avec Git Bash)
node serveur/serveur.js                       # le certificat est trouvé : https://localhost:8443/flotte/
node serveur/flotte-vers-serveur.js --https   # le script fait confiance à CE certificat (option ca)
```

- Le serveur démarre en HTTPS dès que `serveur/certificats/cert.pem` et `cle.pem` existent ; `--https` l'exige, `--http` force HTTP. Sans certificat, il démarre en HTTP et affiche un **avertissement** (mots de passe, jetons de session et mesures en clair).
- Le certificat est auto-signé : le navigateur affiche un avertissement (et le navigateur intégré de Claude refuse la page). Le chiffrement est réel ; seule l'identité du serveur n'est garantie par aucune autorité. En production : un certificat Let's Encrypt pour le vrai nom de domaine.
- `serveur/certificats/` est exclu de Git (`serveur/.gitignore`) : **jamais de clé privée dans le dépôt**.

Options du script : `--jours 28`, `--graine 7`, `--lot-heures 6`, `--url http://localhost:8080`, `--compte <nom> --mot-de-passe <mot de passe>` (par défaut le technicien de démo), `--ca <certificat>`.
Options du serveur : `--port 9000`, `--base essai.db`, `--https`, `--http`.
Node affiche « SQLite is an experimental feature » : c'est un simple avertissement de Node 24.

Sans serveur (GitHub Pages, fichier ouvert directement), `flotte/index.html` passe en **mode démo** : la même flotte tourne dans le navigateur, sans compte.

## Comptes de lecture : mot de passe, puis session qui expire

Depuis le 24/10/2026, on ne lit plus l'API avec un jeton fixe valable pour toujours. On se **connecte** avec un nom de compte et un mot de passe, et le serveur donne un **jeton de session** qui expire (`serveur/sessions.js`). Les fichiers statiques (la page) restent publics.

| Compte | Mot de passe de **démonstration** (public) | Droits |
|---|---|---|
| `technicien` | `Pz9z-Z3xQ-OQF34K` | vélos, historique, alertes, statistiques (sans les chiffres de sécurité) |
| `gestionnaire` | `HDOeipRi43txbfmJ` | tout, plus le journal de sécurité `/api/refus` |

1. **Connexion** : `POST /api/connexion` avec `{ "compte": "...", "motDePasse": "..." }` → `200 { jeton, compte, role, droits, expireDansS }`. Mot de passe faux ou compte inconnu : `401` avec **le même message** (on ne dévoile pas quels comptes existent ; la vérification prend aussi le même temps, grâce à un compte fictif).
2. **Lectures** : en-tête `Authorization: Bearer <jeton de session>`. Le jeton fait 256 bits tirés au hasard.
3. **Expiration** : la session se ferme après **15 min sans requête** (la durée repart à chaque requête) et **au plus tard 8 h** après la connexion (une journée de travail), même si l'on s'en sert. Ensuite : `401`, motif `session-expiree` (en-tête `WWW-Authenticate: Bearer ..., error="invalid_token"`). Au plus **3 sessions** ouvertes par compte : une 4e ferme la plus ancienne.
4. **Déconnexion** : `POST /api/deconnexion` détruit la session **côté serveur** (`204`) : le jeton ne vaut plus rien, même s'il a été recopié ailleurs.

Ce que garde le serveur :

- pour chaque compte, **seulement un sel et l'empreinte scrypt** du mot de passe. scrypt est une fonction lente et gourmande en mémoire (≈ 50 ms et 16 Mo par essai), faite pour les mots de passe choisis par des humains : même avec le fichier volé, essayer des milliards de mots de passe coûterait très cher. Les mots de passe de démo sont dans `cles-demo.json` (champ `motDePasse`), hachés dès la lecture ; en production le fichier ne contiendrait que `"sel"` et `"empreinte"` (en hexadécimal) ;
- pour chaque session, **seulement l'empreinte SHA-256 du jeton** (un jeton de 256 bits tiré au hasard ne se devine pas : un hachage rapide suffit), le compte et les heures de connexion et de dernière requête. Les sessions sont en mémoire : un redémarrage du serveur oblige à se reconnecter.

Refus et journal : un mot de passe faux (motif `connexion`), un jeton inconnu ou mal formé (`authentification`) ou un accès hors des droits (`403`, `droits`) sont notés dans la table `refus` (sans le mot de passe ni le jeton essayés) et comptent pour le blocage d'adresse IP (5 min après 30 refus par minute). Une visite **sans** jeton (la page ouverte avant la connexion) et une session **expirée** reçoivent un `401` sans être journalisées : ce n'est pas une attaque, et le journal de sécurité ne doit pas se remplir de bruit.

La page de supervision demande le compte et le mot de passe, les envoie une seule fois, garde le jeton de session dans `sessionStorage` (oublié à la fermeture de l'onglet) et propose « Se déconnecter », qui appelle `/api/deconnexion`. Mots de passe de démo à renouveler : `node serveur/generer-cles-demo.js --nouveaux-mots-de-passe` (les clés des vélos sont gardées).

```bash
curl -X POST -H "Content-Type: application/json" -d '{"compte":"technicien","motDePasse":"Pz9z-Z3xQ-OQF34K"}' http://localhost:8080/api/connexion
curl -H "Authorization: Bearer <jeton reçu>" http://localhost:8080/api/velos
curl -X POST -H "Authorization: Bearer <jeton reçu>" http://localhost:8080/api/deconnexion
curl http://localhost:8080/api/velos            # 401 : authentification requise
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
| `serveur.js` | Serveur HTTP/HTTPS : routes, connexion et rôles, limitation de débit, en-têtes (HSTS en HTTPS), fichiers statiques |
| `sessions.js` | Comptes à mot de passe (sel + scrypt) et sessions qui expirent (15 min d'inactivité, 8 h au plus, 3 par compte) ; l'heure est passée en paramètre pour les tests |
| `base.js` | Schéma SQL commenté et requêtes paramétrées (tables `velos`, `mesures`, `alertes`, `regonflages`, `refus`), purge RGPD |
| `cles-demo.json` | Clés HMAC des 20 vélos et mots de passe des comptes **de démonstration** (publics), créés par `generer-cles-demo.js` |
| `generer-certificat.js` | Certificat HTTPS auto-signé de démo pour localhost (openssl), dans `certificats/` (hors Git) |
| `flotte-vers-serveur.js` | Client : simule la flotte (`flotte/flotte.js`) et envoie des lots signés, en HTTP ou HTTPS ; démonstrations d'attaques |
| `serveur.tests.js` | Tests : sécurité, débit, simulation, bout en bout, connexion et sessions, RGPD, conservation, HTTPS |
| `../flotte/flotte-logique.js` | Règles partagées serveur / page : validation, signature, RGPD, tendances, statut, priorité |

## API

| Méthode | Adresse | Compte | Réponse |
|---|---|---|---|
| POST | `/api/mesures` | signature du vélo | Lot de mesures d'un vélo, **signé**. `201 { acceptees, ignorees, alertes, regonflages, purgees }` |
| POST | `/api/connexion` | aucun | `{ compte, motDePasse }` → `200 { jeton, compte, role, droits, expireDansS }` ; `401` si refusé |
| POST | `/api/deconnexion` | session | Détruit la session présentée. `204` |
| GET | `/api/moi` | tous | `{ compte, role, droits, expireDansS }` |
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
| Lecture des données par n'importe qui | Connexion par mot de passe (sel + scrypt), session de 256 bits qui expire (15 min d'inactivité, 8 h au plus), vraie déconnexion ; rôles technicien / gestionnaire ; `401` / `403` journalisés | `sessions.js`, `authentifier`, `DROITS` (`serveur.js`) |
| Jeton volé (poste partagé, capture d'écran) | Il ne sert que jusqu'à la fin de la session, et plus du tout après « Se déconnecter » | `sessions.js` |
| Écoute du réseau (mots de passe, jetons, mesures) | HTTPS (TLS 1.2 minimum) dès qu'un certificat est présent ; HSTS ; avertissement en HTTP | `serveur.js`, `generer-certificat.js` |
| Faux serveur (homme du milieu) | Le script vérifie le certificat (confiance explicite au certificat de démo via `ca`, jamais `rejectUnauthorized: false`) | `requeteJson` (`flotte-vers-serveur.js`) |
| Valeurs absurdes ou piégées | Liste blanche des champs, types et plages (limites de `logique/securite.js`), dates croissantes | `flotteValiderLot` |
| Injection SQL | Identifiant `V` + 2 chiffres, puis requêtes **paramétrées** uniquement (`?`) | `base.js` |
| Inondation, force brute | 120 requêtes/min par vélo authentifié ; IP bloquée 5 min après 30 refus/min (signatures, jetons ET mots de passe) ; corps ≤ 64 Kio ; délais de lecture (slowloris) | `serveur.js` |
| XSS, clickjacking | En-têtes CSP, `nosniff`, `X-Frame-Options`, `no-referrer` ; la page échappe tout texte reçu | `serveur.js`, `flotte/page.js` |
| Fuite de secrets | `serveur/` (clés, base, certificats) et fichiers cachés jamais servis ; `../` impossible ; clé privée hors Git | `servirFichier`, `.gitignore` |
| Traçabilité | Chaque refus : table `refus` + console (heure, IP, vélo annoncé, motif), gardé 6 mois | `refuser()` |

**HSTS** : `max-age=86400` (1 jour) pour commencer, comme le recommande un déploiement prudent ; 1 an en production une fois HTTPS validé. L'en-tête vaut pour tout `localhost` (tous les ports) : ne pas installer le certificat de démo dans le magasin de confiance du système. Les navigateurs l'ignorent tant que le certificat n'est pas de confiance, et sur une adresse IP.

## Limites (à dire au jury)

- **Secrets de démo publics** dans le dépôt (clés des vélos, mots de passe des comptes) : en vrai, une clé par boîtier gravée à la fabrication, un coffre à secrets côté serveur, chaque personne choisit son mot de passe et le fichier ne garde que le sel et l'empreinte scrypt ; une clé partagée (HMAC) peut aussi être remplacée par une signature à clé publique (ECDSA).
- **Certificat auto-signé** : chiffrement réel, mais identité non garantie par une autorité (avertissement du navigateur).
- **Sessions** (depuis le 24/10/2026, à la place des jetons fixes) : elles sont en mémoire (perdues au redémarrage, et propres à un seul serveur). Le jeton est gardé dans `sessionStorage`, lisible par un script de la page : la CSP limite ce risque, mais un cookie `HttpOnly; Secure; SameSite=Strict` serait plus sûr. Pas de second facteur (code à usage unique). Étape suivante en entreprise : l'authentification centralisée (OpenID Connect).
- La limitation de débit est en mémoire (remise à zéro au redémarrage) et ne vaut que pour un seul serveur.
- Le boîtier réel n'a pas de modem : on suppose une passerelle dans chaque station (ou un module LTE-M) ; le format des envois est indépendant de ce choix.
- Défaut révélé par la simulation de la flotte, puis corrigé : une alerte « pression basse » se rallumait en boucle quand la pression oscillait autour du seuil la nuit. Le boîtier applique désormais une hystérésis de 0,05 bar (`TPMS.HYSTERESIS_ALERTE_BAR` dans `logique/alertes.js`, et en C++).
