import { bs, yearsBetween, impliedVol, type Greeks } from "./black-scholes";
import type { Leg, Trade } from "@/types/trade";

const CONTRACT_MULT = 100;

function legSign(side: Leg["side"]): number {
  return side === "long" ? 1 : -1;
}

export function intrinsic(leg: Leg, spot: number): number {
  const v = leg.type === "call" ? Math.max(spot - leg.strike, 0) : Math.max(leg.strike - spot, 0);
  return v;
}

// P/L for a leg at a given underlying price and date.
// `valuationDate` falls back to expiration → intrinsic value.
export function legPnL(
  leg: Leg,
  spot: number,
  riskFreeRate: number,
  valuationDate: Date,
): number {
  const expiry = new Date(leg.expiration);
  const T = yearsBetween(valuationDate, expiry);
  const sigma = leg.iv ?? 0.3;
  const value =
    T <= 0
      ? intrinsic(leg, spot)
      : bs({ S: spot, K: leg.strike, T, r: riskFreeRate, sigma, type: leg.type }).price;
  const sign = legSign(leg.side);
  return sign * (value - leg.premium) * leg.quantity * CONTRACT_MULT;
}

export function underlyingPnL(trade: Trade, spot: number): number {
  if (!trade.underlying) return 0;
  return (spot - trade.underlying.costBasis) * trade.underlying.shares;
}

export function totalPnL(trade: Trade, spot: number, valuationDate: Date): number {
  const opt = trade.legs.reduce(
    (acc, l) => acc + legPnL(l, spot, trade.riskFreeRate, valuationDate),
    0,
  );
  return opt + underlyingPnL(trade, spot);
}

// Live P/L vs entry. `spot` is the current underlying price. The dollar P/L
// uses today's date so option legs are valued via Black-Scholes (intrinsic +
// remaining time value), then the entry premiums net out. The percent base
// is the absolute capital at risk: net debit if the trade cost money, total
// premium collected if it was a credit, or share notional for stock-only.
// Returns null when the position has zero capital at risk (degenerate).
export function currentPnL(
  trade: Trade,
  spot: number,
): { dollar: number; percent: number | null } {
  const dollar = totalPnL(trade, spot, new Date());
  let basis = 0;
  for (const l of trade.legs) {
    basis += l.premium * l.quantity * CONTRACT_MULT;
  }
  if (trade.underlying) {
    basis += Math.abs(trade.underlying.shares) * trade.underlying.costBasis;
  }
  const percent = basis > 0 ? (dollar / basis) * 100 : null;
  return { dollar: +dollar.toFixed(2), percent: percent == null ? null : +percent.toFixed(1) };
}

export interface PayoffPoint {
  spot: number;
  expiry: number;
  today: number;
  mid: number;
}

// Build a payoff curve over a range of underlying prices.
// Three series: at expiration, today, and a midpoint date.
// 61 points is enough resolution because recharts' monotone interpolation
// smooths between samples — going higher doubled the Black-Scholes call
// count per chart rebuild for no perceptible visual difference.
export function buildPayoff(trade: Trade, points = 61): PayoffPoint[] {
  const strikes = trade.legs.map((l) => l.strike);
  const center = trade.underlyingPrice;
  const lo = Math.min(center * 0.6, ...strikes) * 0.9;
  const hi = Math.max(center * 1.4, ...strikes) * 1.1;
  const step = (hi - lo) / (points - 1);

  const now = new Date();
  const lastExpiry = new Date(
    Math.max(...trade.legs.map((l) => new Date(l.expiration).getTime())),
  );
  const midDate = new Date((now.getTime() + lastExpiry.getTime()) / 2);

  const out: PayoffPoint[] = [];
  for (let i = 0; i < points; i++) {
    const s = lo + i * step;
    out.push({
      spot: +s.toFixed(2),
      expiry: +totalPnL(trade, s, lastExpiry).toFixed(2),
      today: +totalPnL(trade, s, now).toFixed(2),
      mid: +totalPnL(trade, s, midDate).toFixed(2),
    });
  }
  return out;
}

export type NetGreeks = Greeks;

export function netGreeks(trade: Trade, valuationDate = new Date()): NetGreeks {
  const acc: NetGreeks = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of trade.legs) {
    const expiry = new Date(leg.expiration);
    const T = yearsBetween(valuationDate, expiry);
    const sigma = leg.iv ?? 0.3;
    const g = bs({
      S: trade.underlyingPrice,
      K: leg.strike,
      T,
      r: trade.riskFreeRate,
      sigma,
      type: leg.type,
    });
    const sign = legSign(leg.side) * leg.quantity * CONTRACT_MULT;
    acc.price += sign * g.price;
    acc.delta += sign * g.delta;
    acc.gamma += sign * g.gamma;
    acc.theta += sign * g.theta;
    acc.vega += sign * g.vega;
    acc.rho += sign * g.rho;
  }
  if (trade.underlying) {
    acc.delta += trade.underlying.shares;
  }
  return acc;
}

// Per-share Greeks summed across legs with side sign only (no qty, no contract
// multiplier). Useful when you want broker-comparable units. For a single-leg
// long call, this returns the same numbers your broker shows in the Greeks
// columns. For multi-leg trades (verticals, condors), it's the sum of each
// leg's per-share Greek with the appropriate +/- sign.
export function perShareGreeks(trade: Trade, valuationDate = new Date()): NetGreeks {
  const acc: NetGreeks = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of trade.legs) {
    const expiry = new Date(leg.expiration);
    const T = yearsBetween(valuationDate, expiry);
    const sigma = leg.iv ?? 0.3;
    const g = bs({
      S: trade.underlyingPrice,
      K: leg.strike,
      T,
      r: trade.riskFreeRate,
      sigma,
      type: leg.type,
    });
    const sign = legSign(leg.side);
    acc.price += sign * g.price;
    acc.delta += sign * g.delta;
    acc.gamma += sign * g.gamma;
    acc.theta += sign * g.theta;
    acc.vega += sign * g.vega;
    acc.rho += sign * g.rho;
  }
  return acc;
}

export interface TradeStats {
  maxProfit: number | "unlimited";
  maxLoss: number | "unlimited";
  breakevens: number[];
  cost: number;
  marginEstimate: number;
  pop?: number;
}

export function tradeStats(trade: Trade): TradeStats {
  const payoff = buildPayoff(trade, 401);
  const expVals = payoff.map((p) => p.expiry);
  const maxP = Math.max(...expVals);
  const minP = Math.min(...expVals);

  // Detect unbounded payoff by slope per dollar of underlying. Threshold is
  // ≥ $1 P/L per $1 underlying (≈ one contract's worth of delta) to avoid
  // tripping on floating-point noise from far-OTM legs.
  const last = payoff.length - 1;
  const leftDx = payoff[1].spot - payoff[0].spot || 1;
  const rightDx = payoff[last].spot - payoff[last - 1].spot || 1;
  const leftSlope = (expVals[1] - expVals[0]) / leftDx;
  const rightSlope = (expVals[last] - expVals[last - 1]) / rightDx;
  const unboundedUp = rightSlope >= 1;
  const unboundedDown = leftSlope <= -1;

  // Breakevens via sign changes of expiry P/L.
  const breakevens: number[] = [];
  for (let i = 1; i < payoff.length; i++) {
    const a = payoff[i - 1];
    const b = payoff[i];
    if (a.expiry === 0) breakevens.push(a.spot);
    else if ((a.expiry < 0 && b.expiry > 0) || (a.expiry > 0 && b.expiry < 0)) {
      const t = -a.expiry / (b.expiry - a.expiry);
      breakevens.push(+(a.spot + t * (b.spot - a.spot)).toFixed(2));
    }
  }

  const cost = trade.legs.reduce(
    (acc, l) => acc + legSign(l.side) * l.premium * l.quantity * CONTRACT_MULT,
    0,
  );

  // Rough margin estimate. Real broker margin varies — this is directional.
  // Detects:
  //   - covered call: short call fully covered by shares → 0 margin
  //   - vertical credit spread: short leg paired with same-type long further
  //     OTM at same expiry → margin = width × qty × 100 (less the credit)
  //   - cash-secured put: full strike collateral
  //   - naked short call: Reg-T style max(20%S − OTM, 10%K) × 100 × qty
  let margin = 0;
  let sharesCovering = trade.underlying?.shares ?? 0;
  for (const l of trade.legs) {
    if (l.side !== "short") continue;
    // Covered-call test (call only): consume 100 shares per contract.
    if (l.type === "call" && sharesCovering >= 100 * l.quantity) {
      sharesCovering -= 100 * l.quantity;
      continue;
    }
    // Vertical-spread test: a long leg of the same type, same expiry, with
    // a "protective" strike (above for short call, below for short put).
    const protector = trade.legs.find(
      (o) =>
        o !== l &&
        o.side === "long" &&
        o.type === l.type &&
        o.expiration === l.expiration &&
        (l.type === "call" ? o.strike > l.strike : o.strike < l.strike),
    );
    if (protector) {
      const width = Math.abs(protector.strike - l.strike);
      margin += width * 100 * Math.min(l.quantity, protector.quantity);
      continue;
    }
    if (l.type === "put") {
      margin += l.strike * 100 * l.quantity;
    } else {
      const S = trade.underlyingPrice;
      const otm = Math.max(l.strike - S, 0);
      const naked = Math.max(0.2 * S - otm, 0.1 * l.strike);
      margin += naked * 100 * l.quantity;
    }
  }

  // Probability of profit using lognormal under avg IV.
  const pop = approxPoP(trade, breakevens);

  return {
    maxProfit: unboundedUp ? "unlimited" : +maxP.toFixed(2),
    maxLoss: unboundedDown ? "unlimited" : +minP.toFixed(2),
    breakevens,
    cost: +cost.toFixed(2),
    marginEstimate: +margin.toFixed(2),
    pop,
  };
}

// Delta-weighted blend of leg IVs. Legs near the money (|delta| close to 0.5)
// dominate the lognormal drift more than far-OTM tails, so for credit spreads
// the short leg drives sigma. Falls back to simple average if all deltas
// degenerate to zero.
export function blendIV(trade: Trade): number {
  const ivs = trade.legs.map((l) => l.iv ?? 0.3);
  if (ivs.length === 0) return 0.3;
  const S = trade.underlyingPrice;
  const r = trade.riskFreeRate;
  const now = new Date();
  let sumWIV = 0;
  let sumW = 0;
  for (const l of trade.legs) {
    const iv = l.iv ?? 0.3;
    const T = yearsBetween(now, new Date(l.expiration));
    const delta =
      T > 0
        ? Math.abs(bs({ S, K: l.strike, T, r, sigma: iv, type: l.type }).delta)
        : l.type === "call"
          ? S > l.strike
            ? 1
            : 0
          : S < l.strike
            ? 1
            : 0;
    const w = delta * Math.abs(l.quantity);
    sumWIV += w * iv;
    sumW += w;
  }
  if (sumW > 0) return sumWIV / sumW;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

function approxPoP(trade: Trade, breakevens: number[]): number | undefined {
  if (breakevens.length === 0 || trade.legs.length === 0) return undefined;
  // Skip calendars/diagonals: lognormal sim through the latest expiry
  // mis-models legs that already expired earlier.
  const expiries = new Set(trade.legs.map((l) => l.expiration));
  if (expiries.size > 1) return undefined;
  const lastExpiry = new Date(
    Math.max(...trade.legs.map((l) => new Date(l.expiration).getTime())),
  );
  const T = yearsBetween(new Date(), lastExpiry);
  if (T <= 0) return undefined;
  const sigma = blendIV(trade);
  // Deterministic PRNG seeded by the position so results don't jitter between
  // renders for the same trade. 10k samples → ~0.5% std error on a 50% PoP.
  const seed = popSeed(trade);
  const rng = mulberry32(seed);
  const N = 10_000;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const z = sampleNormal(rng);
    const sT =
      trade.underlyingPrice *
      Math.exp((trade.riskFreeRate - 0.5 * sigma * sigma) * T + sigma * Math.sqrt(T) * z);
    const pnl = totalPnL(trade, sT, lastExpiry);
    if (pnl > 0) wins++;
  }
  return wins / N;
}

function sampleNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function popSeed(trade: Trade): number {
  let h = 2166136261;
  const s = `${trade.symbol}|${trade.underlyingPrice}|${trade.riskFreeRate}|${trade.legs
    .map((l) => `${l.side}${l.type}${l.strike}${l.expiration}${l.quantity}${l.premium}${l.iv ?? ""}`)
    .join(",")}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Cache for fillImpliedVolsForTrade. Newton-Raphson per leg is ~50-100x more
// expensive than the rest of the trade math; the trade detail page calls this
// on every load + save + spot update, all of which produce the same result
// for a given (id, updatedAt) pair. Keyed by both so saves bust the cache.
const ivFilledCache = new Map<string, Trade>();
const IV_CACHE_LIMIT = 64;

function ivCacheKey(trade: Trade): string | null {
  if (!trade.id || !trade.updatedAt) return null;
  return `${trade.id}::${trade.updatedAt}::${trade.underlyingPrice}`;
}

export function fillImpliedVolsForTrade(trade: Trade): Trade {
  const key = ivCacheKey(trade);
  if (key) {
    const hit = ivFilledCache.get(key);
    if (hit) return hit;
  }
  const now = new Date();
  const filled: Trade = {
    ...trade,
    legs: trade.legs.map((l) => {
      if (l.iv != null) return { ...l, ivUnsolved: false };
      const expiry = new Date(l.expiration);
      const T = yearsBetween(now, expiry);
      const iv = impliedVol(
        l.premium,
        trade.underlyingPrice,
        l.strike,
        T,
        trade.riskFreeRate,
        l.type,
      );
      // Solver returns null when bisection can't converge (e.g. premium below
      // intrinsic, illiquid quotes, malformed ticket parses). Keep the 0.3
      // fallback so the chart still renders, but flag it loudly so the UI
      // never silently displays Greeks computed from a guess.
      return iv == null
        ? { ...l, iv: 0.3, ivUnsolved: true }
        : { ...l, iv, ivUnsolved: false };
    }),
  };
  if (key) {
    if (ivFilledCache.size >= IV_CACHE_LIMIT) {
      const first = ivFilledCache.keys().next().value;
      if (first) ivFilledCache.delete(first);
    }
    ivFilledCache.set(key, filled);
  }
  return filled;
}
