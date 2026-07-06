// Liest die hochgeladene Excel-Datei (SheetJS) und mappt die Spalten des
// Blatts "Klasseneinteilung" (bzw. des ersten Blatts mit passenden Headern)
// auf RawRow. Läuft ausschließlich im Browser — die Datei verlässt ihn nie.

import * as XLSX from "xlsx";
import type { RawRow } from "./anonymize";

const HEADER_ALIASES: Record<keyof RawRow, string[]> = {
  nachname: ["nachname", "name"],
  rufname: ["rufname"],
  vornamen: ["vornamen", "vorname"],
  email: ["email", "e-mail", "mail"],
  deutsch: ["deutsch", "d"],
  mathe: ["mathe", "mathematik", "m"],
  hsu: ["hsu", "sachunterricht"],
  schnitt: ["durschnitt", "durchschnitt", "schnitt", "notenschnitt"],
  geschlecht: ["geschlecht", "m/w"],
  fremdsprache: ["2. fremdsprache", "2.fremdsprache", "fremdsprache", "2. fs", "2.fs"],
  grundschule: ["grundschule", "herkunftsschule", "schule"],
  chor: ["chorklasse", "chor"],
  wunsch1: ["wunschpartner"],
  wunsch2: ["weitere wunschpartner", "weitere wunschpartner/in", "wunschpartner 2"],
  nichtMit: ["nicht mit", "nichtmit", "sonderwunsch"],
  bemerkung: ["bemerkung", "bemerkungen", "kommentar"],
};

function findColumns(header: unknown[]): Partial<Record<keyof RawRow, number>> {
  const map: Partial<Record<keyof RawRow, number>> = {};
  header.forEach((cell, i) => {
    if (typeof cell !== "string") return;
    const h = cell.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof RawRow, string[]][]) {
      if (map[field] === undefined && aliases.includes(h)) map[field] = i;
    }
  });
  return map;
}

export interface ParseResult {
  rows: RawRow[];
  sheetName: string;
  warnings: string[];
}

export function parseWorkbook(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: "array" });
  const warnings: string[] = [];

  // Blatt mit den meisten erkannten Spalten wählen (bevorzugt "Klasseneinteilung")
  let bestSheet = "";
  let bestCols: Partial<Record<keyof RawRow, number>> = {};
  let bestGrid: unknown[][] = [];
  for (const name of wb.SheetNames) {
    const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      defval: null,
    });
    if (!grid.length) continue;
    const cols = findColumns(grid[0]);
    const score =
      Object.keys(cols).length + (name.toLowerCase().includes("klasseneinteilung") ? 3 : 0);
    if (score > Object.keys(bestCols).length + (bestSheet.toLowerCase().includes("klasseneinteilung") ? 3 : 0) || !bestSheet) {
      bestSheet = name;
      bestCols = cols;
      bestGrid = grid;
    }
  }

  if (bestCols.nachname === undefined || bestCols.rufname === undefined) {
    throw new Error(
      "Keine passende Tabelle gefunden. Erwartet wird ein Blatt mit Spalten wie „Nachname“, „Rufname“, „Geschlecht“, „Wunschpartner“ …"
    );
  }
  for (const field of ["geschlecht", "wunsch1", "grundschule"] as const) {
    if (bestCols[field] === undefined) warnings.push(`Spalte „${HEADER_ALIASES[field][0]}“ nicht gefunden.`);
  }

  const cell = (row: unknown[], f: keyof RawRow): unknown =>
    bestCols[f] !== undefined ? row[bestCols[f]!] : null;
  const str = (row: unknown[], f: keyof RawRow): string => {
    const v = cell(row, f);
    return v == null ? "" : String(v).trim();
  };
  const num = (row: unknown[], f: keyof RawRow): number | null => {
    const v = cell(row, f);
    return typeof v === "number" ? v : null;
  };

  const rows: RawRow[] = [];
  for (const row of bestGrid.slice(1)) {
    if (!str(row, "nachname") && !str(row, "rufname")) continue;
    rows.push({
      nachname: str(row, "nachname"),
      rufname: str(row, "rufname"),
      vornamen: str(row, "vornamen"),
      email: str(row, "email"),
      deutsch: num(row, "deutsch"),
      mathe: num(row, "mathe"),
      hsu: num(row, "hsu"),
      schnitt: num(row, "schnitt"),
      geschlecht: str(row, "geschlecht") || null,
      fremdsprache: str(row, "fremdsprache") || null,
      grundschule: str(row, "grundschule") || null,
      chor: str(row, "chor") || null,
      wunsch1: str(row, "wunsch1") || null,
      wunsch2: str(row, "wunsch2") || null,
      nichtMit: str(row, "nichtMit") || null,
      bemerkung: str(row, "bemerkung") || null,
    });
  }
  return { rows, sheetName: bestSheet, warnings };
}
