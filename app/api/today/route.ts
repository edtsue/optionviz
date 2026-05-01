import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_WEB = `You are a markets news synthesizer. Use the web_search tool to find news from the past 24 hours about each ticker. Be terse.

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

const SYSTEM_FALLBACK = `You are a markets analyst. The web_search tool isn't available, so you can't fetch live news. Instead, for each ticker, list any KNOWN scheduled catalysts within the next 7 days (from your training data) that the user should be aware of: scheduled earnings dates, ex-dividend dates, FDA PDUFA dates, FOMC, analyst day events, lockup expirations.

Be honest about uncertainty: skip tickers where you don't know upcoming events. Don't fabricate news headlines.

For each item:
- headline: short title (e.g. "Earnings expected Q2")
- summary: 1 sentence on the event
- impact: 1 sentence on why it matters
- importance: "high" | "medium" | "low"
- source: "knowledge cutoff" (since this is from training, not live)
- url: null

Return ONLY JSON, no markdown:
{ "items": [ { "ticker": "AAPL", "items": [ {...} ] } ], "fallback": true }`;

interface Body {
  tickers: string[];
}

interface ContentBlock {
  type: string;
  text?: string;
}

function describeError(err: unknown): { message: string; status?: number } {
  // Anthropic SDK errors have .status and .message
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string; error?: { message?: string }; type?: string };
    const innerMsg = e.error?.message;
    const message = innerMsg ?? e.message ?? "Unknown error";
    return { message, status: e.status };
  }
  return { message: String(err) };
}

async function callClaude(systemPrompt: string, useWebSearch: boolean, content: string) {
  const params: Record<string, unknown> = {
    model: REASONING_MODEL,
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
  if (useWebSearch) {
    params.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  }
  // SDK doesn't type web_search; cast through unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await anthropic().messages.create(params as any);
}

function extractText(resp: { content?: ContentBlock[] }): string {
  return (resp.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const { tickers } = (await req.json()) as Body;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "tickers required" }, { status: 400 });
    }
    const limited = tickers.slice(0, 10);
    const userMsg = `Tickers: ${limited.join(", ")}\n\nReturn JSON.`;

    let resp: { content?: ContentBlock[] };
    let usedFallback = false;

    try {
      resp = await callClaude(SYSTEM_WEB, true, userMsg);
    } catch (webErr) {
      const e = describeError(webErr);
      console.error("[today] web_search call failed:", e.message, "status:", e.status);
      // If the failure looks tool-related (most common: account doesn't have
      // web_search enabled), fall back to a no-tools call that surfaces
      // scheduled catalysts from training data.
      const looksToolRelated =
        /web_search|tool|not.+enabled|not.+supported|invalid_request|400/i.test(e.message) ||
        e.status === 400;
      if (!looksToolRelated) {
        return NextResponse.json(
          { error: `Anthropic call failed: ${e.message}` },
          { status: 500 },
        );
      }
      console.warn("[today] retrying without web_search tool");
      try {
        resp = await callClaude(SYSTEM_FALLBACK, false, userMsg);
        usedFallback = true;
      } catch (fallbackErr) {
        const f = describeError(fallbackErr);
        return NextResponse.json(
          { error: `Anthropic call failed (fallback): ${f.message}` },
          { status: 500 },
        );
      }
    }

    const text = extractText(resp);
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: { items?: unknown } = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[today] JSON parse error:", e, "raw:", text.slice(0, 500));
      return NextResponse.json(
        { error: "Could not parse response from Claude", raw: text.slice(0, 1000) },
        { status: 500 },
      );
    }
    return NextResponse.json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
      asOf: new Date().toISOString(),
      fallback: usedFallback,
    });
  } catch (err) {
    console.error("[today] failed:", err);
    const e = describeError(err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
