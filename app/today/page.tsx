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

const CACHE_KEY = "optionviz.today.v1";
const PORTFOLIO_KEY = "optionviz.portfolio.v1";

export default function TodayPage() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
      if (cached?.news) setNews(cached.news);
      if (cached?.timestamp) setLastFetch(cached.timestamp);
    } catch {}

    async function gather() {
      const set = new Set<string>();
      try {
        const trades = await tradesClient.list();
        trades.forEach((t) => t.symbol && set.add(t.symbol.toUpperCase()));
      } catch {}
      try {
        const raw = localStorage.getItem(PORTFOLIO_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          const holdings = data?.snapshot?.holdings ?? [];
          for (const h of holdings) {
            if (!h.symbol) continue;
            const parsed =
              parseOptionSymbol(h.symbol) ?? parseOptionSymbol(h.name ?? null);
            const ticker = parsed?.underlying ?? h.symbol.split(/\s/)[0];
            if (ticker && ticker.toUpperCase() !== "CASH") {
              set.add(ticker.toUpperCase());
            }
          }
        }
      } catch {}
      setTickers([...set].sort());
    }
    gather();
  }, []);

  async function fetchNews() {
    if (tickers.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/today", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `News failed (${res.status})`);
      }
      const data = (await res.json()) as NewsResponse;
      setNews(data);
      const now = Date.now();
      setLastFetch(now);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ news: data, timestamp: now }));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const highCount = news?.items.reduce(
    (acc, t) => acc + t.items.filter((i) => i.importance === "high").length,
    0,
  ) ?? 0;
  const totalCount = news?.items.reduce((acc, t) => acc + t.items.length, 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-xs muted">
            News from the past 24 hours affecting your positions
          </p>
        </div>
        <button
          onClick={fetchNews}
          disabled={busy || tickers.length === 0}
          className="btn-primary rounded-lg px-3 py-2 text-sm"
        >
          {busy ? "Searching…" : news ? "Refresh news" : "Scrape today's news"}
        </button>
      </div>

      <div className="card card-tight space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="label">Tracking ({tickers.length})</div>
          {lastFetch && (
            <span className="text-[11px] muted">
              Last fetched {new Date(lastFetch).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tickers.length === 0 && (
            <span className="text-xs muted">
              No tickers found. Save a trade or upload a portfolio first.
            </span>
          )}
          {tickers.map((t) => (
            <span
              key={t}
              className="rounded-md border border-border bg-white/[0.02] px-2 py-1 text-xs font-mono"
            >
              {t}
            </span>
          ))}
        </div>
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
              ⚠ Web search isn&rsquo;t enabled on your Anthropic API key. Showing scheduled catalysts from training data instead. Enable the web_search tool at{" "}
              <a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noopener" className="underline">
                console.anthropic.com/settings/limits
              </a>{" "}
              for live news.
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
            <div className="card text-sm muted text-center">
              No relevant news on any of your tickers in the last 24 hours.
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
