import { NextResponse } from "next/server";
import { z } from "zod";
import { TickerSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { anthropic, CHEAP_MODEL } from "@/lib/claude";
import { parseClaudeJsonRaw } from "@/lib/claude-json";

export const runtime = "nodejs";
export const maxDuration = 30;

// Next earnings + ex-div dates from Yahoo's quoteSummary endpoint. No key, no
// Claude. Cached server-side for an hour because these don't change much.
//
// Output: { earnings: "2026-05-22" | null, dividend: "2026-04-15" | null,
//           source: "Yahoo" }

interface CalendarResult {
  earnings: string | null;
  dividend: string | null;
  source: "Yahoo";
}

// Bumped from 1h to 6h since the Claude fallback is comparatively expensive
// and earnings/dividend calendars don't move often.
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { result: CalendarResult; ts: number }>();

const QuoteSummarySchema = z.object({
  quoteSummary: z.object({
    result: z
      .array(
        z.object({
          calendarEvents: z
            .object({
              earnings: z
                .object({
                  earningsDate: z
                    .array(z.object({ raw: z.number().optional() }))
                    .optional(),
                })
                .nullish(),
              exDividendDate: z.object({ raw: z.number().optional() }).nullish(),
              dividendDate: z.object({ raw: z.number().optional() }).nullish(),
            })
            .nullish(),
        }),
      )
      .nullish(),
    error: z.unknown().nullish(),
  }),
});

function rawToIsoDate(raw?: number): string | null {
  if (!raw || !Number.isFinite(raw)) return null;
  return new Date(raw * 1000).toISOString().slice(0, 10);
}

async function fetchCalendar(ticker: string): Promise<CalendarResult | null> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    ticker,
  )}?modules=calendarEvents`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OptionViz/1.0; +https://optionviz.vercel.app)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (e) {
    console.warn("[calendar] yahoo fetch failed:", e);
    return null;
  }
  if (!res.ok) {
    console.warn("[calendar] yahoo non-ok:", res.status);
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const parsed = QuoteSummarySchema.safeParse(data);
  if (!parsed.success) return null;
  const ev = parsed.data.quoteSummary.result?.[0]?.calendarEvents;
  if (!ev) return { earnings: null, dividend: null, source: "Yahoo" };
  const earnings = rawToIsoDate(ev.earnings?.earningsDate?.[0]?.raw);
  // Prefer ex-div (the date you have to own by) over the pay date.
  const dividend = rawToIsoDate(ev.exDividendDate?.raw ?? ev.dividendDate?.raw);
  return { earnings, dividend, source: "Yahoo" };
}

// ----- Claude web_search fallback ---------------------------------------
//
// Mirrors the /api/earnings backfill: Yahoo's quoteSummary returns nothing
// for many large-cap tickers without auth cookies (NVDA, AAPL, etc.), so the
// per-trade earnings/ex-div chip silently disappears for the very tickers
// users care about. When Yahoo blanks, ask Haiku 4.5 to web_search both the
// next earnings date and the next ex-dividend date.

const ClaudeCalendarSchema = z.object({
  earningsDate: z.string().nullable().optional(),
  dividendDate: z.string().nullable().optional(),
});

const CLAUDE_SYSTEM = `You look up the next earnings call/report date and the next ex-dividend date for a US-listed ticker using web_search.

Strategy:
1. Search "<TICKER> next earnings date" — finance card or IR press release.
2. Search "<TICKER> next ex-dividend date" — finance card or company IR.
3. Up to 3 searches total.

Return ONLY a JSON object (no prose, no fences):
{
  "earningsDate": "YYYY-MM-DD" | null,
  "dividendDate": "YYYY-MM-DD" | null
}

Use null for either field you cannot confirm. Only return dates in the next 120 days; if a date is more than 120 days out or unconfirmed, return null.`;

interface ContentBlock {
  type: string;
  text?: string;
}

async function fetchFromClaude(ticker: string): Promise<CalendarResult | null> {
  try {
    const resp = await anthropic().messages.create({
      model: CHEAP_MODEL,
      max_tokens: 512,
      system: [{ type: "text", text: CLAUDE_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [
        {
          role: "user",
          content: `Today is ${new Date().toISOString().slice(0, 10)}. Find the next earnings date and next ex-dividend date for ${ticker}. Return JSON only.`,
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
    const parsed = parseClaudeJsonRaw(text);
    const result = parsed ? ClaudeCalendarSchema.safeParse(parsed) : null;
    if (!result?.success) return null;
    const earnings = normalizeIsoDate(result.data.earningsDate ?? null);
    const dividend = normalizeIsoDate(result.data.dividendDate ?? null);
    if (!earnings && !dividend) return null;
    return { earnings, dividend, source: "Yahoo" };
  } catch (e) {
    console.warn(`[calendar] claude fallback failed for ${ticker}:`, e);
    return null;
  }
}

function normalizeIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  // Accept "YYYY-MM-DD" or full ISO with time. Strip to date.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return m[1];
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const rl = rateLimit(`calendar:${clientIp(req)}`, 30, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const { symbol } = await params;
    const tickerParse = TickerSchema.safeParse(symbol);
    if (!tickerParse.success) {
      return NextResponse.json({ error: "invalid ticker" }, { status: 400 });
    }
    const ticker = tickerParse.data;

    const cached = cache.get(ticker);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      return NextResponse.json(cached.result);
    }

    const yahoo = await fetchCalendar(ticker);
    // Use Claude when Yahoo returned nothing OR when both fields blanked —
    // a common case for big-cap tickers where Yahoo has the row but the
    // calendar block is empty.
    const yahooEmpty = !yahoo || (!yahoo.earnings && !yahoo.dividend);
    const result = yahooEmpty ? await fetchFromClaude(ticker) : yahoo;
    if (!result) {
      return NextResponse.json(
        { error: `Could not fetch calendar for ${ticker}` },
        { status: 502 },
      );
    }
    cache.set(ticker, { result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[calendar] failed:", err);
    const m = err instanceof Error ? err.message : "calendar failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
