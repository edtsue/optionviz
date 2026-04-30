"use client";
import { useMemo } from "react";

interface Props {
  underlying: number;
  scrubSpot: number | null;
  onScrub: (spot: number | null) => void;
  /** P/L lookup at a given spot — pulled from the active payoff curve */
  pnlAt: (spot: number, series: "today" | "mid" | "expiry") => number;
  midLabel: string;
}

const PRESETS = [-15, -10, -5, 0, 5, 10, 15];

export function WhatIfBar({ underlying, scrubSpot, onScrub, pnlAt, midLabel }: Props) {
  const activeSpot = scrubSpot ?? underlying;
  const pctFromSpot = ((activeSpot - underlying) / underlying) * 100;

  const cells = useMemo(
    () => [
      { label: "At expiry", value: pnlAt(activeSpot, "expiry") },
      { label: midLabel, value: pnlAt(activeSpot, "mid") },
      { label: "Today", value: pnlAt(activeSpot, "today") },
    ],
    [activeSpot, pnlAt, midLabel],
  );

  return (
    <div className="card card-tight space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="label">What-if move</div>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((pct) => {
            const target = +(underlying * (1 + pct / 100)).toFixed(2);
            const active = scrubSpot != null && Math.abs(scrubSpot - target) < 0.01;
            return (
              <button
                type="button"
                key={pct}
                onClick={() => onScrub(target)}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border hover:border-accent/40"
                }`}
              >
                {pct === 0 ? "Spot" : `${pct > 0 ? "+" : ""}${pct}%`}
              </button>
            );
          })}
          {scrubSpot != null && (
            <button
              type="button"
              onClick={() => onScrub(null)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-loss/50 hover:text-loss"
              title="Clear scrub line"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 data-grid">
        <Cell
          label="At underlying"
          value={`$${activeSpot.toFixed(2)}`}
          sub={`${pctFromSpot >= 0 ? "+" : ""}${pctFromSpot.toFixed(1)}% from spot`}
        />
        {cells.map((c) => (
          <Cell
            key={c.label}
            label={c.label}
            value={fmtPnL(c.value)}
            tone={c.value > 0 ? "gain" : c.value < 0 ? "loss" : ""}
          />
        ))}
      </div>
      <p className="text-[10px] muted">
        Move your cursor across the chart or click a % button to lock in a price.
      </p>
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider muted">{label}</span>
      <span className={`kpi-sm truncate ${tone ?? ""}`} title={value}>
        {value}
      </span>
      {sub && <span className="text-[10px] muted">{sub}</span>}
    </div>
  );
}

function fmtPnL(v: number): string {
  if (Math.abs(v) < 0.5) return "$0";
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
