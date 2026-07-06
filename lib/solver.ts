// Klasseneinteilungs-Solver.
// Arbeitet ausschließlich auf anonymisierten Codes.
//
// Vorgehen:
// 1. Wunschgruppen bilden (gegenseitige Wünsche zuerst, dann einseitige),
//    begrenzt auf maxWishGroup — verhindert Wunschketten strukturell.
// 2. Greedy-Startverteilung der Gruppen auf Klassen.
// 3. Lokale Suche (Verschieben/Tauschen von Gruppen) minimiert die
//    gewichtete Straffunktion über alle aktivierten Kriterien.

import type { Assignment, Criterion, CriterionId, SolverParams, Student } from "./types";

interface Unit {
  members: string[];
  fixedClass?: number;
}

interface Ctx {
  students: Map<string, Student>;
  units: Unit[];
  unitOf: Map<string, number>;
  notWithPairs: [string, string][];
  params: SolverParams;
  weights: Record<CriterionId, number>;
  targetSize: number;
  totalM: number;
  totalKnownGender: number;
  gradeAvg: number;
  gradeStd: number;
  smallSchools: Map<string, string[]>;
  minLatinClasses: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wunschgruppen per größenbeschränkter Union-Find bilden. */
function buildUnits(students: Student[], params: SolverParams): { units: Unit[]; unitOf: Map<string, number> } {
  const byCode = new Map(students.map((s) => [s.code, s]));
  const parent = new Map<string, string>();
  const size = new Map<string, number>();
  const fixed = new Map<string, number>(); // Wurzel -> Klassenindex
  const cap = params.criteria.find((c) => c.id === "chains")?.enabled
    ? params.maxWishGroup
    : Infinity;

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const s of students) {
    parent.set(s.code, s.code);
    size.set(s.code, 1);
  }

  const notWith = new Set<string>();
  for (const s of students) for (const o of s.nichtMit) notWith.add([s.code, o].sort().join("|"));
  for (const r of params.extraRules)
    if (r.type === "notWith" && r.codes.length === 2) notWith.add([...r.codes].sort().join("|"));

  const conflictFree = (ra: string, rb: string): boolean => {
    const membersA: string[] = [];
    const membersB: string[] = [];
    for (const s of students) {
      const r = find(s.code);
      if (r === ra) membersA.push(s.code);
      else if (r === rb) membersB.push(s.code);
    }
    for (const a of membersA)
      for (const b of membersB) if (notWith.has([a, b].sort().join("|"))) return false;
    return true;
  };

  const tryUnion = (a: string, b: string, maxSize: number): boolean => {
    if (!byCode.has(a) || !byCode.has(b)) return false;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return true;
    const newSize = size.get(ra)! + size.get(rb)!;
    if (newSize > maxSize) return false;
    const fa = fixed.get(ra);
    const fb = fixed.get(rb);
    if (fa !== undefined && fb !== undefined && fa !== fb) return false;
    if (!conflictFree(ra, rb)) return false;
    parent.set(rb, ra);
    size.set(ra, newSize);
    if (fb !== undefined) fixed.set(ra, fb);
    else if (fa !== undefined) fixed.set(ra, fa);
    return true;
  };

  // Manuelle "zusammen"-Regeln zuerst (dürfen die Kettengrenze ausreizen)
  for (const r of params.extraRules) {
    if (r.type === "fixedClass" && r.klasse !== undefined)
      for (const c of r.codes) fixed.set(find(c), r.klasse);
    if (r.type === "mustWith")
      for (let i = 1; i < r.codes.length; i++)
        tryUnion(r.codes[0], r.codes[i], Math.max(cap, r.codes.length));
  }

  const wishesEnabled = params.criteria.find((c) => c.id === "wishes")?.enabled ?? true;
  if (wishesEnabled) {
    // Gegenseitige Wünsche haben Vorrang
    for (const s of students)
      for (const w of s.wuensche)
        if (byCode.get(w)?.wuensche.includes(s.code)) tryUnion(s.code, w, cap);
    // Danach einseitige Wünsche (nur Erstwunsch zuerst, dann weitere)
    for (const s of students) if (s.wuensche[0]) tryUnion(s.code, s.wuensche[0], cap);
    for (const s of students) for (const w of s.wuensche.slice(1)) tryUnion(s.code, w, cap);
  }

  const groups = new Map<string, string[]>();
  for (const s of students) {
    const r = find(s.code);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(s.code);
  }
  const units: Unit[] = [];
  const unitOf = new Map<string, number>();
  for (const [root, members] of groups) {
    const u: Unit = { members };
    const f = fixed.get(root);
    if (f !== undefined) u.fixedClass = f;
    for (const m of members) unitOf.set(m, units.length);
    units.push(u);
  }
  return { units, unitOf };
}

function std(values: number[]): number {
  if (!values.length) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - avg) ** 2, 0) / values.length);
}

function makeCtx(students: Student[], params: SolverParams): Ctx {
  const { units, unitOf } = buildUnits(students, params);
  const weights = Object.fromEntries(
    params.criteria.map((c: Criterion) => [c.id, c.enabled ? c.weight / 100 : 0])
  ) as Record<CriterionId, number>;

  const notWithPairs: [string, string][] = [];
  const seen = new Set<string>();
  for (const s of students)
    for (const o of s.nichtMit) {
      const key = [s.code, o].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        notWithPairs.push([s.code, o]);
      }
    }
  for (const r of params.extraRules)
    if (r.type === "notWith" && r.codes.length === 2) {
      const key = [...r.codes].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        notWithPairs.push([r.codes[0], r.codes[1]]);
      }
    }

  const grades = students.map((s) => s.schnitt).filter((g): g is number => g != null);
  const bySchool = new Map<string, string[]>();
  for (const s of students)
    if (s.grundschule)
      (bySchool.get(s.grundschule) ?? bySchool.set(s.grundschule, []).get(s.grundschule)!).push(s.code);
  const smallSchools = new Map([...bySchool].filter(([, v]) => v.length >= 2 && v.length <= 4));

  const totalL = students.filter((s) => s.fremdsprache === "L").length;
  const maxPerClass = Math.ceil(students.length / params.numClasses) + 2;

  return {
    students: new Map(students.map((s) => [s.code, s])),
    units,
    unitOf,
    notWithPairs,
    params,
    weights,
    targetSize: students.length / params.numClasses,
    totalM: students.filter((s) => s.geschlecht === "m").length,
    totalKnownGender: students.filter((s) => s.geschlecht != null).length,
    gradeAvg: grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : 0,
    gradeStd: std(grades),
    smallSchools,
    minLatinClasses: Math.max(1, Math.ceil(totalL / maxPerClass)),
  };
}

function evaluate(ctx: Ctx, classOf: Map<string, number>): { score: number; penalties: Record<string, number> } {
  const { params, weights } = ctx;
  const K = params.numClasses;
  const p: Record<string, number> = {};

  const sizes = new Array(K).fill(0);
  const males = new Array(K).fill(0);
  const known = new Array(K).fill(0);
  const latin = new Array(K).fill(0);
  const choir = new Array(K).fill(0);
  const gradeLists: number[][] = Array.from({ length: K }, () => []);
  const schoolCount: Map<string, number>[] = Array.from({ length: K }, () => new Map());

  for (const [code, k] of classOf) {
    const s = ctx.students.get(code)!;
    sizes[k]++;
    if (s.geschlecht != null) {
      known[k]++;
      if (s.geschlecht === "m") males[k]++;
    }
    if (s.fremdsprache === "L") latin[k]++;
    if (s.chor) choir[k]++;
    if (s.schnitt != null) gradeLists[k].push(s.schnitt);
    if (s.grundschule) {
      const m = schoolCount[k];
      m.set(s.grundschule, (m.get(s.grundschule) ?? 0) + 1);
    }
  }

  // nicht mit (hart)
  let nw = 0;
  for (const [a, b] of ctx.notWithPairs) if (classOf.get(a) === classOf.get(b)) nw++;
  p.notwith = nw * 1000 * Math.max(weights.notwith, 0.5);

  // Wünsche: mind. ein Wunschpartner in derselben Klasse
  let unfulfilled = 0;
  for (const s of ctx.students.values()) {
    if (!s.wuensche.length) continue;
    const k = classOf.get(s.code);
    if (!s.wuensche.some((w) => classOf.get(w) === k)) unfulfilled++;
  }
  p.wishes = unfulfilled * 25 * weights.wishes;

  // Geschlechterbalance
  const ratio = ctx.totalKnownGender ? ctx.totalM / ctx.totalKnownGender : 0.5;
  let gender = 0;
  for (let k = 0; k < K; k++)
    if (known[k]) gender += Math.abs(males[k] - ratio * known[k]);
  p.gender = gender * 6 * weights.gender;

  // Grundschulblöcke
  let blocks = 0;
  for (let k = 0; k < K; k++)
    for (const cnt of schoolCount[k].values()) blocks += Math.max(0, cnt - params.maxSchoolBlock);
  p.schools = blocks * 40 * weights.schools;

  // Latein bündeln: Klassen absteigend nach L-Anzahl sortieren; jeder
  // L-Schüler außerhalb der minimal nötigen Klassen kostet — das gibt der
  // lokalen Suche einen Gradienten zum Konsolidieren.
  const sortedL = [...latin].sort((a, b) => b - a);
  let latinOutside = 0;
  for (let i = ctx.minLatinClasses; i < sortedL.length; i++) latinOutside += sortedL[i];
  const classesWithL = latin.filter((c) => c > 0).length;
  p.latin =
    (latinOutside * 8 + Math.max(0, classesWithL - ctx.minLatinClasses) * 15) * weights.latin;

  // Notenheterogenität: Schnitt & Streuung nahe am Gesamtwert
  let grades = 0;
  for (let k = 0; k < K; k++) {
    const list = gradeLists[k];
    if (!list.length) continue;
    const avg = list.reduce((a, b) => a + b, 0) / list.length;
    grades += Math.abs(avg - ctx.gradeAvg) * 10 + Math.abs(std(list) - ctx.gradeStd) * 6;
  }
  p.grades = grades * weights.grades;

  // Nachbarkinder: kleine Grundschulgruppen nicht zersplittern
  let split = 0;
  for (const codes of ctx.smallSchools.values()) {
    const ks = new Set(codes.map((c) => classOf.get(c)));
    split += ks.size - 1;
  }
  p.neighbors = split * 12 * weights.neighbors;

  // Chorklasse bündeln
  if (params.bundleChoir && weights.choir > 0) {
    const totalChoir = choir.reduce((a, b) => a + b, 0);
    const maxChoir = Math.max(...choir);
    p.choir = (totalChoir - maxChoir) * 15 * weights.choir;
  } else p.choir = 0;

  // Klassengrößen
  let sizeDev = 0;
  for (const s of sizes) sizeDev += Math.max(0, Math.abs(s - ctx.targetSize) - 1);
  p.balance = sizeDev * 30 * Math.max(weights.balance, 0.3);

  const score = Object.values(p).reduce((a, b) => a + b, 0);
  return { score, penalties: p };
}

export function solve(students: Student[], params: SolverParams, seed = 42): Assignment {
  const ctx = makeCtx(students, params);
  const K = params.numClasses;
  const rnd = mulberry32(seed);

  // Greedy-Start: große Gruppen zuerst, jeweils in die aktuell beste Klasse
  const order = [...ctx.units.keys()].sort(
    (a, b) => ctx.units[b].members.length - ctx.units[a].members.length
  );
  const unitClass = new Array<number>(ctx.units.length).fill(-1);
  const classOf = new Map<string, number>();

  const placeUnit = (ui: number, k: number) => {
    unitClass[ui] = k;
    for (const m of ctx.units[ui].members) classOf.set(m, k);
  };

  for (const ui of order) {
    const u = ctx.units[ui];
    if (u.fixedClass !== undefined) {
      placeUnit(ui, Math.min(u.fixedClass, K - 1));
      continue;
    }
    let bestK = 0;
    let bestScore = Infinity;
    for (let k = 0; k < K; k++) {
      placeUnit(ui, k);
      const { score } = evaluate(ctx, classOf);
      if (score < bestScore) {
        bestScore = score;
        bestK = k;
      }
    }
    placeUnit(ui, bestK);
  }

  // Lokale Suche: Gruppe verschieben, zwei Gruppen tauschen oder gezielt
  // Latein-Gruppen konsolidieren
  let { score: current } = evaluate(ctx, classOf);
  const movable = [...ctx.units.keys()].filter((ui) => ctx.units[ui].fixedClass === undefined);
  const iterations = Math.min(40000, 4000 + students.length * 250);
  const unitHasL = (ui: number) =>
    ctx.units[ui].members.some((m) => ctx.students.get(m)!.fremdsprache === "L");

  for (let it = 0; it < iterations && movable.length; it++) {
    const dice = rnd();
    if (dice < 0.15 && ctx.weights.latin > 0) {
      // Gezielt: L-Gruppe aus L-armer Klasse mit L-freier Gruppe aus der
      // L-reichsten Klasse tauschen
      const lCount = new Array(K).fill(0);
      for (const [code, k] of classOf)
        if (ctx.students.get(code)!.fremdsprache === "L") lCount[k]++;
      const richest = lCount.indexOf(Math.max(...lCount));
      const donors = movable.filter((ui) => unitHasL(ui) && unitClass[ui] !== richest);
      const takers = movable.filter((ui) => !unitHasL(ui) && unitClass[ui] === richest);
      if (donors.length && takers.length) {
        const a = donors[Math.floor(rnd() * donors.length)];
        const bs = takers.filter(
          (ui) => Math.abs(ctx.units[ui].members.length - ctx.units[a].members.length) <= 1
        );
        if (bs.length) {
          const b = bs[Math.floor(rnd() * bs.length)];
          const ka = unitClass[a];
          placeUnit(a, richest);
          placeUnit(b, ka);
          const { score } = evaluate(ctx, classOf);
          if (score < current) current = score;
          else {
            placeUnit(a, ka);
            placeUnit(b, richest);
          }
        }
      }
    } else if (dice < 0.55) {
      // Verschieben
      const ui = movable[Math.floor(rnd() * movable.length)];
      const from = unitClass[ui];
      const to = Math.floor(rnd() * K);
      if (to === from) continue;
      placeUnit(ui, to);
      const { score } = evaluate(ctx, classOf);
      if (score < current) current = score;
      else placeUnit(ui, from);
    } else {
      // Tauschen
      const a = movable[Math.floor(rnd() * movable.length)];
      const b = movable[Math.floor(rnd() * movable.length)];
      if (a === b || unitClass[a] === unitClass[b]) continue;
      const ka = unitClass[a];
      const kb = unitClass[b];
      placeUnit(a, kb);
      placeUnit(b, ka);
      const { score } = evaluate(ctx, classOf);
      if (score < current) current = score;
      else {
        placeUnit(a, ka);
        placeUnit(b, kb);
      }
    }
  }

  const { score, penalties } = evaluate(ctx, classOf);
  return { classOf: Object.fromEntries(classOf), score, penalties };
}

/** Mehrere Startpunkte, bestes Ergebnis gewinnt. */
export function solveBest(students: Student[], params: SolverParams, restarts = 4, baseSeed = 1): Assignment {
  let best: Assignment | null = null;
  for (let r = 0; r < restarts; r++) {
    const a = solve(students, params, baseSeed + r * 7919);
    if (!best || a.score < best.score) best = a;
  }
  return best!;
}

export interface ClassStats {
  size: number;
  m: number;
  w: number;
  latein: number;
  franz: number;
  chor: number;
  avg: number | null;
  schools: [string, number][];
  unfulfilledWishes: string[];
  notWithViolations: [string, string][];
}

export function classStats(students: Student[], assignment: Assignment, numClasses: number): ClassStats[] {
  const byCode = new Map(students.map((s) => [s.code, s]));
  const out: ClassStats[] = Array.from({ length: numClasses }, () => ({
    size: 0, m: 0, w: 0, latein: 0, franz: 0, chor: 0, avg: null,
    schools: [], unfulfilledWishes: [], notWithViolations: [],
  }));
  const gradeLists: number[][] = Array.from({ length: numClasses }, () => []);
  const schoolMaps: Map<string, number>[] = Array.from({ length: numClasses }, () => new Map());

  for (const s of students) {
    const k = assignment.classOf[s.code];
    if (k === undefined) continue;
    const st = out[k];
    st.size++;
    if (s.geschlecht === "m") st.m++;
    if (s.geschlecht === "w") st.w++;
    if (s.fremdsprache === "L") st.latein++;
    if (s.fremdsprache === "F") st.franz++;
    if (s.chor) st.chor++;
    if (s.schnitt != null) gradeLists[k].push(s.schnitt);
    if (s.grundschule) schoolMaps[k].set(s.grundschule, (schoolMaps[k].get(s.grundschule) ?? 0) + 1);
    if (s.wuensche.length && !s.wuensche.some((w) => assignment.classOf[w] === k))
      st.unfulfilledWishes.push(s.code);
    for (const o of s.nichtMit)
      if (assignment.classOf[o] === k && s.code < o) st.notWithViolations.push([s.code, o]);
  }
  for (let k = 0; k < numClasses; k++) {
    const g = gradeLists[k];
    out[k].avg = g.length ? Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 100) / 100 : null;
    out[k].schools = [...schoolMaps[k]].sort((a, b) => b[1] - a[1]);
  }
  return out;
}
