import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 10;

// Lightweight client-error sink. Today it just writes to console.error so
// errors show up in `vercel logs`. If/when Sentry or another sink is added,
// fan out from here.

const ErrorPayloadSchema = z.object({
  message: z.string().max(2_000),
  stack: z.string().max(20_000).nullable().optional(),
  componentStack: z.string().max(20_000).nullable().optional(),
  url: z.string().max(2_000).nullable().optional(),
  userAgent: z.string().max(2_000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  // Throttle hard — a buggy boundary in a render loop could otherwise
  // hammer this endpoint.
  const rl = rateLimit(`log-error:${clientIp(req)}`, 20, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = ErrorPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const p = parsed.data;
  console.error("[client-error]", {
    message: p.message,
    url: p.url,
    userAgent: p.userAgent,
    componentStack: p.componentStack,
    stack: p.stack,
  });
  return NextResponse.json({ ok: true });
}
