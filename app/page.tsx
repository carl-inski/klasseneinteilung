"use client";

// Ablauf: Upload -> (Spalten prüfen) -> KI-Namensabgleich -> Parameter/Kriterien
// -> Einteilung -> Entscheidungsfälle -> Export.
// Anonymisierung passiert im Browser; Klarnamen bleiben lokal (identityMap).

import { useCallback, useMemo, useRef, useState } from "react";
import { parseWorkbook, type Table } from "@/lib/parse";
import { anonymize, norm } from "@/lib/anonymize";
import { buildConfig } from "@/lib/config";
import { solveBest, classStats } from "@/lib/solver";
import { findDecisionCases } from "@/lib/decisions";
import { buildWorkbook, downloadWorkbook } from "@/lib/exportXlsx";
import { classLabel } from "@/lib/types";
import type {
  Assignment,
  Column,
  Config,
  Criterion,
  IdentityMap,
  Role,
  Student,
} from "@/lib/types";

const ROLE_OPTIONS: { role: Role; label: string }[] = [
  { role: "ignore", label: "— ignorieren —" },
  { role: "lastName", label: "Nachname" },
  { role: "firstName", label: "Vorname" },
  { role: "fullName", label: "Voller Name" },
  { role: "email", label: "E-Mail" },
  { role: "wish", label: "Wunschpartner" },
  { role: "avoid", label: "Nicht mit …" },
  { role: "balance", label: "Gleich verteilen (Kategorie)" },
  { role: "concentrate", label: "Bündeln (Kategorie-Wert)" },
  { role: "spread", label: "Heterogen verteilen (Zahl)" },
  { role: "mix", label: "Mischen / Herkunft" },
  { role: "cluster", label: "Cluster-Klasse (hart, z. B. Chor)" },
  { role: "note", label: "Bemerkung" },
];

interface NameMatch { mention: string; code: string; confidence: string }
interface AiSuggestion { codes: string[]; action: "mustWith" | "notWith" | "none"; reason: string }

export default function Home() {
  const [table, setTable] = useState<Table | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [students, setStudents] = useState<Student[]>([]);
  const [identityMap, setIdentityMap] = useState<IdentityMap>({});
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);

  const [fileName, setFileName] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showMapping, setShowMapping] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [drag, setDrag] = useState(false);
  const [solving, setSolving] = useState(false);
  const [seed, setSeed] = useState(1);

  const [apiKey, setApiKey] = useState("");
  const [namesLoading, setNamesLoading] = useState(false);
  const [namesError, setNamesError] = useState("");
  const [nameResult, setNameResult] = useState<{ applied: number; roster: number } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[] | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  const nameOf = useCallback(
    (code: string): string => {
      if (!showNames) return code;
      const id = identityMap[code];
      return id ? id.full : code;
    },
    [showNames, identityMap]
  );
  const deanonText = useCallback(
    (text: string): string =>
      showNames
        ? text.replace(/S\d{3}/g, (c) => identityMap[c]?.full ?? c)
        : text,
    [showNames, identityMap]
  );

  function reanon(cols: Column[], corr: Record<string, string>) {
    if (!table) return null;
    const res = anonymize(table, cols, corr);
    setStudents(res.students);
    setIdentityMap(res.identityMap);
    setUnresolved(res.unresolved);
    return res;
  }

  async function handleFile(file: File) {
    setError("");
    setAssignment(null);
    setAiSuggestions(null);
    setNameResult(null);
    setCorrections({});
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      setTable(parsed.table);
      setColumns(parsed.columns);
      setWarnings(parsed.warnings);
      setFileName(file.name);
      const res = anonymize(parsed.table, parsed.columns, {});
      setStudents(res.students);
      setIdentityMap(res.identityMap);
      setUnresolved(res.unresolved);
      const num = Math.max(2, Math.round(res.students.length / 25));
      setConfig(buildConfig(parsed.columns, res.students, num));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.");
      setTable(null);
    }
  }

  function updateColumnRole(index: number, role: Role) {
    const next = columns.map((c, i) => (i === index ? { ...c, role } : c));
    setColumns(next);
    const res = reanon(next, corrections);
    if (res && config) setConfig(buildConfig(next, res.students, config.numClasses));
    setAssignment(null);
  }

  async function runNameMatch() {
    if (!students.length) return;
    setNamesLoading(true);
    setNamesError("");
    try {
      const roster = Object.entries(identityMap)
        .filter(([, id]) => id.full.trim())
        .map(([code, id]) => ({ code, name: id.full }));
      const mentionSet = new Set<string>();
      for (const s of students) for (const m of [...s.wishesRaw, ...s.avoidRaw]) mentionSet.add(m);
      const mentions = [...mentionSet];
      const res = await fetch("/api/ai-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey || undefined, roster, mentions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unbekannter Fehler");
      const matches: NameMatch[] = data.matches ?? [];
      const codes = new Set(roster.map((r) => r.code));
      const corr: Record<string, string> = { ...corrections };
      let applied = 0;
      for (const m of matches) {
        if (m.code && codes.has(m.code) && (m.confidence === "hoch" || m.confidence === "mittel")) {
          corr[norm(m.mention)] = m.code;
          applied++;
        }
      }
      setCorrections(corr);
      reanon(columns, corr);
      setNameResult({ applied, roster: roster.length });
      setAssignment(null);
    } catch (e) {
      setNamesError(e instanceof Error ? e.message : "Namensabgleich fehlgeschlagen.");
    } finally {
      setNamesLoading(false);
    }
  }

  // --- Config-Helfer ---
  const setNum = (numClasses: number) => config && setConfig({ ...config, numClasses });
  const setPrefix = (classPrefix: string) => config && setConfig({ ...config, classPrefix });
  const setCrit = (id: string, patch: Partial<Criterion>) =>
    config &&
    setConfig({ ...config, criteria: config.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  function moveCrit(id: string, dir: -1 | 1) {
    if (!config) return;
    const cs = [...config.criteria].sort((a, b) => b.weight - a.weight);
    const i = cs.findIndex((c) => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= cs.length) return;
    [cs[i], cs[j]] = [cs[j], cs[i]];
    const weights = config.criteria.map((c) => c.weight).sort((a, b) => b - a);
    const reweighted = cs.map((c, k) => ({ ...c, weight: weights[k] }));
    setConfig({ ...config, criteria: reweighted });
  }
  const setCluster = (i: number, patch: Partial<Config["clusters"][number]>) =>
    config && setConfig({ ...config, clusters: config.clusters.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  function solve() {
    if (!students.length || !config) return;
    setSolving(true);
    setTimeout(() => {
      setAssignment(solveBest(students, config, 5, seed));
      setSolving(false);
    }, 30);
  }

  function applySuggestion(s: AiSuggestion) {
    if (!config || s.action === "none" || s.codes.length < 2) return;
    setConfig({
      ...config,
      extraRules: [...config.extraRules, { type: s.action, codes: s.codes, reason: s.reason }],
    });
    setAiSuggestions((l) => l?.filter((x) => x !== s) ?? null);
  }

  async function askDecisions() {
    if (!students.length || !config) return;
    setAiLoading(true);
    setAiError("");
    try {
      const byLast = new Map<string, string[]>();
      for (const [code, id] of Object.entries(identityMap)) {
        const key = id.lastName.toLowerCase();
        if (key) (byLast.get(key) ?? byLast.set(key, []).get(key)!).push(code);
      }
      const siblings = [...byLast.values()].filter((g) => g.length > 1);
      const caseCodes = new Set(cases.map((c) => c.code));
      const spreadH = config.columns.find((c) => c.role === "spread")?.header;
      const balanceH = config.columns.find((c) => c.role === "balance")?.header;
      const context = [
        `${students.length} Schüler, ${config.numClasses} Klassen.`,
        `Gruppen mit gleichem Nachnamen (mögliche Geschwister): ${siblings.map((g) => g.join("+")).join(", ") || "keine"}`,
        "Daten der betroffenen Schüler:",
        ...students
          .filter((s) => caseCodes.has(s.code))
          .map(
            (s) =>
              `${s.code}: ${balanceH ? s.attrs[balanceH] ?? "?" : ""} ${spreadH ? "Ø" + (s.attrs[spreadH] ?? "?") : ""} Wünsche: ${s.wishes.join("/") || "-"}`
          ),
      ].join("\n");
      const res = await fetch("/api/ai-decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey || undefined, cases, context }),
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

  function exportXlsx() {
    if (!students.length || !config || !assignment) return;
    const wb = buildWorkbook(students, config, assignment, identityMap);
    downloadWorkbook(wb, `Klasseneinteilung_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function downloadMapping() {
    const blob = new Blob([JSON.stringify(identityMap, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "anonymisierungs-schluessel.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const cases = useMemo(
    () => (students.length && config ? findDecisionCases(students, config.columns) : []),
    [students, config]
  );
  const stats = useMemo(
    () => (students.length && config && assignment ? classStats(students, config, assignment) : null),
    [students, config, assignment]
  );
  const criteriaSorted = useMemo(
    () => (config ? [...config.criteria].sort((a, b) => b.weight - a.weight) : []),
    [config]
  );
  const totalWishers = useMemo(() => students.filter((s) => s.wishes.length).length, [students]);
  const wishedCount = useMemo(() => students.reduce((a, s) => a + s.wishesRaw.length, 0), [students]);

  const loaded = !!table && !!config;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="logo">◧</span>
            <span>
              Klasseneinteilung
              <small>Anonymisiert · KI-gestützt</small>
            </span>
          </div>
          <span className="spacer" />
          {loaded && <span className="pill">{students.length} Schüler · {fileName}</span>}
        </div>
      </header>

      <main>
        <h1>Klassen fair und regelbasiert einteilen</h1>
        <p className="subtitle">
          Anmeldeliste hochladen, Namen per KI abgleichen, Kriterien priorisieren — und die fertige
          Einteilung als Excel exportieren. Funktioniert mit beliebigen Klassenlisten.
        </p>

        <div className="privacy">
          <span>🔒</span>
          <span>
            <strong>Datenschutz.</strong> Die Datei wird nur in deinem Browser verarbeitet. Namen und
            E-Mails werden sofort durch Codes (S001 …) ersetzt. Für den KI-Namensabgleich wird nur die
            Namensliste übertragen (ohne Noten, Geschlecht, Bemerkungen); die Einteilung selbst läuft
            komplett anonymisiert. Der Schlüssel bleibt lokal.
          </span>
        </div>

        {loaded && (
          <div className="stats-row">
            <div className="tile">
              <div className="k">Schüler</div>
              <div className="v">{students.length}</div>
            </div>
            <div className="tile">
              <div className="k">Klassen</div>
              <div className="v">{config!.numClasses}</div>
              <div className="sub">Ø {(students.length / config!.numClasses).toFixed(1)} pro Klasse</div>
            </div>
            <div className="tile">
              <div className="k">Wunsch-Nennungen</div>
              <div className="v">{wishedCount}</div>
              <div className="sub">{unresolved.length} nicht zugeordnet</div>
            </div>
            <div className="tile">
              <div className="k">Entscheidungsfälle</div>
              <div className="v">{cases.length}</div>
            </div>
          </div>
        )}

        {/* 1. Upload */}
        <section className="card">
          <div className="card-head no-border">
            <span className={`step-no ${loaded ? "done" : ""}`}>1</span>
            <div>
              <h2>Anmeldeliste hochladen</h2>
              <div className="h-sub">Excel (.xlsx) — Spalten werden automatisch erkannt</div>
            </div>
          </div>
          <div className="card-body">
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
              {loaded ? (
                <>
                  <span className="icon">✓</span>
                  <strong>{fileName}</strong> — {students.length} Schüler anonymisiert.
                  <br />
                  <span className="note">Klicken, um eine andere Datei zu laden.</span>
                </>
              ) : (
                <>
                  <span className="icon">⬆</span>
                  <strong>Excel-Datei ablegen</strong> oder klicken.
                  <br />
                  <span className="note">Erkannt werden u. a. Name, Geschlecht, Noten, Fremdsprache, Grundschule, Chor, Wunschpartner.</span>
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
              <p key={w} className="note warn">⚠️ {w}</p>
            ))}

            {loaded && (
              <>
                <div className="row" style={{ marginTop: "0.9rem" }}>
                  <button className="small" onClick={() => setShowMapping((v) => !v)}>
                    {showMapping ? "▲ Spaltenzuordnung ausblenden" : "▾ Spaltenzuordnung prüfen/ändern"}
                  </button>
                  <button className="small" onClick={downloadMapping}>🔑 Schlüssel herunterladen</button>
                  <label className="toggle">
                    <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
                    Echte Namen anzeigen
                  </label>
                </div>
                {showMapping && (
                  <div style={{ marginTop: "0.9rem" }}>
                    <p className="note" style={{ marginBottom: "0.5rem" }}>
                      Passe an, welche Rolle jede Spalte hat. So funktioniert das Tool mit beliebigen
                      Tabellen.
                    </p>
                    <div className="maptable">
                      {columns.map((c, i) => (
                        <div key={i} style={{ display: "contents" }}>
                          <span className="h" title={c.header}>{c.header || `Spalte ${i + 1}`}</span>
                          <select value={c.role} onChange={(e) => updateColumnRole(i, e.target.value as Role)}>
                            {ROLE_OPTIONS.map((o) => (
                              <option key={o.role} value={o.role}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* 2. KI-Namensabgleich */}
        {loaded && (
          <section className="card">
            <div className="card-head">
              <span className={`step-no ${nameResult ? "done" : ""}`}>2</span>
              <div>
                <h2>Namen per KI abgleichen</h2>
                <div className="h-sub">Falsch geschriebene Wunschpartner den echten Kindern zuordnen</div>
              </div>
              <span className="spacer" />
            </div>
            <div className="card-body">
              <p className="note" style={{ marginBottom: "0.75rem" }}>
                Eltern schreiben Namen oft falsch. Die KI vergleicht alle Wunsch-/„nicht mit“-Nennungen
                mit der echten Namensliste und korrigiert sie — damit der Algorithmus die Wünsche
                richtig zuordnet. Übertragen wird nur die Namensliste, keine sensiblen Daten.
              </p>
              <div className="row">
                <input
                  type="password"
                  placeholder="Anthropic API-Key (optional, bleibt im Browser)"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{ minWidth: "18rem", flex: 1 }}
                />
                <button className="primary" onClick={runNameMatch} disabled={namesLoading}>
                  {namesLoading ? <><span className="spin" />Gleiche ab …</> : "🤖 Namen abgleichen"}
                </button>
              </div>
              {namesError && <div className="error">{namesError}</div>}
              {nameResult && (
                <p className="note ok" style={{ marginTop: "0.6rem" }}>
                  ✓ {nameResult.applied} Nennungen korrigiert/bestätigt. Noch {unresolved.length} unklar.
                </p>
              )}
              {!nameResult && unresolved.length > 0 && (
                <p className="note" style={{ marginTop: "0.6rem" }}>
                  Ohne KI aktuell {unresolved.length} nicht zugeordnete Nennungen (lokale Fuzzy-Suche).
                </p>
              )}
            </div>
          </section>
        )}

        {/* 3. Parameter */}
        {loaded && (
          <section className="card">
            <div className="card-head">
              <span className={`step-no ${assignment ? "done" : ""}`}>3</span>
              <div>
                <h2>Parameter &amp; Priorisierung</h2>
                <div className="h-sub">Harte Regeln stehen fest, weiche Kriterien sind gewichtbar</div>
              </div>
            </div>
            <div className="card-body">
              <div className="row" style={{ marginBottom: "1rem" }}>
                <label className="field">
                  Anzahl Klassen (fest)
                  <input type="number" min={2} max={12} value={config!.numClasses}
                    onChange={(e) => setNum(Math.max(2, Number(e.target.value)))} />
                </label>
                <label className="field">
                  Klassen-Präfix
                  <input type="text" value={config!.classPrefix} style={{ width: "4rem" }}
                    onChange={(e) => setPrefix(e.target.value)} />
                </label>
                <label className="toggle" style={{ alignSelf: "flex-end", paddingBottom: "0.4rem" }}>
                  <input type="checkbox" checked={config!.balanceSizes}
                    onChange={(e) => setConfig({ ...config!, balanceSizes: e.target.checked })} />
                  Klassengrößen ausgleichen
                </label>
              </div>

              <div className="hardline">
                <strong>Harte Regeln:</strong>
                <span>genau {config!.numClasses} Klassen</span>
                {config!.balanceSizes && <span>· Größe ± 1 ({Math.floor(students.length / config!.numClasses)}–{Math.ceil(students.length / config!.numClasses)})</span>}
                {config!.clusters.map((cl) => (
                  <span key={cl.header}>· alle „{cl.value}“ in {cl.label} zusammen</span>
                ))}
                {config!.criteria.some((c) => c.kind === "avoid" && c.hard && c.enabled) && <span>· „nicht mit“ wird erzwungen</span>}
              </div>

              {config!.clusters.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <p className="note" style={{ marginBottom: "0.4rem" }}>Cluster-Klassen (überstimmen Wünsche):</p>
                  {config!.clusters.map((cl, i) => (
                    <div key={cl.header} className="row" style={{ marginBottom: "0.4rem" }}>
                      <span className="badge hard">Cluster</span>
                      <span style={{ fontSize: "0.9rem" }}>{cl.label}</span>
                      <label className="field">
                        Wert
                        <input type="text" value={cl.value} style={{ width: "5rem" }}
                          onChange={(e) => { setCluster(i, { value: e.target.value }); setAssignment(null); }} />
                      </label>
                      <label className="field">
                        Anz. Klassen
                        <input type="number" min={1} max={config!.numClasses}
                          value={cl.classes ?? ""} placeholder="auto" style={{ width: "5rem" }}
                          onChange={(e) => { setCluster(i, { classes: e.target.value ? Number(e.target.value) : null }); setAssignment(null); }} />
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <p className="note" style={{ marginBottom: "0.25rem" }}>
                Weiche Kriterien — Reihenfolge = Priorität. ▲▼ sortieren, Regler gewichtet, Haken schaltet ab.
              </p>
              <div>
                {criteriaSorted.map((c, i) => (
                  <div key={c.id} className={`criterion ${c.enabled ? "" : "off"}`}>
                    <div className="ord">
                      <button onClick={() => moveCrit(c.id, -1)} disabled={i === 0}>▲</button>
                      <button onClick={() => moveCrit(c.id, 1)} disabled={i === criteriaSorted.length - 1}>▼</button>
                    </div>
                    <div>
                      <div className="label">
                        <input type="checkbox" checked={c.enabled} style={{ marginRight: "0.4rem" }}
                          onChange={(e) => setCrit(c.id, { enabled: e.target.checked })} />
                        {c.label}
                      </div>
                      <div className="desc">{c.description}</div>
                    </div>
                    {c.kind === "avoid" ? (
                      <span className={`badge ${c.hard ? "hard" : "soft"}`} style={{ cursor: "pointer" }}
                        onClick={() => setCrit(c.id, { hard: !c.hard })} title="Umschalten hart/weich">
                        {c.hard ? "hart" : "weich"}
                      </span>
                    ) : (
                      <span className="badge soft">weich</span>
                    )}
                    <input type="range" min={0} max={100} value={c.weight} disabled={!c.enabled}
                      onChange={(e) => setCrit(c.id, { weight: Number(e.target.value) })} />
                    <span className="mono" style={{ width: "2ch", textAlign: "right" }}>{c.weight}</span>
                  </div>
                ))}
              </div>

              {config!.extraRules.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <p className="note" style={{ marginBottom: "0.4rem" }}>Zusatzregeln:</p>
                  {config!.extraRules.map((r, i) => (
                    <div key={i} className="rule">
                      <span>
                        {r.type === "mustWith" ? "🤝 zusammen" : "🚫 getrennt"}:{" "}
                        <span className="mono">{r.codes.map(nameOf).join(" + ")}</span> — {r.reason}
                      </span>
                      <button className="small" onClick={() => setConfig({ ...config!, extraRules: config!.extraRules.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 4. Entscheidungsfälle */}
        {loaded && cases.length > 0 && (
          <section className="card">
            <div className="card-head">
              <span className="step-no">4</span>
              <div>
                <h2>Entscheidungsfälle ({cases.length})</h2>
                <div className="h-sub">Was Logik nicht allein klärt — optional per KI</div>
              </div>
            </div>
            <div className="card-body">
              {cases.slice(0, 40).map((c, i) => (
                <div key={i} className="case">
                  <span className="kind">
                    {c.kind === "note" ? "Bemerkung" : c.kind === "openWish" ? "Offener Wunsch" : c.kind === "openAvoid" ? "Offenes „nicht mit“" : "Fehlende Daten"}
                  </span>{" "}
                  <strong>{nameOf(c.code)}</strong>: {deanonText(c.text)}
                </div>
              ))}
              {cases.length > 40 && <p className="note">… und {cases.length - 40} weitere.</p>}
              <div className="row" style={{ marginTop: "0.75rem" }}>
                <button onClick={askDecisions} disabled={aiLoading}>
                  {aiLoading ? <><span className="spin" />KI analysiert …</> : "🤖 KI-Empfehlungen einholen"}
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
                        <span className="mono">{s.codes.map(nameOf).join(" + ")}</span> — {s.reason}
                      </span>
                      {s.action !== "none" && s.codes.length >= 2 ? (
                        <button className="small" onClick={() => applySuggestion(s)}>Übernehmen</button>
                      ) : (
                        <span className="note">manuell</span>
                      )}
                    </div>
                  ))}
                  <p className="note">Nach dem Übernehmen erneut berechnen.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 5. Ergebnis */}
        {loaded && stats && assignment && (
          <section className="card">
            <div className="card-head">
              <span className="step-no done">5</span>
              <div>
                <h2>Ergebnis</h2>
                <div className="h-sub">Klasseneinteilung nach deinen Kriterien</div>
              </div>
            </div>
            <div className="card-body">
              {assignment.hardViolations.length > 0 && (
                <div className="error">
                  ⚠️ Harte Regeln nicht erfüllbar: {assignment.hardViolations.slice(0, 3).map((v) => deanonText(v)).join("; ")}
                  {assignment.hardViolations.length > 3 && ` (+${assignment.hardViolations.length - 3})`}
                </div>
              )}
              <div className="table-wrap">
                <table className="summary">
                  <thead>
                    <tr>
                      <th>Klasse</th>
                      <th>Schüler</th>
                      {[...stats[0].categories.keys()].map((h) => <th key={h}>{h}</th>)}
                      {[...stats[0].concentrates.keys()].map((h) => <th key={h}>{h}</th>)}
                      {[...stats[0].spreads.keys()].map((h) => <th key={h}>Ø {h}</th>)}
                      <th>Wünsche offen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((st, k) => (
                      <tr key={k} className={st.isCluster ? "cluster" : ""}>
                        <td><strong>{classLabel(config!.classPrefix, k)}</strong>{st.isCluster && <span className="tag">Cluster</span>}</td>
                        <td>{st.size}</td>
                        {[...st.categories.values()].map((cats, ci) => (
                          <td key={ci}>{cats.map(([v, c]) => `${v}: ${c}`).join(", ") || "–"}</td>
                        ))}
                        {[...st.concentrates.values()].map((cnt, ci) => <td key={ci}>{cnt}</td>)}
                        {[...st.spreads.values()].map((avg, ci) => <td key={ci}>{avg ?? "–"}</td>)}
                        <td className={st.unfulfilledWishes.length ? "warn" : "ok"}>{st.unfulfilledWishes.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="classes" style={{ marginTop: "1rem" }}>
                {stats.map((st, k) => (
                  <div key={k} className={`classcard ${st.isCluster ? "cluster" : ""}`}>
                    <h3>
                      <span>Klasse {classLabel(config!.classPrefix, k)}{st.isCluster && <span className="tag">Cluster</span>}</span>
                      <span className="size">{st.size} Schüler</span>
                    </h3>
                    <div className="meta">
                      {[...st.categories].map(([h, cats]) => `${h}: ${cats.map(([v, c]) => `${v} ${c}`).join(" / ")}`).join(" · ")}
                      {[...st.spreads].map(([h, avg]) => ` · Ø ${h} ${avg ?? "–"}`)}
                      {[...st.concentrates].map(([h, c]) => ` · ${h} ${c}`)}
                    </div>
                    <div className="pupils">
                      {students
                        .filter((s) => assignment.classOf[s.code] === k)
                        .map((s) => (
                          <span key={s.code}
                            className={`pupil ${st.unfulfilledWishes.includes(s.code) ? "unhappy" : ""}`}
                            title={st.unfulfilledWishes.includes(s.code) ? "Wunsch unerfüllt" : ""}>
                            {nameOf(s.code)}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="note ok" style={{ marginTop: "0.75rem" }}>
                {totalWishers - stats.reduce((a, s) => a + s.unfulfilledWishes.length, 0)} von {totalWishers} Wunsch-Kindern haben mind. einen Wunschpartner in ihrer Klasse.
              </p>
            </div>
          </section>
        )}
      </main>

      {loaded && (
        <div className="actionbar">
          <button className="primary" onClick={solve} disabled={solving}>
            {solving ? <><span className="spin" />Berechne …</> : assignment ? "Neu berechnen" : "Einteilung berechnen"}
          </button>
          {assignment && (
            <button onClick={() => { setSeed((s) => s + 13); solve(); }}>🎲 Alternative</button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          {assignment && <button className="primary" onClick={exportXlsx}>📥 Excel exportieren</button>}
        </div>
      )}
    </>
  );
}
