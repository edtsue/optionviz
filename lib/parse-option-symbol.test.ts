import { describe, expect, it } from "vitest";
import { parseOptionSymbol } from "./parse-option-symbol";

describe("parseOptionSymbol", () => {
  it("parses OCC format", () => {
    const r = parseOptionSymbol("AAPL250719C00250000");
    expect(r).toEqual({
      underlying: "AAPL",
      expiration: "2025-07-19",
      strike: 250,
      type: "call",
    });
  });

  it("parses OCC put format", () => {
    const r = parseOptionSymbol("SPY261218P00400000");
    expect(r).toEqual({
      underlying: "SPY",
      expiration: "2026-12-18",
      strike: 400,
      type: "put",
    });
  });

  it("parses verbose with year", () => {
    const r = parseOptionSymbol("AAPL Jul 19 2026 250 Call");
    expect(r).toEqual({
      underlying: "AAPL",
      expiration: "2026-07-19",
      strike: 250,
      type: "call",
    });
  });

  it("parses slashed format", () => {
    const r = parseOptionSymbol("AAPL 07/19/2026 250.00 C");
    expect(r).toEqual({
      underlying: "AAPL",
      expiration: "2026-07-19",
      strike: 250,
      type: "call",
    });
  });

  it("rejects plain stock tickers", () => {
    expect(parseOptionSymbol("AAPL")).toBeNull();
    expect(parseOptionSymbol("CASH")).toBeNull();
    expect(parseOptionSymbol("")).toBeNull();
    expect(parseOptionSymbol(null)).toBeNull();
  });
});
