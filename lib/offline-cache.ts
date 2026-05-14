"use client";
import type { Trade } from "@/types/trade";

// Read-through / write-through localStorage cache for trades. Populated on
// every successful network read so the user can browse the last-seen state
// when offline. Writes (save / delete / spot update) hit the network normally
// and only update the cache on success — there is no offline write queue.
const LIST_KEY = "optionviz.cache.trades.v1";
const TRADE_KEY = (id: string) => `optionviz.cache.trade.${id}.v1`;

function safeGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function cacheTradeList(trades: Trade[]): void {
  safeSet(LIST_KEY, trades);
  for (const t of trades) {
    if (t.id) safeSet(TRADE_KEY(t.id), t);
  }
}

export function getCachedTradeList(): Trade[] | null {
  return safeGet<Trade[]>(LIST_KEY);
}

export function cacheTrade(trade: Trade): void {
  if (!trade.id) return;
  safeSet(TRADE_KEY(trade.id), trade);
  // Keep the list cache in sync so the sidebar reflects edits.
  const list = getCachedTradeList();
  if (list) {
    const idx = list.findIndex((t) => t.id === trade.id);
    const next = idx >= 0 ? list.map((t, i) => (i === idx ? trade : t)) : [...list, trade];
    safeSet(LIST_KEY, next);
  }
}

export function getCachedTrade(id: string): Trade | null {
  return safeGet<Trade>(TRADE_KEY(id));
}

export function removeCachedTrade(id: string): void {
  safeRemove(TRADE_KEY(id));
  const list = getCachedTradeList();
  if (list) safeSet(LIST_KEY, list.filter((t) => t.id !== id));
}

// True when the error from fetch indicates we couldn't reach the server (vs.
// a 4xx/5xx response from the server itself, which means we're online but the
// request was rejected). Errors thrown by `fetch` itself are network errors.
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch throws TypeError on network failure
  return false;
}
