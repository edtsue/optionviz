"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { tradesClient } from "@/lib/trades-client";
import { detectStrategy } from "@/lib/strategies";
import type { Trade } from "@/types/trade";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [trades, setTrades] = useState<Trade[] | null>(null);

  useEffect(() => {
    tradesClient.list().then(setTrades).catch(() => setTrades([]));
  }, [pathname]);

  const activeTradeId = pathname?.startsWith("/trade/") && !pathname.endsWith("/new")
    ? pathname.split("/")[2]
    : null;

  return (
    <aside className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between px-1">
        <Link href="/" onClick={onNavigate} className="flex items-baseline gap-1">
          <span className="text-lg font-semibold tracking-tight">Option</span>
          <span className="text-lg font-semibold tracking-tight text-accent">Viz</span>
        </Link>
      </div>

      <nav className="flex flex-col gap-1">
        <NavLink href="/" label="Trade" active={pathname === "/" || pathname?.startsWith("/trade/")} onNav={onNavigate} />
        <NavLink href="/portfolio" label="Portfolio" active={pathname === "/portfolio"} onNav={onNavigate} />
      </nav>

      <button
        onClick={() => {
          router.push("/trade/new");
          onNavigate?.();
        }}
        className="btn-primary w-full rounded-lg px-3 py-2 text-sm"
      >
        + New trade
      </button>

      <div className="mt-2 flex items-center justify-between px-1">
        <div className="label">Saved trades</div>
        {trades && <span className="text-xs muted">{trades.length}</span>}
      </div>

      <div className="scroll-soft -mx-1 flex-1 overflow-y-auto pr-1">
        {trades === null && <div className="px-3 text-xs muted">Loading…</div>}
        {trades?.length === 0 && <div className="px-3 text-xs muted">No trades yet</div>}
        <ul className="flex flex-col gap-0.5">
          {trades?.map((t) => {
            const strat = detectStrategy(t);
            const active = t.id === activeTradeId;
            return (
              <li key={t.id}>
                <Link
                  href={`/trade/${t.id}`}
                  onClick={onNavigate}
                  className={`side-row ${active ? "active" : ""}`}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold">{t.symbol}</span>
                    <span className="text-[11px] muted">{strat.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="kpi-xs">${t.underlyingPrice.toFixed(2)}</div>
                    <div className="text-[10px] muted">
                      {t.legs.length}L
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  active,
  onNav,
}: {
  href: string;
  label: string;
  active: boolean;
  onNav?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNav}
      className={`rounded-lg px-3 py-2 text-sm transition ${
        active ? "bg-white/[0.06] text-white" : "text-textDim hover:bg-white/[0.03] hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}
