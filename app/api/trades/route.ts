import { NextRequest, NextResponse } from "next/server";
import { createTrade, listTrades } from "@/lib/trades-repo";
import { TradePayloadSchema } from "@/lib/trade-schema";
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
    const raw = await req.json().catch(() => ({}));
    const parsed = TradePayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid trade" },
        { status: 400 },
      );
    }
    const id = await createTrade(parsed.data as Trade);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("[api/trades] create failed:", err);
    const m =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err && "message" in err
          ? String((err as { message: unknown }).message)
          : "create failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
