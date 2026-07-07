---
name: klasseneinteilung
description: >-
  Erstellt dialoggeführt, Schritt für Schritt eine faire Klasseneinteilung aus einer
  Excel-Anmeldeliste. Nutze diese Skill, wenn der Nutzer Schüler in Klassen einteilen,
  eine Klassenbildung/Klasseneinteilung aus einer Excel-/xlsx-Liste erstellen, Wunschpartner,
  Chorklasse, Grundschulen, Geschlecht oder Noten berücksichtigen, oder eine bestehende
  Klassenliste optimieren möchte. Triggerbegriffe: Klasseneinteilung, Klassenbildung, Klassen
  bilden, Schüler einteilen, Klassenzusammensetzung, Wunschpartner, Chorklasse, class assignment.
---

# Klasseneinteilung — dialoggeführter Ablauf

Du führst den Nutzer **Schritt für Schritt** durch die Klasseneinteilung. Eine deterministische
Python-Engine übernimmt das schwere Rechnen (Excel lesen, anonymisieren, optimieren, exportieren);
**du** übernimmst das Gespräch: Namen abgleichen, Sonderfälle klären, Kriterien mit dem Nutzer
priorisieren und das Ergebnis gemeinsam verfeinern. Der Nutzer behält jederzeit die Entscheidung —
du schlägst vor, er bestimmt. Endergebnis ist immer eine fertige Klasseneinteilung als Excel.

## Grundprinzipien (immer beachten)

1. **Anonymisiert arbeiten.** Die Engine ersetzt Namen sofort durch Codes (`S001` …). Rechne und
   diskutiere intern mit Codes. `mapping.json` (Code → echter Name) bleibt lokal und wird niemals
   an Dritte weitergegeben. Nur für die Anzeige an den Nutzer und den finalen Export werden Namen
   wieder eingesetzt.
2. **Harte Regeln überstimmen alles.** Genau *K* Klassen, ausgeglichene Klassengröße und
   Cluster-Klassen (z. B. Chor: **alle** Chorkinder kommen in die Chorklasse(n), danach wird bis zur
   Klassengröße aufgefüllt — ihre eigenen Wünsche sind dabei untergeordnet). Erkläre dem Nutzer,
   wenn eine harte Regel einen Wunsch verdrängt.
3. **Nie ungefragt große Entscheidungen treffen.** Zwillinge zusammenlegen, ein „nicht mit" hart
   erzwingen, ein Kriterium abschalten — das schlägst du vor und lässt den Nutzer entscheiden.
   Kleine, offensichtliche Namenskorrekturen (klarer Tippfehler, eindeutiger Kandidat) darfst du
   direkt vornehmen und danach zusammenfassen.
4. **Jede Änderung sichtbar machen.** Nach Anpassungen an Kriterien/Regeln immer neu rechnen und die
   Auswirkung zeigen (was hat sich verbessert/verschlechtert?).
5. **Config gezielt bearbeiten, nicht neu erzeugen.** `config.json` ist die zentrale Steuerdatei.
   Ändere sie mit gezielten Bearbeitungen (einzelne Felder), damit Anpassungen des Nutzers nicht
   verloren gehen.

## Voraussetzungen

- `python3` mit `openpyxl` (im Cowork-Container vorinstalliert; sonst `pip install openpyxl`).
- Die Engine liegt in dieser Skill unter `scripts/klasseneinteilung.py`. Rufe sie mit dem
  vollständigen Pfad auf. Alle Arbeitsdateien landen in einem Arbeitsordner (Standard `ke_arbeit`).

```
python3 <skill>/scripts/klasseneinteilung.py prep   <datei.xlsx> --work ke_arbeit
python3 <skill>/scripts/klasseneinteilung.py solve  --work ke_arbeit
python3 <skill>/scripts/klasseneinteilung.py export --work ke_arbeit
```

## Arbeitsdateien im Arbeitsordner

| Datei | Inhalt |
|---|---|
| `config.json` | **Steuerdatei** — Spalten/Rollen, Kriterien+Gewichte, Cluster, Korrekturen, Zusatzregeln. Die bearbeitest du. |
| `students.json` | anonymisierte Schülerdaten (nur Codes) |
| `mapping.json` | Code → echter Name (**lokal, vertraulich**) |
| `unresolved.json` | offene Wunsch-/„nicht mit"-Nennungen mit Namens-Kandidaten |
| `assignment.json` | Ergebnis der letzten Berechnung + Statistik |

**Wann was neu ausführen:**
- Änderungen an `columns` (Spaltenrollen) oder `corrections` (Namenszuordnung) → **`prep`** erneut
  ausführen (liest `config.json` automatisch und anonymisiert neu).
- Änderungen an `criteria`, `clusters`, `numClasses`, `classPrefix` oder `extraRules` → nur **`solve`**.

---

# Der Ablauf in Phasen

Arbeite die Phasen der Reihe nach ab, aber bleib flexibel: Wenn der Nutzer springen oder etwas
überspringen will, folge ihm. Halte deine Nachrichten kompakt (Tabellen/Listen), nicht überladen.

## Phase 0 — Datei einlesen
Nimm die hochgeladene Excel entgegen und führe `prep` aus. Fasse dann zusammen:
Anzahl Schüler, geplante Klassenzahl (Vorschlag der Engine), wie viele Wünsche direkt aufgelöst
wurden und wie viele offen sind. Frag, ob es losgehen soll.

## Phase 1 — Spalten & Rollen bestätigen
Zeig die erkannten Spaltenrollen als kurze Liste (nur die relevanten, `ignore` weglassen).
Erkläre knapp, was jede Rolle bewirkt (siehe `references/kriterien.md`, bei Bedarf lesen).
Frag: „Passt das so?" Wenn der Nutzer eine Spalte anders zuordnen will (z. B. eine weitere
Kategorie balancieren, ein Profil als Cluster behandeln), ändere `config.json → columns[i].role`
(ggf. `targetValue`) und führe `prep` erneut aus. Bei rollenbedingten Kriterien-Änderungen passe
auch `criteria`/`clusters` an (oder — falls noch nichts angepasst wurde — lösche `config.json` und
lass `prep` neu erzeugen).

## Phase 2 — Wunschpartner-Namen abgleichen  ⭐ (der wichtige „intelligente" Schritt)
Eltern schreiben Namen oft falsch. `unresolved.json` enthält jede offene Nennung mit dem
Kind, das sie geschrieben hat, und den besten Namens-Kandidaten.

Gehe so vor:
1. Lies `unresolved.json` und `mapping.json`.
2. Für **eindeutige** Fälle (klarer Tippfehler, genau ein plausibler Kandidat — z. B. „Noah Kalmann"
   → „Noah Samuel Kalman [S047]", „Sofie" → „Sophie") trag die Zuordnung direkt in
   `config.json → corrections` ein. Der Schlüssel ist der **normalisierte** Nennungstext, der Wert
   der Code. Nutze die Normalisierung der Engine (Kleinbuchstaben, Umlaute→ae/oe/ue, ß→ss, nur a–z):
   z. B. `"Niranthara Shentil"` → Schlüssel `"nirantharashentil"` → Wert `"S109"`.
3. Für **mehrdeutige** Fälle (mehrere plausible Kinder, oder gar kein sinnvoller Treffer) frag den
   Nutzer gezielt — nenne die Nennung, wer sie geschrieben hat, und 2–3 Kandidaten mit Namen. Trag
   die Antwort des Nutzers als Korrektur ein. Wenn niemand passt, lass die Nennung offen.
4. Zeig dem Nutzer eine kompakte Übersicht der automatisch getroffenen Zuordnungen zur Bestätigung
   („Ich habe folgende 15 zugeordnet — passt das, oder soll ich etwas ändern?").
5. Führe `prep` erneut aus und berichte die neue Zahl aufgelöster/offener Wünsche.

Setze eine Korrektur auf leeren String (`""`), um eine Nennung bewusst offen zu lassen.

## Phase 3 — Harte Regeln festlegen
Zeig die harten Regeln und lass sie bestätigen/anpassen:
- **Klassenzahl** (`config.json → numClasses`) — fest, Standard aus der Engine. Frag explizit nach
  (oft eine feste Vorgabe der Schule, z. B. genau 5).
- **Klassen-Präfix** (`classPrefix`, z. B. `5` → 5a, 5b …).
- **Cluster-Klassen** (`clusters`) — z. B. Chor. Erkläre: alle Kinder mit dem Cluster-Wert kommen
  zwingend zusammen; `classes: null` = automatisch (so wenige Cluster-Klassen wie nötig), oder eine
  feste Zahl. Bestätige Wert (z. B. `"ja"`) und Anzahl.
- **„nicht mit" hart?** Standard ist hart (`criteria` mit `kind:"avoid"`, `hard:true`). Frag, ob
  Trennungen zwingend eingehalten werden müssen oder nur möglichst.

## Phase 4 — Weiche Kriterien priorisieren
Zeig die weichen Kriterien als Rangliste mit Gewichten (aus `config.json → criteria`, absteigend
nach `weight`). Erkläre kurz jedes (Wünsche erfüllen, Geschlecht gleich verteilen, Grundschulen
mischen, Fremdsprache bündeln, Noten heterogen). Lass den Nutzer:
- die **Reihenfolge/Priorität** ändern → passe die `weight`-Werte an (höher = wichtiger; halte
  sinnvolle Abstände, z. B. 90/70/65/55/45),
- einzelne Kriterien **abschalten** (`enabled:false`),
- Feinheiten setzen (`mix.maxBlock` = max. Blockgröße einer Herkunftsschule; `concentrate.targetValue`
  = welcher Wert gebündelt wird).
Erkläre den Zielkonflikt offen (z. B. „mehr Latein-Bündelung kann einzelne Wünsche kosten").

## Phase 5 — Entscheidungsfälle besprechen
Aus der `prep`-Ausgabe (Bemerkungen) und `unresolved.json` (offene „nicht mit"): geh die Fälle mit
Urteilsbedarf mit dem Nutzer durch und trage das Ergebnis als Zusatzregel in
`config.json → extraRules` ein:
- `{"type":"mustWith","codes":["S044","S060"],"reason":"Zwillinge"}` — Kinder zusammenlegen
  (Zwillinge/Geschwister erkennst du an gleichem Nachnamen in `mapping.json`; Bemerkungen wie „mit
  Zwillingsschwester in eine Klasse").
- `{"type":"notWith","codes":["S008","S117"],"reason":"Konflikt"}` — Kinder trennen (z. B.
  „Mobbing", „nicht mit …").
Bei sensiblen Bemerkungen (z. B. „Eltern taubstumm", „nur wenn nicht nur Mädels") schlag eine
konkrete Regel vor und lass den Nutzer entscheiden. Im Zweifel nachfragen statt raten.

## Phase 6 — Berechnen & Ergebnis zeigen
Führe `solve` aus. Präsentiere das Ergebnis als kompakte Tabelle: pro Klasse Größe, m/w, Ø-Noten,
Fremdsprache/Cluster, offene Wünsche. Nenne die Gesamtquote erfüllter Wünsche und liste die wenigen
Kinder ohne erfüllten Wunsch namentlich. Falls `hardViolations` nicht leer ist, erkläre, welche
harte Regel nicht erfüllbar war und warum (z. B. zu viele Chorkinder für die Klassengröße).

## Phase 7 — Gemeinsam verfeinern (Schleife)
Lade den Nutzer ein, Änderungen zu wünschen, und setze sie um:
- „Kind X soll doch zu Y" → `mustWith`-Regel ergänzen, neu `solve`.
- „X und Y auf keinen Fall zusammen" → `notWith`-Regel, neu `solve`.
- „Mehr Wert auf Geschlechterverteilung" → `weight` erhöhen, neu `solve`.
- „Zeig mir eine Alternative" → `solve --seed <andere Zahl>`.
- „Warum ist Kind Z in 5c?" → aus `assignment.json`/Statistik erklären (Wunschgruppe, Cluster,
  Balance).
Zeig nach jeder Runde, was sich verändert hat. Wiederhole, bis der Nutzer zufrieden ist.

## Phase 8 — Export
Führe `export` aus und gib die erzeugte `Klasseneinteilung.xlsx` an den Nutzer (Gesamtliste,
ein Blatt pro Klasse, Statistik — mit echten Namen). Weise darauf hin, dass `mapping.json` und die
Rohdaten lokal/vertraulich bleiben.

---

## config.json — Kurzreferenz

```jsonc
{
  "numClasses": 5,                 // harte Klassenzahl
  "classPrefix": "5",              // Labels 5a, 5b …
  "balanceSizes": true,            // Klassengröße als harte Obergrenze (±1)
  "columns": [ { "header": "...", "role": "wish|avoid|balance|concentrate|spread|mix|cluster|note|firstName|lastName|fullName|email|ignore", "targetValue": "..." } ],
  "clusters": [ { "header": "Chorklasse", "value": "ja", "label": "Chorklasse", "classes": null } ],
  "criteria": [ { "id": "...", "kind": "wish|avoid|balance|concentrate|spread|mix", "header": "...",
                  "enabled": true, "hard": false, "weight": 90, "targetValue": "L", "maxBlock": 8 } ],
  "extraRules": [ { "type": "mustWith|notWith", "codes": ["S044","S060"], "reason": "..." } ],
  "corrections": { "nirantharashentil": "S109" }   // normalisierte Nennung → Code (oder "")
}
```

Details zu Rollen und Kriterien: siehe `references/kriterien.md`.
