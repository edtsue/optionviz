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
import { GreeksPanel } from "@/components/GreeksPanel";
import { IdeasPanel } from "@/components/IdeasPanel";
import { TimeSlider } from "@/components/TimeSlider";

export function TradeAnalysis({ trade }: { trade: Trade }) {
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
    return { filled, strategy, stats, kpis, customSeries, dteAtTarget, greeksAtTarget };
  }, [trade, ready, dayProgress]);

  if (!ready || !data) {
    return (
      <div className="card text-sm text-gray-400">
        Fill in symbol, underlying price, strike, premium, and expiration to see the payoff
        chart, Greeks, and ideas.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm text-gray-400">
          {data.strategy.label} · {data.strategy.bias} bias
        </div>
      </div>

      <PayoffChart
        data={data.customSeries}
        underlying={data.filled.underlyingPrice}
        breakevens={data.stats.breakevens}
        midLabel={dayProgressLabel(dayProgress, data.dteAtTarget)}
      />

      <TimeSlider value={dayProgress} onChange={setDayProgress} dteAtTarget={data.dteAtTarget} />

      {data.kpis.length > 0 && (
        <div className="card space-y-3">
          <div className="label">{data.strategy.label} stats</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.kpis.map((k) => (
              <div key={k.label}>
                <div className="text-xs text-gray-400">{k.label}</div>
                <div className="kpi">{k.value}</div>
                {k.hint && <div className="text-xs text-gray-500">{k.hint}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <GreeksPanel greeks={data.greeksAtTarget} stats={data.stats} />

      <IdeasPanel trade={data.filled} />
    </div>
  );
}

function dayProgressLabel(progress: number, dteAtTarget: number): string {
  if (progress <= 0.001) return "Today";
  if (progress >= 0.999) return "At expiry";
  return `${dteAtTarget.toFixed(0)}d to expiry`;
}
