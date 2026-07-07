// Klasseneinteilungs-Solver mit HARTEN und WEICHEN Kriterien.
//
// Harte Regeln (strukturell erzwungen, überstimmen alle Wünsche):
//   • genau numClasses Klassen
//   • Klassengröße: keine Klasse über der berechneten Obergrenze (=> ±1 gleich)
//   • Cluster (z. B. Chor): alle Kinder mit dem Cluster-Wert kommen in dedizierte
//     Cluster-Klassen; ihre eigenen Wünsche werden dabei ignoriert. Danach werden
//     die Cluster-Klassen mit Nicht-Cluster-Kindern bis zur Klassengröße aufgefüllt.
//   • als „hart“ markierte Kriterien (z. B. „nicht mit“) werden bei Zügen erzwungen.
//
// Weiche Kriterien werden als gewichtete Straffunktion minimiert
// (Greedy-Start + lokale Suche).

import type { Assignment, Config, Criterion, Student } from "./types";

interface Unit {
  members: string[];
  fixedClass?: number; // Cluster-Kinder sind fest zugeordnet
}

interface Ctx {
  students: Map<string, Student>;
  config: Config;
  K: number;
  units: Unit[];
  unitClass: number[];
  clusterClasses: Set<number>;
  maxSize: number;
  targetSize: number;
  notWithPairs: [string, string][];
  hardAvoid: boolean;
  criteria: Criterion[];
  // vorberechnete Kennzahlen je Kriterium
  balanceRatios: Map<string, Map<string, number>>; // header -> value -> ratio
  spreadStats: Map<string, { avg: number; std: number }>;
  smallGroups: Map<string, string[][]>; // header -> kleine Gruppen (Codes)
  concentrateMin: Map<string, number>; // header -> min. Klassenzahl
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

const std = (values: number[]): number => {
  if (!values.length) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - avg) ** 2, 0) / values.length);
};

const attrStr = (s: Student, header: string): string | null => {
  const v = s.attrs[header];
  return v == null || v === "" ? null : String(v).trim();
};

function collectNotWith(students: Student[], config: Config): [string, string][] {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  const add = (a: string, b: string) => {
    const key = [a, b].sort().join("|");
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push([a, b]);
    }
  };
  for (const s of students) for (const o of s.avoid) add(s.code, o);
  for (const r of config.extraRules) if (r.type === "notWith" && r.codes.length === 2) add(r.codes[0], r.codes[1]);
  return pairs;
}

// Wunschgruppen bilden (Union-Find, größenbeschränkt, ohne „nicht mit“-Konflikte).
// Cluster-Kinder nehmen NICHT teil (ihre Wünsche sind untergeordnet).
function buildUnits(
  students: Student[],
  config: Config,
  clusterOf: Map<string, number>,
  maxSize: number
): { units: Unit[] } {
  const cap = 4; // keine Wunschketten (max. 4er-Gruppen)
  const wishesEnabled = config.criteria.find((c) => c.kind === "wish")?.enabled ?? true;

  const free = students.filter((s) => !clusterOf.has(s.code));
  const byCode = new Map(free.map((s) => [s.code, s]));
  const parent = new Map<string, string>();
  const size = new Map<string, number>();
  for (const s of free) {
    parent.set(s.code, s.code);
    size.set(s.code, 1);
  }
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const notWith = new Set<string>();
  for (const s of students) for (const o of s.avoid) notWith.add([s.code, o].sort().join("|"));
  for (const r of config.extraRules)
    if (r.type === "notWith" && r.codes.length === 2) notWith.add([...r.codes].sort().join("|"));

  const conflictFree = (ra: string, rb: string): boolean => {
    const a: string[] = [];
    const b: string[] = [];
    for (const s of free) {
      const r = find(s.code);
      if (r === ra) a.push(s.code);
      else if (r === rb) b.push(s.code);
    }
    for (const x of a) for (const y of b) if (notWith.has([x, y].sort().join("|"))) return false;
    return true;
  };
  const tryUnion = (a: string, b: string, maxGroup: number): void => {
    if (!byCode.has(a) || !byCode.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (size.get(ra)! + size.get(rb)! > Math.min(maxGroup, maxSize)) return;
    if (!conflictFree(ra, rb)) return;
    parent.set(rb, ra);
    size.set(ra, size.get(ra)! + size.get(rb)!);
  };

  // Manuelle „zusammen“-Regeln
  for (const r of config.extraRules)
    if (r.type === "mustWith")
      for (let i = 1; i < r.codes.length; i++) tryUnion(r.codes[0], r.codes[i], Math.max(cap, r.codes.length));

  if (wishesEnabled) {
    for (const s of free)
      for (const w of s.wishes) if (byCode.get(w)?.wishes.includes(s.code)) tryUnion(s.code, w, cap);
    for (const s of free) if (s.wishes[0]) tryUnion(s.code, s.wishes[0], cap);
    for (const s of free) for (const w of s.wishes.slice(1)) tryUnion(s.code, w, cap);
  }

  const groups = new Map<string, string[]>();
  for (const s of free) {
    const r = find(s.code);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(s.code);
  }
  const units: Unit[] = [...groups.values()].map((members) => ({ members }));
  return { units };
}

function makeCtx(students: Student[], config: Config): Ctx {
  const K = config.numClasses;
  const n = students.length;
  const maxSize = config.balanceSizes ? Math.ceil(n / K) : n;
  const targetSize = n / K;

  // Cluster-Kinder bestimmen und auf dedizierte Cluster-Klassen verteilen
  const clusterOf = new Map<string, number>();
  const clusterClasses = new Set<number>();
  let nextClass = 0;
  for (const cl of config.clusters) {
    const members = students.filter(
      (s) => (attrStr(s, cl.header) ?? "").toLowerCase() === cl.value.toLowerCase()
    );
    if (!members.length) continue;
    const need = cl.classes ?? Math.max(1, Math.ceil(members.length / maxSize));
    const classes: number[] = [];
    for (let i = 0; i < need && nextClass < K; i++) {
      classes.push(nextClass);
      clusterClasses.add(nextClass);
      nextClass++;
    }
    if (!classes.length) continue;
    members.forEach((s, i) => clusterOf.set(s.code, classes[i % classes.length]));
  }

  const { units } = buildUnits(students, config, clusterOf, maxSize);
  // Cluster-Kinder als fixierte Einzel-Units anhängen
  const byCode = new Map(students.map((s) => [s.code, s]));
  const unitList: Unit[] = [...units];
  for (const [code, k] of clusterOf) unitList.push({ members: [code], fixedClass: k });

  const criteria = config.criteria.filter((c) => c.enabled);
  const hardAvoid = criteria.some((c) => c.kind === "avoid" && c.hard);

  // Vorberechnungen
  const balanceRatios = new Map<string, Map<string, number>>();
  const spreadStats = new Map<string, { avg: number; std: number }>();
  const smallGroups = new Map<string, string[][]>();
  const concentrateMin = new Map<string, number>();

  for (const c of criteria) {
    if (c.kind === "balance" && c.header) {
      const counts = new Map<string, number>();
      let total = 0;
      for (const s of students) {
        const v = attrStr(s, c.header);
        if (v == null) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
        total++;
      }
      const ratios = new Map<string, number>();
      for (const [v, cnt] of counts) ratios.set(v, total ? cnt / total : 0);
      balanceRatios.set(c.header, ratios);
    }
    if (c.kind === "spread" && c.header) {
      const vals = students.map((s) => s.attrs[c.header!]).filter((v): v is number => typeof v === "number");
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      spreadStats.set(c.header, { avg, std: std(vals) });
    }
    if (c.kind === "mix" && c.header) {
      const groups = new Map<string, string[]>();
      for (const s of students) {
        const v = attrStr(s, c.header);
        if (v) (groups.get(v) ?? groups.set(v, []).get(v)!).push(s.code);
      }
      smallGroups.set(
        c.header,
        [...groups.values()].filter((g) => g.length >= 2 && g.length <= 4)
      );
    }
    if (c.kind === "concentrate" && c.header && c.targetValue) {
      const cnt = students.filter(
        (s) => (attrStr(s, c.header!) ?? "") === c.targetValue
      ).length;
      concentrateMin.set(c.id, Math.max(1, Math.ceil(cnt / maxSize)));
    }
  }

  return {
    students: byCode,
    config,
    K,
    units: unitList,
    unitClass: new Array(unitList.length).fill(-1),
    clusterClasses,
    maxSize,
    targetSize,
    notWithPairs: collectNotWith(students, config),
    hardAvoid,
    criteria,
    balanceRatios,
    spreadStats,
    smallGroups,
    concentrateMin,
  };
}

function evaluate(ctx: Ctx, classOf: Map<string, number>): { score: number; penalties: Record<string, number> } {
  const { K, criteria } = ctx;
  const p: Record<string, number> = {};

  // Aggregate je Klasse
  const sizes = new Array(K).fill(0);
  for (const k of classOf.values()) sizes[k]++;

  for (const c of criteria) {
    const w = c.weight / 100;
    if (c.kind === "wish") {
      let unfulfilled = 0;
      for (const s of ctx.students.values()) {
        if (!s.wishes.length) continue;
        // Cluster-Kinder: Wünsche untergeordnet -> nicht zählen
        const k = classOf.get(s.code);
        if (k !== undefined && ctx.clusterClasses.has(k) && isCluster(ctx, s.code)) continue;
        if (!s.wishes.some((wc) => classOf.get(wc) === k)) unfulfilled++;
      }
      p[c.id] = unfulfilled * 25 * w;
    } else if (c.kind === "avoid") {
      let v = 0;
      for (const [a, b] of ctx.notWithPairs) if (classOf.get(a) === classOf.get(b)) v++;
      p[c.id] = v * (c.hard ? 5000 : 200) * w;
    } else if (c.kind === "balance" && c.header) {
      const ratios = ctx.balanceRatios.get(c.header)!;
      const known = new Array(K).fill(0);
      const counts: Map<string, number[]> = new Map();
      for (const [code, k] of classOf) {
        const val = attrStr(ctx.students.get(code)!, c.header);
        if (val == null) continue;
        known[k]++;
        if (!counts.has(val)) counts.set(val, new Array(K).fill(0));
        counts.get(val)![k]++;
      }
      let dev = 0;
      for (const [val, ratio] of ratios)
        for (let k = 0; k < K; k++) {
          const actual = counts.get(val)?.[k] ?? 0;
          dev += Math.abs(actual - ratio * known[k]);
        }
      p[c.id] = dev * 6 * w;
    } else if (c.kind === "concentrate" && c.header && c.targetValue) {
      const counts = new Array(K).fill(0);
      for (const [code, k] of classOf)
        if ((attrStr(ctx.students.get(code)!, c.header) ?? "") === c.targetValue) counts[k]++;
      const sorted = [...counts].sort((a, b) => b - a);
      const min = ctx.concentrateMin.get(c.id) ?? 1;
      let outside = 0;
      for (let i = min; i < sorted.length; i++) outside += sorted[i];
      const withVal = counts.filter((x) => x > 0).length;
      p[c.id] = (outside * 8 + Math.max(0, withVal - min) * 15) * w;
    } else if (c.kind === "spread" && c.header) {
      const stats = ctx.spreadStats.get(c.header)!;
      const lists: number[][] = Array.from({ length: K }, () => []);
      for (const [code, k] of classOf) {
        const v = ctx.students.get(code)!.attrs[c.header];
        if (typeof v === "number") lists[k].push(v);
      }
      let dev = 0;
      for (const list of lists) {
        if (!list.length) continue;
        const avg = list.reduce((a, b) => a + b, 0) / list.length;
        dev += Math.abs(avg - stats.avg) * 10 + Math.abs(std(list) - stats.std) * 6;
      }
      p[c.id] = dev * w;
    } else if (c.kind === "mix" && c.header) {
      const maxBlock = c.maxBlock ?? 8;
      const perClass: Map<string, number>[] = Array.from({ length: K }, () => new Map());
      for (const [code, k] of classOf) {
        const v = attrStr(ctx.students.get(code)!, c.header);
        if (v) perClass[k].set(v, (perClass[k].get(v) ?? 0) + 1);
      }
      let blocks = 0;
      for (let k = 0; k < K; k++) for (const cnt of perClass[k].values()) blocks += Math.max(0, cnt - maxBlock);
      let split = 0;
      for (const g of ctx.smallGroups.get(c.header) ?? []) {
        const ks = new Set(g.map((x) => classOf.get(x)));
        split += ks.size - 1;
      }
      p[c.id] = (blocks * 40 + split * 12) * w;
    }
  }

  // Größen-Ausgleich (weicher Beitrag; Obergrenze ist hart im Placement)
  if (ctx.config.balanceSizes) {
    let sizeDev = 0;
    for (const s of sizes) sizeDev += Math.max(0, Math.abs(s - ctx.targetSize) - 1);
    p._size = sizeDev * 30;
  }

  const score = Object.values(p).reduce((a, b) => a + b, 0);
  return { score, penalties: p };
}

const isCluster = (ctx: Ctx, code: string): boolean =>
  ctx.units.some((u) => u.fixedClass !== undefined && u.members.includes(code));

export function solve(students: Student[], config: Config, seed = 42): Assignment {
  const ctx = makeCtx(students, config);
  const { K, units, unitClass, maxSize } = ctx;
  const rnd = mulberry32(seed);
  const classOf = new Map<string, number>();
  const sizes = new Array(K).fill(0);

  const place = (ui: number, k: number) => {
    const prev = unitClass[ui];
    if (prev >= 0) sizes[prev] -= units[ui].members.length;
    unitClass[ui] = k;
    sizes[k] += units[ui].members.length;
    for (const m of units[ui].members) classOf.set(m, k);
  };
  const avoidConflict = (ui: number, k: number): boolean => {
    if (!ctx.hardAvoid) return false;
    for (const m of units[ui].members)
      for (const [a, b] of ctx.notWithPairs) {
        const other = a === m ? b : b === m ? a : null;
        if (other && classOf.get(other) === k && unitClass[ui] !== k) return true;
      }
    return false;
  };

  // Fixierte (Cluster-)Units zuerst
  for (let ui = 0; ui < units.length; ui++)
    if (units[ui].fixedClass !== undefined) place(ui, Math.min(units[ui].fixedClass!, K - 1));

  // Freie Units: groß zuerst, in beste zulässige (kapazitäts- und avoid-konforme) Klasse
  const freeOrder = [...units.keys()]
    .filter((ui) => units[ui].fixedClass === undefined)
    .sort((a, b) => units[b].members.length - units[a].members.length);

  for (const ui of freeOrder) {
    const s = units[ui].members.length;
    let bestK = -1;
    let bestScore = Infinity;
    for (let k = 0; k < K; k++) {
      if (sizes[k] + s > maxSize) continue;
      if (avoidConflict(ui, k)) continue;
      place(ui, k);
      const { score } = evaluate(ctx, classOf);
      // Tiebreak: leerere Klasse bevorzugen (hält Kapazität offen)
      const adj = score + sizes[k] * 0.01;
      if (adj < bestScore) {
        bestScore = adj;
        bestK = k;
      }
    }
    if (bestK < 0) {
      // Notfall: kleinste Klasse ohne avoid-Konflikt
      let mk = 0;
      for (let k = 1; k < K; k++) if (sizes[k] < sizes[mk] && !avoidConflict(ui, k)) mk = k;
      bestK = mk;
    }
    place(ui, bestK);
  }

  // Lokale Suche
  const movable = freeOrder;
  let { score: current } = evaluate(ctx, classOf);
  const iterations = Math.min(50000, 6000 + students.length * 300);

  for (let it = 0; it < iterations && movable.length; it++) {
    const dice = rnd();
    if (dice < 0.5) {
      const ui = movable[Math.floor(rnd() * movable.length)];
      const from = unitClass[ui];
      const to = Math.floor(rnd() * K);
      if (to === from) continue;
      if (sizes[to] + units[ui].members.length > maxSize) continue;
      if (avoidConflict(ui, to)) continue;
      place(ui, to);
      const { score } = evaluate(ctx, classOf);
      if (score < current) current = score;
      else place(ui, from);
    } else {
      const a = movable[Math.floor(rnd() * movable.length)];
      const b = movable[Math.floor(rnd() * movable.length)];
      if (a === b || unitClass[a] === unitClass[b]) continue;
      const ka = unitClass[a];
      const kb = unitClass[b];
      const sa = units[a].members.length;
      const sb = units[b].members.length;
      if (sizes[ka] - sa + sb > maxSize || sizes[kb] - sb + sa > maxSize) continue;
      place(a, kb);
      place(b, ka);
      if (avoidConflict(a, kb) || avoidConflict(b, ka)) {
        place(a, ka);
        place(b, kb);
        continue;
      }
      const { score } = evaluate(ctx, classOf);
      if (score < current) current = score;
      else {
        place(a, ka);
        place(b, kb);
      }
    }
  }

  const { score, penalties } = evaluate(ctx, classOf);
  const hardViolations = checkHard(ctx, classOf);
  return { classOf: Object.fromEntries(classOf), score, penalties, hardViolations };
}

function checkHard(ctx: Ctx, classOf: Map<string, number>): string[] {
  const out: string[] = [];
  const sizes = new Array(ctx.K).fill(0);
  for (const k of classOf.values()) sizes[k]++;
  if (ctx.config.balanceSizes && Math.max(...sizes) - Math.min(...sizes) > 1)
    out.push(`Klassengrößen weichen ab: ${sizes.join(", ")}`);
  if (ctx.hardAvoid)
    for (const [a, b] of ctx.notWithPairs)
      if (classOf.get(a) === classOf.get(b)) out.push(`„nicht mit“ verletzt: ${a} + ${b}`);
  // Cluster-Kinder alle in Cluster-Klassen?
  for (const u of ctx.units)
    if (u.fixedClass !== undefined)
      for (const m of u.members)
        if (!ctx.clusterClasses.has(classOf.get(m)!)) out.push(`Cluster-Kind ${m} nicht in Cluster-Klasse`);
  return out;
}

export function solveBest(students: Student[], config: Config, restarts = 5, baseSeed = 1): Assignment {
  let best: Assignment | null = null;
  for (let r = 0; r < restarts; r++) {
    const a = solve(students, config, baseSeed + r * 7919);
    // Lösung ohne harte Verletzung immer bevorzugen
    if (
      !best ||
      (a.hardViolations.length < best.hardViolations.length) ||
      (a.hardViolations.length === best.hardViolations.length && a.score < best.score)
    )
      best = a;
  }
  return best!;
}

export interface ClassStats {
  size: number;
  isCluster: boolean;
  categories: Map<string, [string, number][]>; // header -> [wert, anzahl]
  spreads: Map<string, number | null>; // header -> Durchschnitt
  mixes: Map<string, [string, number][]>;
  concentrates: Map<string, number>; // header -> Anzahl Zielwert
  unfulfilledWishes: string[];
  avoidViolations: [string, string][];
}

export function classStats(students: Student[], config: Config, assignment: Assignment): ClassStats[] {
  const K = config.numClasses;
  const byCode = new Map(students.map((s) => [s.code, s]));
  const criteria = config.criteria.filter((c) => c.enabled);
  const clusterHeaders = config.clusters;

  const clusterClasses = new Set<number>();
  {
    // Cluster-Klassen aus der Zuordnung ableiten
    for (const cl of clusterHeaders) {
      for (const s of students)
        if ((s.attrs[cl.header] ?? "").toString().toLowerCase() === cl.value.toLowerCase()) {
          const k = assignment.classOf[s.code];
          if (k !== undefined) clusterClasses.add(k);
        }
    }
  }

  const out: ClassStats[] = Array.from({ length: K }, (_, k) => ({
    size: 0,
    isCluster: clusterClasses.has(k),
    categories: new Map(),
    spreads: new Map(),
    mixes: new Map(),
    concentrates: new Map(),
    unfulfilledWishes: [],
    avoidViolations: [],
  }));

  const balanceHeaders = criteria.filter((c) => c.kind === "balance").map((c) => c.header!);
  const mixHeaders = criteria.filter((c) => c.kind === "mix").map((c) => c.header!);
  const spreadHeaders = criteria.filter((c) => c.kind === "spread").map((c) => c.header!);
  const concentrateCrit = criteria.filter((c) => c.kind === "concentrate");
  const spreadLists: Map<string, number[]>[] = Array.from({ length: K }, () => new Map());
  const catMaps: Map<string, Map<string, number>>[] = Array.from({ length: K }, () => new Map());

  for (const s of students) {
    const k = assignment.classOf[s.code];
    if (k === undefined) continue;
    const st = out[k];
    st.size++;
    for (const h of [...balanceHeaders, ...mixHeaders]) {
      const v = s.attrs[h];
      if (v == null || v === "") continue;
      if (!catMaps[k].has(h)) catMaps[k].set(h, new Map());
      const m = catMaps[k].get(h)!;
      m.set(String(v), (m.get(String(v)) ?? 0) + 1);
    }
    for (const h of spreadHeaders) {
      const v = s.attrs[h];
      if (typeof v === "number") (spreadLists[k].get(h) ?? spreadLists[k].set(h, []).get(h)!).push(v);
    }
    for (const c of concentrateCrit)
      if ((s.attrs[c.header!] ?? "") === c.targetValue)
        st.concentrates.set(c.header!, (st.concentrates.get(c.header!) ?? 0) + 1);
    const isCl = clusterHeaders.some(
      (cl) => (s.attrs[cl.header] ?? "").toString().toLowerCase() === cl.value.toLowerCase()
    );
    if (s.wishes.length && !isCl && !s.wishes.some((w) => assignment.classOf[w] === k))
      st.unfulfilledWishes.push(s.code);
    for (const o of s.avoid) if (assignment.classOf[o] === k && s.code < o) st.avoidViolations.push([s.code, o]);
  }

  for (let k = 0; k < K; k++) {
    for (const h of balanceHeaders)
      out[k].categories.set(h, [...(catMaps[k].get(h) ?? new Map())].sort((a, b) => b[1] - a[1]));
    for (const h of mixHeaders)
      out[k].mixes.set(h, [...(catMaps[k].get(h) ?? new Map())].sort((a, b) => b[1] - a[1]));
    for (const h of spreadHeaders) {
      const list = spreadLists[k].get(h) ?? [];
      out[k].spreads.set(h, list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100 : null);
    }
  }
  return out;
}
