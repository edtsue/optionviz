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

  const ready = useMemo(() => {
    if (!trade.legs.length) return false;
    if (!trade.underlyingPrice || trade.underlyingPrice <= 0) return false;
    return trade.legs.every(
      (l) => l.strike > 0 && l.expiration && !Number.isNaN(new Date(l.expiration).getTime()),
    );
  }, [trade]);

  // Detect strategy + identify the short leg the checklist anchors to.
  const detected = useMemo(() => {
    const d = detectStrategy(trade);
    if (d.name === "covered_call") return "covered_call" as const;
    if (d.name === "cash_secured_put") return "cash_secured_put" as const;
    return "other" as const;
  }, [trade]);
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
    const strategy = detectStrategy(filled);
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
  }, [trade, ready]);

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

  const main = (
    <div className="flex flex-col gap-3">
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

      {/* Key-numbers strip — auto-updates as the chart markers change so the
          user can read Spot / Stop / Take / Breakeven at a glance without
          scrubbing the chart. */}
      <KeyNumbersStrip
        spot={data.filled.underlyingPrice}
        stopSpot={shortLeg ? stopSpot : null}
        stopLoss={shortLeg ? stopLoss : null}
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

function dayProgressLabel(progress: number, dteAtTarget: number): string {
  if (progress <= 0.001) return "Today";
  if (progress >= 0.999) return "At expiry";
  return `${dteAtTarget.toFixed(0)}d to expiry`;
}

function KeyNumbersStrip({
  spot,
  stopSpot,
  stopLoss,
  profitSpot,
  profitGain,
  breakevens,
}: {
  spot: number;
  stopSpot: number | null;
  stopLoss: number | null | undefined;
  profitSpot: number | null;
  profitGain: number | null;
  breakevens: number[];
}) {
  const fmt = (v: number) => `$${v.toFixed(2)}`;
  const fmtSigned = (v: number) =>
    `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  return (
    <div className="card card-tight">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 data-grid">
        <Cell label="Take" tone="text-emerald-400" empty={profitSpot == null}>
          {profitSpot != null ? (
            <>
              {fmt(profitSpot)}
              {profitGain != null && (
                <span className="ml-1 text-[10px] muted">{fmtSigned(profitGain)}</span>
              )}
            </>
          ) : (
            "—"
          )}
        </Cell>
        <Cell label="Spot" tone="text-accent">
          {fmt(spot)}
        </Cell>
        <Cell label="Stop" tone="text-rose-400" empty={stopSpot == null}>
          {stopSpot != null ? (
            <>
              {fmt(stopSpot)}
              {stopLoss != null && (
                <span className="ml-1 text-[10px] muted">{fmtSigned(stopLoss)}</span>
              )}
            </>
          ) : (
            "—"
          )}
        </Cell>
        <Cell label="Breakeven" tone="text-amber-400" empty={breakevens.length === 0}>
          {breakevens.length === 0
            ? "—"
            : breakevens.map((b) => fmt(b)).join(" · ")}
        </Cell>
      </div>
    </div>
  );
}

function Cell({
  label,
  tone,
  empty,
  children,
}: {
  label: string;
  tone?: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] muted uppercase tracking-wider">{label}</span>
      <span className={`kpi-sm truncate ${empty ? "muted" : tone ?? ""}`}>{children}</span>
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
