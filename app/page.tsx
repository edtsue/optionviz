import Link from "next/link";
import { listTrades } from "@/lib/trades-repo";
import { detectStrategy } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let trades: Awaited<ReturnType<typeof listTrades>> = [];
  let error: string | null = null;
  try {
    trades = await listTrades();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load trades";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Saved Trades</h1>
        <Link href="/trade/new" className="btn-primary rounded-lg px-3 py-2 text-sm">
          + New trade
        </Link>
      </div>

      {error && (
        <div className="card border-loss/40">
          <p className="text-sm text-loss">{error}</p>
          <p className="mt-2 text-xs text-gray-400">
            Make sure your Supabase env vars are set and the migration in <code>supabase/migrations/0001_init.sql</code> has been applied.
          </p>
        </div>
      )}

      {!error && trades.length === 0 && (
        <div className="card text-center">
          <p className="text-gray-400">No trades yet. Upload a ticket screenshot to get started.</p>
          <Link href="/trade/new" className="btn-primary mt-4 inline-block rounded-lg px-3 py-2 text-sm">
            Upload first trade
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {trades.map((t) => {
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
                  <div className="text-xs text-gray-500">{t.legs.length} leg{t.legs.length > 1 ? "s" : ""}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {t.legs.map((l, i) => (
                  <span key={i} className={`rounded-md border px-2 py-1 ${l.side === "long" ? "border-gain/40 text-gain" : "border-loss/40 text-loss"}`}>
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
