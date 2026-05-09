import { supabaseAdmin } from "./supabase/admin.server";
import type { Trade, TradeSource } from "@/types/trade";

interface TradeRow {
  id: string;
  symbol: string;
  underlying_price: number;
  risk_free_rate: number;
  underlying_shares: number | null;
  underlying_cost_basis: number | null;
  notes: string | null;
  ticket_image_path: string | null;
  source: TradeSource | null;
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
    source: (t.source ?? "manual") as TradeSource,
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

export async function listTrades(): Promise<Trade[]> {
  const sb = supabaseAdmin();
  const { data: trades, error } = await sb
    .from("trades")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!trades?.length) return [];
  const ids = trades.map((t) => t.id);
  const { data: legs, error: e2 } = await sb.from("legs").select("*").in("trade_id", ids);
  if (e2) throw e2;
  return trades.map((t) => rowsToTrade(t as TradeRow, ((legs ?? []) as LegRow[]).filter((l) => l.trade_id === t.id)));
}

export async function getTrade(id: string): Promise<Trade | null> {
  const sb = supabaseAdmin();
  const { data: trade, error } = await sb.from("trades").select("*").eq("id", id).single();
  if (error || !trade) return null;
  const { data: legs } = await sb.from("legs").select("*").eq("trade_id", id);
  return rowsToTrade(trade as TradeRow, (legs ?? []) as LegRow[]);
}

function pgErr(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code ? `(${e.code})` : null].filter(Boolean);
    return new Error(parts.length ? parts.join(" — ") : fallback);
  }
  return new Error(fallback);
}

export async function createTrade(trade: Trade): Promise<string> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("trades")
    .insert({
      symbol: trade.symbol,
      underlying_price: trade.underlyingPrice,
      risk_free_rate: trade.riskFreeRate,
      underlying_shares: trade.underlying?.shares ?? null,
      underlying_cost_basis: trade.underlying?.costBasis ?? null,
      notes: trade.notes ?? null,
      ticket_image_path: trade.ticketImagePath ?? null,
      source: trade.source ?? "manual",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("trades.insert failed:", error);
    throw pgErr(error, "Insert into trades failed");
  }
  const tradeId = data.id as string;
  if (trade.legs.length) {
    const { error: e2 } = await sb.from("legs").insert(
      trade.legs.map((l, i) => ({
        trade_id: tradeId,
        type: l.type,
        side: l.side,
        strike: l.strike,
        expiration: l.expiration,
        quantity: l.quantity,
        premium: l.premium,
        iv: l.iv ?? null,
        position: i,
      })),
    );
    if (e2) {
      console.error("legs.insert failed:", e2);
      // Roll back the parent row to avoid orphans
      await sb.from("trades").delete().eq("id", tradeId);
      throw pgErr(e2, "Insert into legs failed");
    }
  }
  return tradeId;
}

export async function updateUnderlyingPrice(
  id: string,
  price: number,
  expectedUpdatedAt?: string,
): Promise<{ trade: Trade | null; stale?: boolean }> {
  const sb = supabaseAdmin();
  const query = sb
    .from("trades")
    .update({ underlying_price: price, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (expectedUpdatedAt) query.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await query.select("id");
  if (error) {
    console.error("trades.update underlying_price failed:", error);
    throw pgErr(error, "Update underlying price failed");
  }
  if (expectedUpdatedAt && (!data || data.length === 0)) {
    // Row exists but updated_at didn't match → someone else wrote first.
    return { trade: await getTrade(id), stale: true };
  }
  return { trade: await getTrade(id) };
}

/**
 * Replace a trade's mutable fields and rewrite its legs. Used by the manual
 * Save button on the trade detail page so the user can edit a parsed ticket
 * (e.g. correct an expiration the vision parser misread) and persist it.
 */
export async function updateTrade(id: string, trade: Trade): Promise<Trade | null> {
  const sb = supabaseAdmin();
  const { error: e1 } = await sb
    .from("trades")
    .update({
      symbol: trade.symbol,
      underlying_price: trade.underlyingPrice,
      risk_free_rate: trade.riskFreeRate,
      underlying_shares: trade.underlying?.shares ?? null,
      underlying_cost_basis: trade.underlying?.costBasis ?? null,
      notes: trade.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (e1) {
    console.error("trades.update failed:", e1);
    throw pgErr(e1, "Update trade failed");
  }
  // Replace legs wholesale — simpler than diff-and-patch for a tiny per-trade
  // leg count, and matches what the user expects from a "Save" button.
  const { error: e2 } = await sb.from("legs").delete().eq("trade_id", id);
  if (e2) {
    console.error("legs.delete failed:", e2);
    throw pgErr(e2, "Replace legs failed");
  }
  if (trade.legs.length) {
    const { error: e3 } = await sb.from("legs").insert(
      trade.legs.map((l, i) => ({
        trade_id: id,
        type: l.type,
        side: l.side,
        strike: l.strike,
        expiration: l.expiration,
        quantity: l.quantity,
        premium: l.premium,
        iv: l.iv ?? null,
        position: i,
      })),
    );
    if (e3) {
      console.error("legs.insert failed:", e3);
      throw pgErr(e3, "Replace legs insert failed");
    }
  }
  return getTrade(id);
}

export async function deleteTrade(id: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("trades").delete().eq("id", id);
  if (error) {
    console.error("trades.delete failed:", error);
    throw pgErr(error, "Delete failed");
  }
}

export async function listTradesBySource(source: TradeSource): Promise<Trade[]> {
  const sb = supabaseAdmin();
  const { data: trades, error } = await sb
    .from("trades")
    .select("*")
    .eq("source", source);
  if (error) throw error;
  if (!trades?.length) return [];
  const ids = trades.map((t) => t.id);
  const { data: legs, error: e2 } = await sb.from("legs").select("*").in("trade_id", ids);
  if (e2) throw e2;
  return trades.map((t) =>
    rowsToTrade(t as TradeRow, ((legs ?? []) as LegRow[]).filter((l) => l.trade_id === t.id)),
  );
}
