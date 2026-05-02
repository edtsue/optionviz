import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin.server";

export const runtime = "nodejs";

// Path safety: scoped to the tickets/ prefix, no traversal, no leading slash.
const PATH_SHAPE = /^tickets\/[A-Za-z0-9._-]+$/;

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !PATH_SHAPE.test(path)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from("tickets").createSignedUrl(path, 3600);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "sign failed" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl });
}
