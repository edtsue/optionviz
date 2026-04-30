"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TicketUpload } from "@/components/TicketUpload";
import { TradeForm } from "@/components/TradeForm";
import { TradeAnalysis } from "@/components/TradeAnalysis";
import { tradesClient } from "@/lib/trades-client";
import type { Trade } from "@/types/trade";

const empty: Trade = {
  symbol: "",
  underlyingPrice: 0,
  riskFreeRate: 0.045,
  legs: [
    {
      type: "call",
      side: "long",
      strike: 0,
      expiration: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      quantity: 1,
      premium: 0,
    },
  ],
  underlying: null,
  notes: "",
};

export default function NewTradePage() {
  const router = useRouter();
  const [trade, setTrade] = useState<Trade>(empty);

  async function save(t: Trade) {
    const id = await tradesClient.create(t);
    router.push(`/trade/${id}`);
  }

  return (
    <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="space-y-3 min-w-0">
        <div className="label">Capture</div>
        <TicketUpload
          onParsed={(p) => {
            setTrade((current) => ({
              ...current,
              symbol: p.symbol || current.symbol,
              underlyingPrice: p.underlyingPrice || current.underlyingPrice,
              legs: p.legs.length ? p.legs : current.legs,
              notes: p.notes ?? current.notes,
            }));
          }}
        />
        <div className="label">Trade</div>
        <TradeForm trade={trade} onChange={setTrade} onSave={save} />
      </section>

      <section className="min-w-0">
        <TradeAnalysis trade={trade} />
      </section>
    </div>
  );
}
