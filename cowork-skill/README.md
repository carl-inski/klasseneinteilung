# Cowork-Skill: Klasseneinteilung

Ein Claude-Skill, der dich **dialoggeführt, Schritt für Schritt** durch eine faire
Klasseneinteilung führt — statt starrer Formularfelder. Claude übernimmt das Verständnis
(Namen abgleichen, Sonderfälle klären, Kriterien mit dir priorisieren), eine deterministische
Python-Engine das Rechnen (anonymisieren, optimieren, exportieren). Ergebnis: eine fertige
Klasseneinteilung als Excel.

## Aufbau

```
klasseneinteilung/
├── SKILL.md                     # Ablauf/Orchestrierung (das liest Claude)
├── references/
│   └── kriterien.md             # Rollen- & Kriterien-Referenz
└── scripts/
    └── klasseneinteilung.py     # Engine: prep / solve / export (nur openpyxl nötig)
```

## Installieren

- **Claude Code / Cowork (Dateisystem):** Ordner `klasseneinteilung/` nach `~/.claude/skills/`
  (oder in den Skills-Ordner deines Projekts) kopieren. Claude erkennt den Skill automatisch anhand
  der `description` in `SKILL.md`, sobald du z. B. „Hilf mir bei der Klasseneinteilung" schreibst und
  eine Excel-Anmeldeliste anhängst.
- **Managed Agents / Skills-API:** den Ordner als Skill-Version hochladen und dem Agenten zuweisen.

## Benutzen

1. Skill installieren.
2. Neue Unterhaltung starten, Anmelde-Excel anhängen, sinngemäß sagen:
   *„Erstelle mir daraus eine Klasseneinteilung."*
3. Claude führt dich durch: Spalten bestätigen → Wunschnamen abgleichen → harte Regeln (Klassenzahl,
   Chor) → weiche Kriterien priorisieren → Sonderfälle → berechnen → verfeinern → Excel exportieren.
   Du entscheidest an jeder Stelle; das Endergebnis ist die fertige Einteilung.

## Datenschutz

Namen/E-Mails werden sofort zu Codes (`S001` …) anonymisiert; die Zuordnung (`mapping.json`) bleibt
lokal. Optimierung und Diskussion laufen auf Codes; echte Namen erscheinen nur in der Anzeige an
dich und im finalen Export.

## Engine direkt (optional, ohne Dialog)

```
python3 scripts/klasseneinteilung.py prep   liste.xlsx --work ke_arbeit
# ke_arbeit/config.json anpassen (Kriterien, Korrekturen, Regeln)
python3 scripts/klasseneinteilung.py solve  --work ke_arbeit
python3 scripts/klasseneinteilung.py export --work ke_arbeit --out Klasseneinteilung.xlsx
```

Dieselbe Logik läuft auch als Website: https://klasseneinteilung.vercel.app
