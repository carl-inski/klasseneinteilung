# Klasseneinteilung Jgst. 5

Web-Tool für die Klassenbildung der 5. Jahrgangsstufe: Anmelde-Excel hochladen,
Kriterien priorisieren, fertige Einteilung als Excel exportieren.

## Datenschutz-Konzept

- Die Excel-Datei wird **ausschließlich im Browser** geparst — sie wird nie hochgeladen.
- Namen und E-Mail-Adressen werden sofort durch Codes (`S001` …) ersetzt, auch in
  Freitextfeldern (Wunschpartner, „nicht mit“, Bemerkungen) inkl. Tippfehler-Toleranz.
- Der Solver und die optionale KI-Analyse arbeiten **nur mit anonymisierten Daten**.
- Der Schlüssel (Code → Name) bleibt im Browser-Speicher und kann als JSON
  heruntergeladen werden; De-Anonymisierung passiert nur lokal (Anzeige & Excel-Export).

## Generisches Spalten-/Rollen-Modell

Statt fest verdrahteter Spalten wird jede Spalte einer **Rolle** zugeordnet
(automatisch erkannt, im UI änderbar) — dadurch funktioniert das Tool mit
beliebigen Klassenlisten, nicht nur der 5. Jahrgangsstufe:

| Rolle | Bedeutung | Beispiel |
|---|---|---|
| `firstName`/`lastName`/`fullName` | Name (bleibt lokal) | Rufname, Nachname |
| `wish` / `avoid` | Wunschpartner / „nicht mit“ | Wunschpartner |
| `balance` | Kategorie gleich verteilen | Geschlecht |
| `concentrate` | Kategorie-Wert auf wenige Klassen bündeln | 2. Fremdsprache = Latein |
| `spread` | Zahl heterogen verteilen | Notenschnitt |
| `mix` | Herkunft mischen (Blöcke ≤ 8, kleine Gruppen zusammen) | Grundschule |
| `cluster` | **harte** Cluster-Klasse | Chorklasse = ja |
| `note` | Freitext-Bemerkung | Bemerkung |

## Harte vs. weiche Kriterien

**Harte Regeln** (strukturell erzwungen, überstimmen alle Wünsche):
- genau *K* Klassen (fest, z. B. 5)
- Klassengröße ausgeglichen (±1)
- **Cluster** (z. B. Chor): *alle* Kinder mit dem Cluster-Wert kommen in dedizierte
  Cluster-Klasse(n); ihre eigenen Wünsche werden dabei ignoriert, danach wird bis zur
  Klassengröße mit Nicht-Cluster-Kindern aufgefüllt.
- „nicht mit …“ (optional als hart schaltbar)

**Weiche Kriterien** (gewichtete Straffunktion, im UI priorisierbar): Wünsche erfüllen,
Geschlecht gleich verteilen, Grundschulen mischen, Fremdsprache bündeln, Noten heterogen.

## KI-Schritte

1. **Namensabgleich** (`/api/ai-names`): Eltern schreiben Wunschpartner oft falsch. Die KI
   gleicht alle Nennungen gegen die echte Namensliste ab und korrigiert sie, damit der
   Algorithmus die Wünsche richtig zuordnet. Übertragen wird **nur die Namensliste**
   (keine Noten/Geschlecht/Bemerkungen).
2. **Entscheidungsfälle** (`/api/ai-decide`): Bemerkungen, nicht zuordenbare Nennungen und
   fehlende Daten werden — anonymisiert (Codes) — analysiert; die KI schlägt Regeln vor
   (zusammen / getrennt / manuell), die per Klick übernommen werden.

Beide nutzen Claude (Anthropic API, `claude-opus-4-8`). API-Key: `ANTHROPIC_API_KEY` in
Vercel setzen oder im UI-Feld eintragen (nur pro Anfrage, nicht gespeichert).

## Solver

Heuristik in TypeScript (läuft im Browser):

1. **Cluster-Vorplatzierung** (hart): Cluster-Kinder werden auf die dedizierten
   Cluster-Klassen verteilt und fixiert.
2. **Wunschgruppen** (nur Nicht-Cluster) per größenbeschränkter Union-Find
   (gegenseitige Wünsche zuerst, max. 4, „nicht mit“-konfliktfrei).
3. **Greedy-Start** + **lokale Suche** (~50.000 Iterationen) minimiert die gewichtete
   Straffunktion; die Klassengröße ist eine harte Obergrenze bei jedem Zug.
4. Mehrere Starts, Lösung ohne harte Verletzung gewinnt.

Test mit echter Datei (Datei bleibt lokal): `npm test -- pfad/zur/datei.xlsx`

## Entwicklung

```bash
npm install
npm run dev    # http://localhost:3000
npm run build
npm test       # Solver-Test mit synthetischen Daten
```

## Deployment (Vercel)

Das Projekt ist eine Standard-Next.js-App. `vercel deploy` oder Git-Integration;
optional `ANTHROPIC_API_KEY` als Environment-Variable für die KI-Funktion setzen.

**Wichtig:** Echte Schülerdaten (`*Schulanmeldung*.xlsx`, `mapping*.json`) sind per
`.gitignore` ausgeschlossen und dürfen nie ins Repository.
