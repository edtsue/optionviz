import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM = `You are a markets news synthesizer. Use the web_search tool to find news from the past 24 hours about each ticker. Be terse.

For each ticker, list news items that could move the option: earnings results or guidance, analyst upgrades/downgrades with material price-target moves, FDA decisions, macro shocks affecting the name, M&A, regulatory probes, lawsuits, exec departures, product launches that materially shift expectations.

Skip:
- Rumors and low-substance "X stock could move on…" pieces
- Routine analyst notes that don't change the price target
- Generic sector commentary not naming the ticker

For each item:
- headline: 1 line
- summary: 1 short sentence
- impact: 1 short sentence — why it matters for IV / directional bias
- importance: "high" | "medium" | "low"
- source: domain (bloomberg.com, reuters.com, cnbc.com, ft.com, wsj.com, etc.)
- url: link if known, else null

Mark importance "high" ONLY for: earnings beat/miss, formal guidance change, downgrade/upgrade with >5% price-target move, regulator/SEC action, M&A involving the ticker, exec departure, criminal probe, lawsuit with material exposure.

Skip tickers with no relevant news in the last 24h. Don't fabricate.

Return ONLY JSON, no markdown:
{ "items": [ { "ticker": "AAPL", "items": [ { "headline": "...", "summary": "...", "impact": "...", "importance": "high|medium|low", "source": "...", "url": "..." | null } ] } ] }`;

interface Body {
  tickers: string[];
}

export async function POST(req: NextRequest) {
  try {
    const { tickers } = (await req.json()) as Body;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "tickers required" }, { status: 400 });
    }
    // Cap at 10 to keep the call light
    const limited = tickers.slice(0, 10);

    // The web_search tool is server-side: Anthropic executes it, no client
    // round-trip. The current SDK doesn't type web_search_20250305 yet, so
    // build the params and cast through unknown.
    const params: Record<string, unknown> = {
      model: REASONING_MODEL,
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Tickers: ${limited.join(", ")}\n\nReturn JSON.`,
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await anthropic().messages.create(params as any);

    const blocks: Array<{ type: string; text?: string }> = resp.content ?? [];
    const text = blocks
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: { items?: unknown } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[today] JSON parse error:", e, "raw:", text.slice(0, 500));
      return NextResponse.json(
        { error: "Could not parse response", raw: text.slice(0, 1000) },
        { status: 500 },
      );
    }
    return NextResponse.json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[today] failed:", err);
    const m = err instanceof Error ? err.message : "today failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
