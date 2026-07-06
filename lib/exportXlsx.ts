// Export der fertigen Klasseneinteilung als Excel-Datei.
// Die De-Anonymisierung (Code -> Name) passiert hier, ausschließlich im
// Browser, mit dem lokal gehaltenen IdentityMap.

import * as XLSX from "xlsx";
import type { Assignment, IdentityMap, Student } from "./types";
import { classStats } from "./solver";

export const CLASS_LABELS = ["5a", "5b", "5c", "5d", "5e", "5f", "5g", "5h"];

export function buildWorkbook(
  students: Student[],
  assignment: Assignment,
  identityMap: IdentityMap,
  numClasses: number
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const label = (k: number | undefined) => (k === undefined ? "?" : CLASS_LABELS[k] ?? `K${k + 1}`);
  const deanon = (text: string | null): string =>
    text
      ? text.replace(/S\d{3}/g, (code) => {
          const id = identityMap[code];
          return id ? `${id.rufname} ${id.nachname}` : code;
        })
      : "";

  // Gesamtliste
  const rows = students.map((s) => {
    const id = identityMap[s.code] ?? { nachname: "?", rufname: "?", vornamen: "", email: "" };
    return {
      Klasse: label(assignment.classOf[s.code]),
      Nachname: id.nachname,
      Rufname: id.rufname,
      Vornamen: id.vornamen,
      Email: id.email,
      Geschlecht: s.geschlecht ?? "",
      Durchschnitt: s.schnitt ?? "",
      "2. Fremdsprache": s.fremdsprache ?? "",
      Grundschule: s.grundschule ?? "",
      Chorklasse: s.chor ? "ja" : "nein",
      Wunschpartner: deanon(s.wuensche.join(", ") + (s.offeneWuensche.length ? ` | offen: ${s.offeneWuensche.join(", ")}` : "")),
      "nicht mit": deanon(s.nichtMit.join(", ") + (s.offeneNichtMit.length ? ` | offen: ${s.offeneNichtMit.join(", ")}` : "")),
      Bemerkung: deanon(s.bemerkung),
    };
  });
  rows.sort((a, b) => a.Klasse.localeCompare(b.Klasse) || a.Nachname.localeCompare(b.Nachname));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Klasseneinteilung");

  // Ein Blatt pro Klasse
  for (let k = 0; k < numClasses; k++) {
    const classRows = rows.filter((r) => r.Klasse === label(k));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(classRows), `Klasse ${label(k)}`);
  }

  // Statistik
  const stats = classStats(students, assignment, numClasses);
  const statRows = stats.map((st, k) => ({
    Klasse: label(k),
    Schüler: st.size,
    Jungen: st.m,
    Mädchen: st.w,
    Latein: st.latein,
    Französisch: st.franz,
    Chor: st.chor,
    "Ø Übertritt": st.avg ?? "",
    Grundschulen: st.schools.map(([n, c]) => `${n}: ${c}`).join(", "),
    "Unerfüllte Wünsche": st.unfulfilledWishes.map((c) => deanon(c)).join(", "),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statRows), "Statistik");
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}
