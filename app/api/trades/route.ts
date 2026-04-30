import { NextRequest, NextResponse } from "next/server";
import { createTrade, listTrades } from "@/lib/trades-repo";
import type { Trade } from "@/types/trade";

export const runtime = "nodejs";

export async function GET() {
  try {
    const trades = await listTrades();
    return NextResponse.json({ trades });
  } catch (err) {
    const m = err instanceof Error ? err.message : "list failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const trade = (await req.json()) as Trade;
    const id = await createTrade(trade);
    return NextResponse.json({ id });
  } catch (err) {
    const m = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
