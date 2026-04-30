"use client";
import Link from "next/link";
import { useMemo } from "react";
import type { Holding } from "@/types/portfolio";
import { parseOptionSymbol } from "@/lib/parse-option-symbol";
import { bs, yearsBetween } from "@/lib/black-scholes";

interface Props {
  holding: Holding;
  totalPortfolioValue: number;
}

export function HoldingDetail({ holding, totalPortfolioValue }: Props) {
  const isOption =
    holding.assetType === "option" ||
    !!parseOptionSymbol(holding.symbol) ||
    !!parseOptionSymbol(holding.name);

  const isStock =
    holding.assetType === "stock" ||
    holding.assetType === "etf" ||
    (!isOption && holding.assetType !== "cash");

  const eligibleForCoveredCall = isStock && holding.quantity >= 100;

  const cost = (holding.costBasis ?? 0) * (holding.quantity || 0);
  const value = holding.marketValue ?? 0;
  const pct = totalPortfolioValue > 0 ? (value / totalPortfolioValue) * 100 : 0;

  // Try to compute Greeks for a single-contract option position
  const optionGreeks = useMemo(() => {
    if (!isOption) return null;
    const parsed =
      parseOptionSymbol(holding.symbol) ?? parseOptionSymbol(holding.name);
    if (!parsed) return null;
    const T = yearsBetween(new Date(), new Date(parsed.expiration));
    if (T <= 0) return null;
    // Need an underlying spot to compute Greeks. We don't have it from the
    // portfolio screenshot, so fall back to strike (rough). The user can refine
    // by clicking "Open as trade".
    const spot = parsed.strike;
    const sigma = 0.4;
    const g = bs({
      S: spot,
      K: parsed.strike,
      T,
      r: 0.045,
      sigma,
      type: parsed.type,
    });
    return { parsed, greeks: g, T };
  }, [isOption, holding.symbol, holding.name]);

  function startCoveredCall() {
    const params = new URLSearchParams({
      symbol: holding.symbol,
      shares: String(holding.quantity),
      costBasis: String(holding.costBasis ?? holding.marketPrice ?? 0),
      underlyingPrice: String(holding.marketPrice ?? holding.costBasis ?? 0),
      strategy: "covered_call",
    });
    return `/trade/new?${params.toString()}`;
  }

  function startCSP() {
    const params = new URLSearchParams({
      symbol: holding.symbol,
      underlyingPrice: String(holding.marketPrice ?? 0),
      strategy: "cash_secured_put",
    });
    return `/trade/new?${params.toString()}`;
  }

  function openOptionAsTrade() {
    const parsed =
      parseOptionSymbol(holding.symbol) ?? parseOptionSymbol(holding.name);
    const params = new URLSearchParams();
    params.set("symbol", parsed?.underlying ?? holding.symbol);
    if (parsed) {
      params.set("type", parsed.type);
      params.set("strike", String(parsed.strike));
      params.set("expiration", parsed.expiration);
    }
    params.set("qty", String(Math.abs(holding.quantity || 1)));
    // Quantity sign hints at side: positive = long, negative = short
    params.set("side", (holding.quantity ?? 0) < 0 ? "short" : "long");
    if (holding.costBasis != null) params.set("premium", String(holding.costBasis));
    if (holding.marketPrice != null && parsed) {
      // For an option position, marketPrice is the option's price, not the
      // underlying. We don't know the underlying spot from this data, so leave
      // it unset and let the user fill it.
    }
    params.set("strategy", "single_option");
    return `/trade/new?${params.toString()}`;
  }

  return (
    <div className="space-y-4 bg-bg/50 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Cost basis (per)" value={holding.costBasis != null ? `$${holding.costBasis.toFixed(2)}` : "—"} />
        <Field label="Total cost" value={cost > 0 ? `$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />
        <Field label="Market value" value={value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />
        <Field label="% of portfolio" value={`${pct.toFixed(1)}%`} />
        <Field
          label="Unrealized P/L"
          value={
            holding.unrealizedPnL != null
              ? `${holding.unrealizedPnL >= 0 ? "+" : ""}$${holding.unrealizedPnL.toLocaleString()}`
              : "—"
          }
          tone={holding.unrealizedPnL != null ? (holding.unrealizedPnL >= 0 ? "gain" : "loss") : undefined}
        />
        <Field
          label="Return %"
          value={holding.unrealizedPnLPct != null ? `${holding.unrealizedPnLPct >= 0 ? "+" : ""}${holding.unrealizedPnLPct.toFixed(2)}%` : "—"}
          tone={holding.unrealizedPnLPct != null ? (holding.unrealizedPnLPct >= 0 ? "gain" : "loss") : undefined}
        />
        <Field label="Asset type" value={holding.assetType ?? (isOption ? "option" : "stock")} />
      </div>

      {optionGreeks && (
        <div className="rounded-lg border border-border p-3">
          <div className="label mb-2">Option Greeks (estimate)</div>
          <div className="text-xs text-gray-500 mb-2">
            {optionGreeks.parsed.type.toUpperCase()} ${optionGreeks.parsed.strike} ·{" "}
            {optionGreeks.parsed.expiration} · {(optionGreeks.T * 365).toFixed(0)}d to expiry · IV
            assumed 40%
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            <Mini label="Δ" value={optionGreeks.greeks.delta.toFixed(2)} />
            <Mini label="Γ" value={optionGreeks.greeks.gamma.toFixed(4)} />
            <Mini label="Θ" value={optionGreeks.greeks.theta.toFixed(2)} />
            <Mini label="ν" value={optionGreeks.greeks.vega.toFixed(2)} />
            <Mini label="ρ" value={optionGreeks.greeks.rho.toFixed(2)} />
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Greeks shown for a single contract. Multiply by {holding.quantity} for net position
            exposure. Click <em>Open as trade</em> to enter exact premium/IV.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {eligibleForCoveredCall && (
          <Link href={startCoveredCall()} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
            Sell covered call
          </Link>
        )}
        {isStock && (
          <Link href={startCSP()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent">
            Sell cash-secured put
          </Link>
        )}
        {isOption && (
          <Link href={openOptionAsTrade()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent">
            Open as trade
          </Link>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-base font-semibold ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
