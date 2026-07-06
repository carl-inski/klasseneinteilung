// Zentrale Datentypen der Anwendung.
// Wichtig: Student enthält NUR anonymisierte Daten (Code statt Name).
// Die Klartext-Identitäten leben ausschließlich im IdentityMap im Browser.

export interface Identity {
  nachname: string;
  rufname: string;
  vornamen: string;
  email: string;
}

/** Code (S001…) -> Klartext. Verlässt nie den Browser. */
export type IdentityMap = Record<string, Identity>;

export interface Student {
  code: string;
  deutsch: number | null;
  mathe: number | null;
  hsu: number | null;
  schnitt: number | null;
  geschlecht: "m" | "w" | null;
  fremdsprache: "F" | "L" | null;
  grundschule: string | null;
  chor: boolean;
  /** Aufgelöste Wunschpartner (Codes) in Prioritätsreihenfolge */
  wuensche: string[];
  /** Wunsch-Nennungen, die keinem Schüler zugeordnet werden konnten */
  offeneWuensche: string[];
  /** Aufgelöste "nicht mit"-Codes */
  nichtMit: string[];
  offeneNichtMit: string[];
  /** Anonymisierte Bemerkung (Namen bereits durch Codes ersetzt) */
  bemerkung: string | null;
}

export type CriterionId =
  | "notwith"
  | "wishes"
  | "chains"
  | "gender"
  | "schools"
  | "latin"
  | "grades"
  | "neighbors"
  | "choir"
  | "balance";

export interface Criterion {
  id: CriterionId;
  label: string;
  description: string;
  enabled: boolean;
  /** Gewicht 0–100; ergibt sich initial aus der Reihenfolge, ist anpassbar */
  weight: number;
}

export interface SolverParams {
  numClasses: number;
  maxSchoolBlock: number; // max. Schüler derselben Grundschule pro Klasse
  maxWishGroup: number; // max. Größe einer Wunschgruppe (keine Ketten)
  bundleChoir: boolean; // Chorkinder in eine Klasse
  criteria: Criterion[];
  /** Manuelle Zusatzregeln (aus Entscheidungsfällen / KI-Vorschlägen) */
  extraRules: ExtraRule[];
}

export interface ExtraRule {
  type: "mustWith" | "notWith" | "fixedClass";
  codes: string[]; // beteiligte Schüler
  klasse?: number; // für fixedClass
  reason: string;
}

export interface Assignment {
  /** code -> Klassenindex (0-basiert) */
  classOf: Record<string, number>;
  score: number;
  penalties: Record<string, number>;
}

export interface DecisionCase {
  code: string;
  kind: "bemerkung" | "offenerWunsch" | "fehlendeDaten" | "offenesNichtMit";
  text: string;
}

export const DEFAULT_CRITERIA: Criterion[] = [
  {
    id: "notwith",
    label: "Sonderwünsche „nicht mit …“",
    description: "Genannte Schüler kommen nicht in dieselbe Klasse (harte Regel).",
    enabled: true,
    weight: 100,
  },
  {
    id: "wishes",
    label: "Wunschpartner erfüllen",
    description: "Jeder Schüler mit Wunsch bekommt mindestens einen Wunschpartner in seiner Klasse.",
    enabled: true,
    weight: 90,
  },
  {
    id: "chains",
    label: "Keine Wunschketten (max. 4er-Gruppen)",
    description: "Wunschgruppen werden auf max. 4 Schüler begrenzt, keine Ketten.",
    enabled: true,
    weight: 85,
  },
  {
    id: "gender",
    label: "Gleichmäßige Verteilung m/w",
    description: "Jungen- und Mädchenanteil ist in allen Klassen möglichst gleich.",
    enabled: true,
    weight: 70,
  },
  {
    id: "schools",
    label: "Grundschulen mischen (max. 8er-Blöcke)",
    description: "Keine Blöcke größer als 8 aus einer Grundschule pro Klasse.",
    enabled: true,
    weight: 65,
  },
  {
    id: "latin",
    label: "Möglichst wenige Klassen mit Latein",
    description: "Voraussichtliche 2. Fremdsprache: Latein-Schüler auf möglichst wenige Klassen bündeln.",
    enabled: true,
    weight: 55,
  },
  {
    id: "grades",
    label: "Übertrittsnoten heterogen",
    description: "Notenschnitt und Notenstreuung sind in allen Klassen ähnlich.",
    enabled: true,
    weight: 45,
  },
  {
    id: "neighbors",
    label: "Nachbarkinder beisammen lassen",
    description: "Kleine Grundschulgruppen (≤ 4 Kinder) werden nicht auseinandergerissen.",
    enabled: true,
    weight: 35,
  },
  {
    id: "choir",
    label: "Chorklasse bündeln",
    description: "Kinder mit Chorklasse-Anmeldung kommen in dieselbe Klasse.",
    enabled: false,
    weight: 30,
  },
  {
    id: "balance",
    label: "Gleiche Klassengrößen",
    description: "Klassen unterscheiden sich um höchstens ±2 Schüler.",
    enabled: true,
    weight: 60,
  },
];
