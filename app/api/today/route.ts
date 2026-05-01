import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM_WEB = `You synthesize markets news. For each ticker, use web_search to find the SINGLE most important story (last 7 days, prefer last 24h). Return EXACTLY ONE item per ticker.

Hard caps:
- 1 item per ticker. Always include every ticker the user lists.
- headline ≤ 80 chars · summary ≤ 100 chars · impact ≤ 80 chars
- importance: "high" | "medium" | "low"
- source: domain only (e.g. "reuters.com")

Importance:
- "high": earnings beat/miss, formal guidance change, regulator/SEC action, M&A, exec departure, material lawsuit, PT moves >10%, FDA action.
- "medium": notable analyst note, smaller PT change, sector move that materially affects this name, product launch, partnership.
- "low": no real news; brief context only.

If genuinely no news: headline "No notable news", importance "low", summary = brief context.

Output JSON ONLY:
{"items":[{"ticker":"AAPL","items":[{"headline":"…","summary":"…","impact":"…","importance":"high|medium|low","source":"…","url":null}]}]}`;

const SYSTEM_FALLBACK = `For each ticker, list the SINGLE most material upcoming or recent catalyst from your training data (earnings, ex-div, FDA, product event, FOMC). One item per ticker. Hard caps: headline ≤ 80, summary ≤ 100, impact ≤ 80. importance: "high" | "medium" | "low". source: "knowledge cutoff". url: null. If unknown, headline="No known catalyst", low importance.

Output JSON ONLY: {"items":[{"ticker":"AAPL","items":[{"headline":"…","summary":"…","impact":"…","importance":"…","source":"knowledge cutoff","url":null}]}], "fallback":true}`;

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

const CHUNK_SIZE = 4; // tickers per Anthropic call
const MAX_CHUNKS = 4; // hard cap to keep cost bounded (16 tickers max)

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
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  };
  if (useWebSearch) {
    params.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
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
    // chip from end
    for (let i = cleaned.length - 1; i > 100; i--) {
      const ch = cleaned[i];
      if (ch !== "}" && ch !== "]") continue;
      const candidate = cleaned.slice(0, i + 1);
      const opens = (candidate.match(/[{[]/g) ?? []).length;
      const closes = (candidate.match(/[}\]]/g) ?? []).length;
      if (opens > closes) {
        const closersNeeded = opens - closes;
        try {
          return JSON.parse(candidate + "]}".repeat(Math.ceil(closersNeeded / 2)));
        } catch {}
        try {
          return JSON.parse(candidate + "}]}".repeat(closersNeeded));
        } catch {}
      } else {
        try {
          return JSON.parse(candidate);
        } catch {}
      }
    }
    return null;
  }
}

async function searchChunk(tickers: string[], useWebSearch: boolean): Promise<{
  items: TickerNews[];
  usedFallback: boolean;
  error?: string;
}> {
  const userMsg = `Tickers: ${tickers.join(", ")}. JSON only.`;
  let resp: { content?: ContentBlock[] };
  let usedFallback = false;
  try {
    resp = await callClaude(useWebSearch ? SYSTEM_WEB : SYSTEM_FALLBACK, useWebSearch, userMsg);
  } catch (err) {
    const e = describeError(err);
    if (useWebSearch && (/web_search|tool|invalid_request|400/i.test(e.message) || e.status === 400)) {
      console.warn("[today] retrying chunk without web_search:", e.message);
      try {
        resp = await callClaude(SYSTEM_FALLBACK, false, userMsg);
        usedFallback = true;
      } catch (err2) {
        return { items: [], usedFallback: false, error: describeError(err2).message };
      }
    } else {
      return { items: [], usedFallback: false, error: e.message };
    }
  }
  const text = extractText(resp);
  const parsed = tryParse(text) as { items?: TickerNews[] } | null;
  if (!parsed) {
    console.error("[today] chunk parse failed. Raw head:", text.slice(0, 500));
    return { items: [], usedFallback, error: "parse failed" };
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return { items, usedFallback };
}

export async function POST(req: NextRequest) {
  try {
    const { tickers } = (await req.json()) as Body;
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "tickers required" }, { status: 400 });
    }
    const limited = tickers.slice(0, CHUNK_SIZE * MAX_CHUNKS);
    const chunks: string[][] = [];
    for (let i = 0; i < limited.length; i += CHUNK_SIZE) {
      chunks.push(limited.slice(i, i + CHUNK_SIZE));
    }

    const results = await Promise.allSettled(chunks.map((c) => searchChunk(c, true)));

    const allItems: TickerNews[] = [];
    let anyFallback = false;
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        allItems.push(...r.value.items);
        if (r.value.usedFallback) anyFallback = true;
        if (r.value.error) errors.push(r.value.error);
      } else {
        errors.push(describeError(r.reason).message);
      }
    }

    if (allItems.length === 0) {
      return NextResponse.json(
        { error: errors[0] ?? "No items returned" },
        { status: 500 },
      );
    }

    // Preserve user-requested ordering
    const order = new Map(limited.map((t, i) => [t.toUpperCase(), i]));
    allItems.sort(
      (a, b) =>
        (order.get(a.ticker.toUpperCase()) ?? 999) -
        (order.get(b.ticker.toUpperCase()) ?? 999),
    );

    return NextResponse.json({
      items: allItems,
      asOf: new Date().toISOString(),
      fallback: anyFallback,
      partial: errors.length > 0 && allItems.length > 0,
    });
  } catch (err) {
    console.error("[today] failed:", err);
    const e = describeError(err);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
