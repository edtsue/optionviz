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

// Heavy below-the-fold components — pull them out of the initial trade-page
// bundle. StressTest only renders when the user expands its panel; TradeChat
// is far enough down the page that lazy loading is invisible.
const StressTest = dynamic(
  () => import("@/components/StressTest").then((m) => ({ default: m.StressTest })),
  { ssr: false, loading: () => <div className="card text-xs muted">Loading stress test…</div> },
);
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
}: {
  trade: Trade;
  sideBySide?: boolean;
  /** Optional controlled market view — when supplied, lifted into the parent
      so the page header can read it (e.g., to show "bullish bias" matching
      the user's manual selection instead of the auto-detected strategy bias). */
  marketView?: MarketView;
  onMarketViewChange?: (v: MarketView) => void;
}) {
  const [dayProgress, setDayProgress] = useState(0);
  const [showStress, setShowStress] = useState(false);
  const [stopMultiplier, setStopMultiplier] = useState(2.0);
  const [profitTargetSpot, setProfitTargetSpot] = useState<number | null>(null);
  // Deferred copy used for chart rendering: clicking a profit row updates the
  // table-row highlight immediately while the chart marker re-renders at lower
  // priority. Eliminates the input-stutter on slow trades.
  const deferredProfitSpot = useDeferredValue(profitTargetSpot);
  const handleProfitTargetSpotChange = useCallback((spot: number | null) => {
    setProfitTargetSpot(spot);
  }, []);
  const [checklistOpen, setChecklistOpen] = useState(true);

  // Persist checklist open/closed across page loads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("optionviz.checklist-open");
      if (raw === "0") setChecklistOpen(false);
      else if (raw === "1") setChecklistOpen(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("optionviz.checklist-open", checklistOpen ? "1" : "0");
    } catch {}
  }, [checklistOpen]);

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

  // Estimate days to last expiry from trade for stress test slider
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
      <div>
        <button
          type="button"
          onClick={() => setShowStress((v) => !v)}
          className="w-full rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-left text-sm hover:border-accent/40"
        >
          <span className="muted text-[11px] uppercase tracking-wider">Stress test</span>{" "}
          <span className="ml-1 muted">{showStress ? "▾" : "▸"}</span>
        </button>
        {showStress && (
          <div className="mt-2">
            <StressTest trade={data.filled} maxDaysForward={dteToLastExpiry} />
          </div>
        )}
      </div>

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

  const checklist = (
    <TradeChecklist
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

  if (!sideBySide) {
    return (
      <div className="space-y-3">
        {main}
        {right}
        {checklist}
      </div>
    );
  }

  // Two-pane chart | inspector layout. Checklist lives in an off-canvas
  // drawer (below) so the chart gets full available width by default.
  const inner = (
    <ResizableSplit
      id="trade-chart-inspector"
      fixedSide="end"
      defaultPx={340}
      minPx={260}
      maxPx={520}
      breakpoint="xl"
    >
      {main}
      {right}
    </ResizableSplit>
  );

  return (
    <ChecklistDrawerLayout
      open={checklistOpen}
      onOpenChange={setChecklistOpen}
    >
      {inner}
      {checklist}
    </ChecklistDrawerLayout>
  );
}

// Renders the trade view with the checklist as a slide-in drawer overlay.
// Header pill toggles open; backdrop click and Escape close. Drawer width
// is fixed (no resize) — the chart finally gets the full page width when
// the drawer is closed, which was the main complaint about the old dock.
function ChecklistDrawerLayout({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: [React.ReactNode, React.ReactNode];
}) {
  const [inner, drawer] = children;

  // Esc to close when open. No global key handler when closed.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <div className="relative">
      {/* Trigger pill — always visible at top-right of the analysis area. */}
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-wider muted hover:border-accent/50 hover:text-text"
        >
          ☰ Checklist
        </button>
      </div>

      {inner}

      {/* Backdrop. Pointer events only when open so it never blocks clicks
          while closed. Fades in/out with a CSS transition. */}
      <div
        aria-hidden={!open}
        onClick={() => onOpenChange(false)}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Drawer — translates in from the right. Always mounted so the
          checklist component keeps its loaded state across opens. */}
      <aside
        aria-hidden={!open}
        aria-label="Trade checklist"
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(420px,90vw)] flex-col border-l border-border bg-bg shadow-2xl transition-transform duration-250 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[11px] uppercase tracking-wider muted">Checklist</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close checklist"
            className="rounded p-1 text-textDim hover:bg-white/10 hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{drawer}</div>
      </aside>
    </div>
  );
}

function dayProgressLabel(progress: number, dteAtTarget: number): string {
  if (progress <= 0.001) return "Today";
  if (progress >= 0.999) return "At expiry";
  return `${dteAtTarget.toFixed(0)}d to expiry`;
}
