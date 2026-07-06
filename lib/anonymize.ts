// Anonymisierung: Aus geparsten Roh-Zeilen werden Studenten mit Codes (S001…).
// Namen in Freitextfeldern (Wunschpartner, "nicht mit", Bemerkung) werden
// gegen die Schülerliste aufgelöst und durch Codes ersetzt. Das IdentityMap
// (Code -> Klartext) bleibt im Browser; alles Weitere arbeitet nur mit Codes.

import type { Identity, IdentityMap, Student } from "./types";

export interface RawRow {
  nachname: string;
  rufname: string;
  vornamen: string;
  email: string;
  deutsch: number | null;
  mathe: number | null;
  hsu: number | null;
  schnitt: number | null;
  geschlecht: string | null;
  fremdsprache: string | null;
  grundschule: string | null;
  chor: string | null;
  wunsch1: string | null;
  wunsch2: string | null;
  nichtMit: string | null;
  bemerkung: string | null;
}

export interface AnonymizeResult {
  students: Student[];
  identityMap: IdentityMap;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");

/** Levenshtein-Distanz für tolerante Namensauflösung (Tippfehler). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

interface NameIndex {
  full: Map<string, string[]>; // norm("rufname nachname") -> codes
  ruf: Map<string, string[]>;
  nach: Map<string, string[]>;
}

function buildIndex(identities: [string, Identity][]): NameIndex {
  const full = new Map<string, string[]>();
  const ruf = new Map<string, string[]>();
  const nach = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, code: string) => {
    if (!k) return;
    const arr = m.get(k) ?? [];
    arr.push(code);
    m.set(k, arr);
  };
  for (const [code, id] of identities) {
    add(full, norm(id.rufname + id.nachname), code);
    add(full, norm(id.nachname + id.rufname), code);
    add(ruf, norm(id.rufname), code);
    add(nach, norm(id.nachname), code);
  }
  return { full, ruf, nach };
}

/**
 * Löst eine Namensnennung (z. B. "Leni Bomhard", "Rappl", "Noah Kalman")
 * zu einem Schülercode auf. Reihenfolge: exakter voller Name -> eindeutiger
 * Ruf-/Nachname -> fuzzy (1–2 Tippfehler). Gibt null zurück, wenn nichts
 * Eindeutiges gefunden wird.
 */
function resolveName(raw: string, idx: NameIndex): string | null {
  const n = norm(raw);
  if (n.length < 3) return null;
  const exact = idx.full.get(n);
  if (exact?.length === 1) return exact[0];
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2) {
    // Erster + letzter Token (überspringt Mittelteile)
    const combo = norm(parts[0] + parts[parts.length - 1]);
    const c = idx.full.get(combo);
    if (c?.length === 1) return c[0];
  }
  const byRuf = idx.ruf.get(n);
  if (byRuf?.length === 1) return byRuf[0];
  const byNach = idx.nach.get(n);
  if (byNach?.length === 1) return byNach[0];
  // Fuzzy über volle Namen
  let best: string | null = null;
  let bestDist = Infinity;
  let bestCount = 0;
  for (const [key, codes] of idx.full) {
    const d = editDistance(n, key);
    if (d < bestDist) {
      bestDist = d;
      best = codes.length === 1 ? codes[0] : null;
      bestCount = 1;
    } else if (d === bestDist) {
      bestCount++;
    }
  }
  const tol = n.length >= 10 ? 2 : 1;
  if (best && bestDist <= tol && bestCount === 1) return best;
  // Fuzzy über Einzelteile (nur wenn Nennung ein einzelnes Wort ist)
  if (parts.length === 1) {
    for (const m of [idx.ruf, idx.nach]) {
      let b: string | null = null;
      let bd = Infinity;
      let bc = 0;
      for (const [key, codes] of m) {
        const d = editDistance(n, key);
        if (d < bd) {
          bd = d;
          b = codes.length === 1 ? codes[0] : null;
          bc = 1;
        } else if (d === bd) bc++;
      }
      if (b && bd <= 1 && bc === 1) return b;
    }
  }
  return null;
}

/** Zerlegt Freitext wie "Anna Muster, Ben Beispiel" in einzelne Nennungen. */
function splitMentions(text: string): string[] {
  return text
    .split(/[,;/]|\bund\b|\boder\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/** Ersetzt alle bekannten Namen in einem Freitext durch Codes. */
function scrubText(text: string, identities: [string, Identity][]): string {
  let out = text;
  const variants: [string, string][] = [];
  for (const [code, id] of identities) {
    const rn = id.rufname.trim();
    const nn = id.nachname.trim();
    if (rn && nn) {
      variants.push([`${rn} ${nn}`, code], [`${nn} ${rn}`, code], [`${nn}, ${rn}`, code]);
    }
  }
  for (const [code, id] of identities) {
    if (id.nachname.trim().length > 3) variants.push([id.nachname.trim(), code]);
  }
  for (const [code, id] of identities) {
    if (id.rufname.trim().length > 3) variants.push([id.rufname.trim(), code]);
  }
  variants.sort((a, b) => b[0].length - a[0].length);
  for (const [name, code] of variants) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), code);
  }
  // E-Mails & Code-Reste ("S047n" nach Teiltreffer) bereinigen
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");
  out = out.replace(/\b(S\d{3})[a-zäöüß]+/g, "$1");
  return out;
}

const toGrade = (v: unknown): number | null =>
  typeof v === "number" && v >= 1 && v <= 6 ? v : null;

export function anonymize(rows: RawRow[]): AnonymizeResult {
  const identities: [string, Identity][] = rows.map((r, i) => [
    `S${String(i + 1).padStart(3, "0")}`,
    { nachname: r.nachname, rufname: r.rufname, vornamen: r.vornamen, email: r.email },
  ]);
  const identityMap: IdentityMap = Object.fromEntries(identities);
  const idx = buildIndex(identities);

  const students: Student[] = rows.map((r, i) => {
    const code = identities[i][0];
    const wuensche: string[] = [];
    const offeneWuensche: string[] = [];
    for (const feld of [r.wunsch1, r.wunsch2]) {
      if (!feld) continue;
      for (const mention of splitMentions(feld)) {
        const resolved = resolveName(mention, idx);
        if (resolved && resolved !== code && !wuensche.includes(resolved)) wuensche.push(resolved);
        else if (!resolved) offeneWuensche.push(scrubText(mention, identities));
      }
    }
    const nichtMit: string[] = [];
    const offeneNichtMit: string[] = [];
    if (r.nichtMit) {
      for (const mention of splitMentions(r.nichtMit)) {
        const resolved = resolveName(mention, idx);
        if (resolved && resolved !== code && !nichtMit.includes(resolved)) nichtMit.push(resolved);
        else if (!resolved) offeneNichtMit.push(scrubText(mention, identities));
      }
    }
    const g = (r.geschlecht ?? "").trim().toLowerCase();
    const fs = (r.fremdsprache ?? "").trim().toUpperCase();
    return {
      code,
      deutsch: toGrade(r.deutsch),
      mathe: toGrade(r.mathe),
      hsu: toGrade(r.hsu),
      schnitt: typeof r.schnitt === "number" ? Math.round(r.schnitt * 100) / 100 : null,
      geschlecht: g === "m" ? "m" : g === "w" ? "w" : null,
      fremdsprache: fs === "L" ? "L" : fs === "F" ? "F" : null,
      grundschule: r.grundschule?.trim() || null,
      chor: (r.chor ?? "").trim().toLowerCase() === "ja",
      wuensche,
      offeneWuensche,
      nichtMit,
      offeneNichtMit,
      bemerkung: r.bemerkung ? scrubText(r.bemerkung, identities) : null,
    };
  });

  return { students, identityMap };
}
