// Shared input-validation helpers for API routes.
import { z } from "zod";

// Roughly 5 MB of binary, allowing for base64 inflation.
export const MAX_IMAGE_BASE64_LEN = 7_000_000;

export const ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export const ImageRequestSchema = z.object({
  imageBase64: z
    .string()
    .min(1, "imageBase64 required")
    .max(MAX_IMAGE_BASE64_LEN, "image too large (max ~5 MB)"),
  mediaType: z.enum(ALLOWED_MEDIA_TYPES),
});

// US-equity ticker: 1–6 letters, optional dot for class shares (BRK.B).
export const TickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,6}(?:\.[A-Z])?$/, "invalid ticker");

// CSRF: same-origin check. Static import-time constant, applied per-request.
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Some clients (curl, no-CORS server-side fetches) omit Origin. Fall back
    // to Referer; if neither is present, reject mutating methods.
    const referer = req.headers.get("referer");
    if (!referer) return false;
    try {
      const r = new URL(referer);
      const u = new URL(req.url);
      return r.origin === u.origin;
    } catch {
      return false;
    }
  }
  try {
    const u = new URL(req.url);
    return new URL(origin).origin === u.origin;
  } catch {
    return false;
  }
}
