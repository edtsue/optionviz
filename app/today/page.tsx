"use client";
import { useEffect, useState } from "react";
import { tradesClient } from "@/lib/trades-client";
import { parseOptionSymbol } from "@/lib/parse-option-symbol";

interface NewsItem {
  headline: string;
  summary: string;
  impact: string;
  importance: "high" | "medium" | "low";
  source?: string | null;
  url?: string | null;
}
interface TickerNews {
  ticker: string;
  items: NewsItem[];
}
interface NewsResponse {
  items: TickerNews[];
  asOf?: string;
  fallback?: boolean;
}

// v2 — keyed by sorted-ticker-set so switching selections doesn't show stale
// news from a different basket. Each entry: { news, timestamp }.
const CACHE_KEY = "optionviz.today.v2";
const PORTFOLIO_KEY = "optionviz.portfolio.v1";
const SELECTED_KEY = "optionviz.today.selected";
const MANUAL_KEY = "optionviz.today.manual-tickers";
const MAX_SELECTED = 3;

function cacheKeyFor(tickers: string[]): string {
  return [...tickers].map((t) => t.toUpperCase()).sort().join(",");
}

function readCache(tickers: string[]): { news: NewsResponse; timestamp: number } | null {
  if (!tickers.length) return null;
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<
      string,
      { news: NewsResponse; timestamp: number }
    >;
    return all[cacheKeyFor(tickers)] ?? null;
  } catch {
    return null;
  }
}

function writeCache(tickers: string[], entry: { news: NewsResponse; timestamp: number }): void {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<
      string,
      { news: NewsResponse; timestamp: number }
    >;
    all[cacheKeyFor(tickers)] = entry;
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // ignore — cache is best-effort
  }
}

export default function TodayPage() {
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  useEffect(() => {
    let initialSel: string[] = [];
    try {
      const savedSel = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? "[]");
      if (Array.isArray(savedSel)) {
        initialSel = savedSel.slice(0, MAX_SELECTED);
        setSelected(initialSel);
      }
    } catch {
      // ignore
    }
    try {
      const saved = localStorage.getItem(MANUAL_KEY) ?? "";
      if (saved) setManualInput(saved);
    } catch {
      // ignore
    }
    const cached = readCache(initialSel);
    if (cached) {
      setNews(cached.news);
      setLastFetch(cached.timestamp);
    }

    async function gather() {
      const set = new Set<string>();
      try {
        const trades = await tradesClient.list();
        trades.forEach((t) => t.symbol && set.add(t.symbol.toUpperCase()));
      } catch {}
      // Pull holdings from cloud first (latest portfolio snapshot), fall back
      // to localStorage if the API call fails or there's no row yet. Today
      // chips show only stock/ETF underlyings — options become their
      // underlying ticker; cash and option-only positions are dropped.
      let holdings: Array<{ symbol?: string; name?: string | null; assetType?: string | null }> = [];
      try {
        const r = await fetch("/api/portfolio", { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          holdings = data.portfolio?.snapshot?.holdings ?? [];
        }
      } catch {}
      if (!holdings.length) {
        try {
          const raw = localStorage.getItem(PORTFOLIO_KEY);
          if (raw) holdings = JSON.parse(raw)?.snapshot?.holdings ?? [];
        } catch {}
      }
      for (const h of holdings) {
        if (!h.symbol) continue;
        const symU = h.symbol.toUpperCase();
        if (symU === "CASH" || h.assetType === "cash") continue;
        // Options: extract the underlying so the user gets news for the
        // stock the option is on. Stocks/ETFs: take the symbol directly.
        if (h.assetType === "option") {
          const parsed = parseOptionSymbol(h.symbol) ?? parseOptionSymbol(h.name ?? null);
          if (parsed?.underlying) set.add(parsed.underlying.toUpperCase());
          continue;
        }
        // For stock/etf/other: use the bare symbol if it's a clean ticker.
        // Reject anything with whitespace (broker option-format leakage like
        // "AAPL 04/26/2026 200 C" that wasn't tagged as an option).
        if (!/\s/.test(symU) && /^[A-Z][A-Z0-9.]{0,7}$/.test(symU)) {
          set.add(symU);
        } else {
          // Last-ditch: try parse-option-symbol, take underlying.
          const parsed = parseOptionSymbol(h.symbol) ?? parseOptionSymbol(h.name ?? null);
          if (parsed?.underlying) set.add(parsed.underlying.toUpperCase());
        }
      }
      setAvailable([...set].sort());
    }
    gather();
  }, []);

  const manualTickers = manualInput
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.]{1,6}$/.test(s));

  const allChips = Array.from(new Set([...available, ...manualTickers])).sort();

  function toggleSelected(ticker: string) {
    setSelected((cur) => {
      const isSel = cur.includes(ticker);
      let next: string[];
      if (isSel) {
        next = cur.filter((t) => t !== ticker);
      } else if (cur.length >= MAX_SELECTED) {
        next = [...cur.slice(1), ticker];
      } else {
        next = [...cur, ticker];
      }
      try {
        localStorage.setItem(SELECTED_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      // Swap displayed news to whatever's cached for the new selection (or
      // clear if nothing is cached) so users don't see stale results from a
      // different basket.
      const cached = readCache(next);
      setNews(cached?.news ?? null);
      setLastFetch(cached?.timestamp ?? null);
      return next;
    });
  }

  function clearSelected() {
    setSelected([]);
    setNews(null);
    setLastFetch(null);
    try {
      localStorage.setItem(SELECTED_KEY, "[]");
    } catch {
      // ignore
    }
  }

  function onManualChange(v: string) {
    setManualInput(v);
    try {
      localStorage.setItem(MANUAL_KEY, v);
    } catch {
      // ignore
    }
  }

  async function fetchNews() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: selected }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `News failed (${res.status})`);
      }
      const data = (await res.json()) as NewsResponse;
      setNews(data);
      const now = Date.now();
      setLastFetch(now);
      writeCache(selected, { news: data, timestamp: now });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const highCount =
    news?.items.reduce(
      (acc, t) => acc + t.items.filter((i) => i.importance === "high").length,
      0,
    ) ?? 0;
  const totalCount = news?.items.reduce((acc, t) => acc + t.items.length, 0) ?? 0;

  const atCap = selected.length >= MAX_SELECTED;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-xs muted">
            Pick up to {MAX_SELECTED} tickers — Claude returns the top 2 news items per ticker
          </p>
        </div>
        <button
          onClick={fetchNews}
          disabled={busy || selected.length === 0}
          className="btn-primary rounded-lg px-3 py-2 text-sm"
        >
          {busy
            ? "Searching…"
            : selected.length === 0
              ? "Pick tickers first"
              : `Get news for ${selected.length} ticker${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>

      <div className="card card-tight space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="label">
            Selected ({selected.length}/{MAX_SELECTED})
          </div>
          <div className="flex items-center gap-3">
            {selected.length > 0 && (
              <button
                onClick={clearSelected}
                className="text-[11px] muted hover:text-text"
              >
                Clear
              </button>
            )}
            {lastFetch && (
              <span className="text-[11px] muted">
                Last fetched {new Date(lastFetch).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((t) => (
              <button
                key={t}
                onClick={() => toggleSelected(t)}
                className="rounded-md border border-accent bg-accent/15 px-2 py-1 text-xs font-mono text-accent transition hover:bg-accent/25"
                title="Click to deselect"
              >
                {t} ✕
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs muted">
            Tap up to {MAX_SELECTED} tickers below to scrape news for them.
          </p>
        )}

        <div className="border-t border-border pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider muted">Available</span>
            <span className="text-[10px] muted">
              {atCap ? "Selecting another will replace the oldest" : "Click to select"}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allChips.length === 0 && (
              <span className="text-xs muted">
                None yet — type tickers below or save a trade / upload a portfolio
              </span>
            )}
            {allChips
              .filter((t) => !selected.includes(t))
              .map((t) => (
                <button
                  key={t}
                  onClick={() => toggleSelected(t)}
                  className="rounded-md border border-border bg-white/[0.02] px-2 py-1 text-xs font-mono transition hover:border-accent/60 hover:text-accent"
                >
                  {t}
                </button>
              ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 border-t border-border pt-3">
          <span className="text-[10px] uppercase tracking-wider muted">
            Add tickers manually (comma or space separated)
          </span>
          <input
            type="text"
            value={manualInput}
            onChange={(e) => onManualChange(e.target.value)}
            placeholder="e.g. NVDA AAPL TSLA"
            className="w-full rounded-md border border-border bg-white/[0.02] px-3 py-2 text-sm font-mono"
            autoCapitalize="characters"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm loss">
          <strong>Couldn&rsquo;t fetch news:</strong> {error}
        </div>
      )}

      {news && (
        <>
          {news.fallback && (
            <div className="rounded-lg border border-warn/30 bg-warn/[0.06] p-3 text-xs warn">
              ⚠ Web search isn&rsquo;t enabled on your Anthropic API key. Showing scheduled
              catalysts from training data instead. Enable the web_search tool at{" "}
              <a
                href="https://console.anthropic.com/settings/limits"
                target="_blank"
                rel="noopener"
                className="underline"
              >
                console.anthropic.com/settings/limits
              </a>
              .
            </div>
          )}
          <div className="card card-tight">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="kpi-sm">{totalCount}</span>
              <span className="text-xs muted">items across {news.items.length} tickers</span>
              {highCount > 0 && (
                <span className="ml-auto rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs warn">
                  {highCount} high-impact
                </span>
              )}
            </div>
          </div>

          {news.items.length === 0 && (
            <div className="card text-center text-sm muted">
              No relevant news on the selected tickers.
            </div>
          )}
          <div className="space-y-3">
            {news.items.map((tn) => (
              <TickerCard key={tn.ticker} ticker={tn} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TickerCard({ ticker: tn }: { ticker: TickerNews }) {
  const hasHigh = tn.items.some((i) => i.importance === "high");
  return (
    <div className={`card space-y-3 ${hasHigh ? "border-warn/40" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-semibold">
          {tn.ticker}
          {hasHigh && <span className="ml-2 text-xs warn">⚠ high-impact</span>}
        </span>
        <span className="text-xs muted">
          {tn.items.length} item{tn.items.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="space-y-3">
        {tn.items.map((it, i) => (
          <li
            key={i}
            className={`rounded-lg border p-3 ${
              it.importance === "high"
                ? "border-warn/50 bg-warn/[0.06]"
                : "border-border bg-white/[0.02]"
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">{it.headline}</span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                  it.importance === "high"
                    ? "bg-warn/20 warn"
                    : it.importance === "medium"
                      ? "border border-border muted"
                      : "muted"
                }`}
              >
                {it.importance}
              </span>
            </div>
            <p className="mt-1 text-xs">{it.summary}</p>
            <p className="mt-1 text-xs muted">
              <strong className="text-text">Why it matters:</strong> {it.impact}
            </p>
            {(it.source || it.url) && (
              <div className="mt-2 text-[11px] muted">
                {it.url ? (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener"
                    className="hover:text-accent"
                  >
                    {it.source ?? "source"} ↗
                  </a>
                ) : (
                  <span>{it.source}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
