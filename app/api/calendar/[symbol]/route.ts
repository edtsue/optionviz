import { NextResponse } from "next/server";
import { z } from "zod";
import { TickerSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

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

const TTL_MS = 60 * 60 * 1000;
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

    const result = await fetchCalendar(ticker);
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
