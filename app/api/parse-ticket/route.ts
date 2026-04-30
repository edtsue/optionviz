import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, VISION_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const LegSchema = z.object({
  type: z.enum(["call", "put"]),
  side: z.enum(["long", "short"]),
  strike: z.number(),
  expiration: z.string(),
  quantity: z.number().int().positive(),
  premium: z.number(),
});

const TicketSchema = z.object({
  symbol: z.string(),
  underlyingPrice: z.number(),
  legs: z.array(LegSchema).min(1),
  notes: z.string().nullish(),
});

const SYSTEM_PROMPT = `You are an options trade-ticket parser. Given a screenshot of a brokerage option order ticket (Schwab SnapTicket, Fidelity, Robinhood, IBKR, ToS, Tastytrade, etc.), extract the trade as strict JSON.

Rules:
- Map "Buy to open" → side:"long". "Sell to open" → side:"short". Closing actions → invert: "Buy to close" → side:"short" being closed (treat as short for visualization purposes only if explicitly closing). Default unclear actions to long.
- "type" must be "call" or "put".
- "strike" is the option strike price (number).
- "expiration" must be ISO date YYYY-MM-DD.
- "quantity" is number of contracts (integer).
- "premium" is per-share option price (use limit price / mid / displayed price; never the total dollar estimate).
- "underlyingPrice" is the current stock price visible on the ticket.
- "symbol" is the underlying ticker only (e.g. "RKLB", not "RKLB May 29 2026 82 C").
- If multi-leg, return all legs.

Return ONLY a JSON object matching:
{
  "symbol": string,
  "underlyingPrice": number,
  "legs": [{ "type": "call"|"put", "side": "long"|"short", "strike": number, "expiration": "YYYY-MM-DD", "quantity": number, "premium": number }],
  "notes": string | null
}
No prose, no markdown fences.`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64, mediaType } = body as { imageBase64: string; mediaType: string };
    if (!imageBase64 || !mediaType) {
      return NextResponse.json({ error: "imageBase64 and mediaType required" }, { status: 400 });
    }

    const resp = await anthropic().messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            { type: "text", text: "Parse this ticket. Return JSON only." },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const parsed = TicketSchema.parse(extractJson(text));
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[parse-ticket] failed:", err);
    const message = err instanceof Error ? err.message : "parse failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
