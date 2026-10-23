// Génère boitier-3d/apercu.svg : vues cotées dessinées à partir des paramètres de boitier.scad.
const fs = require('fs');
// --- paramètres (recopiés de boitier.scad) ---
const ep_pcb_x = 32.6, ep_pcb_y = 50.0, ep_aa = 27.6, ep_aa_decal_y = -2.86, fenetre_marge = 0.6, vitre_ep = 1.0;
const jeu_module_x = 0.5, jeu_module_y = 1.0, jupe_ep = 2.8, jt_jeu_radial = 0.2, paroi = 3.2, plancher = 2.5, r_ext = 2.5, r_alesage = 7.5;
const jupe_garde_haut = 1.5, jt_gorge_l = 2.6, jupe_garde_bas = 1.2, couvercle_ep = 3.0, chanfrein_entree = 0.8;
const bt_ecrou_d = 16.5, bt_entraxe = 17.0, bt_collerette_d = 15.0, bt_percage = 12.2, led_collerette = 3.8, led_lat_y = 23.5;
const jt_d = 2.0, jt_compression = 0.24, cm_l = 11.0, cm_h = 4.5, cm_jeu = 0.15, cm_cadre = 1.2, cm_x = -9.5, buz_x = 8.0, buz_d = 12.0;
const membrane_d = 10.0, reed_y = 21.0, reed_z = 7.0, reed_cable_d = 2.5, reed_serrage = 0.3;
const qt_col_d = 21.0, qt_tenon_d = 27.4, qt_tenon_larg = 10.0, qt_tenon_ep = 2.5, qt_levre_ep = 2.5;
// --- calculs (mêmes formules) ---
const al_x = ep_pcb_x + 2 * (jeu_module_x + jupe_ep + jt_jeu_radial), al_y = ep_pcb_y + 2 * (jeu_module_y + jupe_ep + jt_jeu_radial);
const ext_x = al_x + 2 * paroi, ext_y = al_y + 2 * paroi;
const h_jupe = jupe_garde_haut + jt_gorge_l + jupe_garde_bas;
const z_bouton = plancher + bt_ecrou_d / 2 + 0.3;
const h_coque = Math.ceil((z_bouton + bt_ecrou_d / 2 + 0.4 + h_jupe) * 2) / 2;
const vis_decal = (paroi - (Math.SQRT2 - 1) * r_alesage) / (1 + Math.SQRT2);
const vis_x = al_x / 2 + vis_decal, vis_y = al_y / 2 + vis_decal;
const fen_bas = ep_aa + 2 * fenetre_marge, fen_haut = fen_bas + 2 * (couvercle_ep - vitre_ep);
const z_led = h_coque - h_jupe - led_collerette / 2 - 0.8;
const qt_h_col = qt_levre_ep + 0.2;
const z_bas = -(qt_h_col + qt_tenon_ep);
const h_tot = h_coque + couvercle_ep;
const z_cm = plancher + cm_cadre + cm_jeu + cm_h / 2;
const z_buz = plancher + buz_d / 2 + 0.4;
const jt_ecart = jt_d * (1 - jt_compression), jt_prof = jt_ecart - jt_jeu_radial;

const C = { fond: '#000', trait: '#E5E5E5', doux: '#8A8A8A', cache: '#5A5A5A', violet: '#A78BFA', ecran: '#1C1C22', rouge: '#F87171', joint: '#FB923C' };
const S = 4; // px par mm
const out = [];
const fmt = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const add = s => out.push(s);
function rect(x, y, w, h, o = {}) { add(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${o.fill || 'none'}" stroke="${o.stroke || C.trait}" stroke-width="${o.sw || 1.5}"${o.dash ? ' stroke-dasharray="5 4"' : ''}/>`); }
function circ(x, y, r, o = {}) { add(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${o.fill || 'none'}" stroke="${o.stroke || C.trait}" stroke-width="${o.sw || 1.5}"${o.dash ? ' stroke-dasharray="5 4"' : ''}/>`); }
function line(x1, y1, x2, y2, o = {}) { add(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${o.stroke || C.trait}" stroke-width="${o.sw || 1.5}"${o.dash ? ' stroke-dasharray="5 4"' : ''}/>`); }
function path(d, o = {}) { add(`<path d="${d}" fill="${o.fill || 'none'}" stroke="${o.stroke || C.trait}" stroke-width="${o.sw || 1.5}"${o.dash ? ' stroke-dasharray="5 4"' : ''}/>`); }
function text(x, y, s, o = {}) { add(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${o.fill || C.trait}" font-size="${o.size || 13}" text-anchor="${o.anchor || 'middle'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${x.toFixed(1)} ${y.toFixed(1)})"` : ''}>${s}</text>`); }
// cote horizontale entre x1 et x2 à la hauteur y (avec lignes d'attache depuis yref)
function coteH(x1, x2, y, label, yref1, yref2) {
  if (yref1 !== undefined) line(x1, yref1, x1, y + (y > yref1 ? 4 : -4), { stroke: C.violet, sw: 0.8 });
  if (yref2 !== undefined) line(x2, yref2, x2, y + (y > yref2 ? 4 : -4), { stroke: C.violet, sw: 0.8 });
  line(x1, y, x2, y, { stroke: C.violet, sw: 1.2 });
  path(`M${x1} ${y} l7 -3.5 v7 z M${x2} ${y} l-7 -3.5 v7 z`, { fill: C.violet, stroke: C.violet, sw: 0.5 });
  text((x1 + x2) / 2, y - 6, label, { fill: C.violet, size: 13 });
}
function coteV(y1, y2, x, label, xref1, xref2, cote = 'g') {
  if (xref1 !== undefined) line(xref1, y1, x + (x > xref1 ? 4 : -4), y1, { stroke: C.violet, sw: 0.8 });
  if (xref2 !== undefined) line(xref2, y2, x + (x > xref2 ? 4 : -4), y2, { stroke: C.violet, sw: 0.8 });
  line(x, y1, x, y2, { stroke: C.violet, sw: 1.2 });
  const a = y1 < y2 ? 1 : -1;
  path(`M${x} ${y1} l-3.5 ${7 * a} h7 z M${x} ${y2} l-3.5 ${-7 * a} h7 z`, { fill: C.violet, stroke: C.violet, sw: 0.5 });
  const tx = cote === 'g' ? x - 8 : x + 8;
  text(tx, (y1 + y2) / 2, label, { fill: C.violet, size: 13, rot: -90 });
}
function titre(x, y, s) { text(x, y, s, { size: 15, weight: 600, anchor: 'start' }); }

const W = 1180, H = 1000;
add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, 'Segoe UI', Arial, sans-serif">`);
add(`<rect width="${W}" height="${H}" fill="${C.fond}"/>`);
text(30, 38, 'Boîtier de guidon TPMS – vues cotées (mm)', { size: 20, weight: 700, anchor: 'start' });
text(30, 60, `Généré depuis les paramètres de boitier.scad · extérieur ${fmt(ext_x)} × ${fmt(ext_y)} × ${fmt(h_tot)} mm (${fmt(h_tot - z_bas)} avec les tenons)`, { size: 13, fill: C.doux, anchor: 'start' });

// ================= VUE DE DESSUS =================
{
  const cx = 190, cy = 300;
  titre(40, 100, 'Vue de dessus');
  const X = x => cx + x * S, Y = y => cy - y * S;
  rect(X(-ext_x / 2), Y(ext_y / 2), ext_x * S, ext_y * S, { rx: r_ext * S, fill: '#0B0B0D' });
  // tenons (cachés)
  circ(cx, cy, qt_col_d / 2 * S, { stroke: C.cache, sw: 1, dash: 1 });
  const ty = Math.sqrt((qt_tenon_d / 2) ** 2 - (qt_tenon_larg / 2) ** 2);
  rect(X(-qt_tenon_larg / 2), Y(ty), qt_tenon_larg * S, 2 * ty * S, { stroke: C.cache, sw: 1, dash: 1 });
  // fenêtre
  rect(X(-fen_haut / 2), Y(ep_aa_decal_y + fen_haut / 2), fen_haut * S, fen_haut * S, { stroke: C.doux, sw: 1 });
  rect(X(-fen_bas / 2), Y(ep_aa_decal_y + fen_bas / 2), fen_bas * S, fen_bas * S, { fill: C.ecran });
  text(cx, Y(ep_aa_decal_y) + 5, 'écran 1,54″', { size: 12, fill: C.doux });
  // vis
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { circ(X(sx * vis_x), Y(sy * vis_y), 2.35 * S); line(X(sx * vis_x) - 5, Y(sy * vis_y), X(sx * vis_x) + 5, Y(sy * vis_y), { sw: 1 }); }
  // flèche avant
  path(`M${X(-3)} ${Y(al_y / 2 - 7 - 2)} L${X(3)} ${Y(al_y / 2 - 7 - 2)} L${X(0)} ${Y(al_y / 2 - 7 + 3)} Z`, { stroke: C.violet, sw: 1 });
  text(X(ext_x / 2) + 8, Y(ext_y / 2) + 12, '↑ avant', { size: 12, fill: C.doux, anchor: 'start' });
  text(cx, Y(-ext_y / 2) + 22, 'cycliste', { size: 12, fill: C.doux });
  // cotes
  coteH(X(-ext_x / 2), X(ext_x / 2), Y(-ext_y / 2) + 48, fmt(ext_x), Y(-ext_y / 2) + 4, Y(-ext_y / 2) + 4);
  coteV(Y(ext_y / 2), Y(-ext_y / 2), X(-ext_x / 2) - 30, fmt(ext_y), X(-ext_x / 2) - 4, X(-ext_x / 2) - 4);
  coteV(Y(ep_aa_decal_y + fen_bas / 2), Y(ep_aa_decal_y - fen_bas / 2), X(ext_x / 2) + 30, fmt(fen_bas) + ' fenêtre', X(fen_bas / 2), X(fen_bas / 2), 'd');
  coteH(X(-vis_x), X(vis_x), Y(ext_y / 2) - 22, fmt(2 * vis_x) + ' vis', Y(vis_y), Y(vis_y));
}

// ================= VUE ARRIÈRE (côté cycliste) =================
{
  const cx = 560, base = 320;   // base = z 0
  titre(400, 100, 'Vue arrière (face au cycliste)');
  const X = x => cx + x * S, Z = z => base - z * S;
  // passe-fil (flanc gauche, vu de profil)
  rect(X(-ext_x / 2 - 5), Z(reed_z + 4), 5 * S, (4 + 4 * Math.SQRT2) * S, { sw: 1.2 });
  rect(X(-ext_x / 2), Z(h_coque), ext_x * S, h_coque * S, { fill: '#0B0B0D' });
  rect(X(-ext_x / 2), Z(h_tot), ext_x * S, couvercle_ep * S, { fill: '#121216' });
  for (const sx of [-1, 1]) rect(X(sx * vis_x - 2.35), Z(h_tot + 1.4), 4.7 * S, 1.4 * S, { sw: 1, fill: '#222' });
  // col et tenons
  rect(X(-qt_col_d / 2), Z(0), qt_col_d * S, qt_h_col * S);
  rect(X(-qt_tenon_larg / 2), Z(-qt_h_col), qt_tenon_larg * S, qt_tenon_ep * S);
  // boutons et LED
  for (const sx of [-1, 1]) { circ(X(sx * bt_entraxe / 2), Z(z_bouton), bt_collerette_d / 2 * S, { fill: '#18181B' }); circ(X(sx * bt_entraxe / 2), Z(z_bouton), bt_percage / 2 * S, { stroke: C.cache, sw: 1, dash: 1 }); }
  circ(cx, Z(z_led), 1.5 * S, { fill: C.rouge, stroke: C.rouge });
  text(cx, Z(z_led) - 12, 'LED alerte', { size: 11, fill: C.doux });
  text(X(-ext_x / 2 - 2.5), Z(reed_z - 4 * Math.SQRT2) + 18, 'passe-fil', { size: 11, fill: C.doux });
  // cotes
  coteH(X(-ext_x / 2), X(ext_x / 2), Z(z_bas) + 40, fmt(ext_x), Z(0) + 4, Z(0) + 4);
  coteH(X(-bt_entraxe / 2), X(bt_entraxe / 2), Z(z_bouton) + bt_collerette_d / 2 * S + 26, fmt(bt_entraxe), Z(z_bouton), Z(z_bouton));
  coteV(Z(h_coque), Z(0), X(ext_x / 2) + 26, fmt(h_coque) + ' coque', X(ext_x / 2) + 4, X(ext_x / 2) + 4, 'd');
  coteV(Z(h_tot), Z(0), X(ext_x / 2) + 62, fmt(h_tot), X(ext_x / 2) + 4, X(ext_x / 2) + 4, 'd');
  coteV(Z(h_tot), Z(z_bas), X(ext_x / 2) + 98, fmt(h_tot - z_bas) + ' total', X(ext_x / 2) + 4, X(qt_tenon_larg / 2), 'd');
  coteV(Z(z_bouton), Z(0), X(-ext_x / 2) - 40, String(Math.round(z_bouton * 100) / 100).replace('.', ','), X(-bt_entraxe / 2), X(-ext_x / 2));
}

// ================= VUE DE GAUCHE =================
{
  const cx = 250, base = 760;
  titre(40, 560, 'Vue de gauche (← avant)');
  const Yv = y => cx - y * S, Z = z => base - z * S;
  rect(Yv(ext_y / 2), Z(h_coque), ext_y * S, h_coque * S, { fill: '#0B0B0D' });
  rect(Yv(ext_y / 2), Z(h_tot), ext_y * S, couvercle_ep * S, { fill: '#121216' });
  for (const sy of [-1, 1]) rect(Yv(sy * vis_y) - 2.35 * S, Z(h_tot + 1.4), 4.7 * S, 1.4 * S, { sw: 1, fill: '#222' });
  // boutons (collerettes en saillie à l'arrière)
  rect(Yv(-ext_y / 2), Z(z_bouton + bt_collerette_d / 2), 2 * S, bt_collerette_d * S, { fill: '#18181B' });
  // col et tenons
  rect(Yv(qt_col_d / 2), Z(0), qt_col_d * S, qt_h_col * S);
  rect(Yv(qt_tenon_d / 2), Z(-qt_h_col), qt_tenon_d * S, qt_tenon_ep * S);
  // passe-fil en goutte + trou
  const r = 4;
  const tipZ = reed_z - r * Math.SQRT2;
  const a1x = Yv(reed_y) - r * Math.SQRT1_2 * S, a2x = Yv(reed_y) + r * Math.SQRT1_2 * S, az = Z(reed_z - r * Math.SQRT1_2);
  path(`M${a1x.toFixed(1)} ${az.toFixed(1)} A${r * S} ${r * S} 0 1 1 ${a2x.toFixed(1)} ${az.toFixed(1)} L${Yv(reed_y).toFixed(1)} ${Z(tipZ).toFixed(1)} Z`, { fill: '#18181B' });
  circ(Yv(reed_y), Z(reed_z), (reed_cable_d - reed_serrage) / 2 * S, { stroke: C.violet });
  // LED latérale
  circ(Yv(led_lat_y), Z(z_led), 1.5 * S, { fill: '#F5F5F5', stroke: '#F5F5F5' });
  text(Yv(led_lat_y), Z(z_led) - 12, 'LED blanche', { size: 11, fill: C.doux });
  text(Yv(reed_y) + 2, Z(tipZ) + 18, 'câble reed', { size: 11, fill: C.doux });
  // cotes
  coteH(Yv(ext_y / 2), Yv(-ext_y / 2), Z(z_bas) + 40, fmt(ext_y), Z(0) + 4, Z(0) + 4);
  coteH(Yv(ext_y / 2), Yv(reed_y), Z(h_tot) - 34, fmt(ext_y / 2 - reed_y), Z(h_tot) - 4, Z(reed_z + 4));
  text(cx, Z(z_bas) + 66, `tenons Ø ${fmt(qt_tenon_d)} · col Ø ${fmt(qt_col_d)} (hypothèse Garmin)`, { size: 11, fill: C.violet });
  coteV(Z(reed_z), Z(0), Yv(ext_y / 2) - 46, fmt(reed_z), Yv(reed_y) - r * S, Yv(ext_y / 2));
  coteV(Z(z_led), Z(0), Yv(ext_y / 2) - 16, fmt(z_led), Yv(led_lat_y), Yv(ext_y / 2));
}

// ================= VUE AVANT =================
{
  const cx = 650, base = 760;
  titre(500, 560, 'Vue avant');
  const X = x => cx - x * S, Z = z => base - z * S;   // vue de l'avant : X vers la gauche
  rect(X(ext_x / 2), Z(h_coque), ext_x * S, h_coque * S, { fill: '#0B0B0D' });
  rect(X(ext_x / 2), Z(h_tot), ext_x * S, couvercle_ep * S, { fill: '#121216' });
  rect(X(-ext_x / 2), Z(reed_z + 4), 5 * S, (4 + 4 * Math.SQRT2) * S, { sw: 1.2 });
  rect(X(cm_x + cm_l / 2 + cm_jeu), Z(z_cm + cm_h / 2 + cm_jeu), (cm_l + 2 * cm_jeu) * S, (cm_h + 2 * cm_jeu) * S, { fill: '#3F3A1A', stroke: '#EAB308' });
  circ(X(buz_x), Z(z_buz), membrane_d / 2 * S, { stroke: C.doux, dash: 1 });
  rect(X(4), Z(h_coque), 8 * S, 1.5 * S, { sw: 1 });
  rect(X(qt_col_d / 2), Z(0), qt_col_d * S, qt_h_col * S);
  rect(X(qt_tenon_larg / 2), Z(-qt_h_col), qt_tenon_larg * S, qt_tenon_ep * S);
  text(X(cm_x), Z(z_cm + cm_h / 2) - 8, 'recharge', { size: 11, fill: C.doux });
  text(X(buz_x), Z(z_buz + membrane_d / 2) - 8, 'buzzer (paroi 1,2)', { size: 11, fill: C.doux });
  text(cx, Z(h_coque) + 20, 'encoche', { size: 11, fill: C.doux });
  coteH(X(cm_x + cm_l / 2 + cm_jeu), X(cm_x - cm_l / 2 - cm_jeu), Z(h_tot) - 30, fmt(cm_l + 2 * cm_jeu), Z(z_cm + cm_h / 2), Z(z_cm + cm_h / 2));
  coteH(X(ext_x / 2), X(-ext_x / 2), Z(z_bas) + 40, fmt(ext_x), Z(0) + 4, Z(0) + 4);
}

// ================= DÉTAIL DU JOINT =================
{
  const s = 22; // px/mm
  const ox = 1000, oz = 300;            // point (x = bord de l'alésage, z = dessus de la coque)
  titre(830, 100, 'Détail du joint (coupe)');
  const Xd = d => ox + d * s;          // d = distance horizontale depuis l'alésage (positif vers l'extérieur)
  const Zd = z => oz - z * s;          // z = hauteur depuis le dessus de la coque
  // paroi de la coque (avec chanfrein d'entrée)
  const hc = chanfrein_entree / Math.tan(Math.PI / 6);
  path(`M${Xd(0)} ${Zd(-8)} L${Xd(0)} ${Zd(-hc)} L${Xd(chanfrein_entree)} ${Zd(0)} L${Xd(paroi)} ${Zd(0)} L${Xd(paroi)} ${Zd(-8)}`, { fill: '#26262B' });
  // couvercle
  path(`M${Xd(-jupe_ep - jt_jeu_radial - 3)} ${Zd(0)} L${Xd(paroi)} ${Zd(0)} L${Xd(paroi)} ${Zd(couvercle_ep)} L${Xd(-jupe_ep - jt_jeu_radial - 3)} ${Zd(couvercle_ep)}`, { fill: '#1E1B2E' });
  // jupe avec gorge
  const j0 = -jt_jeu_radial, j1 = -jt_jeu_radial - jupe_ep;
  const g0 = jupe_garde_haut, g1 = jupe_garde_haut + jt_gorge_l;
  path(`M${Xd(j1)} ${Zd(0)} L${Xd(j1)} ${Zd(-h_jupe)} L${Xd(j0 - 0.5)} ${Zd(-h_jupe)} L${Xd(j0)} ${Zd(-h_jupe + 0.5)} L${Xd(j0)} ${Zd(-g1)} L${Xd(j0 - jt_prof)} ${Zd(-g1)} L${Xd(j0 - jt_prof)} ${Zd(-g0)} L${Xd(j0)} ${Zd(-g0)} L${Xd(j0)} ${Zd(0)}`, { fill: '#1E1B2E' });
  // joint écrasé (ellipse de même aire que le cercle Ø2)
  const rx = jt_ecart / 2, ry = Math.min((jt_d / 2) ** 2 / rx, jt_gorge_l / 2 - 0.05);
  add(`<ellipse cx="${Xd(-jt_ecart / 2).toFixed(1)}" cy="${Zd(-(g0 + g1) / 2).toFixed(1)}" rx="${(rx * s).toFixed(1)}" ry="${(ry * s).toFixed(1)}" fill="${C.joint}" stroke="${C.joint}"/>`);
  text(Xd(-2.5), Zd(1.5) + 4, 'couvercle', { size: 12, fill: C.trait });
  text(Xd(paroi / 2), Zd(-5), 'coque', { size: 12, fill: C.trait, rot: -90 });
  text(Xd(j1) - 10, Zd(-h_jupe / 2), 'jupe', { size: 12, anchor: 'end', fill: C.doux });
  text(Xd(-jt_ecart / 2) + 30, Zd(-(g0 + g1) / 2) + 4, '← joint', { size: 12, fill: C.joint, anchor: 'start' });
  // cotes
  const f2 = v => String(Math.round(v * 100) / 100).replace('.', ',');
  coteH(Xd(-jt_ecart), Xd(0), Zd(-h_jupe) + 30, f2(jt_ecart), Zd(-g1), Zd(-8));
  coteV(Zd(-g0), Zd(-g1), Xd(j1) - 46, f2(jt_gorge_l), Xd(j0 - jt_prof), Xd(j0 - jt_prof));
  const notes = [`écart alésage / fond de gorge : ${f2(jt_ecart)}`, `   = section 2 × (1 − 0,24)`, `gorge ${f2(jt_gorge_l)} × ${f2(jt_prof)} · jeu radial ${f2(jt_jeu_radial)}`,
    'écrasement réel ≈ 22 % · remplissage 79 %', 'joint NBR 53 × 2 (étiré de 3,8 %)', 'chanfrein d\'entrée 0,8 mm à 30°', 'vis M2,5 en dehors du joint'];
  notes.forEach((n, i) => text(840, 560 + i * 20, n, { size: 12, fill: C.violet, anchor: 'start' }));
}

// ================= LÉGENDE =================
{
  const y = 920;
  text(30, y, 'Cotes en violet, en mm. Traits pointillés : éléments cachés (tenons sous le fond, perçage des boutons, zone amincie devant le buzzer).', { size: 12, fill: C.doux, anchor: 'start' });
  text(30, y + 20, 'Les cotes des composants marquées « hypothèse » dans boitier.scad sont à mesurer à la réception ; ce dessin sera alors à régénérer.', { size: 12, fill: C.doux, anchor: 'start' });
  text(30, y + 40, 'Joint radial dans une gorge de la jupe du couvercle : son écrasement ne dépend pas du serrage des vis.', { size: 12, fill: C.doux, anchor: 'start' });
}
add('</svg>');
fs.writeFileSync(process.argv[2], out.join('\n'));
console.log('écrit', process.argv[2], out.length, 'éléments');
