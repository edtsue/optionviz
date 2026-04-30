import { notFound } from "next/navigation";
import { getTrade } from "@/lib/trades-repo";
import { detectStrategy } from "@/lib/strategies";
import { buildPayoff, fillImpliedVolsForTrade, netGreeks, tradeStats } from "@/lib/payoff";
import { PayoffChart } from "@/components/PayoffChart";
import { GreeksPanel } from "@/components/GreeksPanel";
import { IdeasPanel } from "@/components/IdeasPanel";
import { DeleteButton } from "./DeleteButton";

export const dynamic = "force-dynamic";

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await getTrade(id);
  if (!raw) notFound();

  const trade = fillImpliedVolsForTrade(raw);
  const strategy = detectStrategy(trade);
  const payoff = buildPayoff(trade);
  const stats = tradeStats(trade);
  const greeks = netGreeks(trade);

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
        <DeleteButton id={id} />
      </div>

      <PayoffChart data={payoff} underlying={trade.underlyingPrice} breakevens={stats.breakevens} />
      <GreeksPanel greeks={greeks} stats={stats} />

      <div className="card">
        <div className="label mb-2">Legs</div>
        <div className="space-y-2 text-sm">
          {trade.legs.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
              <div>
                <span className={l.side === "long" ? "text-gain" : "text-loss"}>
                  {l.side === "long" ? "Long" : "Short"}
                </span>{" "}
                {l.quantity}× {l.type === "call" ? "Call" : "Put"} @ ${l.strike}
              </div>
              <div className="text-xs text-gray-400">
                {l.expiration} · prem ${l.premium.toFixed(2)} · IV {((l.iv ?? 0) * 100).toFixed(1)}%
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

      <IdeasPanel trade={trade} />
    </div>
  );
}
