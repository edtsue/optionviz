import { NextResponse } from "next/server";
import { z } from "zod";
import { TickerSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

// Approximation of "IV rank" using realized vol from Yahoo daily closes. Real
// IV rank needs an option-chain history feed; this is a free, decent proxy:
// where does today's 30-day realized vol sit in the past year of 30-day
// realized-vol observations?
//
// Output: {
//   currentVol: 0.27,        // 30d annualized realized vol now
//   percentile: 72,          // current vs the past-year distribution (0..100)
//   low: 0.18, high: 0.41,   // min/max 30d-vol over the past year
//   asOf: "2026-05-08T...",  // latest close date
//   source: "Yahoo (realized)"
// }

interface IVRankResult {
  currentVol: number;
  percentile: number;
  low: number;
  high: number;
  asOf: string;
  source: "Yahoo (realized)";
}

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { result: IVRankResult; ts: number }>();

const ChartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z
              .array(
                z.object({
                  close: z.array(z.number().nullable()).optional(),
                }),
              )
              .min(1),
          }),
        }),
      )
      .nullish(),
  }),
});

async function fetchDailyCloses(ticker: string): Promise<{ ts: number[]; close: number[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?interval=1d&range=1y`;
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
    console.warn("[iv-rank] yahoo fetch failed:", e);
    return null;
  }
  if (!res.ok) {
    console.warn("[iv-rank] yahoo non-ok:", res.status);
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const parsed = ChartSchema.safeParse(data);
  if (!parsed.success) return null;
  const r = parsed.data.chart.result?.[0];
  if (!r || !r.timestamp) return null;
  const closes = r.indicators.quote[0].close ?? [];
  const ts: number[] = [];
  const close: number[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    ts.push(r.timestamp[i]);
    close.push(c);
  }
  return ts.length >= 60 ? { ts, close } : null;
}

function rolling30dVol(close: number[]): number[] {
  // Annualized stdev of log returns over a 30-trading-day window.
  const r: number[] = [];
  for (let i = 1; i < close.length; i++) r.push(Math.log(close[i] / close[i - 1]));
  const W = 30;
  const out: number[] = [];
  for (let i = W; i <= r.length; i++) {
    const slice = r.slice(i - W, i);
    const mean = slice.reduce((a, b) => a + b, 0) / W;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (W - 1);
    out.push(Math.sqrt(variance) * Math.sqrt(252));
  }
  return out;
}

function percentile(value: number, samples: number[]): number {
  if (samples.length === 0) return 0;
  let below = 0;
  for (const s of samples) if (s < value) below++;
  return Math.round((below / samples.length) * 100);
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const rl = rateLimit(`iv-rank:${clientIp(req)}`, 30, 60 * 1000);
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

    const series = await fetchDailyCloses(ticker);
    if (!series) {
      return NextResponse.json(
        { error: `Could not fetch history for ${ticker}` },
        { status: 502 },
      );
    }

    const vols = rolling30dVol(series.close);
    if (vols.length < 30) {
      return NextResponse.json(
        { error: `Not enough history for ${ticker}` },
        { status: 502 },
      );
    }
    const currentVol = vols[vols.length - 1];
    const result: IVRankResult = {
      currentVol,
      percentile: percentile(currentVol, vols),
      low: Math.min(...vols),
      high: Math.max(...vols),
      asOf: new Date(series.ts[series.ts.length - 1] * 1000).toISOString(),
      source: "Yahoo (realized)",
    };
    cache.set(ticker, { result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[iv-rank] failed:", err);
    const m = err instanceof Error ? err.message : "iv-rank failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
