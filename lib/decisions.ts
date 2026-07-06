// Ermittelt "Entscheidungsfälle": Zeilen, die Programmlogik allein nicht
// sauber lösen kann (Bemerkungen, unauflösbare Wunsch-/Sperrnennungen,
// fehlende Daten). Diese werden dem Nutzer angezeigt und können optional —
// weiterhin anonymisiert — an die KI zur Empfehlung geschickt werden.

import type { DecisionCase, Student } from "./types";

export function findDecisionCases(students: Student[]): DecisionCase[] {
  const cases: DecisionCase[] = [];
  for (const s of students) {
    if (s.bemerkung)
      cases.push({ code: s.code, kind: "bemerkung", text: s.bemerkung });
    for (const w of s.offeneWuensche)
      cases.push({
        code: s.code,
        kind: "offenerWunsch",
        text: `Wunschpartner „${w}“ konnte keinem Schüler zugeordnet werden.`,
      });
    for (const n of s.offeneNichtMit)
      cases.push({
        code: s.code,
        kind: "offenesNichtMit",
        text: `„Nicht mit“-Nennung „${n}“ konnte keinem Schüler zugeordnet werden.`,
      });
    if (s.geschlecht == null || s.schnitt == null)
      cases.push({
        code: s.code,
        kind: "fehlendeDaten",
        text: `Fehlende Daten (${[
          s.geschlecht == null ? "Geschlecht" : null,
          s.schnitt == null ? "Noten" : null,
        ]
          .filter(Boolean)
          .join(", ")}).`,
      });
  }
  return cases;
}
