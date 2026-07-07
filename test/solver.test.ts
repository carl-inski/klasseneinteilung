// End-to-End-Test: Excel -> Spaltenerkennung -> Anonymisierung -> Solver.
// Prüft besonders die HARTEN Regeln (genau K Klassen, Größe, Chor-Cluster).
// Aufruf: npm test [pfad/zur/datei.xlsx]

import * as fs from "fs";
import { parseWorkbook } from "../lib/parse";
import { anonymize } from "../lib/anonymize";
import { buildConfig } from "../lib/config";
import { solveBest, classStats } from "../lib/solver";
import { findDecisionCases } from "../lib/decisions";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Bitte Pfad zu einer .xlsx übergeben.");
  process.exit(1);
}

const parsed = parseWorkbook(fs.readFileSync(file).buffer as ArrayBuffer);
console.log(`Blatt: ${parsed.sheetName}`);
console.log("Erkannte Spalten:");
for (const c of parsed.columns) if (c.role !== "ignore") console.log(`  ${c.header} -> ${c.role}${c.targetValue ? ` (${c.targetValue})` : ""}`);

const { students } = anonymize(parsed.table, parsed.columns);
console.log(`\n${students.length} Schüler anonymisiert.`);
console.log(`Wünsche aufgelöst: ${students.reduce((a, s) => a + s.wishes.length, 0)}, offen: ${students.reduce((a, s) => a + s.offeneWuensche.length, 0)}`);
console.log(`Entscheidungsfälle: ${findDecisionCases(students, parsed.columns).length}`);

const numClasses = 5;
const config = buildConfig(parsed.columns, students, numClasses);
console.log(`\nKriterien: ${config.criteria.map((c) => `${c.kind}(${c.weight})`).join(", ")}`);
console.log(`Cluster: ${config.clusters.map((c) => `${c.label}=${c.value}`).join(", ") || "keine"}`);

const t0 = Date.now();
const assignment = solveBest(students, config, 5, 1);
console.log(`\nSolver: ${Date.now() - t0} ms, Score ${assignment.score.toFixed(1)}, harte Verletzungen: ${assignment.hardViolations.length}`);
if (assignment.hardViolations.length) console.log(assignment.hardViolations.slice(0, 5));

const stats = classStats(students, config, assignment);
let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
  if (!ok) fail++;
};

console.log("\n--- Klassen ---");
stats.forEach((st, k) => {
  const cats = [...st.categories].map(([h, c]) => `${h}[${c.map(([v, n]) => `${v}:${n}`).join(",")}]`).join(" ");
  const conc = [...st.concentrates].map(([h, n]) => `${h}=${n}`).join(" ");
  const sp = [...st.spreads].map(([h, a]) => `Ø${h}=${a}`).join(" ");
  console.log(`  Klasse ${k + 1}${st.isCluster ? " [CLUSTER]" : ""}: ${st.size} SuS ${cats} ${conc} ${sp} offen:${st.unfulfilledWishes.length}`);
});

console.log("\n--- Harte-Regeln-Checks ---");
const sizes = stats.map((s) => s.size);
check(stats.length === numClasses, `Genau ${numClasses} Klassen`);
check(Math.max(...sizes) - Math.min(...sizes) <= 1, `Klassengrößen ± 1 (${sizes.join(", ")})`);
check(assignment.hardViolations.length === 0, "Keine harten Verletzungen");

// Chor-Cluster: alle Chorkinder in Cluster-Klassen
const choirCol = parsed.columns.find((c) => c.role === "cluster");
if (choirCol) {
  const clusterClasses = new Set(stats.map((s, k) => (s.isCluster ? k : -1)).filter((k) => k >= 0));
  const choirStudents = students.filter((s) => (s.attrs[choirCol.header] ?? "").toString().toLowerCase() === (choirCol.targetValue ?? "ja").toLowerCase());
  const allIn = choirStudents.every((s) => clusterClasses.has(assignment.classOf[s.code]));
  check(allIn, `Alle ${choirStudents.length} Chorkinder in Cluster-Klasse(n)`);
}

console.log("\n--- Weiche Kriterien ---");
check(stats.every((s) => s.avoidViolations.length === 0), "Keine 'nicht mit'-Verletzungen");
const totalUnfulfilled = stats.reduce((a, s) => a + s.unfulfilledWishes.length, 0);
const totalWishers = students.filter((s) => s.wishes.length).length;
check(totalUnfulfilled <= totalWishers * 0.15, `Wünsche erfüllt (Nicht-Cluster): ${totalWishers - totalUnfulfilled}/${totalWishers}`);
const mixCol = parsed.columns.find((c) => c.role === "mix");
if (mixCol)
  check(
    stats.every((s) => s.isCluster || (s.mixes.get(mixCol.header) ?? []).every(([, c]) => c <= 8)),
    "Kein Herkunfts-Block > 8 (außer in Cluster-Klassen, wo Cluster Vorrang hat)"
  );

process.exit(fail ? 1 : 0);
