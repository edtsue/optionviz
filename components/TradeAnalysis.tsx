"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "@/types/trade";
import { detectStrategy } from "@/lib/strategies";
import {
  buildPayoff,
  fillImpliedVolsForTrade,
  perShareGreeks,
  totalPnL,
  tradeStats,
  type PayoffPoint,
} from "@/lib/payoff";
import { strategyKPIs } from "@/lib/strategy-kpis";
import { yearsBetween } from "@/lib/black-scholes";
import { PayoffChart } from "@/components/PayoffChart";
import { DistributionChart } from "@/components/DistributionChart";
import { buildDistribution, pProfit } from "@/lib/distribution";
import { TimeSlider } from "@/components/TimeSlider";
import { Inspector } from "@/components/Inspector";
import { ResizableSplit } from "@/components/ResizableSplit";
import { TradeChecklist } from "@/components/TradeChecklist";
import dynamic from "next/dynamic";

// TradeChat lazy-loads since it's below the fold and its bundle includes
// markdown stripping + image resize that the trade page rarely needs first.
const TradeChat = dynamic(
  () => import("@/components/TradeChat").then((m) => ({ default: m.TradeChat })),
  { ssr: false, loading: () => <div className="card text-xs muted">Loading chat…</div> },
);
import { TradeInputs } from "@/components/TradeInputs";
import { computeStopSpot, findShortLeg } from "@/lib/stop-spot";
import { usePortfolioShares, externalSharesFor } from "@/lib/use-portfolio-shares";

type Strategy = "covered_call" | "cash_secured_put";
type MarketView = "bull" | "neutral" | "bear";

export function TradeAnalysis({
  trade,
  sideBySide = true,
  marketView: marketViewProp,
  onMarketViewChange,
  checklistOpen = false,
  onChecklistOpenChange,
}: {
  trade: Trade;
  sideBySide?: boolean;
  /** Optional controlled market view — when supplied, lifted into the parent
      so the page header can read it (e.g., to show "bullish bias" matching
      the user's manual selection instead of the auto-detected strategy bias). */
  marketView?: MarketView;
  onMarketViewChange?: (v: MarketView) => void;
  /** Drawer open/close state, controlled by the parent so the trigger button
      can live in the page header. */
  checklistOpen?: boolean;
  onChecklistOpenChange?: (v: boolean) => void;
}) {
  const [dayProgress, setDayProgress] = useState(0);
  const [stopMultiplier, setStopMultiplier] = useState(2.0);
  // Payoff (P/L curve) vs Distribution (terminal-price likelihood) view.
  // Persisted across the trade page in component state only — toggle is
  // visible in the chart's panel header.
  const [chartView, setChartView] = useState<"payoff" | "distribution">("payoff");
  const [profitTargetSpot, setProfitTargetSpot] = useState<number | null>(null);
  // Deferred copy used for chart rendering: clicking a profit row updates the
  // table-row highlight immediately while the chart marker re-renders at lower
  // priority. Eliminates the input-stutter on slow trades.
  const deferredProfitSpot = useDeferredValue(profitTargetSpot);
  const handleProfitTargetSpotChange = useCallback((spot: number | null) => {
    setProfitTargetSpot(spot);
  }, []);

  const [marketViewLocal, setMarketViewLocal] = useState<MarketView>("neutral");
  const marketView = marketViewProp ?? marketViewLocal;
  // Stable identity so React.memo'd children (TradeChecklist) don't re-render
  // every time TradeAnalysis renders for unrelated reasons.
  const setMarketView = useCallback(
    (v: MarketView) => {
      setMarketViewLocal(v);
      onMarketViewChange?.(v);
    },
    [onMarketViewChange],
  );
  const [strategy, setStrategy] = useState<Strategy>("covered_call");

  // Pull share holdings from the latest portfolio snapshot so detectStrategy
  // recognizes covered calls when the hedge shares live in the portfolio
  // rather than being attached to the trade row.
  const portfolioShares = usePortfolioShares();
  const externalShares = externalSharesFor(portfolioShares, trade.symbol);

  const ready = useMemo(() => {
    if (!trade.legs.length) return false;
    if (!trade.underlyingPrice || trade.underlyingPrice <= 0) return false;
    return trade.legs.every(
      (l) => l.strike > 0 && l.expiration && !Number.isNaN(new Date(l.expiration).getTime()),
    );
  }, [trade]);

  // Detect strategy + identify the short leg the checklist anchors to.
  const detected = useMemo(() => {
    const d = detectStrategy(trade, { externalShares });
    if (d.name === "covered_call") return "covered_call" as const;
    if (d.name === "cash_secured_put") return "cash_secured_put" as const;
    return "other" as const;
  }, [trade, externalShares]);
  const shortLeg = useMemo(() => findShortLeg(trade), [trade]);

  // Initialize the strategy override from the detected strategy on first
  // render of a given trade (the checklist API GET will overwrite if the
  // user previously stored a different choice).
  const initStrategyRef = useRef<string | null>(null);
  if (trade.id && initStrategyRef.current !== trade.id) {
    initStrategyRef.current = trade.id;
    if (detected === "covered_call" || detected === "cash_secured_put") {
      // Defer the setState to the next tick so we don't update during render.
      Promise.resolve().then(() => setStrategy(detected));
    }
  }

  const stopSpot = useMemo(() => {
    if (!shortLeg) return null;
    return computeStopSpot({ trade, shortLeg, multiplier: stopMultiplier });
  }, [trade, shortLeg, stopMultiplier]);

  // Total dollar P/L at the user-picked profit-take spot (today). null
  // means no row is selected → chart doesn't draw the green target line.
  // Tied to deferredProfitSpot so the heavy P/L recompute defers a tick
  // behind the click; the checklist row highlights immediately.
  const profitGain = useMemo(() => {
    if (deferredProfitSpot == null) return null;
    const filled = fillImpliedVolsForTrade(trade);
    return totalPnL(filled, deferredProfitSpot, new Date());
  }, [trade, deferredProfitSpot]);

  // Total dollar P/L if the BTC stop fires at stopSpot today (option leg(s)
  // re-priced via Black-Scholes + any underlying mark-to-market).
  const stopLoss = useMemo(() => {
    if (stopSpot == null) return null;
    const filled = fillImpliedVolsForTrade(trade);
    return totalPnL(filled, stopSpot, new Date());
  }, [trade, stopSpot]);

  // Trade-only computations: IV fill, stats, KPIs, base payoff, σ-band — these
  // don't depend on the time slider and shouldn't recompute on each scrub.
  const base = useMemo(() => {
    if (!ready) return null;
    const filled = fillImpliedVolsForTrade(trade);
    const strategy = detectStrategy(filled, { externalShares });
    const stats = tradeStats(filled);
    const kpis = strategyKPIs(filled);
    const lastExpiry = new Date(
      Math.max(...filled.legs.map((l) => new Date(l.expiration).getTime())),
    );
    const fullPayoff = buildPayoff(filled);
    const now = new Date();
    const T = yearsBetween(now, lastExpiry);
    const ivs = filled.legs.map((l) => l.iv ?? 0.3);
    const sigma = ivs.reduce((a, b) => a + b, 0) / Math.max(ivs.length, 1);
    const oneSigmaBand: [number, number] | null =
      T > 0 && sigma > 0
        ? (() => {
            const drift = (filled.riskFreeRate - 0.5 * sigma * sigma) * T;
            const center = filled.underlyingPrice * Math.exp(drift);
            const w = sigma * Math.sqrt(T);
            return [+(center * Math.exp(-w)).toFixed(2), +(center * Math.exp(w)).toFixed(2)];
          })()
        : null;
    return { filled, strategy, stats, kpis, fullPayoff, lastExpiry, oneSigmaBand };
  }, [trade, ready, externalShares]);

  // Slider-dependent: recompute the "mid" curve and per-share greeks at target.
  const data = useMemo(() => {
    if (!base) return null;
    const now = new Date();
    const targetDate = new Date(
      now.getTime() + dayProgress * (base.lastExpiry.getTime() - now.getTime()),
    );
    const dteAtTarget = yearsBetween(targetDate, base.lastExpiry) * 365;
    const customSeries: PayoffPoint[] = base.fullPayoff.map((p) => ({
      ...p,
      mid: +totalPnL(base.filled, p.spot, targetDate).toFixed(2),
    }));
    const greeksAtTarget = perShareGreeks(base.filled, targetDate);
    return { ...base, customSeries, dteAtTarget, greeksAtTarget };
  }, [base, dayProgress]);

  if (!ready || !data) {
    return (
      <div className="card text-sm muted">
        Fill in symbol, underlying price, strike, premium, and expiration to see the payoff
        chart, Greeks, and ideas.
      </div>
    );
  }

  // Days to last expiry — used by the time slider's totalDte upper bound.
  const dteToLastExpiry = data
    ? Math.max(
        1,
        Math.round(
          yearsBetween(
            new Date(),
            new Date(Math.max(...data.filled.legs.map((l) => new Date(l.expiration).getTime()))),
          ) * 365,
        ),
      )
    : 30;

  // Distribution: lognormal density over the same spot grid as the payoff,
  // plus P(profit) integrated over the loss-zero crossing of the expiry P/L.
  // Computed inline (not memo'd) because it sits after the early-return; the
  // math is light enough (~61 lognormal samples + a trapezoid pass) to do
  // every render while the distribution view is active.
  const distribution =
    chartView === "distribution"
      ? buildDistribution(
          data.filled,
          data.fullPayoff.map((p) => p.spot),
        )
      : null;
  const pop = chartView === "distribution" ? pProfit(data.filled, data.fullPayoff) : 0;

  const main = (
    <div className="flex flex-col gap-3">
      {chartView === "payoff" ? (
        <PayoffChart
          data={data.customSeries}
          underlying={data.filled.underlyingPrice}
          breakevens={data.stats.breakevens}
          midLabel={dayProgressLabel(dayProgress, data.dteAtTarget)}
          oneSigmaBand={data.oneSigmaBand}
          stopSpot={shortLeg ? stopSpot : null}
          stopLoss={shortLeg ? stopLoss : null}
          profitSpot={deferredProfitSpot}
          profitGain={profitGain}
        />
      ) : (
        distribution && (
          <DistributionChart
            payoff={data.fullPayoff}
            distribution={distribution}
            underlying={data.filled.underlyingPrice}
            breakevens={data.stats.breakevens}
            stopSpot={shortLeg ? stopSpot : null}
            profitSpot={deferredProfitSpot}
            pProfit={pop}
          />
        )
      )}
      <ChartViewToggle value={chartView} onChange={setChartView} />

      {/* HUD — the headline numbers always visible: symbol/strike/expiry on
          the contract side, premium/stop-spot/loss-at-stop/net-delta on the
          risk side. Anchored to the short leg (same as the stop logic). */}
      <TradeHud
        trade={data.filled}
        anchorLeg={shortLeg ?? data.filled.legs[0] ?? null}
        stopMultiplier={stopMultiplier}
        stopSpot={shortLeg ? stopSpot : null}
        stopLoss={shortLeg ? stopLoss : null}
        perShareDelta={perShareGreeks(data.filled).delta}
      />
      {/* Secondary chips — Take / Breakeven. Only relevant when the user has
          picked a take-profit row or when the chart has breakevens to call out. */}
      <SecondaryChips
        profitSpot={deferredProfitSpot}
        profitGain={profitGain}
        breakevens={data.stats.breakevens}
      />

      {data.kpis.length > 0 && (
        <div className="card card-tight">
          <div className="label mb-2">{data.strategy.label}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 data-grid">
            {data.kpis.map((k) => (
              <div key={k.label} className="flex min-w-0 flex-col">
                <span className="text-[10px] muted">{k.label}</span>
                <span className="kpi-sm truncate" title={k.value}>
                  {k.value}
                </span>
                {k.hint && <span className="text-[10px] muted truncate" title={k.hint}>{k.hint}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      <TimeSlider
        value={dayProgress}
        onChange={setDayProgress}
        dteAtTarget={data.dteAtTarget}
        totalDte={dteToLastExpiry}
      />

      <TradeChat trade={data.filled} />
    </div>
  );

  const right = (
    <div className="flex flex-col gap-3">
      <TradeInputs trade={data.filled} strategy={data.strategy} />
      <Inspector
        greeks={data.greeksAtTarget}
        stats={data.stats}
        trade={data.filled}
        asOfLabel={dayProgressLabel(dayProgress, data.dteAtTarget)}
      />
    </div>
  );

  // Two render-only views over the same TradeChecklist component:
  // - "config" → strategy + market view + stop/profit multipliers (docked)
  // - "sections" → the 7 checklist sections + Reset (drawer)
  // Each instance does its own API GET on mount, but writes only the keys
  // belonging to its view. The /api/trades/:id/checklist PUT handler upserts
  // partial fields, so two instances co-exist cleanly.
  const checklistConfig = (
    <TradeChecklist
      view="config"
      trade={data.filled}
      detectedStrategy={detected}
      stopMultiplier={stopMultiplier}
      onStopMultiplierChange={setStopMultiplier}
      marketView={marketView}
      onMarketViewChange={setMarketView}
      strategy={strategy}
      onStrategyChange={setStrategy}
      stopSpot={stopSpot}
      stopLoss={stopLoss}
      profitTargetSpot={profitTargetSpot}
      onProfitTargetSpotChange={handleProfitTargetSpotChange}
    />
  );
  const checklistSections = (
    <TradeChecklist
      view="sections"
      trade={data.filled}
      detectedStrategy={detected}
      stopMultiplier={stopMultiplier}
      onStopMultiplierChange={setStopMultiplier}
      marketView={marketView}
      onMarketViewChange={setMarketView}
      strategy={strategy}
      onStrategyChange={setStrategy}
      stopSpot={stopSpot}
      stopLoss={stopLoss}
    />
  );

  if (!sideBySide) {
    return (
      <div className="space-y-3">
        {main}
        {right}
        {checklistConfig}
        {checklistSections}
      </div>
    );
  }

  // Three-column layout: chart (with KPIs, time slider, chat) | trade inputs
  // + inspector | trade-plan column with strategy / market view / multipliers
  // and the 7 checklist sections always visible. The whole layout uses two
  // nested ResizableSplits so the user can drag the dividers.
  const innerLeft = (
    <ResizableSplit
      id="trade-chart-inspector"
      fixedSide="end"
      defaultPx={320}
      minPx={240}
      maxPx={480}
      breakpoint="xl"
    >
      {main}
      {right}
    </ResizableSplit>
  );

  return (
    <>
      <ResizableSplit
        id="trade-checklist-dock"
        fixedSide="end"
        defaultPx={340}
        minPx={280}
        maxPx={460}
        breakpoint="xl"
      >
        {innerLeft}
        {checklistConfig}
      </ResizableSplit>
      <ChecklistDrawer
        open={checklistOpen}
        onOpenChange={onChecklistOpenChange}
      >
        {checklistSections}
      </ChecklistDrawer>
    </>
  );
}

function ChartViewToggle({
  value,
  onChange,
}: {
  value: "payoff" | "distribution";
  onChange: (v: "payoff" | "distribution") => void;
}) {
  return (
    <div className="inline-flex w-fit rounded-md border border-border bg-white/[0.02] p-0.5 self-end">
      {(["payoff", "distribution"] as const).map((v) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded px-3 py-1 text-xs capitalize transition ${
              active ? "bg-accent/15 text-accent" : "muted hover:text-text"
            }`}
          >
            {v === "payoff" ? "Payoff" : "Distribution"}
          </button>
        );
      })}
    </div>
  );
}

function dayProgressLabel(progress: number, dteAtTarget: number): string {
  if (progress <= 0.001) return "Today";
  if (progress >= 0.999) return "At expiry";
  return `${dteAtTarget.toFixed(0)}d to expiry`;
}

const CONTRACT_MULT = 100;

function netPremium(trade: Trade): number {
  return trade.legs.reduce(
    (acc, l) => acc + (l.side === "short" ? 1 : -1) * l.premium * l.quantity * CONTRACT_MULT,
    0,
  );
}

function fmtMoney(v: number, decimals = 2): string {
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function fmtSignedMoney(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtExpiry(iso: string): { label: string; dte: number } {
  // Parse YYYY-MM-DD as a *local* date — `new Date("2025-07-19")` is UTC
  // midnight, which renders as the prior day in any timezone west of UTC.
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const label = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
  // DTE: whole days from local-midnight-today to local-midnight-expiry.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dte = Math.max(0, Math.round((date.getTime() - today.getTime()) / 86_400_000));
  return { label, dte };
}

function TradeHud({
  trade,
  anchorLeg,
  stopMultiplier,
  stopSpot,
  stopLoss,
  perShareDelta,
}: {
  trade: Trade;
  anchorLeg: { type: "call" | "put"; strike: number; expiration: string } | null;
  stopMultiplier: number;
  stopSpot: number | null;
  stopLoss: number | null | undefined;
  /** Per-share delta — broker-standard reading (e.g. 0.45 for a 45-delta
      long call, −0.30 for a short put). Sums across legs with side sign,
      no quantity multiplier. */
  perShareDelta: number | null;
}) {
  const premium = netPremium(trade);
  const strikeStr = anchorLeg
    ? `$${anchorLeg.strike} ${anchorLeg.type === "call" ? "C" : "P"}`
    : "—";
  const expiry = anchorLeg ? fmtExpiry(anchorLeg.expiration) : null;
  const stopLabel = `Stop (${stopMultiplier.toFixed(1)}×)`;
  const deltaTone =
    perShareDelta == null
      ? undefined
      : perShareDelta > 0.05
        ? "text-emerald-400"
        : perShareDelta < -0.05
          ? "text-rose-400"
          : "text-amber-400";
  const deltaStr =
    perShareDelta == null
      ? "—"
      : `${perShareDelta >= 0 ? "+" : "−"}${Math.abs(perShareDelta).toFixed(2)}`;

  return (
    <div className="card card-tight">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-7 data-grid">
        {/* — Contract group — */}
        <HudCell
          label="Underlying"
          value={trade.symbol}
          sub={`spot ${fmtMoney(trade.underlyingPrice)}`}
        />
        <HudCell label="Strike" value={strikeStr} empty={!anchorLeg} />
        <HudCell
          label="Expiration"
          value={expiry?.label ?? "—"}
          sub={expiry ? `${expiry.dte}d` : undefined}
          empty={!expiry}
        />

        {/* — Risk group — */}
        <HudCell
          label={premium >= 0 ? "Premium (credit)" : "Premium (debit)"}
          value={fmtSignedMoney(premium)}
          tone={premium >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <HudCell
          label={stopLabel}
          value={stopSpot != null ? fmtMoney(stopSpot) : "—"}
          empty={stopSpot == null}
          tone="text-rose-400"
        />
        <HudCell
          label="Loss @ stop"
          value={stopLoss != null ? fmtSignedMoney(stopLoss) : "—"}
          empty={stopLoss == null}
          tone="text-rose-400"
        />
        <HudCell
          label="Delta"
          value={deltaStr}
          sub="per share"
          tone={deltaTone}
          empty={perShareDelta == null}
        />
      </div>
    </div>
  );
}

function HudCell({
  label,
  value,
  sub,
  tone,
  empty,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  empty?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] muted uppercase tracking-wider">{label}</span>
      <span className={`kpi-sm truncate ${empty ? "muted" : tone ?? ""}`} title={value}>
        {value}
      </span>
      {sub && <span className="text-[10px] muted truncate" title={sub}>{sub}</span>}
    </div>
  );
}

function SecondaryChips({
  profitSpot,
  profitGain,
  breakevens,
}: {
  profitSpot: number | null;
  profitGain: number | null;
  breakevens: number[];
}) {
  const hasTake = profitSpot != null;
  const hasBE = breakevens.length > 0;
  if (!hasTake && !hasBE) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px]">
      {hasTake && (
        <span className="text-emerald-400">
          Take {fmtMoney(profitSpot!)}
          {profitGain != null && (
            <span className="ml-1 muted">{fmtSignedMoney(profitGain)}</span>
          )}
        </span>
      )}
      {hasBE && (
        <span className="text-amber-400">
          Breakeven {breakevens.map((b) => fmtMoney(b)).join(" · ")}
        </span>
      )}
    </div>
  );
}

function ChecklistDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  // Esc to close. Only attached when open so we don't pollute the global key
  // map when the drawer isn't visible.
  useEffect(() => {
    if (!open || !onOpenChange) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange?.(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <>
      {/* Backdrop. pointer-events:none + opacity:0 while closed so it never
          intercepts clicks on the underlying page. */}
      <div
        aria-hidden={!open}
        onClick={() => onOpenChange?.(false)}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-hidden={!open}
        aria-label="Trade checklist"
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(380px,90vw)] flex-col border-l border-border bg-bg shadow-2xl transition-transform duration-250 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[11px] uppercase tracking-wider muted">Checklist</span>
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            aria-label="Close checklist"
            className="rounded p-1 text-textDim hover:bg-white/10 hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </aside>
    </>
  );
}
