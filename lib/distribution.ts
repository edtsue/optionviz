// Terminal-price distribution helpers for the trade Distribution chart view.
//
// All math assumes a Black-Scholes world: log-returns are normal with drift
// (r − σ²/2)·T and standard deviation σ·√T. That makes terminal price S_T
// lognormal. We use blended IV across the legs as the σ input (same source
// the payoff chart's ±1σ band uses), and the underlying's risk-free rate.
//
// "ITM at expiry" for a single leg is a closed form in d₂ — no Monte Carlo
// needed. P(profit) over the whole position uses the actual expiry payoff
// curve and integrates the lognormal density across the spots where the
// payoff is positive — this matches how P/L is computed everywhere else
// in the app.

import { cdf } from "./black-scholes";
import type { Leg, Trade } from "@/types/trade";

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export interface DistributionPoint {
  spot: number;
  density: number;
}

export function lognormalPdf(
  spot: number,
  S0: number,
  sigma: number,
  T: number,
  r: number,
): number {
  if (T <= 0 || sigma <= 0 || spot <= 0 || S0 <= 0) return 0;
  const sigmaT = sigma * Math.sqrt(T);
  const mu = Math.log(S0) + (r - 0.5 * sigma * sigma) * T;
  const z = (Math.log(spot) - mu) / sigmaT;
  return Math.exp(-0.5 * z * z) / (spot * sigmaT * SQRT_2PI);
}

/**
 * P(option is ITM at expiry) for a single leg under the Black-Scholes
 * lognormal terminal distribution. Closed form via d₂.
 *  - Call: P(S_T ≥ K) = Φ(d₂)
 *  - Put : P(S_T ≤ K) = Φ(−d₂)
 *
 * sigma defaults to 0.3 when the leg has no IV (same default the pricing
 * code uses). T is the year-fraction from `asOf` to the leg's expiry.
 */
export function pItm(
  leg: Leg,
  spot0: number,
  riskFreeRate: number,
  asOf: Date = new Date(),
): number {
  const expiry = new Date(leg.expiration);
  const T = Math.max(0, (expiry.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24 * 365));
  const sigma = leg.iv && leg.iv > 0 ? leg.iv : 0.3;
  if (T <= 0 || sigma <= 0) {
    return leg.type === "call"
      ? spot0 >= leg.strike
        ? 1
        : 0
      : spot0 <= leg.strike
        ? 1
        : 0;
  }
  const sqrtT = Math.sqrt(T);
  const d2 = (Math.log(spot0 / leg.strike) + (riskFreeRate - 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return leg.type === "call" ? cdf(d2) : cdf(-d2);
}

export interface DistributionResult {
  /** Lognormal density at each spot in the supplied grid. */
  points: DistributionPoint[];
  /** Year-fraction from `asOf` to the horizon (last leg's expiry). */
  T: number;
  /** Blended sigma used (mean of leg IVs). */
  sigma: number;
  /** Expected terminal price E[S_T] = S₀ · e^(r·T) under risk-neutral drift. */
  expected: number;
  /** ±1σ band of S_T (log-space midpoint × exp(±σ√T)). */
  oneSigma: [number, number] | null;
  /** Per-leg P(ITM at expiry) — same order as trade.legs. */
  legItm: Array<{ leg: Leg; p: number }>;
}

/**
 * Build a distribution payload over a precomputed spot grid (so the
 * Distribution chart can share the exact x-axis as the Payoff chart).
 * Horizon defaults to the latest leg's expiry.
 */
export function buildDistribution(
  trade: Trade,
  spotGrid: number[],
  asOf: Date = new Date(),
): DistributionResult {
  const lastExpiryMs = Math.max(
    ...trade.legs.map((l) => new Date(l.expiration).getTime()),
  );
  const T = Math.max(0, (lastExpiryMs - asOf.getTime()) / (1000 * 60 * 60 * 24 * 365));
  const ivs = trade.legs.map((l) => (l.iv && l.iv > 0 ? l.iv : 0.3));
  const sigma = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0.3;
  const S0 = trade.underlyingPrice;
  const r = trade.riskFreeRate ?? 0.045;

  const points = spotGrid.map((spot) => ({
    spot,
    density: lognormalPdf(spot, S0, sigma, T, r),
  }));

  const expected = S0 * Math.exp(r * T);
  const oneSigma: [number, number] | null =
    T > 0 && sigma > 0
      ? (() => {
          const drift = (r - 0.5 * sigma * sigma) * T;
          const center = S0 * Math.exp(drift);
          const w = sigma * Math.sqrt(T);
          return [+(center * Math.exp(-w)).toFixed(2), +(center * Math.exp(w)).toFixed(2)];
        })()
      : null;

  const legItm = trade.legs.map((leg) => ({ leg, p: pItm(leg, S0, r, asOf) }));

  return { points, T, sigma, expected, oneSigma, legItm };
}

/**
 * Probability of net profit at expiry: integrate the lognormal density
 * across spots where the payoff-at-expiry is positive. The input `payoff`
 * is the same array the chart already builds (per-spot `expiry` $ P/L).
 * Returns a value in [0, 1].
 */
export function pProfit(
  trade: Trade,
  payoff: Array<{ spot: number; expiry: number }>,
  asOf: Date = new Date(),
): number {
  if (payoff.length < 2) return 0;
  const lastExpiryMs = Math.max(
    ...trade.legs.map((l) => new Date(l.expiration).getTime()),
  );
  const T = Math.max(0, (lastExpiryMs - asOf.getTime()) / (1000 * 60 * 60 * 24 * 365));
  const ivs = trade.legs.map((l) => (l.iv && l.iv > 0 ? l.iv : 0.3));
  const sigma = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : 0.3;
  const S0 = trade.underlyingPrice;
  const r = trade.riskFreeRate ?? 0.045;

  // Trapezoidal integration of f(S) where f = pdf(S) when payoff(S) > 0
  // else 0. Good enough at the chart's ~61-point density.
  let total = 0;
  for (let i = 0; i < payoff.length - 1; i++) {
    const a = payoff[i];
    const b = payoff[i + 1];
    const fa = a.expiry > 0 ? lognormalPdf(a.spot, S0, sigma, T, r) : 0;
    const fb = b.expiry > 0 ? lognormalPdf(b.spot, S0, sigma, T, r) : 0;
    total += 0.5 * (fa + fb) * (b.spot - a.spot);
  }
  // Clamp; integration noise can push slightly outside [0,1] on tiny T.
  return Math.max(0, Math.min(1, total));
}
