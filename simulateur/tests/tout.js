// =====================================================================
// tout.js — Lance toutes les suites de tests, l'une après l'autre
// ---------------------------------------------------------------------
// Lancer : node simulateur/tests/tout.js
// =====================================================================
var execFileSync = require("child_process").execFileSync;
var path = require("path");

var suites = ["tests.js", "pneu.tests.js", "velo.tests.js", "radio.tests.js", "electronique.tests.js", "moteur.tests.js",
  "../../serveur/serveur.tests.js",    // serveur et flotte (mode entreprise)
  "../../entrepot/entrepot.tests.js"]; // version industrielle : MQTT, passerelles, entrepôt
var echecs = 0;
suites.forEach(function (suite) {
  var sortie;
  try {
    // --no-warnings : masque l’avertissement « SQLite expérimental » de Node 24.
    sortie = execFileSync(process.execPath, ["--no-warnings", path.join(__dirname, suite)], { encoding: "utf8" });
  } catch (e) {
    sortie = e.stdout || "";
    echecs++;
  }
  var lignes = sortie.trim().split("\n");
  console.log(path.basename(suite).padEnd(24) + lignes[lignes.length - 1]);
});
console.log(echecs === 0 ? "\nToutes les suites passent." : "\n" + echecs + " suite(s) en échec.");
if (echecs > 0) process.exitCode = 1;
