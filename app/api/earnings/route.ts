import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TickerSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { EARNINGS_WATCHLIST } from "@/lib/earnings-watchlist";
import { parseOptionSymbol } from "@/lib/parse-option-symbol";
import { supabaseAdmin } from "@/lib/supabase/admin.server";
import { anthropic, CHEAP_MODEL } from "@/lib/claude";
import { parseClaudeJsonRaw } from "@/lib/claude-json";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 60;
const MAX_TICKERS = 60;

interface EarningsItem {
  ticker: string;
  earningsDate: string; // ISO
  daysUntil: number;
  isPortfolioHolding: boolean;
  isEstimate: boolean;
  epsEstimate: number | null;
  callDate: string | null; // ISO if separately published
}

interface EarningsResponse {
  asOf: string;
  windowDays: number;
  items: EarningsItem[];
  errors: string[];
}

const BodySchema = z.object({
  tickers: z.array(TickerSchema).max(MAX_TICKERS).optional(),
  windowDays: z.number().int().min(1).max(MAX_WINDOW_DAYS).optional(),
});

interface PortfolioHolding {
  symbol?: string;
  name?: string | null;
  assetType?: string | null;
}

async function fetchPortfolioTickers(): Promise<Set<string>> {
  const held = new Set<string>();
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("portfolios")
      .select("snapshot")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return held;
    const snapshot = (data as { snapshot?: { holdings?: PortfolioHolding[] } }).snapshot;
    const holdings = snapshot?.holdings ?? [];
    for (const h of holdings) {
      if (!h.symbol) continue;
      const symU = h.symbol.toUpperCase();
      if (symU === "CASH" || h.assetType === "cash") continue;
      if (h.assetType === "option") {
        const parsed = parseOptionSymbol(h.symbol) ?? parseOptionSymbol(h.name ?? null);
        if (parsed?.underlying) held.add(parsed.underlying.toUpperCase());
        continue;
      }
      if (!/\s/.test(symU) && /^[A-Z][A-Z0-9.]{0,7}$/.test(symU)) {
        held.add(symU);
      } else {
        const parsed = parseOptionSymbol(h.symbol) ?? parseOptionSymbol(h.name ?? null);
        if (parsed?.underlying) held.add(parsed.underlying.toUpperCase());
      }
    }
  } catch {
    // Supabase unavailable in dev or env not set — treat as empty portfolio.
  }
  return held;
}

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
                    .array(z.object({ raw: z.number().optional() }).passthrough())
                    .optional(),
                  earningsCallDate: z
                    .array(z.object({ raw: z.number().optional() }).passthrough())
                    .optional(),
                  isEarningsDateEstimate: z.boolean().optional(),
                  earningsAverage: z
                    .object({ raw: z.number().optional() })
                    .passthrough()
                    .optional(),
                })
                .passthrough()
                .optional(),
            })
            .passthrough()
            .nullish(),
        }),
      )
      .nullish(),
    error: z.unknown().nullish(),
  }),
});

interface RawEarnings {
  earningsTs: number | null;
  callTs: number | null;
  isEstimate: boolean;
  epsEstimate: number | null;
}

async function fetchEarningsFromYahoo(ticker: string): Promise<RawEarnings | null> {
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
    console.warn(`[earnings] yahoo fetch failed for ${ticker}:`, e);
    return null;
  }
  if (!res.ok) return null;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const parsed = QuoteSummarySchema.safeParse(data);
  if (!parsed.success) return null;
  const cal = parsed.data.quoteSummary.result?.[0]?.calendarEvents;
  if (!cal) return null;
  const earnings = cal.earnings;
  if (!earnings) return null;
  const earningsTs = earnings.earningsDate?.[0]?.raw ?? null;
  const callTs = earnings.earningsCallDate?.[0]?.raw ?? null;
  return {
    earningsTs: typeof earningsTs === "number" ? earningsTs : null,
    callTs: typeof callTs === "number" ? callTs : null,
    isEstimate: earnings.isEarningsDateEstimate ?? false,
    epsEstimate:
      typeof earnings.earningsAverage?.raw === "number"
        ? earnings.earningsAverage.raw
        : null,
  };
}

function daysBetween(now: number, future: number): number {
  return Math.round((future - now) / (1000 * 60 * 60 * 24));
}

// ----- Claude web_search fallback ---------------------------------------
//
// Yahoo's quoteSummary endpoint returns nothing for many large-cap tickers
// without auth cookies — NVDA/AAPL/etc. silently drop out of the list. When
// that happens for a ticker the user actually cares about (portfolio holding
// or explicitly requested), we ask Haiku 4.5 to web_search the next earnings
// date and parse the result. Cached server-side for 6h because earnings
// schedules don't move often, and only the FIRST refresh after a release
// pays the search cost.

const CLAUDE_TTL_MS = 6 * 60 * 60 * 1000;
const claudeCache = new Map<string, { raw: RawEarnings | null; ts: number }>();

const CLAUDE_SYSTEM = `You look up the NEXT upcoming earnings call/report date for a US-listed ticker using the web_search tool.

Strategy:
1. Search "<TICKER> next earnings date <current year>". Look for an investor-relations press release or a finance card (Yahoo, Nasdaq, Zacks, Seeking Alpha, IR site).
2. If the first hit is ambiguous or only shows the LAST report, search "<TICKER> earnings call <month> <year>" or "<TICKER> investor relations earnings".
3. Up to 3 searches.

Return ONLY a JSON object (no prose, no fences):
{
  "earningsDate": "YYYY-MM-DD",         // best date you can confirm; null if unsure
  "callDate": "YYYY-MM-DDTHH:MM:SSZ" | "YYYY-MM-DD" | null,  // separately published call timestamp if shown
  "isEstimate": boolean,                 // true if labeled "estimated" / "tentative"
  "source": "<short source name>"        // e.g. "NVIDIA IR", "Nasdaq", "Yahoo"
}

If you cannot confirm a date in the next 90 days after at most 3 searches, return:
{ "earningsDate": null, "callDate": null, "isEstimate": false, "source": "no result" }`;

interface ContentBlock {
  type: string;
  text?: string;
}

const ClaudeEarningsSchema = z.object({
  earningsDate: z.string().nullable().optional(),
  callDate: z.string().nullable().optional(),
  isEstimate: z.boolean().optional(),
  source: z.string().optional(),
});

function isoToTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T13:00:00Z` : s);
  const t = d.getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

async function fetchEarningsFromClaude(ticker: string): Promise<RawEarnings | null> {
  const cached = claudeCache.get(ticker);
  if (cached && Date.now() - cached.ts < CLAUDE_TTL_MS) return cached.raw;

  let raw: RawEarnings | null = null;
  try {
    // web_search is a server-side tool not in the SDK's Tool union, so cast at
    // the SDK boundary only.
    const resp = await anthropic().messages.create({
      model: CHEAP_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: CLAUDE_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [
        {
          role: "user",
          content: `Today is ${new Date().toISOString().slice(0, 10)}. What is the next earnings call/report date for ${ticker}? Return JSON only.`,
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
    const result = parsed ? ClaudeEarningsSchema.safeParse(parsed) : null;
    if (result?.success) {
      const safe = result.data;
      const earningsTs = isoToTs(safe.earningsDate ?? null);
      const callTs = isoToTs(safe.callDate ?? null);
      if (earningsTs) {
        raw = {
          earningsTs,
          callTs,
          isEstimate: safe.isEstimate ?? true,
          epsEstimate: null,
        };
      }
    }
  } catch (e) {
    console.warn(`[earnings] claude fallback failed for ${ticker}:`, e);
  }

  claudeCache.set(ticker, { raw, ts: Date.now() });
  return raw;
}

export async function POST(req: NextRequest) {
  try {
    // 6 calls/min per IP — each call fans out to ~30 Yahoo requests, so be
    // stricter than the news route.
    const rl = rateLimit(`earnings:${clientIp(req)}`, 6, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsedReq = BodySchema.safeParse(raw);
    if (!parsedReq.success) {
      return NextResponse.json(
        { error: parsedReq.error.issues[0]?.message ?? "invalid request" },
        { status: 400 },
      );
    }
    const windowDays = parsedReq.data.windowDays ?? DEFAULT_WINDOW_DAYS;
    const explicitTickers = parsedReq.data.tickers;

    const portfolioTickers = await fetchPortfolioTickers();

    // Universe = explicit list (if given) ∪ portfolio ∪ curated watchlist.
    // Insertion order matters: when the universe exceeds MAX_TICKERS, the tail
    // is dropped — so prioritize what the caller explicitly asked for, then
    // their holdings, then the curated list.
    const universe = new Set<string>();
    if (explicitTickers) for (const t of explicitTickers) universe.add(t);
    for (const t of portfolioTickers) universe.add(t);
    for (const t of EARNINGS_WATCHLIST) universe.add(t);

    const tickers = [...universe].slice(0, MAX_TICKERS);
    const now = Date.now();
    const windowEndMs = now + windowDays * 24 * 60 * 60 * 1000;

    const results = await Promise.allSettled(
      tickers.map(async (t) => ({ ticker: t, raw: await fetchEarningsFromYahoo(t) })),
    );

    // Tickers the user explicitly cares about — Claude fallback only burns
    // tokens on these. Watchlist-only tickers stay Yahoo-only because filling
    // them all would mean ~30 web_search calls every cold cache.
    const userTickers = new Set<string>();
    if (explicitTickers) for (const t of explicitTickers) userTickers.add(t);
    for (const t of portfolioTickers) userTickers.add(t);

    const yahooByTicker = new Map<string, RawEarnings | null>();
    for (const r of results) {
      if (r.status === "rejected") continue;
      yahooByTicker.set(r.value.ticker, r.value.raw);
    }

    // Backfill Yahoo misses with Claude+web_search for the tickers we care
    // about. Run in parallel; cache makes repeats cheap.
    const claudeBackfillTargets = [...userTickers].filter(
      (t) => !yahooByTicker.get(t)?.earningsTs,
    );
    const claudeResults = await Promise.allSettled(
      claudeBackfillTargets.map(async (t) => ({
        ticker: t,
        raw: await fetchEarningsFromClaude(t),
      })),
    );
    const claudeByTicker = new Map<string, RawEarnings | null>();
    for (const r of claudeResults) {
      if (r.status === "fulfilled") claudeByTicker.set(r.value.ticker, r.value.raw);
    }

    const items: EarningsItem[] = [];
    const errors: string[] = [];
    for (const ticker of tickers) {
      // Prefer Yahoo (has EPS estimates etc.); fall back to Claude.
      const raw = yahooByTicker.get(ticker)?.earningsTs
        ? yahooByTicker.get(ticker)
        : claudeByTicker.get(ticker) ?? null;
      if (!raw) {
        errors.push(ticker);
        continue;
      }
      if (!raw.earningsTs) continue;
      const earningsMs = raw.earningsTs * 1000;
      if (earningsMs < now - 24 * 60 * 60 * 1000) continue; // skip past
      if (earningsMs > windowEndMs) continue;
      items.push({
        ticker,
        earningsDate: new Date(earningsMs).toISOString(),
        daysUntil: daysBetween(now, earningsMs),
        isPortfolioHolding: portfolioTickers.has(ticker),
        isEstimate: raw.isEstimate,
        epsEstimate: raw.epsEstimate,
        callDate: raw.callTs ? new Date(raw.callTs * 1000).toISOString() : null,
      });
    }

    // Portfolio holdings first, then chronological. Confirmed dates beat
    // estimates within the same day so users see locked schedules first.
    items.sort((a, b) => {
      if (a.isPortfolioHolding !== b.isPortfolioHolding) {
        return a.isPortfolioHolding ? -1 : 1;
      }
      const dt = a.earningsDate.localeCompare(b.earningsDate);
      if (dt !== 0) return dt;
      if (a.isEstimate !== b.isEstimate) return a.isEstimate ? 1 : -1;
      return a.ticker.localeCompare(b.ticker);
    });

    const body: EarningsResponse = {
      asOf: new Date().toISOString(),
      windowDays,
      items,
      errors,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[earnings] failed:", err);
    const m = err instanceof Error ? err.message : "earnings failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
