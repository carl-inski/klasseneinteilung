// Entscheidungsfälle: Zeilen, die Programmlogik allein nicht sauber löst
// (Bemerkungen, nicht zuordenbare Nennungen, fehlende Pflichtdaten).

import type { Column, DecisionCase, Student } from "./types";

export function findDecisionCases(students: Student[], columns: Column[]): DecisionCase[] {
  const cases: DecisionCase[] = [];
  const needsSpread = columns.some((c) => c.role === "spread");
  const needsBalance = columns.some((c) => c.role === "balance");
  const spreadHeaders = columns.filter((c) => c.role === "spread").map((c) => c.header);
  const balanceHeaders = columns.filter((c) => c.role === "balance").map((c) => c.header);

  for (const s of students) {
    if (s.note) cases.push({ code: s.code, kind: "note", text: s.note });
    for (const w of s.offeneWuensche)
      cases.push({
        code: s.code,
        kind: "openWish",
        text: `Wunschpartner „${w}“ konnte keinem Kind zugeordnet werden.`,
        mention: w,
        field: "wish",
      });
    for (const a of s.offeneAvoid)
      cases.push({
        code: s.code,
        kind: "openAvoid",
        text: `„Nicht mit“-Nennung „${a}“ konnte keinem Kind zugeordnet werden.`,
        mention: a,
        field: "avoid",
      });
    const missing: string[] = [];
    if (needsBalance && balanceHeaders.some((h) => s.attrs[h] == null || s.attrs[h] === "")) missing.push("Kategorie");
    if (needsSpread && spreadHeaders.some((h) => typeof s.attrs[h] !== "number")) missing.push("Noten/Zahl");
    if (missing.length) cases.push({ code: s.code, kind: "missing", text: `Fehlende Daten (${missing.join(", ")}).` });
  }
  return cases;
}
