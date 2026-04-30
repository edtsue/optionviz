import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import type { PortfolioSnapshot } from "@/types/portfolio";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a portfolio analyst. Given a parsed portfolio (holdings, total value, cash), produce:

1. summary — 2-3 sentences on the overall posture (growth/value, concentration, sector tilt)
2. concentrationRisk — call out any single position > 20% of total, or sector concentration
3. diversification — qualitative: well-diversified / sector-heavy / single-name-concentrated
4. notableObservations — 3-5 bullet observations (winners, laggards, tax-loss harvest candidates, options opportunities)
5. recommendations — array of { title, rationale, priority: "high"|"medium"|"low" }, max 5. Practical and actionable.
6. ideas — array of {name, thesis, structure, fitWith} — 3 specific options trade ideas tailored to their actual holdings (e.g. "Sell covered calls on AAPL — you have 100+ shares"). The "fitWith" field names the holding(s) it pairs with.

Return ONLY valid JSON matching exactly:
{ "summary": string, "concentrationRisk": string, "diversification": string, "notableObservations": string[], "recommendations": [...], "ideas": [...] }
No markdown.`;

export async function POST(req: NextRequest) {
  try {
    const portfolio = (await req.json()) as PortfolioSnapshot;
    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 2500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Portfolio snapshot:\n${JSON.stringify(portfolio, null, 2)}\n\nAnalyze and return JSON.`,
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
    const m = err instanceof Error ? err.message : "analyze failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
