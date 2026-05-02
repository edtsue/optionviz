"use client";
import type { Trade } from "@/types/trade";

// All DB access goes through the server-side API routes (which use the
// Supabase secret key). The browser publishable key is restricted by RLS in
// newer Supabase projects — direct .from('trades').select() returns 406 on
// .single() for rows the anon role can't read. Routing every read through
// /api/trades sidesteps the RLS problem entirely.

export const tradesClient = {
  async list(): Promise<Trade[]> {
    const res = await fetch("/api/trades", { cache: "no-store" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `List failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return (data.trades ?? []) as Trade[];
  },

  async get(id: string): Promise<Trade | null> {
    const res = await fetch(`/api/trades/${id}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Get failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return (data.trade ?? null) as Trade | null;
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
    return data.id as string;
  },

  async updateSpot(id: string, underlyingPrice: number): Promise<Trade> {
    const res = await fetch(`/api/trades/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ underlyingPrice }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Update spot failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data.trade as Trade;
  },

  async fetchSpot(symbol: string): Promise<{ price: number; asOf: string; source: string | null }> {
    const res = await fetch("/api/spot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Spot fetch failed (HTTP ${res.status})`);
    }
    return res.json();
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/trades/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Delete failed (HTTP ${res.status})`);
    }
  },
};
