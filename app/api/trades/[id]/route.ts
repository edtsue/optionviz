import { NextResponse } from "next/server";
import { deleteTrade, getTrade, updateUnderlyingPrice } from "@/lib/trades-repo";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trade = await getTrade(id);
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ trade });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { underlyingPrice?: number };
  if (typeof body.underlyingPrice !== "number" || !isFinite(body.underlyingPrice) || body.underlyingPrice <= 0) {
    return NextResponse.json({ error: "underlyingPrice must be a positive number" }, { status: 400 });
  }
  const trade = await updateUnderlyingPrice(id, body.underlyingPrice);
  if (!trade) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ trade });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteTrade(id);
  return NextResponse.json({ ok: true });
}
