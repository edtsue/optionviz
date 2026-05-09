"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { tradesClient } from "@/lib/trades-client";
import { currentPnL, fillImpliedVolsForTrade, netGreeks, tradeStats } from "@/lib/payoff";
import { detectStrategy } from "@/lib/strategies";
import { TradeAnalysis } from "@/components/TradeAnalysis";
import { notifyTradesChanged } from "@/components/Sidebar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CloseTradeDialog } from "@/components/CloseTradeDialog";
import { useRegisterChatContext } from "@/lib/chat-context";
import type { Trade } from "@/types/trade";

function TicketImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ticket-image?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          if (j.url) setUrl(j.url);
          else setErr(true);
        }
      })
      .catch(() => !cancelled && setErr(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (err) return null;
  if (!url) return <div className="h-8 text-xs muted">Loading ticket image…</div>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Original ticket screenshot"
      className="max-h-96 rounded-lg border border-border object-contain"
    />
  );
}

export default function TradePage() {
  const params = useParams<{ id: string }>();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tradesClient
      .get(params.id)
      .then((t) => {
        if (cancelled) return;
        if (!t) setNotFound(true);
        else setTrade(fillImpliedVolsForTrade(t));
      })
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (notFound) {
    return (
      <div className="p-6">
        <div className="card mx-auto max-w-md text-center">
          <p>Trade not found.</p>
          <Link href="/" className="btn-primary mt-3 inline-block rounded-lg px-3 py-2 text-sm">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  if (!trade) return <div className="p-6 text-sm muted">Loading…</div>;

  return <TradeView trade={trade} tradeId={params.id} />;
}

type MarketView = "bull" | "neutral" | "bear";

const VIEW_BIAS: Record<MarketView, string> = {
  bull: "bullish",
  neutral: "neutral",
  bear: "bearish",
};

function TradeView({ trade: initialTrade, tradeId }: { trade: Trade; tradeId: string }) {
  const router = useRouter();
  const [trade, setTrade] = useState<Trade>(initialTrade);
  // The price persisted in the DB. Distinct from trade.underlyingPrice, which
  // the live-spot poll mutates in memory every 15s — without tracking the DB
  // value separately, the manual "Update spot" button looks dead because the
  // visible price was already updated by the poll.
  const [savedSpot, setSavedSpot] = useState<number>(initialTrade.underlyingPrice);
  const [spotStatus, setSpotStatus] = useState<{
    updating: boolean;
    asOf?: string;
    error?: string;
    justSaved?: boolean;
  }>({
    updating: false,
  });
  // Auto-refreshing in-memory spot. Polls /api/spot every 15s while the tab is
  // visible (Yahoo only — claudeFallback:false so a Yahoo outage doesn't burn
  // Claude tokens). Updates the trade's underlyingPrice in memory only;
  // persisting still requires the manual "Update spot" button.
  const [liveSpot, setLiveSpot] = useState<{
    price: number;
    asOf: string;
    source: string | null;
    fetchedAt: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const POLL_MS = 15_000;

    async function tick() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await tradesClient.fetchSpot(initialTrade.symbol, { claudeFallback: false });
        if (cancelled) return;
        setLiveSpot({ ...res, fetchedAt: Date.now() });
        setTrade((prev) =>
          Math.abs(prev.underlyingPrice - res.price) < 0.005
            ? prev
            : fillImpliedVolsForTrade({ ...prev, underlyingPrice: res.price }),
        );
      } catch {
        // swallow — manual button surfaces errors. Auto-poll stays quiet.
      }
    }

    tick();
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialTrade.symbol]);
  const [saveStatus, setSaveStatus] = useState<{ saving: boolean; saved?: boolean; error?: string }>({
    saving: false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [marketView, setMarketView] = useState<MarketView>("neutral");
  const [checklistOpen, setChecklistOpen] = useState(false);

  // Realized-vol IV-rank from /api/iv-rank. Free Yahoo data, server-cached
  // 30 min, no Claude. Fetched once per symbol.
  const [ivRank, setIvRank] = useState<{
    currentVol: number;
    percentile: number;
    low: number;
    high: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/iv-rank/${encodeURIComponent(initialTrade.symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j && setIvRank(j))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialTrade.symbol]);

  // Next earnings / ex-dividend from /api/calendar. Free Yahoo, cached 1h.
  const [calendar, setCalendar] = useState<{ earnings: string | null; dividend: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calendar/${encodeURIComponent(initialTrade.symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && j && setCalendar(j))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialTrade.symbol]);

  // Persist drawer open/closed across reloads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("optionviz.checklist-drawer");
      if (raw === "1") setChecklistOpen(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("optionviz.checklist-drawer", checklistOpen ? "1" : "0");
    } catch {}
  }, [checklistOpen]);
  const strategy = useMemo(() => detectStrategy(trade), [trade]);
  const greeks = useMemo(() => netGreeks(trade), [trade]);
  const stats = useMemo(() => tradeStats(trade), [trade]);
  const pnl = useMemo(() => currentPnL(trade, trade.underlyingPrice), [trade]);

  const chatLabel = `Trade: ${trade.symbol} ${strategy.label}`;
  const chatData = useMemo(
    () => ({
      symbol: trade.symbol,
      underlyingPrice: trade.underlyingPrice,
      strategy: strategy.label,
      bias: VIEW_BIAS[marketView],
      legs: trade.legs.map((l) => ({
        side: l.side,
        type: l.type,
        strike: l.strike,
        expiration: l.expiration,
        qty: l.quantity,
        premium: l.premium,
        iv: l.iv,
      })),
      underlying: trade.underlying,
      netGreeks: {
        delta: +greeks.delta.toFixed(2),
        gamma: +greeks.gamma.toFixed(4),
        theta: +greeks.theta.toFixed(2),
        vega: +greeks.vega.toFixed(2),
      },
      stats: {
        maxProfit: stats.maxProfit,
        maxLoss: stats.maxLoss,
        breakevens: stats.breakevens,
        cost: stats.cost,
        pop: stats.pop,
      },
    }),
    [trade, strategy, marketView, greeks, stats],
  );
  useRegisterChatContext(chatLabel, chatData);

  async function onDelete() {
    await tradesClient.remove(tradeId);
    notifyTradesChanged();
    router.push("/");
  }

  // Close = log a journal row, then remove the live row.
  async function onClose(input: {
    exitCredit: number;
    notes: string | null;
    entryCredit: number;
    realizedPnL: number;
    realizedPnLPct: number | null;
    capitalAtRisk: number;
  }) {
    setCloseOpen(false);
    try {
      const res = await fetch("/api/closed-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTradeId: tradeId,
          outcome: "closed",
          trade,
          entryCredit: input.entryCredit,
          exitCredit: input.exitCredit,
          realizedPnL: input.realizedPnL,
          realizedPnLPct: input.realizedPnLPct,
          capitalAtRisk: input.capitalAtRisk,
          notes: input.notes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Close failed (HTTP ${res.status})`);
      }
      // Only delete the live trade row after the journal row is safely
      // persisted — otherwise a transient cloud error would lose the trade.
      await tradesClient.remove(tradeId);
      notifyTradesChanged();
      router.push("/journal");
    } catch (e) {
      setSaveStatus({ saving: false, error: e instanceof Error ? e.message : "Close failed" });
    }
  }

  async function onSave() {
    setSaveStatus({ saving: true });
    try {
      const updated = await tradesClient.update(tradeId, trade);
      setTrade(fillImpliedVolsForTrade(updated));
      notifyTradesChanged();
      setSaveStatus({ saving: false, saved: true });
      // Clear the "Saved ✓" pip after a couple seconds so the button returns
      // to its idle label.
      setTimeout(() => setSaveStatus((s) => (s.saved ? { saving: false } : s)), 2000);
    } catch (e) {
      setSaveStatus({ saving: false, error: e instanceof Error ? e.message : "Save failed" });
    }
  }

  async function onUpdateSpot() {
    const prevSaved = savedSpot;
    setSpotStatus({ updating: true });
    try {
      const { price, asOf, source } = await tradesClient.fetchSpot(trade.symbol);
      const { trade: updated, stale } = await tradesClient.updateSpot(
        tradeId,
        price,
        trade.updatedAt,
      );
      setTrade(fillImpliedVolsForTrade(updated));
      setSavedSpot(price);
      const sameAsSaved = Math.abs(price - prevSaved) < 0.005;
      const srcSuffix = source ? ` · ${source}` : "";
      setSpotStatus({
        updating: false,
        justSaved: true,
        asOf: sameAsSaved
          ? `${asOf}${srcSuffix} · saved $${price.toFixed(2)} (unchanged)`
          : `${asOf}${srcSuffix} · $${prevSaved.toFixed(2)} → $${price.toFixed(2)}`,
        error: stale ? "Refreshed — another change happened first" : undefined,
      });
      // Drop the "✓ Saved" pip after 2s; the asOf text stays as the durable
      // record of the last save.
      setTimeout(
        () => setSpotStatus((s) => (s.justSaved ? { ...s, justSaved: false } : s)),
        2000,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "update failed";
      setSpotStatus({ updating: false, error: msg });
    }
  }

  return (
    <div className="space-y-4 pl-3 pr-4 py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {trade.symbol} <span className="muted">· {strategy.label}</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[11px] muted uppercase tracking-wider">Underlying</span>
            <span className="text-3xl font-bold leading-none text-orange-400">
              ${trade.underlyingPrice.toFixed(2)}
            </span>
            <span
              className={`rounded-md border px-2 py-1 text-sm font-semibold tabular-nums ${
                pnl.dollar > 0.5
                  ? "border-gain/40 bg-gain/10 gain"
                  : pnl.dollar < -0.5
                    ? "border-loss/40 bg-loss/10 loss"
                    : "border-border bg-white/[0.02] muted"
              }`}
              title="Open P/L vs entry — option legs marked-to-market today via Black-Scholes plus any underlying shares P/L"
            >
              {pnl.dollar >= 0 ? "+$" : "−$"}
              {Math.abs(pnl.dollar).toFixed(0)}
              {pnl.percent != null && (
                <span className="ml-1 text-[11px] opacity-80">
                  ({pnl.percent >= 0 ? "+" : ""}
                  {pnl.percent.toFixed(1)}%)
                </span>
              )}
            </span>
            <span className="text-xs muted">· {VIEW_BIAS[marketView]} bias</span>
            {liveSpot && (() => {
              // Use Yahoo's market timestamp (asOf), not the client clock.
              // On a Saturday the regular session asOf is Friday 4 PM ET;
              // labeling that "live · now" was misleading. The source string
              // already encodes regular vs. extended vs. last-close.
              const asOfDate = new Date(liveSpot.asOf);
              const ageMs = Date.now() - asOfDate.getTime();
              const isStale =
                ageMs > 5 * 60 * 1000 ||
                /last close|after-hours|pre-market/i.test(liveSpot.source ?? "");
              const isClosed = /last close/i.test(liveSpot.source ?? "");
              const dotClass = isClosed
                ? "bg-zinc-400"
                : isStale
                  ? "bg-amber-400"
                  : "bg-green-500";
              const verb = isClosed ? "close" : isStale ? "delayed" : "live";
              const stamp = isClosed
                ? asOfDate.toLocaleString(undefined, {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : asOfDate.toLocaleTimeString();
              return (
                <span className="text-[10px] muted">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full align-middle ${dotClass}`} />{" "}
                  {verb} · {stamp}
                  {liveSpot.source ? ` · ${liveSpot.source}` : ""}
                </span>
              );
            })()}
            {Math.abs(trade.underlyingPrice - savedSpot) >= 0.005 && (
              <span
                className="rounded-md border border-orange-500/40 px-1.5 py-0.5 text-[10px] text-orange-300"
                title="The live price differs from what's saved in the database. Tap Update spot to persist it."
              >
                unsaved · live ${trade.underlyingPrice.toFixed(2)} vs saved ${savedSpot.toFixed(2)}
              </span>
            )}
            {ivRank && (
              <span
                className="rounded-md border border-border bg-white/[0.02] px-1.5 py-0.5 text-[10px] muted"
                title={`30-day realized vol now ${(ivRank.currentVol * 100).toFixed(1)}% — 1y range ${(ivRank.low * 100).toFixed(0)}–${(ivRank.high * 100).toFixed(0)}%`}
              >
                RV {(ivRank.currentVol * 100).toFixed(0)}% · {ivRank.percentile}th pct
              </span>
            )}
            {spotStatus.asOf && !spotStatus.error && (
              <span className="text-[10px] muted">saved {spotStatus.asOf}</span>
            )}
            {spotStatus.error && (
              <span className="text-[10px] loss">{spotStatus.error}</span>
            )}
            {calendar && (calendar.earnings || calendar.dividend) && (() => {
              const earliestExpiry = trade.legs.length
                ? new Date(
                    Math.min(...trade.legs.map((l) => new Date(l.expiration).getTime())),
                  )
                : null;
              const today = new Date();
              const chips: React.ReactNode[] = [];
              const days = (iso: string) =>
                Math.round((new Date(iso).getTime() - today.getTime()) / 86_400_000);
              if (calendar.earnings) {
                const d = days(calendar.earnings);
                if (d >= -1) {
                  const beforeExpiry =
                    earliestExpiry && new Date(calendar.earnings) < earliestExpiry;
                  chips.push(
                    <span
                      key="earn"
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] ${beforeExpiry ? "border-orange-500/50 text-orange-300" : "border-border muted"}`}
                      title={beforeExpiry ? "Earnings falls inside the trade window" : "Earnings is after expiry"}
                    >
                      Earnings {calendar.earnings} ({d}d){beforeExpiry ? " ⚡" : ""}
                    </span>,
                  );
                }
              }
              if (calendar.dividend) {
                const d = days(calendar.dividend);
                if (d >= -1) {
                  chips.push(
                    <span
                      key="div"
                      className="rounded-md border border-border px-1.5 py-0.5 text-[10px] muted"
                      title="Ex-dividend date — early-exercise risk for short ITM calls right before this"
                    >
                      Ex-div {calendar.dividend} ({d}d)
                    </span>,
                  );
                }
              }
              return chips;
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChecklistOpen((v) => !v)}
            className="btn-ghost rounded-lg px-3 py-1.5 text-sm"
            aria-expanded={checklistOpen}
            aria-label="Open checklist"
          >
            ☰ Checklist
          </button>
          <button
            onClick={onUpdateSpot}
            disabled={spotStatus.updating}
            className="btn-ghost rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {spotStatus.updating
              ? "Updating…"
              : spotStatus.justSaved
                ? `✓ Saved $${savedSpot.toFixed(2)}`
                : "Update spot"}
          </button>
          <button
            onClick={onSave}
            disabled={saveStatus.saving}
            className="btn-primary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {saveStatus.saving ? "Saving…" : saveStatus.saved ? "Saved ✓" : "Save"}
          </button>
          <button
            onClick={() => setCloseOpen(true)}
            className="btn-ghost rounded-lg px-3 py-1.5 text-sm"
            title="Log realized P/L to the journal and remove the live position"
          >
            Close
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn-danger rounded-lg px-3 py-1.5 text-sm"
            title="Discard without journaling — for parse errors or canceled orders"
          >
            Discard
          </button>
          {saveStatus.error && (
            <span className="text-[11px] loss" title={saveStatus.error}>
              {saveStatus.error.toLowerCase().includes("close") ? "close failed" : "save failed"}
            </span>
          )}
          <CloseTradeDialog
            open={closeOpen}
            trade={trade}
            onCancel={() => setCloseOpen(false)}
            onConfirm={onClose}
          />
          <ConfirmDialog
            open={confirmDelete}
            title="Discard this trade?"
            body={`${trade.symbol} · ${trade.legs.length} leg${trade.legs.length === 1 ? "" : "s"}. No journal entry will be logged. Use Close above if this position was actually held.`}
            confirmLabel="Discard"
            destructive
            onConfirm={() => {
              setConfirmDelete(false);
              onDelete();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </header>

      <DteBanner trade={trade} theta={greeks.theta} />

      <TradeAnalysis
        trade={trade}
        marketView={marketView}
        onMarketViewChange={setMarketView}
        checklistOpen={checklistOpen}
        onChecklistOpenChange={setChecklistOpen}
      />

      <div className="card card-tight">
        <div className="label mb-2">Legs</div>
        <div className="grid gap-1.5 text-sm data-grid">
          {trade.legs.map((l, i) => (
            <div
              key={l.id ?? `${l.type}-${l.side}-${l.strike}-${l.expiration}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-white/[0.02] px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    l.side === "long" ? "border border-gain/40 gain" : "border border-loss/40 loss"
                  }`}
                >
                  {l.side === "long" ? "LONG" : "SHORT"}
                </span>
                <span className="kpi-xs">
                  {l.quantity}× {l.type === "call" ? "C" : "P"} ${l.strike}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] muted">
                <span>
                  {l.expiration} · prem ${l.premium.toFixed(2)} · IV {((l.iv ?? 0) * 100).toFixed(1)}%
                </span>
                {l.ivUnsolved && (
                  <span
                    className="rounded-md border border-orange-500/50 px-1.5 py-0.5 text-[10px] text-orange-300"
                    title="Couldn't solve implied vol from the entered premium — Greeks for this leg are using a 0.3 fallback. Verify the premium."
                  >
                    IV unsolved
                  </span>
                )}
              </div>
            </div>
          ))}
          {trade.underlying && (
            <div className="flex items-center justify-between rounded-md border border-border bg-white/[0.02] px-2 py-1.5 text-sm">
              <span className="kpi-xs">
                <span className="gain">LONG</span> {trade.underlying.shares} shares @ $
                {trade.underlying.costBasis.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {trade.notes && (
        <div className="card card-tight">
          <div className="label mb-1">Notes</div>
          <p className="text-sm whitespace-pre-wrap">{trade.notes}</p>
        </div>
      )}

      {trade.ticketImagePath && (
        <div className="card card-tight">
          <div className="label mb-2">Ticket screenshot</div>
          <TicketImage path={trade.ticketImagePath} />
        </div>
      )}
    </div>
  );
}

function tradingDaysBetween(a: Date, b: Date): number {
  // Inclusive count of weekdays between a and b. Doesn't honor US holidays —
  // close enough for "do I have a roll window" decisions.
  const start = a < b ? a : b;
  const end = a < b ? b : a;
  let n = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (d <= stop) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

function DteBanner({ trade, theta }: { trade: Trade; theta: number }) {
  if (!trade.legs.length) return null;
  const now = new Date();
  // Soonest expiry drives the banner — that leg's theta accelerates first
  // and forces the next decision (close, roll, or assignment).
  const earliestMs = Math.min(...trade.legs.map((l) => new Date(l.expiration).getTime()));
  const earliest = new Date(earliestMs);
  const dte = Math.max(0, Math.ceil((earliestMs - now.getTime()) / 86_400_000));
  const tradingDte = tradingDaysBetween(now, earliest);

  // Color/severity bands. Theta acceleration becomes pronounced inside ~30
  // days and brutal inside ~14.
  const tone =
    dte === 0
      ? "border-loss/40 bg-loss/10 loss"
      : dte <= 7
        ? "border-orange-500/50 bg-orange-500/10 text-orange-300"
        : dte <= 21
          ? "border-warn/40 bg-warn/10 warn"
          : "border-border bg-white/[0.02] muted";

  const accel =
    dte === 0
      ? "expiring today"
      : dte <= 7
        ? "final-week decay"
        : dte <= 21
          ? "accelerating"
          : "low decay";

  // Theta is dollars per day on the position (sign included — short premium
  // gives positive theta). Show absolute value with a sign tag for clarity.
  const thetaSign = theta >= 0 ? "+" : "−";
  const thetaAbs = Math.abs(theta);

  return (
    <div className={`card card-tight flex flex-wrap items-baseline gap-x-4 gap-y-1 ${tone}`}>
      <span className="text-base font-semibold">⏱ {dte}d to expiry</span>
      <span className="text-xs">· {tradingDte} trading day{tradingDte === 1 ? "" : "s"}</span>
      <span className="text-xs tabular-nums">
        · θ {thetaSign}${thetaAbs.toFixed(0)}/day
      </span>
      <span className="text-xs">· {accel}</span>
      <span className="ml-auto text-[10px] muted">
        soonest leg: {earliest.toISOString().slice(0, 10)}
      </span>
    </div>
  );
}
