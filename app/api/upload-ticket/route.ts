import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin.server";
import { ImageRequestSchema } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const EXT_BY_MEDIA: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`upload-ticket:${clientIp(req)}`, 30, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ImageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid request" },
        { status: 400 },
      );
    }
    const { imageBase64, mediaType } = parsed.data;

    const bytes = Buffer.from(imageBase64, "base64");
    const ext = EXT_BY_MEDIA[mediaType] ?? "bin";
    const path = `tickets/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const sb = supabaseAdmin();
    const { error } = await sb.storage.from("tickets").upload(path, bytes, {
      contentType: mediaType,
      upsert: false,
    });
    if (error) throw error;

    return NextResponse.json({ path });
  } catch (err) {
    console.error("[upload-ticket] failed:", err);
    const message = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
