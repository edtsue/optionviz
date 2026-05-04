import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySessionTokenEdge } from "@/lib/auth-edge";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

async function isAuthed(req: NextRequest): Promise<boolean> {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return false;
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return verifySessionTokenEdge(token, secret);
}

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const reqOrigin = req.nextUrl.origin;
  if (origin) return origin === reqOrigin;
  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === reqOrigin;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  // CSRF: any mutating request to /api/* must come from our origin. Applied
  // before authn so a missing cookie can't leak through with a mismatched
  // origin.
  if (req.nextUrl.pathname.startsWith("/api/") && MUTATING_METHODS.has(req.method)) {
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (await isAuthed(req)) return NextResponse.next();

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
