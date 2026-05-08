import { describe, expect, it } from "vitest";
import { tradeStats, netGreeks, blendIV } from "./payoff";
import type { Trade } from "@/types/trade";

const futureExpiry = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

function longCallTrade(): Trade {
  return {
    symbol: "TEST",
    underlyingPrice: 100,
    riskFreeRate: 0.045,
    legs: [
      {
        type: "call",
        side: "long",
        strike: 100,
        expiration: futureExpiry,
        quantity: 1,
        premium: 3,
        iv: 0.3,
      },
    ],
  };
}

function callVerticalTrade(): Trade {
  return {
    symbol: "TEST",
    underlyingPrice: 100,
    riskFreeRate: 0.045,
    legs: [
      { type: "call", side: "long", strike: 100, expiration: futureExpiry, quantity: 1, premium: 3, iv: 0.3 },
      { type: "call", side: "short", strike: 110, expiration: futureExpiry, quantity: 1, premium: 1, iv: 0.3 },
    ],
  };
}

describe("tradeStats", () => {
  it("long call: max loss = -premium × 100, breakeven near strike+premium, max profit unlimited", () => {
    const stats = tradeStats(longCallTrade());
    expect(stats.maxLoss).toBeCloseTo(-300, 0);
    expect(stats.maxProfit).toBe("unlimited");
    expect(stats.breakevens.length).toBe(1);
    expect(stats.breakevens[0]).toBeGreaterThan(102);
    expect(stats.breakevens[0]).toBeLessThan(104);
  });

  it("call vertical: bounded P/L (M-5)", () => {
    const stats = tradeStats(callVerticalTrade());
    expect(stats.maxProfit).not.toBe("unlimited");
    expect(stats.maxLoss).not.toBe("unlimited");
  });

  it("PoP is deterministic for the same trade (M-9)", () => {
    const t = longCallTrade();
    const a = tradeStats(t);
    const b = tradeStats(t);
    expect(a.pop).toBe(b.pop);
  });

  it("PoP is undefined for calendars (M-3)", () => {
    const future2 = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    const t: Trade = {
      symbol: "TEST",
      underlyingPrice: 100,
      riskFreeRate: 0.045,
      legs: [
        { type: "call", side: "short", strike: 105, expiration: futureExpiry, quantity: 1, premium: 1.5, iv: 0.3 },
        { type: "call", side: "long", strike: 105, expiration: future2, quantity: 1, premium: 2.5, iv: 0.3 },
      ],
    };
    const stats = tradeStats(t);
    expect(stats.pop).toBeUndefined();
  });

  it("covered call has zero margin", () => {
    const t: Trade = {
      symbol: "TEST",
      underlyingPrice: 100,
      riskFreeRate: 0.045,
      underlying: { shares: 100, costBasis: 95 },
      legs: [
        { type: "call", side: "short", strike: 105, expiration: futureExpiry, quantity: 1, premium: 1.5, iv: 0.3 },
      ],
    };
    const stats = tradeStats(t);
    expect(stats.marginEstimate).toBe(0);
  });

  it("call credit spread margin = width × 100", () => {
    const t: Trade = {
      symbol: "TEST",
      underlyingPrice: 100,
      riskFreeRate: 0.045,
      legs: [
        { type: "call", side: "short", strike: 100, expiration: futureExpiry, quantity: 1, premium: 3, iv: 0.3 },
        { type: "call", side: "long", strike: 110, expiration: futureExpiry, quantity: 1, premium: 1, iv: 0.3 },
      ],
    };
    const stats = tradeStats(t);
    expect(stats.marginEstimate).toBeCloseTo(1000, 0);
  });
});

describe("blendIV", () => {
  it("returns the single-leg IV unchanged for a single-leg trade", () => {
    expect(blendIV(longCallTrade())).toBeCloseTo(0.3, 6);
  });

  it("biases toward the higher-delta leg's IV in a credit spread", () => {
    // ATM short call (high delta) at IV=0.5; far-OTM long call (low delta) at IV=0.3.
    // Simple average would be 0.4. Delta-weighted should land closer to 0.5.
    const t: Trade = {
      symbol: "TEST",
      underlyingPrice: 100,
      riskFreeRate: 0.045,
      legs: [
        { type: "call", side: "short", strike: 100, expiration: futureExpiry, quantity: 1, premium: 3, iv: 0.5 },
        { type: "call", side: "long", strike: 130, expiration: futureExpiry, quantity: 1, premium: 0.1, iv: 0.3 },
      ],
    };
    const blended = blendIV(t);
    expect(blended).toBeGreaterThan(0.4);
    expect(blended).toBeLessThan(0.5);
  });
});

describe("netGreeks", () => {
  it("long call has positive delta", () => {
    const g = netGreeks(longCallTrade());
    expect(g.delta).toBeGreaterThan(0);
  });

  it("vertical spread has bounded delta < single long call", () => {
    const single = netGreeks(longCallTrade()).delta;
    const vert = netGreeks(callVerticalTrade()).delta;
    expect(Math.abs(vert)).toBeLessThan(Math.abs(single));
  });
});
