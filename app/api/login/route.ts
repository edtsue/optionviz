import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, safeEqual, signSessionToken } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

interface Body {
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
    // 5 attempts per 15 minutes per IP — guards against password brute-force.
    const rl = rateLimit(`login:${clientIp(req)}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "retry-after": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    const sitePw = process.env.SITE_PASSWORD?.trim();
    const secret = process.env.AUTH_SECRET?.trim();
    if (!sitePw || !secret) {
      return NextResponse.json(
        { error: "Auth not configured. Server is missing SITE_PASSWORD or AUTH_SECRET. Set both in Vercel and redeploy." },
        { status: 500 },
      );
    }
    const body = (await req.json().catch(() => ({}))) as Body;
    const submitted = typeof body.password === "string" ? body.password.trim() : "";
    if (!safeEqual(submitted, sitePw)) {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: COOKIE_NAME,
      value: signSessionToken(),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  } catch (err) {
    const m = err instanceof Error ? err.message : "login failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
