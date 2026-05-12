import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { parseClaudeJsonRaw } from "@/lib/claude-json";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a trading-journal analyst. Read the user's closed trade history and surface concrete, actionable patterns that the user can apply to future trades. Be terse — bullets, not paragraphs.

Look for:
- Strategy types that pay vs. underperform (covered calls, cash-secured puts, verticals, etc.)
- Symbol or sector concentration of wins/losses
- DTE / expiration buckets that work or don't
- Holding-time patterns (closed too early on winners, too late on losers, etc.)
- Strike selection / moneyness bias (e.g. selling too close to the money)
- Anything visible in the notes that recurs (catalysts missed, gut-feel exits, etc.)
- Position-sizing tells (e.g. losses cluster in larger-than-average risk)

Return ONLY JSON matching:
{
  "headline": string,            // one-sentence overall read
  "patterns": [                  // 3-6 observations, most important first
    {
      "title": string,           // short title
      "evidence": string,        // 1 sentence citing specific symbols / counts / dollars from the data
      "impact": "high" | "medium" | "low"
    }
  ],
  "tips": [                      // 3-5 concrete next-trade actions
    {
      "action": string,          // imperative sentence
      "why": string               // 1 sentence linking to the pattern that motivates it
    }
  ],
  "blindSpots": string[]         // optional 0-3 short bullets on what the data isn't enough to tell
}
No markdown, no preamble.`;

// Mirror the closed_trades.tradeSnapshot shape loosely; we only need the
// fields useful to Claude. Permissive on purpose so a stray field doesn't
// 400 the route.
const LegSchema = z
  .object({
    type: z.enum(["call", "put"]),
    side: z.enum(["long", "short"]),
    strike: z.number().finite(),
    expiration: z.string(),
    quantity: z.number().finite(),
    premium: z.number().finite(),
  })
  .passthrough();

const EntrySchema = z
  .object({
    symbol: z.string().max(20),
    outcome: z.enum(["closed", "canceled"]),
    closedAt: z.string(),
    entryCredit: z.number().finite().nullable().optional(),
    exitCredit: z.number().finite().nullable().optional(),
    realizedPnL: z.number().finite().nullable().optional(),
    realizedPnLPct: z.number().finite().nullable().optional(),
    capitalAtRisk: z.number().finite().nullable().optional(),
    resultTag: z.enum(["win", "loss", "scratch"]).nullable().optional(),
    notes: z.string().nullable().optional(),
    strategy: z.string().optional(),
    legs: z.array(LegSchema),
  })
  .passthrough();

const RequestSchema = z.object({
  entries: z.array(EntrySchema).min(1).max(500),
  // Lets the UI pass a label like "Last 30d covered calls" so Claude can
  // anchor the headline to the slice the user is looking at.
  scopeLabel: z.string().max(80).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`journal-analyze:${clientIp(req)}`, 10, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid request" },
        { status: 400 },
      );
    }

    const { entries, scopeLabel } = parsed.data;
    const userBlock = scopeLabel
      ? `Scope: ${scopeLabel}\n\nClosed trades (${entries.length}):\n${JSON.stringify(entries)}\n\nReturn JSON.`
      : `Closed trades (${entries.length}):\n${JSON.stringify(entries)}\n\nReturn JSON.`;

    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userBlock }],
    });

    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const analysis = parseClaudeJsonRaw(text) ?? {};
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[journal-analyze] failed:", err);
    const m = err instanceof Error ? err.message : "analyze failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
