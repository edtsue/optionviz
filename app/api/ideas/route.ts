import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { detectStrategy } from "@/lib/strategies";
import { tradeStats, netGreeks, fillImpliedVolsForTrade } from "@/lib/payoff";
import { TradePayloadSchema } from "@/lib/trade-schema";
import { parseClaudeJsonRaw } from "@/lib/claude-json";
import { localIdeas } from "@/lib/local-ideas";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { Trade } from "@/types/trade";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are an options trading copilot. Be terse: every field is plain English, one short sentence or fewer. Given a position, return 3 alternative or adjustment ideas plus any near-term events that could affect the trade.

For each idea:
- name: short title in plain English (e.g. "Convert to call debit spread")
- bias: "bullish" | "bearish" | "neutral" | "volatility"
- thesis: 1 short sentence, plain English
- structure: ONE STRING describing concrete legs in human-readable form, with each leg on its own line. Format: "Short 1× 185P 2026-05-08\\nLong 1× 176P 2026-05-08". No JSON, no objects, no arrays — just the readable string.
- tradeoffs: 1 short sentence, plain English
- whenToConsider: 1 short sentence, plain English

Also include an "events" array (max 3) of upcoming catalysts that affect this underlying within the trade horizon: earnings call, ex-div date, FDA decision, FOMC, product event, lockup expiry. Use your knowledge — skip if unsure.

For each event:
- type: "earnings" | "dividend" | "fomc" | "product" | "regulatory" | "other"
- date: best estimate ISO date or quarter (e.g. "2026-05-08" or "Q2 2026")
- note: 1 short sentence on why it matters for this position

CRITICAL: Return ONLY a single JSON object: { "ideas": [...], "events": [...] }. No markdown, no code fences, no prose, no leading or trailing text. Every "structure" field MUST be a string, not an object.`;

const IdeasResponseSchema = z.object({
  ideas: z.array(z.unknown()).optional(),
  events: z.array(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`ideas:${clientIp(req)}`, 30, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsedTrade = TradePayloadSchema.safeParse(raw);
    if (!parsedTrade.success) {
      return NextResponse.json(
        { error: parsedTrade.error.issues[0]?.message ?? "invalid trade" },
        { status: 400 },
      );
    }
    const trade = parsedTrade.data as Trade;
    const filled = fillImpliedVolsForTrade(trade);

    // Local fallback when no API key is configured.
    if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
      return NextResponse.json({ ideas: localIdeas(filled), events: [] });
    }

    const strategy = detectStrategy(filled);
    const stats = tradeStats(filled);
    const greeks = netGreeks(filled);

    const summary = {
      symbol: filled.symbol,
      underlying: filled.underlyingPrice,
      strategy: strategy.label,
      bias: strategy.bias,
      legs: filled.legs,
      hasShares: filled.underlying?.shares ?? 0,
      stats,
      greeks: {
        delta: +greeks.delta.toFixed(2),
        gamma: +greeks.gamma.toFixed(4),
        theta: +greeks.theta.toFixed(2),
        vega: +greeks.vega.toFixed(2),
      },
    };

    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1100,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Position:\n${JSON.stringify(summary)}\n\nReturn JSON.`,
        },
      ],
    });

    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const rawParsed = parseClaudeJsonRaw(text);
    if (rawParsed == null) {
      return NextResponse.json({ ideas: localIdeas(filled), events: [] });
    }
    // Backwards-compat: older responses returned a bare array
    const ideas = Array.isArray(rawParsed)
      ? rawParsed
      : (IdeasResponseSchema.safeParse(rawParsed).data?.ideas ?? []);
    const events = Array.isArray(rawParsed)
      ? []
      : (IdeasResponseSchema.safeParse(rawParsed).data?.events ?? []);
    return NextResponse.json({ ideas, events });
  } catch (err) {
    console.error("[ideas] failed:", err);
    const message = err instanceof Error ? err.message : "ideas failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
