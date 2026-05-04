import { describe, expect, it } from "vitest";
import { detectStrategy } from "./strategies";
import type { Trade } from "@/types/trade";

const expiry = "2026-12-18";
const expiry2 = "2027-01-15";

function trade(legs: Trade["legs"], underlying?: Trade["underlying"]): Trade {
  return {
    symbol: "TEST",
    underlyingPrice: 100,
    riskFreeRate: 0.045,
    legs,
    underlying,
  };
}

describe("detectStrategy", () => {
  it("long call", () => {
    const r = detectStrategy(
      trade([{ type: "call", side: "long", strike: 100, expiration: expiry, quantity: 1, premium: 3 }]),
    );
    expect(r.name).toBe("long_call");
  });

  it("covered call requires shares ≥ 100", () => {
    const legs: Trade["legs"] = [
      { type: "call", side: "short", strike: 105, expiration: expiry, quantity: 1, premium: 1 },
    ];
    expect(detectStrategy(trade(legs)).name).toBe("short_call");
    expect(detectStrategy(trade(legs, { shares: 50, costBasis: 95 })).name).toBe("short_call");
    expect(detectStrategy(trade(legs, { shares: 100, costBasis: 95 })).name).toBe("covered_call");
  });

  it("cash-secured put", () => {
    const r = detectStrategy(
      trade([{ type: "put", side: "short", strike: 95, expiration: expiry, quantity: 1, premium: 2 }]),
    );
    expect(r.name).toBe("cash_secured_put");
  });

  it("vertical spread", () => {
    const r = detectStrategy(
      trade([
        { type: "call", side: "long", strike: 100, expiration: expiry, quantity: 1, premium: 3 },
        { type: "call", side: "short", strike: 110, expiration: expiry, quantity: 1, premium: 1 },
      ]),
    );
    expect(r.name).toBe("vertical_spread");
  });

  it("calendar spread", () => {
    const r = detectStrategy(
      trade([
        { type: "call", side: "short", strike: 100, expiration: expiry, quantity: 1, premium: 1 },
        { type: "call", side: "long", strike: 100, expiration: expiry2, quantity: 1, premium: 2 },
      ]),
    );
    expect(r.name).toBe("calendar_spread");
  });

  it("iron condor on 4 legs", () => {
    const r = detectStrategy(
      trade([
        { type: "put", side: "long", strike: 90, expiration: expiry, quantity: 1, premium: 0.5 },
        { type: "put", side: "short", strike: 95, expiration: expiry, quantity: 1, premium: 1 },
        { type: "call", side: "short", strike: 105, expiration: expiry, quantity: 1, premium: 1 },
        { type: "call", side: "long", strike: 110, expiration: expiry, quantity: 1, premium: 0.5 },
      ]),
    );
    expect(r.name).toBe("iron_condor");
  });
});
