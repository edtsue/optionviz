"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TicketUpload } from "@/components/TicketUpload";
import { TradeForm } from "@/components/TradeForm";
import { tradesClient } from "@/lib/trades-client";
import type { Trade } from "@/types/trade";

const empty: Trade = {
  symbol: "",
  underlyingPrice: 100,
  riskFreeRate: 0.045,
  legs: [
    {
      type: "call",
      side: "long",
      strike: 100,
      expiration: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
      quantity: 1,
      premium: 1,
    },
  ],
  underlying: null,
  notes: "",
};

export default function NewTradePage() {
  const router = useRouter();
  const [trade, setTrade] = useState<Trade>(empty);
  const [version, setVersion] = useState(0);

  async function save(t: Trade) {
    const id = await tradesClient.create(t);
    router.push(`/trade/${id}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New trade</h1>
      <TicketUpload
        onParsed={(p) => {
          setTrade({
            ...empty,
            symbol: p.symbol,
            underlyingPrice: p.underlyingPrice,
            legs: p.legs,
            notes: p.notes ?? "",
          });
          setVersion((v) => v + 1);
        }}
      />
      <TradeForm key={version} initial={trade} onSave={save} />
    </div>
  );
}
