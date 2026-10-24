# Fiche de préparation à l'oral – questions probables du jury

Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6 « Valorisation de la donnée et cybersécurité ».

Cette fiche sert à **s'entraîner**, pas à être lue devant le jury. Pour chaque question : une réponse courte (à dire en 30 secondes environ), puis où trouver les détails si le jury creuse. Les chiffres viennent du code et des documents du dépôt (état du 24/10/2026).

**Conseil général** : répondre d'abord en une phrase, donner **un chiffre**, puis s'arrêter et laisser le jury relancer. Quand je ne sais pas, je le dis et je dis comment je le vérifierais (c'est déjà la logique du dossier : chaque hypothèse est signalée).

---

## 1. Le projet et la démarche

**Q1. En une phrase, qu'avez-vous fait ?**
Un kit de surveillance de la pression des pneus de vélo (deux capteurs TPMS du commerce, un boîtier de guidon à écran e-paper, une application), et surtout un **simulateur complet** qui m'a permis de tout concevoir et tester avant d'avoir le matériel : 668 tests JavaScript et 136 tests C++, relancés à chaque envoi de code sur GitHub.
→ rapport § 1.6 et § 3.

**Q2. Pourquoi un simulateur plutôt qu'attendre le matériel ?**
Parce que le matériel n'était pas arrivé, et surtout parce que les défauts les plus intéressants ne se voient qu'en faisant tourner le système longtemps : **11 défauts de conception** ont été trouvés en simulant une semaine d'usage, des crevaisons et une flotte de 20 vélos, et corrigés avant la réception des pièces.
→ rapport § 3.1 et § 6.8.

**Q3. Comment être sûr que le simulateur dit vrai ?**
Je ne le suis pas complètement : c'est un modèle, et je le dis. Les lois physiques sont standard (gaz parfaits, atmosphère normalisée, modèle de batterie de Thévenin), les valeurs viennent des fiches techniques et sont marquées « hypothèse » quand elles ne sont pas mesurées. Le § 8.6 du rapport liste ce que je vérifierai sur le matériel réel, avec la méthode pour chaque point.
→ rapport § 3.5 et § 8.6.

**Q4. Qu'est-ce que « la logique est séparée des sources de données » ?**
Les fonctions qui décident (décoder une trame, détecter une fuite, déclencher une alerte) ne lisent jamais la radio ni l'horloge : on leur passe la trame et l'heure en paramètres. Le même code tourne donc dans le simulateur, dans l'application, et traduit en C++ dans le firmware. Ça permet de tester sans matériel et d'accélérer le temps.
→ rapport § 3.2, `docs/architecture.md`.

**Q5. Qu'est-ce qui distingue votre produit de la concurrence ?**
Un afficheur dédié lisible au soleil (e-paper), qui fonctionne sans smartphone, pour environ 89 € le kit, contre environ 100 € la paire pour le SKS Airspy (sans afficheur) et environ 250 £ pour le Quarq TyreWiz.
→ rapport § 1.4 et § 1.5.

---

## 2. La donnée

**Q6. Quel est le chemin de la donnée, du pneu à l'écran ?**
Le capteur mesure la pression et la température et les diffuse en annonce BLE (18 octets, en clair). Le boîtier écoute par fenêtres, vérifie que la trame vient d'un capteur appairé et qu'elle est vraisemblable, compense la température, garde un historique, détecte les fuites, déclenche les alertes et affiche. L'application reçoit les mesures par une liaison chiffrée, garde un historique de plusieurs jours et l'exporte en CSV.
→ rapport § 5.1.

**Q7. Comment détectez-vous une fuite lente ?**
Par une **régression linéaire** (moindres carrés) sur les mesures des 20 dernières minutes, une toutes les 30 s, après les avoir ramenées à 20 °C par la loi des gaz à volume constant. Sans cette compensation, un pneu chauffé au soleil puis refroidi en roulant ressemblait à une fuite (défaut n° 5). L'application fait la même chose sur plusieurs jours pour les fuites très lentes.
→ rapport § 5.4.

**Q8. Pourquoi deux pressions différentes, « manomètre » et « capteur » ? (évolution du 24/10/2026)**
Le capteur retire une pression atmosphérique **fixe** de 1013 hPa. À 1 500 m, l'air ne fait que 846 hPa : il annonce 0,17 bar de moins qu'un manomètre. Le baromètre du boîtier mesure l'air réel et corrige. J'utilise la pression **corrigée** pour l'écran et les alertes, parce que c'est elle que le cycliste règle ; mais je garde la pression **du capteur** pour l'historique, parce qu'elle suit la quantité d'air sans dépendre de l'altitude : un aller-retour en montagne ne ressemble plus à une fuite. C'est le même relevé, utilisé de deux façons selon la question posée.
→ `logique/barometre.js`, rapport § 5.

**Q9. Comment prévoyez-vous le prochain regonflage ?**
Un relevé par sortie, compensé en température ; une droite donne la perte par jour ; on calcule quand la pression croisera le seuil bas. Une chambre butyle donne en simulation un regonflage dans 2 à 3 semaines.
→ rapport § 5.5.

**Q10. Que fait le mode flotte de plus ?**
Il agrège 20 vélos de location sur un serveur (Node.js et SQLite) : tendance sur 14 jours compensée à 20 °C, statistiques calculées en SQL, et une tournée du technicien triée par priorité. Une pression toutes les 10 min ne dit rien seule ; agrégée sur 20 vélos, elle organise la journée d'un technicien.
→ rapport § 5.10, `serveur/README.md`.

---

## 3. La cybersécurité

**Q11. Quelle méthode d'analyse de risques ?**
Une version simplifiée d'**EBIOS Risk Manager** (ANSSI) : biens à protéger, sources de risque, scénarios, évaluation gravité × vraisemblance avant et après les mesures, risques résiduels assumés. 15 scénarios pour le kit, 8 pour le serveur.
→ `docs/analyse-de-risques.md`.

**Q12. Les capteurs émettent en clair : n'importe qui peut les imiter ?**
Oui, et je ne peux pas modifier leur programme. Je **détecte** donc les comportements anormaux : liste blanche des adresses appairées, contrôle de vraisemblance (un saut de 2 bar en 1 s est rejeté tant qu'il n'est pas confirmé), contrôle du rythme (deux émetteurs avec la même adresse se trahissent). Le boîtier affiche alors « SIGNAL SUSPECT » plutôt qu'une fausse valeur. Contre 300 décalages d'un pirate, aucun ne trompe le boîtier.
→ rapport § 6.6 et 6.7.

**Q13. Et une vraie crevaison, n'est-elle pas prise pour une attaque ?**
C'était le défaut n° 9 : la rafale d'annonces d'une vraie crevaison ressemblait à un second émetteur. Correction : deux trames rapprochées ne sont suspectes que si la pression ne **baisse** pas. Résultat : 0 fausse intrusion sur 12 crevaisons, et le pirate reste détecté. C'est l'exemple du compromis entre **sécurité** et **sûreté**.
→ rapport § 6.8 et 6.9.

**Q14. Comment la liaison boîtier-téléphone est-elle protégée ?**
BLE Secure Connections avec un code à 6 chiffres affiché sur l'e-paper : seul quelqu'un qui voit le boîtier peut s'appairer. Ensuite tout est chiffré (AES-CCM). Le simulateur montre qu'en mode « sans code », un homme du milieu réussit. Avec le code, 3 essais faux bloquent l'appairage une minute : il faudrait environ 5 mois d'essais pour une chance sur deux.
→ rapport § 6.6.

**Q15. Un téléphone appairé volé peut-il couper les protections ? (évolution du 24/10/2026)**
Plus maintenant. Couper une protection ou changer l'adresse d'un capteur ne s'applique qu'après un **appui long sur le bouton 2 du boîtier**, et l'écran affiche exactement ce qui va changer. Un autre bouton, 30 s sans réponse ou la déconnexion annulent. Point important : la commande « acquitter » de l'application, qui équivaut à un appui long sur ce même bouton, ne peut pas confirmer ; un test le vérifie. Limite assumée : qui a le vélo **et** le téléphone déverrouillé peut tout changer, mais c'est la situation du propriétaire.
→ `docs/analyse-de-risques.md` § 6.13.

**Q16. Que reste-t-il comme risque élevé ?**
Le **pistage** : chaque capteur émet une adresse fixe, donc des récepteurs à 40 € dans une ville peuvent suivre un cycliste. Aucun réglage du boîtier ne peut le corriger. Je propose des capteurs « version 2 » à adresse changeante et trames signées (HMAC), simulés mais pas fabriqués. La vie privée se décide dans la conception des composants.
→ rapport § 6.10 et 6.11.

**Q17. Comment le serveur de flotte se protège-t-il ?**
Chaque vélo signe ses envois (HMAC-SHA256 avec sa clé), avec horodatage et numéro de séquence contre le rejeu ; validation stricte des champs ; requêtes SQL paramétrées (pas d'injection) ; limitation de débit et blocage d'une adresse IP qui accumule les refus ; en-têtes de sécurité ; HTTPS ; journal des refus.
→ `serveur/README.md`, rapport § 6.13.

**Q18. Pourquoi des sessions qui expirent plutôt que des jetons ? (évolution du 24/10/2026)**
Un jeton fixe volé une fois ouvrait l'API pour toujours. Maintenant on se connecte par mot de passe et on reçoit un jeton de session qui expire après 15 min sans activité et au plus tard 8 h après, et « Se déconnecter » le détruit sur le serveur. Le serveur ne garde jamais les mots de passe : seulement un **sel** et l'empreinte **scrypt**, une fonction volontairement lente (environ 50 ms par essai) qui rend une attaque par dictionnaire très coûteuse même si le fichier est volé. Pour le jeton de session, tiré au hasard sur 256 bits, un simple SHA-256 suffit.
→ `serveur/sessions.js`, `serveur/README.md`.

**Q19. Pourquoi la même réponse pour « compte inconnu » et « mauvais mot de passe » ?**
Pour ne pas aider un attaquant à deviner quels comptes existent. La vérification prend aussi le même temps, grâce à un compte fictif. Les échecs sont journalisés (sans le mot de passe essayé) et comptent dans le blocage d'adresse IP.

**Q20. Et le RGPD ?**
Pour le kit, les données restent sur le téléphone. Pour la flotte : aucune position n'est gardée pendant une location (c'est celle du client), mesures et alertes effacées après 30 jours, journal des refus (qui contient des adresses IP) après 6 mois. Ces règles sont du code testé : une position mise à `null` avant stockage, une requête de purge.
→ rapport § 5.11.

---

## 4. Le matériel et l'énergie

**Q21. Quelle autonomie et comment l'avez-vous calculée ?**
63,7 jours selon le modèle, à 15 % près de la semaine simulée, pour une exigence d'une semaine. Les leviers : écoute radio par fenêtres (3 s toutes les 5 s), écran rafraîchi seulement si l'image change, veille profonde (environ 5 µA) quand la roue ne tourne plus. Je n'ai pas de mesureur de consommation : je mesurerai à l'oscilloscope avec une résistance de 10 Ω en série.
→ rapport § 7, `docs/bilan-energetique.md`.

**Q22. Pourquoi refuser la recharge par grand froid ? (évolution du 24/10/2026)**
Une LiPo ne doit pas se recharger sous 0 °C (le lithium se dépose en métal et abîme la batterie), et le chargeur de la carte XIAO ne surveille pas la température. Le baromètre mesure aussi la température : sous 2 °C, le boîtier coupe l'arrivée du 5 V par un interrupteur intégré (TPS22918) commandé par un transistor. Point de conception important : si la carte est éteinte, une résistance laisse l'interrupteur **passant**, sinon une batterie vide ne pourrait plus jamais se recharger. C'est une mesure de **sûreté**.
→ `logique/barometre.js`, `docs/schema-electrique.md`.

**Q23. Le boîtier est étanche : comment le baromètre voit-il l'altitude ?**
Il ne la verrait pas : il mesurerait l'air enfermé à la fermeture. J'ai ajouté un **évent** de 3 mm sous le fond, couvert d'une membrane ePTFE qui laisse passer l'air mais pas l'eau, comme les compteurs GPS étanches. Le simulateur a d'ailleurs un mode « sans évent » qui montre que la correction ne marche plus.
→ `boitier-3d/README.md` § 2.6.

**Q24. Il manquait des broches sur la carte : comment avez-vous fait ?**
Quatre astuces, toutes justifiées : les plots NFC deviennent des sorties ; le baromètre partage le bus SPI de l'écran et utilise la broche MISO, inutilisée jusque-là ; le fil BUSY de l'écran est remplacé par une attente fixe, plus longue au froid ; les deux boutons partagent une broche grâce à une résistance, et une lecture analogique distingue lequel est appuyé. Ce qui reste à vérifier : la durée réelle de BUSY au froid, à mesurer **avant** de couper le fil.
→ `firmware/README.md`.

**Q25. Pourquoi Web Bluetooth et Bluefy plutôt qu'une application native ?**
Une page web ne demande aucune installation et le même code sert au simulateur. Sur iPhone, Safari ne gère pas Web Bluetooth, d'où le navigateur Bluefy ; une application Flutter aurait demandé un Mac pour compiler la version iOS.
→ rapport § 4.5.

---

## 5. Les tests et la gestion de projet

**Q26. Que prouvent vos tests, et que ne prouvent-ils pas ?**
Ils prouvent que la logique fait ce que j'ai spécifié, en JavaScript et en C++, et qu'une modification ne casse rien (GitHub Actions les relance à chaque envoi). Ils ne prouvent pas que le matériel réel se comporte comme le modèle : le format exact des trames, la plage des capteurs et les consommations restent à vérifier.
→ rapport § 8.2 et 8.6.

**Q27. Comment avez-vous organisé votre travail ?**
Un dépôt Git dès le départ, des commits fréquents et décrits (l'historique sert de preuve d'avancement), GitHub Actions pour les tests, GitHub Pages pour publier le simulateur, l'application et ce diaporama.
→ rapport § 9.

**Q28. Si c'était à refaire ?**
Je commencerais par le simulateur dès le premier jour, comme je l'ai fait, mais je chiffrerais plus tôt le budget des composants ajoutés en cours de route (baromètre, interrupteur de recharge, membrane), qui ne sont pas encore dans la demande d'achat.

---

## 6. Les démonstrations à avoir prêtes

1. **Simulateur** (https://titilyonnais.github.io/tpms-velo/simulateur/) : une crevaison (alerte en quelques secondes), puis l'attaque d'un pirate (« SIGNAL SUSPECT »).
2. **Confirmation par bouton** : page Application → décocher une protection → « CONFIRMER ? » sur l'écran du boîtier → appui long sur le bouton 2.
3. **Altitude** : parcours du col de la Luère, page Électronique → baromètre et correction ; Configuration → « BMP280 sans évent » pour montrer la différence.
4. **Grand froid** : Configuration → météo « Hiver, gel », départ à 6 h et « Recharge du boîtier : dehors », puis brancher le chargeur → « FROID » près de la batterie, et la page Électronique montre la recharge coupée.
5. **Flotte** : serveur local, connexion par mot de passe, puis « Se déconnecter » ; attaques de rejeu et de signature avec `flotte-vers-serveur.js`.

## 7. À compléter avant le jour J

- Champs [Établissement], [Professeur référent], [Session] et [Date de soutenance] dans le rapport et la présentation.
- Si le matériel arrive : remplacer les hypothèses mesurées (format des trames, plage des capteurs, consommations) et le dire en ouverture de soutenance.
