// Liest die Excel-Datei (SheetJS) und erkennt Spalten + Rollen automatisch.
// Läuft ausschließlich im Browser — die Datei verlässt ihn nie.
// Die Rollen-Zuordnung ist ein Vorschlag; der Nutzer kann sie im UI anpassen.

import * as XLSX from "xlsx";
import type { Column, Role } from "./types";

export interface Table {
  headers: string[];
  rows: (string | number | null)[][];
}

export interface ParseResult {
  table: Table;
  columns: Column[];
  sheetName: string;
  warnings: string[];
}

// Schlüsselwörter (kleingeschrieben) -> Rolle. Erste Übereinstimmung gewinnt.
const ROLE_KEYWORDS: [Role, string[]][] = [
  // Vorname VOR Nachname prüfen (sonst matcht "rufname" auf das generische "name")
  ["firstName", ["rufname", "vorname", "vornamen", "first name", "given name"]],
  ["lastName", ["nachname", "familienname", "surname", "last name"]],
  ["fullName", ["name des kindes", "schüler", "schuelerin", "kind", "full name", "name"]],
  ["email", ["email", "e-mail", "mail"]],
  ["wish", ["wunschpartner", "wunsch", "freund", "partner", "möchte mit"]],
  ["avoid", ["nicht mit", "nichtmit", "sonderwunsch", "getrennt", "avoid"]],
  ["cluster", ["chorklasse", "chor", "profil", "zweig", "bläser", "sport", "musik"]],
  ["concentrate", ["2. fremdsprache", "2.fremdsprache", "fremdsprache", "2. fs", "2.fs", "sprache", "latein"]],
  ["spread", ["durchschnitt", "durschnitt", "schnitt", "notendurchschnitt", "note", "gpa"]],
  ["balance", ["geschlecht", "m/w", "gender", "sex"]],
  ["mix", ["grundschule", "herkunftsschule", "herkunft", "schule", "vorschule", "kita"]],
  ["note", ["bemerkung", "bemerkungen", "kommentar", "notiz", "anmerkung"]],
  ["ignore", ["anzahl", "nr", "nr.", "lfd", "#", "id"]],
];

const SUBJECT_GRADES = ["deutsch", "mathe", "mathematik", "hsu", "sachunterricht", "englisch"];

function detectRole(header: string, sampleValues: (string | number | null)[]): { role: Role; targetValue?: string } {
  const h = header.trim().toLowerCase();
  // Einzelfach-Noten ignorieren, wenn ein Durchschnitt existiert (wird separat behandelt)
  if (SUBJECT_GRADES.includes(h)) return { role: "ignore" };
  for (const [role, kws] of ROLE_KEYWORDS) {
    if (kws.some((kw) => h === kw || h.includes(kw))) {
      if (role === "cluster") return { role, targetValue: guessClusterValue(sampleValues) };
      if (role === "concentrate") return { role, targetValue: guessMinority(sampleValues) };
      return { role };
    }
  }
  // Heuristik für unbekannte Spalten
  const nonEmpty = sampleValues.filter((v) => v != null && String(v).trim() !== "");
  if (!nonEmpty.length) return { role: "ignore" };
  const numeric = nonEmpty.filter((v) => typeof v === "number" || !isNaN(Number(v)));
  if (numeric.length / nonEmpty.length > 0.8) return { role: "spread" };
  const distinct = new Set(nonEmpty.map((v) => String(v).trim().toLowerCase()));
  if (distinct.size <= 5 && nonEmpty.length > distinct.size) return { role: "balance" };
  return { role: "ignore" };
}

function guessClusterValue(values: (string | number | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim().toLowerCase();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  // Bevorzugt "ja"; sonst der seltenere (= der besondere) Wert
  if (counts.has("ja")) return "ja";
  const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
  return sorted[0]?.[0] ?? "ja";
}

function guessMinority(values: (string | number | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
  return sorted[0]?.[0] ?? "";
}

export function parseWorkbook(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: "array" });
  const warnings: string[] = [];

  // Blatt mit den meisten sinnvoll erkennbaren Spalten wählen
  let best: { name: string; grid: (string | number | null)[][] } | null = null;
  let bestScore = -1;
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[name], {
      header: 1,
      defval: null,
      blankrows: false,
    });
    if (!grid.length) continue;
    const headerRow = (grid[0] ?? []).filter((c) => typeof c === "string" && c.trim());
    const score =
      headerRow.length + (name.toLowerCase().includes("klasseneinteilung") ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { name, grid };
    }
  }
  if (!best) throw new Error("Die Datei enthält keine lesbare Tabelle.");

  const headers = (best.grid[0] ?? []).map((c) => (c == null ? "" : String(c).trim()));
  const dataRows = best.grid.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== ""));

  // Spalten mit Rollen erkennen
  const columns: Column[] = headers.map((header, i) => {
    if (!header) return { header: `Spalte ${i + 1}`, role: "ignore" as Role };
    const sample = dataRows.slice(0, 60).map((r) => r[i] ?? null);
    const { role, targetValue } = detectRole(header, sample);
    return { header, role, targetValue };
  });

  const hasName = columns.some((c) => c.role === "lastName" || c.role === "fullName");
  const hasFirst = columns.some((c) => c.role === "firstName");
  if (!hasName) {
    // Fallback: erste Textspalte als Name
    const firstText = columns.findIndex(
      (c, i) => c.role === "ignore" && dataRows.some((r) => typeof r[i] === "string")
    );
    if (firstText >= 0) {
      columns[firstText].role = "fullName";
      warnings.push(`Keine eindeutige Namensspalte erkannt — „${columns[firstText].header}“ wird als Name verwendet.`);
    } else {
      throw new Error("Keine Namensspalte gefunden.");
    }
  }
  if (!hasFirst && !columns.some((c) => c.role === "fullName")) {
    warnings.push("Keine getrennte Vorname-Spalte erkannt.");
  }

  return {
    table: { headers, rows: dataRows },
    columns,
    sheetName: best.name,
    warnings,
  };
}
