import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import type { Trade } from "@/types/trade";
import { detectStrategy } from "@/lib/strategies";
import { tradeStats, netGreeks, fillImpliedVolsForTrade } from "@/lib/payoff";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are an options trading copilot. Be terse: every field is one short sentence or fewer. Given a position, return 3 alternative or adjustment ideas plus any near-term events that could affect the trade.

For each idea:
- name: short title (e.g. "Convert to call debit spread")
- bias: "bullish" | "bearish" | "neutral" | "volatility"
- thesis: 1 short sentence
- structure: concrete legs (action, type, strike, expiry, qty)
- tradeoffs: 1 short sentence
- whenToConsider: 1 short sentence

Also include an "events" array (max 3) of upcoming catalysts that affect this underlying within the trade horizon: earnings call, ex-div date, FDA decision, FOMC, product event, lockup expiry. Use your knowledge — skip if unsure.

For each event:
- type: "earnings" | "dividend" | "fomc" | "product" | "regulatory" | "other"
- date: best estimate ISO date or quarter (e.g. "2026-05-08" or "Q2 2026")
- note: 1 short sentence on why it matters for this position

Return ONLY JSON: { "ideas": [...], "events": [...] }. No markdown.`;

export async function POST(req: NextRequest) {
  try {
    const trade = (await req.json()) as Trade;
    const filled = fillImpliedVolsForTrade(trade);
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
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    // Backwards-compat: older responses returned a bare array
    const ideas = Array.isArray(parsed) ? parsed : parsed.ideas ?? [];
    const events = Array.isArray(parsed) ? [] : parsed.events ?? [];
    return NextResponse.json({ ideas, events });
  } catch (err) {
    console.error("[ideas] failed:", err);
    const message = err instanceof Error ? err.message : "ideas failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
