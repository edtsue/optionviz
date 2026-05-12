import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin.server";
import { syncPortfolioTrades } from "@/lib/portfolio-trade-sync";

export const runtime = "nodejs";

// Re-runs the portfolio→trades sync against whatever portfolio snapshot is
// currently the most recent in the `portfolios` table. The PUT route already
// runs this on upload; this endpoint exists so the sidebar can keep itself
// in sync with the latest snapshot without the user re-uploading (e.g., a
// stale tab opened after a fresh upload from somewhere else).
//
// WIP / manual trades are untouched by syncPortfolioTrades.
export async function POST() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("portfolios")
    .select("snapshot, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ sync: null, reason: "no_portfolio" });

  try {
    // The snapshot is stored as jsonb; syncPortfolioTrades filters/validates
    // each holding internally, so passing the raw value through is safe.
    const sync = await syncPortfolioTrades(
      data.snapshot as Parameters<typeof syncPortfolioTrades>[0],
    );
    return NextResponse.json({ sync, snapshotAt: data.created_at });
  } catch (e) {
    const m = e instanceof Error ? e.message : "resync failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
