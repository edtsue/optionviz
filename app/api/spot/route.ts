import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { parseClaudeJsonRaw } from "@/lib/claude-json";
import { TickerSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM = `You fetch the latest stock/ETF/index price using the web_search tool.

Strategy:
1. First call web_search with "<TICKER> stock price". Most queries surface a Google-style finance card with a clear quote — extract the number from there.
2. If that result lacks a clear price (only news headlines, blog posts, no quote panel), call web_search again with a more specific query like "<TICKER> Yahoo Finance" or "<TICKER> NASDAQ quote".
3. If still no price, try once more: "<TICKER> last price today".
4. You may use the search tool up to 4 times. Do not give up after a single empty search.

Acceptable price sources, in priority order: Google Finance, Yahoo Finance, NASDAQ, MarketWatch, CNBC, Bloomberg, Reuters. Any of these explicitly stating a current/last/closing price for the ticker is valid. Closing prices from the most recent trading day are acceptable when markets are closed.

Reply with JSON ONLY (no prose, no code fences, no markdown) in this exact shape:
{"price": <number>, "asOf": "<ISO 8601 timestamp or human-readable time like '2026-05-08 15:43 ET'>", "source": "<short source name>"}

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

// Tiny in-memory cache to absorb double-clicks. Kept short so a deliberate
// click always feels live; the rate limiter handles abuse.
const cache = new Map<string, { price: number; asOf: string; source: string | null; expires: number }>();
const CACHE_TTL_MS = 15_000;

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

    const hit = cache.get(ticker);
    if (hit && hit.expires > Date.now()) {
      return NextResponse.json({ symbol: ticker, price: hit.price, asOf: hit.asOf, source: hit.source });
    }

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
    cache.set(ticker, { ...result, expires: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[spot] failed:", err);
    const m = err instanceof Error ? err.message : "spot failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
