import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { parseClaudeJsonRaw } from "@/lib/claude-json";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a portfolio analyst. Be terse — every field is one short sentence unless stated. Produce:

1. summary — 2 sentences max on the overall posture
2. concentrationRisk — 1 sentence; flag any single position > 20% or heavy sector concentration
3. diversification — 1 phrase: well-diversified / sector-heavy / single-name-concentrated
4. notableObservations — array of 3-5 short bullets (winners, laggards, tax-loss harvest candidates, options opportunities)
5. recommendations — array (max 5) of { title, rationale (1 sentence), priority: "high"|"medium"|"low" }
6. ideas — array of 3 { name, thesis (1 sentence), structure (concrete legs), fitWith (the holding it pairs with) } options trade ideas tailored to actual holdings
7. events — array (max 5) of upcoming catalysts that affect the largest holdings within ~60 days. Each: { ticker, type ("earnings" | "dividend" | "fomc" | "product" | "regulatory" | "other"), date (ISO or quarter), note (1 sentence on the impact) }. Use your knowledge; skip if unsure.

Return ONLY JSON matching:
{ "summary": string, "concentrationRisk": string, "diversification": string, "notableObservations": string[], "recommendations": [...], "ideas": [...], "events": [...] }
No markdown.`;

const HoldingSchema = z.object({
  symbol: z.string().max(60),
  name: z.string().max(120).nullable().optional(),
  quantity: z.number().finite(),
  costBasis: z.number().finite().nullable().optional(),
  marketPrice: z.number().finite().nullable().optional(),
  marketValue: z.number().finite().nullable().optional(),
  unrealizedPnL: z.number().finite().nullable().optional(),
  unrealizedPnLPct: z.number().finite().nullable().optional(),
  assetType: z.enum(["stock", "etf", "option", "cash", "other"]).nullable().optional(),
  iv: z.number().finite().nullable().optional(),
  delta: z.number().finite().nullable().optional(),
  extras: z.record(z.union([z.string(), z.number(), z.null()])).nullable().optional(),
});

const PortfolioRequestSchema = z.object({
  totalValue: z.number().finite().nullable().optional(),
  cashBalance: z.number().finite().nullable().optional(),
  asOf: z.string().nullable().optional(),
  uploadedAt: z.string().nullable().optional(),
  holdings: z.array(HoldingSchema).max(500),
});

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`analyze-portfolio:${clientIp(req)}`, 10, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = PortfolioRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid portfolio" },
        { status: 400 },
      );
    }
    const portfolio = parsed.data;

    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1800,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Portfolio:\n${JSON.stringify(portfolio)}\n\nReturn JSON.`,
        },
      ],
    });
    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");
    const analysis = parseClaudeJsonRaw(text) ?? {};
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[analyze-portfolio] failed:", err);
    const m = err instanceof Error ? err.message : "analyze failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
