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

export interface PayoffPoint {
  spot: number;
  expiry: number;
  today: number;
  mid: number;
}

// Build a payoff curve over a range of underlying prices.
// Three series: at expiration, today, and a midpoint date.
export function buildPayoff(trade: Trade, points = 121): PayoffPoint[] {
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

export interface NetGreeks extends Greeks {}

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

  // Detect unbounded payoff by checking slopes at the tails.
  const leftSlope = expVals[1] - expVals[0];
  const rightSlope = expVals[expVals.length - 1] - expVals[expVals.length - 2];
  const unboundedUp = rightSlope > 0.01;
  const unboundedDown = leftSlope < -0.01;

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
  let margin = 0;
  for (const l of trade.legs) {
    if (l.side === "short") {
      if (l.type === "put") margin += l.strike * 100 * l.quantity;
      else margin += trade.underlyingPrice * 0.2 * 100 * l.quantity;
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

function approxPoP(trade: Trade, breakevens: number[]): number | undefined {
  if (breakevens.length === 0 || trade.legs.length === 0) return undefined;
  const lastExpiry = new Date(
    Math.max(...trade.legs.map((l) => new Date(l.expiration).getTime())),
  );
  const T = yearsBetween(new Date(), lastExpiry);
  if (T <= 0) return undefined;
  const ivs = trade.legs.map((l) => l.iv ?? 0.3);
  const sigma = ivs.reduce((a, b) => a + b, 0) / ivs.length;
  // Sample lognormal terminal prices
  const N = 4000;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const z = sampleNormal();
    const sT =
      trade.underlyingPrice *
      Math.exp((trade.riskFreeRate - 0.5 * sigma * sigma) * T + sigma * Math.sqrt(T) * z);
    const pnl = totalPnL(trade, sT, lastExpiry);
    if (pnl > 0) wins++;
  }
  return wins / N;
}

function sampleNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function fillImpliedVolsForTrade(trade: Trade): Trade {
  const now = new Date();
  return {
    ...trade,
    legs: trade.legs.map((l) => {
      if (l.iv != null) return l;
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
      return { ...l, iv: iv ?? 0.3 };
    }),
  };
}
