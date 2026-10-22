# Application TPMS

Page web qui se connecte au boîtier de guidon par Web Bluetooth.

| Vue        | Rôle                                                                  |
|------------|-----------------------------------------------------------------------|
| Pneus      | Pressions, températures, piles, état ; vitesse, trajet, batterie du boîtier |
| Historique | Courbes des pressions, tendance depuis le dernier regonflage, date estimée du prochain regonflage, export CSV |
| Réglages   | Circonférence, seuils, veille, protections, adresses des capteurs (lien chiffré obligatoire) |

## Deux transports, une seule application

- `transport-ble.js` : la vraie radio (Web Bluetooth).
- `transport-simule.js` : le boîtier virtuel du simulateur, par `postMessage`. Il est utilisé quand l'adresse contient `?transport=simule`, ce que fait le §3 du simulateur.

Les deux transports offrent les mêmes fonctions, et `app.js` ne sait pas auquel il parle. Les octets échangés suivent `logique/protocole.js`.

## Sur téléphone

La page doit être servie en HTTPS (par exemple avec GitHub Pages).
- **iPhone** : ouvrir la page dans le navigateur **Bluefy**, car Safari ne gère pas Web Bluetooth. Le code d'appairage à 6 chiffres se tape dans la fenêtre du système.
- **PC et Android** : Chrome.
