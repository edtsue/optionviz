import type { DetectedStrategy, Trade } from "@/types/trade";

export function detectStrategy(trade: Trade): DetectedStrategy {
  const legs = trade.legs;
  const hasShares = !!trade.underlying && trade.underlying.shares >= 100;

  if (legs.length === 1) {
    const l = legs[0];
    if (l.type === "call" && l.side === "long")
      return { name: "long_call", label: "Long Call", bias: "bullish" };
    if (l.type === "put" && l.side === "long")
      return { name: "long_put", label: "Long Put", bias: "bearish" };
    if (l.type === "call" && l.side === "short") {
      if (hasShares) return { name: "covered_call", label: "Covered Call", bias: "neutral" };
      return { name: "short_call", label: "Naked Short Call", bias: "bearish" };
    }
    if (l.type === "put" && l.side === "short")
      return { name: "cash_secured_put", label: "Cash-Secured Put", bias: "bullish" };
  }

  if (legs.length === 2) {
    const sameType = legs[0].type === legs[1].type;
    const sameExpiry = legs[0].expiration === legs[1].expiration;
    if (sameType && sameExpiry) {
      const long = legs.find((l) => l.side === "long");
      const short = legs.find((l) => l.side === "short");
      if (long && short)
        return { name: "vertical_spread", label: "Vertical Spread", bias: "neutral" };
    }
    if (sameType && !sameExpiry)
      return { name: "calendar_spread", label: "Calendar Spread", bias: "neutral" };
    if (!sameType && legs[0].strike === legs[1].strike)
      return { name: "straddle", label: "Straddle", bias: "volatility" };
    if (!sameType) return { name: "strangle", label: "Strangle", bias: "volatility" };
  }

  if (legs.length === 4) return { name: "iron_condor", label: "Iron Condor", bias: "neutral" };
  if (legs.length === 3) return { name: "butterfly", label: "Butterfly", bias: "neutral" };

  return { name: "custom", label: "Custom Multi-Leg", bias: "neutral" };
}
