import type { Trade } from "@/types/trade";
import { detectStrategy } from "./strategies";
import { yearsBetween } from "./black-scholes";

export interface StrategyKPI {
  label: string;
  value: string;
  hint?: string;
}

export function strategyKPIs(trade: Trade): StrategyKPI[] {
  const strat = detectStrategy(trade);
  const out: StrategyKPI[] = [];
  const leg = trade.legs[0];
  const dte =
    leg && yearsBetween(new Date(), new Date(leg.expiration)) * 365;

  if (strat.name === "covered_call" && trade.underlying && leg) {
    const cb = trade.underlying.costBasis;
    const prem = leg.premium;
    const strike = leg.strike;
    const downsideProtection = (prem / cb) * 100;
    const callReturn = ((strike - cb + prem) / cb) * 100;
    const ifNotCalledReturn = (prem / cb) * 100;
    const annualized = dte && dte > 0 ? (callReturn / dte) * 365 : 0;
    out.push(
      { label: "If-called return", value: `${callReturn.toFixed(2)}%`, hint: "Total return if shares are assigned at strike" },
      { label: "Annualized (if called)", value: `${annualized.toFixed(1)}%`, hint: `Over ${dte?.toFixed(0)}d` },
      { label: "Static yield", value: `${ifNotCalledReturn.toFixed(2)}%`, hint: "Premium / cost basis if not called" },
      { label: "Downside cushion", value: `${downsideProtection.toFixed(2)}%`, hint: "Premium as % of cost basis" },
    );
  }

  if (strat.name === "cash_secured_put" && leg) {
    const collateral = leg.strike * 100 * leg.quantity;
    const credit = leg.premium * 100 * leg.quantity;
    const yieldPct = (credit / collateral) * 100;
    const annualized = dte && dte > 0 ? (yieldPct / dte) * 365 : 0;
    const effectiveCost = leg.strike - leg.premium;
    const discount = ((trade.underlyingPrice - effectiveCost) / trade.underlyingPrice) * 100;
    out.push(
      { label: "Yield on collateral", value: `${yieldPct.toFixed(2)}%`, hint: `${dte?.toFixed(0)}d` },
      { label: "Annualized", value: `${annualized.toFixed(1)}%` },
      { label: "Effective cost if assigned", value: `$${effectiveCost.toFixed(2)}`, hint: `${discount.toFixed(1)}% below current` },
      { label: "Collateral required", value: `$${collateral.toLocaleString()}` },
    );
  }

  if (strat.name === "long_call" && leg) {
    const breakeven = leg.strike + leg.premium;
    const moveNeeded = ((breakeven - trade.underlyingPrice) / trade.underlyingPrice) * 100;
    out.push(
      { label: "Breakeven", value: `$${breakeven.toFixed(2)}` },
      { label: "Move needed", value: `${moveNeeded.toFixed(2)}%`, hint: "From current to breakeven" },
      { label: "Days to expiry", value: `${dte?.toFixed(0)}d` },
    );
  }

  if (strat.name === "long_put" && leg) {
    const breakeven = leg.strike - leg.premium;
    const moveNeeded = ((trade.underlyingPrice - breakeven) / trade.underlyingPrice) * 100;
    out.push(
      { label: "Breakeven", value: `$${breakeven.toFixed(2)}` },
      { label: "Move needed (down)", value: `${moveNeeded.toFixed(2)}%` },
      { label: "Days to expiry", value: `${dte?.toFixed(0)}d` },
    );
  }

  return out;
}
