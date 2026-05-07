"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { tradesClient } from "@/lib/trades-client";
import { fillImpliedVolsForTrade, netGreeks, totalPnL, tradeStats } from "@/lib/payoff";
import { detectStrategy } from "@/lib/strategies";
import { TradeAnalysis } from "@/components/TradeAnalysis";
import { TradeForm } from "@/components/TradeForm";
import { notifyTradesChanged } from "@/components/Sidebar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  const [spotStatus, setSpotStatus] = useState<{ updating: boolean; asOf?: string; error?: string }>({
    updating: false,
  });
  const [saveStatus, setSaveStatus] = useState<{ saving: boolean; saved?: boolean; error?: string }>({
    saving: false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [marketView, setMarketView] = useState<MarketView>("neutral");
  const strategy = useMemo(() => detectStrategy(trade), [trade]);
  const greeks = useMemo(() => netGreeks(trade), [trade]);
  const stats = useMemo(() => tradeStats(trade), [trade]);

  // Live unrealized P/L: re-price every option leg via Black-Scholes at the
  // current spot, plus mark-to-market on any underlying shares. Drives the
  // "Open P/L" caption under the orange spot price.
  const openPnl = useMemo(() => {
    const dollars = totalPnL(trade, trade.underlyingPrice, new Date());
    const cost = Math.abs(stats.cost);
    const pct = cost > 0 ? (dollars / cost) * 100 : 0;
    return { dollars, pct };
  }, [trade, stats.cost]);

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

  const onUpdateSpot = useCallback(async () => {
    setSpotStatus({ updating: true });
    try {
      const { price, asOf } = await tradesClient.fetchSpot(trade.symbol);
      const { trade: updated, stale } = await tradesClient.updateSpot(
        tradeId,
        price,
        trade.updatedAt,
      );
      setTrade(fillImpliedVolsForTrade(updated));
      setSpotStatus({
        updating: false,
        asOf,
        error: stale ? "Refreshed — another change happened first" : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "update failed";
      setSpotStatus({ updating: false, error: msg });
    }
  }, [trade.symbol, trade.updatedAt, tradeId]);

  // (Auto-spot + marketView-seed effects, plus the keyboard shortcut handler,
  // were removed while diagnosing a sidebar-navigation regression. The
  // checklist component still seeds marketView via its own callback, so the
  // bias caption catches up after a short delay; spot can be refreshed
  // manually via the Update spot button.)

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
            <span className="text-xs muted">· {VIEW_BIAS[marketView]} bias</span>
            {spotStatus.asOf && !spotStatus.error && (
              <span className="text-[10px] muted">updated {spotStatus.asOf}</span>
            )}
            {spotStatus.error && (
              <span className="text-[10px] loss">{spotStatus.error}</span>
            )}
          </div>
          <div className="mt-1 text-xs">
            <span className="text-[10px] muted uppercase tracking-wider">Open P/L</span>{" "}
            <span
              className={`font-semibold ${openPnl.dollars > 0 ? "text-emerald-400" : openPnl.dollars < 0 ? "text-rose-400" : "text-textDim"}`}
            >
              {openPnl.dollars >= 0 ? "+" : "−"}$
              {Math.abs(openPnl.dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {Number.isFinite(openPnl.pct) && stats.cost !== 0 && (
                <>
                  {" "}
                  ({openPnl.pct >= 0 ? "+" : "−"}
                  {Math.abs(openPnl.pct).toFixed(1)}%)
                </>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onUpdateSpot}
            disabled={spotStatus.updating}
            className="btn-ghost rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {spotStatus.updating ? "Updating…" : "Update spot"}
          </button>
          <button
            onClick={onSave}
            disabled={saveStatus.saving}
            className="btn-primary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {saveStatus.saving ? "Saving…" : saveStatus.saved ? "Saved ✓" : "Save"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn-danger rounded-lg px-3 py-1.5 text-sm"
          >
            Delete
          </button>
          {saveStatus.error && (
            <span className="text-[11px] loss" title={saveStatus.error}>
              save failed
            </span>
          )}
          <ConfirmDialog
            open={confirmDelete}
            title="Delete this trade?"
            body={`${trade.symbol} · ${trade.legs.length} leg${trade.legs.length === 1 ? "" : "s"}. This can't be undone.`}
            confirmLabel="Delete"
            destructive
            onConfirm={() => {
              setConfirmDelete(false);
              onDelete();
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      </header>

      <TradeAnalysis
        trade={trade}
        marketView={marketView}
        onMarketViewChange={setMarketView}
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
              <div className="text-[11px] muted">
                {l.expiration} · prem ${l.premium.toFixed(2)} · IV {((l.iv ?? 0) * 100).toFixed(1)}%
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

      <details className="card group">
        <summary className="cursor-pointer text-sm font-medium hover:text-text">
          Edit trade ▸
          <span className="ml-2 text-[11px] muted">
            fix a misread strike / expiration / premium and Save
          </span>
        </summary>
        <div className="mt-3">
          <TradeForm
            trade={trade}
            onChange={setTrade}
            onSave={async () => {}}
            hideSave
          />
        </div>
      </details>

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
