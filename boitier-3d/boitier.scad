// =====================================================================
//  Boîtier de guidon – kit de surveillance de la pression des pneus
//  Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6
//  Version 2 (23/10/2026) : forme « compteur GPS », joint torique
//  radial, fixation par collier fendu + glissière à verrou.
// =====================================================================
//
//  PIÈCES IMPRIMÉES (PETG, buse 0,4 mm) :
//    - COQUE      : le corps du boîtier (électronique, boutons, LED,
//                   buzzer, connecteur de recharge, sortie du câble reed,
//                   glissière femelle sous le fond) ;
//    - COUVERCLE  : la façade avec la fenêtre de l'écran ; l'écran est
//                   vissé dessous ; sa jupe porte le joint torique ;
//    - COLLIER    : le haut du collier de cintre, avec le rail mâle et
//                   la languette de verrouillage ;
//    - BRIDE      : le bas du collier (glissée de côté sur le tenon
//                   avant du collier, serrée par une vis M3 à l'arrière) ;
//    - CALES      : 2 demi-coquilles par diamètre de cintre ;
//    - TEST_JEUX  : petite pièce de réglage des jeux de l'imprimante ;
//    - ESSAI_JOINT: haut de coque seul, pour essayer le joint.
//
//  PRINCIPE : toutes les cotes sont des paramètres groupés en tête de
//  fichier. Les dimensions du boîtier sont CALCULÉES à partir de celles
//  des composants et des tolérances. Des assert() arrêtent le calcul si
//  une règle de conception n'est plus respectée.
//
//  ORIGINE DES COTES (repère à côté de chaque valeur) :
//    [FICHE]           donnée du fabricant (source citée)
//    [MESURÉ AU PLAN]  relevé sur un plan du fabricant (méthode citée)
//    [HYPOTHÈSE]       valeur courante pour ce type de pièce : À MESURER
//                      au pied à coulisse à la réception du matériel
//    [CHOIX]           décision de conception, justifiée en commentaire
//
//  REPÈRE (boîtier monté sur le vélo, vu par le cycliste) :
//    X : de gauche à droite (le long du cintre)
//    Y : vers l'avant du vélo (le cycliste est du côté des Y négatifs)
//    Z : vers le haut ; z = 0 sous le fond de la coque
//  Le collier a son propre repère : origine sur l'axe du cintre.
//
//  OpenSCAD 2021.01 : F5 = aperçu en couleurs, F6 = rendu complet.
//  Choisir la pièce avec la variable `piece` (ou le Customizer).
// =====================================================================


/* [Pièce à afficher] */

// "tout" = boîtier fermé sur son collier, sur un bout de cintre
piece = "tout"; // ["tout", "eclate", "coupe", "coque", "couvercle", "collier", "bride", "cale_22_2", "cale_23_8", "cale_25_4", "cale_31_8", "test_jeux", "essai_joint"]

// Afficher les composants (fantômes colorés) dans les vues d'ensemble
afficher_composants = true;

// Position du plan de coupe (vue "coupe"), en mm sur l'axe X
coupe_x = 6.0;
// Repères (texte et traits) sur la vue "coupe"
etiquettes = true;

// Finesse des cercles : 48 pour travailler, 96 pour l'export STL
$fn = 48;



/* [Tolérances d'impression (à régler avec la pièce test_jeux)] */

// Les trous imprimés sortent plus petits que dessinés (le plastique
// déposé « bave » vers l'intérieur et les cercles sont des polygones).
// Valeurs usuelles en FDM buse 0,4 : +0,2 à +0,3 mm sur le diamètre.
jeu_trou    = 0.25;  // [CHOIX] trou vertical : diamètre dessiné = nominal + 0,25
// Un trou horizontal s'affaisse en plus sur le dessus (ponts) : on
// ajoute 0,1 mm et on lui donne une forme de goutte tronquée.
jeu_trou_h  = 0.35;  // [CHOIX] trou horizontal : nominal + 0,35
// Jeu par côté entre deux pièces imprimées qui coulissent (glissière,
// bride sur son tenon) : 0,2 à 0,4 mm par côté selon l'imprimante.
jeu_glissant = 0.3;  // [CHOIX] par côté
// Ajustement serré (cale dans le collier, composant tenu sans colle) :
jeu_serre   = 0.1;   // [CHOIX] par côté
// Jeu de pose autour des composants achetés (cartes, batterie) : leurs
// cotes varient de ±0,2 à ±0,3 mm d'un lot à l'autre.
jeu_pose    = 0.5;   // [CHOIX] par côté
// Jeu radial entre la jupe du couvercle et l'alésage de la coque : il
// fixe l'écrasement du joint, c'est la cote la plus sensible du boîtier.
jeu_joint   = 0.2;   // [CHOIX] par côté (vérifier avec essai_joint)
// Goutte tronquée : hauteur du plat au-dessus du cercle (pont court)
goutte_plat = 0.4;   // [CHOIX]


/* [Écran e-paper WeAct 1,54" 200x200 (SSD1681)] */

// Plan « WeAct-EpaperModule-1.54 Board Shape » (dépôt GitHub
// WeActStudio.EpaperModule, dossier Hardware). Échelle du PDF étalonnée
// sur le pas de 0,5 mm du connecteur de nappe 24 points (J1) :
// 14,40 points par mm, vérifiée sur le connecteur 1,25 mm (J2).
ep_pcb_x    = 32.6;   // [MESURÉ AU PLAN] largeur du circuit (bords droits à 32,6 mm d'écart)
ep_pcb_y    = 50.0;   // [MESURÉ AU PLAN] longueur du circuit (50,03 mm relevés)
ep_pcb_r    = 2.8;    // [MESURÉ AU PLAN] rayon des coins (bord droit de 44,4 mm : (50-44,4)/2)
ep_pcb_ep   = 1.6;    // [HYPOTHÈSE] épaisseur du circuit (le modèle 3D WeAct indique ≈1,6-1,7)
ep_trou_ex  = 27.0;   // [MESURÉ AU PLAN] entraxe des trous en X (26,94 mm relevés)
ep_trou_ey  = 44.4;   // [MESURÉ AU PLAN] entraxe des trous en Y (44,44 mm relevés)
ep_trou_d   = 2.2;    // [HYPOTHÈSE] diamètre des trous (vis M2)
ep_dalle_x  = 31.8;   // [FICHE] dalle 1,54" 200x200 : 31,8 x 37,32 x 1,05 mm (Good Display
ep_dalle_y  = 37.32;  // [FICHE]  GDEY0154D67) ; centrée sur le circuit [MESURÉ AU PLAN]
ep_dalle_ep = 1.05;   // [FICHE]
ep_scotch   = 0.15;   // [HYPOTHÈSE] adhésif entre dalle et circuit
ep_aa       = 27.6;   // [FICHE] zone active 27,6 x 27,6 mm
ep_aa_decal = 2.86;   // [HYPOTHÈSE] décalage de la zone active vers l'avant (côté opposé
                      // à la nappe, qui est à l'arrière). À MESURER : cadre noir affiché.
ep_dos_h    = 2.0;    // [HYPOTHÈSE] composants au dos (connecteur de nappe J1 compris)
ep_wafer_h  = 3.5;    // [HYPOTHÈSE] connecteur J2 au pas de 1,25 mm (WeAct « Wafer-125W-8P »)
ep_wafer_y  = 12.15;  // [MESURÉ AU PLAN] position de J2 (vers l'avant, côté opposé à la nappe)
// Le connecteur à broches livré avec le module n'est PAS soudé : les
// 8 fils sont soudés dans les trous P1, à l'avant du module.


/* [Vitre de l'écran] */

vitre_ep    = 1.0;    // [CHOIX] PMMA (plexiglas) ou polycarbonate de 1 mm
vitre_cote  = 31.0;   // [CHOIX] vitre carrée 31 x 31 mm (couvre la zone active + 1,1 mm de colle)
fenetre_marge = 0.6;  // [CHOIX] la fenêtre dépasse la zone active de 0,6 mm par côté


/* [Carte Seeed XIAO nRF52840] */

xiao_long   = 21.0;   // [FICHE] 21 x 17,8 mm (wiki Seeed, « XIAO_BLE »)
xiao_larg   = 17.8;   // [FICHE]
xiao_pcb    = 1.2;    // [HYPOTHÈSE] épaisseur du circuit
xiao_haut   = 3.5;    // [HYPOTHÈSE] hauteur des composants (prise USB-C 3,26 mm comprise)
usb_l       = 8.94;   // [FICHE] prise USB-C 16 broches montée en surface : 8,94 x 7,35 x 3,26
usb_p       = 7.35;   // [FICHE]  (cotes standard des prises « mid-size », ex. GCT USB4105)
usb_h       = 3.26;   // [FICHE]
usb_depasse = 1.0;    // [HYPOTHÈSE] la prise dépasse du circuit
xiao_garde  = 1.5;    // [CHOIX] garde sous la carte (fils soudés sur BAT+/BAT-, NFC1/NFC2)
xiao_pos    = [9.4, 13.5]; // [CHOIX] centre de la carte (à droite, vers l'avant : l'antenne,
                      // côté opposé à l'USB, n'est pas sous la batterie)


/* [Batterie LiPo 503035 500 mAh] */

bat_ep      = 5.0;    // [FICHE] 5,0 x 30 x 35 mm (le nom « 503035 » donne ces cotes)
bat_larg    = 30.0;   // [FICHE]
bat_long    = 35.0;   // [FICHE]
bat_pcb     = 3.0;    // [HYPOTHÈSE] carte de protection repliée au bout de la cellule
bat_y0      = -11.0;  // [CHOIX] bord arrière (juste devant les boutons)
bat_gonfle  = 1.5;    // [CHOIX] vide minimal au-dessus (gonflement d'une LiPo vieillissante)


/* [Buzzer actif 3 V] */

buz_d       = 12.0;   // [FICHE] Ø 12 x 9,5 mm (buzzer actif type TMB12A03)
buz_h       = 9.5;    // [FICHE]
buz_x       = -6.0;   // [CHOIX] position sur la face avant
membrane_ep = 1.2;    // [CHOIX] paroi amincie devant le buzzer (3 cordons de 0,4 mm)


/* [Boutons étanches 12 mm] */

bt_d        = 12.0;   // [FICHE] filetage M12 (perçage 12 mm indiqué par le vendeur)
bt_tete_d   = 15.0;   // [HYPOTHÈSE] tête extérieure avec son joint plat
bt_tete_h   = 9.0;    // [HYPOTHÈSE] hauteur de la tête hors du boîtier
bt_ecrou_d  = 16.5;   // [HYPOTHÈSE] écrou mesuré sur les angles
bt_ecrou_ep = 2.0;    // [HYPOTHÈSE]
bt_corps_d  = 13.0;   // [HYPOTHÈSE] corps derrière la paroi (cosses comprises)
bt_prof     = 17.0;   // [HYPOTHÈSE] longueur derrière la paroi
bt_entraxe  = 21.0;   // [CHOIX] écart entre les 2 boutons (face arrière, vers le cycliste)


/* [LED 3 mm] */

led_d       = 3.0;    // [FICHE] LED 3 mm (T-1)
led_collerette = 3.8; // [HYPOTHÈSE] collerette à la base (butée contre la paroi)
led_long    = 5.3;    // [HYPOTHÈSE] longueur du corps, dôme compris
led_blanche_y = 19.0; // [CHOIX] LED blanches latérales, vers l'avant (sous la batterie,
led_blanche_z = 11.0; // [CHOIX]  en arrière des coins arrondis de l'alésage)


/* [Connecteur magnétique de recharge 2 broches] */

cm_l        = 11.0;   // [HYPOTHÈSE] longueur de la face (fiche du vendeur absente)
cm_h        = 4.5;    // [HYPOTHÈSE] largeur de la face
cm_prof     = 5.0;    // [HYPOTHÈSE] profondeur (broches à souder comprises)
cm_pos      = [-12.0, -2.5]; // [CHOIX] sous le fond, à gauche : protégé de la pluie
                      // et des projections quand le boîtier est sur le vélo


/* [Câble du capteur de roue (reed) et plaquette] */

reed_cable_d = 2.5;   // [HYPOTHÈSE] diamètre du câble 2 fils
reed_serrage = 0.3;   // [CHOIX] le trou est plus petit que le câble : passe-fil serré
reed_y      = -4.0;   // [CHOIX] sortie sur le flanc gauche
reed_z      = 8.5;    // [CHOIX]
// Plaquette des MOSFET : X, Y, circuit, composants. Elle porte Q1, Q2, D1,
// D2, R1 à R8, C2, C3 et, depuis l'ajout de la coupure de la recharge,
// U4 (TPS22918, SOT-23-6), Q3 (2N7002, SOT-23), R10, R11 (100 kΩ) et R12
// (2,2 kΩ, échelle des boutons). Surface des pastilles ≈ 92 mm² ; pour
// souder au fer, on prévoit au moins 2 fois cette surface (pistes, fils,
// place de la panne) : 184 mm² > 12 x 14 = 168. Elle passe donc de 12 à
// 15 mm en X (210 mm²), en s'allongeant vers le centre (côté libre).
plaq        = [15, 14, 1.6, 2.4]; // [HYPOTHÈSE] plaquette des MOSFET : X, Y, circuit, composants
plaq_pos    = [-10.5, 11.0, 6.0]; // [CHOIX] centre en X et Y, dessous en Z (bord gauche inchangé)


/* [Baromètre BMP280 et évent à membrane] */

// Carte « GY-BMP280 » (capteur Bosch BMP280 + résistances de tirage),
// sans connecteur : 6 fils soudés directement dans ses trous. Elle mesure
// la pression de l'air (correction de l'altitude des capteurs de pneu) et
// la température intérieure (refus de la recharge par grand froid).
bmp_x       = 11.5;   // [HYPOTHÈSE] carte 11,5 x 15 mm (annonces courantes) : À MESURER
bmp_y       = 15.0;   // [HYPOTHÈSE]
bmp_pcb     = 1.6;    // [HYPOTHÈSE] épaisseur du circuit
bmp_haut    = 3.0;    // [HYPOTHÈSE] hauteur totale, circuit compris (le BMP280 seul : 0,95 mm [FICHE Bosch])
bmp_pos     = [0, -18.3]; // [CHOIX] centre de la carte : entre les 2 boutons, juste au-dessus
                      // de l'évent (seule zone libre du fond assez grande, hors du socle)
bmp_garde   = 1.0;    // [CHOIX] lame d'air entre la pastille et la carte
// Évent : un trou dans le fond, fermé à l'intérieur par une pastille
// autocollante à membrane ePTFE (l'air passe, l'eau non : IP67/IP68).
// Sans lui, le baromètre mesurerait l'air enfermé à la fermeture.
evt_d       = 3.0;    // [CHOIX] trou de l'évent (centré sous la carte du BMP280)
evt_assise_d = 12.0;  // [CHOIX] assise plane de la pastille (pastille + 1 mm de chaque côté)
evt_assise_h = 0.4;   // [CHOIX] 2 couches au-dessus du fond : surface neuve, repère de pose
evt_chanfrein = 0.5;  // [CHOIX] chanfrein extérieur à 45° : la patte d'éléphant ne
                      // rétrécit pas le trou, une goutte s'y accroche moins
pastille_d  = 10.0;   // [HYPOTHÈSE] pastille ePTFE Ø 10 (à mesurer à la réception)
pastille_ep = 0.3;    // [HYPOTHÈSE] membrane + adhésif


/* [Joint torique entre coque et couvercle] */

// Joint normalisé ISO 3601-1 classe A : 53 x 1,8 mm (diamètre intérieur
// x section), NBR 70 Shore A. Équivalent américain AS568-032
// (53,64 x 1,78). Si le kit commandé n'a pas cette taille : en acheter un
// (≈ 0,50 €) ; ne pas prendre plus petit que 51,5 x 1,8 (trop étiré).
jt_d        = 1.8;    // [FICHE] section nominale (ISO 3601-1)
jt_di       = 53.0;   // [FICHE] diamètre intérieur nominal
jt_prof     = 1.2;    // [CHOIX] profondeur de la gorge creusée dans la jupe
jt_fond_l   = 2.0;    // [CHOIX] largeur de la gorge au fond (flanc haut droit, flanc bas à 45°)
jt_garde_haut = 1.3;  // [CHOIX] matière entre le dessous du couvercle et la gorge
jt_garde_bas  = 0.4;  // [CHOIX] lèvre sous la gorge (retient le joint)
jt_chanfrein_bas = 0.3; // [CHOIX] chanfrein au bout de la jupe
entree_chanfrein = 0.5; // [CHOIX] chanfrein d'entrée de l'alésage (30° / verticale)


/* [Vis et inserts] */

// Inserts laiton à chaud M2 x 4 (Ø ext. ≈ 3,6 mm). Perçage conseillé :
// 3,2 mm (fiche PEM IUTB-M2 : 3,23 mm ; Ruthex M2 : 3,2 mm, à confirmer
// sur la fiche des inserts achetés). On NE compense PAS ce trou : l'insert
// chaud fait fondre la matière, c'est le fabricant qui donne la cote.
ins_trou_d  = 3.2;    // [FICHE]
ins_long    = 4.0;    // [FICHE]
ins_prof    = 5.0;    // [CHOIX] insert + 1 mm pour la matière refoulée
ins_matiere_min = 1.2;// [CHOIX] matière minimale autour de l'insert (3 cordons)
// Vis M2 x 6 tête fraisée 90° (DIN 965 / ISO 7046) : tête Ø 3,8 mm
vis_tete_d  = 3.8;    // [FICHE]
vis_passage_d = 2.4;  // [FICHE] passage M2, série moyenne ISO 273
// Écran : 4 vis autotaraudeuses pour plastique M2 x 5 (ou « PT 2,2 x 5 »)
ecr_vis_avant_trou = 1.7; // [FICHE] avant-trou conseillé pour Ø 2 dans les thermoplastiques
ecr_entretoise_d = 4.5;   // [CHOIX]
// Collier : vis M3 x 16 (DIN 912) et écrou M3 (DIN 934 : 5,5 sur plats, 2,4 mm)
m3_passage_d = 3.4;   // [FICHE] passage M3, série moyenne ISO 273
m3_tete_d   = 5.5;    // [FICHE] tête DIN 912
m3_ecrou_plats = 5.5; // [FICHE]
m3_ecrou_ep = 2.4;    // [FICHE]


/* [Forme extérieure du boîtier] */

ext_x       = 46.0;   // [CHOIX] largeur (≤ 46 : encombrement de la version 1)
ext_y       = 64.0;   // [CHOIX] longueur (≤ 64)
r_ext       = 5.5;    // [CHOIX] rayon des coins vus de dessus (limité par la matière
                      // autour des inserts : voir le calcul plus bas)
r_alesage   = 7.3;    // [CHOIX] rayon des coins de l'alésage (joint : ≥ 3 x section au fond)
r_jupe_int  = 4.2;    // [CHOIX] rayon intérieur de la jupe (doit laisser passer le circuit)
R_bombe     = 150;    // [CHOIX] rayon du bombé des flancs (vu de côté)
r_bas_x     = 9.0;    // [CHOIX] arrondi du bas sur les flancs (aspect « galet » vu de face),
                      // terminé par un chanfrein à 45° près du plateau (imprimable)
r_bas_y     = 3.0;    // [CHOIX] arrondi du bas à l'avant et à l'arrière (limité par l'écrou
                      // des boutons, posé tout près du fond)
r_haut      = 1.0;    // [CHOIX] arrondi du bord de la façade (idem)
rainure_v   = 0.5;    // [CHOIX] petite rainure en V sur la ligne de joint (cache le décalage)
plancher    = 2.0;    // [CHOIX] épaisseur du fond
couvercle_ep = 2.4;   // [CHOIX] épaisseur de la façade (1,4 mm au-dessus de la vitre)
chanf_int_x = 5.5;    // [CHOIX] chanfrein intérieur bas des flancs (garde 2 mm de paroi
chanf_int_y = 1.0;    //          malgré l'arrondi extérieur du bas)


/* [Fixation : collier, glissière, cales] */

cintre_d    = 22.2;   // [FICHE] cintre plat près des poignées (ISO 4210 : 22,2 mm)
cintres     = [22.2, 23.8, 25.4, 31.8]; // [FICHE] diamètres courants (cales prévues)
// Diamètre pour lequel le collier est imprimé. 31,8 (défaut) : un seul
// collier pour tous les cintres, avec une cale par diamètre. Pour un seul
// vélo à cintre de 22,2 mm, mettre 22.2 : collier plus petit, boîtier
// 5,5 mm plus bas, cale de 1,2 mm seulement.
collier_pour = 31.8;  // [CHOIX]
caoutchouc  = 1.0;    // [HYPOTHÈSE] bande de chambre à air entre cale et cintre
cale_min    = 1.2;    // [CHOIX] cale la plus fine (cintre de 31,8 mm)
collier_ep  = 3.5;    // [CHOIX] épaisseur de l'anneau
collier_larg = 14.0;  // [CHOIX] largeur le long du cintre (= largeur du rail)
fente       = 1.0;    // [CHOIX] écart entre collier et bride avant serrage
rail_bas    = 8.0;    // [CHOIX] queue d'aronde : largeur à la base
rail_h      = 3.0;    // [CHOIX] hauteur (flancs à 45° : largeur en haut 8 + 2 x 3 = 14)
rail_y      = [-17, -5]; // [CHOIX] partie en queue d'aronde (repère du collier)
lang_y      = [-5, 17];  // [CHOIX] languette élastique : encastrée à -5, libre jusqu'au bout du rail (17)
lang_ep     = 1.8;    // [CHOIX] épaisseur de la languette
lang_tirette = 26;    // [CHOIX] puis tirette jusqu'à 26 : elle dépasse sous l'avant du boîtier,
                      // on appuie dessus pour déverrouiller
cran_y      = [11, 14]; // [CHOIX] bosse du cran (rampe à l'arrière, face raide à l'avant)
cran_h      = 0.8;    // [CHOIX] hauteur de la bosse
decal_boitier = 9.0;  // [CHOIX] le boîtier est 9 mm en arrière de l'axe du cintre


// =====================================================================
//  DIMENSIONS CALCULÉES (elles découlent des paramètres)
// =====================================================================

/* [Hidden] */

// ---------- Jupe du couvercle et alésage (vu de dessus) ----------
// L'écran se loge dans la jupe ; la jupe porte la gorge du joint et
// entre dans l'alésage de la coque avec le jeu radial `jeu_joint`.
jupe_int = [ep_pcb_x + 2 * jeu_pose, ep_pcb_y + 2 * jeu_pose];          // 33,6 x 51,0
jupe_ep  = jt_prof + 1.4;                                                 // 2,6 (1,4 derrière la gorge)
jupe_ext = [jupe_int[0] + 2 * jupe_ep, jupe_int[1] + 2 * jupe_ep];        // 38,8 x 56,2
al       = [jupe_ext[0] + 2 * jeu_joint, jupe_ext[1] + 2 * jeu_joint];    // alésage 39,2 x 56,6
r_jupe_ext = r_alesage - jeu_joint;                                       // 7,1
r_fond   = r_jupe_ext - jt_prof;                                          // 5,9 au fond de gorge
paroi_x  = (ext_x - al[0]) / 2;                                           // 3,4
paroi_y  = (ext_y - al[1]) / 2;                                           // 3,7

// ---------- Hauteurs ----------
h_jupe   = jt_garde_haut + jt_fond_l + jt_prof + jt_garde_bas + jt_chanfrein_bas; // 5,2 (sous la façade)
// Les boutons imposent la hauteur : leur écrou (Ø 16,5 sur les angles)
// doit tenir entre le fond (+ chanfrein intérieur) et le bas de la jupe.
z_bt     = plancher + chanf_int_y + 0.3 + bt_ecrou_d / 2;                 // axe des boutons : 11,55
H        = ceil((z_bt + bt_ecrou_d / 2 + 0.3 + h_jupe + couvercle_ep) * 2) / 2; // 28,0
z_rim    = H - couvercle_ep;                                              // haut de la coque : 25,6
z_jupe_bas = z_rim - h_jupe;                                              // 20,4

// ---------- Joint torique radial ----------
// Gorge : flanc haut horizontal, fond vertical de 2,0 mm, flanc bas à 45°
// (imprimable couvercle retourné), profondeur 1,2 mm.
z_gorge_haut = z_rim - jt_garde_haut;                                     // 24,3
z_gorge_fond = z_gorge_haut - jt_fond_l;                                  // 22,3
z_gorge_bas  = z_gorge_fond - jt_prof;                                    // 21,1 (bas du flanc à 45°)
jt_ecart = jt_prof + jeu_joint;                                           // 1,4 entre fond de gorge et alésage
// Périmètre du fond de gorge (rectangle arrondi) et étirement du joint
fond = [jupe_ext[0] - 2 * jt_prof, jupe_ext[1] - 2 * jt_prof];
jt_perimetre = 2 * (fond[0] + fond[1]) - 8 * r_fond + 2 * PI * r_fond;   // 170,3 mm
jt_etirement = jt_perimetre / (PI * jt_di) - 1;                           // 2,3 %
// Un joint étiré s'amincit (volume constant) : d' ≈ d / sqrt(1 + étirement)
jt_d_reel = jt_d / sqrt(1 + jt_etirement);                                // 1,78 mm
jt_ecrasement = (jt_d_reel - jt_ecart) / jt_d_reel;                       // 21 %
// Remplissage : section du joint / section libre (gorge + jeu radial)
jt_aire_gorge = jt_prof * (jt_fond_l + jt_prof / 2) + jeu_joint * (jt_fond_l + jt_prof);
jt_remplissage = (PI * jt_d_reel * jt_d_reel / 4) / jt_aire_gorge;       // 66 %
// Sensibilité : ±0,1 mm sur l'écart (imprimante) change l'écrasement de
jt_ecras_min = (jt_d_reel - jt_ecart - 0.1) / jt_d_reel;
jt_ecras_max = (jt_d_reel - jt_ecart + 0.1) / jt_d_reel;
h_chanfrein_entree = entree_chanfrein / tan(30);                          // 0,87

// ---------- Inserts dans les coins (hors du joint) ----------
// Centre du coin de l'alésage et centre du coin extérieur ; l'insert est
// au milieu de la matière, sur la droite qui joint ces deux centres.
c_al  = [al[0] / 2 - r_alesage, al[1] / 2 - r_alesage];
c_ext = [ext_x / 2 - r_ext, ext_y / 2 - r_ext];
u_coin = (c_ext - c_al) / norm(c_ext - c_al);
p_al  = c_al + r_alesage * u_coin;                 // point de l'alésage
p_ext = c_ext + r_ext * u_coin;                    // point de la surface extérieure
ins_c = (p_al + p_ext) / 2;                        // centre de l'insert
// Détrompeur : un plot sous la façade, à l'arrière et décalé en X, entre
// dans un trou du bord de la coque. Façade à l'envers : le plot bute.
detromp = [8, -(al[1] / 2 + entree_chanfrein + (paroi_y - entree_chanfrein - rainure_v) / 2)];
ins_matiere = (norm(p_ext - p_al) - ins_trou_d) / 2;  // 1,28 mm de chaque côté
pos_ins = [for (sx = [-1, 1], sy = [-1, 1]) [sx * ins_c[0], sy * ins_c[1]]];

// ---------- Profil de l'enveloppe extérieure (vue de côté) ----------
// Décalage (mm, négatif = vers l'intérieur) de la surface extérieure par
// rapport au rectangle arrondi ext_x x ext_y, en fonction de la hauteur z :
//  - bombé des flancs : arc de grand rayon, le plus large à z_pic ;
//  - arrondi du bas (rayons r_bas_x / r_bas_y) prolongé par un chanfrein à 45° près du
//    plateau : aucune surface ne surplombe à plus de 45° (pas de support) ;
//  - même chose en haut, sur le bord de la façade (imprimée retournée).
z_pic = H - 5;
function bombe(z) = -pow(z - z_pic, 2) / (2 * R_bombe);
function conge(z, r) =                       // arrondi + chanfrein à 45°
    let(z45 = r * (1 - 1 / sqrt(2)))
    z >= r ? 0
  : z >= z45 ? -(r - sqrt(r * r - pow(r - z, 2)))
  : -(r - r / sqrt(2)) - (z45 - z);
function profil_x(z) = bombe(z) + conge(z, r_bas_x) + conge(H - z, r_haut);   // flancs
function profil_y(z) = bombe(z) + conge(z, r_bas_y) + conge(H - z, r_haut);   // avant, arrière

// ---------- Implantation intérieure ----------
ep_pcb_z  = z_rim - ep_dalle_ep - ep_scotch - ep_pcb_ep;   // dessous du circuit écran : 22,8
ep_dos_z  = ep_pcb_z - ep_dos_h;                           // 20,8
fen       = ep_aa + 2 * fenetre_marge;                     // fenêtre : 28,8 au ras de la vitre
bat_x     = bat_long + bat_pcb;                            // 38 (posée en travers)
bat_z     = ep_pcb_z - ep_wafer_h - 0.5 - bat_ep;          // 13,8 (sous le connecteur J2)
buz_z     = 12.0;                                          // axe du buzzer couché
plaq_z    = plaq_pos[2];
// Plats (lamages) extérieurs : la face bombée est dressée pour que le
// joint plat des boutons et la membrane du buzzer portent sur un plan.
y_plat_bt  = -(ext_y / 2 + profil_y(z_bt - bt_tete_d / 2));          // -30,80
y_plat_buz =   ext_y / 2 + profil_y(buz_z - buz_d / 2 - 0.5);         //  31,04
buz_y1     = y_plat_buz - membrane_ep;                              // face du buzzer

// ---------- Glissière sous le fond (repère du boîtier) ----------
gl_bas    = rail_bas / 2 + jeu_glissant;                   // demi-largeur à l'entrée : 4,3
gl_haut   = gl_bas + rail_h;                               // demi-largeur au fond : 7,3
gl_prof   = rail_h + jeu_glissant;                         // profondeur : 3,3
gl_plafond = 2.4;                                          // matière au-dessus (poche du cran : 1,4)
gl_z      = gl_prof + gl_plafond;                          // haut du socle intérieur : 5,7
gl_socle  = gl_haut + 2.0;                                 // demi-largeur du socle : 9,3
gl_y_arret = rail_y[0] + decal_boitier - 0.1;              // butée : -8,1
gl_y_aronde = rail_y[1] + decal_boitier - 0.5;             // fin de la queue d'aronde : 3,5
xiao_z    = gl_z + xiao_garde;                             // dessous de la XIAO : 7,2

// ---------- Évent et BMP280 (repère du boîtier) ----------
evt_pos   = bmp_pos;                                       // trou sous le centre de la carte
evt_z     = plancher + evt_assise_h;                       // dessus de l'assise : 2,4
bmp_z     = evt_z + pastille_ep + bmp_garde;               // dessous de la carte : 3,7
// Dessous du corps d'un bouton (cylindre d'axe Y) au-dessus du point
// d'abscisse x : la carte et ses équerres doivent passer dessous.
function z_corps_bt(x) =
    let(dx = abs(bt_entraxe / 2 - abs(x)), r = bt_corps_d / 2)
    dx >= r ? 99 : z_bt - sqrt(r * r - dx * dx);
bmp_marge = z_corps_bt(bmp_x / 2) - (bmp_z + bmp_haut);   // garde sous les boutons : 0,41

// ---------- Collier (repère du collier : origine sur l'axe du cintre) ----------
col_ri    = collier_pour / 2 + caoutchouc + cale_min + jeu_serre; // 18,2
col_ro    = col_ri + collier_ep;                           // 21,7
Zs        = col_ro + 1.5;                                  // dessus de la selle : 23,2
oreille_y = -(col_ro + 3.3);                               // axe de la vis M3 : -25,0
tenon_c   = [col_ro + 3.6, -1.2];                          // tenon avant (Y, Z)
tenon_r   = 3.0;

// Épaisseur de la cale pour un diamètre de cintre d
function cale_ep(d) = col_ri - jeu_serre - d / 2 - caoutchouc;


// =====================================================================
//  CONTRÔLES (règles de conception)
// =====================================================================

assert(plancher >= 2 && couvercle_ep - vitre_ep >= 1.2, "Fond < 2 mm ou façade < 1,2 mm devant la vitre");
assert(paroi_x >= 2 && paroi_y >= 2, "Parois latérales < 2 mm");
assert(jupe_ep - jt_prof >= 1.2, "Jupe trop fine derrière la gorge");
assert(r_fond >= 3 * jt_d, str("Coins de gorge trop serrés : ", r_fond, " < 3 x section"));
assert(jt_etirement >= 0.01 && jt_etirement <= 0.05, str("Étirement du joint hors 1-5 % : ", jt_etirement));
assert(jt_ecrasement >= 0.15 && jt_ecrasement <= 0.25, str("Écrasement hors 15-25 % : ", jt_ecrasement));
assert(jt_remplissage < 0.85, str("Gorge trop pleine : ", jt_remplissage));
assert(h_chanfrein_entree < jt_garde_haut, "Le chanfrein d'entrée descend jusqu'au joint");
assert(ins_matiere >= ins_matiere_min, str("Matière autour des inserts : ", ins_matiere));
// Le coin du circuit de l'écran doit passer dans la jupe (rayon r_jupe_int)
c_pcb = [ep_trou_ex / 2, ep_trou_ey / 2];
c_jupe = [jupe_int[0] / 2 - r_jupe_int, jupe_int[1] / 2 - r_jupe_int];
assert(norm(c_pcb - c_jupe) + ep_pcb_r <= r_jupe_int - 0.1, "Le coin de l'écran touche la jupe");
assert(bat_x / 2 + 0.3 <= al[0] / 2, "Batterie trop longue");
assert(bat_z + bat_ep + bat_gonfle <= ep_dos_z, "Pas assez de vide au-dessus de la batterie");
assert(bat_y0 >= -al[1] / 2 + bt_prof + 0.2, "La batterie touche le corps des boutons");
assert(xiao_z + xiao_pcb + xiao_haut + 1 <= bat_z, "La XIAO touche la batterie");
assert(bt_entraxe / 2 - bt_ecrou_d / 2 >= led_collerette / 2 + 0.3, "L'écrou des boutons touche la LED rouge");
assert(bt_entraxe / 2 + bt_tete_d / 2 <= ext_x / 2 - r_ext + 1.0, "Tête de bouton trop près du coin");
assert(cale_ep(collier_pour) >= cale_min - 0.01, "Cale trop fine");
assert(cintre_d <= collier_pour, "Le cintre est plus gros que le collier (changer collier_pour)");
assert(Zs - col_ro >= 1.2, "Selle trop fine");
// Évent et BMP280 : assise sur la partie plate du fond, en arrière du
// socle de la glissière ; carte libre sous les boutons, devant leurs écrous
assert(pastille_d <= evt_assise_d - 1, "La pastille déborde de son assise");
assert(abs(evt_pos[0]) + evt_assise_d / 2 <= al[0] / 2 - chanf_int_x
       && evt_pos[1] - evt_assise_d / 2 >= -al[1] / 2 + chanf_int_y, "L'assise de l'évent mord sur le chanfrein intérieur");
assert(evt_pos[1] + evt_assise_d / 2 <= gl_y_arret - 1.5, "L'assise de l'évent mord sur le socle de la glissière");
assert(evt_pos[1] + evt_d / 2 + evt_chanfrein + 2 <= gl_y_arret, "L'évent débouche dans la glissière");
assert(bmp_marge >= 0.2, str("Le BMP280 touche le corps d'un bouton (garde ", bmp_marge, ")"));
assert(bmp_z + bmp_pcb + 0.3 <= z_corps_bt(bmp_x / 2 + 0.3 + 1.2), "Les équerres du BMP280 touchent un bouton");
assert(bmp_pos[1] - bmp_y / 2 >= -al[1] / 2 + bt_ecrou_ep + 0.3, "Le BMP280 touche l'écrou d'un bouton");
assert(bmp_pos[1] + bmp_y / 2 + 0.3 <= min(bat_y0 + 1, gl_y_arret - 1.5), "Le BMP280 touche le plot de la batterie ou le socle");
// les plots d'angle de la carte restent hors de la pastille
assert(norm([bmp_x / 2 - 2, bmp_y / 2 - 2]) >= pastille_d / 2 + 0.5, "Les plots du BMP280 gênent la pastille");

echo(str("BOÎTIER : ", ext_x, " x ", ext_y, " x ", H, " mm ; alésage ", al[0], " x ", al[1],
         " ; parois ", paroi_x, " / ", paroi_y, " mm"));
echo(str("JOINT : ", jt_di, " x ", jt_d, " ; périmètre du fond ", round(jt_perimetre * 10) / 10,
         " mm ; étirement ", round(jt_etirement * 1000) / 10, " % ; écrasement ",
         round(jt_ecrasement * 1000) / 10, " % (", round(jt_ecras_min * 1000) / 10, " à ",
         round(jt_ecras_max * 1000) / 10, " % pour ±0,1 mm) ; remplissage ",
         round(jt_remplissage * 100), " %"));
echo(str("INSERTS : centre (", round(ins_c[0] * 100) / 100, ", ", round(ins_c[1] * 100) / 100,
         ") ; matière ", round(ins_matiere * 100) / 100, " mm de chaque côté"));
echo(str("CALES : ", [for (d = cintres) if (d <= collier_pour) round(cale_ep(d) * 100) / 100], " mm pour ",
         [for (d = cintres) if (d <= collier_pour) d], " ; collier imprimé pour ", collier_pour, " mm"));
echo(str("ÉVENT : Ø ", evt_d, " en (", evt_pos[0], ", ", evt_pos[1], ") sous le fond ; BMP280 de z = ", bmp_z,
         " à ", bmp_z + bmp_haut, " ; garde sous les boutons ", round(bmp_marge * 100) / 100, " mm"));



// =====================================================================
//  OUTILS DE DESSIN
// =====================================================================

// Rectangle aux coins arrondis, centré (2D)
module rect_arrondi(x, y, r) {
    rr = max(min(r, x / 2 - 0.01, y / 2 - 0.01), 0.01);
    offset(r = rr) square([x - 2 * rr, y - 2 * rr], center = true);
}

// Le même extrudé entre z0 et z1
module bloc(x, y, r, z0, z1) {
    translate([0, 0, z0]) linear_extrude(height = z1 - z0) rect_arrondi(x, y, r);
}

// Tranche très fine de l'enveloppe à la hauteur z (décalage d). On relie
// ensuite les tranches par hull() (enveloppe convexe) : c'est beaucoup
// plus rapide qu'un minkowski() et le résultat est exact, puisque la
// forme extérieure du boîtier est convexe.
module tranche(z, dx, dy) {
    translate([0, 0, z]) linear_extrude(height = 0.01)
        rect_arrondi(ext_x + 2 * dx, ext_y + 2 * dy, r_ext + min(dx, dy));
}

// Enveloppe extérieure du boîtier entre les hauteurs z0 et z1
module enveloppe(z0, z1) {
    pas = [0, 0.2, 0.5, 0.9, 1.4, 2, 2.7, 3.5, 4.3, 5, 5.8, 6.7, 7.8, 9, 11, 14, 17,
           20, 23, H - 3, H - 1, H - 0.7, H - 0.4, H - 0.15, H];
    zs = concat([z0], [for (z = pas) if (z > z0 + 0.05 && z < z1 - 0.05) z], [z1 - 0.01]);
    hull() for (z = zs) tranche(z, profil_x(z), profil_y(z));
}

// Trou horizontal en « goutte tronquée » : le haut du trou forme deux
// pentes à 45° puis un plat très court (pont), au lieu d'un demi-cercle
// qui s'affaisserait à l'impression. (2D : le haut de la goutte est +y)
module goutte2d(d) {
    r = d / 2;
    intersection() {
        hull() { circle(r = r); translate([0, r * sqrt(2) - 0.01]) square(0.02, center = true); }
        translate([-r, -r]) square([2 * r, 2 * r + goutte_plat]);
    }
}
// Trou horizontal d'axe Y (du point p vers -Y sur la longueur L)
module trou_y(p, d, L) { translate(p) rotate([90, 0, 0]) linear_extrude(height = L) goutte2d(d); }
// Trou horizontal d'axe X (du point p vers +X sur la longueur L)
module trou_x(p, d, L) { translate(p) rotate([90, 0, 90]) linear_extrude(height = L) goutte2d(d); }

// Cylindres couchés (fantômes des composants)
module cyl_y(p, d, L) { translate(p) rotate([-90, 0, 0]) cylinder(d = d, h = L); }
module cyl_x(p, d, L) { translate(p) rotate([0, 90, 0]) cylinder(d = d, h = L); }

// Bande en V qui creuse la ligne de joint entre coque et couvercle
module rainure_joint() {
    dx = profil_x(z_rim);  dy = profil_y(z_rim);
    difference() {
        bloc(ext_x + 10, ext_y + 10, r_ext, z_rim - rainure_v - 0.01, z_rim + rainure_v + 0.01);
        hull() {
            tranche(z_rim - rainure_v - 0.02, dx, dy);
            tranche(z_rim - 0.005, dx - rainure_v, dy - rainure_v);
            tranche(z_rim + rainure_v + 0.01, dx, dy);
        }
    }
}


// =====================================================================
//  COQUE (le corps)
// =====================================================================

// Volume intérieur : l'alésage (où frotte le joint) descend jusqu'au
// fond ; en bas, un chanfrein garde 2 mm de paroi malgré l'arrondi
// extérieur et s'imprime sans support.
// La cavité est faite de 2 volumes convexes (bas chanfreiné, puis droit).
module cavite_partie(i) {
    if (i == 0) hull() {
        bloc(al[0] - 2 * chanf_int_x, al[1] - 2 * chanf_int_y, r_alesage - chanf_int_y, plancher, plancher + 0.01);
        bloc(al[0], al[1], r_alesage, plancher + chanf_int_x, plancher + chanf_int_x + 0.01);
    }
    if (i == 1) bloc(al[0], al[1], r_alesage, plancher + chanf_int_x, H);
}
// Cavité « grossie » de g dans toutes les directions (minkowski d'un
// volume convexe et d'une sphère : calcul rapide) : sert au contrôle
// d'épaisseur de paroi (outil verifier-interferences.js).
module cavite_grossie(g) {
    for (i = [0, 1]) minkowski() { cavite_partie(i); sphere(r = g, $fn = 16); }
}
module cavite() {
    cavite_partie(0);
    cavite_partie(1);
    // chanfrein d'entrée à 30° : le joint entre sans être pincé
    hull() {
        bloc(al[0], al[1], r_alesage, z_rim - h_chanfrein_entree, z_rim - h_chanfrein_entree + 0.01);
        bloc(al[0] + 2 * entree_chanfrein, al[1] + 2 * entree_chanfrein, r_alesage + entree_chanfrein, z_rim, z_rim + 0.01);
    }
}

// Glissière femelle (repère du boîtier) : queue d'aronde à l'arrière,
// simple canal à l'avant (la languette du collier y fléchit librement).
module glissiere_femelle() {
    // queue d'aronde : entrée étroite au ras du fond, plus large en haut
    translate([0, gl_y_arret, 0]) rotate([90, 0, 0]) mirror([0, 0, 1])
        linear_extrude(height = gl_y_aronde - gl_y_arret + 0.01)
            polygon([[-gl_bas, -0.01], [gl_bas, -0.01], [gl_haut, rail_h], [gl_haut, gl_prof],
                     [-gl_haut, gl_prof], [-gl_haut, rail_h]]);
    // canal avant, ouvert sur la face avant
    translate([-gl_haut, gl_y_aronde, -0.01]) cube([2 * gl_haut, ext_y, gl_prof + 0.01]);
    // entrée chanfreinée du canal
    hull() {
        translate([-gl_haut, ext_y / 2 - 6, -0.01]) cube([2 * gl_haut, 0.01, gl_prof + 0.01]);
        translate([-gl_haut - 1.5, ext_y / 2 + 1, -0.01]) cube([2 * gl_haut + 3, 0.01, 0.01]);
    }
    // poche du cran (la bosse de la languette s'y loge)
    translate([-gl_haut, cran_y[0] + decal_boitier - 0.5, gl_prof - 0.01])
        cube([2 * gl_haut, cran_y[1] - cran_y[0] + 0.8, 1.0 + 0.01]);
}

// Aménagements intérieurs (ajoutés à la coque)
module amenagements() {
    // socle de la glissière (son plafond porte la XIAO)
    translate([-gl_socle, gl_y_arret - 1.5, plancher - 0.01])
        cube([2 * gl_socle, ext_y / 2 - gl_y_arret + 1.5, gl_z - plancher + 0.01]);

    // rebords qui portent la batterie (dessous à 45°), le long des flancs ;
    // à droite, le rebord s'arrête avant la XIAO
    for (s = [-1, 1]) {
        y1 = s < 0 ? led_blanche_y - led_collerette / 2 - 0.3 : xiao_pos[1] - xiao_long / 2 - 0.8;
        a = al[0] / 2 - bat_x / 2 + 1.6;     // avancée du rebord sous la batterie
        translate([0, y1, 0]) rotate([90, 0, 0])
            linear_extrude(height = y1 - bat_y0)
                polygon([[s * al[0] / 2, bat_z], [s * (al[0] / 2 - a), bat_z], [s * al[0] / 2, bat_z - a]]);
    }
    // plot d'appui central de la batterie (entre la XIAO et les boutons)
    translate([-2, bat_y0 + 1, gl_z - 0.01]) cube([4, 4, bat_z - gl_z + 0.01]);

    // berceau de la XIAO : 4 plots d'angle et 4 équerres de centrage
    for (sx = [-1, 1], sy = [-1, 1]) {
        px = xiao_pos[0] + sx * xiao_larg / 2;
        py = xiao_pos[1] + sy * xiao_long / 2;
        z0 = (px - sx * 2.5 < gl_socle) ? gl_z : plancher;
        translate([sx > 0 ? px - 2.5 : px, sy > 0 ? py - 2.5 : py, z0 - 0.01])
            cube([2.5, 2.5, xiao_z - z0 + 0.01]);
        translate([sx > 0 ? px + 0.3 : px - 1.5, sy > 0 ? py - 3 : py, z0 - 0.01])
            cube([1.2, 3, xiao_z + xiao_pcb - z0]);
    }

    // berceau du buzzer couché : deux selles en U posées sur le socle
    for (yy = [buz_y1 - buz_h + 1.0, buz_y1 - 3.0])
        difference() {
            translate([buz_x - buz_d / 2 - 1.2, yy, gl_z - 0.01]) cube([buz_d + 1.5, 2, buz_z - gl_z]);
            cyl_y([buz_x, yy - 1, buz_z], buz_d + 2 * jeu_serre, 4);
        }

    // bac à époxy autour du connecteur magnétique
    translate([cm_pos[0], cm_pos[1], plancher - 0.01])
        linear_extrude(height = cm_prof - plancher + 0.01)
            difference() {
                square([cm_h + jeu_trou + 2.4, cm_l + jeu_trou + 2.4], center = true);
                square([cm_h + jeu_trou, cm_l + jeu_trou], center = true);
            }

    // passe-fil du reed : tube intérieur qui allonge le serrage, dessous à 45°
    hull() {
        translate([-al[0] / 2 - 0.01, reed_y, reed_z]) rotate([0, 90, 0]) cylinder(d = 6, h = 4);
        translate([-al[0] / 2 - 0.01, reed_y - 3, reed_z - 3 - 4]) cube([0.01, 6, 0.01]);
    }

    // 2 plots sous la plaquette des MOSFET
    for (py = [plaq_pos[1] - plaq[1] / 2 + 2, plaq_pos[1] + plaq[1] / 2 - 2])
        translate([plaq_pos[0] - 4, py - 1.5, plancher - 0.01]) cube([3, 3, plaq_z - plancher + 0.01]);

    // assise plane de la pastille de l'évent (disque de 0,4 mm sur le fond)
    translate([evt_pos[0], evt_pos[1], plancher - 0.01]) cylinder(d = evt_assise_d, h = evt_assise_h + 0.01);

    // berceau du BMP280 (comme celui de la XIAO) : 4 plots d'angle, hors de
    // la pastille, et 4 équerres de centrage ; un point de silicone neutre
    // sur deux plots tient la carte
    for (sx = [-1, 1], sy = [-1, 1]) {
        px = bmp_pos[0] + sx * bmp_x / 2;
        py = bmp_pos[1] + sy * bmp_y / 2;
        translate([sx > 0 ? px - 2 : px, sy > 0 ? py - 2 : py, plancher - 0.01])
            cube([2, 2, bmp_z - plancher + 0.01]);
        translate([sx > 0 ? px + 0.3 : px - 1.5, sy > 0 ? py - 3 : py, plancher - 0.01])
            cube([1.2, 3, bmp_z + bmp_pcb - plancher + 0.01]);
    }
}

// Trous et creux de la coque
module percages_coque() {
    // inserts à chaud des 4 coins (cône d'entrée pour guider l'insert)
    for (p = pos_ins) translate([p[0], p[1], z_rim - ins_prof]) {
        cylinder(d = ins_trou_d, h = ins_prof + 0.01);
        translate([0, 0, ins_prof - 0.4]) cylinder(d1 = ins_trou_d, d2 = ins_trou_d + 0.8, h = 0.41);
    }
    // 2 boutons : trou en goutte tronquée et lamage plan à l'extérieur
    for (s = [-1, 1]) {
        trou_y([s * bt_entraxe / 2, -al[1] / 2 + 1, z_bt], bt_d + jeu_trou_h, paroi_y + 3);
        translate([s * bt_entraxe / 2, y_plat_bt, z_bt]) rotate([90, 0, 0])
            cylinder(d = bt_tete_d + 2, h = 5);
    }
    // logements des écrous des boutons : ils débordent dans les coins
    // arrondis de l'alésage, on creuse donc un peu la paroi épaisse des coins
    for (s = [-1, 1])
        trou_y([s * bt_entraxe / 2, -al[1] / 2 + bt_ecrou_ep + 0.4, z_bt], bt_ecrou_d + 0.6, bt_ecrou_ep + 0.4);
    // LED rouge d'alerte entre les boutons
    trou_y([0, -al[1] / 2 + 1, z_bt], led_d + jeu_trou_h, paroi_y + 3);
    // 2 LED blanches sur les flancs
    for (s = [-1, 1])
        trou_x([s > 0 ? al[0] / 2 - 1 : -ext_x / 2 - 1, led_blanche_y, led_blanche_z],
               led_d + jeu_trou_h, paroi_x + 3);
    // buzzer : creux intérieur jusqu'à la membrane + plat extérieur
    trou_y([buz_x, buz_y1, buz_z], buz_d + 2 * jeu_serre + 0.4, 3);
    translate([buz_x, y_plat_buz, buz_z]) rotate([-90, 0, 0]) cylinder(d = buz_d + 2, h = 5);
    // 3 petites alvéoles décoratives sur la membrane (non traversantes)
    for (dx = [-3, 0, 3]) translate([buz_x + dx, y_plat_buz + 0.01, buz_z]) rotate([90, 0, 0])
        cylinder(d = 1.6, h = 0.4);
    // connecteur magnétique dans le fond
    translate([cm_pos[0], cm_pos[1], -0.01])
        linear_extrude(height = cm_prof + 1) square([cm_h + jeu_trou, cm_l + jeu_trou], center = true);
    // passe-fil du reed : trou plus petit que le câble + cône à silicone
    trou_x([-ext_x / 2 - 2, reed_y, reed_z], reed_cable_d - reed_serrage, paroi_x + 8);
    translate([-ext_x / 2 - profil_x(reed_z) - 0.01, reed_y, reed_z]) rotate([0, 90, 0])
        cylinder(d1 = reed_cable_d + 2.5, d2 = reed_cable_d - reed_serrage, h = 1.5);
    // évent : trou vertical (fond + assise) et chanfrein extérieur à 45°
    translate([evt_pos[0], evt_pos[1], -0.01]) {
        cylinder(d = evt_d + jeu_trou, h = evt_z + 0.03);
        cylinder(d1 = evt_d + jeu_trou + 2 * evt_chanfrein, d2 = evt_d + jeu_trou, h = evt_chanfrein);
    }
    // glissière femelle
    glissiere_femelle();
    // trou du détrompeur (au-dessus de la zone d'appui du joint)
    translate([detromp[0], detromp[1], z_rim - 1.2]) cylinder(d = 1.5 + 2 * jeu_trou, h = 1.21);
    // encoche de démontage (tournevis plat) sur la ligne de joint, à l'avant
    translate([-4, ext_y / 2 - paroi_y - 0.5, z_rim - 1.0]) cube([8, paroi_y + 2, 1.01]);
}

module coque() {
    difference() {
        union() {
            difference() {
                enveloppe(0, z_rim);
                cavite();
            }
            intersection() {
                amenagements();
                bloc(al[0] + 0.02, al[1] + 0.02, r_alesage, 0, z_rim);
            }
        }
        percages_coque();
        rainure_joint();
    }
}


// =====================================================================
//  COUVERCLE (la façade) – dessiné à sa place sur la coque
// =====================================================================

module couvercle() {
    difference() {
        union() {
            // façade
            enveloppe(z_rim, H);
            // jupe qui porte la gorge du joint
            difference() {
                hull() {
                    bloc(jupe_ext[0], jupe_ext[1], r_jupe_ext, z_jupe_bas + jt_chanfrein_bas, z_rim + 0.01);
                    bloc(jupe_ext[0] - 2 * jt_chanfrein_bas, jupe_ext[1] - 2 * jt_chanfrein_bas,
                         r_jupe_ext - jt_chanfrein_bas, z_jupe_bas, z_jupe_bas + 0.01);
                }
                bloc(jupe_int[0], jupe_int[1], r_jupe_int, z_jupe_bas - 1, z_rim + 0.02);
                // gorge : flanc haut droit, fond vertical, flanc bas à 45°
                difference() {
                    bloc(jupe_ext[0] + 2, jupe_ext[1] + 2, r_jupe_ext + 1, z_gorge_bas, z_gorge_haut);
                    // matière gardée : le fond droit de la gorge...
                    bloc(fond[0], fond[1], r_fond, z_gorge_fond - 0.01, z_gorge_haut + 0.01);
                    // ...et le flanc bas à 45° (du fond jusqu'au bord de la jupe)
                    hull() {
                        bloc(fond[0], fond[1], r_fond, z_gorge_fond - 0.01, z_gorge_fond);
                        bloc(jupe_ext[0], jupe_ext[1], r_jupe_ext, z_gorge_bas - 0.01, z_gorge_bas);
                    }
                }
            }
            // plot du détrompeur
            translate([detromp[0], detromp[1], z_rim - 0.9]) cylinder(d = 1.5, h = 0.91);
            // 4 entretoises qui portent le circuit de l'écran
            for (sx = [-1, 1], sy = [-1, 1])
                translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2, ep_pcb_z + ep_pcb_ep])
                    cylinder(d = ecr_entretoise_d, h = z_rim - ep_pcb_z - ep_pcb_ep + 0.01);
        }
        // vis M2 fraisées des coins
        for (p = pos_ins) translate([p[0], p[1], 0]) {
            translate([0, 0, z_rim - 1]) cylinder(d = vis_passage_d, h = H);
            translate([0, 0, H - (vis_tete_d - vis_passage_d) / 2])
                cylinder(d1 = vis_passage_d, d2 = vis_tete_d + 0.01, h = (vis_tete_d - vis_passage_d) / 2 + 0.01);
        }
        // avant-trous des vis de l'écran (borgnes : 0,9 mm de peau dessus)
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2, ep_pcb_z])
                cylinder(d = ecr_vis_avant_trou, h = H - 0.9 - ep_pcb_z);
        // logement de la vitre, sous la façade (comme un trou : + jeu_trou)
        translate([0, ep_aa_decal, z_rim - 0.01]) linear_extrude(height = vitre_ep + 0.01)
            rect_arrondi(vitre_cote + 2 * jeu_trou, vitre_cote + 2 * jeu_trou, 0.5);
        // fenêtre évasée à 45° (aucune ombre sur l'écran vu de biais)
        hull() {
            translate([0, ep_aa_decal, z_rim + vitre_ep - 0.01]) linear_extrude(height = 0.01) rect_arrondi(fen, fen, 1);
            translate([0, ep_aa_decal, H]) linear_extrude(height = 0.01)
                rect_arrondi(fen + 2 * (H - z_rim - vitre_ep), fen + 2 * (H - z_rim - vitre_ep), 1 + H - z_rim - vitre_ep);
        }
        // nom gravé sur le bandeau sous l'écran
        translate([0, -ext_y / 2 + 9.5, H - 0.4]) linear_extrude(height = 0.5)
            text("TPMS", size = 3.6, font = "Liberation Sans:style=Bold", halign = "center", valign = "center", spacing = 1.15);
        rainure_joint();
    }
}


// =====================================================================
//  FIXATION : COLLIER, BRIDE, CALES (repère du collier)
// =====================================================================
//  Le cintre est selon X, son axe passe par l'origine. Le collier (haut)
//  porte la selle, le rail en queue d'aronde et la languette du cran.
//  La bride (bas) se glisse de côté sur le tenon avant du collier, passe
//  sous le cintre et se serre à l'arrière par une vis M3 + écrou noyé.
//  Presque tout est un profil (plan YZ) extrudé selon X : la pièce
//  s'imprime couchée sur une face latérale, sans support, et l'anneau
//  travaille dans le plan des couches (le plus solide en FDM).

// Extrusion d'un profil 2D (u = Y, v = Z) sur la largeur L selon X
module extrude_x(L) { rotate([90, 0, 90]) linear_extrude(height = L, center = true) children(); }

// Rectangle 2D aux coins arrondis défini par ses coins
module rect2d(y0, y1, z0, z1, r = 1) {
    translate([(y0 + y1) / 2, (z0 + z1) / 2]) rect_arrondi(y1 - y0, z1 - z0, r);
}

// Point d'attache de l'âme du tenon dans l'anneau du collier
ame_c = [col_ro - 1.7, 2.6];
// Direction de l'ouverture de la douille de la bride (vers l'âme)
douille_dir = atan2(ame_c[1] - tenon_c[1], ame_c[0] - tenon_c[0]);

module collier2d() {
    difference() {
        union() {
            // anneau + selle (enveloppe convexe), moitié haute seulement
            intersection() {
                hull() { circle(r = col_ro, $fn = 2 * $fn); translate([-17, Zs - 2.5]) square([34, 2.5]); }
                translate([-60, fente / 2]) square([120, 60]);
            }
            // oreille arrière (écrou noyé)
            rect2d(oreille_y - 3.8, -col_ri - 0.5, fente / 2, 8.5, 1);
            // âme et tenon avant
            hull() { translate(ame_c) circle(r = 1.8); translate(tenon_c) circle(r = 1.8); }
            translate(tenon_c) circle(r = tenon_r);
        }
        circle(r = col_ri, $fn = 2 * $fn);
    }
}

module bride2d() {
    difference() {
        bride2d_brut();
        // dégagement (jeu glissant) autour de l'âme du collier
        offset(delta = jeu_glissant) hull() { translate(ame_c) circle(r = 1.8); translate(tenon_c) circle(r = 1.8); }
    }
}
module bride2d_brut() {
    difference() {
        union() {
            intersection() {
                difference() { circle(r = col_ro, $fn = 2 * $fn); circle(r = col_ri, $fn = 2 * $fn); }
                translate([-60, -60]) square([120, 60 - fente / 2]);
            }
            // oreille arrière (tête de vis)
            rect2d(oreille_y - 3.8, -col_ri - 0.5, -8.5, -fente / 2, 1);
            // douille autour du tenon, ouverte vers l'âme du collier
            translate(tenon_c) difference() {
                circle(r = tenon_r + jeu_glissant + 2.5);
                circle(r = tenon_r + jeu_glissant);
                rotate(douille_dir) polygon([[0, 0], [20, -20], [20, 20]]);   // ouverture de 90°
            }
        }
        circle(r = col_ri, $fn = 2 * $fn);
    }
}

// Rail mâle : queue d'aronde (arrière) + languette élastique avec sa bosse
module rail_et_languette() {
    // queue d'aronde, base posée sur la selle
    translate([0, rail_y[1], 0]) rotate([90, 0, 0])
        linear_extrude(height = rail_y[1] - rail_y[0])
            polygon([[-rail_bas / 2, Zs - 0.01], [rail_bas / 2, Zs - 0.01],
                     [rail_bas / 2 + rail_h, Zs + rail_h], [-rail_bas / 2 - rail_h, Zs + rail_h]]);
    // languette : prolonge le haut du rail, libre au-dessus de la selle
    translate([-collier_larg / 2, lang_y[0] - 0.01, Zs + rail_h - lang_ep])
        cube([collier_larg, lang_tirette - lang_y[0] + 0.01, lang_ep]);
    // bosse du cran : rampe côté arrière, face raide côté avant
    translate([0, 0, Zs + rail_h - 0.01]) rotate([90, 0, 90])
        linear_extrude(height = collier_larg, center = true)
            polygon([[cran_y[0], 0], [cran_y[1] - 0.8, cran_h], [cran_y[1], cran_h], [cran_y[1], 0]]);
    // nervure sous le doigt, au bout de la tirette (hors du boîtier)
    translate([-collier_larg / 2, lang_tirette - 2.5, Zs + rail_h - 0.01]) cube([collier_larg, 2.5, 1.0]);
}

module collier() {
    difference() {
        union() {
            extrude_x(collier_larg) collier2d();
            intersection() {
                rail_et_languette();
                translate([-collier_larg / 2, -50, 0]) cube([collier_larg, 100, 100]);
            }
        }
        // vis M3 verticale (trou en goutte : la pointe vers le haut d'impression, +X)
        translate([0, oreille_y, -1]) rotate([0, 0, -90]) linear_extrude(height = 12) goutte2d(m3_passage_d);
        // écrou M3 noyé : fente ouverte sur la face +X, l'écrou s'y glisse
        translate([-m3_ecrou_plats / cos(30) / 2 - 0.2, oreille_y - (m3_ecrou_plats + 0.3) / 2, 4.4])
            cube([20, m3_ecrou_plats + 0.3, m3_ecrou_ep + 0.3]);
    }
}

module bride() {
    difference() {
        extrude_x(collier_larg) bride2d();
        translate([0, oreille_y, -12]) rotate([0, 0, -90]) linear_extrude(height = 12) goutte2d(m3_passage_d);
        // lamage de la tête de vis (DIN 912 : Ø 5,5)
        translate([0, oreille_y, -8.5 - 0.01]) rotate([0, 0, -90]) linear_extrude(height = 3.2) goutte2d(m3_tete_d + 0.5);
    }
}

// Demi-cale pour un cintre de diamètre d (imprimer 2 exemplaires).
// Lèvre plate d'un côté (posée sur le plateau), lèvre à 45° de l'autre.
module cale(d) {
    R = col_ri - jeu_serre;
    r = d / 2 + caoutchouc;
    L = collier_larg / 2 + 0.2;
    intersection() {
        difference() {
            union() {
                rotate([0, 90, 0]) cylinder(r = R, h = 2 * L, center = true, $fn = 2 * $fn);
                translate([-L - 1.2, 0, 0]) rotate([0, 90, 0]) cylinder(r = R + 1.5, h = 1.21, $fn = 2 * $fn);
                translate([L - 0.01, 0, 0]) rotate([0, 90, 0]) cylinder(r1 = R + 1.2, r2 = R, h = 1.2, $fn = 2 * $fn);
            }
            rotate([0, 90, 0]) cylinder(r = r, h = 4 * L, center = true, $fn = 2 * $fn);
        }
        translate([-20, -30, fente / 2 + 0.1]) cube([40, 60, 30]);
    }
}


// =====================================================================
//  PIÈCES DE RÉGLAGE
// =====================================================================

// test_jeux : ≈ 20 min, 8 g. Repères : 1, 2 ou 3 encoches sur le dessus de
// la paroi = 1re, 2e ou 3e valeur (de gauche à droite). Garder la valeur
// qui donne le bon ajustement et la reporter dans « Tolérances ».
//  - 3 trous de bouton Ø 12 en goutte tronquée (+0,15 / +0,35 / +0,55) ;
//  - 3 trous de LED Ø 3 (+0,15 / +0,35 / +0,55) ;
//  - 3 bossages d'insert M2 (perçage 3,0 / 3,2 / 3,4) ;
//  - 3 trous de vis M3 (3,2 / 3,4 / 3,6) et 3 logements d'écrou
//    (5,6 / 5,8 / 6,0 sur plats) ;
//  - 3 glissières femelles (jeu 0,2 / 0,3 / 0,4 par côté), entrée sur le
//    plateau comme sous la coque, et un échantillon de rail mâle imprimé
//    couché comme sur le collier (attaché par 2 languettes à casser).
module glissiere_essai(j, L) {
    rotate([-90, 0, 0]) mirror([0, 1, 0]) linear_extrude(height = L)
        polygon([[-rail_bas / 2 - j, -0.01], [rail_bas / 2 + j, -0.01], [rail_bas / 2 + j + rail_h, rail_h],
                 [rail_bas / 2 + j + rail_h, rail_h + j], [-rail_bas / 2 - j - rail_h, rail_h + j],
                 [-rail_bas / 2 - j - rail_h, rail_h]]);
}
module test_jeux() {
    e = 2.6;                                  // comme la paroi arrière de la coque
    vals = [0.15, 0.35, 0.55];
    difference() {
        union() {
            cube([66, 30, 1.6]);                              // semelle
            cube([66, e, 17.5]);                              // paroi
            for (i = [0 : 2]) translate([8 + 9 * i, 8.5, 0]) cylinder(d = 7.5, h = 6);  // inserts
            translate([33, 17, 0]) cube([33, 13, 4.7]);       // bloc des glissières
            translate([2, 15, 0]) cube([28, 8, 4]);           // bloc des vis M3
        }
        for (i = [0 : 2]) {
            trou_y([9 + 14.5 * i, e + 1, 9.3], bt_d + vals[i], e + 2);
            for (k = [0 : i]) translate([6 + 14.5 * i + 2.5 * k, -1, 16.6]) cube([1, e + 2, 1]);
            trou_y([52 + 5 * i, e + 1, 9.3], led_d + vals[i], e + 2);
            translate([8 + 9 * i, 8.5, 1]) cylinder(d = [3.0, 3.2, 3.4][i], h = 6);
            translate([7 + 9 * i, 19, -1]) cylinder(d = [3.2, 3.4, 3.6][i], h = 7);
            translate([7 + 9 * i, 19, 1.6]) cylinder(d = (m3_ecrou_plats + [0.1, 0.3, 0.5][i]) / cos(30), h = 5, $fn = 6);
            translate([38.5 + 9.5 * i, 16, 0]) glissiere_essai([0.2, 0.3, 0.4][i], 15);
        }
    }
    // échantillon de rail mâle (selle de 2 mm + queue d'aronde), couché
    translate([8, 32.5, collier_larg / 2]) rotate([0, -90, 0]) {
        translate([-collier_larg / 2, 0, -2]) cube([collier_larg, 12, 2]);
        rotate([90, 0, 0]) mirror([0, 0, 1]) linear_extrude(height = 12)
            polygon([[-rail_bas / 2, -0.01], [rail_bas / 2, -0.01], [rail_bas / 2 + rail_h, rail_h],
                     [-rail_bas / 2 - rail_h, rail_h]]);
    }
    for (x = [8.2, 9.2]) translate([x, 29.9, 0]) cube([0.6, 2.7, 0.6]);   // attaches à casser
}

// essai_joint : les 8 mm du haut de la coque (alésage, chanfrein, inserts)
// pour essayer le joint et le couvercle avant d'imprimer la coque entière.
module essai_joint() {
    intersection() {
        coque();
        bloc(ext_x + 2, ext_y + 2, r_ext, z_rim - 8, z_rim + 1);
    }
}


// =====================================================================
//  COMPOSANTS « FANTÔMES » (jamais exportés en STL)
// =====================================================================
//  Chaque composant est un volume simple à ses cotes nominales. Ils
//  servent aux vues et au CONTRÔLE D'INTERFÉRENCE : l'intersection d'un
//  fantôme avec une pièce imprimée doit être vide (outil
//  outils/verifier-interferences.js). Repère du boîtier sauf mention.
//  Les composants qui s'appuient sur une pièce (batterie sur ses rebords,
//  dalle contre la vitre...) sont dessinés à 0,01 mm de leur appui : le
//  contrôle ne compte ainsi que les vraies collisions.

// Joint torique écrasé dans sa gorge (section elliptique de même aire,
// 1,4 mm radialement), posé contre le flanc haut. Il est rétréci de
// 0,02 mm : il TOUCHE volontairement le fond de gorge et l'alésage.
module joint_torique() {
    a = jt_ecart / 2 - 0.02;                            // demi-axe radial
    b = (jt_d_reel * jt_d_reel / 4) / (jt_ecart / 2) - 0.02; // demi-axe vertical
    zc = z_gorge_haut - b - 0.03;
    for (k = [-5 : 4]) {
        z0 = zc + b * k / 5;  z1 = zc + b * (k + 1) / 5;
        w = a * sqrt(max(0, 1 - pow(max(abs(k), abs(k + 1)) / 5, 2)));   // demi-largeur prudente
        if (w > 0.02)
            translate([0, 0, z0]) linear_extrude(height = z1 - z0) difference() {
                rect_arrondi(fond[0] + 2 * (jt_ecart / 2 + w), fond[1] + 2 * (jt_ecart / 2 + w), r_fond + jt_ecart / 2 + w);
                rect_arrondi(fond[0] + 2 * (jt_ecart / 2 - w), fond[1] + 2 * (jt_ecart / 2 - w), r_fond + jt_ecart / 2 - w);
            }
    }
}

// Liste des fantômes du boîtier (nom, couleur)
fantomes_boitier = ["ecran", "vitre", "xiao", "batterie", "buzzer", "boutons", "led_rouge",
                    "led_blanches", "connecteur", "plaquette", "cable_reed", "joint",
                    "vis_couvercle", "inserts", "vis_ecran", "bmp280", "pastille_event"];
fantomes_collier = ["cintre", "caoutchouc", "vis_collier", "ecrou_collier"];
// Volume de contrôle (jamais affiché) : l'air de l'évent, dans le trou et
// sous le boîtier. Aucune pièce ne doit le toucher (trou bien débouché,
// évent ni bouché par la coque, ni masqué par le collier ou la bride).
volumes_controle = ["air_event"];

module fantome(nom) {
    if (nom == "ecran") {
        // dalle (contre la vitre), adhésif, circuit, dos, connecteur J2
        translate([0, 0, z_rim - ep_dalle_ep - ep_scotch]) linear_extrude(height = ep_dalle_ep + ep_scotch - 0.01)
            square([ep_dalle_x, ep_dalle_y], center = true);
        translate([0, 0, ep_pcb_z]) linear_extrude(height = ep_pcb_ep - 0.01) difference() {
            rect_arrondi(ep_pcb_x, ep_pcb_y, ep_pcb_r);
            for (sx = [-1, 1], sy = [-1, 1]) translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2]) circle(d = ep_trou_d);
        }
        translate([0, 0, ep_dos_z]) linear_extrude(height = ep_dos_h + 0.01) difference() {
            rect_arrondi(ep_pcb_x - 2, ep_pcb_y - 2 * 5.2, 1);
        }
        translate([-6.5, ep_wafer_y - 3.2, ep_pcb_z - ep_wafer_h]) cube([13, 6.4, ep_wafer_h + 0.01]);
    }
    if (nom == "vitre")
        translate([0, ep_aa_decal, z_rim + vitre_ep / 2]) cube([vitre_cote, vitre_cote, vitre_ep - 0.02], center = true);
    if (nom == "xiao") {
        translate([xiao_pos[0] - xiao_larg / 2, xiao_pos[1] - xiao_long / 2, xiao_z + 0.01]) {
            cube([xiao_larg, xiao_long, xiao_pcb]);
            translate([1, 2, xiao_pcb]) cube([xiao_larg - 2, xiao_long - 4, xiao_haut - 0.5]);
        }
        // prise USB-C côté arrière, qui dépasse du circuit
        translate([xiao_pos[0] - usb_l / 2, xiao_pos[1] - xiao_long / 2 - usb_depasse, xiao_z + xiao_pcb])
            cube([usb_l, usb_p, usb_h]);
    }
    if (nom == "batterie")
        translate([-bat_x / 2, bat_y0, bat_z + 0.01]) cube([bat_x, bat_larg, bat_ep]);
    if (nom == "buzzer") cyl_y([buz_x, buz_y1 - buz_h - 0.01, buz_z], buz_d, buz_h);
    if (nom == "boutons") for (s = [-1, 1]) {
        translate([s * bt_entraxe / 2, y_plat_bt - 0.01, z_bt]) rotate([90, 0, 0]) {
            cylinder(d = bt_tete_d, h = bt_tete_h * 0.45, $fn = 6);                    // tête à 6 pans
            cylinder(d = bt_tete_d * 0.72, h = bt_tete_h);                             // capuchon
        }
        cyl_y([s * bt_entraxe / 2, y_plat_bt - 0.01, z_bt], bt_d, -y_plat_bt - al[1] / 2 + 0.02); // filetage
        cyl_y([s * bt_entraxe / 2, -al[1] / 2 + 0.01, z_bt], bt_ecrou_d, bt_ecrou_ep);       // écrou
        cyl_y([s * bt_entraxe / 2, -al[1] / 2 + bt_ecrou_ep, z_bt], bt_corps_d, bt_prof - bt_ecrou_ep); // corps
    }
    if (nom == "led_rouge") {
        cyl_y([0, -al[1] / 2 - (led_long - 1) - 0.02, z_bt], led_d, led_long);
        cyl_y([0, -al[1] / 2 + 0.01, z_bt], led_collerette, 1);
    }
    if (nom == "led_blanches") for (s = [-1, 1]) {
        translate([s * (al[0] / 2 - 1) , led_blanche_y, led_blanche_z]) rotate([0, s * 90, 0])
            cylinder(d = led_d, h = led_long);
        translate([s * (al[0] / 2 - 1), led_blanche_y, led_blanche_z]) rotate([0, s * 90, 0])
            cylinder(d = led_collerette, h = 0.99);
    }
    if (nom == "connecteur")
        translate([cm_pos[0], cm_pos[1], 0]) linear_extrude(height = cm_prof) square([cm_h, cm_l], center = true);
    if (nom == "plaquette")
        translate([plaq_pos[0] - plaq[0] / 2, plaq_pos[1] - plaq[1] / 2, plaq_z + 0.01]) {
            cube([plaq[0], plaq[1], plaq[2]]);
            translate([1, 1, plaq[2]]) cube([plaq[0] - 2, plaq[1] - 2, plaq[3]]);
        }
    if (nom == "cable_reed")
        cyl_x([-ext_x / 2 - 12, reed_y, reed_z], reed_cable_d - reed_serrage - 0.05, 12 + paroi_x + 4);
    if (nom == "joint") joint_torique();
    if (nom == "vis_couvercle") for (p = pos_ins) translate([p[0], p[1], 0]) {
        translate([0, 0, H - 0.05 - (vis_tete_d - 2.2) / 2]) cylinder(d1 = 2, d2 = vis_tete_d - 0.2, h = (vis_tete_d - 2.2) / 2);
        translate([0, 0, H - 6]) cylinder(d = 2, h = 6);
    }
    if (nom == "inserts") for (p = pos_ins) translate([p[0], p[1], z_rim - ins_long]) difference() {
        cylinder(d = ins_trou_d - 0.02, h = ins_long);
        translate([0, 0, -1]) cylinder(d = 2.2, h = ins_long + 2);
    }
    if (nom == "vis_ecran") for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2, ep_pcb_z - 1.3]) {
            cylinder(d = 3.8, h = 1.3);
            cylinder(d = ecr_vis_avant_trou - 0.05, h = 5);
        }
    if (nom == "bmp280")   // posée sur ses plots, composants au-dessus (retrait de 1 mm)
        translate([bmp_pos[0] - bmp_x / 2, bmp_pos[1] - bmp_y / 2, bmp_z + 0.01]) {
            cube([bmp_x, bmp_y, bmp_pcb]);
            translate([1, 1, bmp_pcb]) cube([bmp_x - 2, bmp_y - 2, bmp_haut - bmp_pcb]);
        }
    if (nom == "pastille_event")   // collée sur son assise
        translate([evt_pos[0], evt_pos[1], evt_z + 0.01]) cylinder(d = pastille_d, h = pastille_ep - 0.01);
    if (nom == "air_event") translate([evt_pos[0], evt_pos[1], 0]) {
        // colonne d'air dans le trou, jusqu'à la pastille
        translate([0, 0, -1]) cylinder(d = evt_d - 0.05, h = evt_z + 1 - 0.01);
        // dégagement sous le boîtier : Ø 8 mm sur 12 mm de haut
        translate([0, 0, -12]) cylinder(d = 8, h = 12 - 0.01);
    }
    // --- fantômes dans le repère du COLLIER ---
    if (nom == "cintre") rotate([0, 90, 0]) cylinder(d = cintre_d, h = 70, center = true);
    if (nom == "caoutchouc") rotate([0, 90, 0]) difference() {
        cylinder(d = cintre_d + 2 * caoutchouc - 0.02, h = collier_larg + 2, center = true);
        cylinder(d = cintre_d + 0.02, h = collier_larg + 4, center = true);
    }
    if (nom == "vis_collier") translate([0, oreille_y, 0]) {
        translate([0, 0, -8.5 + 3.2 - 3.01]) cylinder(d = m3_tete_d, h = 3);
        translate([0, 0, -8.5 + 3.2]) cylinder(d = 3, h = 14);
    }
    if (nom == "ecrou_collier") translate([0, oreille_y, 4.4 + 0.15])
        rotate([0, 0, 0]) difference() {
            cylinder(d = m3_ecrou_plats / cos(30), h = m3_ecrou_ep, $fn = 6);
            translate([0, 0, -1]) cylinder(d = 3.1, h = 5);
        }
}

couleurs = [["ecran", [0.86, 0.86, 0.82]], ["vitre", [0.75, 0.9, 1, 0.25]], ["xiao", "royalblue"],
            ["batterie", "silver"], ["buzzer", "dimgray"], ["boutons", [0.15, 0.15, 0.15]],
            ["led_rouge", "red"], ["led_blanches", "white"], ["connecteur", "gold"],
            ["plaquette", "seagreen"], ["cable_reed", "black"], ["joint", "orangered"],
            ["vis_couvercle", "lightgray"], ["inserts", "goldenrod"], ["vis_ecran", "lightgray"],
            ["cintre", [0.25, 0.25, 0.27]], ["caoutchouc", [0.08, 0.08, 0.08]],
            ["vis_collier", "lightgray"], ["ecrou_collier", "lightgray"],
            ["bmp280", [0.45, 0.22, 0.62]], ["pastille_event", "white"]];
function couleur(n) = couleurs[search([n], couleurs)[0]][1];

// Image affichée sur l'e-paper (vues seulement) : pressions et batterie
module affichage_epaper() {
    color([0.08, 0.08, 0.08]) translate([0, ep_aa_decal, z_rim - 0.006]) linear_extrude(height = 0.004) {
        translate([-12.5, 6]) text("AV", size = 2.6, font = "Liberation Sans:style=Bold");
        translate([12.5, 4.6]) text("2.1", size = 6.2, font = "Liberation Sans:style=Bold", halign = "right");
        translate([-12.5, -4]) text("AR", size = 2.6, font = "Liberation Sans:style=Bold");
        translate([12.5, -5.4]) text("2.4", size = 6.2, font = "Liberation Sans:style=Bold", halign = "right");
        translate([-12.5, -11.8]) text("bar   18 km/h", size = 2.2, font = "Liberation Sans");
        translate([-13, 0]) square([26, 0.3]);
        translate([7.5, -11.8]) difference() { square([4, 2]); translate([0.3, 0.3]) square([3.4, 1.4]); }
        translate([7.8, -11.5]) square([2.5, 1.4]);
        translate([11.5, -11.3]) square([0.4, 1]);
    }
}

module composants_boitier(sans_ecran = false) {
    for (n = fantomes_boitier) if (!(sans_ecran && (n == "ecran" || n == "vitre" || n == "joint" || n == "vis_ecran")))
        color(couleur(n)) fantome(n);
}


// =====================================================================
//  ASSEMBLAGES ET CHOIX DE LA PIÈCE
// =====================================================================

c_coque = [0.36, 0.37, 0.40];        // PETG gris anthracite
c_facade = [0.21, 0.21, 0.23];       // façade plus foncée
c_collier = [0.30, 0.31, 0.34];
c_cale = [0.55, 0.45, 0.85];         // violet (accent du projet)

// Le boîtier dans le repère du collier
module au_collier() { translate([0, -decal_boitier, Zs]) children(); }

module cp(c) { color(c) children(); }

// ---------- Coupe (plan X = coupe_x), dessinée à plat en couleurs ----------
// projection(cut = true) donne la section exacte de chaque pièce dans le
// plan de coupe ; le repère de la coupe est : horizontale = Y (avant à
// droite), verticale = Z (repère du collier : 0 sur l'axe du cintre).
module section(c, k) {
    color(c) translate([0, 0, 0.01 * k]) linear_extrude(height = 0.01)
        projection(cut = true) multmatrix([[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, -coupe_x], [0, 0, 0, 1]]) children();
}
module etiquette(txt, p, q) {   // texte en p, trait jusqu'au point q
    color([0.92, 0.92, 0.95]) translate([0, 0, 0.5]) linear_extrude(height = 0.01) {
        translate(p) text(txt, size = 2.0, font = "Liberation Sans", valign = "center", halign = p[0] < q[0] ? "right" : "left");
        hull() { translate(p + [p[0] < q[0] ? 0.8 : -0.8, 0]) circle(d = 0.25, $fn = 8); translate(q) circle(d = 0.25, $fn = 8); }
        translate(q) circle(d = 0.8, $fn = 12);
    }
}
module coupe2d() {
    section([0.58, 0.59, 0.63], 1) au_collier() coque();
    section([0.40, 0.40, 0.44], 2) au_collier() couvercle();
    section([0.50, 0.51, 0.55], 3) collier();
    section([0.50, 0.51, 0.55], 4) bride();
    section(c_cale, 5) cale(cintre_d);
    section(c_cale, 6) rotate([180, 0, 0]) cale(cintre_d);
    k0 = 10;
    for (i = [0 : len(fantomes_boitier) - 1])
        section(fantomes_boitier[i] == "boutons" ? [0.1, 0.1, 0.1] : couleur(fantomes_boitier[i]), k0 + i) au_collier() fantome(fantomes_boitier[i]);
    for (i = [0 : len(fantomes_collier) - 1]) section(couleur(fantomes_collier[i]), 30 + i) fantome(fantomes_collier[i]);
    // repères (coordonnées de la coupe : [Y, Z] du repère du collier)
    if (etiquettes) reperes_coupe();
}
module reperes_coupe() {
    zb = Zs;  yb = -decal_boitier;
    gy = yb - ext_y / 2 - 9;  dy = yb + ext_y / 2 + 9;     // colonnes des étiquettes
    etiquette(str("joint torique ", jt_di, " x ", jt_d, " NBR"), [gy, zb + 33], [yb - jupe_ext[1] / 2 + jt_ecart / 2 - 0.1, zb + z_gorge_haut - 1.1]);
    etiquette("façade (couvercle)", [gy, zb + 29], [yb - 24, zb + z_rim + 1.2]);
    etiquette("coque", [gy, zb + 25], [yb - ext_y / 2 + 1.5, zb + z_rim - 3]);
    etiquette("bouton étanche 12 mm", [gy, zb + 17], [yb - ext_y / 2 - 3, zb + z_bt + 2]);
    etiquette("vitre PMMA 1 mm", [dy, zb + 33], [yb + 12, zb + z_rim + 0.5]);
    etiquette("écran e-paper 1,54\"", [dy, zb + 29], [yb + 14, zb + ep_pcb_z + 0.8]);
    etiquette("batterie LiPo 503035", [dy, zb + 21], [yb + 10, zb + bat_z + 2.5]);
    etiquette("XIAO nRF52840", [dy, zb + 14], [yb + 14, zb + xiao_z + 0.6]);
    etiquette("glissière à cran", [dy, zb + 4], [yb + 21, zb + 2.0]);
    etiquette("collier", [dy, -2], [col_ro - 1.5, 6]);
    etiquette(str("cale pour cintre de ", cintre_d), [gy, 10], [-col_ri + 1.5, 8]);
    etiquette(str("cintre Ø ", cintre_d, " + chambre à air"), [gy, 0], [-cintre_d / 2 + 2, 0]);
    etiquette("bride", [dy, -14], [col_ro - 1.5, -10]);
    color([0.92, 0.92, 0.95]) translate([gy - 40, zb + 40, 0.5]) linear_extrude(height = 0.01)
        text(str("Coupe A-A (plan X = ", coupe_x, " mm)"), size = 2.8, font = "Liberation Sans:style=Bold");
}

module fixation(eclat = 0) {
    cp(c_collier) collier();
    cp(c_collier) translate([0, 0, -eclat]) bride();
    cp(c_cale) translate([0, 0, eclat * 0.35]) cale(cintre_d);
    cp(c_cale) translate([0, 0, -eclat * 0.6]) rotate([180, 0, 0]) cale(cintre_d);
    if (afficher_composants) {
        cp(couleur("cintre")) fantome("cintre");
        cp(couleur("caoutchouc")) fantome("caoutchouc");
        cp("lightgray") translate([0, 0, -eclat]) fantome("vis_collier");
        cp("lightgray") fantome("ecrou_collier");
    }
}

module montage(eclat = 0) {
    au_collier() {
        cp(c_coque) coque();
        if (afficher_composants) for (n = fantomes_boitier)
            if (search([n], ["ecran", "vitre", "joint", "vis_ecran", "vis_couvercle"])[0] == [])
                cp(couleur(n)) fantome(n);
        translate([0, 0, eclat]) {
            cp(c_facade) couvercle();
            if (afficher_composants) {
                for (n = ["ecran", "joint", "vis_ecran"]) cp(couleur(n)) fantome(n);
                affichage_epaper();
            }
        }
        if (afficher_composants) translate([0, 0, eclat * 1.7]) cp(couleur("vis_couvercle")) fantome("vis_couvercle");
        // la vitre en dernier (transparence)
        if (afficher_composants) translate([0, 0, eclat]) cp(couleur("vitre")) fantome("vitre");
    }
    translate([0, 0, -eclat * 0.9]) fixation(eclat * 0.6);
}

// Pièces montées (pour le contrôle d'interférence : même position que "tout")
module piece_montee(n) {
    if (n == "coque") au_collier() coque();
    if (n == "couvercle") au_collier() couvercle();
    if (n == "collier") collier();
    if (n == "bride") bride();
    if (n == "cale_haut") cale(cintre_d);
    if (n == "cale_bas") rotate([180, 0, 0]) cale(cintre_d);
}

// Fantôme placé dans le repère d'assemblage (celui du collier)
module fantome_monte(n) {
    if (search([n], fantomes_collier)[0] != []) fantome(n);
    else au_collier() fantome(n);
}

if (piece == "coque") {
    coque();                                            // debout, fond sur le plateau
} else if (piece == "couvercle") {
    translate([0, 0, H]) rotate([180, 0, 0]) couvercle();   // retourné, façade sur le plateau
} else if (piece == "collier") {
    // couché sur sa face -X : l'anneau est dans le plan des couches ;
    // la fente de l'écrou s'ouvre vers le haut
    translate([0, 0, collier_larg / 2]) rotate([0, -90, 0]) collier();
} else if (piece == "bride") {
    translate([0, 0, collier_larg / 2]) rotate([0, -90, 0]) bride();
} else if (piece == "cale_22_2" || piece == "cale_23_8" || piece == "cale_25_4" || piece == "cale_31_8") {
    d = piece == "cale_22_2" ? 22.2 : piece == "cale_23_8" ? 23.8 : piece == "cale_25_4" ? 25.4 : 31.8;
    assert(d <= collier_pour, "Cale impossible : le collier est imprimé pour un cintre plus petit");
    // axe vertical, lèvre plate sur le plateau
    translate([0, 0, collier_larg / 2 + 1.4]) rotate([0, -90, 0]) cale(d);
} else if (piece == "test_jeux") {
    test_jeux();
} else if (piece == "essai_joint") {
    translate([0, 0, -(z_rim - 8)]) essai_joint();
} else if (piece == "eclate") {
    montage(eclat = 28);
} else if (piece == "coupe") {
    // coupe par le plan X = coupe_x : on garde la moitié X < coupe_x
    coupe2d();
} else if (piece == "tout") {
    montage();
}
// Toute autre valeur (ex. piece = "aucune") n'affiche rien : c'est ainsi
// que l'outil de contrôle d'interférence inclut ce fichier.
