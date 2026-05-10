"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { tradesClient } from "@/lib/trades-client";
import { detectStrategy } from "@/lib/strategies";
import { fillImpliedVolsForTrade, netGreeks } from "@/lib/payoff";
import { usePortfolioShares, externalSharesFor } from "@/lib/use-portfolio-shares";
import type { Trade } from "@/types/trade";

export default function HomePage() {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const portfolioShares = usePortfolioShares();

  useEffect(() => {
    tradesClient
      .list()
      .then((t) => {
        setTrades(t);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load trades"));
  }, []);

  // Book-level Greeks: sum each trade's netGreeks across the open positions.
  // Filled IVs are needed for legs without an explicit iv (otherwise bs() uses
  // the 0.3 fallback and the totals get noisy on freshly-uploaded trades).
  const book = useMemo(() => {
    if (!trades || trades.length === 0) return null;
    const totals = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    for (const t of trades) {
      const g = netGreeks(fillImpliedVolsForTrade(t));
      totals.delta += g.delta;
      totals.gamma += g.gamma;
      totals.theta += g.theta;
      totals.vega += g.vega;
    }
    return totals;
  }, [trades]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Option<span className="text-accent">Viz</span>
          </h1>
          <p className="text-sm muted">Trade visualizer · Greeks · ideas</p>
        </div>
        <Link href="/trade/new" className="btn-primary rounded-lg px-3 py-2 text-sm">
          + New trade
        </Link>
      </div>

      {error && (
        <div className="card border-loss/40">
          <p className="text-sm loss">{error}</p>
        </div>
      )}

      {book && (
        <div className="card card-tight">
          <div className="label mb-2">Book — net Greeks across {trades?.length} open trade{trades && trades.length === 1 ? "" : "s"}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <BookGreek label="Delta" value={book.delta} fmt={(v) => v.toFixed(0)} />
            <BookGreek label="Gamma" value={book.gamma} fmt={(v) => v.toFixed(2)} />
            <BookGreek label="Theta /day" value={book.theta} fmt={(v) => `$${v.toFixed(0)}`} />
            <BookGreek label="Vega /vol pt" value={book.vega} fmt={(v) => `$${v.toFixed(0)}`} />
          </div>
        </div>
      )}

      {trades?.length === 0 && (
        <div className="card text-center">
          <p className="muted">No trades yet. Drop a ticket screenshot to get started.</p>
          <Link href="/trade/new" className="btn-primary mt-4 inline-block rounded-lg px-3 py-2 text-sm">
            Upload first trade
          </Link>
        </div>
      )}

      {trades === null && !error && <div className="text-sm muted">Loading…</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trades?.map((t) => {
          const strat = detectStrategy(t, {
            externalShares: externalSharesFor(portfolioShares, t.symbol),
          });
          return (
            <Link
              key={t.id}
              href={`/trade/${t.id}`}
              className="card transition hover:border-accent/40 hover:bg-white/[0.04]"
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-base font-semibold">{t.symbol}</div>
                  <div className="text-[11px] muted">{strat.label}</div>
                </div>
                <div className="text-right">
                  <div className="kpi-sm">${t.underlyingPrice.toFixed(2)}</div>
                  <div className="text-[10px] muted">
                    {t.legs.length} leg{t.legs.length > 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] data-grid">
                {t.legs.map((l, i) => (
                  <span
                    key={i}
                    className={`rounded-md border px-1.5 py-0.5 ${l.side === "long" ? "border-gain/40 gain" : "border-loss/40 loss"}`}
                  >
                    {l.side === "long" ? "+" : "−"}
                    {l.quantity} {l.type === "call" ? "C" : "P"} {l.strike} {l.expiration.slice(5)}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function BookGreek({
  label,
  value,
  fmt,
}: {
  label: string;
  value: number;
  fmt: (v: number) => string;
}) {
  const cls = value > 0 ? "gain" : value < 0 ? "loss" : "muted";
  return (
    <div className="rounded-md border border-border bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${cls}`}>{fmt(value)}</div>
    </div>
  );
}
