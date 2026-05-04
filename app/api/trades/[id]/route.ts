import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteTrade, getTrade, updateUnderlyingPrice } from "@/lib/trades-repo";

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

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteTrade(id);
  return NextResponse.json({ ok: true });
}
