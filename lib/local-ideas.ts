import type { Trade } from "@/types/trade";
import { detectStrategy } from "./strategies";

export interface Idea {
  name: string;
  bias: string;
  thesis: string;
  structure: string;
  tradeoffs: string;
  whenToConsider: string;
}

// Rules-based fallback when no Anthropic key is configured.
export function localIdeas(trade: Trade): Idea[] {
  const strat = detectStrategy(trade);
  const leg = trade.legs[0];
  if (!leg) return [];

  const expiry = leg.expiration;
  const ideas: Idea[] = [];

  if (strat.name === "long_call") {
    const upperStrike = +(leg.strike * 1.1).toFixed(0);
    ideas.push({
      name: "Convert to call debit spread",
      bias: "bullish",
      thesis: "Cap upside to fund the long call — cheaper, higher PoP, lower max loss.",
      structure: `Long ${leg.quantity}× ${leg.strike}C ${expiry}\nShort ${leg.quantity}× ${upperStrike}C ${expiry}`,
      tradeoffs: "Trades unlimited upside for ~30-50% lower cost.",
      whenToConsider: "You expect a moderate move (5-15%), not a runaway breakout.",
    });
    ideas.push({
      name: "Buy LEAPS instead",
      bias: "bullish",
      thesis: "Move to a deep-ITM call ≥6 months out — closer-to-1 delta, less theta drag.",
      structure: `Long ${leg.quantity}× ITM call (e.g. 0.80 delta), 6-12mo expiry`,
      tradeoffs: "Higher premium outlay, but acts more like leveraged stock.",
      whenToConsider: "Conviction is the long-term thesis, not a near-term catalyst.",
    });
    ideas.push({
      name: "Sell a CSP instead",
      bias: "bullish",
      thesis: "Get paid to wait for a better entry on the same name.",
      structure: `Short put @ ${(trade.underlyingPrice * 0.95).toFixed(0)} ${expiry}`,
      tradeoffs: "Caps upside (no participation if it rips), but earns premium and only assigns at a discount.",
      whenToConsider: "You'd be happy owning shares, and want positive theta.",
    });
  }

  if (strat.name === "covered_call") {
    const higherStrike = +(leg.strike * 1.05).toFixed(0);
    const lowerStrike = +(leg.strike * 0.97).toFixed(0);
    ideas.push({
      name: "Roll up & out",
      bias: "neutral",
      thesis: "If shares ran toward the strike, roll to a later expiry at a higher strike to keep upside.",
      structure: `Buy to close current ${leg.strike}C\nSell to open ${higherStrike}C, +30-45 days`,
      tradeoffs: "Usually a small debit; preserves more upside but extends duration.",
      whenToConsider: "Stock is near or above the short strike with time still on the clock.",
    });
    ideas.push({
      name: "Convert to collar",
      bias: "neutral",
      thesis: "Use the call premium to fund a protective put — caps upside AND downside.",
      structure: `Keep short ${leg.strike}C\nLong ${lowerStrike}P ${expiry}`,
      tradeoffs: "Locks in a defined-risk band; sacrifices premium income.",
      whenToConsider: "You want to hedge against a sharp drawdown in earnings/macro events.",
    });
    ideas.push({
      name: "Diagonal call (poor man's covered call)",
      bias: "neutral",
      thesis: "Replace shares with a deep-ITM LEAPS call — same delta exposure, way less capital.",
      structure: `Sell shares\nLong 1× deep-ITM call 6-12mo\nShort 1× ${leg.strike}C ${expiry}`,
      tradeoffs: "Less capital tied up, but loses the dividend and the LEAPS still has theta.",
      whenToConsider: "You want the same income stream but free up cash for other ideas.",
    });
  }

  if (strat.name === "cash_secured_put") {
    const lowerStrike = +(leg.strike * 0.95).toFixed(0);
    ideas.push({
      name: "Convert to put credit spread",
      bias: "bullish",
      thesis: "Defined max loss instead of full assignment risk — frees up most of the collateral.",
      structure: `Short ${leg.strike}P ${expiry}\nLong ${lowerStrike}P ${expiry}`,
      tradeoffs: "Lower max profit (just the net credit), but capital efficient.",
      whenToConsider: "You want exposure but don't actually want to be assigned shares.",
    });
    ideas.push({
      name: "Ladder multiple strikes",
      bias: "bullish",
      thesis: "Sell smaller size across 2-3 strikes to scale into a position over different prices.",
      structure: `Short 1× ${leg.strike}P\nShort 1× ${(leg.strike * 0.95).toFixed(0)}P\nShort 1× ${(leg.strike * 0.9).toFixed(0)}P, all ${expiry}`,
      tradeoffs: "Lower per-strike size but better average entry if the stock drifts down.",
      whenToConsider: "You want to scale in rather than commit at one strike.",
    });
    ideas.push({
      name: "Move to a further OTM strike",
      bias: "bullish",
      thesis: "Reduce assignment probability in exchange for a smaller premium.",
      structure: `Short ${(leg.strike * 0.93).toFixed(0)}P ${expiry}`,
      tradeoffs: "Higher PoP, lower yield. Better if you're not committed to assignment.",
      whenToConsider: "You want a higher-probability income trade.",
    });
  }

  if (ideas.length === 0) {
    ideas.push({
      name: "No local rules for this structure",
      bias: strat.bias,
      thesis: "Connect ANTHROPIC_API_KEY to get Claude-generated alternatives for this trade.",
      structure: "—",
      tradeoffs: "—",
      whenToConsider: "—",
    });
  }

  return ideas;
}
