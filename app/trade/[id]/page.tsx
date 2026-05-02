"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { tradesClient } from "@/lib/trades-client";
import { fillImpliedVolsForTrade, netGreeks, tradeStats } from "@/lib/payoff";
import { detectStrategy } from "@/lib/strategies";
import { TradeAnalysis } from "@/components/TradeAnalysis";
import { useRegisterChatContext } from "@/lib/chat-context";
import type { Trade } from "@/types/trade";

export default function TradePage() {
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
      <div className="p-6">
        <div className="card mx-auto max-w-md text-center">
          <p>Trade not found.</p>
          <Link href="/" className="btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-sm">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  if (!trade) return <div className="p-6 text-sm muted">Loading…</div>;

  return <TradeView trade={trade} tradeId={params.id} />;
}

function TradeView({ trade, tradeId }: { trade: Trade; tradeId: string }) {
  const router = useRouter();
  const strategy = detectStrategy(trade);
  const greeks = netGreeks(trade);
  const stats = tradeStats(trade);

  useRegisterChatContext(`Trade: ${trade.symbol} ${strategy.label}`, {
    symbol: trade.symbol,
    underlyingPrice: trade.underlyingPrice,
    strategy: strategy.label,
    bias: strategy.bias,
    legs: trade.legs.map((l) => ({
      side: l.side,
      type: l.type,
      strike: l.strike,
      expiration: l.expiration,
      qty: l.quantity,
      premium: l.premium,
      iv: l.iv,
    })),
    underlying: trade.underlying,
    netGreeks: {
      delta: +greeks.delta.toFixed(2),
      gamma: +greeks.gamma.toFixed(4),
      theta: +greeks.theta.toFixed(2),
      vega: +greeks.vega.toFixed(2),
    },
    stats: {
      maxProfit: stats.maxProfit,
      maxLoss: stats.maxLoss,
      breakevens: stats.breakevens,
      cost: stats.cost,
      pop: stats.pop,
    },
  });

  async function onDelete() {
    if (!confirm("Delete this trade?")) return;
    await tradesClient.remove(tradeId);
    router.push("/");
  }

  return (
    <div className="space-y-4 pl-3 pr-4 py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {trade.symbol} <span className="muted">· {strategy.label}</span>
          </h1>
          <div className="text-xs muted data-grid">
            Underlying <span className="kpi-xs">${trade.underlyingPrice.toFixed(2)}</span> · {strategy.bias} bias
          </div>
        </div>
        <button onClick={onDelete} className="btn-danger rounded-lg px-3 py-1.5 text-sm">
          Delete
        </button>
      </header>

      <TradeAnalysis trade={trade} />

      <div className="card card-tight">
        <div className="label mb-2">Legs</div>
        <div className="grid gap-1.5 text-sm data-grid">
          {trade.legs.map((l, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-white/[0.02] px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    l.side === "long" ? "border border-gain/40 gain" : "border border-loss/40 loss"
                  }`}
                >
                  {l.side === "long" ? "LONG" : "SHORT"}
                </span>
                <span className="kpi-xs">
                  {l.quantity}× {l.type === "call" ? "C" : "P"} ${l.strike}
                </span>
              </div>
              <div className="text-[11px] muted">
                {l.expiration} · prem ${l.premium.toFixed(2)} · IV {((l.iv ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
          ))}
          {trade.underlying && (
            <div className="flex items-center justify-between rounded-md border border-border bg-white/[0.02] px-2 py-1.5 text-sm">
              <span className="kpi-xs">
                <span className="gain">LONG</span> {trade.underlying.shares} shares @ $
                {trade.underlying.costBasis.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {trade.ticketImagePath && (
        <div className="card card-tight">
          <div className="label mb-2">Ticket Screenshot</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/ticket-image?path=${encodeURIComponent(trade.ticketImagePath)}`}
            alt="Trade ticket"
            className="max-h-96 rounded-lg border border-border"
          />
        </div>
      )}

      {trade.notes && (
        <div className="card card-tight">
          <div className="label mb-1">Notes</div>
          <p className="text-sm whitespace-pre-wrap">{trade.notes}</p>
        </div>
      )}
    </div>
  );
}
