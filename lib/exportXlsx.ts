// Export der fertigen Einteilung als Excel. De-Anonymisierung (Code -> Name)
// passiert hier, ausschließlich im Browser, mit dem lokalen IdentityMap.

import * as XLSX from "xlsx";
import type { Assignment, Config, IdentityMap, Student } from "./types";
import { classLabel } from "./types";
import { classStats } from "./solver";

export function buildWorkbook(
  students: Student[],
  config: Config,
  assignment: Assignment,
  identityMap: IdentityMap
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const label = (k: number | undefined) =>
    k === undefined ? "?" : classLabel(config.classPrefix, k);
  const deanon = (text: string | null): string =>
    text
      ? text.replace(/S\d{3}/g, (code) => {
          const id = identityMap[code];
          return id ? id.full : code;
        })
      : "";

  const attrHeaders = config.columns
    .filter((c) => ["balance", "concentrate", "spread", "mix", "cluster"].includes(c.role))
    .map((c) => c.header);

  const rows = students.map((s) => {
    const id = identityMap[s.code] ?? { firstName: "?", lastName: "?", full: "?", email: "" };
    const row: Record<string, string | number> = {
      Klasse: label(assignment.classOf[s.code]),
      Nachname: id.lastName,
      Vorname: id.firstName,
    };
    if (id.email) row.Email = id.email;
    for (const h of attrHeaders) {
      const v = s.attrs[h];
      row[h] = v == null ? "" : v;
    }
    row.Wunschpartner = deanon(
      s.wishes.join(", ") + (s.offeneWuensche.length ? ` | offen: ${s.offeneWuensche.join(", ")}` : "")
    );
    row["nicht mit"] = deanon(
      s.avoid.join(", ") + (s.offeneAvoid.length ? ` | offen: ${s.offeneAvoid.join(", ")}` : "")
    );
    if (s.note) row.Bemerkung = deanon(s.note);
    return row;
  });
  rows.sort((a, b) => String(a.Klasse).localeCompare(String(b.Klasse)) || String(a.Nachname).localeCompare(String(b.Nachname)));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Klasseneinteilung");

  for (let k = 0; k < config.numClasses; k++) {
    const classRows = rows.filter((r) => r.Klasse === label(k));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(classRows), `Klasse ${label(k)}`);
  }

  const stats = classStats(students, config, assignment);
  const statRows = stats.map((st, k) => {
    const row: Record<string, string | number> = { Klasse: label(k), Schüler: st.size };
    if (st.isCluster) row.Cluster = "ja";
    for (const [h, cats] of st.categories) row[h] = cats.map(([v, c]) => `${v}: ${c}`).join(", ");
    for (const [h, cnt] of st.concentrates) row[`${h} (Zielwert)`] = cnt;
    for (const [h, avg] of st.spreads) row[`Ø ${h}`] = avg ?? "";
    for (const [h, m] of st.mixes) row[h] = m.map(([v, c]) => `${v}: ${c}`).join(", ");
    row["Unerfüllte Wünsche"] = st.unfulfilledWishes.length;
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statRows), "Statistik");
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}
