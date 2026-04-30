"use client";
import { useState } from "react";
import type { Trade } from "@/types/trade";
import type { NetGreeks, TradeStats } from "@/lib/payoff";
import { IdeasPanel } from "./IdeasPanel";

interface Props {
  greeks: NetGreeks;
  stats: TradeStats;
  trade: Trade;
}

function fmtUsd(v: number | "unlimited"): string {
  if (v === "unlimited") return "∞";
  const sign = v >= 0 ? "" : "−";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function tone(v: number | "unlimited"): "gain" | "loss" | "" {
  if (v === "unlimited") return "gain";
  if (v > 0) return "gain";
  if (v < 0) return "loss";
  return "";
}

export function Inspector({ greeks, stats, trade }: Props) {
  const [showMore, setShowMore] = useState(false);

  const ivs = trade.legs.map((l) => l.iv ?? null).filter((v): v is number => v != null);
  const avgIV = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-tight space-y-3">
        <Hero label="Max Profit" value={fmtUsd(stats.maxProfit)} t="gain" />
        <Hero label="Max Loss" value={fmtUsd(stats.maxLoss)} t="loss" />
        <Hero
          label="Breakeven"
          value={
            stats.breakevens.length
              ? stats.breakevens.map((b) => `$${b}`).join(" · ")
              : "—"
          }
        />

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3">
          <Cell label="Cost" value={fmtUsd(stats.cost)} t={stats.cost >= 0 ? "" : "gain"} sub={stats.cost >= 0 ? "Debit" : "Credit"} />
          <Cell label="PoP" value={stats.pop != null ? `${(stats.pop * 100).toFixed(0)}%` : "—"} t={stats.pop != null && stats.pop > 0.5 ? "gain" : ""} />
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 data-grid">
          <Cell
            label="Delta"
            value={`${greeks.delta >= 0 ? "+" : "−"}$${Math.abs(greeks.delta).toFixed(0)}`}
            t={greeks.delta > 0 ? "gain" : greeks.delta < 0 ? "loss" : ""}
            title="$ change per $1 move in underlying"
          />
          <Cell
            label="Implied Vol"
            value={avgIV != null ? `${(avgIV * 100).toFixed(0)}%` : "—"}
            title="Average implied volatility across legs"
          />
          <Cell
            label="Theta"
            value={`${greeks.theta >= 0 ? "+" : "−"}$${Math.abs(greeks.theta).toFixed(0)}/d`}
            t={greeks.theta > 0 ? "gain" : greeks.theta < 0 ? "loss" : ""}
            title="$ change per day from time decay"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-[11px] muted hover:text-text"
        >
          {showMore ? "Less ▴" : "More ▾"}
        </button>

        {showMore && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 data-grid">
            <Cell label="Margin (est)" value={fmtUsd(stats.marginEstimate)} />
            <Cell
              label="Gamma"
              value={greeks.gamma.toFixed(4)}
              t={greeks.gamma > 0 ? "gain" : greeks.gamma < 0 ? "loss" : ""}
            />
            <Cell
              label="Vega"
              value={`${greeks.vega >= 0 ? "+" : "−"}$${Math.abs(greeks.vega).toFixed(2)}`}
              t={greeks.vega > 0 ? "gain" : greeks.vega < 0 ? "loss" : ""}
            />
            <Cell
              label="Rho"
              value={`${greeks.rho >= 0 ? "+" : "−"}$${Math.abs(greeks.rho).toFixed(2)}`}
              t={greeks.rho > 0 ? "gain" : greeks.rho < 0 ? "loss" : ""}
            />
          </div>
        )}
      </div>

      <IdeasPanel trade={trade} />
    </div>
  );
}

function Hero({ label, value, t }: { label: string; value: string; t?: "gain" | "loss" | "" }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] uppercase tracking-wider muted">{label}</span>
      <span className={`kpi truncate ${t ?? ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function Cell({
  label,
  value,
  t,
  sub,
  title,
}: {
  label: string;
  value: string;
  t?: "gain" | "loss" | "";
  sub?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 flex flex-col" title={title}>
      <span className="text-[10px] uppercase tracking-wider muted">{label}</span>
      <span className={`kpi-sm truncate ${t ?? ""}`} title={value}>
        {value}
      </span>
      {sub && <span className="text-[10px] muted">{sub}</span>}
    </div>
  );
}

// avoid unused tone helper warnings — keep for future use
void tone;
