"use client";
import { useState } from "react";
import type { Trade } from "@/types/trade";
import type { UpcomingEvent } from "@/types/portfolio";
import { localIdeas, type Idea } from "@/lib/local-ideas";

type Source = "local" | "claude";

export function IdeasPanel({ trade }: { trade: Trade }) {
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [localCache, setLocalCache] = useState<Idea[] | null>(null);
  const [claudeCache, setClaudeCache] = useState<{ ideas: Idea[]; events: UpcomingEvent[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleLocal() {
    setError(null);
    if (openSource === "local") {
      setOpenSource(null);
      return;
    }
    if (!localCache) setLocalCache(localIdeas(trade));
    setOpenSource("local");
  }

  async function toggleClaude() {
    setError(null);
    if (openSource === "claude") {
      setOpenSource(null);
      return;
    }
    if (!claudeCache) {
      setBusy(true);
      try {
        const res = await fetch("/api/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trade),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Claude ideas failed (${res.status})`);
        }
        const data = await res.json();
        setClaudeCache({ ideas: data.ideas ?? [], events: data.events ?? [] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    setOpenSource("claude");
  }

  const visible =
    openSource === "claude"
      ? claudeCache?.ideas ?? null
      : openSource === "local"
        ? localCache
        : null;
  const visibleEvents = openSource === "claude" ? claudeCache?.events ?? [] : [];

  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={toggleLocal}
          className={`rounded-lg px-3 py-2 text-sm transition ${
            openSource === "local" ? "btn-primary" : "btn-ghost"
          }`}
        >
          Quick ideas {openSource === "local" ? "▾" : "▸"}
        </button>
        <button
          onClick={toggleClaude}
          disabled={busy}
          className={`rounded-lg px-3 py-2 text-sm transition ${
            openSource === "claude" ? "btn-primary" : "btn-ghost"
          }`}
        >
          {busy ? "Thinking…" : `Ask Claude ${openSource === "claude" ? "▾" : "▸"}`}
        </button>
      </div>

      {error && <div className="text-xs loss">{error}</div>}

      {visibleEvents.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/[0.05] p-2">
          <div className="label mb-1">Upcoming catalysts</div>
          <ul className="space-y-1 text-xs">
            {visibleEvents.map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 rounded bg-warn/20 px-1.5 py-0.5 text-[10px] uppercase warn">
                  {e.type}
                </span>
                <div>
                  <div className="font-semibold">
                    {e.ticker ? `${e.ticker} · ` : ""}
                    <span className="muted">{e.date}</span>
                  </div>
                  <div className="text-[11px] text-gray-300">{e.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {visible && (
        <ul className="space-y-3">
          {visible.map((it, i) => (
            <li key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{it.name}</div>
                <span className="rounded-md border border-border px-2 py-0.5 text-xs text-gray-300">
                  {it.bias}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-300">{it.thesis}</p>
              <div className="mt-2 text-xs text-gray-400">
                <pre className="font-mono whitespace-pre-wrap">{formatStructure(it.structure)}</pre>
              </div>
              <div className="mt-2 text-xs">
                <span className="text-gray-400">Tradeoffs: </span>
                <span>{it.tradeoffs}</span>
              </div>
              <div className="text-xs">
                <span className="text-gray-400">When: </span>
                <span>{it.whenToConsider}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatStructure(s: unknown): string {
  if (typeof s === "string") {
    return s
      .replace(/```[\w]*\n?/g, "")
      .replace(/```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
  }
  if (Array.isArray(s)) {
    return s
      .map((leg) => {
        if (typeof leg === "string") return leg;
        if (leg && typeof leg === "object") {
          const o = leg as Record<string, unknown>;
          const action = String(o.action ?? o.side ?? "");
          const qty = o.qty ?? o.quantity ?? 1;
          const type = String(o.type ?? "");
          const strike = o.strike != null ? `$${o.strike}` : "";
          const exp = o.expiration ?? o.expiry ?? "";
          return [action, `${qty}×`, type, strike, exp].filter(Boolean).join(" ");
        }
        return String(leg);
      })
      .join("\n");
  }
  if (s && typeof s === "object") {
    return Object.entries(s as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("\n");
  }
  return String(s);
}
