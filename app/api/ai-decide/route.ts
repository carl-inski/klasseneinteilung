// KI-Unterstützung für Entscheidungsfälle (Bemerkungen, unlösbare Nennungen).
// Erhält AUSSCHLIESSLICH anonymisierte Daten (Codes) und gibt strukturierte
// Regel-Vorschläge zurück (mustWith / notWith / none).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const SCHEMA = {
  type: "object" as const,
  properties: {
    suggestions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          codes: { type: "array" as const, items: { type: "string" as const } },
          action: { type: "string" as const, enum: ["mustWith", "notWith", "none"] },
          reason: { type: "string" as const },
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
  let body: { apiKey?: string; cases: { code: string; kind: string; text: string }[]; context: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "Kein API-Schlüssel. Trage einen Anthropic-API-Key ein oder setze ANTHROPIC_API_KEY." },
      { status: 401 }
    );
  if (!body.cases?.length) return NextResponse.json({ suggestions: [] });

  const client = new Anthropic({ apiKey });

  const prompt = `Du hilfst einer Schule bei der Klasseneinteilung. Alle Schüler sind anonymisiert
(Codes wie S001). Es gibt Entscheidungsfälle, die die Programmlogik nicht automatisch lösen kann.

Kontext (anonymisiert):
${body.context}

Entscheidungsfälle:
${body.cases.map((c) => `- ${c.code} [${c.kind}]: ${c.text}`).join("\n")}

Schlage für jeden Fall eine Regel vor:
- "mustWith": genannte Codes sollen in dieselbe Klasse (z. B. Zwillinge/Geschwister,
  eingespielte Gruppen, besondere Familiensituationen).
- "notWith": genannte Codes sollen getrennt werden (z. B. Mobbing, Konflikte).
- "none": keine automatische Regel möglich/nötig — erkläre kurz, was die Schule manuell prüfen sollte.
Nutze bei Geschwister-Hinweisen die im Kontext markierten Gruppen mit gleichem Nachnamen.
Im Zweifel "none" mit Erklärung.`;

  try {
    // Ohne Extended Thinking: bleibt zuverlässig unter dem Serverless-Zeitlimit.
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal")
      return NextResponse.json({ error: "Anfrage vom Modell abgelehnt." }, { status: 502 });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return NextResponse.json({ suggestions: [] });
    return NextResponse.json(JSON.parse(text.text));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      return NextResponse.json({ error: "API-Schlüssel ungültig." }, { status: 401 });
    if (err instanceof Anthropic.RateLimitError)
      return NextResponse.json({ error: "Rate-Limit erreicht, bitte kurz warten." }, { status: 429 });
    const message = err instanceof Anthropic.APIError ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: `KI-Anfrage fehlgeschlagen: ${message}` }, { status: 502 });
  }
}
