"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "@/types/trade";
import {
  computeCoveredProfitLadder,
  computeProfitSpot,
  findShortLeg,
  isCoveredCallLike,
} from "@/lib/stop-spot";
import { totalPnL } from "@/lib/payoff";

type Strategy = "covered_call" | "cash_secured_put";
type MarketView = "bull" | "neutral" | "bear";

interface ChecklistItem {
  id: string;
  cc?: string;
  csp?: string;
  shared?: string;
  hint?: string;
}

interface ChecklistSection {
  id: string;
  title: string;
  oneLiner: string;
  items: ChecklistItem[];
}

const SECTIONS: ChecklistSection[] = [
  {
    id: "pre",
    title: "Pre-trade",
    oneLiner: "No catalysts before expiry · IV checked",
    items: [
      { id: "pre-earnings", shared: "No earnings before expiry" },
      { id: "pre-macro", shared: "No major macro events (CPI / FOMC / jobs)" },
      { id: "pre-news", shared: "No M&A rumors or activist news" },
      { id: "pre-iv", shared: "Checked current IV vs historical" },
      {
        id: "pre-recent",
        cc: "Stock isn't down 10%+ recently (snap-back risk)",
        csp: "Stock isn't up 10%+ recently (mean-reversion risk)",
      },
    ],
  },
  {
    id: "strike",
    title: "Strike & expiry",
    oneLiner: "OTM, outside 1σ, past key level",
    items: [
      { id: "strike-expiry", shared: "Picked expiry (default: weekly)" },
      { id: "strike-sigma", shared: "Strike outside 1-standard-deviation expected move" },
      {
        id: "strike-delta",
        shared: "Delta in target range",
        hint: "Range varies by market view — see chip above",
      },
      {
        id: "strike-level",
        cc: "Strike sits above key resistance",
        csp: "Strike sits below key support",
      },
    ],
  },
  {
    id: "size",
    title: "Position size",
    oneLiner: "Don't go all-in",
    items: [
      {
        id: "size-coverage",
        cc: "Not covering 100% of shares",
        csp: "Using only part of available cash buying power",
      },
      { id: "size-risk", shared: "Max risk per trade ≤ 0.5% of account" },
      { id: "size-ladder", shared: "Considered laddering across strikes" },
    ],
  },
  {
    id: "entry",
    title: "Order entry",
    oneLiner: "Sell at MID, day order",
    items: [
      { id: "entry-side", shared: "Sell to Open" },
      { id: "entry-limit", shared: "Limit order at MID price (never market)" },
      { id: "entry-day", shared: "Day order (re-evaluate tomorrow if unfilled)" },
    ],
  },
  {
    id: "stop",
    title: "Stop loss",
    oneLiner: "GTC Buy-to-Close Stop-Market — non-negotiable",
    items: [
      { id: "stop-mult", shared: "Stop multiplier picked (above) and adjusted for IV" },
      { id: "stop-placed", shared: "Placed GTC Buy-to-Close Stop-Market" },
      { id: "stop-confirmed", shared: "Confirmed stop appears in open orders" },
    ],
  },
  {
    id: "safety",
    title: "Safety net",
    oneLiner: "Price alert at 50% to strike",
    items: [{ id: "safety-alert", shared: "Set stock price alert at 50% of distance to strike" }],
  },
  {
    id: "walkaway",
    title: "Walk away",
    oneLiner: "Close the app · daily check max",
    items: [
      { id: "walk-app", shared: "Closed the trading app" },
      { id: "walk-daily", shared: "Will check once daily, max" },
    ],
  },
];

const MARKET_DEFAULT_MULTIPLIER: Record<MarketView, number> = {
  bull: 2.5,
  neutral: 2.0,
  bear: 3.0,
};

const DELTA_RANGE: Record<Strategy, Record<MarketView, string>> = {
  covered_call: {
    bull: "Δ 0.05 – 0.10 (further OTM — let stock run)",
    neutral: "Δ 0.10 – 0.15 (standard)",
    bear: "Δ 0.15 – 0.25 (closer to ATM — premiums are rich)",
  },
  cash_secured_put: {
    bull: "Δ 0.20 – 0.30 (closer to ATM — drop unlikely, take premium)",
    neutral: "Δ 0.10 – 0.15 (standard)",
    bear: "Δ 0.05 – 0.10 (further OTM — avoid assignment in falling tape)",
  },
};

const COVERAGE_RANGE: Record<Strategy, Record<MarketView, string>> = {
  covered_call: {
    bull: "Cover 50 – 60% of shares",
    neutral: "Cover 70 – 80% of shares",
    bear: "Cover 80 – 90% of shares",
  },
  cash_secured_put: {
    bull: "Use 70 – 80% of allotted cash",
    neutral: "Use 50 – 70% of allotted cash",
    bear: "Use 30 – 50% of allotted cash",
  },
};

interface Props {
  trade: Trade;
  /** detectStrategy() result, used as default + for auto-hide. */
  detectedStrategy: "covered_call" | "cash_secured_put" | "other";
  stopMultiplier: number;
  onStopMultiplierChange: (v: number) => void;
  marketView: MarketView;
  onMarketViewChange: (v: MarketView) => void;
  strategy: Strategy;
  onStrategyChange: (v: Strategy) => void;
  /** Computed stop spot for the headline chip (display-only). */
  stopSpot: number | null;
  /** Computed dollar P/L at stop trigger (display-only, usually negative). */
  stopLoss?: number | null;
  /** Currently-selected profit-target spot (drives chart marker + active row). */
  profitTargetSpot?: number | null;
  /** Click handler when a row in the profit table is selected. Pass null to clear. */
  onProfitTargetSpotChange?: (spot: number | null) => void;
  /** Render mode. "config" = strategy + market view + multipliers (docked
      column). "sections" = the 7 checklist sections + Reset (drawer). Both
      views still own the same API GET/PUT pipeline; rendering twice is the
      cost we pay to keep state co-located with the API client. */
  view?: "config" | "sections";
}

function TradeChecklistImpl(props: Props) {
  const {
    trade,
    detectedStrategy,
    stopMultiplier,
    onStopMultiplierChange,
    marketView,
    onMarketViewChange,
    strategy,
    onStrategyChange,
    stopSpot,
    stopLoss,
    profitTargetSpot,
    onProfitTargetSpotChange,
    view = "config",
  } = props;

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-trade expanded-section memory. Checks already persist server-side
  // (see GET/PUT below); expanded is purely a UI affordance, so localStorage
  // is enough — no need to round-trip a DB column for it.
  const expandedKey = trade.id ? `optionviz.checklist-expanded.${trade.id}` : null;
  useEffect(() => {
    if (!expandedKey) return;
    try {
      const raw = localStorage.getItem(expandedKey);
      if (raw) setExpanded(JSON.parse(raw) ?? {});
      else setExpanded({});
    } catch {
      setExpanded({});
    }
  }, [expandedKey]);
  useEffect(() => {
    if (!expandedKey) return;
    try {
      localStorage.setItem(expandedKey, JSON.stringify(expanded));
    } catch {}
  }, [expandedKey, expanded]);

  // Load existing checklist from Supabase on mount / trade change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/trades/${trade.id}/checklist`, {
          cache: "no-store",
        });
        if (!r.ok) {
          setLoaded(true);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        if (data.checklist) {
          if (data.checklist.strategy) onStrategyChange(data.checklist.strategy);
          if (data.checklist.market_view) onMarketViewChange(data.checklist.market_view);
          if (typeof data.checklist.stop_multiplier === "number")
            onStopMultiplierChange(data.checklist.stop_multiplier);
          setChecked(data.checklist.checked_items || {});
        }
        setLoaded(true);
      } catch {
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally only depend on trade.id — the change handlers are
    // stable in practice and re-running on those would cause loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id]);

  // Debounced save on any change after initial load.
  const persist = (next: {
    strategy?: Strategy;
    market_view?: MarketView;
    stop_multiplier?: number;
    checked_items?: Record<string, boolean>;
  }) => {
    if (!loaded) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/trades/${trade.id}/checklist`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
      } finally {
        setSaving(false);
      }
    }, 400);
  };

  const setChk = (id: string, v: boolean) => {
    const next = { ...checked, [id]: v };
    setChecked(next);
    persist({ checked_items: next });
  };

  const toggleSection = (id: string) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const setStrategy = (s: Strategy) => {
    onStrategyChange(s);
    persist({ strategy: s });
  };

  const setMarket = (m: MarketView) => {
    onMarketViewChange(m);
    // Snap multiplier to the market-view default when the user picks a view.
    const mult = MARKET_DEFAULT_MULTIPLIER[m];
    onStopMultiplierChange(mult);
    persist({ market_view: m, stop_multiplier: mult });
  };

  const setMultiplier = (m: number) => {
    onStopMultiplierChange(m);
    persist({ stop_multiplier: m });
  };

  const reset = () => {
    setChecked({});
    setExpanded({});
    persist({ checked_items: {} });
  };

  const visibleItems = (sec: ChecklistSection): ChecklistItem[] =>
    sec.items.map((it) => ({
      ...it,
      // Resolve the strategy-specific label.
      shared: it.shared,
      cc: it.cc,
      csp: it.csp,
    }));

  const itemLabel = (it: ChecklistItem): string => {
    if (it.shared) return it.shared;
    if (strategy === "covered_call" && it.cc) return it.cc;
    if (strategy === "cash_secured_put" && it.csp) return it.csp;
    return it.cc || it.csp || it.shared || "";
  };

  const totalItems = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  const checkedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  );

  const offTopic = detectedStrategy === "other";

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="label">Trade checklist</div>
        <div className="text-[11px] muted">
          {checkedCount}/{totalItems} {saving ? " · saving…" : ""}
        </div>
      </div>

      {offTopic && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
          This checklist is tuned for short single-leg covered calls and
          cash-secured puts. Your trade looks like something else — items still
          render but apply your own judgment.
        </div>
      )}

      {view === "config" && <>
      {/* Strategy + market view — stacked so neither label/control is squished */}
      <div className="space-y-2">
        <label className="block">
          <span className="text-[10px] muted uppercase tracking-wider">Strategy</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-white/[0.02] px-2 py-1.5 text-sm"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
          >
            <option value="covered_call">Sell Covered Call</option>
            <option value="cash_secured_put">Sell Cash-Secured Put</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] muted uppercase tracking-wider">Market view</span>
          <div className="mt-1 grid grid-cols-3 gap-1 rounded-md border border-border bg-white/[0.02] p-1">
            {(["bull", "neutral", "bear"] as MarketView[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarket(m)}
                className={
                  "rounded px-2 py-1 text-xs capitalize transition " +
                  (marketView === m
                    ? "bg-accent/20 text-accent"
                    : "text-textDim hover:text-text")
                }
              >
                {m}
              </button>
            ))}
          </div>
        </label>
      </div>

      {/* Hints chip — delta range + coverage range for the chosen view */}
      <div className="grid grid-cols-1 gap-1 text-[11px] muted">
        <span>{DELTA_RANGE[strategy][marketView]}</span>
        <span>{COVERAGE_RANGE[strategy][marketView]}</span>
      </div>

      {/* Stop multiplier slider */}
      <div className="rounded-md border border-border bg-white/[0.02] p-2.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="muted uppercase tracking-wider">Stop multiplier</span>
          <span className="font-semibold">
            {stopMultiplier.toFixed(stopMultiplier % 1 === 0 ? 1 : 2)}x
          </span>
        </div>
        <input
          type="range"
          min={1.0}
          max={3.0}
          step={0.25}
          value={stopMultiplier}
          onChange={(e) => setMultiplier(parseFloat(e.target.value))}
          className="mt-2 w-full accent-current"
        />
        <div className="mt-1 flex justify-between text-[10px] muted">
          <span>1.0x</span>
          <span>1.5x</span>
          <span>2.0x</span>
          <span>2.5x</span>
          <span>3.0x</span>
        </div>
        <div className="mt-2 space-y-1 text-[14px] text-orange-400">
          <div>
            Stop trigger:{" "}
            <span className="font-semibold">
              {stopSpot != null ? `spot $${stopSpot.toFixed(2)}` : "—"}
            </span>
          </div>
          {(() => {
            const shortLeg = findShortLeg(trade);
            if (!shortLeg) return null;
            const contractStop = shortLeg.premium * stopMultiplier;
            if (!Number.isFinite(contractStop) || contractStop <= 0) return null;
            return (
              <div>
                BTC @{" "}
                <span className="font-semibold">${contractStop.toFixed(2)}</span>/contract
              </div>
            );
          })()}
          <div>
            {stopLoss != null && stopLoss >= 0 ? "Gain at stop:" : "Loss at stop:"}{" "}
            <span className="font-semibold">
              {stopLoss != null
                ? `${stopLoss < 0 ? "−" : "+"}$${Math.abs(stopLoss).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "—"}
            </span>
          </div>
        </div>
      </div>

      <ProfitMultiplierBox
        trade={trade}
        profitTargetSpot={profitTargetSpot ?? null}
        onProfitTargetSpotChange={onProfitTargetSpotChange}
      />
      </>}

      {view === "sections" && <>
      {/* Sections */}
      <div className="space-y-1">
        {SECTIONS.map((sec) => {
          const open = !!expanded[sec.id];
          const items = visibleItems(sec);
          const sectionChecked = items.filter((it) => checked[it.id]).length;
          return (
            <div
              key={sec.id}
              className="rounded-md border border-border bg-white/[0.02]"
            >
              <button
                type="button"
                onClick={() => toggleSection(sec.id)}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{sec.title}</div>
                  <div className="truncate text-[11px] muted">{sec.oneLiner}</div>
                </div>
                <div className="flex items-center gap-2 text-[11px] muted">
                  <span>
                    {sectionChecked}/{items.length}
                  </span>
                  <span aria-hidden>{open ? "▾" : "▸"}</span>
                </div>
              </button>
              {open && (
                <ul className="space-y-1 border-t border-border px-2.5 py-2">
                  {items.map((it) => {
                    const label = itemLabel(it);
                    return (
                      <li key={it.id} className="flex items-start gap-2 text-[12.5px]">
                        <input
                          type="checkbox"
                          checked={!!checked[it.id]}
                          onChange={(e) => setChk(it.id, e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-current"
                        />
                        <div className="min-w-0">
                          <span>{label}</span>
                          {it.hint && (
                            <span className="block text-[11px] muted">{it.hint}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={reset}
          className="text-[11px] muted hover:text-text"
        >
          Reset
        </button>
      </div>
      </>}
    </div>
  );
}

export const TradeChecklist = memo(TradeChecklistImpl);

const PROFIT_LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

function ProfitMultiplierBox({
  trade,
  profitTargetSpot,
  onProfitTargetSpotChange,
}: {
  trade: Trade;
  profitTargetSpot: number | null;
  onProfitTargetSpotChange?: (spot: number | null) => void;
}) {
  const shortLeg = useMemo(() => findShortLeg(trade), [trade]);
  const coveredCall = useMemo(() => isCoveredCallLike(trade), [trade]);

  const rows = useMemo(() => {
    if (!shortLeg) return [];
    const now = new Date();
    // For covered-call-like positions, the decay-based ladder is misleading
    // (decay requires the stock to drop, which sinks the share leg into a
    // net loss). Use a spot-target ladder pegged to % of max profit instead.
    if (coveredCall) {
      return computeCoveredProfitLadder(trade, PROFIT_LEVELS, now).map((r) => ({
        pct: r.pct,
        spot: r.spot,
        contractPrice: r.contractPrice,
        profit: r.profit,
        alreadyReached: false,
      }));
    }
    return PROFIT_LEVELS.map((pct) => {
      const r = computeProfitSpot({
        trade,
        shortLeg,
        profitFraction: pct / 100,
      });
      const profit = r.spot != null ? totalPnL(trade, r.spot, now) : null;
      return {
        pct,
        spot: r.spot,
        contractPrice: r.targetPrice,
        profit,
        alreadyReached: r.alreadyReached,
      };
    });
  }, [trade, shortLeg, coveredCall]);

  if (!shortLeg) return null;

  const headerHint = coveredCall
    ? "% of max profit at expiry — spot the stock would need to reach"
    : onProfitTargetSpotChange
      ? "click a row to mark it on the chart"
      : null;

  return (
    <div className="rounded-md border border-border bg-white/[0.02] p-2.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="muted uppercase tracking-wider">Profit-taking targets</span>
        {profitTargetSpot != null && onProfitTargetSpotChange && (
          <button
            type="button"
            onClick={() => onProfitTargetSpotChange(null)}
            className="text-[10px] muted hover:text-text"
          >
            Clear
          </button>
        )}
      </div>
      {headerHint && <div className="text-[10px] muted">{headerHint}</div>}
      <div className="mt-2 grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-x-2 text-[11px]">
        <div className="muted">%</div>
        <div className="muted">Spot</div>
        <div className="muted">BTC</div>
        <div className="muted text-right">Profit</div>
        {rows.map((r) => {
          const active =
            r.spot != null &&
            profitTargetSpot != null &&
            Math.abs(r.spot - profitTargetSpot) < 0.01;
          const clickable = !!(r.spot != null && onProfitTargetSpotChange);
          return (
            <button
              key={r.pct}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (!clickable) return;
                onProfitTargetSpotChange?.(active ? null : r.spot);
              }}
              className={`col-span-4 grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-x-2 rounded px-1 py-0.5 text-left transition ${
                active
                  ? "bg-emerald-500/15 ring-1 ring-emerald-400"
                  : clickable
                    ? "hover:bg-white/[0.04]"
                    : "opacity-60"
              }`}
            >
              <span className="font-semibold text-emerald-400">{r.pct}%</span>
              <span>
                {r.spot != null ? `$${r.spot.toFixed(2)}` : r.alreadyReached ? "now" : "—"}
              </span>
              <span>${r.contractPrice.toFixed(2)}</span>
              <span className="text-right font-semibold">
                {r.profit != null
                  ? `${r.profit >= 0 ? "+" : "−"}$${Math.abs(r.profit).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
