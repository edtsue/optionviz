// Edge-runtime-safe session-token verification. Imported by middleware (which
// runs on edge) — must avoid `node:crypto`.

export const COOKIE_NAME = "ov-auth";
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface Payload {
  iat: number;
  jti: string;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifySessionTokenEdge(
  token: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(body));
  const expected = bytesToB64Url(new Uint8Array(macBuf));
  if (sig.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return false;

  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as Payload;
    if (typeof payload.iat !== "number") return false;
    if (Date.now() - payload.iat > TOKEN_TTL_MS) return false;
    return true;
  } catch {
    return false;
  }
}
