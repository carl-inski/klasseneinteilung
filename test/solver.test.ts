// End-to-End-Test: Excel -> Anonymisierung -> Solver -> Kriterien-Check.
// Aufruf: npm test [pfad/zur/datei.xlsx]
// Ohne Argument wird ein synthetischer Datensatz generiert.

import * as fs from "fs";
import { parseWorkbook } from "../lib/parse";
import { anonymize, RawRow } from "../lib/anonymize";
import { solveBest, classStats } from "../lib/solver";
import { findDecisionCases } from "../lib/decisions";
import { DEFAULT_CRITERIA } from "../lib/types";

function syntheticRows(n = 120): RawRow[] {
  const first = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Henri", "Ida", "Jonas", "Klara", "Leo", "Mia", "Noah", "Olivia", "Paul", "Quirin", "Rosa", "Samuel", "Tessa"];
  const last = ["Bauer", "Fischer", "Gruber", "Hoffmann", "Keller", "Lehmann", "Maier", "Neumann", "Ott", "Peters", "Quandt", "Richter", "Schmid", "Traut", "Ulrich", "Vogel", "Wagner", "Zimmer"];
  const schools = ["Nordschule", "Nordschule", "Nordschule", "Südschule", "Südschule", "Weststr.", "Ostpark", "Kleinfeld"];
  const rows: RawRow[] = [];
  for (let i = 0; i < n; i++) {
    const rn = first[i % first.length];
    const nn = last[(i * 7) % last.length] + (i > 90 ? "er" : "");
    rows.push({
      nachname: nn, rufname: rn, vornamen: rn, email: `p${i}@example.org`,
      deutsch: 1 + (i % 3), mathe: 1 + ((i * 2) % 3), hsu: 1 + ((i * 5) % 3),
      schnitt: 1 + ((i % 3) + ((i * 2) % 3) + ((i * 5) % 3)) / 3,
      geschlecht: i % 2 === 0 ? "m" : "w",
      fremdsprache: i % 4 === 0 ? "L" : "F",
      grundschule: schools[(i * 3) % schools.length],
      chor: i % 8 === 0 ? "ja" : "nein",
      wunsch1: i > 0 && i % 3 !== 0 ? `${first[(i - 1) % first.length]} ${last[((i - 1) * 7) % last.length]}${i - 1 > 90 ? "er" : ""}` : null,
      wunsch2: null,
      nichtMit: i === 50 ? `${first[51 % first.length]}` : null,
      bemerkung: i === 10 ? "mit Zwillingsschwester in eine Klasse" : null,
    });
  }
  return rows;
}

const file = process.argv[2];
let rows: RawRow[];
if (file && fs.existsSync(file)) {
  const parsed = parseWorkbook(fs.readFileSync(file).buffer as ArrayBuffer);
  rows = parsed.rows;
  console.log(`Datei: ${file}, Blatt: ${parsed.sheetName}, Warnungen: ${parsed.warnings.join("; ") || "keine"}`);
} else {
  rows = syntheticRows();
  console.log("Synthetischer Datensatz (kein Dateipfad übergeben).");
}

const { students } = anonymize(rows);
console.log(`\n${students.length} Schüler anonymisiert.`);

const resolvedWishes = students.reduce((a, s) => a + s.wuensche.length, 0);
const openWishes = students.reduce((a, s) => a + s.offeneWuensche.length, 0);
console.log(`Wünsche aufgelöst: ${resolvedWishes}, offen: ${openWishes}`);
console.log(`"nicht mit"-Paare: ${students.reduce((a, s) => a + s.nichtMit.length, 0)}, offen: ${students.reduce((a, s) => a + s.offeneNichtMit.length, 0)}`);
console.log(`Entscheidungsfälle: ${findDecisionCases(students).length}`);

const numClasses = Math.max(2, Math.ceil(students.length / 28));
const params = {
  numClasses,
  maxSchoolBlock: 8,
  maxWishGroup: 4,
  bundleChoir: false,
  criteria: DEFAULT_CRITERIA,
  extraRules: [],
};

const t0 = Date.now();
const assignment = solveBest(students, params, 4, 1);
console.log(`\nSolver: ${Date.now() - t0} ms, Score ${assignment.score.toFixed(1)}`);
console.log("Strafen:", Object.fromEntries(Object.entries(assignment.penalties).map(([k, v]) => [k, Math.round(v * 10) / 10])));

const stats = classStats(students, assignment, numClasses);
let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
  if (!ok) fail++;
};

console.log("\n--- Klassen ---");
stats.forEach((st, k) => {
  console.log(
    `Klasse ${k + 1}: ${st.size} SuS, ${st.m}m/${st.w}w, L${st.latein}/F${st.franz}, Ø${st.avg}, ` +
    `GS max ${Math.max(...st.schools.map(([, c]) => c), 0)}, unerfüllte Wünsche ${st.unfulfilledWishes.length}`
  );
});

console.log("\n--- Kriterien-Checks ---");
check(stats.every((s) => s.notWithViolations.length === 0), "Keine 'nicht mit'-Verletzungen");
const sizes = stats.map((s) => s.size);
check(Math.max(...sizes) - Math.min(...sizes) <= 3, `Klassengrößen ausgeglichen (${sizes.join(", ")})`);
check(stats.every((s) => s.schools.every(([, c]) => c <= 8)), "Kein Grundschulblock > 8");
const totalUnfulfilled = stats.reduce((a, s) => a + s.unfulfilledWishes.length, 0);
const totalWishers = students.filter((s) => s.wuensche.length > 0).length;
check(totalUnfulfilled <= totalWishers * 0.1, `Wünsche erfüllt: ${totalWishers - totalUnfulfilled}/${totalWishers} (${totalUnfulfilled} unerfüllt)`);
const classesWithL = stats.filter((s) => s.latein > 0).length;
console.log(`ℹ️ Klassen mit Latein: ${classesWithL} von ${numClasses}`);
const mwDev = Math.max(...stats.map((s) => Math.abs(s.m / Math.max(1, s.m + s.w) - 0.5)));
console.log(`ℹ️ Max. Abweichung m-Anteil von Gesamtverhältnis: ${(mwDev * 100).toFixed(0)} %-Punkte um 50 %`);

process.exit(fail ? 1 : 0);
