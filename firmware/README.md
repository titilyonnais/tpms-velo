# Firmware du boîtier de guidon

Ce dossier contiendra le programme Arduino/PlatformIO du Seeed XIAO nRF52840. On l'écrira à la réception du matériel.

Le firmware reprendra la logique déjà écrite et testée dans `simulateur/logique/` et `simulateur/boitier/` :
- décodage des trames TPMS ;
- calcul de la vitesse et de la distance ;
- alertes et détection de fuite lente ;
- dessin de l'écran.

Cette logique est traduite en C++ sans en changer le fonctionnement.
