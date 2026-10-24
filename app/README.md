# Application TPMS

Page web qui se connecte au boîtier de guidon par Web Bluetooth.

| Vue        | Rôle                                                                  |
|------------|-----------------------------------------------------------------------|
| Pneus      | Pressions « manomètre » (corrigées de l'altitude par le baromètre du boîtier, correction affichée), températures, piles, état ; vitesse, trajet, batterie du boîtier (« recharge coupée (température) » par grand froid) |
| Historique | Courbes des pressions, tendance depuis le dernier regonflage, date estimée du prochain regonflage, export CSV (avec la colonne `correction_altitude_bar`) |
| Réglages   | Circonférence, seuils, veille, protections, adresses des capteurs (lien chiffré obligatoire) ; couper une protection ou changer de capteur demande une confirmation sur le boîtier |

## Évolutions du 24/10/2026

- **Confirmation par bouton.** Un changement « sensible » (protection coupée, adresse de capteur changée, `TPMS.changementSensible`) n'est appliqué qu'après un **appui long sur le bouton 2 du boîtier**, dans les 30 s. L'application affiche « confirme-le sur le boîtier », suit le bit 3 de l'octet 17 de MESURES (changement en attente), puis relit REGLAGES quand il retombe pour dire « confirmé » ou « annulé ». Sa commande ACQUITTER ne peut pas confirmer à la place du cycliste. Voir `docs/analyse-de-risques.md`, § 6.13.
- **Correction d'altitude.** MESURES donne la correction du boîtier (octet 19, pas de 4 mbar ; la séquence tient maintenant sur l'octet 18 seul). L'application **retire** cette correction pour calculer la tendance : elle suit ainsi la quantité d'air du pneu, et un aller-retour en montagne ne ressemble pas à une fuite. Voir `docs/protocole-ble.md`.
- **Recharge coupée par grand froid** : bit 4 de l'octet 17 de MESURES, affiché à côté de la batterie du boîtier.

## Deux transports, une seule application

- `transport-ble.js` : la vraie radio (Web Bluetooth).
- `transport-simule.js` : le boîtier virtuel du simulateur, par `postMessage`. Il est utilisé quand l'adresse contient `?transport=simule`, ce que fait le §3 du simulateur.

Les deux transports offrent les mêmes fonctions, et `app.js` ne sait pas auquel il parle. Les octets échangés suivent `logique/protocole.js`.

## Sur téléphone

La page doit être servie en HTTPS (par exemple avec GitHub Pages).
- **iPhone** : ouvrir la page dans le navigateur **Bluefy**, car Safari ne gère pas Web Bluetooth. Le code d'appairage à 6 chiffres se tape dans la fenêtre du système.
- **PC et Android** : Chrome.
