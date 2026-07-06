// KI-Unterstützung für Entscheidungsfälle.
// Erhält AUSSCHLIESSLICH anonymisierte Daten (Codes statt Namen) und gibt
// strukturierte Regel-Vorschläge zurück (mustWith / notWith / fixedClass /
// keine Aktion), die der Nutzer im Frontend übernehmen kann.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const SUGGESTION_SCHEMA = {
  type: "object" as const,
  properties: {
    suggestions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          codes: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Betroffene Schülercodes (z. B. S055)",
          },
          action: {
            type: "string" as const,
            enum: ["mustWith", "notWith", "none"],
            description:
              "mustWith = zusammen in eine Klasse, notWith = trennen, none = keine Regel nötig",
          },
          reason: {
            type: "string" as const,
            description: "Kurze Begründung auf Deutsch",
          },
        },
        required: ["codes", "action", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  let body: {
    apiKey?: string;
    cases: { code: string; kind: string; text: string }[];
    context: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Kein API-Schlüssel. Trage einen Anthropic-API-Key in den Einstellungen ein oder setze ANTHROPIC_API_KEY.",
      },
      { status: 401 }
    );
  }
  if (!body.cases?.length) {
    return NextResponse.json({ suggestions: [] });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Du hilfst einer Schule bei der Klasseneinteilung der 5. Jahrgangsstufe.
Alle Schüler sind anonymisiert (Codes wie S001). Es gibt Entscheidungsfälle, die die
Programmlogik nicht automatisch lösen kann: Bemerkungen der Eltern, nicht zuordenbare
Wunschnennungen oder fehlende Daten.

Kontext (anonymisierte Schülerdaten in Kurzform):
${body.context}

Entscheidungsfälle:
${body.cases.map((c) => `- ${c.code} [${c.kind}]: ${c.text}`).join("\n")}

Schlage für jeden Fall eine Regel vor:
- "mustWith": genannte Schüler sollen in dieselbe Klasse (z. B. Zwillinge, Geschwister,
  eingespielte Gruppen, Kinder mit besonderen Familiensituationen, die sich gegenseitig stützen).
- "notWith": genannte Schüler sollen getrennt werden (z. B. Mobbing, Konflikte).
- "none": keine automatische Regel möglich oder nötig (z. B. Wunschpartner an anderer Schule) —
  erkläre kurz, was die Schule manuell prüfen sollte.
Beziehe bei Bemerkungen wie "mit Zwillingsschwester in eine Klasse" die Codes der Geschwister
aus dem Kontext ein (gleicher Nachname ist im Kontext als Gruppe markiert). Sei vorsichtig:
Im Zweifel "none" mit Erklärung.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        format: {
          type: "json_schema",
          schema: SUGGESTION_SCHEMA,
        },
      },
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "Die Anfrage wurde vom Modell abgelehnt." },
        { status: 502 }
      );
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return NextResponse.json({ suggestions: [] });
    }
    return NextResponse.json(JSON.parse(text.text));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "API-Schlüssel ungültig." }, { status: 401 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Rate-Limit erreicht, bitte kurz warten." },
        { status: 429 }
      );
    }
    const message = err instanceof Anthropic.APIError ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: `KI-Anfrage fehlgeschlagen: ${message}` }, { status: 502 });
  }
}
