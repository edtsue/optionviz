"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { tradesClient } from "@/lib/trades-client";
import { fillImpliedVolsForTrade } from "@/lib/payoff";
import { detectStrategy } from "@/lib/strategies";
import { TradeAnalysis } from "@/components/TradeAnalysis";
import type { Trade } from "@/types/trade";

export default function TradePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tradesClient
      .get(params.id)
      .then((t) => {
        if (cancelled) return;
        if (!t) setNotFound(true);
        else setTrade(fillImpliedVolsForTrade(t));
      })
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (notFound) {
    return (
      <div className="card text-center">
        <p>Trade not found.</p>
        <Link href="/" className="btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-sm">
          Back home
        </Link>
      </div>
    );
  }

  if (!trade) return <div className="text-sm text-gray-400">Loading…</div>;

  const strategy = detectStrategy(trade);

  async function onDelete() {
    if (!confirm("Delete this trade?")) return;
    await tradesClient.remove(params.id);
    router.push("/");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {trade.symbol} <span className="text-gray-400">· {strategy.label}</span>
          </h1>
          <div className="text-sm text-gray-400">
            Underlying ${trade.underlyingPrice.toFixed(2)} · {strategy.bias} bias
          </div>
        </div>
        <button onClick={onDelete} className="btn-danger rounded-lg px-3 py-1.5 text-sm">
          Delete
        </button>
      </div>

      <TradeAnalysis trade={trade} />

      <div className="card">
        <div className="label mb-2">Legs</div>
        <div className="space-y-2 text-sm">
          {trade.legs.map((l, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <div>
                <span className={l.side === "long" ? "text-gain" : "text-loss"}>
                  {l.side === "long" ? "Long" : "Short"}
                </span>{" "}
                {l.quantity}× {l.type === "call" ? "Call" : "Put"} @ ${l.strike}
              </div>
              <div className="text-xs text-gray-400">
                {l.expiration} · prem ${l.premium.toFixed(2)} · IV{" "}
                {((l.iv ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
          ))}
          {trade.underlying && (
            <div className="rounded-md border border-border p-2 text-sm">
              <span className="text-gain">Long</span> {trade.underlying.shares} shares @ $
              {trade.underlying.costBasis.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {trade.notes && (
        <div className="card">
          <div className="label mb-1">Notes</div>
          <p className="text-sm whitespace-pre-wrap">{trade.notes}</p>
        </div>
      )}
    </div>
  );
}
