# Orientation industrielle du projet – fiche pour validation

Thibault MORRETTON – BTS CIEL option IR – Épreuve E6 – 24/10/2026. Détails : [`orientation-industrielle.md`](orientation-industrielle.md).

**Votre remarque.** Le projet n'était pas assez industriel et manquait de réseau : le seul réseau était la liaison Bluetooth entre les capteurs et le boîtier du vélo.

**L'adaptation proposée.** Je ne change pas de projet, je lui donne un contexte industriel : **surveiller les pneus gonflables d'une flotte de chariots élévateurs** dans un entrepôt. Un pneu de chariot sous-gonflé rend la machine instable, surtout charge levée : c'est une question de **sécurité au travail**. Le **vélo devient le démonstrateur** à petite échelle, avec les mêmes capteurs, la même logique et la même cybersécurité, ce qui permet une démonstration réelle devant le jury.

## Ce qui est ajouté : une chaîne de collecte et un réseau d'usine

```
Capteurs TPMS (4 par chariot) ──BLE──▶ 3 passerelles au plafond (VLAN 10, atelier)
        ──MQTT sur TLS, un certificat par passerelle──▶ pare-feu ──▶ courtier MQTT,
        supervision, NTP, syslog (VLAN 20, serveurs) ◀──HTTPS + compte── bureautique (VLAN 30)
        DMZ (VLAN 40) : accès distant prévu
```

- **4 zones** séparées par un **pare-feu** (nftables, politique « tout refusé ») et **5 flux autorisés** seulement, selon la logique zones et conduits de la norme **IEC 62443**. Plan d'adressage 10.10.*VLAN*.0/24.
- **MQTT** (client écrit sans bibliothèque) : accusé de réception (QoS 1), testament si une passerelle disparaît, lots gardés 1 h si le courtier est injoignable.
- **Courtier Mosquitto** en TLS mutuel, avec des droits par sujet (une passerelle ne publie qu'en son nom) ; **NTP** pour dater les mesures ; **syslog** central.
- **Serveur de supervision** : il refait les contrôles du boîtier (liste blanche des capteurs, vraisemblance, anti-rejeu) et affiche chariots, zones, alertes et état des passerelles.

## Ce qui est réalisé et vérifié

| Élément | État au 24/10/2026 |
|---|---|
| Maquette réseau complète sur un PC (Docker, 10 conteneurs, une commande) | Fonctionne |
| Démonstration de sécurité (balayage du bureau vers l'atelier, client sans certificat, certificat volé, fausses données, pannes) | **14 essais sur 14** conformes |
| Analyse de risques du réseau (EBIOS RM simplifiée) | 8 scénarios ajoutés, aucun ne reste élevé |
| Page de supervision de l'entrepôt | En ligne, avec un mode démonstration |
| Tests automatiques | 777 tests JavaScript et 139 tests C++, à chaque envoi de code |

Une faille a été trouvée dans ma propre maquette (le serveur web donnait la clé privée du courtier), puis corrigée et ajoutée à la démonstration.

**Limites assumées** : tout le réseau tourne sur un seul PC (pas de vrai commutateur) ; les capteurs « poids lourd » (0 à 13 bar) et la portée Bluetooth dans un entrepôt sont des hypothèses.

## Questions pour vous

1. Cette orientation (chariots élévateurs, vélo comme démonstrateur) vous paraît-elle recevable pour l'épreuve E6 ?
2. Le niveau de réseau et d'infrastructure est-il suffisant, ou faut-il refaire le plan dans **Packet Tracer**, ou sur du matériel réel du lycée (commutateur, VLAN) ?
3. Faut-il garder la partie vélo dans la soutenance, ou la réduire au rôle de démonstrateur ?

En ligne : https://titilyonnais.github.io/tpms-velo/ (supervision de l'entrepôt : `/flotte/chariots.html`) · Code : github.com/titilyonnais/tpms-velo
