import { z } from "zod";
import { parseOptionSymbol } from "./parse-option-symbol";
import {
  createTrade,
  deleteTrade,
  listTrades,
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
  /** Manual / WIP trades flipped to source='portfolio' because the broker
      now actually holds the matching leg. */
  promoted: number;
  skipped: number;
}

// Identity for a single-leg portfolio-synced trade. One sidebar entry per
// leg the user holds in the broker, so a 2-leg vertical shows up as two
// rows. Match key is the full leg coordinates so the sync replaces the
// matching row when premium/IV move and creates a new one when the
// position itself changes.
function legIdentityKey(
  symbol: string,
  l: Pick<Leg, "type" | "side" | "strike" | "expiration">,
): string {
  return `${symbol.toUpperCase()}|${l.expiration}|${l.type}|${l.side}|${l.strike}`;
}

function tradeKey(t: Trade): string | null {
  if (t.legs.length !== 1) return null;
  return legIdentityKey(t.symbol, t.legs[0]);
}

export async function syncPortfolioTrades(
  snapshot: PortfolioSnapshotShape,
): Promise<SyncResult> {
  const holdings = snapshot.holdings ?? [];
  const optionHoldings = holdings.filter(
    (h) => h.assetType === "option" || (h.symbol && /\d{2}\s*[CP]\d|[CP]\d{8}|Call|Put/i.test(h.symbol)),
  );

  // Parse each holding into a single-leg trade payload. Per the user's
  // preference each leg gets its own sidebar entry rather than grouping
  // a multi-leg structure into one trade — easier to scan, and the
  // strategy detection still works per-leg.
  interface ParsedLeg {
    symbol: string;
    leg: Leg;
  }
  const parsedLegs: ParsedLeg[] = [];
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
    parsedLegs.push({ symbol: parsed.underlying, leg });
  }

  // Fetch spot for each unique symbol — best-effort, fall back to 0 (the user
  // can hit "Update spot" later if the auto-fetch missed).
  const symbols = [...new Set(parsedLegs.map((p) => p.symbol))];
  const spotMap = new Map<string, number>();
  await Promise.all(
    symbols.map(async (s) => {
      const price = await fetchSpotPrice(s);
      if (price != null) spotMap.set(s, price);
    }),
  );

  // Build target trade payloads — one per leg.
  const targets: Trade[] = parsedLegs.map(({ symbol, leg }) => ({
    symbol,
    underlyingPrice: spotMap.get(symbol) ?? 0,
    riskFreeRate: 0.045,
    legs: [leg],
    source: "portfolio",
  }));

  // Reconcile against existing trades.
  //  - Portfolio-sourced existing trades: update / delete to mirror the
  //    upload exactly.
  //  - Manual ('WIP') trades that match an incoming portfolio leg get
  //    *promoted* in-place: source flipped to 'portfolio' and broker
  //    fields (premium / IV / spot) overwritten. The trade id, checklist
  //    state, and notes survive. Rationale: if it's in the broker, the
  //    sidebar should call it live — the WIP badge means "not yet in the
  //    broker," and a match disproves that.
  //  - Manual trades that *don't* match any portfolio leg stay manual and
  //    untouched.
  const allExisting = await listTrades();
  const portfolioExisting = allExisting.filter((t) => t.source === "portfolio");
  const manualByKey = new Map<string, Trade>();
  for (const t of allExisting) {
    if (t.source !== "manual") continue;
    const k = tradeKey(t);
    if (k) manualByKey.set(k, t);
  }

  const existingByKey = new Map<string, Trade>();
  for (const e of portfolioExisting) {
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
  let promoted = 0;

  // Delete: in portfolio-sourced existing but no longer in the upload
  // (closed positions). Manual trades are not in this list, so they are
  // never deleted.
  for (const e of portfolioExisting) {
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

  // Promote, update, or create.
  for (const t of targets) {
    const k = tradeKey(t)!;
    const manualPrior = manualByKey.get(k);
    if (manualPrior?.id) {
      // Promotion: the broker now holds a leg that previously existed only
      // as an aspirational WIP. Flip source to 'portfolio' and refresh the
      // leg/spot from the upload. Trade id + notes + checklist stay.
      try {
        await updateTrade(manualPrior.id, { ...t, id: manualPrior.id });
        promoted++;
      } catch (err) {
        console.warn("[sync] promote failed for", manualPrior.id, err);
      }
      continue;
    }
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

  return { created, updated, deleted, promoted, skipped };
}
