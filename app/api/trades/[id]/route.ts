import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteTrade, getTrade, updateTrade, updateUnderlyingPrice } from "@/lib/trades-repo";
import type { Trade } from "@/types/trade";

export const runtime = "nodejs";

const PatchSchema = z.object({
  underlyingPrice: z.number().finite().positive().max(1_000_000),
  expectedUpdatedAt: z.string().optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trade = await getTrade(id);
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ trade });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid request" },
      { status: 400 },
    );
  }
  const { trade, stale } = await updateUnderlyingPrice(
    id,
    parsed.data.underlyingPrice,
    parsed.data.expectedUpdatedAt,
  );
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (stale) return NextResponse.json({ trade, stale: true }, { status: 409 });
  return NextResponse.json({ trade });
}

const LegSchema = z.object({
  type: z.enum(["call", "put"]),
  side: z.enum(["long", "short"]),
  strike: z.number().finite().positive(),
  expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expiration must be YYYY-MM-DD"),
  quantity: z.number().int().positive(),
  premium: z.number().finite().nonnegative(),
  iv: z.number().finite().positive().nullable().optional(),
});

const PutSchema = z.object({
  symbol: z.string().min(1).max(16),
  underlyingPrice: z.number().finite().positive().max(1_000_000),
  riskFreeRate: z.number().finite().min(0).max(1),
  legs: z.array(LegSchema).min(1),
  underlying: z
    .object({
      shares: z.number().int().nonnegative(),
      costBasis: z.number().finite().nonnegative(),
    })
    .nullable()
    .optional(),
  notes: z.string().nullable().optional(),
});

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
  const trade = await updateTrade(id, parsed.data as Trade);
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ trade });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteTrade(id);
  return NextResponse.json({ ok: true });
}
