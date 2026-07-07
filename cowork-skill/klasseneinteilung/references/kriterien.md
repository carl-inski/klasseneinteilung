# Rollen & Kriterien — Referenz

## Spaltenrollen

Jede Excel-Spalte bekommt eine Rolle. Daraus leiten sich Kriterien und harte Regeln ab.

| Rolle | Zweck | Beispielspalte |
|---|---|---|
| `firstName` / `lastName` / `fullName` | Name des Kindes (bleibt lokal, wird anonymisiert) | Rufname, Nachname |
| `email` | E-Mail (anonymisiert) | Email |
| `wish` | Wunschpartner (Freitext, mehrere Spalten möglich) | Wunschpartner, weitere Wunschpartner |
| `avoid` | „nicht mit …" (Freitext) | nicht mit |
| `balance` | Kategorie **gleichmäßig** auf alle Klassen verteilen | Geschlecht |
| `concentrate` | einen Kategorie-**Wert** auf **möglichst wenige** Klassen bündeln | 2. Fremdsprache = Latein |
| `spread` | Zahl **heterogen** verteilen (ähnlicher Schnitt & Streuung überall) | Notendurchschnitt |
| `mix` | Herkunft **mischen**: große Blöcke begrenzen, kleine Gruppen zusammenlassen | Grundschule |
| `cluster` | **harte** Cluster-Klasse: alle mit dem Wert kommen zusammen | Chorklasse = ja |
| `note` | Freitext-Bemerkung (wird zum Entscheidungsfall) | Bemerkung |
| `ignore` | wird nicht verwendet | Anzahl, lfd. Nr. |

Ein `firstName`-Doppel (Rufname **und** Vornamen) ist unkritisch: für die Namensauflösung zählt die
**erste** Spalte (i. d. R. der Rufname, den Eltern in Wünschen verwenden).

## Harte Regeln (überstimmen alle Wünsche)

- **Genau `numClasses` Klassen.**
- **Klassengröße** (`balanceSizes: true`): keine Klasse über der Obergrenze `ceil(n / K)` → Größen
  unterscheiden sich um höchstens 1.
- **Cluster** (`clusters`): alle Kinder mit dem Cluster-Wert werden auf die dedizierten
  Cluster-Klassen verteilt und dort fixiert; anschließend werden diese Klassen mit
  Nicht-Cluster-Kindern bis zur Klassengröße aufgefüllt. Die Wünsche der Cluster-Kinder sind dabei
  untergeordnet. `classes: null` = automatisch (so wenige wie nötig), sonst feste Zahl.
- **`avoid` mit `hard: true`**: genannte Kinder werden zwingend getrennt (bei Zügen erzwungen).

## Weiche Kriterien (gewichtete Straffunktion)

Jedes Kriterium hat ein `weight` (0–100); höher = wichtiger. Der Solver minimiert die gewichtete
Summe der Strafen über Greedy-Start + lokale Suche (mehrere Starts, bestes Ergebnis ohne harte
Verletzung gewinnt).

| `kind` | Was optimiert wird | Feineinstellung |
|---|---|---|
| `wish` | jedes Kind mit Wunsch bekommt **mind. einen** Wunschpartner in seiner Klasse | — |
| `avoid` (weich) | genannte Kinder möglichst nicht zusammen | `hard: true` macht es zur harten Regel |
| `balance` | Werte (z. B. m/w) in allen Klassen gleich verteilt | — |
| `concentrate` | `targetValue` (z. B. `"L"`) auf wenige Klassen bündeln | `targetValue` = zu bündelnder Wert |
| `spread` | Schnitt & Streuung der Zahl in allen Klassen ähnlich | — |
| `mix` | kleine Herkunftsgruppen (≤ 4) zusammen, Blöcke > `maxBlock` vermeiden | `maxBlock` (Standard 8) |

## Standard-Prioritäten (aus dem Ablaufzettel „Klassenbildung")

1. `avoid` (hart) — 100
2. `wish` — 90
3. `balance` (Geschlecht) — 70
4. `mix` (Grundschulen) — 65
5. `concentrate` (Latein) — 55
6. `spread` (Noten) — 45

Reihenfolge und Gewichte sind mit dem Nutzer frei anpassbar. Wunschgruppen werden auf max. 4 Kinder
begrenzt (keine Wunschketten).

## Typische Zielkonflikte (dem Nutzer transparent machen)

- **Cluster vs. Mischen:** Wollen viele Kinder derselben Grundschule in den Chor, entsteht in der
  Chorklasse zwangsläufig ein großer Grundschulblock — das ist korrekt, Cluster hat Vorrang.
- **Bündeln vs. Wünsche:** Latein stark bündeln kann einzelne klassenübergreifende Wünsche kosten.
- **Größe vs. Wunschgruppen:** sehr große Wunschketten sind durch die 4er-Grenze und die feste
  Klassengröße limitiert.
