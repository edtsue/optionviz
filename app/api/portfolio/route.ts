import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin.server";

export const runtime = "nodejs";

// We keep schema permissive — the parser already shapes the payload — and let
// jsonb store whatever Claude returns. We only require `snapshot` to be an
// object with a holdings array, matching PortfolioSnapshot.
const HoldingSchema = z
  .object({ symbol: z.string() })
  .passthrough();

const SnapshotSchema = z
  .object({
    holdings: z.array(HoldingSchema),
  })
  .passthrough();

const PutSchema = z.object({
  snapshot: SnapshotSchema,
  analysis: z.unknown().nullable().optional(),
});

interface PortfolioRow {
  id: string;
  snapshot: unknown;
  analysis: unknown | null;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("portfolios")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ portfolio: (data as PortfolioRow | null) ?? null });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid request" },
      { status: 400 },
    );
  }
  const sb = supabaseAdmin();
  // Each PUT inserts a new row representing the current state. Older rows
  // accumulate — small JSON, no harm — and a future "history" UI can read
  // them. The page always loads the most recent.
  const { data, error } = await sb
    .from("portfolios")
    .insert({
      snapshot: parsed.data.snapshot,
      analysis: parsed.data.analysis ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ portfolio: data as PortfolioRow });
}

export async function DELETE() {
  const sb = supabaseAdmin();
  // Wipe every row; the next GET will return null until a new PUT happens.
  const { error } = await sb
    .from("portfolios")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
