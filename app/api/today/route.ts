import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_WEB = `You synthesize markets news. For EACH ticker the user provides (max 3), use web_search to find the TOP 2 most material news items from the last 7 days (prefer last 24h). Return up to 2 items per ticker.

Hard caps:
- 2 items per ticker maximum.
- Always include every ticker the user lists, even if news is light.
- headline ≤ 100 chars · summary ≤ 130 chars · impact ≤ 100 chars
- importance: "high" | "medium" | "low"
- source: domain only (e.g. "reuters.com")
- url: link if known, else null

Importance:
- "high": earnings beat/miss, formal guidance change, regulator/SEC action, M&A involving the ticker, exec departure, material lawsuit, PT moves >10%, FDA action.
- "medium": notable analyst note, smaller PT change, sector move that materially affects the name, product launch, partnership.
- "low": general context only.

If a ticker has zero news: return one item with headline "No notable news", importance "low", and a short context sentence. Do not fabricate.

Output JSON ONLY (no markdown):
{"items":[{"ticker":"AAPL","items":[{"headline":"…","summary":"…","impact":"…","importance":"high|medium|low","source":"…","url":"…"|null}]}]}`;

const SYSTEM_FALLBACK = `For EACH ticker (max 3), list up to 2 known catalysts from your training data (recent earnings, upcoming earnings, ex-div, FDA, FOMC, product event). Hard caps: headline ≤ 100, summary ≤ 130, impact ≤ 100. importance: "high"|"medium"|"low". source: "knowledge cutoff". url: null. If unknown: headline="No known catalyst", importance "low".

Output JSON ONLY: {"items":[{"ticker":"AAPL","items":[…]}], "fallback":true}`;

interface Body {
  tickers: string[];
}
interface ContentBlock {
  type: string;
  text?: string;
}
interface NewsItem {
  headline: string;
  summary: string;
  impact: string;
  importance: "high" | "medium" | "low";
  source?: string | null;
  url?: string | null;
}
interface TickerNews {
  ticker: string;
  items: NewsItem[];
}

const MAX_TICKERS = 3;

function describeError(err: unknown): { message: string; status?: number } {
  if (err && typeof err === "object") {
    const e = err as { status?: number; message?: string; error?: { message?: string } };
    return { message: e.error?.message ?? e.message ?? "Unknown", status: e.status };
  }
  return { message: String(err) };
}

async function callClaude(systemPrompt: string, useWebSearch: boolean, content: string) {
  const params: Record<string, unknown> = {
    model: REASONING_MODEL,
    max_tokens: 4500,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
  if (useWebSearch) {
    params.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await anthropic().messages.create(params as any);
}

function extractText(resp: { content?: ContentBlock[] }): string {
  return (resp.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function tryParse(raw: string): unknown | null {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    for (let i = cleaned.length - 1; i > 100; i--) {
      const ch = cleaned[i];
      if (ch !== "}" && ch !== "]") continue;
      const candidate = cleaned.slice(0, i + 1);
      const opens = (candidate.match(/[{[]/g) ?? []).length;
      const closes = (candidate.match(/[}\]]/g) ?? []).length;
      if (opens > closes) {
        for (const closer of ["]}", "}]}", "]}]}", "}]}]}"]) {
          try {
            return JSON.parse(candidate + closer);
          } catch {}
        }
      } else {
        try {
          return JSON.parse(candidate);
        } catch {}
      }
    }
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tickers } = (await req.json()) as Body;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "Pick 1–3 tickers" }, { status: 400 });
    }
    if (tickers.length > MAX_TICKERS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_TICKERS} tickers per request` },
        { status: 400 },
      );
    }

    const userMsg = `Tickers: ${tickers.join(", ")}. Return JSON only.`;

    let resp: { content?: ContentBlock[] };
    let usedFallback = false;

    try {
      resp = await callClaude(SYSTEM_WEB, true, userMsg);
    } catch (webErr) {
      const e = describeError(webErr);
      console.error("[today] web_search failed:", e.message, "status:", e.status);
      const looksToolRelated =
        /web_search|tool|invalid_request|400/i.test(e.message) || e.status === 400;
      if (!looksToolRelated) {
        return NextResponse.json(
          { error: `Anthropic call failed: ${e.message}` },
          { status: 500 },
        );
      }
      try {
        resp = await callClaude(SYSTEM_FALLBACK, false, userMsg);
        usedFallback = true;
      } catch (fallbackErr) {
        return NextResponse.json(
          { error: `Anthropic call failed (fallback): ${describeError(fallbackErr).message}` },
          { status: 500 },
        );
      }
    }

    const text = extractText(resp);
    const parsed = tryParse(text) as { items?: TickerNews[] } | null;
    if (!parsed) {
      console.error("[today] parse failed. Head:", text.slice(0, 600));
      return NextResponse.json(
        { error: "Couldn't parse Claude's response. Try again." },
        { status: 500 },
      );
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // Preserve user-requested ordering
    const order = new Map(tickers.map((t, i) => [t.toUpperCase(), i]));
    items.sort(
      (a, b) =>
        (order.get(a.ticker.toUpperCase()) ?? 999) -
        (order.get(b.ticker.toUpperCase()) ?? 999),
    );

    return NextResponse.json({
      items,
      asOf: new Date().toISOString(),
      fallback: usedFallback,
    });
  } catch (err) {
    console.error("[today] failed:", err);
    return NextResponse.json({ error: describeError(err).message }, { status: 500 });
  }
}
