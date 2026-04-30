"use client";
import { useState } from "react";
import type { Leg, Trade } from "@/types/trade";

interface Props {
  trade: Trade;
  onChange: (t: Trade) => void;
  onSave: (t: Trade) => Promise<void>;
}

export function TradeForm({ trade, onChange, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setTrade(updater: Trade | ((t: Trade) => Trade)) {
    const next = typeof updater === "function" ? (updater as (t: Trade) => Trade)(trade) : updater;
    onChange(next);
  }

  function setLeg(i: number, patch: Partial<Leg>) {
    setTrade((t) => ({
      ...t,
      legs: t.legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  }

  function addLeg() {
    const last = trade.legs[trade.legs.length - 1];
    setTrade((t) => ({
      ...t,
      legs: [
        ...t.legs,
        last
          ? { ...last, id: undefined }
          : {
              type: "call",
              side: "long",
              strike: trade.underlyingPrice,
              expiration: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
              quantity: 1,
              premium: 0,
            },
      ],
    }));
  }

  function removeLeg(i: number) {
    setTrade((t) => ({ ...t, legs: t.legs.filter((_, idx) => idx !== i) }));
  }

  function validate(t: Trade): string | null {
    if (!t.symbol.trim()) return "Symbol is required";
    if (!t.underlyingPrice || t.underlyingPrice <= 0) return "Underlying price must be greater than 0";
    if (!t.legs.length) return "At least one leg is required";
    for (const [i, l] of t.legs.entries()) {
      const n = i + 1;
      if (!l.expiration || Number.isNaN(new Date(l.expiration).getTime()))
        return `Leg ${n}: expiration is required`;
      if (!l.strike || l.strike <= 0) return `Leg ${n}: strike must be > 0`;
      if (!l.quantity || l.quantity <= 0) return `Leg ${n}: quantity must be > 0`;
      if (l.premium == null || l.premium < 0) return `Leg ${n}: premium must be ≥ 0`;
    }
    return null;
  }

  async function submit() {
    const err = validate(trade);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trade);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Symbol">
            <input
              value={trade.symbol}
              onChange={(e) => setTrade({ ...trade, symbol: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Underlying $">
            <input
              type="number"
              step="0.01"
              value={trade.underlyingPrice}
              onChange={(e) => setTrade({ ...trade, underlyingPrice: +e.target.value })}
            />
          </Field>
          <Field label="Risk-free %">
            <input
              type="number"
              step="0.001"
              value={trade.riskFreeRate}
              onChange={(e) => setTrade({ ...trade, riskFreeRate: +e.target.value })}
            />
          </Field>
          <Field label="Shares (covered)">
            <input
              type="number"
              value={trade.underlying?.shares ?? 0}
              onChange={(e) => {
                const shares = +e.target.value;
                setTrade({
                  ...trade,
                  underlying: shares > 0
                    ? { shares, costBasis: trade.underlying?.costBasis ?? trade.underlyingPrice }
                    : null,
                });
              }}
            />
          </Field>
        </div>
        {trade.underlying && (
          <Field label="Share cost basis">
            <input
              type="number"
              step="0.01"
              value={trade.underlying.costBasis}
              onChange={(e) =>
                setTrade({
                  ...trade,
                  underlying: { ...trade.underlying!, costBasis: +e.target.value },
                })
              }
            />
          </Field>
        )}
      </div>

      <div className="space-y-3">
        {trade.legs.map((leg, i) => (
          <div key={i} className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Leg {i + 1}</div>
              {trade.legs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLeg(i)}
                  className="btn-danger rounded-md px-2 py-1 text-xs"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Side">
                <select value={leg.side} onChange={(e) => setLeg(i, { side: e.target.value as Leg["side"] })}>
                  <option value="long">Long (buy)</option>
                  <option value="short">Short (sell)</option>
                </select>
              </Field>
              <Field label="Type">
                <select value={leg.type} onChange={(e) => setLeg(i, { type: e.target.value as Leg["type"] })}>
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </Field>
              <Field label="Quantity">
                <input
                  type="number"
                  value={leg.quantity}
                  onChange={(e) => setLeg(i, { quantity: +e.target.value })}
                />
              </Field>
              <Field label="Strike">
                <input
                  type="number"
                  step="0.5"
                  value={leg.strike}
                  onChange={(e) => setLeg(i, { strike: +e.target.value })}
                />
              </Field>
              <Field label="Premium">
                <input
                  type="number"
                  step="0.01"
                  value={leg.premium}
                  onChange={(e) => setLeg(i, { premium: +e.target.value })}
                />
              </Field>
              <Field label="Expiration">
                <input
                  type="date"
                  value={leg.expiration}
                  onChange={(e) => setLeg(i, { expiration: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
        <button type="button" onClick={addLeg} className="rounded-lg px-3 py-2 text-sm">
          + Add leg
        </button>
      </div>

      <div className="card">
        <Field label="Notes">
          <textarea
            rows={3}
            value={trade.notes ?? ""}
            onChange={(e) => setTrade({ ...trade, notes: e.target.value })}
          />
        </Field>
      </div>

      {error && <div className="text-sm text-loss">{error}</div>}

      <button type="button" onClick={submit} disabled={busy} className="btn-primary w-full rounded-lg px-4 py-3 text-base font-semibold">
        {busy ? "Saving…" : "Save trade"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <div className="[&>input]:w-full [&>select]:w-full [&>textarea]:w-full">{children}</div>
    </label>
  );
}
