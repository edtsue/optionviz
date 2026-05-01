"use client";
import { useState } from "react";
import type { Trade } from "@/types/trade";
import type { NetGreeks, TradeStats } from "@/lib/payoff";
import { IdeasPanel } from "./IdeasPanel";

interface Props {
  greeks: NetGreeks;
  stats: TradeStats;
  trade: Trade;
  asOfLabel?: string;
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

export function Inspector({ greeks, stats, trade, asOfLabel }: Props) {
  const [showMore, setShowMore] = useState(false);

  const ivs = trade.legs.map((l) => l.iv ?? null).filter((v): v is number => v != null);
  const avgIV = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const asOf = asOfLabel && asOfLabel !== "Today" ? asOfLabel : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-tight space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="label">Trade</span>
          <span className="text-[10px] muted">per-position</span>
        </div>
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

        <div className="border-t border-border pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider muted">Greeks · per share</span>
            {asOf && (
              <span className="text-[10px] warn" title="Slider has moved time forward">
                as of {asOf}
              </span>
            )}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-x-3 gap-y-3 data-grid">
            <Cell
              label="Delta"
              value={fmtDecimal(greeks.delta, 4)}
              t={greeks.delta > 0 ? "gain" : greeks.delta < 0 ? "loss" : ""}
              title="Per-share delta, summed across legs"
            />
            <Cell
              label="IV"
              value={avgIV != null ? `${(avgIV * 100).toFixed(1)}%` : "—"}
              title="Average implied volatility across legs"
            />
            <Cell
              label="Theta"
              value={fmtDecimal(greeks.theta, 3)}
              t={greeks.theta > 0 ? "gain" : greeks.theta < 0 ? "loss" : ""}
              title="$ per share per day"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-[11px] muted hover:text-text"
        >
          {showMore ? "Less ▴" : "More ▾"}
        </button>

        {showMore && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-x-3 gap-y-3 border-t border-border pt-3 data-grid">
            <Cell label="Margin (est)" value={fmtUsd(stats.marginEstimate)} />
            <Cell
              label="Gamma"
              value={fmtDecimal(greeks.gamma, 4)}
              t={greeks.gamma > 0 ? "gain" : greeks.gamma < 0 ? "loss" : ""}
              title="Per-share gamma"
            />
            <Cell
              label="Vega"
              value={fmtDecimal(greeks.vega, 3)}
              t={greeks.vega > 0 ? "gain" : greeks.vega < 0 ? "loss" : ""}
              title="$ per share per 1 IV pt"
            />
            <Cell
              label="Rho"
              value={fmtDecimal(greeks.rho, 3)}
              t={greeks.rho > 0 ? "gain" : greeks.rho < 0 ? "loss" : ""}
              title="$ per share per 1% rate"
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

function fmtDecimal(v: number, dp: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  return `${sign}${Math.abs(v).toFixed(dp)}`;
}

// avoid unused tone helper warnings — keep for future use
void tone;
