import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_WEB = `You are a markets news synthesizer. Use web_search to find news from the past 24 hours per ticker.

STRICT LIMITS (to stay under token budget):
- MAX 2 items per ticker. Pick the 2 most material.
- ONLY return "high" or "medium" importance items. Drop "low".
- headline: ≤ 90 chars
- summary: ≤ 110 chars, 1 sentence
- impact: ≤ 90 chars, 1 sentence on why it matters for IV / direction
- Skip tickers with no qualifying news.

Qualify as news (else skip): earnings results / guidance, regulator action, M&A, downgrade/upgrade with material PT move, FDA, lawsuits with real exposure, exec departures, product events that change expectations.

Skip: rumors, generic sector pieces, routine analyst notes, "stock could move on…" filler.

Mark "high" ONLY for: earnings beat/miss, formal guidance change, regulator/SEC action, M&A, exec departure, material lawsuit, large PT moves (>10%).

Output format (no markdown, no prose, JSON only):
{"items":[{"ticker":"AAPL","items":[{"headline":"…","summary":"…","impact":"…","importance":"high|medium","source":"domain.com","url":"…"|null}]}]}`;

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
    max_tokens: 4500, // tight prompt + 4500 tokens leaves comfortable headroom
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
  if (useWebSearch) {
    params.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  }
  // SDK doesn't type web_search; cast through unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await anthropic().messages.create(params as any);
}

function tryStrictParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

// Repair a JSON string that was truncated mid-content (typical when the model
// hits max_tokens). We chip characters off the end until JSON.parse accepts it,
// padding with the structural closers as needed.
function tryRepairJson(raw: string): unknown | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  // First try as-is.
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Walk back to the last complete '}' or ']' and try closing brackets.
  for (let i = cleaned.length - 1; i > 0; i--) {
    const ch = cleaned[i];
    if (ch !== "}" && ch !== "]") continue;
    let candidate = cleaned.slice(0, i + 1);
    // Auto-balance any unclosed brackets on the trailing side.
    const opens = (candidate.match(/[{[]/g) ?? []).length;
    const closes = (candidate.match(/[}\]]/g) ?? []).length;
    if (opens > closes) {
      // Try padding with missing closers
      candidate += "]".repeat(Math.max(0, opens - closes));
    }
    try {
      return JSON.parse(candidate);
    } catch {}
    // Try adding "}]}" to close common shape { "items": [ { "items": [ ...
    try {
      return JSON.parse(cleaned.slice(0, i + 1) + '"}]}]}');
    } catch {}
  }
  return null;
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
    const limited = tickers.slice(0, 8);
    const userMsg = `Tickers: ${limited.join(", ")}. JSON only.`;

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
    const repaired = tryRepairJson(text);
    if (repaired == null) {
      console.error("[today] JSON parse failed even after repair. Raw head:", text.slice(0, 500));
      return NextResponse.json(
        { error: "Couldn't parse Claude's response (likely truncated). Try again with fewer tickers." },
        { status: 500 },
      );
    }
    const parsed = repaired as { items?: unknown };
    const truncated = repaired !== null && tryStrictParse(text) === null;
    return NextResponse.json({
      items: Array.isArray(parsed.items) ? parsed.items : [],
      asOf: new Date().toISOString(),
      fallback: usedFallback,
      truncated,
    });
  } catch (err) {
    console.error("[today] failed:", err);
    const e = describeError(err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
