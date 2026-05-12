import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createClosedTrade,
  listClosedTrades,
  type ClosedOutcome,
} from "@/lib/closed-trades-repo";
import { TradePayloadSchema } from "@/lib/trade-schema";

export const runtime = "nodejs";

const PostSchema = z.object({
  sourceTradeId: z.string().uuid().nullable().optional(),
  outcome: z.enum(["closed", "canceled"]),
  trade: TradePayloadSchema,
  entryCredit: z.number().finite().nullable().optional(),
  exitCredit: z.number().finite().nullable().optional(),
  realizedPnL: z.number().finite().nullable().optional(),
  realizedPnLPct: z.number().finite().nullable().optional(),
  capitalAtRisk: z.number().finite().nullable().optional(),
  notes: z.string().max(2_000).nullable().optional(),
  resultTag: z.enum(["win", "loss", "scratch"]).nullable().optional(),
  closedAt: z.string().datetime().optional(),
});

export async function GET() {
  try {
    const items = await listClosedTrades();
    return NextResponse.json({ items });
  } catch (e) {
    const m = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid request" },
        { status: 400 },
      );
    }
    const p = parsed.data;
    const created = await createClosedTrade({
      sourceTradeId: p.sourceTradeId ?? null,
      symbol: p.trade.symbol,
      outcome: p.outcome as ClosedOutcome,
      tradeSnapshot: p.trade,
      entryCredit: p.entryCredit ?? null,
      exitCredit: p.exitCredit ?? null,
      realizedPnL: p.realizedPnL ?? null,
      realizedPnLPct: p.realizedPnLPct ?? null,
      capitalAtRisk: p.capitalAtRisk ?? null,
      notes: p.notes ?? null,
      resultTag: p.resultTag ?? null,
      closedAt: p.closedAt,
    });
    return NextResponse.json({ closedTrade: created });
  } catch (e) {
    const m = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
