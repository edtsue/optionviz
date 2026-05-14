"use client";
import type { Trade } from "@/types/trade";
import {
  cacheTrade,
  cacheTradeList,
  getCachedTrade,
  getCachedTradeList,
  isNetworkError,
  removeCachedTrade,
} from "./offline-cache";

// All DB access goes through the server-side API routes (which use the
// Supabase secret key). The browser publishable key is restricted by RLS in
// newer Supabase projects — direct .from('trades').select() returns 406 on
// .single() for rows the anon role can't read. Routing every read through
// /api/trades sidesteps the RLS problem entirely.

export const tradesClient = {
  async list(): Promise<Trade[]> {
    try {
      const res = await fetch("/api/trades", { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `List failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      const trades = (data.trades ?? []) as Trade[];
      cacheTradeList(trades);
      return trades;
    } catch (err) {
      // Offline: serve whatever we last saw. The OfflineBanner tells the user
      // their view is cached.
      if (isNetworkError(err)) {
        const cached = getCachedTradeList();
        if (cached) return cached;
      }
      throw err;
    }
  },

  async get(id: string): Promise<Trade | null> {
    try {
      const res = await fetch(`/api/trades/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        removeCachedTrade(id);
        return null;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Get failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      const trade = (data.trade ?? null) as Trade | null;
      if (trade) cacheTrade(trade);
      return trade;
    } catch (err) {
      if (isNetworkError(err)) {
        const cached = getCachedTrade(id);
        if (cached) return cached;
      }
      throw err;
    }
  },

  async create(trade: Trade): Promise<string> {
    const res = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trade),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Save failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    const id = data.id as string;
    cacheTrade({ ...trade, id });
    return id;
  },

  async updateSpot(
    id: string,
    underlyingPrice: number,
    expectedUpdatedAt?: string,
  ): Promise<{ trade: Trade; stale?: boolean }> {
    const res = await fetch(`/api/trades/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ underlyingPrice, expectedUpdatedAt }),
    });
    if (res.status === 409) {
      const data = await res.json();
      const trade = data.trade as Trade;
      cacheTrade(trade);
      return { trade, stale: true };
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Update spot failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    const trade = data.trade as Trade;
    cacheTrade(trade);
    return { trade };
  },

  async fetchSpot(
    symbol: string,
    opts: { claudeFallback?: boolean } = {},
  ): Promise<{ price: number; asOf: string; source: string | null }> {
    const res = await fetch("/api/spot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, claudeFallback: opts.claudeFallback ?? true }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Spot fetch failed (HTTP ${res.status})`);
    }
    return res.json();
  },

  async update(id: string, trade: Trade): Promise<Trade> {
    const res = await fetch(`/api/trades/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trade),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Save failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    const updated = data.trade as Trade;
    cacheTrade(updated);
    return updated;
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/trades/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Delete failed (HTTP ${res.status})`);
    }
    removeCachedTrade(id);
  },
};
