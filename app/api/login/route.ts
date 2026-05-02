import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Body {
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
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
    if (submitted !== sitePw) {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "ov-auth",
      value: secret,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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
