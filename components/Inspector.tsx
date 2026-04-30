"use client";
import type { Trade } from "@/types/trade";
import type { NetGreeks, TradeStats } from "@/lib/payoff";
import { IdeasPanel } from "./IdeasPanel";

interface Props {
  greeks: NetGreeks;
  stats: TradeStats;
  trade: Trade;
}

const GREEK_HINTS: Record<string, string> = {
  Delta: "$ change per $1 move in underlying",
  IV: "Implied volatility (avg of legs)",
  Theta: "$ change per day from time decay",
  Gamma: "Delta change per $1 underlying move",
  Vega: "$ change per 1 IV point",
  Rho: "$ change per 1% rate move",
};

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
  const ivs = trade.legs.map((l) => l.iv ?? null).filter((v): v is number => v != null);
  const avgIV = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="card card-tight">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="label">Risk exposure</div>
          <div className="text-[10px] muted">per-position $</div>
        </div>
        {/* Primary trio: Delta, IV, Theta */}
        <div className="grid grid-cols-3 gap-2 data-grid">
          <PrimaryGreek
            name="Delta"
            value={`${greeks.delta >= 0 ? "+" : "−"}$${Math.abs(greeks.delta).toFixed(2)}`}
            tone={greeks.delta > 0 ? "gain" : greeks.delta < 0 ? "loss" : ""}
            hint={GREEK_HINTS.Delta}
          />
          <PrimaryGreek
            name="Implied Vol"
            value={avgIV != null ? `${(avgIV * 100).toFixed(1)}%` : "—"}
            tone={avgIV != null ? (avgIV > 0.5 ? "warn" : "") : ""}
            hint={GREEK_HINTS.IV}
          />
          <PrimaryGreek
            name="Theta"
            value={`${greeks.theta >= 0 ? "+" : "−"}$${Math.abs(greeks.theta).toFixed(2)}/d`}
            tone={greeks.theta > 0 ? "gain" : greeks.theta < 0 ? "loss" : ""}
            hint={GREEK_HINTS.Theta}
          />
        </div>
        {/* Secondary trio: Gamma, Vega, Rho — smaller, still readable */}
        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2 data-grid">
          <SecondaryGreek
            name="Gamma"
            value={greeks.gamma.toFixed(4)}
            tone={greeks.gamma > 0 ? "gain" : greeks.gamma < 0 ? "loss" : ""}
            hint={GREEK_HINTS.Gamma}
          />
          <SecondaryGreek
            name="Vega"
            value={`${greeks.vega >= 0 ? "+" : "−"}$${Math.abs(greeks.vega).toFixed(2)}`}
            tone={greeks.vega > 0 ? "gain" : greeks.vega < 0 ? "loss" : ""}
            hint={GREEK_HINTS.Vega}
          />
          <SecondaryGreek
            name="Rho"
            value={`${greeks.rho >= 0 ? "+" : "−"}$${Math.abs(greeks.rho).toFixed(2)}`}
            tone={greeks.rho > 0 ? "gain" : greeks.rho < 0 ? "loss" : ""}
            hint={GREEK_HINTS.Rho}
          />
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

function PrimaryGreek({
  name,
  value,
  tone,
  hint,
}: {
  name: string;
  value: string;
  tone: string;
  hint: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col rounded-md border border-border bg-white/[0.02] p-2"
      title={hint}
    >
      <span className="text-[10px] uppercase tracking-wider muted">{name}</span>
      <span className={`kpi-sm truncate ${tone}`}>{value}</span>
    </div>
  );
}

function SecondaryGreek({
  name,
  value,
  tone,
  hint,
}: {
  name: string;
  value: string;
  tone: string;
  hint: string;
}) {
  return (
    <div className="flex min-w-0 flex-col" title={hint}>
      <span className="text-[10px] muted">{name}</span>
      <span className={`text-xs font-mono font-semibold truncate ${tone}`}>{value}</span>
    </div>
  );
}
