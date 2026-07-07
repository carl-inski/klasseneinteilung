// Erzeugt aus den erkannten Spalten eine Standard-Konfiguration:
// weiche Kriterien (in Prioritätsreihenfolge) + harte Cluster (z. B. Chor).
// Der Nutzer kann alles im UI anpassen.

import type { Column, Config, Criterion, ClusterConfig, Student } from "./types";

// Standard-Gewichte je Kriteriumsart (aus dem Ablaufzettel „Klassenbildung“).
const KIND_WEIGHT: Record<string, number> = {
  avoid: 100,
  wish: 90,
  balance: 70,
  mix: 65,
  concentrate: 55,
  spread: 45,
};

const KIND_LABEL: Record<string, (col: string) => string> = {
  wish: () => "Wunschpartner erfüllen",
  avoid: () => "Sonderwünsche „nicht mit …“",
  balance: (c) => `${c} gleichmäßig verteilen`,
  concentrate: (c) => `${c} auf wenige Klassen bündeln`,
  spread: (c) => `${c} heterogen verteilen`,
  mix: (c) => `${c} mischen (Blöcke begrenzen)`,
};

const KIND_DESC: Record<string, (col: string, val?: string) => string> = {
  wish: () => "Jeder Schüler mit Wunsch bekommt mindestens einen Wunschpartner in seiner Klasse.",
  avoid: () => "Genannte Schüler kommen nicht in dieselbe Klasse.",
  balance: (c) => `Die Werte von „${c}“ (z. B. m/w) sind in allen Klassen möglichst gleich verteilt.`,
  concentrate: (c, v) => `Schüler mit „${v}“ in „${c}“ werden auf möglichst wenige Klassen gebündelt.`,
  spread: (c) => `„${c}“ (Zahl) ist in allen Klassen ähnlich im Schnitt und in der Streuung.`,
  mix: (c) => `Kleine „${c}“-Gruppen bleiben zusammen, große Blöcke werden auf max. 8 begrenzt.`,
};

export function buildConfig(columns: Column[], students: Student[], numClasses: number): Config {
  const criteria: Criterion[] = [];
  const clusters: ClusterConfig[] = [];

  if (columns.some((c) => c.role === "avoid")) {
    criteria.push(mkCriterion("avoid", undefined, true));
  }
  if (columns.some((c) => c.role === "wish")) {
    criteria.push(mkCriterion("wish"));
  }
  for (const c of columns) {
    if (c.role === "balance") criteria.push(mkCriterion("balance", c.header));
    if (c.role === "spread") criteria.push(mkCriterion("spread", c.header));
    if (c.role === "mix") criteria.push(mkCriterion("mix", c.header));
    if (c.role === "concentrate") {
      const val = c.targetValue || guessMinority(students, c.header);
      criteria.push(mkCriterion("concentrate", c.header, false, val));
    }
    if (c.role === "cluster") {
      clusters.push({
        header: c.header,
        value: c.targetValue || "ja",
        label: c.header,
        classes: null,
      });
    }
  }

  criteria.sort((a, b) => b.weight - a.weight);

  return {
    numClasses,
    classPrefix: "5",
    balanceSizes: true,
    columns,
    clusters,
    criteria,
    extraRules: [],
  };
}

function mkCriterion(
  kind: Criterion["kind"],
  header?: string,
  hard = false,
  targetValue?: string
): Criterion {
  const col = header ?? "";
  return {
    id: `${kind}:${header ?? ""}`,
    kind,
    header,
    label: KIND_LABEL[kind](col),
    description: KIND_DESC[kind](col, targetValue),
    enabled: true,
    hard,
    weight: KIND_WEIGHT[kind],
    targetValue,
    maxBlock: kind === "mix" ? 8 : undefined,
  };
}

function guessMinority(students: Student[], header: string): string {
  const counts = new Map<string, number>();
  for (const s of students) {
    const v = s.attrs[header];
    if (v == null || v === "") continue;
    const key = String(v).trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
  return sorted[0]?.[0] ?? "";
}
