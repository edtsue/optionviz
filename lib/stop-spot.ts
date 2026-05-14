// Compute the underlying spot price at which a short option's mark would
// equal `multiplier × original premium` (the BTC stop-market trigger).
//
// For a short call: option price grows as spot rises → the stop spot is
// strictly above current spot. For a short put: option price grows as spot
// falls → the stop spot is strictly below current spot.
//
// Uses Black-Scholes pricing from the existing payoff lib and a binary
// search across the relevant half-line. Returns null if the option can't
// reach the target inside a reasonable spot range (e.g., deep-ITM already).

import { bs, yearsBetween } from "./black-scholes";
import { totalPnL } from "./payoff";
import type { Leg, Trade } from "@/types/trade";

const DEFAULT_IV = 0.3;

export interface StopSpotInput {
  trade: Trade;
  /** The short option leg this checklist is anchored to. */
  shortLeg: Leg;
  /** Multiplier of original premium (e.g., 2.0 = 2× premium = stop). */
  multiplier: number;
  /** Valuation date for the option price (defaults to today). */
  asOf?: Date;
}

/**
 * Returns the spot price at which the short leg's option price reaches
 * `premium × multiplier`. Returns null if the multiplier ≤ 1 (no movement
 * required) or if the spot can't be found within ±90% of the underlying.
 */
export function computeStopSpot(input: StopSpotInput): number | null {
  const { trade, shortLeg, multiplier } = input;
  if (!shortLeg || shortLeg.side !== "short") return null;
  if (!Number.isFinite(multiplier) || multiplier <= 1) return null;
  const target = shortLeg.premium * multiplier;
  if (!Number.isFinite(target) || target <= 0) return null;

  const asOf = input.asOf ?? new Date();
  const expiry = new Date(shortLeg.expiration);
  const T = yearsBetween(asOf, expiry);
  if (T <= 0) return null;

  const sigma = shortLeg.iv && shortLeg.iv > 0 ? shortLeg.iv : DEFAULT_IV;
  const r = trade.riskFreeRate ?? 0.04;
  const S0 = trade.underlyingPrice;
  if (!S0 || S0 <= 0) return null;

  const priceAt = (S: number) =>
    bs({ S, K: shortLeg.strike, T, r, sigma, type: shortLeg.type }).price;

  // Decide search direction by leg type.
  // Short call: price rises as S↑. Short put: price rises as S↓.
  const isCall = shortLeg.type === "call";
  // Search range: ±90% of current spot is generous and safe.
  const lo = S0 * 0.1;
  const hi = S0 * 10;

  // Find the half-line that contains the solution.
  let leftS: number, rightS: number;
  if (isCall) {
    // Price is monotonically increasing in S for calls.
    if (priceAt(S0) >= target) return S0; // already past stop
    if (priceAt(hi) < target) return null;
    leftS = S0;
    rightS = hi;
  } else {
    // Price is monotonically decreasing in S for puts (intrinsic-driven).
    if (priceAt(S0) >= target) return S0;
    if (priceAt(lo) < target) return null;
    leftS = lo;
    rightS = S0;
  }

  // Binary-search for spot where price ≈ target.
  for (let i = 0; i < 50; i++) {
    const mid = (leftS + rightS) / 2;
    const p = priceAt(mid);
    if (Math.abs(p - target) < 0.005) return +mid.toFixed(2);
    if (isCall) {
      // Higher S → higher price. If p < target, we need higher S.
      if (p < target) leftS = mid;
      else rightS = mid;
    } else {
      // Lower S → higher price. If p < target, we need lower S.
      if (p < target) rightS = mid;
      else leftS = mid;
    }
  }
  return +((leftS + rightS) / 2).toFixed(2);
}

export interface ProfitSpotInput {
  trade: Trade;
  shortLeg: Leg;
  /** Fraction of original premium captured (0–1). 0.5 = take profit when
      option price has decayed to 50% of entry premium = captured 50%. */
  profitFraction: number;
  asOf?: Date;
}

export interface ProfitSpotResult {
  /** Underlying spot at which the short leg's option price reaches the
      target premium (entry × (1 − profitFraction)). null if the target
      is unreachable inside a wide search range. */
  spot: number | null;
  /** Target option price the user would BTC at. */
  targetPrice: number;
  /** True if the option's current price is already at/below the target
      (profit already captured at current spot, no spot move needed). */
  alreadyReached: boolean;
}

/**
 * Returns the spot at which the short leg's option price drops to
 * `entry × (1 − profitFraction)` — i.e. the price at which the user
 * would BTC for that profit-taking level.
 */
export function computeProfitSpot(input: ProfitSpotInput): ProfitSpotResult {
  const empty = (targetPrice: number): ProfitSpotResult => ({
    spot: null,
    targetPrice,
    alreadyReached: false,
  });
  const { trade, shortLeg, profitFraction } = input;
  if (!shortLeg || shortLeg.side !== "short") return empty(0);
  if (
    !Number.isFinite(profitFraction) ||
    profitFraction <= 0 ||
    profitFraction >= 1
  )
    return empty(0);

  const target = shortLeg.premium * (1 - profitFraction);
  if (!Number.isFinite(target) || target <= 0) return empty(target);

  const asOf = input.asOf ?? new Date();
  const expiry = new Date(shortLeg.expiration);
  const T = yearsBetween(asOf, expiry);
  if (T <= 0) return empty(target);

  const sigma = shortLeg.iv && shortLeg.iv > 0 ? shortLeg.iv : DEFAULT_IV;
  const r = trade.riskFreeRate ?? 0.04;
  const S0 = trade.underlyingPrice;
  if (!S0 || S0 <= 0) return empty(target);

  const priceAt = (S: number) =>
    bs({ S, K: shortLeg.strike, T, r, sigma, type: shortLeg.type }).price;

  const isCall = shortLeg.type === "call";
  const currentPrice = priceAt(S0);

  if (currentPrice <= target) {
    return { spot: S0, targetPrice: target, alreadyReached: true };
  }

  // Short call: option price increases with S. To drop price → drop S.
  // Search [0.05·S0, S0]. Short put: opposite — search [S0, 10·S0].
  let leftS: number, rightS: number;
  if (isCall) {
    leftS = S0 * 0.05;
    rightS = S0;
    if (priceAt(leftS) > target) return empty(target);
  } else {
    leftS = S0;
    rightS = S0 * 10;
    if (priceAt(rightS) > target) return empty(target);
  }

  for (let i = 0; i < 50; i++) {
    const mid = (leftS + rightS) / 2;
    const p = priceAt(mid);
    if (Math.abs(p - target) < 0.005) {
      return { spot: +mid.toFixed(2), targetPrice: target, alreadyReached: false };
    }
    if (isCall) {
      // higher S → higher price. p > target → narrow upper bound.
      if (p > target) rightS = mid;
      else leftS = mid;
    } else {
      // higher S → lower price. p > target → narrow lower bound (raise S).
      if (p > target) leftS = mid;
      else rightS = mid;
    }
  }
  return {
    spot: +((leftS + rightS) / 2).toFixed(2),
    targetPrice: target,
    alreadyReached: false,
  };
}

/**
 * Find the dominant short option leg in the trade. Returns null if there is
 * no short single-leg position. Used to anchor the checklist + stop arrow.
 */
export function findShortLeg(trade: Trade): Leg | null {
  const shorts = trade.legs.filter((l) => l.side === "short");
  if (!shorts.length) return null;
  // Pick the highest-quantity short, or the first if all equal.
  shorts.sort((a, b) => b.quantity - a.quantity);
  return shorts[0];
}

// Covered-call-like: there's a stock leg and the dominant short is a call.
// The decay-based profit-taking ladder doesn't make sense for these (decay
// requires stock to drop, which loses on the share leg), so we render a
// spot-target ladder instead.
export function isCoveredCallLike(trade: Trade): boolean {
  if (!trade.underlying || trade.underlying.shares <= 0) return false;
  const sl = findShortLeg(trade);
  return !!sl && sl.type === "call";
}

export interface CoveredProfitRow {
  /** Fraction of max profit at expiry — 10 = 10%, 90 = 90%. */
  pct: number;
  /** Spot at which expiry P/L = pct × maxProfit. */
  spot: number;
  /** BTC price (Black-Scholes) for the short leg at that spot, today. */
  contractPrice: number;
  /** Today's net position P/L if spot reaches that level right now. */
  profit: number;
}

/**
 * Profit-taking ladder for covered-call-like positions. For each level (a
 * % of max profit at expiry), find the spot S* at which the at-expiry net
 * P/L equals that fraction of max, then report today's net P/L and today's
 * BTC price for the short leg at S* — i.e. the actionable numbers a CC
 * writer reads to decide whether to close early.
 */
export function computeCoveredProfitLadder(
  trade: Trade,
  levels: number[],
  asOf?: Date,
): CoveredProfitRow[] {
  if (!isCoveredCallLike(trade)) return [];
  const shortLeg = findShortLeg(trade);
  if (!shortLeg) return [];
  const expiry = new Date(shortLeg.expiration);
  if (Number.isNaN(expiry.getTime())) return [];

  // Max profit lands at (or above) strike at expiry.
  const maxProfit = totalPnL(trade, shortLeg.strike, expiry);
  if (!Number.isFinite(maxProfit) || maxProfit <= 0) return [];

  const now = asOf ?? new Date();
  const T = yearsBetween(now, expiry);
  const sigma = shortLeg.iv && shortLeg.iv > 0 ? shortLeg.iv : DEFAULT_IV;
  const r = trade.riskFreeRate ?? 0.04;

  // Below strike the at-expiry P/L is linear in spot (slope = shares); above
  // strike it's capped. Search [0, strike] for each target.
  const lo0 = 0;
  const hi0 = shortLeg.strike;

  return levels.map((pct) => {
    const target = (pct / 100) * maxProfit;
    let lo = lo0;
    let hi = hi0;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const v = totalPnL(trade, mid, expiry);
      if (Math.abs(v - target) < 0.5) {
        lo = hi = mid;
        break;
      }
      if (v < target) lo = mid;
      else hi = mid;
    }
    const spot = +((lo + hi) / 2).toFixed(2);
    const contractPrice =
      T > 0
        ? bs({ S: spot, K: shortLeg.strike, T, r, sigma, type: shortLeg.type }).price
        : Math.max(spot - shortLeg.strike, 0);
    const profit = +totalPnL(trade, spot, now).toFixed(0);
    return {
      pct,
      spot,
      contractPrice: +contractPrice.toFixed(2),
      profit,
    };
  });
}
