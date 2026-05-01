"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params?.get("from") ?? "/";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Login failed");
      }
      router.replace(from);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="card w-full max-w-sm space-y-5 text-center"
      >
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-tight">
            Option<span className="text-accent">Viz</span>
          </div>
          <div className="text-sm muted">Enter the access password to continue.</div>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-border bg-white/[0.04] px-3 py-2.5 text-base text-center"
        />

        {error && <div className="text-sm loss">{error}</div>}

        <button
          type="submit"
          disabled={busy || !password}
          className="btn-primary w-full rounded-lg px-4 py-2.5 text-sm font-semibold"
        >
          {busy ? "Signing in…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
