"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { tradesClient } from "@/lib/trades-client";
import { detectStrategy, tradeMoneyness, type Moneyness } from "@/lib/strategies";
import { usePortfolioShares, externalSharesFor } from "@/lib/use-portfolio-shares";
import { SettingsButton } from "./SettingsPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import type { DetectedStrategy, Trade } from "@/types/trade";

const TRADES_CHANGED_EVENT = "optionviz:trades-changed";

// How often to background-resync from the latest portfolio snapshot while
// the tab is visible. Each resync calls one server function that hits Yahoo
// for each unique symbol, so we don't poll too aggressively.
const RESYNC_POLL_MS = 2 * 60 * 1000;
// Don't immediately re-fire on every visibilitychange — bound consecutive
// resyncs to this minimum gap.
const RESYNC_MIN_GAP_MS = 30 * 1000;

export function notifyTradesChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TRADES_CHANGED_EVENT));
  }
}

// Single in-flight tracker so simultaneous triggers (mount + visibility) don't
// double-fire. The sync route is idempotent anyway, but we save the round-trip.
let resyncInFlight: Promise<void> | null = null;
let lastResyncAt = 0;

async function resyncFromPortfolio(force = false): Promise<void> {
  if (resyncInFlight) return resyncInFlight;
  if (!force && Date.now() - lastResyncAt < RESYNC_MIN_GAP_MS) return;
  lastResyncAt = Date.now();
  resyncInFlight = (async () => {
    try {
      const res = await fetch("/api/portfolio/resync", { method: "POST" });
      if (!res.ok) return;
      const j = await res.json().catch(() => null);
      // Only notify when the sync actually changed something — keeps the
      // /api/trades refetch off the no-op path.
      const s = j?.sync as
        | { created?: number; updated?: number; deleted?: number; promoted?: number }
        | null;
      if (s && (s.created || s.updated || s.deleted || s.promoted)) notifyTradesChanged();
    } catch {
      // background sync — never bubbles to the user
    } finally {
      resyncInFlight = null;
    }
  })();
  return resyncInFlight;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Trade | null>(null);
  const [deleting, setDeleting] = useState(false);
  const portfolioShares = usePortfolioShares();

  useEffect(() => {
    let cancelled = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    function load() {
      tradesClient
        .list()
        .then((t) => !cancelled && setTrades(t))
        .catch(() => !cancelled && setTrades([]));
    }
    // Spot updates on the trade detail page dispatch this same event, so a
    // burst of spot polls used to trigger a fresh /api/trades refetch each
    // time. Debounce so we coalesce bursts into a single reload.
    function scheduleLoad() {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        load();
      }, 200);
    }
    load();
    // Keep the sidebar's view of trades aligned with the broker portfolio:
    //   - resync immediately on mount (first time the layout boots)
    //   - poll every RESYNC_POLL_MS while the tab is visible
    //   - resync when the tab comes back into focus (catches "uploaded from
    //     another tab" / "switched away for an hour")
    // Each resync is throttled by RESYNC_MIN_GAP_MS so visibility + poll
    // can't double-fire.
    resyncFromPortfolio(true);
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    function startPolling() {
      if (pollTimer != null) return;
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") resyncFromPortfolio();
      }, RESYNC_POLL_MS);
    }
    function stopPolling() {
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        resyncFromPortfolio();
        startPolling();
      } else {
        stopPolling();
      }
    }
    if (document.visibilityState === "visible") startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(TRADES_CHANGED_EVENT, scheduleLoad);
    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(TRADES_CHANGED_EVENT, scheduleLoad);
    };
  }, []);

  const enriched = useMemo<
    Array<{ trade: Trade; strategy: DetectedStrategy; moneyness: Moneyness }>
  >(
    () =>
      (trades ?? []).map((t) => ({
        trade: t,
        strategy: detectStrategy(t, {
          externalShares: externalSharesFor(portfolioShares, t.symbol),
        }),
        moneyness: tradeMoneyness(t),
      })),
    [trades, portfolioShares],
  );

  const activeTradeId = pathname?.startsWith("/trade/") && !pathname.endsWith("/new")
    ? pathname.split("/")[2]
    : null;

  async function confirmDelete() {
    if (!pendingDelete?.id) return;
    const id = pendingDelete.id;
    setDeleting(true);
    try {
      await tradesClient.remove(id);
      setTrades((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
      setPendingDelete(null);
      if (activeTradeId === id) router.push("/");
      notifyTradesChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="flex h-full w-full min-w-0 flex-col gap-2 pl-2 pr-1.5 py-2.5">
      <div className="flex items-center justify-between px-1">
        <Link href="/" onClick={onNavigate} className="flex items-baseline gap-1">
          <span className="text-base font-semibold tracking-tight">Option</span>
          <span className="text-base font-semibold tracking-tight text-accent">Viz</span>
        </Link>
      </div>

      <nav className="flex flex-col gap-0.5">
        <NavLink
          href="/"
          label="Trade"
          dot="#a3e635"
          active={pathname === "/" || !!pathname?.startsWith("/trade/")}
          onNav={onNavigate}
        />
        <NavLink
          href="/portfolio"
          label="Portfolio"
          dot="#22d3ee"
          active={pathname === "/portfolio"}
          onNav={onNavigate}
        />
        <NavLink
          href="/today"
          label="Today"
          dot="#f59e0b"
          active={pathname === "/today"}
          onNav={onNavigate}
        />
        <NavLink
          href="/journal"
          label="Journal"
          dot="#c084fc"
          active={pathname === "/journal"}
          onNav={onNavigate}
        />
      </nav>

      <button
        onClick={() => {
          router.push("/trade/new");
          onNavigate?.();
        }}
        className="btn-primary w-full rounded-lg px-3 py-1.5 text-sm"
      >
        + New trade
      </button>

      <div className="mt-1 flex items-center justify-between px-1">
        <div className="label">Saved trades</div>
        {trades && <span className="text-xs muted">{trades.length}</span>}
      </div>

      <div className="scroll-soft -mx-1 flex-1 overflow-y-auto pr-1">
        {trades === null && <div className="px-3 text-xs muted">Loading…</div>}
        {trades?.length === 0 && <div className="px-3 text-xs muted">No trades yet</div>}
        <ul className="flex flex-col gap-0.5">
          {enriched.map(({ trade: t, strategy: strat, moneyness }) => {
            const active = t.id === activeTradeId;
            const isPortfolio = t.source === "portfolio";
            const moneynessClass =
              moneyness === "ITM"
                ? "text-red-400"
                : moneyness === "ATM"
                  ? "text-yellow-300"
                  : "text-emerald-400";
            const moneynessTitle =
              moneyness === "ITM"
                ? "In the money — at least one leg's strike has been crossed"
                : moneyness === "ATM"
                  ? "At the money — at least one strike is within 1.5% of spot"
                  : "Out of the money — all strikes are clear of spot";
            return (
              <li key={t.id} className="group relative">
                <Link
                  href={`/trade/${t.id}`}
                  onClick={onNavigate}
                  className={`side-row ${active ? "active" : ""} ${
                    isPortfolio ? "" : "side-row--wip"
                  }`}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-sm font-semibold ${moneynessClass}`}
                        title={moneynessTitle}
                      >
                        {t.symbol}
                      </span>
                      {isPortfolio ? (
                        <span
                          className="rounded border border-green-500/40 bg-green-500/10 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-green-400"
                          title="Position is in your latest broker portfolio upload — auto-synced and refreshed on each upload."
                        >
                          live
                        </span>
                      ) : (
                        <span
                          className="rounded border border-amber-400/40 bg-amber-400/10 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-amber-300"
                          title="Manual / aspirational trade — not in your latest portfolio upload."
                        >
                          WIP
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] muted">{strat.label}</span>
                  </div>
                  <div className="text-right pr-5">
                    <div className="kpi-xs">${t.underlyingPrice.toFixed(2)}</div>
                    <div className="text-[10px] muted">
                      {t.legs.length}L
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete ${t.symbol} trade`}
                  title="Delete trade"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setPendingDelete(t);
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-textDim opacity-0 transition hover:bg-white/10 hover:text-red-400 focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 group-hover:opacity-100"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-border pt-2">
        <SettingsButton />
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.symbol} trade?` : "Delete trade?"}
        body="This permanently removes the trade and its checklist. This can't be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </aside>
  );
}

function NavLink({
  href,
  label,
  active,
  dot,
  onNav,
}: {
  href: string;
  label: string;
  active: boolean;
  dot: string;
  onNav?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNav}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
        active ? "bg-white/[0.06] text-white" : "text-textDim hover:bg-white/[0.03] hover:text-white"
      }`}
      style={active ? { boxShadow: `inset 0 0 0 1px ${dot}55` } : undefined}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: dot, boxShadow: active ? `0 0 8px ${dot}` : "none" }}
      />
      <span>{label}</span>
    </Link>
  );
}
