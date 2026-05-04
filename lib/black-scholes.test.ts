import { describe, expect, it } from "vitest";
import { bs, impliedVol } from "./black-scholes";

describe("Black-Scholes", () => {
  it("call price ≥ intrinsic for ITM, ≥ 0 for OTM", () => {
    const S = 100;
    for (const K of [80, 100, 120]) {
      const { price } = bs({ S, K, T: 0.5, r: 0.05, sigma: 0.3, type: "call" });
      expect(price).toBeGreaterThanOrEqual(Math.max(S - K * Math.exp(-0.05 * 0.5), 0) - 1e-6);
    }
  });

  it("put-call parity holds: C − P = S·e^(−qT) − K·e^(−rT)", () => {
    const S = 100;
    const T = 0.5;
    const r = 0.05;
    const sigma = 0.25;
    for (const K of [80, 100, 120]) {
      const c = bs({ S, K, T, r, sigma, type: "call" }).price;
      const p = bs({ S, K, T, r, sigma, type: "put" }).price;
      expect(c - p).toBeCloseTo(S - K * Math.exp(-r * T), 4);
    }
  });

  it("call delta ∈ [0,1], put delta ∈ [-1,0]", () => {
    for (const S of [80, 100, 120]) {
      const c = bs({ S, K: 100, T: 0.5, r: 0.05, sigma: 0.3, type: "call" });
      const p = bs({ S, K: 100, T: 0.5, r: 0.05, sigma: 0.3, type: "put" });
      expect(c.delta).toBeGreaterThanOrEqual(0);
      expect(c.delta).toBeLessThanOrEqual(1);
      expect(p.delta).toBeLessThanOrEqual(0);
      expect(p.delta).toBeGreaterThanOrEqual(-1);
    }
  });

  it("vega ≥ 0", () => {
    for (const K of [80, 100, 120]) {
      for (const type of ["call", "put"] as const) {
        const { vega } = bs({ S: 100, K, T: 0.5, r: 0.05, sigma: 0.3, type });
        expect(vega).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("price collapses to intrinsic when σ→0 or T=0 (M-1)", () => {
    // T = 0
    expect(bs({ S: 110, K: 100, T: 0, r: 0.05, sigma: 0.3, type: "call" }).price).toBeCloseTo(10);
    expect(bs({ S: 90, K: 100, T: 0, r: 0.05, sigma: 0.3, type: "put" }).price).toBeCloseTo(10);
    // ITM call at expiry must have delta = 1, not 0
    expect(bs({ S: 110, K: 100, T: 0, r: 0.05, sigma: 0.3, type: "call" }).delta).toBe(1);
    expect(bs({ S: 90, K: 100, T: 0, r: 0.05, sigma: 0.3, type: "put" }).delta).toBe(-1);
    expect(bs({ S: 100, K: 100, T: 0, r: 0.05, sigma: 0.3, type: "call" }).delta).toBe(0);
  });
});

describe("impliedVol", () => {
  it("recovers σ within tolerance for in-range prices", () => {
    const S = 100;
    const K = 100;
    const T = 0.5;
    const r = 0.05;
    for (const sigma of [0.1, 0.25, 0.5, 1.0]) {
      const { price } = bs({ S, K, T, r, sigma, type: "call" });
      const iv = impliedVol(price, S, K, T, r, "call");
      expect(iv).not.toBeNull();
      expect(iv!).toBeCloseTo(sigma, 2);
    }
  });

  it("returns null for sub-intrinsic prices (M-2)", () => {
    // Below intrinsic = arbitrage; should fail.
    const iv = impliedVol(0.01, 100, 50, 0.5, 0.05, "call");
    expect(iv).toBeNull();
  });

  it("returns null for above-bound prices (M-2)", () => {
    // Call price can never exceed S; this is unsolvable.
    const iv = impliedVol(200, 100, 50, 0.5, 0.05, "call");
    expect(iv).toBeNull();
  });
});
