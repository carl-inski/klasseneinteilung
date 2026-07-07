// KI-Namensabgleich: gleicht (oft falsch geschriebene) Wunschpartner-/„nicht mit“-
// Nennungen gegen die echte Namensliste ab. Erhält nur die Namensliste und die
// Freitext-Nennungen — KEINE Noten, kein Geschlecht, keine Bemerkungen.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const SCHEMA = {
  type: "object" as const,
  properties: {
    matches: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          mention: { type: "string" as const, description: "Die Original-Nennung" },
          code: {
            type: "string" as const,
            description: "Zugeordneter Schülercode (z. B. S045) oder leer, wenn kein sicherer Treffer",
          },
          confidence: {
            type: "string" as const,
            enum: ["hoch", "mittel", "niedrig"],
          },
        },
        required: ["mention", "code", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  let body: {
    apiKey?: string;
    roster: { code: string; name: string }[];
    mentions: string[];
  };
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
  if (!body.mentions?.length) return NextResponse.json({ matches: [] });

  const client = new Anthropic({ apiKey });

  const prompt = `Eltern haben bei einer Schulanmeldung Wunschpartner und „nicht mit“-Namen eingetragen.
Diese Namen sind oft falsch oder unvollständig geschrieben (falscher Nachname, Spitzname,
Tippfehler, nur Vorname). Ordne jede Nennung dem passenden Kind aus der offiziellen
Namensliste zu.

Offizielle Namensliste (Code = Kind):
${body.roster.map((r) => `${r.code}: ${r.name}`).join("\n")}

Nennungen, die zugeordnet werden sollen:
${body.mentions.map((m, i) => `${i + 1}. "${m}"`).join("\n")}

Regeln:
- Gib für jede Nennung den Code des wahrscheinlichsten Kindes an.
- Berücksichtige phonetische Ähnlichkeit und typische Schreibfehler (z. B. „Kalman“ = „Kalmann“,
  „Sofie“ = „Sophie“, „Meier/Maier/Mayer“).
- Wenn ein Vorname eindeutig zu genau einem Kind passt, ordne es zu.
- Wenn mehrere Kinder gleich gut passen oder keiner sinnvoll passt, lass "code" leer.
- confidence: hoch = eindeutig, mittel = wahrscheinlich, niedrig = unsicher.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal")
      return NextResponse.json({ error: "Anfrage vom Modell abgelehnt." }, { status: 502 });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return NextResponse.json({ matches: [] });
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
