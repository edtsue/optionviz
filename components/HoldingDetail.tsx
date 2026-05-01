"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Holding } from "@/types/portfolio";
import { parseOptionSymbol } from "@/lib/parse-option-symbol";
import { bs, impliedVol, yearsBetween } from "@/lib/black-scholes";

interface Props {
  holding: Holding;
  totalPortfolioValue: number;
}

const SPOT_KEY = "optionviz.holding-spot.v1";

function loadSpot(symbol: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const map = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "{}");
    const v = map[symbol];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function saveSpot(symbol: string, value: number | null) {
  if (typeof window === "undefined") return;
  try {
    const map = JSON.parse(localStorage.getItem(SPOT_KEY) ?? "{}");
    if (value == null || !Number.isFinite(value) || value <= 0) {
      delete map[symbol];
    } else {
      map[symbol] = value;
    }
    localStorage.setItem(SPOT_KEY, JSON.stringify(map));
  } catch {}
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

  const parsed = useMemo(
    () => parseOptionSymbol(holding.symbol) ?? parseOptionSymbol(holding.name),
    [holding.symbol, holding.name],
  );

  // Spot input — persisted per symbol in localStorage
  const [spotInput, setSpotInput] = useState<string>("");
  useEffect(() => {
    if (!isOption || !parsed) return;
    const saved = loadSpot(parsed.underlying);
    setSpotInput(saved != null ? String(saved) : "");
  }, [isOption, parsed]);

  const spot = parseFloat(spotInput);
  const validSpot = Number.isFinite(spot) && spot > 0;

  // Solve IV from option market price + user's spot, scale Greeks by qty
  const greeksData = useMemo(() => {
    if (!isOption || !parsed) return null;
    const T = yearsBetween(new Date(), new Date(parsed.expiration));
    if (T <= 0) return null;
    if (!validSpot) return { ready: false as const, parsed, T };

    const marketPrice = holding.marketPrice;
    const r = 0.045;

    let sigma: number | null = null;
    let ivSource: "solved" | "default" = "default";
    if (marketPrice != null && marketPrice > 0) {
      const solved = impliedVol(marketPrice, spot, parsed.strike, T, r, parsed.type);
      if (solved != null && solved > 0.01 && solved < 5) {
        sigma = solved;
        ivSource = "solved";
      }
    }
    if (sigma == null) sigma = 0.4;

    const g = bs({ S: spot, K: parsed.strike, T, r, sigma, type: parsed.type });

    const qty = Math.abs(holding.quantity || 1);
    const sideSign = (holding.quantity ?? 0) < 0 ? -1 : 1;
    const positionMult = qty * sideSign;

    return {
      ready: true as const,
      parsed,
      T,
      sigma,
      ivSource,
      perShare: g,
      // Position decimal delta and gamma; position dollar theta/vega/rho
      position: {
        delta: g.delta * positionMult,
        gamma: g.gamma * positionMult,
        theta: g.theta * positionMult * 100,
        vega: g.vega * positionMult * 100,
        rho: g.rho * positionMult * 100,
      },
      qty,
      sideSign,
    };
  }, [isOption, parsed, validSpot, spot, holding.marketPrice, holding.quantity]);

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
    const params = new URLSearchParams();
    params.set("symbol", parsed?.underlying ?? holding.symbol);
    if (parsed) {
      params.set("type", parsed.type);
      params.set("strike", String(parsed.strike));
      params.set("expiration", parsed.expiration);
    }
    params.set("qty", String(Math.abs(holding.quantity || 1)));
    params.set("side", (holding.quantity ?? 0) < 0 ? "short" : "long");
    if (holding.marketPrice != null) params.set("premium", String(holding.marketPrice));
    if (validSpot) params.set("underlyingPrice", String(spot));
    params.set("strategy", "single_option");
    return `/trade/new?${params.toString()}`;
  }

  function onSpotChange(v: string) {
    setSpotInput(v);
    if (parsed) {
      const n = parseFloat(v);
      saveSpot(parsed.underlying, Number.isFinite(n) && n > 0 ? n : null);
    }
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

      {isOption && parsed && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="label">Position Greeks</div>
            <div className="text-xs muted">
              {parsed.type.toUpperCase()} ${parsed.strike} · {parsed.expiration} ·{" "}
              {greeksData ? `${(greeksData.T * 365).toFixed(0)}d to expiry` : "expired"}
            </div>
          </div>

          <label className="flex flex-wrap items-center gap-2">
            <span className="text-xs muted whitespace-nowrap">{parsed.underlying} spot $</span>
            <input
              type="number"
              step="0.01"
              value={spotInput}
              onChange={(e) => onSpotChange(e.target.value)}
              placeholder="Enter underlying price for accurate Greeks"
              className="flex-1 min-w-[180px] rounded-md border border-border bg-white/[0.02] px-2 py-1 text-sm font-mono"
            />
          </label>

          {greeksData && greeksData.ready ? (
            <>
              <div className="text-[11px] muted">
                IV {greeksData.ivSource === "solved" ? "back-solved from market price" : "assumed"}: {(greeksData.sigma * 100).toFixed(1)}% · {greeksData.qty} contract{greeksData.qty === 1 ? "" : "s"}
                {greeksData.sideSign < 0 ? " (short)" : ""}
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 data-grid">
                <Mini label="Delta" value={greeksData.position.delta.toFixed(2)} hint="Per $1 underlying move (decimal)" />
                <Mini label="Gamma" value={greeksData.position.gamma.toFixed(4)} hint="Δ change per $1 move" />
                <Mini label="Theta" value={fmtUsd(greeksData.position.theta) + "/d"} hint="$ change per day" />
                <Mini label="Vega" value={fmtUsd(greeksData.position.vega)} hint="$ change per 1 IV point" />
                <Mini label="Rho" value={fmtUsd(greeksData.position.rho)} hint="$ change per 1% rate" />
              </div>
            </>
          ) : (
            <div className="text-xs muted">
              Enter the {parsed.underlying} spot price above to see accurate Greeks. We&rsquo;ll back-solve IV from the option&rsquo;s market price.
            </div>
          )}
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

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] uppercase tracking-wider muted">{label}</div>
      <div className="text-sm font-semibold font-mono">{value}</div>
    </div>
  );
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
