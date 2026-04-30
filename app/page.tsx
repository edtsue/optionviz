"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { tradesClient } from "@/lib/trades-client";
import { localStore } from "@/lib/local-store";
import { detectStrategy } from "@/lib/strategies";
import type { Trade } from "@/types/trade";

export default function HomePage() {
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [hasLocal, setHasLocal] = useState(0);

  async function refresh() {
    try {
      setTrades(await tradesClient.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trades");
    }
  }

  useEffect(() => {
    refresh();
    setHasLocal(localStore.list().length);
  }, []);

  async function migrateLocal() {
    setMigrating(true);
    try {
      const local = localStore.list();
      for (const t of local) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = t;
        await tradesClient.create(rest as Trade);
      }
      for (const t of local) if (t.id) localStore.remove(t.id);
      setHasLocal(0);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  }

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

      {hasLocal > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-accent/30">
          <p className="text-sm">
            <span className="kpi-xs">{hasLocal}</span> trade{hasLocal === 1 ? "" : "s"} saved locally before Supabase was connected.
          </p>
          <button onClick={migrateLocal} disabled={migrating} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
            {migrating ? "Migrating…" : "Move to Supabase"}
          </button>
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
          const strat = detectStrategy(t);
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
