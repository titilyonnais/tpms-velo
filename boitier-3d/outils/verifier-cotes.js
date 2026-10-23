// Vérification par calcul des cotes de boitier-3d/boitier.scad (mêmes paramètres, recopiés à la main).
const P = {
  // e-paper
  ep_pcb_x: 32.6, ep_pcb_y: 50.0, ep_pcb_r: 2.8, ep_pcb_ep: 1.2, ep_trou_ex: 27.0, ep_trou_ey: 44.4,
  ep_dalle_x: 31.8, ep_dalle_y: 37.32, ep_dalle_ep: 1.05, ep_scotch: 0.15, ep_aa: 27.6, ep_aa_decal_y: -2.86, ep_dos_h: 2.0,
  // vitre
  vitre_ep: 1.0, vitre_cote: 33.0, fenetre_marge: 0.6,
  // xiao
  xiao_long: 21.0, xiao_larg: 17.8, xiao_pcb: 1.2, xiao_dessus: 3.3, xiao_dessous: 1.8,
  // batterie
  bat_ep: 5.0, bat_larg: 30.0, bat_long: 35.0, bat_pcb: 3.0, bat_jeu: 0.5,
  // buzzer
  buz_d: 12.0, buz_h: 9.5,
  // boutons
  bt_percage: 12.2, bt_collerette_d: 15.0, bt_ecrou_d: 16.5, bt_ecrou_ep: 2.0, bt_prof: 17.0, bt_entraxe: 17.0,
  // LED
  led_trou: 3.1, led_collerette: 3.8, led_long: 5.0,
  // connecteur magnétique
  cm_l: 11.0, cm_h: 4.5, cm_prof: 5.0, cm_jeu: 0.15, cm_cadre: 1.2,
  // joint
  jt_d: 2.0, jt_compression: 0.24, jt_jeu_radial: 0.2, jt_gorge_l: 2.6,
  // inserts
  ins_trou_d: 3.3, ins_prof: 5.5, ins_paroi: 1.0,
  // coque
  paroi: 3.2, plancher: 2.5, r_ext: 2.5, r_alesage: 7.5, r_bas: 2.0, jeu_module: 0.5, jeu_module_y: 1.0,
  jupe_ep: 2.8, jupe_garde_haut: 1.5, jupe_garde_bas: 1.2, r_jupe_int: 3.5, couvercle_ep: 3.0, chanfrein_entree: 0.8,
  // garmin
  qt_col_d: 21.0, qt_tenon_d: 27.4, qt_tenon_larg: 10.0, qt_tenon_ep: 2.5, qt_levre_ep: 2.5, qt_jeu: 0.15, qt_jeu_radial: 0.3,
  qt_tete_d: 34.0, qt_base_ep: 2.0, qt_cran_h: 0.35,
  // guidon
  guidon_d: 31.8, guidon_caoutchouc: 0.5, collier_ep: 5.0, collier_larg: 20.0,
};
const ok = [], ko = [];
function chk(nom, cond, detail) { (cond ? ok : ko).push(`${cond ? 'OK ' : 'ÉCHEC'} ${nom} ${detail || ''}`); }
const f = v => (Math.round(v * 100) / 100).toFixed(2);

// --- dimensions dérivées (mêmes formules que le .scad) ---
const al_x = P.ep_pcb_x + 2 * (P.jeu_module + P.jupe_ep + P.jt_jeu_radial);
const al_y = P.ep_pcb_y + 2 * (P.jeu_module_y + P.jupe_ep + P.jt_jeu_radial);
const ext_x = al_x + 2 * P.paroi, ext_y = al_y + 2 * P.paroi;
const h_jupe = P.jupe_garde_haut + P.jt_gorge_l + P.jupe_garde_bas;
const z_bouton = P.plancher + P.bt_ecrou_d / 2 + 0.3;
const h_coque_min = z_bouton + P.bt_ecrou_d / 2 + 0.4 + h_jupe;
const h_coque = Math.ceil(h_coque_min * 2) / 2;
console.log('alésage', f(al_x), 'x', f(al_y), ' extérieur', f(ext_x), 'x', f(ext_y), ' h_jupe', f(h_jupe));
console.log('z_bouton', f(z_bouton), ' h_coque_min', f(h_coque_min), ' h_coque', f(h_coque));
const h_tenons = P.qt_levre_ep + 0.2 + P.qt_tenon_ep;
console.log('hauteur totale coque+couvercle', f(h_coque + P.couvercle_ep), ' avec tenons', f(h_coque + P.couvercle_ep + h_tenons));

chk('paroi >= 2', P.paroi >= 2); chk('plancher >= 2', P.plancher >= 2); chk('couvercle >= 2', P.couvercle_ep >= 2);
chk('couvercle sous la fenêtre >= 2', P.couvercle_ep - P.vitre_ep >= 2, f(P.couvercle_ep - P.vitre_ep));

// --- joint torique radial ---
const h_gland = P.jt_d * (1 - P.jt_compression);           // écart alésage <-> fond de gorge
const prof_gorge = h_gland - P.jt_jeu_radial;              // profondeur taillée dans la jupe
const remplissage = (Math.PI * P.jt_d ** 2 / 4) / (P.jt_gorge_l * h_gland);
console.log('joint : h_gland', f(h_gland), ' prof gorge', f(prof_gorge), ' remplissage', f(remplissage * 100), '%');
chk('remplissage gorge 60-85 %', remplissage > 0.6 && remplissage < 0.85, f(remplissage * 100));
chk('reste de jupe derrière la gorge >= 1.2', P.jupe_ep - prof_gorge >= 1.2, f(P.jupe_ep - prof_gorge));
// fond de gorge : rectangle arrondi
const fx = al_x / 2 - h_gland, fy = al_y / 2 - h_gland, fr = P.r_alesage - h_gland;
const perim = 4 * (fx - fr) + 4 * (fy - fr) + 2 * Math.PI * fr;
console.log('fond de gorge : demi', f(fx), f(fy), ' r', f(fr), ' périmètre', f(perim));
chk('rayon fond de gorge >= 2.5 x section', fr >= 2.5 * P.jt_d, f(fr));
for (const di of [50, 51, 52, 53, 54]) {
  const s = perim / (Math.PI * di) - 1;
  const d_eff = P.jt_d * (1 - 0.5 * s);   // la section diminue d'environ la moitié de l'étirement (règle pratique)
  const c = (d_eff - h_gland) / d_eff;
  console.log(`  joint ${di} x ${P.jt_d} : étirement ${f(s * 100)} %  section ${f(d_eff)}  compression ${f(c * 100)} %`);
}
// tolérance d'impression +-0.1 sur l'écart radial
for (const e of [-0.1, 0, 0.1]) {
  const d_eff = P.jt_d * (1 - 0.5 * (perim / (Math.PI * 53) - 1));
  console.log(`  écart radial ${f(h_gland + e)} -> compression ${f((d_eff - h_gland - e) / d_eff * 100)} % (joint 53x2)`);
}
// chanfrein d'entrée
const h_chanfrein = P.chanfrein_entree / Math.tan(30 * Math.PI / 180);
const z_joint_haut = P.jupe_garde_haut + (P.jt_gorge_l - P.jt_d) / 2;  // haut du joint sous le dessus de la coque
chk('chanfrein d\'entrée au-dessus du joint', h_chanfrein < z_joint_haut + 0.3, `chanfrein ${f(h_chanfrein)} mm, joint à ${f(z_joint_haut)} mm`);
const saillie = P.jt_d - prof_gorge - P.jt_jeu_radial; // dépassement du joint libre au-delà de l'alésage
chk('chanfrein plus large que la saillie du joint', P.chanfrein_entree > saillie, `saillie ${f(saillie)}`);

// --- inserts dans les coins ---
const r_h = P.ins_trou_d / 2;
const a = (P.paroi - (Math.SQRT2 - 1) * P.r_alesage) / (1 + Math.SQRT2);
const m1 = P.paroi - a - r_h;
const m2 = Math.SQRT2 * (P.r_alesage + a) - P.r_alesage - r_h;
const vis_x = al_x / 2 + a, vis_y = al_y / 2 + a;
console.log('insert : décalage', f(a), ' position', f(vis_x), f(vis_y), ' matière côté extérieur', f(m1), ' côté alésage', f(m2));
chk('matière autour des inserts >= 1.2', m1 >= 1.2 && m2 >= 1.2);
// coin extérieur
const dcoin = P.r_ext + Math.SQRT2 * Math.max(0, (P.paroi - a) - P.r_ext);
chk('rayon extérieur compatible insert', (P.paroi - a) >= P.r_ext || dcoin - r_h >= 1.2, f(dcoin));
const col_r = r_h + P.ins_paroi;
// colonne : reste-t-elle hors de l'alésage ?
chk('colonne d\'insert hors alésage', m2 + r_h >= col_r, `${f(m2 + r_h)} >= ${f(col_r)}`);
// tête de vis sur le couvercle (ISO 7380 M2,5 : dk 4,7)
chk('tête de vis dans le couvercle', vis_x + 4.7 / 2 <= ext_x / 2 - 0.3, f(ext_x / 2 - vis_x - 2.35));

// --- jupe et module ---
const jupe_int_x = P.ep_pcb_x / 2 + P.jeu_module, jupe_int_y = P.ep_pcb_y / 2 + P.jeu_module_y;
const cx = jupe_int_x - P.r_jupe_int, cy = jupe_int_y - P.r_jupe_int;
const mx = P.ep_pcb_x / 2 - P.ep_pcb_r, my = P.ep_pcb_y / 2 - P.ep_pcb_r;
const dist = Math.hypot(Math.max(0, mx - cx), Math.max(0, my - cy)) + P.ep_pcb_r;
chk('coin du module dans la jupe', dist <= P.r_jupe_int - 0.2, `${f(dist)} <= ${f(P.r_jupe_int)}`);
const r_jupe_ext = P.r_alesage - P.jt_jeu_radial;
// épaisseur mini de jupe au coin
const cxo = al_x / 2 - P.jt_jeu_radial - r_jupe_ext, cyo = al_y / 2 - P.jt_jeu_radial - r_jupe_ext;
const epc = (Math.hypot(cxo - cx, cyo - cy) + r_jupe_ext) - (P.r_jupe_int) ;
// épaisseur au coin le long de la diagonale : distance entre arcs (approx.)
const epDiag = (Math.SQRT2 * (cxo) + r_jupe_ext) - (Math.SQRT2 * cx + P.r_jupe_int);
console.log('jupe : int', f(jupe_int_x * 2), 'x', f(jupe_int_y * 2), ' épaisseur au coin (diagonale, approx.)', f(epDiag));
// pile du module
const pile = P.ep_dalle_ep + P.ep_scotch + P.ep_pcb_ep + P.ep_dos_h;
const z_module_bas = h_coque - pile;
console.log('module : épaisseur', f(pile), ' bas du module à z =', f(z_module_bas));
chk('module contenu dans la hauteur de jupe', pile <= h_jupe, `${f(pile)} <= ${f(h_jupe)}`);
// trous du module vs dalle
chk('trous du module hors de la dalle (Y)', P.ep_trou_ey / 2 - 2.25 > P.ep_dalle_y / 2, `${f(P.ep_trou_ey / 2 - 2.25)} > ${f(P.ep_dalle_y / 2)}`);
// vitre
const vy0 = P.ep_aa_decal_y - P.vitre_cote / 2, vy1 = P.ep_aa_decal_y + P.vitre_cote / 2;
chk('vitre loin des entretoises', vy0 > -(P.ep_trou_ey / 2 - 2.25 - 0.3) && vy1 < P.ep_trou_ey / 2 - 2.25 - 0.3, `${f(vy0)}..${f(vy1)}`);
chk('vitre dans la jupe (X)', P.vitre_cote / 2 + 0.1 < jupe_int_x, f(jupe_int_x - P.vitre_cote / 2 - 0.1));
const fen_bas = P.ep_aa + 2 * P.fenetre_marge;
chk('portée de colle de la vitre >= 1.5', (P.vitre_cote - fen_bas) / 2 >= 1.5, f((P.vitre_cote - fen_bas) / 2));
chk('zone active dans la dalle', Math.abs(P.ep_aa_decal_y) + P.ep_aa / 2 <= P.ep_dalle_y / 2, '');

// --- implantation intérieure ---
const ix = al_x / 2, iy = al_y / 2;  // demi-dimensions intérieures
// boutons à l'arrière
const btx = P.bt_entraxe / 2, R = P.bt_ecrou_d / 2;
chk('écrous des boutons ne se touchent pas', P.bt_entraxe >= P.bt_ecrou_d + 0.4, f(P.bt_entraxe - P.bt_ecrou_d));
chk('écrou au-dessus du plancher', z_bouton - R >= P.plancher, f(z_bouton - R));
chk('écrou sous la jupe', z_bouton + R <= h_coque - h_jupe - 0.3, `${f(z_bouton + R)} <= ${f(h_coque - h_jupe)}`);
chk('collerette du bouton sur face plane', btx + P.bt_collerette_d / 2 <= ext_x / 2 - P.r_ext, f(ext_x / 2 - P.r_ext - btx - P.bt_collerette_d / 2));
// écrou vs colonne d'insert
const dEcrouCol = Math.hypot(vis_x - (btx + R), vis_y - (iy - P.bt_ecrou_ep / 2));
chk('écrou loin de la colonne d\'insert', dEcrouCol > col_r + 0.2, f(dEcrouCol - col_r));
chk('écrou dans la cavité basse (coin r_bas)', btx + R <= ix - 0.3, f(ix - btx - R));
// LED d'alerte
const z_led = h_coque - h_jupe - P.led_collerette / 2 - 0.8;
const dLed = Math.hypot(btx, z_led - z_bouton);
chk('LED d\'alerte loin des écrous', dLed >= R + P.led_collerette / 2 + 0.2, f(dLed - R - P.led_collerette / 2));
chk('collerette LED sous la jupe', z_led + P.led_collerette / 2 <= h_coque - h_jupe - 0.3, f(z_led));
chk('LED loin des collerettes extérieures des boutons', Math.hypot(btx, z_led - z_bouton) >= P.bt_collerette_d / 2 + P.led_trou / 2 + 0.5, '');
// batterie
const bat_x = P.bat_long + P.bat_pcb, bat_y = P.bat_larg;
const bat_y0 = -iy + P.bt_prof + 0.3, bat_y1 = bat_y0 + bat_y + P.bat_jeu;
const z_bat = P.plancher + P.xiao_dessous + P.xiao_pcb + P.xiao_dessus + 1.7;
console.log('batterie : X ±', f(bat_x / 2), ' Y', f(bat_y0), '..', f(bat_y1), ' z', f(z_bat), '..', f(z_bat + P.bat_ep));
chk('batterie dans la largeur', bat_x / 2 + 0.3 <= ix, f(ix - bat_x / 2));
chk('batterie au-dessus des composants du fond', z_bat >= P.plancher + P.xiao_dessous + P.xiao_pcb + P.xiao_dessus + 1, '');
chk('batterie sous le module (garde gonflement >= 2 mm)', z_bat + P.bat_ep + 2 <= z_module_bas, f(z_module_bas - z_bat - P.bat_ep));
// buzzer à l'avant, couché
const buz_y0 = iy - P.buz_h;
chk('buzzer devant la batterie', buz_y0 >= bat_y1 + 0.3, `${f(buz_y0)} >= ${f(bat_y1)}`);
const z_buz = P.plancher + P.buz_d / 2 + 0.4;
console.log('buzzer : axe z', f(z_buz), ' Y', f(buz_y0), '..', f(iy));
// LED latérales
const led_lat_y = 23.5;
chk('LED latérales devant la batterie', led_lat_y - P.led_collerette / 2 > bat_y1 + 1.2 + 0.3, '');
chk('LED latérales loin des colonnes', Math.hypot(vis_x - (ix - P.led_long / 2), vis_y - led_lat_y) >= col_r + P.led_collerette / 2 || vis_y - led_lat_y >= col_r + P.led_collerette / 2, f(vis_y - led_lat_y - col_r - P.led_collerette / 2));
// connecteur à gauche de l'avant, buzzer à droite
const cm_x = -9.5, buz_x = 8.0;
chk('connecteur et buzzer séparés', (buz_x - P.buz_d / 2) - (cm_x + P.cm_l / 2 + P.cm_cadre + P.cm_jeu) >= 0.5, f((buz_x - P.buz_d / 2) - (cm_x + P.cm_l / 2 + P.cm_cadre + P.cm_jeu)));
const cadre_x0 = cm_x - P.cm_l / 2 - P.cm_jeu - P.cm_cadre;
const cadre_y0 = iy - 3;
const dCadre = Math.hypot(Math.max(0, -vis_x - cadre_x0) , 0);
// distance colonne (-vis_x, vis_y) au coin du cadre (cadre_x0, cadre_y0)
const dc = Math.hypot(-vis_x - cadre_x0, vis_y - cadre_y0);
chk('cadre du connecteur loin de la colonne', (cadre_x0 > -vis_x + col_r) || dc > col_r, f(cadre_x0 - (-vis_x + col_r)));
chk('buzzer loin de la colonne avant droite', buz_x + P.buz_d / 2 < vis_x - col_r, f(vis_x - col_r - buz_x - P.buz_d / 2));
// garmin
chk('tenon déborde sous la lèvre >= 2.5 mm', (P.qt_tenon_d - P.qt_col_d) / 2 >= 2.5, f((P.qt_tenon_d - P.qt_col_d) / 2));
chk('paroi de la tête femelle >= 2.5', (P.qt_tete_d - P.qt_tenon_d - 2 * P.qt_jeu_radial) / 2 >= 2.5, f((P.qt_tete_d - P.qt_tenon_d - 2 * P.qt_jeu_radial) / 2));
chk('serrage du cran (interférence) 0.1 à 0.3', P.qt_cran_h - P.qt_jeu >= 0.1 && P.qt_cran_h - P.qt_jeu <= 0.3, f(P.qt_cran_h - P.qt_jeu));
// guidon
const r_int = P.guidon_d / 2 + P.guidon_caoutchouc, r_out = r_int + P.collier_ep;
const pointe = r_int * Math.SQRT2;
const z_tete = Math.max(r_out, pointe + 1.5);
console.log('collier : r_int', f(r_int), ' r_ext', f(r_out), ' pointe goutte', f(pointe), ' base tête z', f(z_tete), ' haut tête', f(z_tete + P.qt_base_ep + P.qt_tenon_ep + P.qt_jeu + P.qt_levre_ep));
// garde du boîtier au-dessus du guidon
const garde = z_tete + P.qt_base_ep + P.qt_tenon_ep + P.qt_jeu + P.qt_levre_ep - P.guidon_d / 2;
chk('boîtier au-dessus du guidon', garde > 5, `dessous du boîtier à ${f(garde)} mm au-dessus du tube`);

// Déflexion d'un couvercle à joint axial (pour justifier le joint radial)
const E = 2000, q = 1.0; // MPa, N/mm (effort linéique d'un joint NBR 70 de 2 mm comprimé à 20-25 %)
for (const [L, b, t] of [[ext_y - 6.3, ext_x / 2, 3.0], [30, ext_x / 2, 3.0]]) {
  const I = b * t ** 3 / 12; const d = 5 * q * L ** 4 / (384 * E * I);
  console.log(`  joint axial : portée ${f(L)} mm entre vis, couvercle ${t} mm -> flèche ${f(d)} mm (écrasement nominal ${f(P.jt_d * 0.22)} mm)`);
}
// effet piston à la fermeture
const vol_int = al_x * al_y * (h_coque - P.plancher) / 1000; // cm3 (grossier)
const vol_occ = (P.ep_pcb_x * P.ep_pcb_y * pile + bat_x * bat_y * P.bat_ep + P.xiao_long * P.xiao_larg * 6 + Math.PI * 36 * P.buz_h + 2 * Math.PI * 36 * P.bt_prof) / 1000;
const course = h_chanfrein + (P.jupe_garde_haut + P.jt_gorge_l / 2) - h_chanfrein; // course après contact du joint
const dV = al_x * al_y * (P.jupe_garde_haut + P.jt_gorge_l / 2 - h_chanfrein) / 1000;
const vol_air = vol_int - vol_occ;
console.log('volume intérieur', f(vol_int), 'cm3, air libre ≈', f(vol_air), 'cm3, compression à la fermeture', f(dV), 'cm3 ->', f(dV / (vol_air - dV) * 100), '% soit', f(dV / (vol_air - dV)), 'bar');
const surf = al_x * al_y / 100; // cm2
console.log('force sur le couvercle pour 0,1 bar :', f(surf * 1), 'N ; pour 0,13 bar (40 K d\'écart) :', f(surf * 1.3), 'N');
console.log('\n' + ok.join('\n') + '\n' + ko.join('\n'));
console.log(`\n${ok.length} OK, ${ko.length} échec(s)`);
