import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { parseClaudeJsonRaw } from "@/lib/claude-json";
import { TickerSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM = `You fetch the LATEST live stock/ETF/index price using the web_search tool.

CRITICAL: the user is monitoring an open options trade. They need a price quote that is current to within a few minutes during market hours, or the most recent close otherwise. Stale quotes from hours/days ago are unacceptable — keep searching until you find a fresh one.

Strategy:
1. First call web_search with "<TICKER> stock price now". Look for a Google-style finance card; the price + "as of <time>" stamp tells you freshness.
2. If the first result is stale, lacks a timestamp, or only shows news, search again with one of:
   - "<TICKER> Yahoo Finance"
   - "<TICKER> Google Finance live"
   - "<TICKER> NASDAQ quote"
3. If still no fresh quote, search "<TICKER> last price <today's date>" or "<TICKER> intraday quote".
4. You may use the search tool up to 4 times. Do not give up after a single empty result.

Always include the freshest "as of" timestamp you can find in the asOf field. If multiple sources disagree, prefer Google Finance > Yahoo Finance > NASDAQ > MarketWatch > CNBC > Bloomberg > Reuters.

Reply with JSON ONLY (no prose, no code fences, no markdown):
{"price": <number>, "asOf": "<ISO 8601 timestamp or human-readable time like '2026-05-08 15:43 ET'>", "source": "<short source name e.g. 'Google Finance'>"}

Only if you have genuinely exhausted 4 search attempts and none returned a price, reply: {"error": "<short reason>"}`;

interface ContentBlock {
  type: string;
  text?: string;
}

interface SpotJson {
  price?: number;
  asOf?: string;
  source?: string;
  error?: string;
}

// In-memory cache removed — every click hits the model. The rate limiter
// (20 / 60s per IP) is the only guardrail; users were getting "unchanged"
// because the cache was returning the previous Claude reply rather than
// fetching a truly fresh quote.

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`spot:${clientIp(req)}`, 20, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as { symbol?: unknown };
    const tickerParse = TickerSchema.safeParse(body.symbol);
    if (!tickerParse.success) {
      return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
    }
    const ticker = tickerParse.data;

    // Web search tool is a server-side built-in. The SDK Tool type doesn't
    // include it, so cast the params object at the SDK boundary only.
    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [
        {
          role: "user",
          content: `What is the latest trading price for ${ticker}? Use multiple searches if needed. Return JSON only.`,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const blocks = (resp.content ?? []) as ContentBlock[];
    const text = blocks
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    const SpotSchema = z.object({
      price: z.number().optional(),
      asOf: z.string().optional(),
      source: z.string().optional(),
      error: z.string().optional(),
    });
    const raw = parseClaudeJsonRaw(text);
    const parsed = (raw && SpotSchema.safeParse(raw).data) as SpotJson | null;
    if (!parsed || parsed.error || typeof parsed.price !== "number") {
      return NextResponse.json(
        { error: parsed?.error ?? `Could not parse price for ${ticker}` },
        { status: 502 },
      );
    }

    const result = {
      symbol: ticker,
      price: parsed.price,
      asOf: parsed.asOf ?? new Date().toISOString(),
      source: parsed.source ?? null,
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[spot] failed:", err);
    const m = err instanceof Error ? err.message : "spot failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
