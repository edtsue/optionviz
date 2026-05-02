import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mediaType } = (await req.json()) as {
      imageBase64: string;
      mediaType: string;
    };
    if (!imageBase64 || !mediaType) {
      return NextResponse.json({ error: "imageBase64 and mediaType required" }, { status: 400 });
    }

    const bytes = Buffer.from(imageBase64, "base64");
    const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const sb = supabaseServer();
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
