import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin.server";

export const runtime = "nodejs";

const StrategyEnum = z.enum(["covered_call", "cash_secured_put"]);
const MarketViewEnum = z.enum(["bull", "neutral", "bear"]);

const PutSchema = z.object({
  strategy: StrategyEnum.optional(),
  market_view: MarketViewEnum.optional(),
  stop_multiplier: z.number().min(1.0).max(3.0).optional(),
  checked_items: z.record(z.string(), z.boolean()).optional(),
});

interface ChecklistRow {
  trade_id: string;
  strategy: "covered_call" | "cash_secured_put";
  market_view: "bull" | "neutral" | "bear";
  stop_multiplier: number;
  checked_items: Record<string, boolean>;
  updated_at: string;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("trade_checklists")
    .select("*")
    .eq("trade_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checklist: (data as ChecklistRow | null) ?? null });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid request" },
      { status: 400 },
    );
  }
  const sb = supabaseAdmin();

  // Upsert. Only the keys the client sent are written; defaults fill the rest
  // on first insert.
  const payload: Partial<ChecklistRow> & { trade_id: string } = { trade_id: id };
  if (parsed.data.strategy) payload.strategy = parsed.data.strategy;
  if (parsed.data.market_view) payload.market_view = parsed.data.market_view;
  if (parsed.data.stop_multiplier != null)
    payload.stop_multiplier = parsed.data.stop_multiplier;
  if (parsed.data.checked_items) payload.checked_items = parsed.data.checked_items;

  // Need a strategy on first insert. Default to covered_call if missing.
  const { data: existing } = await sb
    .from("trade_checklists")
    .select("trade_id")
    .eq("trade_id", id)
    .maybeSingle();
  if (!existing && !payload.strategy) payload.strategy = "covered_call";

  const { data, error } = await sb
    .from("trade_checklists")
    .upsert(payload, { onConflict: "trade_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ checklist: data as ChecklistRow });
}
