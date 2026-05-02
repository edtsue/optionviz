import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Generates a short-lived signed URL for a stored ticket image and redirects to it.
// Usage: GET /api/ticket-image?path=<storage-path>
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb.storage.from("tickets").createSignedUrl(path, 3600);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
