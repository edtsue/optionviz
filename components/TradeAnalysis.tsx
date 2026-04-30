"use client";
import { useMemo, useState } from "react";
import type { Trade } from "@/types/trade";
import { detectStrategy } from "@/lib/strategies";
import {
  buildPayoff,
  fillImpliedVolsForTrade,
  netGreeks,
  totalPnL,
  tradeStats,
  type PayoffPoint,
} from "@/lib/payoff";
import { strategyKPIs } from "@/lib/strategy-kpis";
import { yearsBetween } from "@/lib/black-scholes";
import { PayoffChart } from "@/components/PayoffChart";
import { TimeSlider } from "@/components/TimeSlider";
import { Inspector } from "@/components/Inspector";

export function TradeAnalysis({ trade, sideBySide = true }: { trade: Trade; sideBySide?: boolean }) {
  const [dayProgress, setDayProgress] = useState(0);

  const ready = useMemo(() => {
    if (!trade.legs.length) return false;
    if (!trade.underlyingPrice || trade.underlyingPrice <= 0) return false;
    return trade.legs.every(
      (l) => l.strike > 0 && l.expiration && !Number.isNaN(new Date(l.expiration).getTime()),
    );
  }, [trade]);

  const data = useMemo(() => {
    if (!ready) return null;
    const filled = fillImpliedVolsForTrade(trade);
    const strategy = detectStrategy(filled);
    const stats = tradeStats(filled);
    const kpis = strategyKPIs(filled);

    const lastExpiry = new Date(
      Math.max(...filled.legs.map((l) => new Date(l.expiration).getTime())),
    );
    const now = new Date();
    const targetDate = new Date(now.getTime() + dayProgress * (lastExpiry.getTime() - now.getTime()));
    const dteAtTarget = yearsBetween(targetDate, lastExpiry) * 365;

    const fullPayoff = buildPayoff(filled);
    const customSeries: PayoffPoint[] = fullPayoff.map((p) => ({
      ...p,
      mid: +totalPnL(filled, p.spot, targetDate).toFixed(2),
    }));
    const greeksAtTarget = netGreeks(filled, targetDate);

    // 1σ band at expiry from average leg IV (lognormal terminal price)
    const T = yearsBetween(now, lastExpiry);
    const ivs = filled.legs.map((l) => l.iv ?? 0.3);
    const sigma = ivs.reduce((a, b) => a + b, 0) / Math.max(ivs.length, 1);
    const oneSigmaBand: [number, number] | null =
      T > 0 && sigma > 0
        ? [
            +(filled.underlyingPrice * Math.exp(-sigma * Math.sqrt(T))).toFixed(2),
            +(filled.underlyingPrice * Math.exp(sigma * Math.sqrt(T))).toFixed(2),
          ]
        : null;

    return { filled, strategy, stats, kpis, customSeries, dteAtTarget, greeksAtTarget, oneSigmaBand };
  }, [trade, ready, dayProgress]);

  if (!ready || !data) {
    return (
      <div className="card text-sm muted">
        Fill in symbol, underlying price, strike, premium, and expiration to see the payoff
        chart, Greeks, and ideas.
      </div>
    );
  }

  const main = (
    <div className="flex flex-col gap-3">
      <PayoffChart
        data={data.customSeries}
        underlying={data.filled.underlyingPrice}
        breakevens={data.stats.breakevens}
        midLabel={dayProgressLabel(dayProgress, data.dteAtTarget)}
        oneSigmaBand={data.oneSigmaBand}
      />
      <TimeSlider value={dayProgress} onChange={setDayProgress} dteAtTarget={data.dteAtTarget} />
      {data.kpis.length > 0 && (
        <div className="card card-tight">
          <div className="label mb-2">{data.strategy.label} stats</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 data-grid">
            {data.kpis.map((k) => (
              <div key={k.label} className="flex flex-col">
                <span className="text-[10px] muted">{k.label}</span>
                <span className="kpi-sm">{k.value}</span>
                {k.hint && <span className="text-[10px] muted">{k.hint}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const right = (
    <Inspector greeks={data.greeksAtTarget} stats={data.stats} trade={data.filled} />
  );

  if (!sideBySide) {
    return (
      <div className="space-y-3">
        {main}
        {right}
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">{main}</div>
      <div>{right}</div>
    </div>
  );
}

function dayProgressLabel(progress: number, dteAtTarget: number): string {
  if (progress <= 0.001) return "Today";
  if (progress >= 0.999) return "At expiry";
  return `${dteAtTarget.toFixed(0)}d to expiry`;
}
