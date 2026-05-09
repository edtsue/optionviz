"use client";
import { useEffect, useMemo, useState } from "react";

interface ClosedTrade {
  id: string;
  sourceTradeId: string | null;
  symbol: string;
  outcome: "closed" | "canceled";
  tradeSnapshot: {
    symbol: string;
    legs: Array<{
      type: "call" | "put";
      side: "long" | "short";
      strike: number;
      expiration: string;
      quantity: number;
      premium: number;
    }>;
  };
  entryCredit: number | null;
  exitCredit: number | null;
  realizedPnL: number | null;
  realizedPnLPct: number | null;
  capitalAtRisk: number | null;
  notes: string | null;
  closedAt: string;
}

export default function JournalPage() {
  const [items, setItems] = useState<ClosedTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/closed-trades", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: { items: ClosedTrade[] }) => setItems(d.items ?? []))
      .catch((e) => setError(typeof e === "string" ? e : "Failed to load journal"));
  }, []);

  const stats = useMemo(() => {
    if (!items) return null;
    const closed = items.filter((i) => i.outcome === "closed" && i.realizedPnL != null);
    if (closed.length === 0) return null;
    const totalPnL = closed.reduce((a, b) => a + (b.realizedPnL ?? 0), 0);
    const wins = closed.filter((i) => (i.realizedPnL ?? 0) > 0).length;
    const winRate = (wins / closed.length) * 100;
    const avgPnL = totalPnL / closed.length;
    const avgWin =
      wins > 0
        ? closed
            .filter((i) => (i.realizedPnL ?? 0) > 0)
            .reduce((a, b) => a + (b.realizedPnL ?? 0), 0) / wins
        : 0;
    const losses = closed.length - wins;
    const avgLoss =
      losses > 0
        ? closed
            .filter((i) => (i.realizedPnL ?? 0) <= 0)
            .reduce((a, b) => a + (b.realizedPnL ?? 0), 0) / losses
        : 0;
    return { count: closed.length, totalPnL, winRate, avgPnL, avgWin, avgLoss };
  }, [items]);

  async function discard(id: string) {
    if (!confirm("Remove this journal entry? Stats won't include it anymore.")) return;
    const res = await fetch(`/api/closed-trades/${id}`, { method: "DELETE" });
    if (res.ok) setItems((cur) => (cur ? cur.filter((i) => i.id !== id) : cur));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm muted">Closed trades · realized P/L · what worked, what didn&rsquo;t</p>
      </div>

      {error && (
        <div className="card border-loss/40">
          <p className="text-sm loss">{error}</p>
        </div>
      )}

      {stats && (
        <div className="card card-tight">
          <div className="label mb-2">Across {stats.count} closed trade{stats.count === 1 ? "" : "s"}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Total realized" value={`${stats.totalPnL >= 0 ? "+" : "−"}$${Math.abs(stats.totalPnL).toFixed(0)}`} tone={stats.totalPnL >= 0 ? "gain" : "loss"} />
            <Stat label="Win rate" value={`${stats.winRate.toFixed(0)}%`} tone={stats.winRate >= 50 ? "gain" : "muted"} />
            <Stat label="Avg P/L" value={`${stats.avgPnL >= 0 ? "+" : "−"}$${Math.abs(stats.avgPnL).toFixed(0)}`} tone={stats.avgPnL >= 0 ? "gain" : "loss"} />
            <Stat label="Avg win" value={`+$${stats.avgWin.toFixed(0)}`} tone="gain" />
            <Stat label="Avg loss" value={`${stats.avgLoss <= 0 ? "−" : ""}$${Math.abs(stats.avgLoss).toFixed(0)}`} tone="loss" />
          </div>
        </div>
      )}

      {items === null && !error && <div className="text-sm muted">Loading…</div>}

      {items && items.length === 0 && (
        <div className="card text-center">
          <p className="muted">
            No closed trades yet. When you exit a position, click <strong>Close</strong> on the
            trade page to log it here.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {items?.map((it) => {
          const pnl = it.realizedPnL ?? 0;
          const tone =
            it.outcome === "canceled"
              ? "muted"
              : pnl > 0
                ? "gain"
                : pnl < 0
                  ? "loss"
                  : "muted";
          const legCount = it.tradeSnapshot.legs.length;
          return (
            <div key={it.id} className="card card-tight">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-semibold">{it.symbol}</span>
                  <span className="text-[11px] muted">
                    {legCount} leg{legCount === 1 ? "" : "s"} · closed{" "}
                    {new Date(it.closedAt).toLocaleDateString()}
                  </span>
                  {it.outcome === "canceled" && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] muted">
                      canceled
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  {it.outcome === "closed" && it.realizedPnL != null && (
                    <span className={`text-base font-semibold tabular-nums ${tone}`}>
                      {pnl >= 0 ? "+$" : "−$"}
                      {Math.abs(pnl).toFixed(0)}
                      {it.realizedPnLPct != null && (
                        <span className="ml-1 text-[10px] opacity-80">
                          ({it.realizedPnLPct >= 0 ? "+" : ""}
                          {it.realizedPnLPct.toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  )}
                  <button
                    onClick={() => discard(it.id)}
                    className="text-[11px] muted hover:text-loss"
                    title="Remove this journal entry"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {it.tradeSnapshot.legs.map((l, i) => (
                  <span
                    key={i}
                    className={`rounded-md border px-1.5 py-0.5 ${l.side === "long" ? "border-gain/40 gain" : "border-loss/40 loss"}`}
                  >
                    {l.side === "long" ? "+" : "−"}
                    {l.quantity} {l.type === "call" ? "C" : "P"} {l.strike}{" "}
                    {l.expiration.slice(5)}
                  </span>
                ))}
              </div>
              {it.notes && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-text/90">{it.notes}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "gain" | "loss" | "muted" }) {
  return (
    <div className="rounded-md border border-border bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
