import { createClient } from "@supabase/supabase-js";

// Holds the service-role key — must never be imported into a client component.
// The .server.ts naming and runtime guard both protect against that.
if (typeof window !== "undefined") {
  throw new Error("supabase admin client must not be loaded in the browser");
}

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
