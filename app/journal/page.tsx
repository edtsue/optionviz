"use client";
import { useEffect, useMemo, useState } from "react";
import { detectStrategy } from "@/lib/strategies";
import type { DetectedStrategy, Trade } from "@/types/trade";

interface JournalAnalysis {
  headline?: string;
  patterns?: Array<{ title: string; evidence: string; impact: "high" | "medium" | "low" }>;
  tips?: Array<{ action: string; why: string }>;
  blindSpots?: string[];
}

interface ClosedTrade {
  id: string;
  sourceTradeId: string | null;
  symbol: string;
  outcome: "closed" | "canceled";
  // The snapshot is the full Trade payload, but the page only needs a few
  // fields for display. Type as Trade so detectStrategy() accepts it directly.
  tradeSnapshot: Trade;
  entryCredit: number | null;
  exitCredit: number | null;
  realizedPnL: number | null;
  realizedPnLPct: number | null;
  capitalAtRisk: number | null;
  notes: string | null;
  closedAt: string;
}

type OutcomeFilter = "all" | "closed" | "canceled";
type WinLossFilter = "all" | "wins" | "losses";
type DatePreset = "all" | "30d" | "90d" | "ytd" | "1y";
type ViewMode = "list" | "by-strategy";

interface Stats {
  count: number;
  totalPnL: number;
  winRate: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
}

function computeStats(items: ClosedTrade[]): Stats | null {
  const closed = items.filter((i) => i.outcome === "closed" && i.realizedPnL != null);
  if (closed.length === 0) return null;
  const totalPnL = closed.reduce((a, b) => a + (b.realizedPnL ?? 0), 0);
  const wins = closed.filter((i) => (i.realizedPnL ?? 0) > 0).length;
  const winRate = (wins / closed.length) * 100;
  const avgPnL = totalPnL / closed.length;
  const avgWin =
    wins > 0
      ? closed
          .filter((i) => (i.realizedPnL ?? 0) > 0)
          .reduce((a, b) => a + (b.realizedPnL ?? 0), 0) / wins
      : 0;
  const losses = closed.length - wins;
  const avgLoss =
    losses > 0
      ? closed
          .filter((i) => (i.realizedPnL ?? 0) <= 0)
          .reduce((a, b) => a + (b.realizedPnL ?? 0), 0) / losses
      : 0;
  return { count: closed.length, totalPnL, winRate, avgPnL, avgWin, avgLoss };
}

function startOfDatePreset(preset: DatePreset): number | null {
  const now = Date.now();
  switch (preset) {
    case "30d":
      return now - 30 * 86_400_000;
    case "90d":
      return now - 90 * 86_400_000;
    case "ytd": {
      const d = new Date();
      return new Date(d.getFullYear(), 0, 1).getTime();
    }
    case "1y":
      return now - 365 * 86_400_000;
    default:
      return null;
  }
}

export default function JournalPage() {
  const [items, setItems] = useState<ClosedTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter state.
  const [symbolQuery, setSymbolQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [winLossFilter, setWinLossFilter] = useState<WinLossFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [notesQuery, setNotesQuery] = useState("");
  const [view, setView] = useState<ViewMode>("list");

  useEffect(() => {
    fetch("/api/closed-trades", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: { items: ClosedTrade[] }) => setItems(d.items ?? []))
      .catch((e) => setError(typeof e === "string" ? e : "Failed to load journal"));
  }, []);

  // Apply all filters in one pass. Symbol matches as prefix (case-insensitive),
  // notes via full-text contains, win/loss only meaningful for outcome=closed.
  const filtered = useMemo<ClosedTrade[]>(() => {
    if (!items) return [];
    const sym = symbolQuery.trim().toUpperCase();
    const notes = notesQuery.trim().toLowerCase();
    const cutoff = startOfDatePreset(datePreset);
    return items.filter((it) => {
      if (sym && !it.symbol.toUpperCase().startsWith(sym)) return false;
      if (outcomeFilter !== "all" && it.outcome !== outcomeFilter) return false;
      if (winLossFilter !== "all") {
        if (it.outcome !== "closed" || it.realizedPnL == null) return false;
        const isWin = it.realizedPnL > 0;
        if (winLossFilter === "wins" && !isWin) return false;
        if (winLossFilter === "losses" && isWin) return false;
      }
      if (cutoff != null && new Date(it.closedAt).getTime() < cutoff) return false;
      if (notes) {
        const hay = (it.notes ?? "").toLowerCase();
        if (!hay.includes(notes)) return false;
      }
      return true;
    });
  }, [items, symbolQuery, outcomeFilter, winLossFilter, datePreset, notesQuery]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);

  // Claude pattern analysis. Runs on demand; result is cached against the
  // identity of the current filter slice so flipping filters doesn't re-cost
  // a Claude call until the user explicitly hits the button again.
  const [analysis, setAnalysis] = useState<JournalAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  async function runAnalysis() {
    if (analyzing || filtered.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const entries = filtered.map((it) => ({
        symbol: it.symbol,
        outcome: it.outcome,
        closedAt: it.closedAt,
        entryCredit: it.entryCredit,
        exitCredit: it.exitCredit,
        realizedPnL: it.realizedPnL,
        realizedPnLPct: it.realizedPnLPct,
        capitalAtRisk: it.capitalAtRisk,
        notes: it.notes,
        strategy: detectStrategy(it.tradeSnapshot).label,
        legs: it.tradeSnapshot.legs.map((l) => ({
          type: l.type,
          side: l.side,
          strike: l.strike,
          expiration: l.expiration,
          quantity: l.quantity,
          premium: l.premium,
        })),
      }));
      const scopeBits: string[] = [];
      if (symbolQuery) scopeBits.push(symbolQuery.toUpperCase());
      if (outcomeFilter !== "all") scopeBits.push(outcomeFilter);
      if (winLossFilter !== "all") scopeBits.push(winLossFilter);
      if (datePreset !== "all") scopeBits.push(datePreset);
      const scopeLabel = scopeBits.length ? scopeBits.join(" · ") : null;
      const res = await fetch("/api/journal/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, scopeLabel }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setAnalysis(j.analysis as JournalAnalysis);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // Per-strategy breakdown built off the filtered list. detectStrategy() is
  // pure and cheap to run per row. Sort by total realized so the top earner
  // (or biggest loser, depending) leads.
  const byStrategy = useMemo(() => {
    if (!filtered.length) return [];
    const groups = new Map<
      string,
      {
        strategy: DetectedStrategy;
        items: ClosedTrade[];
      }
    >();
    for (const it of filtered) {
      const strategy = detectStrategy(it.tradeSnapshot);
      const g = groups.get(strategy.name);
      if (g) g.items.push(it);
      else groups.set(strategy.name, { strategy, items: [it] });
    }
    return [...groups.values()]
      .map((g) => ({ ...g, stats: computeStats(g.items) }))
      .sort(
        (a, b) =>
          (b.stats?.totalPnL ?? -Infinity) - (a.stats?.totalPnL ?? -Infinity),
      );
  }, [filtered]);

  const hasFilters =
    !!symbolQuery ||
    !!notesQuery ||
    outcomeFilter !== "all" ||
    winLossFilter !== "all" ||
    datePreset !== "all";

  function clearFilters() {
    setSymbolQuery("");
    setNotesQuery("");
    setOutcomeFilter("all");
    setWinLossFilter("all");
    setDatePreset("all");
  }

  async function discard(id: string) {
    if (!confirm("Remove this journal entry? Stats won't include it anymore.")) return;
    const res = await fetch(`/api/closed-trades/${id}`, { method: "DELETE" });
    if (res.ok) setItems((cur) => (cur ? cur.filter((i) => i.id !== id) : cur));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm muted">Closed trades · realized P/L · what worked, what didn&rsquo;t</p>
      </div>

      {error && (
        <div className="card border-loss/40">
          <p className="text-sm loss">{error}</p>
        </div>
      )}

      {/* Filters strip. All filters live in client state; no API change needed
          since the route already returns the most recent 500 entries. */}
      {items && items.length > 0 && (
        <div className="card card-tight space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={symbolQuery}
              onChange={(e) => setSymbolQuery(e.target.value)}
              placeholder="Symbol (e.g. NVDA)"
              className="w-32 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-sm font-mono uppercase"
              autoCapitalize="characters"
            />
            <SegSelect<OutcomeFilter>
              value={outcomeFilter}
              onChange={setOutcomeFilter}
              options={[
                { v: "all", label: "All" },
                { v: "closed", label: "Closed" },
                { v: "canceled", label: "Canceled" },
              ]}
            />
            <SegSelect<WinLossFilter>
              value={winLossFilter}
              onChange={setWinLossFilter}
              options={[
                { v: "all", label: "Win/Loss" },
                { v: "wins", label: "Wins" },
                { v: "losses", label: "Losses" },
              ]}
            />
            <SegSelect<DatePreset>
              value={datePreset}
              onChange={setDatePreset}
              options={[
                { v: "all", label: "All-time" },
                { v: "30d", label: "30d" },
                { v: "90d", label: "90d" },
                { v: "ytd", label: "YTD" },
                { v: "1y", label: "1y" },
              ]}
            />
            <input
              type="text"
              value={notesQuery}
              onChange={(e) => setNotesQuery(e.target.value)}
              placeholder="Search notes…"
              className="min-w-0 flex-1 rounded-md border border-border bg-white/[0.02] px-2 py-1 text-sm"
            />
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="rounded-md border border-border px-2 py-1 text-xs muted hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <span className="text-[11px] muted">
              {filtered.length} of {items.length} entries
              {hasFilters ? " match" : ""}
            </span>
            <SegSelect<ViewMode>
              value={view}
              onChange={setView}
              options={[
                { v: "list", label: "List" },
                { v: "by-strategy", label: "By strategy" },
              ]}
            />
          </div>
        </div>
      )}

      {stats && (
        <div className="card card-tight">
          <div className="label mb-2">
            {hasFilters ? "Filtered: " : "Across "}
            {stats.count} closed trade{stats.count === 1 ? "" : "s"}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Total realized" value={fmtSigned(stats.totalPnL)} tone={stats.totalPnL >= 0 ? "gain" : "loss"} />
            <Stat label="Win rate" value={`${stats.winRate.toFixed(0)}%`} tone={stats.winRate >= 50 ? "gain" : "muted"} />
            <Stat label="Avg P/L" value={fmtSigned(stats.avgPnL)} tone={stats.avgPnL >= 0 ? "gain" : "loss"} />
            <Stat label="Avg win" value={`+$${stats.avgWin.toFixed(0)}`} tone="gain" />
            <Stat label="Avg loss" value={fmtSigned(stats.avgLoss)} tone="loss" />
          </div>
        </div>
      )}

      {stats && stats.count >= 3 && (
        <AnalysisPanel
          analysis={analysis}
          loading={analyzing}
          error={analyzeError}
          onRun={runAnalysis}
          entryCount={filtered.length}
        />
      )}

      {items === null && !error && <div className="text-sm muted">Loading…</div>}

      {items && items.length === 0 && (
        <div className="card text-center">
          <p className="muted">
            No closed trades yet. When you exit a position, click <strong>Close</strong> on the
            trade page to log it here.
          </p>
        </div>
      )}

      {items && items.length > 0 && filtered.length === 0 && (
        <div className="card text-center">
          <p className="muted">No entries match these filters.</p>
        </div>
      )}

      {view === "by-strategy" && byStrategy.length > 0 && (
        <div className="space-y-2">
          {byStrategy.map((g) => (
            <StrategyGroup key={g.strategy.name} strategy={g.strategy} stats={g.stats} entries={g.items} onDiscard={discard} />
          ))}
        </div>
      )}

      {view === "list" && (
        <div className="space-y-2">
          {filtered.map((it) => (
            <EntryCard key={it.id} entry={it} onDiscard={discard} />
          ))}
        </div>
      )}
    </div>
  );
}

function fmtSigned(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`;
}

function SegSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ v: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-white/[0.02] p-0.5">
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`rounded px-2 py-0.5 text-xs transition ${
              active ? "bg-accent/15 text-accent" : "muted hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StrategyGroup({
  strategy,
  stats,
  entries,
  onDiscard,
}: {
  strategy: DetectedStrategy;
  stats: Stats | null;
  entries: ClosedTrade[];
  onDiscard: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card card-tight">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline justify-between gap-3 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold">{strategy.label}</span>
          <span className="text-[11px] muted">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"} ·
            {stats ? ` ${stats.count} closed` : " no closed"}
          </span>
          <span className="text-[10px] muted">{open ? "▾" : "▸"}</span>
        </div>
        {stats && (
          <div className="flex items-baseline gap-3 text-xs tabular-nums">
            <span className={stats.totalPnL >= 0 ? "gain" : "loss"}>
              {fmtSigned(stats.totalPnL)} total
            </span>
            <span className={stats.winRate >= 50 ? "gain" : "muted"}>
              {stats.winRate.toFixed(0)}% win
            </span>
            <span className={stats.avgPnL >= 0 ? "gain" : "loss"}>
              avg {fmtSigned(stats.avgPnL)}
            </span>
          </div>
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {entries.map((it) => (
            <EntryCard key={it.id} entry={it} onDiscard={onDiscard} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  entry: it,
  onDiscard,
  compact = false,
}: {
  entry: ClosedTrade;
  onDiscard: (id: string) => void;
  compact?: boolean;
}) {
  const pnl = it.realizedPnL ?? 0;
  const tone =
    it.outcome === "canceled"
      ? "muted"
      : pnl > 0
        ? "gain"
        : pnl < 0
          ? "loss"
          : "muted";
  const legCount = it.tradeSnapshot.legs.length;
  return (
    <div
      className={
        compact
          ? "rounded-md border border-border bg-white/[0.02] px-3 py-2"
          : "card card-tight"
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold ${compact ? "text-sm" : "text-base"}`}>{it.symbol}</span>
          <span className="text-[11px] muted">
            {legCount} leg{legCount === 1 ? "" : "s"} · closed{" "}
            {new Date(it.closedAt).toLocaleDateString()}
          </span>
          {it.outcome === "canceled" && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] muted">
              canceled
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          {it.outcome === "closed" && it.realizedPnL != null && (
            <span className={`${compact ? "text-sm" : "text-base"} font-semibold tabular-nums ${tone}`}>
              {pnl >= 0 ? "+$" : "−$"}
              {Math.abs(pnl).toFixed(0)}
              {it.realizedPnLPct != null && (
                <span className="ml-1 text-[10px] opacity-80">
                  ({it.realizedPnLPct >= 0 ? "+" : ""}
                  {it.realizedPnLPct.toFixed(1)}%)
                </span>
              )}
            </span>
          )}
          <button
            onClick={() => onDiscard(it.id)}
            className="text-[11px] muted hover:text-loss"
            title="Remove this journal entry"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {it.tradeSnapshot.legs.map((l, i) => (
          <span
            key={i}
            className={`rounded-md border px-1.5 py-0.5 ${l.side === "long" ? "border-gain/40 gain" : "border-loss/40 loss"}`}
          >
            {l.side === "long" ? "+" : "−"}
            {l.quantity} {l.type === "call" ? "C" : "P"} {l.strike}{" "}
            {l.expiration.slice(5)}
          </span>
        ))}
      </div>
      {it.notes && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-text/90">{it.notes}</p>
      )}
    </div>
  );
}

function AnalysisPanel({
  analysis,
  loading,
  error,
  onRun,
  entryCount,
}: {
  analysis: JournalAnalysis | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  entryCount: number;
}) {
  return (
    <div className="card card-tight space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Pattern analysis</div>
          <div className="text-[11px] muted">
            Claude reads the {entryCount} entr{entryCount === 1 ? "y" : "ies"} above and surfaces
            what&rsquo;s recurring + what to change next time.
          </div>
        </div>
        <button
          onClick={onRun}
          disabled={loading || entryCount === 0}
          className="btn-primary rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {loading ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze patterns"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs loss">
          {error}
        </div>
      )}

      {analysis && !loading && (
        <div className="space-y-3 border-t border-border pt-3">
          {analysis.headline && (
            <p className="text-sm">{analysis.headline}</p>
          )}

          {analysis.patterns && analysis.patterns.length > 0 && (
            <div>
              <div className="label mb-1">Patterns</div>
              <ul className="space-y-1.5">
                {analysis.patterns.map((p, i) => (
                  <li key={i} className="text-xs">
                    <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
                      p.impact === "high"
                        ? "border border-loss/40 bg-loss/10 loss"
                        : p.impact === "medium"
                          ? "border border-amber-400/40 bg-amber-400/10 text-amber-300"
                          : "border border-border muted"
                    }`}>
                      {p.impact}
                    </span>
                    <span className="font-semibold">{p.title}.</span>{" "}
                    <span className="muted">{p.evidence}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.tips && analysis.tips.length > 0 && (
            <div>
              <div className="label mb-1">Tips for next time</div>
              <ul className="space-y-1.5">
                {analysis.tips.map((t, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-semibold gain">→ {t.action}</span>{" "}
                    <span className="muted">— {t.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.blindSpots && analysis.blindSpots.length > 0 && (
            <div>
              <div className="label mb-1">What the data can&rsquo;t tell</div>
              <ul className="space-y-1 text-[11px] muted">
                {analysis.blindSpots.map((b, i) => (
                  <li key={i}>· {b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "gain" | "loss" | "muted" }) {
  return (
    <div className="rounded-md border border-border bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
