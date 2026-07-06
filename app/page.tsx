"use client";

// Hauptseite: Upload -> Anonymisierung (nur im Browser) -> Parameter ->
// Solver -> Ergebnis + Entscheidungsfälle -> Excel-Export (de-anonymisiert).
// Die Klarnamen existieren ausschließlich im identityMap im Browser-Speicher.

import { useMemo, useRef, useState } from "react";
import { parseWorkbook } from "@/lib/parse";
import { anonymize } from "@/lib/anonymize";
import { solveBest, classStats } from "@/lib/solver";
import { findDecisionCases } from "@/lib/decisions";
import { buildWorkbook, downloadWorkbook, CLASS_LABELS } from "@/lib/exportXlsx";
import type {
  Assignment,
  Criterion,
  DecisionCase,
  ExtraRule,
  IdentityMap,
  Student,
} from "@/lib/types";
import { DEFAULT_CRITERIA } from "@/lib/types";

interface AiSuggestion {
  codes: string[];
  action: "mustWith" | "notWith" | "none";
  reason: string;
}

export default function Home() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [identityMap, setIdentityMap] = useState<IdentityMap>({});
  const [fileName, setFileName] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [numClasses, setNumClasses] = useState(5);
  const [maxSchoolBlock, setMaxSchoolBlock] = useState(8);
  const [maxWishGroup, setMaxWishGroup] = useState(4);
  const [bundleChoir, setBundleChoir] = useState(false);
  const [criteria, setCriteria] = useState<Criterion[]>(DEFAULT_CRITERIA);
  const [extraRules, setExtraRules] = useState<ExtraRule[]>([]);

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [solving, setSolving] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [seed, setSeed] = useState(1);

  const [apiKey, setApiKey] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[] | null>(null);
  const [aiError, setAiError] = useState("");

  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const decisionCases: DecisionCase[] = useMemo(
    () => (students ? findDecisionCases(students) : []),
    [students]
  );

  const name = (code: string): string => {
    if (!showNames) return code;
    const id = identityMap[code];
    return id ? `${id.rufname} ${id.nachname}` : code;
  };
  const deanonText = (text: string): string =>
    showNames
      ? text.replace(/S\d{3}/g, (c) => {
          const id = identityMap[c];
          return id ? `${id.rufname} ${id.nachname}` : c;
        })
      : text;

  async function handleFile(file: File) {
    setError("");
    setAssignment(null);
    setAiSuggestions(null);
    setExtraRules([]);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      const { students: anon, identityMap: map } = anonymize(parsed.rows);
      setStudents(anon);
      setIdentityMap(map);
      setFileName(file.name);
      setWarnings(parsed.warnings);
      setNumClasses(Math.max(2, Math.ceil(anon.length / 28)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.");
    }
  }

  function moveCriterion(i: number, dir: -1 | 1) {
    setCriteria((cs) => {
      const next = [...cs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cs;
      [next[i], next[j]] = [next[j], next[i]];
      // Gewichte an neue Reihenfolge angleichen (absteigend)
      const weights = [...next].map((c) => c.weight).sort((a, b) => b - a);
      return next.map((c, k) => ({ ...c, weight: weights[k] }));
    });
  }

  function solve() {
    if (!students) return;
    setSolving(true);
    setTimeout(() => {
      const params = {
        numClasses,
        maxSchoolBlock,
        maxWishGroup,
        bundleChoir,
        criteria,
        extraRules,
      };
      const result = solveBest(students, params, 4, seed);
      setAssignment(result);
      setSolving(false);
    }, 30);
  }

  async function askAi() {
    if (!students) return;
    setAiLoading(true);
    setAiError("");
    try {
      // Kontext: Geschwistergruppen (gleicher Nachname) + Basisdaten der Fälle
      const byLastName = new Map<string, string[]>();
      for (const [code, id] of Object.entries(identityMap)) {
        const key = id.nachname.toLowerCase();
        (byLastName.get(key) ?? byLastName.set(key, []).get(key)!).push(code);
      }
      const siblingGroups = [...byLastName.values()].filter((g) => g.length > 1);
      const caseCodes = new Set(decisionCases.map((c) => c.code));
      const context = [
        `${students.length} Schüler, ${numClasses} Klassen geplant.`,
        `Gruppen mit gleichem Nachnamen (mögliche Geschwister/Zwillinge): ${
          siblingGroups.map((g) => g.join("+")).join(", ") || "keine"
        }`,
        `Daten der betroffenen Schüler:`,
        ...students
          .filter((s) => caseCodes.has(s.code))
          .map(
            (s) =>
              `${s.code}: ${s.geschlecht ?? "?"}, Ø ${s.schnitt ?? "?"}, ${
                s.fremdsprache ?? "?"
              }, GS ${s.grundschule ?? "?"}, Wünsche: ${s.wuensche.join("/") || "-"}`
          ),
      ].join("\n");

      const res = await fetch("/api/ai-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          cases: decisionCases,
          context,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unbekannter Fehler");
      setAiSuggestions(data.suggestions ?? []);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "KI-Anfrage fehlgeschlagen.");
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion(s: AiSuggestion) {
    if (s.action === "none" || s.codes.length < 2) return;
    setExtraRules((rules) => [
      ...rules,
      { type: s.action as "mustWith" | "notWith", codes: s.codes, reason: s.reason },
    ]);
    setAiSuggestions((list) => list?.filter((x) => x !== s) ?? null);
  }

  function exportXlsx() {
    if (!students || !assignment) return;
    const wb = buildWorkbook(students, assignment, identityMap, numClasses);
    downloadWorkbook(wb, `Klasseneinteilung_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function downloadMapping() {
    const blob = new Blob([JSON.stringify(identityMap, null, 1)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "anonymisierungs-schluessel.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const stats = useMemo(
    () => (students && assignment ? classStats(students, assignment, numClasses) : null),
    [students, assignment, numClasses]
  );

  return (
    <main>
      <h1>
        Klasseneinteilung <em>Jgst. 5</em>
      </h1>
      <p className="subtitle">
        Excel hochladen, Kriterien gewichten, fertige Einteilung als Excel erhalten.
      </p>
      <div className="privacy">
        🔒 <strong>Datenschutz:</strong> Die Excel-Datei wird ausschließlich in deinem Browser
        verarbeitet. Namen und E-Mail-Adressen werden sofort durch Codes (S001 …) ersetzt und
        verlassen deinen Rechner nie. Auch die optionale KI-Analyse erhält nur anonymisierte
        Daten. Der Schlüssel zur De-Anonymisierung bleibt lokal — Export und Anzeige mit echten
        Namen passieren nur hier im Browser.
      </div>

      {/* 1. Upload */}
      <section className="card">
        <h2>1. Anmeldeliste hochladen</h2>
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
        >
          {students ? (
            <>
              <strong>{fileName}</strong> — {students.length} Schüler eingelesen und
              anonymisiert (S001–S{String(students.length).padStart(3, "0")}).
              <br />
              <span className="note">Klicken, um eine andere Datei zu laden.</span>
            </>
          ) : (
            <>
              <strong>Excel-Datei hier ablegen</strong> oder klicken zum Auswählen.
              <br />
              <span className="note">
                Erwartet wird ein Blatt mit Spalten wie Nachname, Rufname, Geschlecht, Noten,
                2. Fremdsprache, Grundschule, Wunschpartner, Bemerkung.
              </span>
            </>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        {error && <div className="error">{error}</div>}
        {warnings.map((w) => (
          <p key={w} className="note warn">
            ⚠️ {w}
          </p>
        ))}
        {students && (
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="small" onClick={downloadMapping}>
              🔑 Anonymisierungs-Schlüssel herunterladen (Code → Name, bleibt lokal)
            </button>
            <label className="note">
              <input
                type="checkbox"
                checked={showNames}
                onChange={(e) => setShowNames(e.target.checked)}
              />{" "}
              Echte Namen anzeigen (nur lokal)
            </label>
          </div>
        )}
      </section>

      {/* 2. Parameter */}
      {students && (
        <section className="card">
          <h2>2. Parameter &amp; Priorisierung</h2>
          <div className="row">
            <label>
              Anzahl Klassen{" "}
              <input
                type="number"
                min={2}
                max={8}
                value={numClasses}
                onChange={(e) => setNumClasses(Number(e.target.value))}
              />
            </label>
            <label>
              Max. Block pro Grundschule{" "}
              <input
                type="number"
                min={2}
                max={20}
                value={maxSchoolBlock}
                onChange={(e) => setMaxSchoolBlock(Number(e.target.value))}
              />
            </label>
            <label>
              Max. Wunschgruppe{" "}
              <input
                type="number"
                min={2}
                max={10}
                value={maxWishGroup}
                onChange={(e) => setMaxWishGroup(Number(e.target.value))}
              />
            </label>
            <label className="note">
              <input
                type="checkbox"
                checked={bundleChoir}
                onChange={(e) => {
                  setBundleChoir(e.target.checked);
                  setCriteria((cs) =>
                    cs.map((c) => (c.id === "choir" ? { ...c, enabled: e.target.checked } : c))
                  );
                }}
              />{" "}
              Chorklasse bündeln
            </label>
          </div>
          <p className="note" style={{ margin: "1rem 0 0.25rem" }}>
            Reihenfolge = Priorität (aus dem Ablaufzettel „Klassenbildung“). Mit ▲▼ umsortieren,
            Gewicht fein justieren, Haken entfernt ein Kriterium.
          </p>
          <div>
            {criteria.map((c, i) => (
              <div key={c.id} className={`criterion ${c.enabled ? "" : "disabled"}`}>
                <div className="ordbtns">
                  <button onClick={() => moveCriterion(i, -1)} title="wichtiger">
                    ▲
                  </button>
                  <button onClick={() => moveCriterion(i, 1)} title="unwichtiger">
                    ▼
                  </button>
                </div>
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) =>
                    setCriteria((cs) =>
                      cs.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x))
                    )
                  }
                />
                <div>
                  <div className="label">
                    {i + 1}. {c.label}
                  </div>
                  <div className="desc">{c.description}</div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={c.weight}
                  disabled={!c.enabled}
                  onChange={(e) =>
                    setCriteria((cs) =>
                      cs.map((x) =>
                        x.id === c.id ? { ...x, weight: Number(e.target.value) } : x
                      )
                    )
                  }
                />
                <span className="mono">{c.weight}</span>
              </div>
            ))}
          </div>

          {extraRules.length > 0 && (
            <>
              <p className="note" style={{ margin: "1rem 0 0.25rem" }}>
                Zusatzregeln (aus Entscheidungsfällen / KI-Vorschlägen):
              </p>
              {extraRules.map((r, i) => (
                <div key={i} className="rule">
                  <span>
                    {r.type === "mustWith" ? "🤝 zusammen" : r.type === "notWith" ? "🚫 getrennt" : "📌 fest"}
                    : <span className="mono">{r.codes.map(name).join(" + ")}</span> — {r.reason}
                  </span>
                  <button
                    className="small"
                    onClick={() => setExtraRules((rs) => rs.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </>
          )}

          <div className="row" style={{ marginTop: "1.25rem" }}>
            <button className="primary" onClick={solve} disabled={solving}>
              {solving ? "Berechne …" : assignment ? "Neu berechnen" : "Einteilung berechnen"}
            </button>
            {assignment && (
              <button
                onClick={() => {
                  setSeed((s) => s + 13);
                  solve();
                }}
              >
                🎲 Alternative Lösung
              </button>
            )}
          </div>
        </section>
      )}

      {/* 3. Entscheidungsfälle */}
      {students && decisionCases.length > 0 && (
        <section className="card">
          <h2>3. Entscheidungsfälle ({decisionCases.length})</h2>
          <p className="note">
            Diese Fälle kann die Programmlogik nicht allein entscheiden. Lass sie von der KI
            analysieren (es werden nur anonymisierte Daten übertragen) oder entscheide manuell.
          </p>
          {decisionCases.map((c, i) => (
            <div key={i} className="case">
              <span className="kind">
                {c.kind === "bemerkung"
                  ? "Bemerkung"
                  : c.kind === "offenerWunsch"
                    ? "Offener Wunsch"
                    : c.kind === "offenesNichtMit"
                      ? "Offenes „nicht mit“"
                      : "Fehlende Daten"}
              </span>{" "}
              — <strong>{name(c.code)}</strong>: {deanonText(c.text)}
            </div>
          ))}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <input
              type="password"
              placeholder="Anthropic API-Key (optional, bleibt im Browser)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ minWidth: "20rem" }}
            />
            <button onClick={askAi} disabled={aiLoading}>
              {aiLoading ? "KI analysiert …" : "🤖 KI-Empfehlungen einholen"}
            </button>
          </div>
          {aiError && <div className="error">{aiError}</div>}
          {aiSuggestions && (
            <div style={{ marginTop: "0.75rem" }}>
              {aiSuggestions.length === 0 && <p className="note">Keine Vorschläge.</p>}
              {aiSuggestions.map((s, i) => (
                <div key={i} className="rule">
                  <span>
                    {s.action === "mustWith" ? "🤝" : s.action === "notWith" ? "🚫" : "ℹ️"}{" "}
                    <span className="mono">{s.codes.map(name).join(" + ")}</span> — {s.reason}
                  </span>
                  {s.action !== "none" && s.codes.length >= 2 ? (
                    <button className="small" onClick={() => applySuggestion(s)}>
                      Übernehmen
                    </button>
                  ) : (
                    <span className="note">manuell prüfen</span>
                  )}
                </div>
              ))}
              {aiSuggestions.some((s) => s.action !== "none" && s.codes.length >= 2) && (
                <button
                  className="small"
                  onClick={() =>
                    aiSuggestions
                      .filter((s) => s.action !== "none" && s.codes.length >= 2)
                      .forEach(applySuggestion)
                  }
                >
                  Alle übernehmen
                </button>
              )}
              <p className="note">Nach dem Übernehmen „Neu berechnen“ klicken.</p>
            </div>
          )}
        </section>
      )}

      {/* 4. Ergebnis */}
      {students && assignment && stats && (
        <section className="card">
          <h2>4. Ergebnis</h2>
          <table className="summary">
            <thead>
              <tr>
                <th>Klasse</th>
                <th>Schüler</th>
                <th>m / w</th>
                <th>Latein / Franz.</th>
                <th>Ø Übertritt</th>
                <th>Chor</th>
                <th>Unerfüllte Wünsche</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((st, k) => (
                <tr key={k}>
                  <td>
                    <strong>{CLASS_LABELS[k]}</strong>
                  </td>
                  <td>{st.size}</td>
                  <td>
                    {st.m} / {st.w}
                  </td>
                  <td>
                    {st.latein} / {st.franz}
                  </td>
                  <td>{st.avg ?? "–"}</td>
                  <td>{st.chor}</td>
                  <td className={st.unfulfilledWishes.length ? "warn" : "ok"}>
                    {st.unfulfilledWishes.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.some((s) => s.notWithViolations.length > 0) && (
            <div className="error">
              ⚠️ „Nicht mit“-Konflikte:{" "}
              {stats
                .flatMap((s) => s.notWithViolations)
                .map(([a, b]) => `${name(a)} + ${name(b)}`)
                .join(", ")}
            </div>
          )}
          <div className="classes" style={{ marginTop: "1rem" }}>
            {stats.map((st, k) => (
              <div key={k} className="classcard">
                <h3>
                  Klasse {CLASS_LABELS[k]} <span className="size">{st.size} Schüler</span>
                </h3>
                <div className="stats">
                  {st.m} ♂ / {st.w} ♀ · Ø {st.avg ?? "–"} · L {st.latein} / F {st.franz}
                  {st.chor > 0 && <> · 🎵 {st.chor}</>}
                  <br />
                  {st.schools.map(([s, c]) => `${s} (${c})`).join(", ")}
                </div>
                <div className="pupils">
                  {students
                    .filter((s) => assignment.classOf[s.code] === k)
                    .map((s) => (
                      <span
                        key={s.code}
                        className={`pupil ${
                          st.unfulfilledWishes.includes(s.code) ? "unhappy" : ""
                        } ${s.fremdsprache === "L" ? "latein" : ""}`}
                        title={`${s.geschlecht ?? "?"} · Ø ${s.schnitt ?? "?"} · ${
                          s.grundschule ?? "?"
                        }${st.unfulfilledWishes.includes(s.code) ? " · Wunsch unerfüllt" : ""}`}
                      >
                        {name(s.code)}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: "1.25rem" }}>
            <button className="primary" onClick={exportXlsx}>
              📥 Excel exportieren (mit echten Namen)
            </button>
            <span className="note">
              Enthält Gesamtliste, ein Blatt pro Klasse und Statistik. De-Anonymisierung passiert
              beim Export in deinem Browser.
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
