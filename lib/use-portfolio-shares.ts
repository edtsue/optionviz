"use client";
import { useEffect, useState } from "react";

const PORTFOLIO_KEY = "optionviz.portfolio.v1";
const TRADES_CHANGED_EVENT = "optionviz:trades-changed";

interface PortfolioHolding {
  symbol?: string | null;
  quantity?: number | null;
  assetType?: string | null;
}

// Symbol → net shares the user holds in their latest broker portfolio
// snapshot. Stock and ETF holdings count; options/cash/etc. are ignored.
// Used to detect covered calls when the hedge shares live in the portfolio
// rather than being attached to a trade's `underlying` field — portfolio
// sync writes one trade per option leg without attaching the user's stock
// position, so without this lookup short calls look "naked".
export function readPortfolioShares(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const holdings: PortfolioHolding[] = data?.snapshot?.holdings ?? [];
    const out: Record<string, number> = {};
    for (const h of holdings) {
      if (!h.symbol) continue;
      const t = h.assetType;
      if (t && t !== "stock" && t !== "etf") continue;
      const qty = Number(h.quantity ?? 0);
      if (!Number.isFinite(qty) || qty === 0) continue;
      const sym = h.symbol.toUpperCase();
      out[sym] = (out[sym] ?? 0) + qty;
    }
    return out;
  } catch {
    return {};
  }
}

// React hook wrapper. Refreshes when:
//  - the trades-changed event fires (portfolio uploads dispatch this same
//    event after writing localStorage, so the sidebar stays in sync)
//  - storage changes in another tab (cross-tab consistency)
export function usePortfolioShares(): Record<string, number> {
  const [shares, setShares] = useState<Record<string, number>>({});
  useEffect(() => {
    function refresh() {
      setShares(readPortfolioShares());
    }
    refresh();
    window.addEventListener(TRADES_CHANGED_EVENT, refresh);
    function onStorage(e: StorageEvent) {
      if (e.key === PORTFOLIO_KEY) refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TRADES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return shares;
}

export function externalSharesFor(
  shares: Record<string, number>,
  symbol: string,
): number {
  return shares[symbol.toUpperCase()] ?? 0;
}
