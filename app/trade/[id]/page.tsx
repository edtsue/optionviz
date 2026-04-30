"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { tradesClient } from "@/lib/trades-client";
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
import type { Trade } from "@/types/trade";

export default function TradePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [notFound, setNotFound] = useState(false);
  // dayOffset: 0 = today, 1 = expiry
  const [dayProgress, setDayProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    tradesClient
      .get(params.id)
      .then((t) => {
        if (cancelled) return;
        if (!t) setNotFound(true);
        else setTrade(fillImpliedVolsForTrade(t));
      })
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const data = useMemo(() => {
    if (!trade) return null;
    const strategy = detectStrategy(trade);
    const stats = tradeStats(trade);
    const greeks = netGreeks(trade);
    const kpis = strategyKPIs(trade);

    const lastExpiry = new Date(
      Math.max(...trade.legs.map((l) => new Date(l.expiration).getTime())),
    );
    const now = new Date();
    const targetDate = new Date(now.getTime() + dayProgress * (lastExpiry.getTime() - now.getTime()));
    const dteAtTarget = yearsBetween(targetDate, lastExpiry) * 365;

    const fullPayoff = buildPayoff(trade);
    const customSeries: PayoffPoint[] = fullPayoff.map((p) => ({
      ...p,
      mid: +totalPnL(trade, p.spot, targetDate).toFixed(2),
    }));
    const greeksAtTarget = netGreeks(trade, targetDate);
    return { strategy, stats, greeks, kpis, customSeries, targetDate, dteAtTarget, greeksAtTarget };
  }, [trade, dayProgress]);

  if (notFound) {
    return (
      <div className="card text-center">
        <p>Trade not found.</p>
        <Link href="/" className="btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-sm">
          Back home
        </Link>
      </div>
    );
  }

  if (!trade || !data) return <div className="text-sm text-gray-400">Loading…</div>;

  async function onDelete() {
    if (!confirm("Delete this trade?")) return;
    await tradesClient.remove(params.id);
    router.push("/");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {trade.symbol} <span className="text-gray-400">· {data.strategy.label}</span>
          </h1>
          <div className="text-sm text-gray-400">
            Underlying ${trade.underlyingPrice.toFixed(2)} · {data.strategy.bias} bias
          </div>
        </div>
        <button onClick={onDelete} className="btn-danger rounded-lg px-3 py-1.5 text-sm">
          Delete
        </button>
      </div>

      <PayoffChart
        data={data.customSeries}
        underlying={trade.underlyingPrice}
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

      <div className="card">
        <div className="label mb-2">Legs</div>
        <div className="space-y-2 text-sm">
          {trade.legs.map((l, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <div>
                <span className={l.side === "long" ? "text-gain" : "text-loss"}>
                  {l.side === "long" ? "Long" : "Short"}
                </span>{" "}
                {l.quantity}× {l.type === "call" ? "Call" : "Put"} @ ${l.strike}
              </div>
              <div className="text-xs text-gray-400">
                {l.expiration} · prem ${l.premium.toFixed(2)} · IV{" "}
                {((l.iv ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
          ))}
          {trade.underlying && (
            <div className="rounded-md border border-border p-2 text-sm">
              <span className="text-gain">Long</span> {trade.underlying.shares} shares @ $
              {trade.underlying.costBasis.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {trade.notes && (
        <div className="card">
          <div className="label mb-1">Notes</div>
          <p className="text-sm whitespace-pre-wrap">{trade.notes}</p>
        </div>
      )}

      <IdeasPanel trade={trade} />
    </div>
  );
}

function dayProgressLabel(progress: number, dteAtTarget: number): string {
  if (progress <= 0.001) return "Today";
  if (progress >= 0.999) return "At expiry";
  return `${dteAtTarget.toFixed(0)}d to expiry`;
}
