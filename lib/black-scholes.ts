// Black-Scholes pricing + Greeks for European options.
// Inputs: S spot, K strike, T years to expiry, r risk-free rate, sigma vol.

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function cdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export interface BSInputs {
  S: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
  type: "call" | "put";
  q?: number;
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export function bs({ S, K, T, r, sigma, type, q = 0 }: BSInputs): Greeks {
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    // Step-function delta at expiry: ITM = ±1, OTM/ATM = 0.
    const delta = type === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0;
    return { price: intrinsic, delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);

  if (type === "call") {
    const price = S * eqT * cdf(d1) - K * erT * cdf(d2);
    const delta = eqT * cdf(d1);
    const gamma = (eqT * pdf(d1)) / (S * sigma * sqrtT);
    const theta =
      (-S * eqT * pdf(d1) * sigma) / (2 * sqrtT) -
      r * K * erT * cdf(d2) +
      q * S * eqT * cdf(d1);
    const vega = S * eqT * pdf(d1) * sqrtT;
    const rho = K * T * erT * cdf(d2);
    return { price, delta, gamma, theta: theta / 365, vega: vega / 100, rho: rho / 100 };
  }
  const price = K * erT * cdf(-d2) - S * eqT * cdf(-d1);
  const delta = -eqT * cdf(-d1);
  const gamma = (eqT * pdf(d1)) / (S * sigma * sqrtT);
  const theta =
    (-S * eqT * pdf(d1) * sigma) / (2 * sqrtT) +
    r * K * erT * cdf(-d2) -
    q * S * eqT * cdf(-d1);
  const vega = S * eqT * pdf(d1) * sqrtT;
  const rho = -K * T * erT * cdf(-d2);
  return { price, delta, gamma, theta: theta / 365, vega: vega / 100, rho: rho / 100 };
}

// Implied volatility via bisection on price. Returns null when the input is
// outside no-arbitrage bounds or when bisection fails to converge.
export function impliedVol(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: "call" | "put",
  q = 0,
): number | null {
  if (!(marketPrice > 0) || !(T > 0) || !(S > 0) || !(K > 0)) return null;
  // No-arbitrage bounds: option price is bounded below by intrinsic of the
  // forward and above by the underlying (call) / strike-pv (put).
  const intrinsic =
    type === "call"
      ? Math.max(S * Math.exp(-q * T) - K * Math.exp(-r * T), 0)
      : Math.max(K * Math.exp(-r * T) - S * Math.exp(-q * T), 0);
  const upper = type === "call" ? S * Math.exp(-q * T) : K * Math.exp(-r * T);
  if (marketPrice < intrinsic - 1e-6) return null;
  if (marketPrice > upper + 1e-6) return null;

  let lo = 1e-4;
  let hi = 3; // 300% IV is already absurd
  let mid = 0.5 * (lo + hi);
  for (let i = 0; i < 100; i++) {
    mid = 0.5 * (lo + hi);
    const { price } = bs({ S, K, T, r, sigma: mid, type, q });
    if (Math.abs(price - marketPrice) < 1e-4) return mid;
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  // Verify the final answer is close enough; otherwise admit defeat.
  const { price: finalPrice } = bs({ S, K, T, r, sigma: mid, type, q });
  return Math.abs(finalPrice - marketPrice) < 1e-3 ? mid : null;
}

export function yearsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(ms / (1000 * 60 * 60 * 24 * 365), 0);
}
