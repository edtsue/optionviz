"use client";
import { supabaseBrowser } from "./supabase/client";
import type { Trade } from "@/types/trade";

interface TradeRow {
  id: string;
  symbol: string;
  underlying_price: number;
  risk_free_rate: number;
  underlying_shares: number | null;
  underlying_cost_basis: number | null;
  notes: string | null;
  ticket_image_path: string | null;
  created_at: string;
  updated_at: string;
}

interface LegRow {
  id: string;
  trade_id: string;
  type: "call" | "put";
  side: "long" | "short";
  strike: number;
  expiration: string;
  quantity: number;
  premium: number;
  iv: number | null;
  position: number;
}

function rowsToTrade(t: TradeRow, legs: LegRow[]): Trade {
  return {
    id: t.id,
    symbol: t.symbol,
    underlyingPrice: Number(t.underlying_price),
    riskFreeRate: Number(t.risk_free_rate),
    underlying:
      t.underlying_shares != null && t.underlying_cost_basis != null
        ? { shares: t.underlying_shares, costBasis: Number(t.underlying_cost_basis) }
        : null,
    notes: t.notes,
    ticketImagePath: t.ticket_image_path,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    legs: legs
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        type: l.type,
        side: l.side,
        strike: Number(l.strike),
        expiration: l.expiration,
        quantity: l.quantity,
        premium: Number(l.premium),
        iv: l.iv == null ? null : Number(l.iv),
      })),
  };
}

export const tradesClient = {
  async list(): Promise<Trade[]> {
    const sb = supabaseBrowser();
    const { data: trades, error } = await sb
      .from("trades")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!trades?.length) return [];
    const ids = trades.map((t) => t.id);
    const { data: legs, error: e2 } = await sb.from("legs").select("*").in("trade_id", ids);
    if (e2) throw e2;
    return trades.map((t) =>
      rowsToTrade(t as TradeRow, ((legs ?? []) as LegRow[]).filter((l) => l.trade_id === t.id)),
    );
  },

  async get(id: string): Promise<Trade | null> {
    const sb = supabaseBrowser();
    const { data: trade, error } = await sb.from("trades").select("*").eq("id", id).single();
    if (error || !trade) return null;
    const { data: legs } = await sb.from("legs").select("*").eq("trade_id", id);
    return rowsToTrade(trade as TradeRow, (legs ?? []) as LegRow[]);
  },

  async create(trade: Trade): Promise<string> {
    // Writes go through the server-side API route (uses the Supabase secret
    // key). The publishable key in the browser is read-only by default in
    // newer Supabase projects, which is why direct .insert was 403'ing.
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

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/trades/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Delete failed (HTTP ${res.status})`);
    }
  },
};
