"use client";
import type { DetectedStrategy, Leg, Trade } from "@/types/trade";

interface Props {
  trade: Trade;
  strategy: DetectedStrategy;
}

function dteDays(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function actionLabel(leg: Leg): string {
  const verb = leg.side === "long" ? "Buy to open" : "Sell to open";
  return `${verb} ${leg.type === "call" ? "Call" : "Put"}`;
}

function fmtUsd(v: number, dp = 2): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function TradeInputs({ trade, strategy }: Props) {
  return (
    <div className="card card-tight space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="label">Trade inputs</span>
        <span className="text-[10px] muted">from ticket</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Row label="Symbol" value={trade.symbol || "—"} />
        <Row label="Spot" value={fmtUsd(trade.underlyingPrice)} />
        <Row label="Strategy" value={strategy.label} span />
        <Row label="Bias" value={strategy.bias} />
        {trade.underlying && (
          <Row
            label="Shares"
            value={`${trade.underlying.shares.toLocaleString()} @ ${fmtUsd(trade.underlying.costBasis)}`}
            span
          />
        )}
      </div>

      {trade.legs.map((leg, i) => {
        const dte = dteDays(leg.expiration);
        return (
          <div
            key={i}
            className="space-y-2 border-t border-border pt-3"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider muted">
                Leg {trade.legs.length > 1 ? i + 1 : ""}
              </span>
              <span
                className={`text-[11px] font-semibold ${leg.side === "short" ? "text-rose-400" : "text-emerald-400"}`}
              >
                {actionLabel(leg)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Row label="Strike" value={fmtUsd(leg.strike)} />
              <Row label="Premium" value={`${fmtUsd(leg.premium)}/sh`} />
              <Row
                label="Quantity"
                value={`${leg.quantity} ${leg.quantity === 1 ? "contract" : "contracts"}`}
              />
              <Row
                label="Expires"
                value={leg.expiration ? `${leg.expiration} (${dte}d)` : "—"}
                tone={!leg.expiration ? "warn" : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  label,
  value,
  span,
  tone,
}: {
  label: string;
  value: string;
  span?: boolean;
  tone?: "warn";
}) {
  return (
    <div className={`min-w-0 flex flex-col ${span ? "col-span-2" : ""}`}>
      <span className="text-[10px] uppercase tracking-wider muted">{label}</span>
      <span
        className={`kpi-sm truncate ${tone === "warn" ? "text-amber-400" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
