import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "ov-auth";

function isAuthed(req: NextRequest): boolean {
  const expected = process.env.AUTH_SECRET;
  if (!expected) return false;
  return req.cookies.get(COOKIE)?.value === expected;
}

export function middleware(req: NextRequest) {
  if (isAuthed(req)) return NextResponse.next();

  // API: return 401 instead of redirecting
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (req.nextUrl.pathname !== "/" && req.nextUrl.pathname !== "/login") {
    url.searchParams.set("from", req.nextUrl.pathname + req.nextUrl.search);
  } else {
    url.search = "";
  }
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every page + API route except: static, image optimization, the
  // login page itself, the login API, and the favicon/manifest.
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon\\.ico|icon\\.svg|robots\\.txt|sitemap\\.xml|login|api/login|api/logout).*)",
  ],
};
