import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import type { PortfolioSnapshot } from "@/types/portfolio";

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

export async function POST(req: NextRequest) {
  try {
    const portfolio = (await req.json()) as PortfolioSnapshot;
    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1800,
      system: SYSTEM,
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
    const cleaned = text.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(cleaned);
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[analyze-portfolio] failed:", err);
    const m = err instanceof Error ? err.message : "analyze failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
