// Anonymisierung: aus der Roh-Tabelle werden Studenten mit Codes (S001 …).
// Namen/E-Mails werden durch Codes ersetzt — auch in Freitextfeldern
// (Wunschpartner, „nicht mit“, Bemerkung). Namensnennungen werden über eine
// tolerante Fuzzy-Suche (Tippfehler) gegen die echte Namensliste aufgelöst.
// Optional übersteuern KI-Korrekturen (raw -> code) die lokale Auflösung.
// Das IdentityMap (Code -> Klartext) bleibt im Browser.

import type { Column, IdentityMap, Student } from "./types";
import type { Table } from "./parse";

export interface AnonymizeResult {
  students: Student[];
  identityMap: IdentityMap;
  /** Distinkte Freitext-Nennungen, die (noch) nicht sicher aufgelöst wurden. */
  unresolved: string[];
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");

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
  full: Map<string, string[]>;
  first: Map<string, string[]>;
  last: Map<string, string[]>;
}

function buildIndex(entries: { code: string; firstName: string; lastName: string }[]): NameIndex {
  const full = new Map<string, string[]>();
  const first = new Map<string, string[]>();
  const last = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, code: string) => {
    if (!k) return;
    (m.get(k) ?? m.set(k, []).get(k)!).push(code);
  };
  for (const e of entries) {
    add(full, norm(e.firstName + e.lastName), e.code);
    add(full, norm(e.lastName + e.firstName), e.code);
    add(first, norm(e.firstName), e.code);
    add(last, norm(e.lastName), e.code);
  }
  return { full, first, last };
}

/** Löst eine Namensnennung tolerant zu einem Code auf (oder null). */
function resolveName(raw: string, idx: NameIndex, selfCode: string): string | null {
  const n = norm(raw);
  if (n.length < 3) return null;
  const exact = idx.full.get(n);
  if (exact?.length === 1 && exact[0] !== selfCode) return exact[0];
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2) {
    const combo = idx.full.get(norm(parts[0] + parts[parts.length - 1]));
    if (combo?.length === 1 && combo[0] !== selfCode) return combo[0];
  }
  const byFirst = idx.first.get(n);
  if (byFirst?.length === 1 && byFirst[0] !== selfCode) return byFirst[0];
  const byLast = idx.last.get(n);
  if (byLast?.length === 1 && byLast[0] !== selfCode) return byLast[0];
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
    } else if (d === bestDist) bestCount++;
  }
  const tol = n.length >= 10 ? 2 : 1;
  if (best && best !== selfCode && bestDist <= tol && bestCount === 1) return best;
  if (parts.length === 1) {
    for (const m of [idx.first, idx.last]) {
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
      if (b && b !== selfCode && bd <= 1 && bc === 1) return b;
    }
  }
  return null;
}

function splitMentions(text: string): string[] {
  return text
    .split(/[,;/]|\bund\b|\boder\b|\+/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function scrubText(text: string, entries: { code: string; firstName: string; lastName: string }[]): string {
  let out = text;
  const variants: [string, string][] = [];
  for (const e of entries) {
    const f = e.firstName.trim();
    const l = e.lastName.trim();
    if (f && l) variants.push([`${f} ${l}`, e.code], [`${l} ${f}`, e.code], [`${l}, ${f}`, e.code]);
  }
  for (const e of entries) if (e.lastName.trim().length > 3) variants.push([e.lastName.trim(), e.code]);
  for (const e of entries) if (e.firstName.trim().length > 3) variants.push([e.firstName.trim(), e.code]);
  variants.sort((a, b) => b[0].length - a[0].length);
  for (const [name, code] of variants) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "gi"), code);
  }
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");
  out = out.replace(/\b(S\d{3})[a-zäöüß]+/g, "$1");
  return out;
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export function anonymize(
  table: Table,
  columns: Column[],
  corrections: Record<string, string> = {}
): AnonymizeResult {
  const colIndex = (role: string) => columns.findIndex((c) => c.role === role);
  const iFirst = colIndex("firstName");
  const iLast = colIndex("lastName");
  const iFull = colIndex("fullName");
  const iEmail = colIndex("email");
  const attrCols = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => ["balance", "concentrate", "spread", "mix", "cluster"].includes(c.role));
  const wishCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.role === "wish");
  const avoidCols = columns.map((c, i) => ({ c, i })).filter(({ c }) => c.role === "avoid");
  const iNote = colIndex("note");

  const cell = (row: (string | number | null)[], i: number): string =>
    i >= 0 && row[i] != null ? String(row[i]).trim() : "";

  // Identitäten + Codes
  const entries = table.rows.map((row, i) => {
    let firstName = cell(row, iFirst);
    let lastName = cell(row, iLast);
    const full = cell(row, iFull);
    if (full && (!firstName || !lastName)) {
      const s = splitFullName(full);
      firstName = firstName || s.firstName;
      lastName = lastName || s.lastName;
    }
    return {
      code: `S${String(i + 1).padStart(3, "0")}`,
      firstName,
      lastName,
      email: cell(row, iEmail),
    };
  });
  const identityMap: IdentityMap = Object.fromEntries(
    entries.map((e) => [
      e.code,
      { firstName: e.firstName, lastName: e.lastName, full: `${e.firstName} ${e.lastName}`.trim(), email: e.email },
    ])
  );
  const idx = buildIndex(entries);
  const unresolvedSet = new Set<string>();

  const resolve = (raw: string, selfCode: string): { code: string | null } => {
    const key = norm(raw);
    if (corrections[key] !== undefined) return { code: corrections[key] || null };
    const code = resolveName(raw, idx, selfCode);
    if (!code) unresolvedSet.add(raw.trim());
    return { code };
  };

  const students: Student[] = table.rows.map((row, i) => {
    const code = entries[i].code;
    const wishesRaw: string[] = [];
    const wishes: string[] = [];
    const offeneWuensche: string[] = [];
    for (const { i: ci } of wishCols) {
      const val = cell(row, ci);
      if (!val) continue;
      for (const m of splitMentions(val)) {
        wishesRaw.push(m);
        const { code: r } = resolve(m, code);
        if (r && r !== code && !wishes.includes(r)) wishes.push(r);
        else if (!r) offeneWuensche.push(scrubText(m, entries));
      }
    }
    const avoidRaw: string[] = [];
    const avoid: string[] = [];
    const offeneAvoid: string[] = [];
    for (const { i: ci } of avoidCols) {
      const val = cell(row, ci);
      if (!val) continue;
      for (const m of splitMentions(val)) {
        avoidRaw.push(m);
        const { code: r } = resolve(m, code);
        if (r && r !== code && !avoid.includes(r)) avoid.push(r);
        else if (!r) offeneAvoid.push(scrubText(m, entries));
      }
    }
    const attrs: Record<string, string | number | null> = {};
    for (const { c, i: ci } of attrCols) {
      const raw = row[ci];
      if (c.role === "spread") {
        attrs[c.header] = typeof raw === "number" ? raw : raw != null && !isNaN(Number(raw)) ? Number(raw) : null;
      } else {
        attrs[c.header] = raw != null ? String(raw).trim() : null;
      }
    }
    const note = iNote >= 0 && cell(row, iNote) ? scrubText(cell(row, iNote), entries) : null;
    return { code, wishesRaw, avoidRaw, wishes, avoid, offeneWuensche, offeneAvoid, attrs, note };
  });

  return { students, identityMap, unresolved: [...unresolvedSet] };
}
