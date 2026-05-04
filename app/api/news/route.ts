import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { TradePayloadSchema } from "@/lib/trade-schema";
import { parseClaudeJsonRaw } from "@/lib/claude-json";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM = `You are a markets analyst. Given an options position, find upcoming catalysts within the trade horizon that could affect it.

Output format: a JSON object { "events": [...] }. Each event:
- type: "earnings" | "dividend" | "fomc" | "product" | "regulatory" | "other"
- date: ISO YYYY-MM-DD if known, else "Q2 2026" or "around May 2026"
- note: ONE short bullet — what the catalyst is and why it matters for THIS position. Plain English. No markdown.

Up to 5 events. Skip catalysts you aren't sure about. Use your training knowledge of typical earnings cadence (most companies report quarterly), ex-div schedules, scheduled FOMC, known product events. If absolutely nothing is known, return an empty array.

CRITICAL: Return ONLY the JSON object. No markdown fences, no prose, no headings.`;

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`news:${clientIp(req)}`, 30, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = TradePayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid trade" },
        { status: 400 },
      );
    }
    const trade = parsed.data;

    const summary = {
      symbol: trade.symbol,
      underlying: trade.underlyingPrice,
      legs: trade.legs.map((l) => ({
        side: l.side,
        type: l.type,
        strike: l.strike,
        expiration: l.expiration,
      })),
    };

    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: `Position: ${JSON.stringify(summary)}\n\nReturn JSON.` }],
    });

    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const rawParsed = parseClaudeJsonRaw(text);
    const events = Array.isArray(rawParsed)
      ? rawParsed
      : ((rawParsed as { events?: unknown[] } | null)?.events ?? []);
    return NextResponse.json({ events });
  } catch (err) {
    console.error("[news] failed:", err);
    const m = err instanceof Error ? err.message : "news failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
