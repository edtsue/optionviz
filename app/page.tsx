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
      // Clear once successful
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Saved Trades</h1>
        <Link href="/trade/new" className="btn-primary rounded-lg px-3 py-2 text-sm leading-none">
          + New trade
        </Link>
      </div>

      {error && (
        <div className="card border-loss/40">
          <p className="text-sm text-loss">{error}</p>
        </div>
      )}

      {hasLocal > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-accent/40">
          <p className="text-sm">
            Found <strong>{hasLocal}</strong> trade{hasLocal === 1 ? "" : "s"} saved locally before Supabase was connected.
          </p>
          <button onClick={migrateLocal} disabled={migrating} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
            {migrating ? "Migrating…" : "Move to Supabase"}
          </button>
        </div>
      )}

      {trades?.length === 0 && (
        <div className="card text-center">
          <p className="text-gray-400">No trades yet. Upload a ticket screenshot to get started.</p>
          <Link href="/trade/new" className="btn-primary mt-4 inline-block rounded-lg px-3 py-2 text-sm">
            Upload first trade
          </Link>
        </div>
      )}

      {trades === null && !error && <div className="text-sm text-gray-400">Loading…</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        {trades?.map((t) => {
          const strat = detectStrategy(t);
          return (
            <Link key={t.id} href={`/trade/${t.id}`} className="card transition hover:border-accent">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-lg font-semibold">{t.symbol}</div>
                  <div className="text-xs text-gray-400">{strat.label}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm">${t.underlyingPrice.toFixed(2)}</div>
                  <div className="text-xs text-gray-500">
                    {t.legs.length} leg{t.legs.length > 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {t.legs.map((l, i) => (
                  <span
                    key={i}
                    className={`rounded-md border px-2 py-1 ${l.side === "long" ? "border-gain/40 text-gain" : "border-loss/40 text-loss"}`}
                  >
                    {l.side === "long" ? "+" : "-"}
                    {l.quantity} {l.type === "call" ? "C" : "P"} {l.strike} {l.expiration}
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
