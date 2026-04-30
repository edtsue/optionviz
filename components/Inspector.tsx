"use client";
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
  return `${v >= 0 ? "" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function tone(v: number | "unlimited"): string {
  if (v === "unlimited") return "";
  if (v > 0) return "gain";
  if (v < 0) return "loss";
  return "";
}

export function Inspector({ greeks, stats, trade }: Props) {
  const greekRows: Array<[string, string, number]> = [
    ["Δ", "Delta", greeks.delta],
    ["Γ", "Gamma", greeks.gamma],
    ["Θ", "Theta", greeks.theta],
    ["ν", "Vega", greeks.vega],
    ["ρ", "Rho", greeks.rho],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-tight">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="label">Net Greeks</div>
          <div className="text-[10px] muted">×100 mult applied</div>
        </div>
        <div className="grid grid-cols-5 gap-2 data-grid">
          {greekRows.map(([sym, name, val]) => {
            const t = val > 0 ? "gain" : val < 0 ? "loss" : "";
            return (
              <div key={name} className="flex flex-col items-center rounded-md border border-border/60 bg-white/[0.02] p-2">
                <span className="text-[10px] muted">{name}</span>
                <span className="font-mono text-base">{sym}</span>
                <span className={`kpi-xs ${t}`}>{val.toFixed(name === "Gamma" ? 4 : 2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card card-tight">
        <div className="label mb-2">Stats</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
          <Cell label="Cost" value={fmtUsd(stats.cost)} t={stats.cost >= 0 ? "" : "gain"} sub={stats.cost >= 0 ? "Debit" : "Credit"} />
          <Cell label="Max profit" value={fmtUsd(stats.maxProfit)} t={tone(stats.maxProfit)} />
          <Cell label="Max loss" value={fmtUsd(stats.maxLoss)} t={tone(stats.maxLoss)} />
          <Cell label="Margin (est)" value={fmtUsd(stats.marginEstimate)} />
          <Cell label="PoP" value={stats.pop != null ? `${(stats.pop * 100).toFixed(0)}%` : "—"} t={stats.pop != null && stats.pop > 0.5 ? "gain" : ""} />
          <Cell
            label="Breakevens"
            value={
              stats.breakevens.length ? stats.breakevens.map((b) => `$${b}`).join(" · ") : "—"
            }
          />
        </div>
      </div>

      <details className="card card-tight" open>
        <summary className="flex items-center justify-between">
          <span className="label">Ideas</span>
          <span className="text-[10px] muted">click ▾</span>
        </summary>
        <div className="mt-2">
          <IdeasPanel trade={trade} />
        </div>
      </details>
    </div>
  );
}

function Cell({
  label,
  value,
  t,
  sub,
}: {
  label: string;
  value: string;
  t?: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider muted">{label}</span>
      <span className={`kpi-sm truncate ${t ?? ""}`} title={value}>
        {value}
      </span>
      {sub && <span className="text-[10px] muted">{sub}</span>}
    </div>
  );
}
