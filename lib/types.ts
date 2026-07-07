// Generisches Datenmodell — funktioniert für beliebige Klasseneinteilungs-Excel.
// Statt fest verdrahteter Spalten (Deutsch, Mathe …) wird jede Spalte einer
// Rolle zugeordnet. Daraus ergeben sich Kriterien und harte Regeln.
// Die Verarbeitung läuft ausschließlich auf anonymisierten Codes (S001 …).

export type Role =
  | "ignore"
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "wish" // Wunschpartner (Freitext)
  | "avoid" // „nicht mit …“ (Freitext)
  | "balance" // Kategorie gleichmäßig verteilen (z. B. Geschlecht)
  | "concentrate" // Kategorie-Wert auf wenige Klassen bündeln (z. B. Latein)
  | "spread" // Zahl heterogen verteilen (z. B. Notenschnitt)
  | "mix" // Herkunft mischen: Blöcke begrenzen, kleine Gruppen zusammenlassen
  | "cluster" // harter Cluster: alle mit Wert X in eigene Klasse(n) (z. B. Chor)
  | "note"; // Freitext-Bemerkung

export interface Column {
  header: string;
  role: Role;
  /** Für role "cluster"/"concentrate": der relevante Wert (z. B. "ja", "L"). */
  targetValue?: string;
}

export interface Identity {
  firstName: string;
  lastName: string;
  full: string;
  email: string;
}
/** Code (S001…) -> Klartext. Verlässt den Browser nur bei ausdrücklicher Aktion. */
export type IdentityMap = Record<string, Identity>;

export interface Student {
  code: string;
  wishesRaw: string[];
  avoidRaw: string[];
  wishes: string[]; // aufgelöste Codes
  avoid: string[];
  offeneWuensche: string[];
  offeneAvoid: string[];
  /** Werte der balance/concentrate/spread/mix/cluster-Spalten, je Header. */
  attrs: Record<string, string | number | null>;
  note: string | null;
}

export type CriterionKind = "wish" | "avoid" | "balance" | "concentrate" | "spread" | "mix";

export interface Criterion {
  id: string;
  kind: CriterionKind;
  header?: string; // betroffene Spalte (außer wish/avoid, die spaltenübergreifend sind)
  label: string;
  description: string;
  enabled: boolean;
  hard: boolean; // harte Regel (überstimmt alle weichen)
  weight: number; // 0–100
  targetValue?: string; // für concentrate
  maxBlock?: number; // für mix
}

export interface ClusterConfig {
  header: string;
  value: string; // z. B. "ja"
  label: string; // z. B. "Chorklasse"
  classes: number | null; // Anzahl dedizierter Klassen (null = automatisch)
}

export interface ExtraRule {
  type: "mustWith" | "notWith";
  codes: string[];
  reason: string;
}

export interface Config {
  numClasses: number; // exakt (harte Regel)
  classPrefix: string; // z. B. "5" -> Labels 5a, 5b …
  balanceSizes: boolean; // Klassengrößen ausgleichen (harte Obergrenze)
  columns: Column[];
  clusters: ClusterConfig[];
  criteria: Criterion[];
  extraRules: ExtraRule[];
}

export interface Assignment {
  classOf: Record<string, number>;
  score: number;
  penalties: Record<string, number>;
  hardViolations: string[];
}

export interface DecisionCase {
  code: string;
  kind: "note" | "openWish" | "openAvoid" | "missing";
  text: string;
  /** Original-Nennung (roh) bei offenen Wünschen/„nicht mit“ — für manuelle Zuordnung. */
  mention?: string;
  field?: "wish" | "avoid";
}

export function classLabel(prefix: string, k: number): string {
  const letter = String.fromCharCode(97 + k); // a, b, c …
  return `${prefix}${letter}`;
}
