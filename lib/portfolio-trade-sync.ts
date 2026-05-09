import { z } from "zod";
import { parseOptionSymbol } from "./parse-option-symbol";
import {
  createTrade,
  deleteTrade,
  listTradesBySource,
  updateTrade,
} from "./trades-repo";
import type { Leg, Trade } from "@/types/trade";

// Yahoo's chart endpoint reused here so the sync route doesn't have to call
// /api/spot internally (which would re-route through the auth middleware
// and eat a round-trip per symbol). Same UA + parser pattern as
// app/api/spot/route.ts; if Yahoo ever moves, fix both.
const YahooSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            regularMarketPrice: z.number(),
            postMarketPrice: z.number().optional(),
            preMarketPrice: z.number().optional(),
          }),
        }),
      )
      .nullish(),
  }),
});

async function fetchSpotPrice(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?interval=1m&range=1d&includePrePost=true`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OptionViz/1.0; +https://optionviz.vercel.app)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = YahooSchema.safeParse(data);
    if (!parsed.success) return null;
    const meta = parsed.data.chart.result?.[0]?.meta;
    if (!meta) return null;
    return meta.postMarketPrice ?? meta.preMarketPrice ?? meta.regularMarketPrice;
  } catch {
    return null;
  }
}

interface PortfolioHolding {
  symbol?: string;
  name?: string | null;
  quantity?: number;
  costBasis?: number | null;
  marketPrice?: number | null;
  iv?: number | null;
  assetType?: string | null;
}

interface PortfolioSnapshotShape {
  holdings?: PortfolioHolding[];
}

interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

// Group key — one trade per (symbol, expiration) pair. A two-leg vertical
// at the same expiry collapses into one trade with two legs; calendars
// (different expiries) end up as two separate trades, which mirrors how the
// rest of the app already treats single-expiry as the simpler case.
function groupKey(symbol: string, expiration: string): string {
  return `${symbol.toUpperCase()}|${expiration}`;
}

function tradeKey(t: Trade): string | null {
  if (t.legs.length === 0) return null;
  // All legs share the same expiration in a portfolio-synced trade by
  // construction. Use the first one.
  return groupKey(t.symbol, t.legs[0].expiration);
}

export async function syncPortfolioTrades(
  snapshot: PortfolioSnapshotShape,
): Promise<SyncResult> {
  const holdings = snapshot.holdings ?? [];
  const optionHoldings = holdings.filter(
    (h) => h.assetType === "option" || (h.symbol && /\d{2}\s*[CP]\d|[CP]\d{8}|Call|Put/i.test(h.symbol)),
  );

  // Parse and group.
  const groups = new Map<string, { symbol: string; expiration: string; legs: Leg[] }>();
  let skipped = 0;
  for (const h of optionHoldings) {
    const parsed =
      parseOptionSymbol(h.symbol ?? null) ?? parseOptionSymbol(h.name ?? null);
    if (!parsed) {
      skipped++;
      continue;
    }
    const qty = Number(h.quantity ?? 0);
    if (!Number.isFinite(qty) || qty === 0) {
      skipped++;
      continue;
    }
    // Brokers report short option positions with negative quantity. The
    // Trade type encodes that as side='short' + positive quantity.
    const side: Leg["side"] = qty < 0 ? "short" : "long";
    const premium =
      typeof h.costBasis === "number" && h.costBasis > 0
        ? h.costBasis
        : typeof h.marketPrice === "number" && h.marketPrice > 0
          ? h.marketPrice
          : 0;
    const leg: Leg = {
      type: parsed.type,
      side,
      strike: parsed.strike,
      expiration: parsed.expiration,
      quantity: Math.abs(qty),
      premium,
      // Portfolio rows expose IV in percent (e.g. 41.08 not 0.4108).
      iv:
        typeof h.iv === "number" && Number.isFinite(h.iv) && h.iv > 0
          ? h.iv / 100
          : null,
    };
    const key = groupKey(parsed.underlying, parsed.expiration);
    const g = groups.get(key);
    if (g) g.legs.push(leg);
    else groups.set(key, { symbol: parsed.underlying, expiration: parsed.expiration, legs: [leg] });
  }

  // Fetch spot for each unique symbol — best-effort, fall back to 0 (the user
  // can hit "Update spot" later if the auto-fetch missed).
  const symbols = [...new Set([...groups.values()].map((g) => g.symbol))];
  const spotMap = new Map<string, number>();
  await Promise.all(
    symbols.map(async (s) => {
      const price = await fetchSpotPrice(s);
      if (price != null) spotMap.set(s, price);
    }),
  );

  // Build target trade payloads.
  const targets: Trade[] = [...groups.values()].map((g) => ({
    symbol: g.symbol,
    underlyingPrice: spotMap.get(g.symbol) ?? 0,
    riskFreeRate: 0.045,
    legs: g.legs,
    source: "portfolio",
  }));

  // Reconcile against existing portfolio-sourced trades. Manual trades stay
  // untouched.
  const existing = await listTradesBySource("portfolio");
  const existingByKey = new Map<string, Trade>();
  for (const e of existing) {
    const k = tradeKey(e);
    if (k) existingByKey.set(k, e);
  }
  const targetByKey = new Map<string, Trade>();
  for (const t of targets) {
    const k = tradeKey(t);
    if (k) targetByKey.set(k, t);
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;

  // Delete: in existing but no longer in portfolio (closed positions).
  for (const e of existing) {
    const k = tradeKey(e);
    if (!k || !targetByKey.has(k)) {
      try {
        await deleteTrade(e.id!);
        deleted++;
      } catch (err) {
        console.warn("[sync] delete failed for", e.id, err);
      }
    }
  }

  // Update or create.
  for (const t of targets) {
    const k = tradeKey(t)!;
    const prior = existingByKey.get(k);
    if (prior?.id) {
      try {
        await updateTrade(prior.id, { ...t, id: prior.id });
        updated++;
      } catch (err) {
        console.warn("[sync] update failed for", prior.id, err);
      }
    } else {
      try {
        await createTrade(t);
        created++;
      } catch (err) {
        console.warn("[sync] create failed for", t.symbol, err);
      }
    }
  }

  return { created, updated, deleted, skipped };
}
