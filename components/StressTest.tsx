"use client";
import { useDeferredValue, useMemo, useState } from "react";
import type { Trade } from "@/types/trade";
import { netGreeks, totalPnL } from "@/lib/payoff";

interface Props {
  trade: Trade;
  /** Maximum days forward (≤ days to last expiry) */
  maxDaysForward: number;
}

export function StressTest({ trade, maxDaysForward }: Props) {
  const [ivShock, setIvShock] = useState(0); // % shift to each leg's IV
  const [spotShock, setSpotShock] = useState(0); // % shift to underlying
  const [daysForward, setDaysForward] = useState(0);

  // Defer the slider values so React can keep the slider thumb itself responsive
  // while the (expensive) Black-Scholes recompute runs at lower priority.
  // During fast drags this lets React skip intermediate frames entirely.
  const deferredIvShock = useDeferredValue(ivShock);
  const deferredSpotShock = useDeferredValue(spotShock);
  const deferredDaysForward = useDeferredValue(daysForward);

  const { stressedTrade, valDate, basePnL, stressedPnL, baseGreeks, stressedGreeks } =
    useMemo(() => {
      const stressedTrade: Trade = {
        ...trade,
        underlyingPrice: +(trade.underlyingPrice * (1 + deferredSpotShock / 100)).toFixed(2),
        legs: trade.legs.map((l) => ({
          ...l,
          iv: l.iv != null ? Math.max(0.01, l.iv * (1 + deferredIvShock / 100)) : l.iv,
        })),
      };
      const valDate = new Date(Date.now() + deferredDaysForward * 86_400_000);
      const baseValDate = new Date();
      const basePnL = totalPnL(trade, trade.underlyingPrice, baseValDate);
      const stressedPnL = totalPnL(stressedTrade, stressedTrade.underlyingPrice, valDate);
      const baseGreeks = netGreeks(trade, baseValDate);
      const stressedGreeks = netGreeks(stressedTrade, valDate);
      return { stressedTrade, valDate, basePnL, stressedPnL, baseGreeks, stressedGreeks };
    }, [trade, deferredIvShock, deferredSpotShock, deferredDaysForward]);

  const pnlDelta = stressedPnL - basePnL;
  const dirty = ivShock !== 0 || spotShock !== 0 || daysForward !== 0;

  function applyPreset(name: string) {
    if (name === "earnings_iv") {
      setIvShock(50);
      setSpotShock(0);
      setDaysForward(0);
    } else if (name === "iv_crush") {
      setIvShock(-30);
      setSpotShock(0);
      setDaysForward(1);
    } else if (name === "down_5") {
      setIvShock(20);
      setSpotShock(-5);
      setDaysForward(1);
    } else if (name === "up_5") {
      setIvShock(-10);
      setSpotShock(5);
      setDaysForward(1);
    } else if (name === "time_3d") {
      setIvShock(0);
      setSpotShock(0);
      setDaysForward(3);
    } else if (name === "reset") {
      setIvShock(0);
      setSpotShock(0);
      setDaysForward(0);
    }
  }

  return (
    <div className="card card-tight space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="label">Stress test</div>
        {dirty && (
          <button
            type="button"
            onClick={() => applyPreset("reset")}
            className="text-[10px] muted hover:text-text"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <Preset label="Earnings IV +50%" onClick={() => applyPreset("earnings_iv")} />
        <Preset label="IV crush −30%" onClick={() => applyPreset("iv_crush")} />
        <Preset label="−5% & vol up" onClick={() => applyPreset("down_5")} />
        <Preset label="+5% & vol down" onClick={() => applyPreset("up_5")} />
        <Preset label="+3 days" onClick={() => applyPreset("time_3d")} />
      </div>

      <div className="space-y-2">
        <Slider
          label="Spot move"
          unit="%"
          min={-30}
          max={30}
          step={1}
          value={spotShock}
          onChange={setSpotShock}
          formatted={`${spotShock >= 0 ? "+" : ""}${spotShock}%`}
        />
        <Slider
          label="IV shock"
          unit="%"
          min={-50}
          max={100}
          step={5}
          value={ivShock}
          onChange={setIvShock}
          formatted={`${ivShock >= 0 ? "+" : ""}${ivShock}%`}
        />
        <DayButtons
          label="Days forward"
          value={daysForward}
          onChange={setDaysForward}
          max={Math.max(1, Math.round(maxDaysForward))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-2 data-grid">
        <Cell
          label="Stressed P/L"
          value={fmtPnL(stressedPnL)}
          tone={stressedPnL > 0 ? "gain" : stressedPnL < 0 ? "loss" : ""}
          sub={dirty ? `${pnlDelta >= 0 ? "+" : ""}${fmtPnL(pnlDelta)} vs now` : "matches now"}
        />
        <Cell
          label="At underlying"
          value={`$${stressedTrade.underlyingPrice.toFixed(2)}`}
          sub={daysForward > 0 ? `t+${daysForward}d (${valDate.toISOString().slice(0, 10)})` : "today"}
        />
        <Cell
          label="Delta"
          value={`${stressedGreeks.delta >= 0 ? "+" : "−"}$${Math.abs(stressedGreeks.delta).toFixed(2)}`}
          tone={stressedGreeks.delta > 0 ? "gain" : stressedGreeks.delta < 0 ? "loss" : ""}
          sub={`Δ ${(stressedGreeks.delta - baseGreeks.delta).toFixed(2)}`}
        />
        <Cell
          label="Theta"
          value={`${stressedGreeks.theta >= 0 ? "+" : "−"}$${Math.abs(stressedGreeks.theta).toFixed(2)}/d`}
          tone={stressedGreeks.theta > 0 ? "gain" : stressedGreeks.theta < 0 ? "loss" : ""}
          sub={`Δ ${(stressedGreeks.theta - baseGreeks.theta).toFixed(2)}`}
        />
      </div>
    </div>
  );
}

function DayButtons({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  const presets = [0, 1, 3, 7, 14, 30].filter((d) => d <= max);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="muted">{label}</span>
        <span className="kpi-xs">{value === 0 ? "now" : `+${value}d`}</span>
      </div>
      <div className="flex flex-wrap gap-1 pt-1">
        {presets.map((d) => {
          const active = value === d;
          return (
            <button
              type="button"
              key={d}
              onClick={() => onChange(d)}
              className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border hover:border-accent/40"
              }`}
            >
              {d === 0 ? "Now" : `+${d}D`}
            </button>
          );
        })}
        {max > 30 && (
          <button
            type="button"
            onClick={() => onChange(max)}
            className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
              value === max ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-accent/40"
            }`}
          >
            Expiry ({max}D)
          </button>
        )}
      </div>
    </div>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-accent/40"
    >
      {label}
    </button>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  formatted,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatted: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="muted">{label}</span>
        <span className="kpi-xs">{formatted}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full"
        aria-label={`${label} ${unit}`}
      />
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
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
