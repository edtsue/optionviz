"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { bs, yearsBetween } from "@/lib/black-scholes";
import { fillImpliedVolsForTrade } from "@/lib/payoff";
import type { Trade } from "@/types/trade";

export type ResultTag = "win" | "loss" | "scratch";

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
    resultTag: ResultTag;
    closedAt: string;
  }) => void;
}

const CONTRACT_MULT = 100;

function netEntryCredit(trade: Trade): number {
  let total = 0;
  for (const l of trade.legs) {
    const sign = l.side === "short" ? 1 : -1;
    total += sign * l.premium * l.quantity * CONTRACT_MULT;
  }
  return +total.toFixed(2);
}

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

// Mark-to-market exit credit for the option legs only — the dollar amount
// the user would net to close all option legs at the current underlying.
// Positive = collected (selling longs net of buying shorts back); negative =
// paid (buying back shorts net of selling longs). Excludes the underlying;
// covered-call shares typically aren't sold when the option is closed.
function autoExitCredit(trade: Trade): number | null {
  if (!trade.underlyingPrice || trade.underlyingPrice <= 0) return null;
  const filled = fillImpliedVolsForTrade(trade);
  const now = new Date();
  const r = filled.riskFreeRate ?? 0.04;
  let total = 0;
  for (const l of filled.legs) {
    const expiry = new Date(l.expiration);
    const T = yearsBetween(now, expiry);
    if (T <= 0) {
      // At/after expiry — intrinsic only.
      const intrinsic =
        l.type === "call"
          ? Math.max(filled.underlyingPrice - l.strike, 0)
          : Math.max(l.strike - filled.underlyingPrice, 0);
      const sign = l.side === "short" ? -1 : 1;
      total += sign * intrinsic * l.quantity * CONTRACT_MULT;
      continue;
    }
    const sigma = l.iv && l.iv > 0 ? l.iv : 0.3;
    const price = bs({
      S: filled.underlyingPrice,
      K: l.strike,
      T,
      r,
      sigma,
      type: l.type,
    }).price;
    // Sign: closing a short means buying back (paying → negative credit).
    // Closing a long means selling (receiving → positive credit).
    const sign = l.side === "short" ? -1 : 1;
    total += sign * price * l.quantity * CONTRACT_MULT;
  }
  return +total.toFixed(2);
}

function todayIso(): string {
  // YYYY-MM-DD in local time so the <input type="date"> control reads it cleanly.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function autoTag(realized: number): ResultTag {
  // Within ±$5 of zero counts as a scratch — small enough that fees usually
  // swallow the move and there's no real lesson in the P/L sign.
  if (realized > 5) return "win";
  if (realized < -5) return "loss";
  return "scratch";
}

export function CloseTradeDialog({ open, trade, onCancel, onConfirm }: Props) {
  const [exitInput, setExitInput] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [closeDate, setCloseDate] = useState<string>(todayIso());
  const [tagOverride, setTagOverride] = useState<ResultTag | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const entryCredit = useMemo(() => netEntryCredit(trade), [trade]);
  const risk = useMemo(() => capitalAtRisk(trade), [trade]);
  const prefilledExit = useMemo(() => autoExitCredit(trade), [trade]);

  // Reset every time the dialog re-opens so prefills track the live spot.
  useEffect(() => {
    if (open) {
      setExitInput(prefilledExit != null ? prefilledExit.toFixed(2) : "");
      setNotes("");
      setCloseDate(todayIso());
      setTagOverride(null);
    }
  }, [open, prefilledExit]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const exitCredit = parseFloat(exitInput);
  const exitValid = Number.isFinite(exitCredit);
  const realized = exitValid ? +(entryCredit + exitCredit).toFixed(2) : 0;
  const realizedPct =
    exitValid && risk > 0 ? +((realized / risk) * 100).toFixed(1) : null;
  const derivedTag: ResultTag = autoTag(realized);
  const effectiveTag: ResultTag = tagOverride ?? derivedTag;

  if (!open || !mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-2xl p-4 shadow-2xl"
        style={{
          background: "#1a1f2a",
          border: "1px solid rgba(255,255,255,0.16)",
          color: "#e5e7eb",
        }}
      >
        <div>
          <div className="text-base font-semibold">Close trade — log to journal</div>
          <p className="mt-1 text-xs muted">
            {trade.symbol} · {trade.legs.length} leg{trade.legs.length === 1 ? "" : "s"} ·
            entry {entryCredit >= 0 ? "+" : "−"}${Math.abs(entryCredit).toFixed(2)}
            {prefilledExit != null && (
              <>
                {" "}· mark {prefilledExit >= 0 ? "+" : "−"}${Math.abs(prefilledExit).toFixed(2)}
              </>
            )}
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
            Prefilled from current spot × Black-Scholes. Adjust to the price you actually
            filled at. Positive = received, negative = paid.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider muted">Close date</span>
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            className="rounded-md border border-border bg-white/[0.02] px-3 py-2 text-sm tabular-nums"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider muted">Result</span>
          <div className="flex gap-2">
            {(["win", "loss", "scratch"] as const).map((t) => {
              const active = effectiveTag === t;
              const accent =
                t === "win" ? "border-gain/60 bg-gain/15 gain"
                : t === "loss" ? "border-loss/60 bg-loss/15 loss"
                : "border-amber-400/60 bg-amber-400/10 text-amber-400";
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagOverride(t)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs capitalize ${
                    active ? accent : "border-border bg-white/[0.02] muted hover:border-accent/50"
                  }`}
                >
                  {t}
                  {t === derivedTag && tagOverride == null && (
                    <span className="ml-1 text-[10px] opacity-70">auto</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

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
                resultTag: effectiveTag,
                // <input type="date"> gives YYYY-MM-DD; promote to UTC midnight
                // so the API's z.string().datetime() validator accepts it.
                closedAt: new Date(closeDate + "T00:00:00Z").toISOString(),
              })
            }
            className="btn-primary rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Close & log
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
