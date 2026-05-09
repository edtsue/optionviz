"use client";
import { useEffect, useMemo, useState } from "react";
import type { Trade } from "@/types/trade";

interface Props {
  open: boolean;
  trade: Trade;
  onCancel: () => void;
  onConfirm: (input: {
    exitCredit: number;
    notes: string | null;
    entryCredit: number;
    realizedPnL: number;
    realizedPnLPct: number | null;
    capitalAtRisk: number;
  }) => void;
}

const CONTRACT_MULT = 100;

// Net premium at entry from the legs as recorded on the trade. Positive
// means the user collected premium (credit trade); negative means a debit.
function netEntryCredit(trade: Trade): number {
  let total = 0;
  for (const l of trade.legs) {
    const sign = l.side === "short" ? 1 : -1;
    total += sign * l.premium * l.quantity * CONTRACT_MULT;
  }
  return +total.toFixed(2);
}

// Capital at risk denominator. For a defined-risk debit, max debit; for a
// credit, the absolute total premium collected as a rough proxy.
function capitalAtRisk(trade: Trade): number {
  let total = 0;
  for (const l of trade.legs) {
    total += l.premium * l.quantity * CONTRACT_MULT;
  }
  if (trade.underlying) {
    total += Math.abs(trade.underlying.shares) * trade.underlying.costBasis;
  }
  return +total.toFixed(2);
}

export function CloseTradeDialog({ open, trade, onCancel, onConfirm }: Props) {
  const [exitInput, setExitInput] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (open) {
      setExitInput("");
      setNotes("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const entryCredit = useMemo(() => netEntryCredit(trade), [trade]);
  const risk = useMemo(() => capitalAtRisk(trade), [trade]);

  const exitCredit = parseFloat(exitInput);
  const exitValid = Number.isFinite(exitCredit);
  // Convention: exitCredit is the dollar amount you received (positive) or
  // paid (negative) to close. realized = entryCredit + exitCredit.
  // Example: opened a credit spread for +$120, bought it back for -$40.
  // Result: +$120 + (-$40) = +$80 profit.
  const realized = exitValid ? +(entryCredit + exitCredit).toFixed(2) : 0;
  const realizedPct =
    exitValid && risk > 0 ? +((realized / risk) * 100).toFixed(1) : null;

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="card w-full max-w-md space-y-4">
        <div>
          <div className="text-base font-semibold">Close trade — log to journal</div>
          <p className="mt-1 text-xs muted">
            {trade.symbol} · {trade.legs.length} leg{trade.legs.length === 1 ? "" : "s"} ·
            entry {entryCredit >= 0 ? "+" : "−"}${Math.abs(entryCredit).toFixed(2)}
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider muted">
            Exit credit ($)
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={exitInput}
            onChange={(e) => setExitInput(e.target.value)}
            placeholder="e.g. -40 (paid to close) or +25 (collected)"
            className="rounded-md border border-border bg-white/[0.02] px-3 py-2 text-sm tabular-nums"
            autoFocus
          />
          <span className="text-[10px] muted">
            Sign convention: positive = received, negative = paid. A bought-back credit
            spread is usually negative (you paid to close).
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider muted">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What worked, what didn't, what would you do differently?"
            className="rounded-md border border-border bg-white/[0.02] px-3 py-2 text-sm"
          />
        </label>

        {exitValid && (
          <div
            className={`rounded-md border px-3 py-2 text-sm tabular-nums ${
              realized > 0
                ? "border-gain/40 bg-gain/10 gain"
                : realized < 0
                  ? "border-loss/40 bg-loss/10 loss"
                  : "border-border bg-white/[0.02] muted"
            }`}
          >
            Realized P/L: {realized >= 0 ? "+$" : "−$"}
            {Math.abs(realized).toFixed(2)}
            {realizedPct != null && (
              <span className="ml-2 text-[11px] opacity-80">
                ({realizedPct >= 0 ? "+" : ""}
                {realizedPct.toFixed(1)}% of ${risk.toFixed(0)} at risk)
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent/50"
          >
            Cancel
          </button>
          <button
            disabled={!exitValid}
            onClick={() =>
              onConfirm({
                exitCredit,
                notes: notes.trim() || null,
                entryCredit,
                realizedPnL: realized,
                realizedPnLPct: realizedPct,
                capitalAtRisk: risk,
              })
            }
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Close & log
          </button>
        </div>
      </div>
    </div>
  );
}
