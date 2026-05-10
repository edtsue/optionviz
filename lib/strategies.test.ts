import { describe, expect, it } from "vitest";
import { detectStrategy, legMoneyness, tradeMoneyness } from "./strategies";
import type { Trade } from "@/types/trade";

const expiry = "2026-12-18";
const expiry2 = "2027-01-15";

function trade(
  legs: Trade["legs"],
  underlying?: Trade["underlying"],
  underlyingPrice = 100,
): Trade {
  return {
    symbol: "TEST",
    underlyingPrice,
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

describe("legMoneyness", () => {
  it("call: spot above strike is ITM, below is OTM", () => {
    const call = { type: "call" as const, side: "long" as const, strike: 100, expiration: expiry, quantity: 1, premium: 1 };
    expect(legMoneyness(call, 110)).toBe("ITM");
    expect(legMoneyness(call, 90)).toBe("OTM");
  });
  it("put: spot below strike is ITM, above is OTM", () => {
    const put = { type: "put" as const, side: "long" as const, strike: 100, expiration: expiry, quantity: 1, premium: 1 };
    expect(legMoneyness(put, 90)).toBe("ITM");
    expect(legMoneyness(put, 110)).toBe("OTM");
  });
  it("spot within 1.5% of strike is ATM (call or put)", () => {
    const call = { type: "call" as const, side: "long" as const, strike: 100, expiration: expiry, quantity: 1, premium: 1 };
    const put = { type: "put" as const, side: "short" as const, strike: 100, expiration: expiry, quantity: 1, premium: 1 };
    expect(legMoneyness(call, 100)).toBe("ATM");
    expect(legMoneyness(call, 101.4)).toBe("ATM");
    expect(legMoneyness(put, 98.6)).toBe("ATM");
    expect(legMoneyness(call, 101.6)).toBe("ITM");
  });
});

describe("tradeMoneyness", () => {
  it("single long call far OTM", () => {
    const t = trade(
      [{ type: "call", side: "long", strike: 120, expiration: expiry, quantity: 1, premium: 1 }],
      undefined,
      100,
    );
    expect(tradeMoneyness(t)).toBe("OTM");
  });
  it("single long call ITM", () => {
    const t = trade(
      [{ type: "call", side: "long", strike: 90, expiration: expiry, quantity: 1, premium: 12 }],
      undefined,
      100,
    );
    expect(tradeMoneyness(t)).toBe("ITM");
  });
  it("vertical with one ITM leg rolls up to ITM", () => {
    const t = trade(
      [
        { type: "call", side: "long", strike: 95, expiration: expiry, quantity: 1, premium: 6 },
        { type: "call", side: "short", strike: 110, expiration: expiry, quantity: 1, premium: 1 },
      ],
      undefined,
      100,
    );
    expect(tradeMoneyness(t)).toBe("ITM");
  });
  it("strangle with both legs OTM is OTM", () => {
    const t = trade(
      [
        { type: "put", side: "long", strike: 90, expiration: expiry, quantity: 1, premium: 1 },
        { type: "call", side: "long", strike: 110, expiration: expiry, quantity: 1, premium: 1 },
      ],
      undefined,
      100,
    );
    expect(tradeMoneyness(t)).toBe("OTM");
  });
  it("nearest strike within ATM band rolls up to ATM", () => {
    const t = trade(
      [
        { type: "call", side: "short", strike: 101, expiration: expiry, quantity: 1, premium: 1 },
        { type: "call", side: "long", strike: 110, expiration: expiry, quantity: 1, premium: 0.5 },
      ],
      undefined,
      100,
    );
    expect(tradeMoneyness(t)).toBe("ATM");
  });
});
