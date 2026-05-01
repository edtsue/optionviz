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
const OVERRIDES_KEY = "optionviz.holding-overrides.v1";

interface Override {
  premium?: number;
  ivPct?: number;
}

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
    if (value == null || !Number.isFinite(value) || value <= 0) delete map[symbol];
    else map[symbol] = value;
    localStorage.setItem(SPOT_KEY, JSON.stringify(map));
  } catch {}
}

function loadOverride(key: string): Override {
  if (typeof window === "undefined") return {};
  try {
    const map = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}");
    return map[key] ?? {};
  } catch {
    return {};
  }
}

function saveOverride(key: string, override: Override) {
  if (typeof window === "undefined") return;
  try {
    const map = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}");
    map[key] = override;
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
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

  // Persistence keys
  const overrideKey = useMemo(
    () => (parsed ? `${parsed.underlying}|${parsed.type}|${parsed.strike}|${parsed.expiration}` : ""),
    [parsed],
  );

  // Spot input — persisted per underlying ticker
  const [spotInput, setSpotInput] = useState<string>("");
  // Premium and IV overrides — persisted per option contract
  const [premiumInput, setPremiumInput] = useState<string>("");
  const [ivInput, setIvInput] = useState<string>("");

  useEffect(() => {
    if (!isOption || !parsed) return;
    const savedSpot = loadSpot(parsed.underlying);
    setSpotInput(savedSpot != null ? String(savedSpot) : "");
    const savedOverride = loadOverride(overrideKey);
    setPremiumInput(
      savedOverride.premium != null
        ? String(savedOverride.premium)
        : holding.marketPrice != null
          ? String(holding.marketPrice)
          : "",
    );
    // IV: user override > broker-parsed IV > blank (auto-solve)
    setIvInput(
      savedOverride.ivPct != null
        ? String(savedOverride.ivPct)
        : holding.iv != null
          ? String(holding.iv)
          : "",
    );
  }, [isOption, parsed, overrideKey, holding.marketPrice, holding.iv]);

  const spot = parseFloat(spotInput);
  const validSpot = Number.isFinite(spot) && spot > 0;
  const premium = parseFloat(premiumInput);
  const validPremium = Number.isFinite(premium) && premium > 0;
  const ivOverridePct = parseFloat(ivInput);
  const hasIvOverride = Number.isFinite(ivOverridePct) && ivOverridePct > 0;

  // Solve IV from option market price + user's spot, scale Greeks by qty.
  // Prefer broker-parsed delta when shown (most accurate single number).
  const greeksData = useMemo(() => {
    if (!isOption || !parsed) return null;
    const T = yearsBetween(new Date(), new Date(parsed.expiration));
    if (T <= 0) return null;
    if (!validSpot) return { ready: false as const, parsed, T };

    const r = 0.045;

    let sigma: number | null = null;
    let ivSource: "override" | "solved" | "broker" | "default" = "default";

    if (hasIvOverride) {
      sigma = ivOverridePct / 100;
      ivSource = holding.iv != null && Math.abs(ivOverridePct - holding.iv) < 0.01 ? "broker" : "override";
    } else if (validPremium) {
      const solved = impliedVol(premium, spot, parsed.strike, T, r, parsed.type);
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

    // If the broker shipped a per-share delta in the screenshot, prefer it.
    const brokerDelta = holding.delta;
    const useBrokerDelta = brokerDelta != null && Number.isFinite(brokerDelta);
    const perShareDeltaLong = useBrokerDelta ? brokerDelta : g.delta;

    return {
      ready: true as const,
      parsed,
      T,
      sigma,
      ivSource,
      perShare: g,
      perShareDeltaLong,
      position: {
        delta: perShareDeltaLong * positionMult,
        gamma: g.gamma * positionMult,
        theta: g.theta * positionMult * 100,
        vega: g.vega * positionMult * 100,
        rho: g.rho * positionMult * 100,
      },
      qty,
      sideSign,
      deltaSource: useBrokerDelta ? ("broker" as const) : ("computed" as const),
    };
  }, [isOption, parsed, validSpot, spot, validPremium, premium, hasIvOverride, ivOverridePct, holding.quantity, holding.iv, holding.delta]);

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

  function onPremiumChange(v: string) {
    setPremiumInput(v);
    if (overrideKey) {
      const n = parseFloat(v);
      const cur = loadOverride(overrideKey);
      saveOverride(overrideKey, {
        ...cur,
        premium: Number.isFinite(n) && n > 0 ? n : undefined,
      });
    }
  }

  function onIvChange(v: string) {
    setIvInput(v);
    if (overrideKey) {
      const n = parseFloat(v);
      const cur = loadOverride(overrideKey);
      saveOverride(overrideKey, {
        ...cur,
        ivPct: Number.isFinite(n) && n > 0 ? n : undefined,
      });
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

          <div className="grid gap-2 sm:grid-cols-3">
            <InputField
              label={`${parsed.underlying} spot $`}
              value={spotInput}
              onChange={onSpotChange}
              placeholder="Required"
              step="0.01"
            />
            <InputField
              label="Option premium (per share) $"
              value={premiumInput}
              onChange={onPremiumChange}
              placeholder={holding.marketPrice != null ? String(holding.marketPrice) : "e.g. 1.50"}
              step="0.01"
              hint={
                holding.marketPrice != null && validPremium && Math.abs(premium - holding.marketPrice) < 0.001
                  ? "From screenshot"
                  : holding.marketPrice != null
                    ? `Parsed: $${holding.marketPrice}`
                    : undefined
              }
            />
            <InputField
              label="IV override (%) — leave blank to back-solve"
              value={ivInput}
              onChange={onIvChange}
              placeholder="auto"
              step="1"
            />
          </div>

          {greeksData && greeksData.ready ? (
            <>
              <div className="text-[11px] muted">
                {greeksData.ivSource === "broker"
                  ? `IV (from broker): ${(greeksData.sigma * 100).toFixed(2)}%`
                  : greeksData.ivSource === "override"
                    ? `IV (you set): ${(greeksData.sigma * 100).toFixed(1)}%`
                    : greeksData.ivSource === "solved"
                      ? `IV (back-solved from $${premium.toFixed(2)} premium): ${(greeksData.sigma * 100).toFixed(1)}%`
                      : `IV (assumed): ${(greeksData.sigma * 100).toFixed(1)}%`}
                {" · "}
                Δ {greeksData.deltaSource === "broker" ? "from broker" : "computed via Black-Scholes"}
                {" · "}
                {greeksData.qty} contract{greeksData.qty === 1 ? "" : "s"}
                {greeksData.sideSign < 0 ? " short" : " long"}
              </div>
              {/* Per-share view (matches broker UI) */}
              <div className="rounded-md border border-border/60 bg-white/[0.02] p-2.5">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider muted">Per share (matches broker)</span>
                  <span className="text-[10px] muted">long convention</span>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 data-grid">
                  <Mini label="Delta" value={greeksData.perShareDeltaLong.toFixed(4)} hint="Long-convention per-share delta" />
                  <Mini label="Gamma" value={greeksData.perShare.gamma.toFixed(4)} hint="Per share" />
                  <Mini label="Theta" value={greeksData.perShare.theta.toFixed(3) + "/d"} hint="$ per share per day" />
                  <Mini label="Vega" value={greeksData.perShare.vega.toFixed(3)} hint="Per share per 1 IV pt" />
                  <Mini label="Rho" value={greeksData.perShare.rho.toFixed(3)} hint="Per share per 1% rate" />
                </div>
              </div>
              {/* Position view (×qty×side×100) */}
              <div className="rounded-md border border-border p-2.5">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider muted">Position ({greeksData.sideSign < 0 ? "−" : "+"}{greeksData.qty} contract{greeksData.qty === 1 ? "" : "s"})</span>
                  <span className="text-[10px] muted">$ exposure</span>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 data-grid">
                  <Mini label="Delta" value={greeksData.position.delta.toFixed(2)} hint="Per $1 underlying move (decimal)" />
                  <Mini label="Gamma" value={greeksData.position.gamma.toFixed(4)} hint="Δ change per $1 move" />
                  <Mini label="Theta" value={fmtUsd(greeksData.position.theta) + "/d"} hint="$ change per day" />
                  <Mini label="Vega" value={fmtUsd(greeksData.position.vega)} hint="$ change per 1 IV point" />
                  <Mini label="Rho" value={fmtUsd(greeksData.position.rho)} hint="$ change per 1% rate" />
                </div>
              </div>
              {greeksData.deltaSource === "computed" && (
                <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[11px] warn">
                  💡 Re-upload your screenshot to grab the broker&rsquo;s exact Delta and IV columns. The current Δ is computed via Black-Scholes from your inputs, which may drift from the broker by a few percent.
                </div>
              )}
              {greeksData.ivSource === "solved" && greeksData.sigma > 1.5 && (
                <div className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[11px] warn">
                  ⚠ The back-solved IV is &gt;{(greeksData.sigma * 100).toFixed(0)}%, which is unusually high.
                  The premium is probably the contract value (price × 100) instead of per-share.
                  Try dividing the premium by 100 (e.g. $150 → $1.50).
                </div>
              )}
            </>
          ) : (
            <div className="text-xs muted">
              Enter the {parsed.underlying} spot price to see accurate Greeks.
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

function InputField({
  label,
  value,
  onChange,
  placeholder,
  step,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider muted truncate" title={label}>
        {label}
      </span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-white/[0.02] px-2 py-1 text-sm font-mono"
      />
      {hint && <span className="text-[10px] muted">{hint}</span>}
    </label>
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
