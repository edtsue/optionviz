import { supabaseAdmin } from "./supabase/admin.server";
import type { Trade } from "@/types/trade";

export type ClosedOutcome = "closed" | "canceled";
export type ResultTag = "win" | "loss" | "scratch";

export interface ClosedTrade {
  id: string;
  sourceTradeId: string | null;
  symbol: string;
  outcome: ClosedOutcome;
  tradeSnapshot: Trade;
  entryCredit: number | null;
  exitCredit: number | null;
  realizedPnL: number | null;
  realizedPnLPct: number | null;
  capitalAtRisk: number | null;
  notes: string | null;
  resultTag: ResultTag | null;
  closedAt: string;
  createdAt: string;
}

interface Row {
  id: string;
  source_trade_id: string | null;
  symbol: string;
  outcome: ClosedOutcome;
  trade_snapshot: Trade;
  entry_credit: number | null;
  exit_credit: number | null;
  realized_pnl: number | null;
  realized_pnl_pct: number | null;
  capital_at_risk: number | null;
  notes: string | null;
  result_tag: ResultTag | null;
  closed_at: string;
  created_at: string;
}

function rowToClosedTrade(r: Row): ClosedTrade {
  return {
    id: r.id,
    sourceTradeId: r.source_trade_id,
    symbol: r.symbol,
    outcome: r.outcome,
    tradeSnapshot: r.trade_snapshot,
    entryCredit: r.entry_credit == null ? null : Number(r.entry_credit),
    exitCredit: r.exit_credit == null ? null : Number(r.exit_credit),
    realizedPnL: r.realized_pnl == null ? null : Number(r.realized_pnl),
    realizedPnLPct: r.realized_pnl_pct == null ? null : Number(r.realized_pnl_pct),
    capitalAtRisk: r.capital_at_risk == null ? null : Number(r.capital_at_risk),
    notes: r.notes,
    resultTag: r.result_tag,
    closedAt: r.closed_at,
    createdAt: r.created_at,
  };
}

export interface CreateClosedTradeInput {
  sourceTradeId: string | null;
  symbol: string;
  outcome: ClosedOutcome;
  tradeSnapshot: Trade;
  entryCredit: number | null;
  exitCredit: number | null;
  realizedPnL: number | null;
  realizedPnLPct: number | null;
  capitalAtRisk: number | null;
  notes: string | null;
  resultTag?: ResultTag | null;
  closedAt?: string;
}

export async function listClosedTrades(): Promise<ClosedTrade[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("closed_trades")
    .select("*")
    .order("closed_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(rowToClosedTrade);
}

export async function createClosedTrade(input: CreateClosedTradeInput): Promise<ClosedTrade> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("closed_trades")
    .insert({
      source_trade_id: input.sourceTradeId,
      symbol: input.symbol,
      outcome: input.outcome,
      trade_snapshot: input.tradeSnapshot,
      entry_credit: input.entryCredit,
      exit_credit: input.exitCredit,
      realized_pnl: input.realizedPnL,
      realized_pnl_pct: input.realizedPnLPct,
      capital_at_risk: input.capitalAtRisk,
      notes: input.notes,
      result_tag: input.resultTag ?? null,
      closed_at: input.closedAt ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToClosedTrade(data as Row);
}

export async function deleteClosedTrade(id: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("closed_trades").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
