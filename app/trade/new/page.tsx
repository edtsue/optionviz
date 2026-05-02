"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { TicketUpload } from "@/components/TicketUpload";
import { TradeForm } from "@/components/TradeForm";
import { TradeAnalysis } from "@/components/TradeAnalysis";
import { ResizableSplit } from "@/components/ResizableSplit";
import { tradesClient } from "@/lib/trades-client";
import type { Leg, Trade } from "@/types/trade";

function defaultExpiration(): string {
  return new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
}

function emptyTrade(): Trade {
  return {
    symbol: "",
    underlyingPrice: 0,
    riskFreeRate: 0.045,
    legs: [
      {
        type: "call",
        side: "long",
        strike: 0,
        expiration: defaultExpiration(),
        quantity: 1,
        premium: 0,
      },
    ],
    underlying: null,
    notes: "",
  };
}

// Convert URL params (from "Open as trade" / "Sell covered call" buttons) into
// a pre-filled Trade so the user can immediately see the position visualized.
function tradeFromParams(params: URLSearchParams): Trade {
  const t = emptyTrade();

  const symbol = params.get("symbol");
  const underlyingPrice = numParam(params, "underlyingPrice");
  const strategy = params.get("strategy");
  const shares = intParam(params, "shares");
  const costBasis = numParam(params, "costBasis");

  const type = (params.get("type") as Leg["type"]) || null;
  const side = (params.get("side") as Leg["side"]) || null;
  const strike = numParam(params, "strike");
  const expiration = params.get("expiration");
  const qty = intParam(params, "qty");
  const premium = numParam(params, "premium");

  if (symbol) t.symbol = symbol.toUpperCase();
  if (underlyingPrice != null) t.underlyingPrice = underlyingPrice;

  // Cover-call style: stock + a short call leg suggested 5% OTM, ~30d
  if (strategy === "covered_call" && shares != null && shares >= 100) {
    t.underlying = {
      shares,
      costBasis: costBasis ?? underlyingPrice ?? 0,
    };
    const otmStrike = underlyingPrice ? +(underlyingPrice * 1.05).toFixed(0) : 0;
    t.legs = [
      {
        type: "call",
        side: "short",
        strike: otmStrike,
        expiration: defaultExpiration(),
        quantity: Math.floor(shares / 100),
        premium: 0,
      },
    ];
    return t;
  }

  // Cash-secured put: short put 5% OTM, ~30d
  if (strategy === "cash_secured_put") {
    const otmStrike = underlyingPrice ? +(underlyingPrice * 0.95).toFixed(0) : 0;
    t.legs = [
      {
        type: "put",
        side: "short",
        strike: otmStrike,
        expiration: defaultExpiration(),
        quantity: 1,
        premium: 0,
      },
    ];
    return t;
  }

  // Single option (Open as trade) — fill whatever we got
  if (strategy === "single_option" || type || strike != null || expiration) {
    t.legs = [
      {
        type: type ?? "call",
        side: side ?? "long",
        strike: strike ?? 0,
        expiration: expiration || defaultExpiration(),
        quantity: qty ?? 1,
        premium: premium ?? 0,
      },
    ];
    if (!t.underlyingPrice && strike != null) {
      // Reasonable default: anchor underlying near the strike so the chart renders
      t.underlyingPrice = strike;
    }
    return t;
  }

  return t;
}

function numParam(p: URLSearchParams, k: string): number | null {
  const v = p.get(k);
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function intParam(p: URLSearchParams, k: string): number | null {
  const v = p.get(k);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export default function NewTradePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm muted">Loading…</div>}>
      <NewTradeInner />
    </Suspense>
  );
}

function NewTradeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = useMemo(() => tradeFromParams(params ?? new URLSearchParams()), [params]);
  const [trade, setTrade] = useState<Trade>(initial);

  // If the URL params change (e.g. user clicks another "Open as trade"), refresh.
  useEffect(() => {
    setTrade(initial);
  }, [initial]);

  async function save(t: Trade) {
    const id = await tradesClient.create(t);
    router.push(`/trade/${id}`);
  }

  return (
    <div className="pl-3 pr-4 py-4">
      <ResizableSplit
        id="new-trade-form-analysis"
        fixedSide="start"
        defaultPx={420}
        minPx={320}
        maxPx={680}
        breakpoint="xl"
      >
        <section className="min-w-0 overflow-hidden space-y-3 pr-3">
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

        <section className="min-w-0 pl-3">
          <TradeAnalysis trade={trade} />
        </section>
      </ResizableSplit>
    </div>
  );
}
