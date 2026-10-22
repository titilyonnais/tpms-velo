// =====================================================================
// pneu.js — Modèle physique d'une chambre à air (ou d'un pneu tubeless)
// ---------------------------------------------------------------------
// MODÈLE DU MONDE (simulation) : logique pure, le temps est passé en
// paramètre. Nécessite atmosphere.js (pression atmosphérique).
//
// Idée centrale : on ne stocke PAS la pression, on stocke la QUANTITÉ
// D'AIR dans le pneu (n, en moles) et sa température. La pression en
// découle à chaque instant par la loi des gaz parfaits :
//
//                 P × V = n × R × T
//
//   P en Pa (pression ABSOLUE), V en m³, n en mol, T en kelvins,
//   R = 8,314 J/(mol·K).
//
// Tout le reste en découle naturellement :
//   - le pneu chauffe → T monte → P monte (n ne change pas) ;
//   - on monte un col → l'air extérieur pèse moins → la pression
//     RELATIVE (absolue − atmosphérique) augmente ;
//   - un trou → de l'air sort → n baisse → P baisse ;
//   - la pompe → de l'air entre → n monte.
//
// Pression ABSOLUE  = ce que l'air pousse réellement (Pa).
// Pression RELATIVE = absolue − pression atmosphérique locale : c'est ce
// qu'affiche un manomètre et ce qu'on appelle « 2,2 bar » au quotidien.
// =====================================================================
var TPMS = globalThis.TPMS || (globalThis.TPMS = {});

TPMS.ZERO_ABSOLU_C = 273.15;       // 0 °C = 273,15 K
TPMS.GAMMA_AIR = 1.4;              // rapport Cp/Cv de l'air (gaz diatomique)
TPMS.R_SPECIFIQUE_AIR = 287.05;    // R / M_air, J/(kg·K)

// ---------------------------------------------------------------------
// Volume et élasticité
// ---------------------------------------------------------------------
// Le volume d'un pneu grossit un peu avec la pression (la carcasse
// s'étire). Hypothèse : +1 % de volume par bar de pression relative
// (ordre de grandeur des mesures de largeur d'un pneu selon la pression,
// quelques dixièmes de mm par bar). On le prend en compte car il atténue
// un peu les variations de pression (le pneu « encaisse » en gonflant).
TPMS.ELASTICITE_PAR_BAR = 0.01;

// Diamètre de jante ETRTO 622 mm = roue de 700C / 29 pouces.
TPMS.JANTE_622_MM = 622;

// Volume d'air estimé d'un pneu : un tore (une « bouée »).
//   V = 2π × R × π × r²   avec r = demi-largeur, R = rayon jante + r
// Exemples : 700×25 ≈ 1 L ; 700×40 ≈ 2,6 L ; 29×2,3 (58 mm) ≈ 5,6 L.
TPMS.volumePneuL = function (largeurMm, diametreJanteMm) {
  var r = largeurMm / 2 / 1000;                          // m
  var R = (diametreJanteMm || TPMS.JANTE_622_MM) / 2 / 1000 + r;
  return 2 * Math.PI * R * Math.PI * r * r * 1000;       // m³ → L
};

// ---------------------------------------------------------------------
// Perméation : l'air traverse lentement le caoutchouc, même sans trou.
// Exprimée en part de la pression RELATIVE perdue par jour à 20 °C.
// Valeurs typiques (recommandations des fabricants : Schwalbe, Michelin,
// Vittoria ; tests de perte de pression publiés par la presse vélo) :
//   - butyle : très étanche, ≈ 0,1 bar par semaine sur 2 bar → 1,5 %/jour
//   - latex  : poreux, « regonfler avant chaque sortie », ≈ 20 %/jour
//   - tubeless (pneu + préventif) : ≈ 5 %/jour
// ---------------------------------------------------------------------
TPMS.PERMEATION_PAR_JOUR = {
  butyle: 0.015,
  latex: 0.20,
  tubeless: 0.05
};
// La perméation double environ tous les 15 °C (loi d'Arrhenius,
// hypothèse sur l'ordre de grandeur pour les élastomères).
TPMS.PERMEATION_DOUBLE_TOUS_LES_C = 15;

// ---------------------------------------------------------------------
// Thermique de l'air du pneu (hypothèses, ordres de grandeur)
// ---------------------------------------------------------------------
TPMS.THERMIQUE_PNEU = {
  constanteTempsS: 600,      // ≈ 10 min à l'arrêt : 0,5 kg de caoutchouc à réchauffer
  ventilationMs: 3,          // en roulant, l'échange de chaleur est multiplié par (1 + v/3)
  roulementCParMs: 0.1,      // échauffement par déformation du caoutchouc : +0,1 °C par m/s (+1 °C à 36 km/h)
  soleilC: 12,               // pneu noir en plein soleil, à l'arrêt : air intérieur ≈ +12 °C
  freinageC: 60,             // freins sur jante serrés en permanence : jante > 100 °C, air ≈ +60 °C
  pluieC: -2,                // pneu mouillé : l'évaporation le refroidit un peu
  pluieAccelere: 2           // et l'eau échange la chaleur deux fois plus vite
};

// En dessous de cette pression relative, le pneu est inutilisable.
TPMS.SEUIL_A_PLAT_BAR = 0.15;  // hypothèse

// ---------------------------------------------------------------------
// Trous : caractéristiques par type de crevaison.
// cd = coefficient de décharge : part de la section qui laisse vraiment
// passer l'air (0,6 pour un trou net, norme ISO 5167 pour les orifices).
// ---------------------------------------------------------------------
TPMS.TYPES_TROU = {
  // Épine : le caoutchouc se referme en partie autour du trou, et l'épine
  // reste souvent plantée → section efficace réduite (hypothèse cd = 0,3).
  epine:     { diametreMm: 1.0, cd: 0.3, nombre: 1 },
  // Pincement (« snake bite ») : la chambre est pincée contre la jante,
  // DEUX fentes parallèles → se vide en quelques secondes.
  pincement: { diametreMm: 2.0, cd: 0.6, nombre: 2 },
  // Valve arrachée ou mal serrée : passage de l'ordre du mm.
  valve:     { diametreMm: 1.5, cd: 0.6, nombre: 1 },
  // Micro-trou (fuite lente) : quelques centièmes de mm.
  micro:     { diametreMm: 0.025, cd: 0.6, nombre: 1 }
};

// ---------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------
// options = { nom, volumeL, pressionRelBar, temperatureC, altitudeM,
//             chambre: "butyle"|"latex"|"tubeless", largeurMm, graine }
// volumeL = volume « au repos » (pneu tout juste en forme, 0 bar relatif).
// S'il manque, on l'estime à partir de largeurMm (jante 622).
TPMS.creerPneu = function (options) {
  var o = options || {};
  var largeur = o.largeurMm || 40;
  var p = {
    nom: o.nom || "pneu",
    chambre: o.chambre || "butyle",
    largeurMm: largeur,
    volumeReposM3: (o.volumeL || TPMS.volumePneuL(largeur)) / 1000,
    elasticiteParBar: TPMS.ELASTICITE_PAR_BAR,
    altitudeM: o.altitudeM || 0,
    temperatureAirC: o.temperatureC === undefined ? 20 : o.temperatureC,
    nMol: 0,
    orifices: [],               // trous : [{ type, diametreMm, cd }]
    graine: o.graine || 1,
    pressionRelBar: 0,
    aPlat: false
  };

  // Quantité d'air : n = P·V / (R·T), avec la pression ABSOLUE.
  var pressionRel = o.pressionRelBar === undefined ? 2 : o.pressionRelBar;
  var pAbs = pressionRel * TPMS.PA_PAR_BAR + TPMS.pressionAtmospheriquePa(p.altitudeM);
  var volume = p.volumeReposM3 * (1 + p.elasticiteParBar * Math.max(0, pressionRel));
  p.nMol = pAbs * volume / (TPMS.R_GAZ * (p.temperatureAirC + TPMS.ZERO_ABSOLU_C));

  TPMS.pneuMettreAJour(p);
  return p;
};

// ---------------------------------------------------------------------
// Pression
// ---------------------------------------------------------------------
// Pression absolue (Pa). Sans élasticité : P = nRT / V.
// Avec élasticité : V = V0 × (1 + e·(P − Pext)) dépend de P lui-même,
// donc P·V0·(1 + e·(P − Pext)) = nRT, équation du second degré en P :
//    a·P² + b·P − nRT = 0   avec a = e·V0, b = V0·(1 − e·Pext)
//    P = (−b + √(b² + 4·a·nRT)) / (2a)
// (e est ici en « par pascal » : e_bar / 100 000.)
TPMS.pneuPressionAbsoluePa = function (pneu) {
  var nRT = pneu.nMol * TPMS.R_GAZ * (pneu.temperatureAirC + TPMS.ZERO_ABSOLU_C);
  var V0 = pneu.volumeReposM3;
  var pExt = TPMS.pressionAtmospheriquePa(pneu.altitudeM);
  var sansElasticite = nRT / V0;
  var e = pneu.elasticiteParBar / TPMS.PA_PAR_BAR;
  // Pneu dégonflé (pression ≤ extérieur) : la carcasse ne s'étire pas.
  if (e <= 0 || sansElasticite <= pExt) return sansElasticite;
  var a = e * V0;
  var b = V0 * (1 - e * pExt);
  return (-b + Math.sqrt(b * b + 4 * a * nRT)) / (2 * a);
};

// Pression relative (bar) par rapport à l'air extérieur à altitudeM.
TPMS.pneuPressionRelativeBar = function (pneu, altitudeM) {
  var alt = altitudeM === undefined ? pneu.altitudeM : altitudeM;
  return (TPMS.pneuPressionAbsoluePa(pneu) - TPMS.pressionAtmospheriquePa(alt)) / TPMS.PA_PAR_BAR;
};

// Volume actuel (m³), pour l'affichage.
TPMS.pneuVolumeM3 = function (pneu) {
  var rel = TPMS.pneuPressionRelativeBar(pneu);
  return pneu.volumeReposM3 * (1 + pneu.elasticiteParBar * Math.max(0, rel));
};

// Recalcule les champs lisibles (pression relative, à plat).
TPMS.pneuMettreAJour = function (pneu) {
  pneu.pressionRelBar = TPMS.pneuPressionRelativeBar(pneu);
  pneu.aPlat = pneu.pressionRelBar < TPMS.SEUIL_A_PLAT_BAR;
};

// ---------------------------------------------------------------------
// Écoulement de l'air par un trou (équation de Saint-Venant et Wantzel)
// ---------------------------------------------------------------------
// L'air va du côté à haute pression (amont) vers la basse pression (aval).
// Deux régimes :
//   - si l'aval est à moins de 52,8 % de l'amont, l'air atteint la vitesse
//     du son dans le trou : le débit est « étranglé » (sonique) et ne
//     dépend plus que de la pression amont ;
//   - sinon, le débit dépend de l'écart de pression (subsonique).
// Retourne le débit en mol/s (toujours ≥ 0).
TPMS.RAPPORT_CRITIQUE = Math.pow(2 / (TPMS.GAMMA_AIR + 1), TPMS.GAMMA_AIR / (TPMS.GAMMA_AIR - 1)); // 0,528

TPMS.debitOrificeMolS = function (cd, aireM2, pAmontPa, pAvalPa, tAmontK) {
  if (pAmontPa <= pAvalPa) return 0;
  var g = TPMS.GAMMA_AIR;
  var rT = TPMS.R_SPECIFIQUE_AIR * tAmontK;
  var rapport = pAvalPa / pAmontPa;
  var debitKgS;
  if (rapport <= TPMS.RAPPORT_CRITIQUE) {
    // Régime sonique (étranglé)
    debitKgS = cd * aireM2 * pAmontPa * Math.sqrt(g / rT) *
      Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  } else {
    // Régime subsonique
    debitKgS = cd * aireM2 * pAmontPa * Math.sqrt(2 * g / ((g - 1) * rT) *
      (Math.pow(rapport, 2 / g) - Math.pow(rapport, (g + 1) / g)));
  }
  return debitKgS / TPMS.M_AIR;   // kg/s → mol/s
};

// Débit total de tous les trous du pneu (mol/s). Positif = l'air SORT.
// (Si le pneu est à plat et qu'on descend un col, l'air extérieur devient
// plus dense que l'air intérieur : il RENTRE, débit négatif.)
TPMS.pneuDebitTrousMolS = function (pneu, pExtPa, tExtK) {
  var pInt = TPMS.pneuPressionAbsoluePa(pneu);
  var tInt = pneu.temperatureAirC + TPMS.ZERO_ABSOLU_C;
  var total = 0;
  for (var i = 0; i < pneu.orifices.length; i++) {
    var trou = pneu.orifices[i];
    var aire = Math.PI * Math.pow(trou.diametreMm / 2000, 2);   // mm → m, section du disque
    total += TPMS.debitOrificeMolS(trou.cd, aire, pInt, pExtPa, tInt);
    total -= TPMS.debitOrificeMolS(trou.cd, aire, pExtPa, pInt, tExtK);
  }
  return total;
};

// ---------------------------------------------------------------------
// Faire évoluer le pneu pendant dtS secondes.
// contexte = { temperatureAmbianteC, ensoleillement (0..1), vitesseMs,
//              altitudeM, freinage (0..1), pluie }
// ---------------------------------------------------------------------
// Méthode : on découpe dtS en pas d'au plus 1 s (Euler explicite). Pour
// les trous, chaque pas est encore redécoupé pour qu'un petit pas ne
// fasse jamais sortir plus de 10 % de l'air « en trop » : ainsi même une
// crevaison qui vide le pneu en 3 s reste stable et ne fait jamais
// descendre la pression sous celle de l'extérieur.
TPMS.PAS_MAX_S = 1;

TPMS.pneuAvancer = function (pneu, dtS, contexte) {
  var ctx = contexte || {};
  var restant = dtS;
  while (restant > 1e-9) {
    var pas = Math.min(TPMS.PAS_MAX_S, restant);
    TPMS.pneuUnPas(pneu, pas, ctx);
    restant -= pas;
  }
  TPMS.pneuMettreAJour(pneu);
  return pneu;
};

// Température d'équilibre de l'air du pneu (°C) dans un contexte donné :
// ambiante + roulement + soleil (moins en roulant, l'air ventile)
//           + freinage sur jante, ou un peu moins sous la pluie.
TPMS.pneuTemperatureEquilibreC = function (ctx) {
  var th = TPMS.THERMIQUE_PNEU;
  var v = Math.max(0, ctx.vitesseMs || 0);
  var ventilation = 1 + v / th.ventilationMs;
  var t = ctx.temperatureAmbianteC === undefined ? 20 : ctx.temperatureAmbianteC;
  t += th.roulementCParMs * v;
  if (ctx.pluie) {
    t += th.pluieC;
  } else {
    t += th.soleilC * (ctx.ensoleillement || 0) / ventilation;
  }
  t += th.freinageC * Math.max(0, Math.min(1, ctx.freinage || 0));
  return t;
};

TPMS.pneuUnPas = function (pneu, dtS, ctx) {
  var th = TPMS.THERMIQUE_PNEU;
  var tAmbC = ctx.temperatureAmbianteC === undefined ? 20 : ctx.temperatureAmbianteC;
  var tExtK = tAmbC + TPMS.ZERO_ABSOLU_C;
  if (ctx.altitudeM !== undefined) pneu.altitudeM = ctx.altitudeM;
  var pExt = TPMS.pressionAtmospheriquePa(pneu.altitudeM);

  // 1. Thermique : système du premier ordre, la température rejoint
  //    l'équilibre avec une constante de temps τ :
  //       T ← T + (Téq − T) × (1 − e^(−dt/τ))
  //    (solution exacte sur le pas : jamais de dépassement, même si dt > τ)
  var v = Math.max(0, ctx.vitesseMs || 0);
  var tau = th.constanteTempsS / (1 + v / th.ventilationMs);
  if (ctx.pluie) tau /= th.pluieAccelere;
  var tEq = TPMS.pneuTemperatureEquilibreC(ctx);
  pneu.temperatureAirC += (tEq - pneu.temperatureAirC) * (1 - Math.exp(-dtS / tau));

  // 2. Perméation à travers le caoutchouc : on perd chaque jour une part
  //    fixe de l'air « en trop » (celui qui fait la pression relative).
  //    Air en trop = (Pint − Pext) × V / (R·T).
  var tK = pneu.temperatureAirC + TPMS.ZERO_ABSOLU_C;
  var pInt = TPMS.pneuPressionAbsoluePa(pneu);
  var tauxJour = TPMS.PERMEATION_PAR_JOUR[pneu.chambre] || TPMS.PERMEATION_PAR_JOUR.butyle;
  var facteurChaleur = Math.pow(2, (pneu.temperatureAirC - 20) / TPMS.PERMEATION_DOUBLE_TOUS_LES_C);
  var airEnTrop = (pInt - pExt) * TPMS.pneuVolumeM3(pneu) / (TPMS.R_GAZ * tK);
  pneu.nMol -= airEnTrop * tauxJour * facteurChaleur * dtS / 86400;

  // 3. Trous (crevaison, fuite lente) : sous-pas adaptatifs.
  if (pneu.orifices.length > 0) {
    // Quantité d'air pour laquelle l'intérieur serait à la pression extérieure.
    var restant = dtS;
    var garde = 0;
    while (restant > 1e-9 && garde < 1000) {
      garde++;
      tK = pneu.temperatureAirC + TPMS.ZERO_ABSOLU_C;
      var nEquilibre = pExt * pneu.volumeReposM3 / (TPMS.R_GAZ * tK);
      var exces = pneu.nMol - nEquilibre;          // > 0 : l'air veut sortir
      var debit = TPMS.pneuDebitTrousMolS(pneu, pExt, tExtK);
      if (Math.abs(exces) < 1e-7 * pneu.nMol || debit === 0) break;
      var h = Math.min(restant, Math.max(1e-4, 0.1 * Math.abs(exces / debit)));
      var dn = debit * h;
      // Jamais au-delà de l'équilibre (pas d'oscillation numérique).
      if (Math.abs(dn) > Math.abs(exces)) dn = exces;
      if (dn < 0) {
        // L'air extérieur qui entre se mélange à l'air intérieur.
        var entrant = -dn;
        pneu.temperatureAirC = (pneu.nMol * pneu.temperatureAirC + entrant * tAmbC) / (pneu.nMol + entrant);
      }
      // L'air qui sort ne change pas la température de l'air qui reste :
      // détente supposée isotherme, car le caoutchouc (≈ 0,5 kg) rend
      // presque aussitôt sa chaleur aux quelques grammes d'air.
      pneu.nMol -= dn;
      restant -= h;
    }
  }
  if (pneu.nMol < 0) pneu.nMol = 0;
};

// ---------------------------------------------------------------------
// Crevaisons et réparation
// ---------------------------------------------------------------------
// trou = { diametreMm, type: "epine"|"pincement"|"valve" }
// Ajoute le ou les orifices correspondants (2 pour un pincement).
TPMS.pneuPercer = function (pneu, trou) {
  var t = trou || {};
  var type = TPMS.TYPES_TROU[t.type] ? t.type : "epine";
  var modele = TPMS.TYPES_TROU[type];
  var diametre = t.diametreMm || modele.diametreMm;
  for (var i = 0; i < modele.nombre; i++) {
    pneu.orifices.push({ type: type, diametreMm: diametre, cd: modele.cd });
  }
  return pneu.orifices;
};

// Fuite lente : un micro-trou (0,02 à 0,05 mm). Avec 0,025 mm dans un
// pneu de 2,6 L à 2,2 bar : ≈ 0,25 bar perdu par heure.
TPMS.pneuFuiteLente = function (pneu, diametreMm) {
  var modele = TPMS.TYPES_TROU.micro;
  pneu.orifices.push({ type: "micro", diametreMm: diametreMm || modele.diametreMm, cd: modele.cd });
  return pneu.orifices;
};

// Réparation (rustine ou chambre neuve) : plus aucun trou. La pression
// reste ce qu'elle est : il faudra regonfler.
TPMS.pneuReparer = function (pneu) {
  pneu.orifices = [];
  return pneu;
};

// ---------------------------------------------------------------------
// Pompe
// ---------------------------------------------------------------------
TPMS.POMPE_A_PIED_CM3 = 400;       // volume d'un coup de pompe à pied (hypothèse : Ø 32 mm × 50 cm)
// Volume mort : air qui reste dans le bas du cylindre et le tuyau à la
// fin du coup (hypothèse 4 %). C'est lui qui limite la pression maximale
// d'une pompe : Pmax ≈ Pext × (Vpompe + Vmort) / Vmort ≈ 26 bar ici.
TPMS.POMPE_VOLUME_MORT = 0.04;
// L'air comprimé chauffe (loi de Laplace : T × P^((1−γ)/γ) constant),
// mais le cylindre et le tuyau absorbent presque tout : hypothèse, 10 %
// de cet échauffement arrive dans le pneu.
TPMS.POMPE_PART_CHALEUR = 0.10;

// Donne des coups de pompe. Retourne la nouvelle pression relative (bar).
// La durée du gonflage est négligée (pas de fuite pendant ce temps).
TPMS.pneuGonfler = function (pneu, coupsDePompe, volumePompeCm3, altitudeM, temperatureAmbianteC) {
  var vPompe = (volumePompeCm3 || TPMS.POMPE_A_PIED_CM3) / 1e6;    // cm³ → m³
  var vMort = vPompe * TPMS.POMPE_VOLUME_MORT;
  if (altitudeM !== undefined) pneu.altitudeM = altitudeM;
  var tAmbC = temperatureAmbianteC === undefined ? 20 : temperatureAmbianteC;
  var tAmbK = tAmbC + TPMS.ZERO_ABSOLU_C;
  var pExt = TPMS.pressionAtmospheriquePa(pneu.altitudeM);
  var g = TPMS.GAMMA_AIR;

  for (var i = 0; i < coupsDePompe; i++) {
    var pInt = TPMS.pneuPressionAbsoluePa(pneu);
    // Air aspiré : tout le cylindre à la pression extérieure.
    // Air qui reste à la fin : le volume mort, à la pression du pneu.
    // La différence est entrée dans le pneu.
    var nEntre = (pExt * (vPompe + vMort) - pInt * vMort) / (TPMS.R_GAZ * tAmbK);
    if (nEntre <= 0) break;        // la pompe ne peut plus vaincre la pression

    // Température de l'air qui arrive (compression, part retenue).
    var tCompressionC = tAmbK * Math.pow(Math.max(1, pInt / pExt), (g - 1) / g) - TPMS.ZERO_ABSOLU_C;
    var tEntreeC = tAmbC + TPMS.POMPE_PART_CHALEUR * (tCompressionC - tAmbC);

    // Mélange : moyenne des températures pondérée par les quantités d'air.
    pneu.temperatureAirC = (pneu.nMol * pneu.temperatureAirC + nEntre * tEntreeC) / (pneu.nMol + nEntre);
    pneu.nMol += nEntre;
  }
  TPMS.pneuMettreAJour(pneu);
  return pneu.pressionRelBar;
};

// Gonfle coup par coup jusqu'à la pression cible. Retourne le nombre de
// coups donnés (s'arrête si la pompe n'y arrive plus).
TPMS.pneuGonflerJusqua = function (pneu, pressionRelBar, altitudeM, temperatureAmbianteC) {
  var coups = 0;
  if (altitudeM !== undefined) pneu.altitudeM = altitudeM;
  TPMS.pneuMettreAJour(pneu);
  while (pneu.pressionRelBar < pressionRelBar && coups < 2000) {
    var avant = pneu.pressionRelBar;
    TPMS.pneuGonfler(pneu, 1, TPMS.POMPE_A_PIED_CM3, altitudeM, temperatureAmbianteC);
    if (pneu.pressionRelBar <= avant + 1e-6) break;   // la pompe plafonne
    coups++;
  }
  return coups;
};
