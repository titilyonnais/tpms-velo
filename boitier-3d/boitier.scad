// =====================================================================
//  Boîtier de guidon – kit de surveillance de la pression des pneus
//  Projet BTS CIEL option IR – Thibault MORRETTON – Épreuve E6
// =====================================================================
//
//  Ce fichier décrit en OpenSCAD (logiciel gratuit, https://openscad.org)
//  les trois pièces imprimées en 3D du boîtier de guidon :
//    - la COQUE (le fond), qui reçoit l'électronique, les boutons,
//      les LED, le buzzer, le connecteur de recharge et la sortie du
//      câble du capteur de roue (reed) ;
//    - le COUVERCLE, qui porte l'écran e-paper, sa vitre et le joint ;
//    - la FIXATION VÉLO, un collier de guidon surmonté d'un support
//      quart de tour « type Garmin ».
//
//  Principe : toutes les cotes sont des paramètres regroupés par
//  composant en tête de fichier. Les dimensions du boîtier sont
//  CALCULÉES à partir de celles des composants : si une cote mesurée
//  à la réception du matériel diffère, on la corrige ici et tout le
//  boîtier suit. Des contrôles (assert) arrêtent le calcul si une
//  règle n'est plus respectée (paroi trop fine, joint mal comprimé...).
//
//  Origine des cotes (repère indiqué à côté de chaque valeur) :
//    [FICHE]       fiche technique ou dessin du fabricant
//    [DESSIN WeAct] relevé sur le plan « Board Shape » du module
//                  (dépôt GitHub WeActStudio.EpaperModule), mis à
//                  l'échelle grâce au pas des broches (2,54 mm)
//    [HYPOTHÈSE]   valeur courante pour ce type de pièce : À MESURER
//                  au pied à coulisse à la réception du matériel
//    [CHOIX]       décision de conception, justifiée dans le commentaire
//
//  Repère utilisé partout :
//    X : de gauche à droite pour le cycliste
//    Y : vers l'avant du vélo (le cycliste est du côté des Y négatifs)
//    Z : vers le haut ; z = 0 sous le plancher de la coque
//
//  Utilisation : choisir la pièce avec la variable `piece` (ou le
//  panneau « Customizer » d'OpenSCAD), puis F6 (rendu) et
//  Fichier > Exporter > STL. Voir README.md.
// =====================================================================


/* [Pièce à afficher] */

// "tout" = boîtier monté sur sa fixation ; "eclate" = vue éclatée pour la doc ;
// "essai_joint" = haut de coque seul, pour essayer le joint avant de tout imprimer
piece = "tout"; // ["tout", "coque", "couvercle", "fixation_velo", "eclate", "essai_joint"]

// Afficher les composants (fantômes colorés) dans "tout" et "eclate"
afficher_composants = true;

// Finesse des cercles : 32 pour travailler vite, 96 pour l'export STL
$fn = 64;


/* [Écran e-paper WeAct 1,54" 200x200 (SSD1681)] */

ep_pcb_x    = 32.6;   // [DESSIN WeAct] largeur du circuit imprimé
ep_pcb_y    = 50.0;   // [DESSIN WeAct] longueur du circuit imprimé
ep_pcb_r    = 2.8;    // [DESSIN WeAct] rayon des coins (centré sur les trous)
ep_pcb_ep   = 1.2;    // [HYPOTHÈSE] épaisseur du circuit imprimé
ep_trou_ex  = 27.0;   // [DESSIN WeAct] entraxe des 4 trous de fixation en X
ep_trou_ey  = 44.4;   // [DESSIN WeAct] entraxe des 4 trous de fixation en Y
ep_trou_d   = 2.2;    // [HYPOTHÈSE] diamètre des trous (vis M2)
ep_dalle_x  = 31.8;   // [FICHE] dalle Good Display GDEY0154D67 : 31,8 x 37,32 mm
ep_dalle_y  = 37.32;  // [FICHE] (dalle centrée sur le circuit d'après le dessin WeAct)
ep_dalle_ep = 1.05;   // [FICHE] épaisseur de la dalle
ep_scotch   = 0.15;   // [HYPOTHÈSE] adhésif entre dalle et circuit
ep_aa       = 27.6;   // [FICHE] zone active (zone qui affiche) : 27,6 x 27,6 mm
ep_aa_decal_y = -2.86;// [HYPOTHÈSE] décalage de la zone active par rapport au centre
                      // de la dalle (vers le côté opposé à la nappe). À MESURER :
                      // allumer l'écran avec un cadre noir et relever sa position.
ep_dos_h    = 2.0;    // [HYPOTHÈSE] hauteur des composants au dos du module
                      // (connecteur de nappe, bobine). Le connecteur à broches
                      // livré avec le module NE doit PAS être soudé : on soude
                      // les fils directement dans les trous.


/* [Vitre de l'écran] */

// "vitre" = plaque transparente collée (conseillé) ; "petg" = couvercle imprimé
// en PETG transparent avec une peau fine devant l'écran (plus flou)
fenetre = "vitre"; // ["vitre", "petg"]
vitre_ep    = 1.0;    // [CHOIX] plaque de PMMA (plexiglas) ou polycarbonate de 1 mm
vitre_cote  = 33.0;   // [CHOIX] vitre carrée de 33 x 33 mm (découpée au cutter)
fenetre_marge = 0.6;  // [CHOIX] la fenêtre dépasse la zone active de 0,6 mm par côté
petg_peau   = 0.8;    // [CHOIX] épaisseur de la peau transparente (option "petg")


/* [Carte Seeed XIAO nRF52840] */

xiao_long   = 21.0;   // [FICHE] 21 x 17,8 mm (wiki Seeed)
xiao_larg   = 17.8;   // [FICHE]
xiao_pcb    = 1.2;    // [HYPOTHÈSE] épaisseur du circuit
xiao_dessus = 3.3;    // [HYPOTHÈSE] hauteur au-dessus du circuit (prise USB-C)
xiao_dessous = 1.8;   // [CHOIX] garde sous la carte pour les fils soudés sur
                      // les plots BAT+/BAT- et NFC1/NFC2 (dessous de la carte)
xiao_pos    = [-8.5, 4.0]; // [CHOIX] centre de la carte, posée à plat sur le fond


/* [Batterie LiPo 503035 500 mAh] */

bat_ep      = 5.0;    // [FICHE] 5,0 x 30 x 35 mm (le nom « 503035 » donne ces cotes)
bat_larg    = 30.0;   // [FICHE]
bat_long    = 35.0;   // [FICHE]
bat_pcb     = 3.0;    // [HYPOTHÈSE] carte de protection repliée au bout de la cellule
bat_jeu     = 0.5;    // [CHOIX] jeu autour de la batterie


/* [Buzzer actif 3 V] */

buz_d       = 12.0;   // [FICHE] diamètre (modèle courant type TMB12A03)
buz_h       = 9.5;    // [HYPOTHÈSE] hauteur (8,5 à 9,5 mm selon les modèles)
buz_x       = 8.0;    // [CHOIX] position sur la face avant (à droite)
membrane_buzzer = true; // [CHOIX] amincir la paroi devant le buzzer
membrane_ep = 1.2;    // [CHOIX] épaisseur restante devant le buzzer (3 cordons de 0,4 mm)
membrane_d  = 10.0;   // [CHOIX] diamètre de la zone amincie


/* [Boutons étanches 12 mm] */

bt_percage  = 12.2;   // [FICHE] perçage de 12 mm (+0,2 mm : les trous imprimés rétrécissent)
bt_collerette_d = 15.0; // [HYPOTHÈSE] diamètre de la collerette extérieure (avec son joint)
bt_ecrou_d  = 16.5;   // [HYPOTHÈSE] diamètre de l'écrou mesuré sur les angles
bt_ecrou_ep = 2.0;    // [HYPOTHÈSE] épaisseur de l'écrou
bt_prof     = 17.0;   // [HYPOTHÈSE] longueur du corps derrière la paroi (cosses comprises)
bt_entraxe  = 17.0;   // [CHOIX] écart entre les 2 boutons (face arrière, vers le cycliste)


/* [LED 3 mm] */

led_trou    = 3.1;    // [FICHE] LED de 3 mm (+0,1 mm)
led_collerette = 3.8; // [HYPOTHÈSE] collerette à la base de la LED (sert de butée)
led_long    = 5.0;    // [HYPOTHÈSE] longueur du corps (dôme compris)
led_lat_y   = 23.5;   // [CHOIX] position des 2 LED blanches latérales (vers l'avant)


/* [Connecteur magnétique de recharge 2 broches] */

cm_l        = 11.0;   // [HYPOTHÈSE] largeur de la face du connecteur
cm_h        = 4.5;    // [HYPOTHÈSE] hauteur de la face
cm_prof     = 5.0;    // [HYPOTHÈSE] profondeur du corps
cm_jeu      = 0.15;   // [CHOIX] jeu autour du connecteur (rempli de colle époxy)
cm_cadre    = 1.2;    // [CHOIX] épaisseur du bac qui retient l'époxy à l'intérieur
cm_x        = -9.5;   // [CHOIX] position sur la face avant (à gauche)


/* [Câble du capteur de roue (reed)] */

reed_cable_d = 2.5;   // [HYPOTHÈSE] diamètre du câble 2 fils
reed_serrage = 0.3;   // [CHOIX] le trou est plus petit que le câble : passe-fil serré
reed_y      = 21.0;   // [CHOIX] sortie sur le flanc gauche, vers l'avant
reed_z      = 7.0;    // [CHOIX] hauteur de la sortie


/* [Joint torique entre coque et couvercle] */

jt_d        = 2.0;    // [HYPOTHÈSE] section (diamètre du « fil ») du joint NBR
jt_compression = 0.24;// [CHOIX] écrasement visé sur la section nominale ; l'étirement
                      // du joint diminue un peu sa section : écrasement réel ≈ 22 %
jt_jeu_radial = 0.2;  // [CHOIX] jeu entre la jupe du couvercle et l'alésage de la coque
jt_gorge_l  = 2.6;    // [CHOIX] largeur de la gorge (≈ 1,3 x la section)


/* [Vis et inserts à chaud] */

ins_trou_d  = 3.3;    // [HYPOTHÈSE] perçage pour insert laiton M2,5 (L 4 mm, Ø ext 3,5 mm)
                      // vérifier la valeur conseillée par le vendeur des inserts
ins_prof    = 5.5;    // [CHOIX] profondeur du trou : insert de 4 mm + 1,5 mm de garde
ins_paroi   = 1.0;    // [CHOIX] matière autour de l'insert dans les colonnes d'angle
vis_passage_d = 2.8;  // [FICHE] trou de passage d'une vis M2,5 (série moyenne ISO 273)
mod_vis_d   = 1.6;    // [CHOIX] avant-trou pour vis M2 auto-taraudeuse (fixation de l'écran)
mod_entretoise_d = 4.5; // [CHOIX] diamètre des entretoises qui portent l'écran


/* [Coque et couvercle] */

paroi       = 3.2;    // [CHOIX] épaisseur des parois (8 cordons de 0,4 mm : étanche)
plancher    = 2.5;    // [CHOIX] épaisseur du fond
r_ext       = 2.5;    // [CHOIX] rayon des arêtes verticales extérieures
r_alesage   = 7.5;    // [CHOIX] rayon des coins de l'alésage où frotte le joint :
                      // un joint torique ne doit pas être plié trop serré
r_bas       = 2.0;    // [CHOIX] rayon des coins de la cavité sous l'alésage
                      // (coins presque carrés : il faut la place des écrous de boutons)
jeu_module_x = 0.5;   // [CHOIX] jeu entre l'écran et la jupe du couvercle (X)
jeu_module_y = 1.0;   // [CHOIX] idem en Y (1 mm : place pour le buzzer à l'avant)
jupe_ep     = 2.8;    // [CHOIX] épaisseur de la jupe du couvercle qui porte le joint
jupe_garde_haut = 1.5;// [CHOIX] matière entre le dessous du couvercle et la gorge
jupe_garde_bas  = 1.2;// [CHOIX] matière sous la gorge
r_jupe_int  = 3.5;    // [CHOIX] rayon intérieur des coins de la jupe
couvercle_ep = 3.0;   // [CHOIX] épaisseur du couvercle
chanfrein_entree = 0.8; // [CHOIX] chanfrein à 30° en haut de l'alésage : le joint
                      // entre sans être coupé par l'arête


/* [Fixation quart de tour « type Garmin »] */

// Le support du vélo est imprimé avec le boîtier : les deux pièces vont
// toujours ensemble. La compatibilité avec un VRAI support Garmin n'est
// qu'une hypothèse : comparer au pied à coulisse avec un support Garmin.
qt_col_d    = 21.0;   // [HYPOTHÈSE] diamètre du col sous le boîtier
qt_tenon_d  = 27.4;   // [HYPOTHÈSE] diamètre extérieur des deux tenons
qt_tenon_larg = 10.0; // [HYPOTHÈSE] largeur des tenons (bande à bords droits)
qt_tenon_ep = 2.5;    // [HYPOTHÈSE] épaisseur des tenons
qt_levre_ep = 2.5;    // [HYPOTHÈSE] épaisseur de la lèvre du support (sous laquelle
                      // glissent les tenons)
qt_jeu      = 0.15;   // [CHOIX] jeu vertical tenon / lèvre
qt_jeu_radial = 0.3;  // [CHOIX] jeu radial (pièces imprimées)
qt_tete_d   = 34.0;   // [CHOIX] diamètre de la tête du support
qt_base_ep  = 2.0;    // [CHOIX] fond de la tête du support
qt_cran_h   = 0.35;   // [CHOIX] hauteur des crans qui retiennent le boîtier verrouillé
sens_verrouillage = "horaire"; // ["horaire", "antihoraire"] vu de dessus


/* [Guidon et collier] */

guidon_d    = 31.8;   // [FICHE] diamètre du cintre : 31,8 mm (ou 25,4 mm, ou 35 mm)
guidon_caoutchouc = 0.5; // [CHOIX] bande de chambre à air sous le collier (adhérence)
collier_ep  = 5.0;    // [CHOIX] épaisseur du collier
collier_larg = 20.0;  // [CHOIX] largeur du collier le long du cintre
oreille_ep  = 7.0;    // [CHOIX] épaisseur de chaque oreille de serrage
oreille_h   = 9.0;    // [CHOIX] hauteur des oreilles sous le collier
fente       = 2.0;    // [CHOIX] fente de serrage
m3_passage_d = 3.4;   // [FICHE] trou de passage M3
m3_tete_d   = 6.0;    // [FICHE] lamage pour tête de vis M3 (DIN 912 : Ø 5,5)
m3_ecrou_cotes = 5.7; // [FICHE] écrou M3 : 5,5 mm sur plats (+0,2 mm)
m3_ecrou_ep = 2.6;    // [FICHE] écrou M3 : 2,4 mm (+0,2 mm)


// =====================================================================
//  DIMENSIONS CALCULÉES (ne pas modifier : elles découlent des paramètres)
// =====================================================================

/* [Hidden] */  // (cache la suite dans le panneau Customizer d'OpenSCAD)

// --- Alésage : l'intérieur du haut de la coque, où frotte le joint ---
// L'écran (avec son jeu) se loge dans la jupe du couvercle ; la jupe se
// loge dans l'alésage avec le jeu radial.
al_x = ep_pcb_x + 2 * (jeu_module_x + jupe_ep + jt_jeu_radial);   // 39,6 mm
al_y = ep_pcb_y + 2 * (jeu_module_y + jupe_ep + jt_jeu_radial);   // 58,0 mm

// --- Dimensions extérieures ---
ext_x = al_x + 2 * paroi;                                         // 46,0 mm
ext_y = al_y + 2 * paroi;                                         // 64,4 mm

// --- Hauteur de la jupe du couvercle ---
h_jupe = jupe_garde_haut + jt_gorge_l + jupe_garde_bas;           // 5,3 mm

// --- Hauteur de la coque : imposée par les écrous des boutons ---
// L'écran est sous le couvercle, dans la jupe. Les boutons sont dans la
// paroi arrière ; leur écrou (16,5 mm sur angles) doit passer sous la
// jupe. Axe des boutons = plancher + rayon de l'écrou + 0,3 mm de garde.
z_bouton = plancher + bt_ecrou_d / 2 + 0.3;                       // 11,05 mm
h_coque  = ceil((z_bouton + bt_ecrou_d / 2 + 0.4 + h_jupe) * 2) / 2; // 25,0 mm

// --- Joint torique radial (voir README, § « Le joint ») ---
// Le joint est posé dans une gorge creusée tout autour de la jupe du
// couvercle. Quand on ferme, il est écrasé entre le fond de la gorge et
// la paroi de l'alésage (comme le joint d'un piston de seringue).
// Écart entre l'alésage et le fond de gorge = section x (1 - écrasement)
jt_ecart = jt_d * (1 - jt_compression);                           // 1,52 mm
jt_prof_gorge = jt_ecart - jt_jeu_radial;                         // 1,32 mm creusés dans la jupe
// Taux de remplissage = section du joint / section de la gorge (< 85 %
// pour laisser au caoutchouc la place de se déformer et de gonfler)
jt_remplissage = (PI * jt_d * jt_d / 4) / (jt_gorge_l * jt_ecart); // 79 %
// Fond de gorge : rectangle arrondi (demi-côtés, rayon) et périmètre
fond_x = al_x - 2 * jt_ecart;
fond_y = al_y - 2 * jt_ecart;
fond_r = r_alesage - jt_ecart;
jt_perimetre = 2 * (fond_x - 2 * fond_r) + 2 * (fond_y - 2 * fond_r) + 2 * PI * fond_r; // 172,8 mm
// Un joint posé dans une gorge extérieure doit être légèrement étiré
// (1 à 5 %) pour rester en place : diamètre intérieur conseillé
jt_di_conseille = jt_perimetre / (PI * 1.03);                    // ≈ 53 mm -> joint 53 x 2

// --- Position des vis du couvercle ---
// Les vis sont dans les coins, EN DEHORS de l'alésage (donc hors du
// joint : l'eau qui suivrait la vis s'arrête au joint). On place l'insert
// pour avoir autant de matière côté extérieur que côté alésage :
//   paroi - d - r = sqrt(2).(r_alesage + d) - r_alesage - r
//   =>  d = (paroi - (sqrt(2) - 1).r_alesage) / (1 + sqrt(2))
vis_decal = (paroi - (sqrt(2) - 1) * r_alesage) / (1 + sqrt(2)); // 0,04 mm
vis_x = al_x / 2 + vis_decal;                                     // 19,84 mm
vis_y = al_y / 2 + vis_decal;                                     // 29,04 mm
pos_vis = [[vis_x, vis_y], [-vis_x, vis_y], [vis_x, -vis_y], [-vis_x, -vis_y]];
col_r = ins_trou_d / 2 + ins_paroi;   // rayon des colonnes d'angle qui portent les inserts
ins_matiere = paroi - vis_decal - ins_trou_d / 2;                 // 1,51 mm de chaque côté

// --- Transition entre la cavité basse (coins r_bas) et l'alésage (coins r_alesage) ---
// Les coins se remplissent par une pente à 45° (gousset) : imprimable sans support.
h_alesage = jupe_garde_haut + jt_gorge_l + 0.5;  // hauteur où l'alésage doit être exact
h_gousset = (r_alesage - r_bas) * (sqrt(2) - 1); // avancée du coin le long de la diagonale
z_alesage_bas = h_coque - h_alesage;
z_gousset = z_alesage_bas - h_gousset;

// --- Chanfrein d'entrée à 30° par rapport à la verticale ---
h_chanfrein = chanfrein_entree / tan(30);                         // 1,39 mm

// --- Écran : épaisseurs empilées sous le couvercle ---
h_entretoise = ep_dalle_ep + ep_scotch;   // la dalle touche la vitre, le circuit repose sur les entretoises
pile_module = ep_dalle_ep + ep_scotch + ep_pcb_ep + ep_dos_h;     // 4,4 mm
z_module_bas = h_coque - pile_module;                             // 20,6 mm
fen_bas = ep_aa + 2 * fenetre_marge;     // fenêtre au ras de la vitre : 28,8 mm

// --- Implantation intérieure (cotes depuis le centre) ---
ix = al_x / 2;  iy = al_y / 2;           // demi-dimensions intérieures
z_led = h_coque - h_jupe - led_collerette / 2 - 0.8;   // LED juste sous la jupe : 17,0 mm
bat_x  = bat_long + bat_pcb;             // la batterie est posée en travers (38 mm en X)
bat_y0 = -iy + bt_prof + 0.3;            // juste devant les corps des boutons
bat_y1 = bat_y0 + bat_larg + bat_jeu;
z_bat  = plancher + xiao_dessous + xiao_pcb + xiao_dessus + 1.7; // au-dessus de la XIAO : 10,5 mm
buz_y0 = iy - buz_h;                     // buzzer couché, face contre la paroi avant
z_buz  = plancher + buz_d / 2 + 0.4;     // axe du buzzer : 8,9 mm
z_cm   = plancher + cm_cadre + cm_jeu + cm_h / 2;  // connecteur au ras du fond : 6,1 mm

// --- Fixation vélo ---
gu_r_int = guidon_d / 2 + guidon_caoutchouc;
gu_r_ext = gu_r_int + collier_ep;
qt_h_tete = qt_base_ep + qt_tenon_ep + qt_jeu + qt_levre_ep;     // 7,15 mm
qt_h_col = qt_levre_ep + 0.2;            // hauteur du col sous la coque
// La tête doit être au-dessus de la pointe du trou en goutte du collier
z_tete = max(gu_r_ext, gu_r_int * sqrt(2) + 1.5);
pied_h = (qt_tete_d - collier_larg) / 2; // piédestal : pente à 45° du collier vers la tête
// Angle des crans : juste avant la position verrouillée des tenons
cran_angle = 90 - asin((qt_tenon_larg / 2) / (qt_col_d / 2)) - 8;
sens = (sens_verrouillage == "horaire") ? 1 : -1;


// =====================================================================
//  CONTRÔLES : OpenSCAD s'arrête avec un message si une règle est violée
// =====================================================================

assert(paroi >= 2, "Paroi < 2 mm : pas assez solide ni étanche");
assert(plancher >= 2, "Plancher < 2 mm");
assert(couvercle_ep - vitre_ep >= 2 || fenetre == "petg", "Couvercle trop fin autour de la vitre");
assert(jt_remplissage > 0.6 && jt_remplissage < 0.85, str("Remplissage de gorge hors 60-85 % : ", jt_remplissage));
assert(jt_compression >= 0.18 && jt_compression <= 0.30, "Écrasement du joint hors 18-30 %");
assert(jupe_ep - jt_prof_gorge >= 1.2, "Jupe trop fine derrière la gorge");
assert(fond_r >= 2.5 * jt_d, "Coins trop serrés pour le joint (rayon < 2,5 x section)");
assert(h_chanfrein < jupe_garde_haut + (jt_gorge_l - jt_d) / 2 + 0.3, "Le chanfrein d'entrée descend jusqu'au joint");
assert(ins_matiere >= 1.2, str("Moins de 1,2 mm de matière autour des inserts : ", ins_matiere));
assert(pile_module <= h_jupe, "L'écran est plus épais que la jupe du couvercle");
assert(z_bat + bat_ep + 2 <= z_module_bas, "Pas de garde de 2 mm entre la batterie et l'écran (gonflement)");
assert(bat_x / 2 + 0.3 <= ix, "Batterie trop longue pour la largeur intérieure");
assert(buz_y0 >= bat_y1 + 0.3, "Le buzzer touche la batterie");
assert(bt_entraxe >= bt_ecrou_d + 0.4, "Les écrous des boutons se touchent");
assert(z_bouton + bt_ecrou_d / 2 <= h_coque - h_jupe - 0.3, "L'écrou des boutons touche la jupe");
assert(bt_entraxe / 2 + bt_collerette_d / 2 <= ext_x / 2 - r_ext, "Collerette de bouton hors de la face plane");
assert((qt_tenon_d - qt_col_d) / 2 >= 2.5, "Tenons trop courts sous la lèvre");

echo(str("Boîtier : ", ext_x, " x ", ext_y, " x ", h_coque + couvercle_ep,
         " mm (", h_coque + couvercle_ep + qt_h_col + qt_tenon_ep, " mm avec les tenons)"));
echo(str("Joint : écart ", jt_ecart, " mm, gorge ", jt_gorge_l, " x ", jt_prof_gorge,
         " mm, remplissage ", round(jt_remplissage * 100), " %, périmètre du fond ",
         round(jt_perimetre * 10) / 10, " mm -> joint torique ",
         round(jt_di_conseille), " x ", jt_d, " mm conseillé"));
echo(str("Inserts : ", ins_matiere, " mm de matière de chaque côté"));


// =====================================================================
//  OUTILS DE DESSIN
// =====================================================================

// Rectangle aux coins arrondis, centré (2D)
module rect_arrondi(x, y, r) {
    rr = max(min(r, x / 2 - 0.01, y / 2 - 0.01), 0.01);
    offset(r = rr) square([x - 2 * rr, y - 2 * rr], center = true);
}

// Le même, extrudé sur la hauteur h (3D)
module bloc_arrondi(x, y, r, h) {
    linear_extrude(height = h) rect_arrondi(x, y, r);
}

// Cylindre couché selon Y (de y = 0 vers +Y), utile pour les trous dans
// les faces avant et arrière
module cyl_y(d, h) {
    rotate([-90, 0, 0]) cylinder(d = d, h = h);
}

// Cylindre couché selon X (de x = 0 vers +X), pour les flancs
module cyl_x(d, h) {
    rotate([0, 90, 0]) cylinder(d = d, h = h);
}


// =====================================================================
//  COQUE
// =====================================================================

// Volume vide de la coque. Trois étages :
//   1) en bas, cavité aux coins presque carrés (place des écrous) ;
//   2) un gousset à 45° qui remplit les coins (imprimable sans support) ;
//   3) en haut, l'alésage aux coins arrondis où frotte le joint.
// Les colonnes d'angle, qui portent les inserts, restent pleines.
module cavite() {
    difference() {
        union() {
            translate([0, 0, plancher])
                bloc_arrondi(al_x, al_y, r_bas, z_gousset - plancher + 0.01);
            hull() {
                translate([0, 0, z_gousset]) bloc_arrondi(al_x, al_y, r_bas, 0.01);
                translate([0, 0, z_alesage_bas]) bloc_arrondi(al_x, al_y, r_alesage, 0.01);
            }
            translate([0, 0, z_alesage_bas])
                bloc_arrondi(al_x, al_y, r_alesage, h_alesage + 1);
        }
        for (p = pos_vis) translate([p[0], p[1], 0]) cylinder(r = col_r, h = h_coque + 1);
    }
}

// Tenons quart de tour sous le fond : un col cylindrique, puis deux tenons
// (une bande à bords droits, orientée selon Y, coupée par un disque).
module tenons_garmin() {
    // col
    translate([0, 0, -qt_h_col]) cylinder(d = qt_col_d, h = qt_h_col + 0.01);
    // tenons : 0,01 mm de plus vers le haut pour CHEVAUCHER le col. Sans
    // ce recouvrement, tenons et col ne se touchaient que par une face :
    // le premier rendu OpenSCAD donnait deux morceaux séparés.
    translate([0, 0, -qt_h_col - qt_tenon_ep])
        intersection() {
            cylinder(d = qt_tenon_d, h = qt_tenon_ep + 0.01);
            translate([-qt_tenon_larg / 2, -qt_tenon_d / 2, 0])
                cube([qt_tenon_larg, qt_tenon_d, qt_tenon_ep + 0.01]);
        }
}

// Bossage extérieur du passe-fil du câble reed, sur le flanc gauche.
// Forme de goutte (pointe en bas) : ses faces inférieures sont à 45°,
// il s'imprime sans support.
module bossage_passe_fil() {
    L = 5;   // saillie hors de la paroi
    r = 4;
    translate([-ext_x / 2 + 0.01, reed_y, reed_z])
        hull() {
            rotate([0, -90, 0]) cylinder(r = r, h = L);
            translate([-L, -0.01, -r * sqrt(2)]) cube([L, 0.02, 0.02]);
        }
}

// Aménagements intérieurs : supports de batterie, berceau de la XIAO,
// berceau du buzzer, bac à époxy du connecteur magnétique.
module amenagements() {
    // 4 piliers qui portent la batterie au-dessus de la XIAO, avec une
    // petite lèvre côté extérieur qui l'empêche de glisser en Y.
    for (sx = [-1, 1]) {
        // piliers arrière (lèvre vers l'arrière)
        translate([sx * 17 - 2, bat_y0, plancher - 0.01]) cube([4, 4, z_bat - plancher + 0.01]);
        translate([sx * 17 - 2, bat_y0 - 1.2, plancher - 0.01]) cube([4, 1.2, z_bat - plancher + 2.5]);
        // piliers avant (lèvre vers l'avant)
        translate([sx * 17 - 2, bat_y1 - 4, plancher - 0.01]) cube([4, 4, z_bat - plancher + 0.01]);
        translate([sx * 17 - 2, bat_y1, plancher - 0.01]) cube([4, 1.2, z_bat - plancher + 2.5]);
    }

    // Berceau de la XIAO : 4 plots d'appui (garde pour les fils soudés
    // dessous) et 4 équerres qui la centrent.
    // (px, py) = coin de la carte ; sx, sy = côté (+1 ou -1)
    translate([xiao_pos[0], xiao_pos[1], plancher - 0.01])
        for (sx = [-1, 1]) for (sy = [-1, 1]) {
            px = sx * xiao_long / 2;
            py = sy * xiao_larg / 2;
            hl = xiao_dessous + xiao_pcb + 0.6;   // hauteur des équerres
            // plot d'appui de 3 x 3 mm, sous le coin de la carte
            translate([sx > 0 ? px - 3 : px, sy > 0 ? py - 3 : py, 0])
                cube([3, 3, xiao_dessous + 0.01]);
            // équerre en L autour du coin : deux languettes de 1 mm
            // d'épaisseur, à 0,2 mm du bord de la carte
            translate([sx > 0 ? px - 4 : px - 1.2, sy > 0 ? py + 0.2 : py - 1.2, 0])
                cube([5.2, 1, hl]);                    // languette le long du bord en X
            translate([sx > 0 ? px + 0.2 : px - 1.2, sy > 0 ? py - 4 : py - 1.2, 0])
                cube([1, 5.2, hl]);                    // languette le long du bord en Y
        }

    // Berceau du buzzer couché (deux selles en U), face contre la paroi avant
    for (yy = [buz_y0 + 1.0, buz_y0 + 5.5])
        difference() {
            translate([buz_x - buz_d / 2 - 2, yy, plancher - 0.01])
                cube([buz_d + 4, 2.5, z_buz - plancher + 0.01]);
            translate([buz_x, yy - 1, z_buz]) cyl_y(buz_d + 0.3, 5);
        }

    // Bac à époxy autour du connecteur magnétique (posé sur le fond)
    translate([cm_x, iy - 3, 0])
        difference() {
            translate([-cm_l / 2 - cm_jeu - cm_cadre, 0, plancher - 0.01])
                cube([cm_l + 2 * (cm_jeu + cm_cadre), 3.01,
                      z_cm + cm_h / 2 + cm_jeu + cm_cadre - plancher + 0.01]);
            translate([-cm_l / 2 - cm_jeu, -0.01, z_cm - cm_h / 2 - cm_jeu])
                cube([cm_l + 2 * cm_jeu, 3.1, cm_h + 2 * cm_jeu]);
        }
}

// Tous les trous et entailles de la coque
module percages_coque() {
    // Trous des inserts à chaud (4 coins) avec un petit cône d'entrée
    for (p = pos_vis) translate([p[0], p[1], h_coque - ins_prof]) {
        cylinder(d = ins_trou_d, h = ins_prof + 0.01);
        translate([0, 0, ins_prof - 0.5]) cylinder(d1 = ins_trou_d, d2 = ins_trou_d + 1, h = 0.51);
    }

    // Chanfrein d'entrée de l'alésage (le joint glisse sans être pincé)
    hull() {
        translate([0, 0, h_coque - h_chanfrein]) bloc_arrondi(al_x, al_y, r_alesage, 0.01);
        translate([0, 0, h_coque]) bloc_arrondi(al_x + 2 * chanfrein_entree, al_y + 2 * chanfrein_entree,
                                                r_alesage + chanfrein_entree, 0.01);
    }

    // 2 boutons dans la face arrière (face au cycliste)
    for (sx = [-1, 1])
        translate([sx * bt_entraxe / 2, -ext_y / 2 - 1, z_bouton]) cyl_y(bt_percage, paroi + 2);

    // LED rouge d'alerte, au centre de la face arrière
    translate([0, -ext_y / 2 - 1, z_led]) cyl_y(led_trou, paroi + 2);

    // 2 LED blanches latérales
    for (sx = [-1, 1])
        translate([sx > 0 ? ix - 1 : -ext_x / 2 - 1, led_lat_y, z_led]) cyl_x(led_trou, paroi + 2);

    // Connecteur magnétique, affleurant sur la face avant
    translate([cm_x - cm_l / 2 - cm_jeu, iy - 1, z_cm - cm_h / 2 - cm_jeu])
        cube([cm_l + 2 * cm_jeu, paroi + 2, cm_h + 2 * cm_jeu]);

    // Zone amincie devant le buzzer (creusée depuis l'extérieur)
    if (membrane_buzzer)
        translate([buz_x, ext_y / 2 + 0.01, z_buz])
            rotate([90, 0, 0]) cylinder(d = membrane_d, h = paroi - membrane_ep + 0.01);

    // Passe-fil du câble reed : trou plus petit que le câble, et un cône
    // à l'extérieur pour y mettre un cordon de silicone
    translate([-ext_x / 2 - 6, reed_y, reed_z]) {
        cyl_x(reed_cable_d - reed_serrage, paroi + 8);
        rotate([0, 90, 0]) cylinder(d1 = reed_cable_d + 2, d2 = reed_cable_d - reed_serrage, h = 2.5);
    }

    // Encoche de démontage (pour glisser un tournevis plat sous le couvercle)
    translate([-4, ext_y / 2 - 1.2, h_coque - 1.5]) cube([8, 2, 2]);

    // Trou du détrompeur (le couvercle ne se monte que dans un sens)
    translate([0, -(iy + chanfrein_entree + (paroi - chanfrein_entree) / 2), h_coque - 1.5])
        cylinder(d = 1.9, h = 2);
}

module coque() {
    difference() {
        union() {
            difference() {
                bloc_arrondi(ext_x, ext_y, r_ext, h_coque);
                cavite();
            }
            amenagements();
            bossage_passe_fil();
            tenons_garmin();
        }
        percages_coque();
    }
}


// =====================================================================
//  COUVERCLE (dessiné à l'endroit : z = 0 sous le couvercle)
// =====================================================================

// Jupe : cadre qui descend dans l'alésage et porte la gorge du joint.
module jupe() {
    jx = al_x - 2 * jt_jeu_radial;      // contour extérieur de la jupe
    jy = al_y - 2 * jt_jeu_radial;
    jr = r_alesage - jt_jeu_radial;
    difference() {
        // contour extérieur avec un chanfrein de 0,5 mm en bas (entrée facile)
        hull() {
            translate([0, 0, -h_jupe + 0.5]) bloc_arrondi(jx, jy, jr, h_jupe - 0.5 + 0.01);
            translate([0, 0, -h_jupe]) bloc_arrondi(jx - 1, jy - 1, jr - 0.5, 0.5);
        }
        // intérieur : logement de l'écran
        translate([0, 0, -h_jupe - 1])
            bloc_arrondi(ep_pcb_x + 2 * jeu_module_x, ep_pcb_y + 2 * jeu_module_y, r_jupe_int, h_jupe + 1);
        // gorge du joint torique
        translate([0, 0, -jupe_garde_haut - jt_gorge_l])
            difference() {
                bloc_arrondi(jx + 2, jy + 2, jr + 1, jt_gorge_l);
                translate([0, 0, -0.01]) bloc_arrondi(fond_x, fond_y, fond_r, jt_gorge_l + 0.02);
            }
    }
}

// Petite flèche gravée sur le dessus : indique l'avant du vélo
module fleche_avant() {
    translate([0, iy - 7, couvercle_ep - 0.6])
        linear_extrude(height = 0.61)
            polygon([[-3, -2], [3, -2], [0, 3]]);
}

module couvercle() {
    difference() {
        union() {
            bloc_arrondi(ext_x, ext_y, r_ext, couvercle_ep);
            jupe();
            // 4 entretoises qui portent le circuit de l'écran
            for (sx = [-1, 1]) for (sy = [-1, 1])
                translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2, -h_entretoise])
                    cylinder(d = mod_entretoise_d, h = h_entretoise + 0.01);
            // détrompeur
            translate([0, -(iy + chanfrein_entree + (paroi - chanfrein_entree) / 2), -1.2])
                cylinder(d = 1.5, h = 1.21);
        }
        // passages des vis M2,5
        for (p = pos_vis) translate([p[0], p[1], -1]) cylinder(d = vis_passage_d, h = couvercle_ep + 2);
        // avant-trous des vis M2 de l'écran (borgnes : 1 mm de peau au-dessus)
        for (sx = [-1, 1]) for (sy = [-1, 1])
            translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2, -h_entretoise - 0.01])
                cylinder(d = mod_vis_d, h = h_entretoise + couvercle_ep - 1);
        // fenêtre de l'écran
        if (fenetre == "vitre") {
            // logement de la vitre, sous le couvercle (la vitre est serrée
            // entre le couvercle et l'écran : l'eau la plaque sur sa colle)
            translate([0, ep_aa_decal_y, -0.01])
                linear_extrude(height = vitre_ep + 0.01) square(vitre_cote + 0.2, center = true);
            // ouverture évasée à 45° vers l'extérieur (pas d'ombre sur l'écran)
            hull() {
                translate([0, ep_aa_decal_y, vitre_ep - 0.01])
                    linear_extrude(height = 0.01) square(fen_bas, center = true);
                translate([0, ep_aa_decal_y, couvercle_ep])
                    linear_extrude(height = 0.01)
                        square(fen_bas + 2 * (couvercle_ep - vitre_ep), center = true);
            }
        } else {
            // option PETG transparent : on garde une peau fine devant l'écran
            hull() {
                translate([0, ep_aa_decal_y, petg_peau])
                    linear_extrude(height = 0.01) square(fen_bas, center = true);
                translate([0, ep_aa_decal_y, couvercle_ep])
                    linear_extrude(height = 0.01)
                        square(fen_bas + 2 * (couvercle_ep - petg_peau), center = true);
            }
        }
        fleche_avant();
    }
}


// =====================================================================
//  FIXATION VÉLO : collier de guidon + tête femelle quart de tour
// =====================================================================
//  Le cintre est selon X. La tête reçoit les tenons du boîtier : on
//  présente le boîtier tourné de 90° (tenons selon X, dans la fente),
//  on l'enfonce, puis on tourne d'un quart de tour : les tenons passent
//  sous la lèvre, franchissent un petit cran, et butent.

module tete_femelle_creux() {
    cav_d = qt_tenon_d + 2 * qt_jeu_radial;
    // logement des tenons
    translate([0, 0, qt_base_ep]) cylinder(d = cav_d, h = qt_tenon_ep + qt_jeu + 0.01);
    // ouverture de la lèvre : passage du col + fente selon X pour les tenons
    translate([0, 0, qt_base_ep + qt_tenon_ep + qt_jeu - 0.01]) {
        cylinder(d = qt_col_d + 2 * qt_jeu_radial, h = qt_levre_ep + 1);
        intersection() {
            cylinder(d = cav_d, h = qt_levre_ep + 1);
            translate([-cav_d / 2, -(qt_tenon_larg / 2 + qt_jeu_radial), 0])
                cube([cav_d, qt_tenon_larg + 2 * qt_jeu_radial, qt_levre_ep + 1]);
        }
    }
}

// Butées (rotation limitée à un quart de tour, dans un seul sens) et crans
module tete_femelle_butees() {
    cav_d = qt_tenon_d + 2 * qt_jeu_radial;
    a = qt_tenon_larg / 2 + qt_jeu_radial;
    // Butées : deux quarts de logement opposés, hors du passage des tenons.
    // Sens horaire : quadrants (+X,+Y) et (-X,-Y).
    for (k = [0, 1]) rotate([0, 0, 180 * k])
        intersection() {
            translate([0, 0, qt_base_ep - 0.01]) cylinder(d = cav_d + 0.02, h = qt_tenon_ep + qt_jeu + 0.02);
            translate([a, sens * a + (sens > 0 ? 0 : -cav_d), qt_base_ep - 0.01])
                cube([cav_d, cav_d, qt_tenon_ep + qt_jeu + 0.02]);
        }
    // Crans : deux petites nervures couchées sur le fond du logement
    for (k = [0, 1]) rotate([0, 0, -sens * cran_angle + 180 * k])
        translate([qt_col_d / 2 - 0.5, 0, qt_base_ep + qt_cran_h - 0.8])
            cyl_x(1.6, (cav_d - qt_col_d) / 2 + 0.5);
}

module fixation_velo() {
    yy = sqrt(max(gu_r_ext * gu_r_ext - (z_tete - pied_h) * (z_tete - pied_h), 1)) - 0.5;
    difference() {
        union() {
            // collier et oreilles de serrage (enveloppe convexe : faces
            // inférieures assez pentues pour imprimer sans support)
            hull() {
                rotate([0, 90, 0]) cylinder(r = gu_r_ext, h = collier_larg, center = true);
                translate([-collier_larg / 2, -(fente / 2 + oreille_ep), -(gu_r_ext + oreille_h)])
                    cube([collier_larg, 2 * oreille_ep + fente, oreille_h + 1]);
            }
            // piédestal : passe de la largeur du collier au diamètre de la tête
            hull() {
                translate([-collier_larg / 2, -yy, z_tete - pied_h]) cube([collier_larg, 2 * yy, 0.01]);
                translate([0, 0, z_tete - 0.01]) cylinder(d = qt_tete_d, h = 0.02);
            }
            // tête
            translate([0, 0, z_tete]) cylinder(d = qt_tete_d, h = qt_h_tete);
        }
        // trou du cintre, en goutte pointe en haut (imprimable sans support)
        hull() {
            rotate([0, 90, 0]) cylinder(r = gu_r_int, h = collier_larg + 2, center = true);
            translate([-(collier_larg + 2) / 2, -0.01, gu_r_int * sqrt(2) - 0.02])
                cube([collier_larg + 2, 0.02, 0.02]);
        }
        // fente de serrage
        translate([-collier_larg / 2 - 1, -fente / 2, -(gu_r_ext + oreille_h + 1)])
            cube([collier_larg + 2, fente, oreille_h + collier_ep + 2]);
        // vis M3 de serrage, tête d'un côté, écrou prisonnier de l'autre
        translate([0, 0, -(gu_r_ext + oreille_h / 2 - 1)]) {
            translate([0, -(fente / 2 + oreille_ep) - 1, 0]) cyl_y(m3_passage_d, 2 * oreille_ep + fente + 2);
            translate([0, fente / 2 + oreille_ep - 2.5, 0]) cyl_y(m3_tete_d, 3.5);
            translate([0, -(fente / 2 + oreille_ep) - 1, 0])
                rotate([-90, 0, 0]) rotate([0, 0, 30])
                    cylinder(d = m3_ecrou_cotes / cos(30), h = m3_ecrou_ep + 1, $fn = 6);
        }
        // creux de la tête
        translate([0, 0, z_tete]) tete_femelle_creux();
    }
    translate([0, 0, z_tete]) tete_femelle_butees();
}


// =====================================================================
//  COMPOSANTS (fantômes colorés, pour les vues ; jamais exportés en STL)
// =====================================================================

module composants_coque() {
    // batterie
    color("silver") translate([-bat_x / 2, bat_y0 + bat_jeu / 2, z_bat]) cube([bat_x, bat_larg, bat_ep]);
    // XIAO
    color("royalblue")
        translate([xiao_pos[0] - xiao_long / 2, xiao_pos[1] - xiao_larg / 2, plancher + xiao_dessous])
            cube([xiao_long, xiao_larg, xiao_pcb]);
    color("lightgray")
        translate([xiao_pos[0] + xiao_long / 2 - 7.5, xiao_pos[1] - 4.5, plancher + xiao_dessous + xiao_pcb])
            cube([7.5, 9, xiao_dessus]);
    // buzzer couché
    color("dimgray") translate([buz_x, buz_y0, z_buz]) cyl_y(buz_d, buz_h);
    // boutons (corps intérieur, écrou, collerette extérieure)
    for (sx = [-1, 1]) translate([sx * bt_entraxe / 2, 0, z_bouton]) {
        color("gray") translate([0, -iy, 0]) cyl_y(12, bt_prof);
        color("goldenrod") translate([0, -iy, 0]) cyl_y(bt_ecrou_d, bt_ecrou_ep);
        color("black") translate([0, -ext_y / 2 - 2, 0]) cyl_y(bt_collerette_d, 2);
    }
    // LED
    color("red") translate([0, -ext_y / 2 - 1, z_led]) cyl_y(3, led_long);
    for (sx = [-1, 1]) color("white")
        translate([sx > 0 ? ext_x / 2 + 1 - led_long : -ext_x / 2 - 1, led_lat_y, z_led]) cyl_x(3, led_long);
    // connecteur magnétique
    color("gold") translate([cm_x - cm_l / 2, ext_y / 2 - cm_prof, z_cm - cm_h / 2]) cube([cm_l, cm_prof, cm_h]);
    // câble du reed
    color("black") translate([-ext_x / 2 - 15, reed_y, reed_z]) cyl_x(reed_cable_d, 20);
}

module composants_couvercle() {
    // vitre
    if (fenetre == "vitre")
        color("lightcyan", 0.5) translate([0, ep_aa_decal_y, vitre_ep / 2])
            cube([vitre_cote, vitre_cote, vitre_ep], center = true);
    // dalle e-paper et zone active
    color("whitesmoke") translate([0, 0, -ep_dalle_ep / 2]) cube([ep_dalle_x, ep_dalle_y, ep_dalle_ep], center = true);
    color("black") translate([0, ep_aa_decal_y, -0.02]) cube([ep_aa, ep_aa, 0.05], center = true);
    // circuit du module
    color("darkgreen") translate([0, 0, -h_entretoise - ep_pcb_ep])
        difference() {
            bloc_arrondi(ep_pcb_x, ep_pcb_y, ep_pcb_r, ep_pcb_ep);
            for (sx = [-1, 1]) for (sy = [-1, 1])
                translate([sx * ep_trou_ex / 2, sy * ep_trou_ey / 2, -1]) cylinder(d = ep_trou_d, h = 5);
        }
    // joint torique (représenté par un anneau de section carrée)
    color("orangered") translate([0, 0, -jupe_garde_haut - jt_gorge_l / 2 - jt_d / 2])
        linear_extrude(height = jt_d)
            difference() {
                rect_arrondi(fond_x + 2 * jt_d * 0.98, fond_y + 2 * jt_d * 0.98, fond_r + jt_d);
                rect_arrondi(fond_x, fond_y, fond_r);
            }
    // vis M2,5 du couvercle
    for (p = pos_vis) color("gray") translate([p[0], p[1], couvercle_ep]) {
        cylinder(d = 4.7, h = 1.4);
        translate([0, 0, -6]) cylinder(d = 2.5, h = 6);
    }
}


// =====================================================================
//  ASSEMBLAGES ET CHOIX DE LA PIÈCE
// =====================================================================

// Hauteur du dessus de la tête du support, dans le repère de la fixation
z_haut_tete = z_tete + qt_h_tete;

module assemblage(ecart_couvercle = 0, ecart_fixation = 0, ecart_composants = 0) {
    color("dimgray") coque();
    if (afficher_composants) translate([0, 0, ecart_composants]) composants_coque();
    translate([0, 0, h_coque + ecart_couvercle]) {
        color("darkslategray") couvercle();
        if (afficher_composants) composants_couvercle();
    }
    // la fixation : le dessus de la tête est 0,2 mm sous le fond de la coque
    // (le col des tenons mesure l'épaisseur de la lèvre + 0,2 mm)
    translate([0, 0, -0.2 - z_haut_tete - ecart_fixation])
        color("slategray") fixation_velo();
}

if (piece == "coque") {
    // posée sur ses tenons (le dessous du fond s'imprime sur des supports)
    translate([0, 0, qt_h_col + qt_tenon_ep]) coque();
} else if (piece == "couvercle") {
    // retourné : le dessus du couvercle à plat sur le plateau
    translate([0, 0, couvercle_ep]) rotate([180, 0, 0]) couvercle();
} else if (piece == "fixation_velo") {
    // posée sur ses oreilles de serrage
    translate([0, 0, gu_r_ext + oreille_h]) fixation_velo();
} else if (piece == "essai_joint") {
    // le haut de la coque seulement (9 mm) : pour essayer le joint et les
    // inserts avec le vrai couvercle, en 20 minutes d'impression
    translate([0, 0, -(h_coque - 9)])
        intersection() {
            coque();
            translate([-ext_x, -ext_y, h_coque - 9]) cube([2 * ext_x, 2 * ext_y, 10]);
        }
} else if (piece == "eclate") {
    assemblage(ecart_couvercle = 40, ecart_fixation = 35, ecart_composants = 0);
} else {
    assemblage();
}
