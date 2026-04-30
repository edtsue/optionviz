import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import type { Trade } from "@/types/trade";
import { detectStrategy } from "@/lib/strategies";
import { tradeStats, netGreeks, fillImpliedVolsForTrade } from "@/lib/payoff";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are an options trading copilot. Given an existing options position, propose 3 alternative or adjustment ideas the trader should consider.

For each idea:
- name: short title (e.g. "Convert to call debit spread")
- bias: "bullish" | "bearish" | "neutral" | "volatility"
- thesis: 1-sentence why
- structure: concrete legs (action, type, strike, expiration, qty)
- tradeoffs: 1 sentence on what's better/worse vs current
- whenToConsider: 1 sentence on the market view that makes this preferable

Return ONLY a JSON array: [{ name, bias, thesis, structure, tradeoffs, whenToConsider }]. No markdown.`;

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
      max_tokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Current position:\n${JSON.stringify(summary, null, 2)}\n\nReturn JSON array of 3 alternative ideas.`,
        },
      ],
    });

    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const ideas = JSON.parse(cleaned);
    return NextResponse.json({ ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ideas failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
