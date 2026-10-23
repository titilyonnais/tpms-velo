// =====================================================================
// base.js — Base de données SQLite du serveur de flotte
// ---------------------------------------------------------------------
// SQLite est intégré à Node 24 (module node:sqlite) : aucune dépendance
// à installer, la base est un simple fichier (serveur/flotte.db).
//
// ANTI-INJECTION SQL : TOUTES les requêtes sont « préparées » avec des
// paramètres « ? ». La valeur envoyée par le client n'est JAMAIS collée
// dans le texte SQL : SQLite la reçoit à part, comme une donnée. Même si
// un identifiant vaut  V01' OR '1'='1 , SQLite cherche un vélo qui
// s'appelle exactement ainsi... et n'en trouve pas.
//   Interdit :  db.exec("SELECT * FROM velos WHERE id = '" + id + "'")
//   Utilisé  :  db.prepare("SELECT * FROM velos WHERE id = ?").get(id)
//
// Les règles métier (regonflage, alertes, tendances) ne sont pas
// écrites ici : elles viennent de flotte/flotte-logique.js, partagé avec
// le mode démo de la page. La base ne fait que stocker et agréger.
// =====================================================================
var DatabaseSync = require("node:sqlite").DatabaseSync;
var TPMS = require("../flotte/node.js");

// ---------------------------------------------------------------------
// Schéma
// ---------------------------------------------------------------------
var SCHEMA = `
-- Un vélo de la flotte. Sa clé secrète n'est PAS ici : elle est dans la
-- configuration (cles-demo.json en démo, un coffre à secrets en vrai).
CREATE TABLE IF NOT EXISTS velos (
  id                TEXT PRIMARY KEY,           -- "V01" à "V20"
  nom               TEXT NOT NULL,
  derniere_sequence INTEGER NOT NULL DEFAULT 0, -- anti-rejeu : la séquence doit toujours augmenter
  -- Tendance de chaque roue sur plusieurs jours (recalculée à chaque lot)
  pente_av REAL, fuite_av INTEGER NOT NULL DEFAULT 0, seuil_av_ms INTEGER,
  pente_ar REAL, fuite_ar INTEGER NOT NULL DEFAULT 0, seuil_ar_ms INTEGER
);

-- Une mesure envoyée par le boîtier (une toutes les 10 min environ).
CREATE TABLE IF NOT EXISTS mesures (
  id          INTEGER PRIMARY KEY,
  velo_id     TEXT NOT NULL REFERENCES velos(id),
  t           INTEGER NOT NULL,                 -- instant (ms depuis 1970)
  p_av REAL, p_ar REAL,                         -- pression (bar), NULL si capteur perdu
  temp_av REAL, temp_ar REAL,                   -- température des capteurs (°C)
  pile_av INTEGER, pile_ar INTEGER,             -- pile des capteurs (%)
  batterie    INTEGER NOT NULL,                 -- batterie du boîtier (%)
  lat REAL NOT NULL, lon REAL NOT NULL,
  km          REAL NOT NULL,                    -- compteur du boîtier
  etat_av TEXT NOT NULL, etat_ar TEXT NOT NULL, -- état calculé par le boîtier (logique/alertes.js)
  en_location INTEGER NOT NULL,                 -- 0 ou 1
  UNIQUE (velo_id, t)                           -- crée aussi l'index (velo_id, t)
);

-- Alertes : celles du boîtier (crevaison, pression basse...) et celles
-- que seul le serveur peut voir (fuite lente sur plusieurs jours).
CREATE TABLE IF NOT EXISTS alertes (
  id       INTEGER PRIMARY KEY,
  velo_id  TEXT NOT NULL REFERENCES velos(id),
  t        INTEGER NOT NULL,
  roue     TEXT,                                -- "AV", "AR" ou NULL (boîtier)
  type     TEXT NOT NULL,                       -- CREVAISON, BASSE, FUITE_LENTE, BATTERIE...
  pression REAL,
  source   TEXT NOT NULL                        -- "boitier" ou "serveur"
);
CREATE INDEX IF NOT EXISTS alertes_t ON alertes (t);

-- Regonflages détectés (la pression remonte de plus de 0,2 bar d'un coup).
CREATE TABLE IF NOT EXISTS regonflages (
  id      INTEGER PRIMARY KEY,
  velo_id TEXT NOT NULL REFERENCES velos(id),
  t       INTEGER NOT NULL,
  roue    TEXT NOT NULL,
  avant   REAL, apres REAL
);

-- Journal des requêtes refusées (cybersécurité : on garde une trace).
CREATE TABLE IF NOT EXISTS refus (
  id     INTEGER PRIMARY KEY,
  t      INTEGER NOT NULL,
  ip     TEXT NOT NULL,
  velo   TEXT,                                  -- identifiant ANNONCÉ (non vérifié, tronqué)
  motif  TEXT NOT NULL,
  detail TEXT
);
`;

// ---------------------------------------------------------------------
// Ouverture : chemin du fichier, ou ":memory:" pour les tests.
// velos = [{ id, nom }]
// ---------------------------------------------------------------------
function ouvrirBase(chemin, velos) {
  var db = new DatabaseSync(chemin);
  db.exec("PRAGMA foreign_keys = ON");
  if (chemin !== ":memory:") db.exec("PRAGMA journal_mode = WAL");   // lectures pendant les écritures
  db.exec(SCHEMA);

  var ajouterVelo = db.prepare("INSERT OR IGNORE INTO velos (id, nom) VALUES (?, ?)");
  velos.forEach(function (v) { ajouterVelo.run(v.id, v.nom); });

  // Requêtes préparées une fois pour toutes (plus rapide, et toujours paramétrées).
  var R = {
    velo: db.prepare("SELECT * FROM velos WHERE id = ?"),
    tousLesVelos: db.prepare("SELECT * FROM velos ORDER BY id"),
    derniereMesure: db.prepare("SELECT * FROM mesures WHERE velo_id = ? ORDER BY t DESC LIMIT 1"),
    // Dernière mesure de chaque vélo, en UNE requête : jointure sur le MAX(t) par vélo.
    dernieresMesures: db.prepare(
      "SELECT m.* FROM mesures m " +
      "JOIN (SELECT velo_id, MAX(t) AS t FROM mesures GROUP BY velo_id) d " +
      "  ON d.velo_id = m.velo_id AND d.t = m.t"),
    insererMesure: db.prepare(
      "INSERT OR IGNORE INTO mesures (velo_id, t, p_av, p_ar, temp_av, temp_ar, pile_av, pile_ar, " +
      "batterie, lat, lon, km, etat_av, etat_ar, en_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    insererAlerte: db.prepare("INSERT INTO alertes (velo_id, t, roue, type, pression, source) VALUES (?, ?, ?, ?, ?, ?)"),
    insererRegonflage: db.prepare("INSERT INTO regonflages (velo_id, t, roue, avant, apres) VALUES (?, ?, ?, ?, ?)"),
    pointsAv: db.prepare("SELECT t, p_av AS p, temp_av AS temp FROM mesures WHERE velo_id = ? AND t >= ? ORDER BY t"),
    pointsAr: db.prepare("SELECT t, p_ar AS p, temp_ar AS temp FROM mesures WHERE velo_id = ? AND t >= ? ORDER BY t"),
    majTendance: db.prepare(
      "UPDATE velos SET pente_av = ?, fuite_av = ?, seuil_av_ms = ?, pente_ar = ?, fuite_ar = ?, seuil_ar_ms = ? WHERE id = ?"),
    majSequence: db.prepare("UPDATE velos SET derniere_sequence = ? WHERE id = ?"),
    historique: db.prepare("SELECT * FROM mesures WHERE velo_id = ? AND t >= ? ORDER BY t"),
    regonflagesVelo: db.prepare("SELECT * FROM regonflages WHERE velo_id = ? AND t >= ? ORDER BY t"),
    alertes: db.prepare("SELECT * FROM alertes ORDER BY t DESC, id DESC LIMIT ?"),
    noterRefus: db.prepare("INSERT INTO refus (t, ip, velo, motif, detail) VALUES (?, ?, ?, ?, ?)"),
    refus: db.prepare("SELECT * FROM refus ORDER BY id DESC LIMIT ?"),
    // --- Statistiques (agrégats SQL) ---
    nbMesures: db.prepare("SELECT COUNT(*) AS n FROM mesures"),
    nbMesuresDepuis: db.prepare("SELECT COUNT(*) AS n FROM mesures WHERE t >= ?"),
    alertesParType: db.prepare(
      "SELECT type, COUNT(*) AS n FROM alertes WHERE t >= ? GROUP BY type ORDER BY n DESC, type"),
    nbRegonflages: db.prepare("SELECT COUNT(*) AS n FROM regonflages"),
    nbRegonflagesDepuis: db.prepare("SELECT COUNT(*) AS n FROM regonflages WHERE t >= ?"),
    // Temps moyen entre deux regonflages d'une même roue : LAG(t) donne,
    // pour chaque regonflage, l'instant du regonflage PRÉCÉDENT de la même
    // roue du même vélo (fonction de fenêtre, SQLite ≥ 3.25).
    tempsMoyenRegonflage: db.prepare(
      "SELECT AVG(ecart) AS moyenne FROM (" +
      "  SELECT t - LAG(t) OVER (PARTITION BY velo_id, roue ORDER BY t) AS ecart FROM regonflages" +
      ") WHERE ecart IS NOT NULL"),
    // Kilomètres parcourus sur la période : compteur max − min, par vélo, puis somme.
    kmDepuis: db.prepare(
      "SELECT COALESCE(SUM(d), 0) AS km FROM (" +
      "  SELECT MAX(km) - MIN(km) AS d FROM mesures WHERE t >= ? GROUP BY velo_id)"),
    refusParMotif: db.prepare("SELECT motif, COUNT(*) AS n FROM refus GROUP BY motif ORDER BY n DESC, motif"),
    nbRefusDepuis: db.prepare("SELECT COUNT(*) AS n FROM refus WHERE t >= ?")
  };

  // Conversion d'une ligne SQL en mesure au format de l'API.
  function ligneEnMesure(l) {
    return {
      t: l.t, pAv: l.p_av, pAr: l.p_ar, tAv: l.temp_av, tAr: l.temp_ar,
      pileAv: l.pile_av, pileAr: l.pile_ar, batterie: l.batterie,
      lat: l.lat, lon: l.lon, km: l.km, etatAv: l.etat_av, etatAr: l.etat_ar,
      enLocation: l.en_location === 1
    };
  }

  // Ligne de la table velos + dernière mesure → « fiche » pour flotteResume.
  function fiche(ligneVelo, derniere) {
    function tendance(pente, fuite, seuil) {
      return { penteBarJour: pente, fuiteLente: fuite === 1, seuilMs: seuil };
    }
    return {
      id: ligneVelo.id, nom: ligneVelo.nom,
      derniere: derniere ? ligneEnMesure(derniere) : null,
      tendance: {
        AV: tendance(ligneVelo.pente_av, ligneVelo.fuite_av, ligneVelo.seuil_av_ms),
        AR: tendance(ligneVelo.pente_ar, ligneVelo.fuite_ar, ligneVelo.seuil_ar_ms)
      }
    };
  }

  // Transaction : tout ou rien. Si une erreur survient au milieu d'un
  // lot, aucune mesure de ce lot n'est gardée.
  function transaction(travail) {
    db.exec("BEGIN");
    try {
      var resultat = travail();
      db.exec("COMMIT");
      return resultat;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  return {
    db: db,

    velo: function (id) { return R.velo.get(id); },

    // Enregistre un lot DÉJÀ authentifié et validé. Mêmes règles que le
    // registre en mémoire de la démo (flotte/registre.js).
    enregistrerLot: function (id, mesures, sequence) {
      return transaction(function () {
        var bilan = { acceptees: 0, ignorees: 0, alertes: 0, regonflages: 0 };
        var ligne = R.derniereMesure.get(id);
        var precedente = ligne ? ligneEnMesure(ligne) : null;
        mesures.forEach(function (m) {
          // Seules les mesures plus récentes que la dernière reçue comptent.
          if (precedente && m.t <= precedente.t) { bilan.ignorees++; return; }
          var r = R.insererMesure.run(id, m.t, m.pAv, m.pAr, m.tAv, m.tAr, m.pileAv, m.pileAr,
            m.batterie, m.lat, m.lon, m.km, m.etatAv, m.etatAr, m.enLocation ? 1 : 0);
          if (r.changes === 0) { bilan.ignorees++; return; }
          bilan.acceptees++;
          TPMS.flotteEvenements(precedente, m).forEach(function (ev) {
            if (ev.type === "regonflage") {
              R.insererRegonflage.run(id, m.t, ev.roue, ev.avant, ev.apres);
              bilan.regonflages++;
            } else {
              R.insererAlerte.run(id, m.t, ev.roue, ev.alerte, ev.pression, ev.source);
              bilan.alertes++;
            }
          });
          precedente = m;
        });

        if (bilan.acceptees > 0) {
          // Tendances sur 14 jours, comme le registre de la démo.
          var v = R.velo.get(id);
          var avant = fiche(v, null).tendance;
          var depuis = precedente.t - TPMS.FLOTTE.tendanceFenetreMs;
          var apres = {
            AV: TPMS.flotteTendance(R.pointsAv.all(id, depuis), "AV"),
            AR: TPMS.flotteTendance(R.pointsAr.all(id, depuis), "AR")
          };
          ["AV", "AR"].forEach(function (roue) {
            if (TPMS.flotteNouvelleFuite(avant[roue], apres[roue])) {
              R.insererAlerte.run(id, precedente.t, roue, "FUITE_LENTE", apres[roue].pressionBar, "serveur");
              bilan.alertes++;
            }
          });
          function champ(tend, nom) { return tend ? (nom === "fuiteLente" ? (tend.fuiteLente ? 1 : 0) : tend[nom]) : (nom === "fuiteLente" ? 0 : null); }
          R.majTendance.run(
            champ(apres.AV, "penteBarJour"), champ(apres.AV, "fuiteLente"), champ(apres.AV, "seuilMs"),
            champ(apres.AR, "penteBarJour"), champ(apres.AR, "fuiteLente"), champ(apres.AR, "seuilMs"), id);
        }
        R.majSequence.run(sequence, id);
        return bilan;
      });
    },

    // Fiches de tous les vélos (pour flotteResume).
    fiches: function () {
      var dernieres = {};
      R.dernieresMesures.all().forEach(function (l) { dernieres[l.velo_id] = l; });
      return R.tousLesVelos.all().map(function (v) { return fiche(v, dernieres[v.id]); });
    },

    fiche: function (id) {
      var v = R.velo.get(id);
      return v ? fiche(v, R.derniereMesure.get(id)) : null;
    },

    historique: function (id, depuisMs) {
      return {
        mesures: R.historique.all(id, depuisMs).map(ligneEnMesure),
        regonflages: R.regonflagesVelo.all(id, depuisMs).map(function (g) {
          return { veloId: g.velo_id, t: g.t, roue: g.roue, avant: g.avant, apres: g.apres };
        })
      };
    },

    alertes: function (limite) {
      return R.alertes.all(limite).map(function (a) {
        return { veloId: a.velo_id, t: a.t, roue: a.roue, type: a.type, pression: a.pression, source: a.source };
      });
    },

    noterRefus: function (t, ip, velo, motif, detail) {
      R.noterRefus.run(t, ip, velo, motif, detail);
    },

    refus: function (limite) { return R.refus.all(limite); },

    // Agrégats SQL pour GET /api/statistiques
    agregats: function (maintenantMs) {
      var depuis7j = maintenantMs - 7 * 86400000;
      var moyenne = R.tempsMoyenRegonflage.get().moyenne;
      return {
        mesures: { total: R.nbMesures.get().n, dernieres24h: R.nbMesuresDepuis.get(maintenantMs - 86400000).n },
        alertesParType7j: R.alertesParType.all(depuis7j).map(function (l) { return { type: l.type, n: l.n }; }),
        regonflages: {
          total: R.nbRegonflages.get().n,
          derniers7j: R.nbRegonflagesDepuis.get(depuis7j).n,
          tempsMoyenEntreJ: moyenne === null ? null : moyenne / 86400000
        },
        km7j: R.kmDepuis.get(depuis7j).km,
        securite: {
          refusParMotif: R.refusParMotif.all().map(function (l) { return { motif: l.motif, n: l.n }; }),
          refus24h: R.nbRefusDepuis.get(maintenantMs - 86400000).n
        }
      };
    },

    fermer: function () { db.close(); }
  };
}

module.exports = { ouvrirBase: ouvrirBase };
