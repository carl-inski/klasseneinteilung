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

## Kriterien (aus dem Ablaufzettel „Klassenbildung“)

1. Sonderwünsche „nicht mit …“ (hart)
2. Wunschpartner erfüllen (mind. einer pro Kind)
3. Keine Wunschketten — Gruppen max. 4
4. Gleichmäßige Verteilung m/w
5. Grundschulen mischen, keine Blöcke > 8
6. Möglichst wenige Klassen mit Latein (2. Fremdsprache)
7. Übertrittsnoten heterogen
8. Nachbarkinder (kleine Grundschulgruppen) beisammen lassen

Reihenfolge und Gewichte sind in der Web-Oberfläche anpassbar; zusätzlich:
Klassenanzahl, max. Grundschulblock, max. Wunschgruppengröße, Chorklasse bündeln.

## Entscheidungsfälle & KI

Fälle, die Programmlogik nicht lösen kann (Bemerkungen wie „mit Zwillingsschwester in
eine Klasse“, nicht zuordenbare Wunschnennungen, fehlende Daten), werden aufgelistet.
Optional analysiert Claude (`/api/ai-decide`, Anthropic API) die anonymisierten Fälle
und schlägt Regeln vor (zusammen / getrennt / manuell prüfen), die per Klick übernommen
und neu berechnet werden.

API-Key: entweder `ANTHROPIC_API_KEY` als Umgebungsvariable (z. B. in Vercel) setzen
oder im UI-Feld eintragen (wird nur für die eine Anfrage verwendet, nicht gespeichert).

## Solver

Heuristik in TypeScript (läuft im Browser):

1. Wunschgruppen per größenbeschränkter Union-Find (gegenseitige Wünsche zuerst,
   Kettenbegrenzung, „nicht mit“-konfliktfrei).
2. Greedy-Startverteilung der Gruppen.
3. Lokale Suche (~40.000 Iterationen, Verschieben/Tauschen/gezielte
   Latein-Konsolidierung) minimiert die gewichtete Straffunktion.
4. Mehrere Starts, bestes Ergebnis gewinnt; „Alternative Lösung“ nutzt neuen Seed.

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
