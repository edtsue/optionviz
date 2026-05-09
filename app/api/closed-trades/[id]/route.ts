import { NextResponse } from "next/server";
import { deleteClosedTrade } from "@/lib/closed-trades-repo";

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteClosedTrade(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const m = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
