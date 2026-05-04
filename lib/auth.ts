// Session-token primitives for the single-tenant password gate.
// We don't ship the raw AUTH_SECRET in the cookie — instead we sign a small
// payload (issued-at + jti) with HMAC-SHA-256. Compromising one cookie no
// longer hands over the master secret.
//
// This file uses node:crypto for a faster signing path; edge-runtime callers
// (e.g. middleware) should import from ./auth-edge instead.

import crypto from "node:crypto";
import { COOKIE_NAME } from "./auth-edge";

export { COOKIE_NAME };

interface Payload {
  iat: number;
  jti: string;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export function signSessionToken(): string {
  const payload: Payload = { iat: Date.now(), jti: crypto.randomBytes(8).toString("hex") };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

// Constant-time string compare (for password equality).
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const av = Buffer.from(a);
  const bv = Buffer.from(b);
  return crypto.timingSafeEqual(av, bv);
}
