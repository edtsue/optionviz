"use client";
import { useState } from "react";
import type { Trade } from "@/types/trade";
import type { UpcomingEvent } from "@/types/portfolio";
import { localIdeas, type Idea } from "@/lib/local-ideas";

type Source = "local" | "claude" | "news";

export function IdeasPanel({ trade }: { trade: Trade }) {
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [localCache, setLocalCache] = useState<Idea[] | null>(null);
  const [claudeCache, setClaudeCache] = useState<{ ideas: Idea[]; events: UpcomingEvent[] } | null>(null);
  const [newsCache, setNewsCache] = useState<UpcomingEvent[] | null>(null);
  const [busy, setBusy] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleLocal() {
    setError(null);
    if (openSource === "local") return setOpenSource(null);
    if (!localCache) setLocalCache(localIdeas(trade));
    setOpenSource("local");
  }

  async function toggleClaude() {
    setError(null);
    if (openSource === "claude") return setOpenSource(null);
    if (!claudeCache) {
      setBusy("claude");
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
        setBusy(null);
        return;
      } finally {
        setBusy(null);
      }
    }
    setOpenSource("claude");
  }

  async function toggleNews() {
    setError(null);
    if (openSource === "news") return setOpenSource(null);
    if (!newsCache) {
      setBusy("news");
      try {
        const res = await fetch("/api/news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trade),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `News failed (${res.status})`);
        }
        const data = await res.json();
        setNewsCache(data.events ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
        setBusy(null);
        return;
      } finally {
        setBusy(null);
      }
    }
    setOpenSource("news");
  }

  const visibleIdeas =
    openSource === "claude"
      ? claudeCache?.ideas ?? null
      : openSource === "local"
        ? localCache
        : null;
  const visibleEvents =
    openSource === "claude" ? claudeCache?.events ?? [] : openSource === "news" ? newsCache ?? [] : [];

  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={toggleLocal}
          className={`rounded-lg px-2 py-2 text-sm transition ${
            openSource === "local" ? "btn-primary" : "btn-ghost"
          }`}
        >
          Quick {openSource === "local" ? "▾" : "▸"}
        </button>
        <button
          onClick={toggleClaude}
          disabled={busy === "claude"}
          className={`rounded-lg px-2 py-2 text-sm transition ${
            openSource === "claude" ? "btn-primary" : "btn-ghost"
          }`}
        >
          {busy === "claude" ? "…" : `Claude ${openSource === "claude" ? "▾" : "▸"}`}
        </button>
        <button
          onClick={toggleNews}
          disabled={busy === "news"}
          className={`rounded-lg px-2 py-2 text-sm transition ${
            openSource === "news" ? "btn-primary" : "btn-ghost"
          }`}
        >
          {busy === "news" ? "…" : `News ${openSource === "news" ? "▾" : "▸"}`}
        </button>
      </div>

      {error && <div className="text-xs loss">{error}</div>}

      {visibleEvents.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/[0.05] p-2">
          {openSource === "news" && <div className="label mb-1">Upcoming events</div>}
          {openSource === "claude" && <div className="label mb-1">Upcoming catalysts</div>}
          <ul className="space-y-1.5 text-xs">
            {visibleEvents.map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">•</span>
                <div className="flex-1">
                  <span className="font-semibold">
                    {e.type.toUpperCase()}
                    {e.date && (
                      <span className="muted font-normal"> · {e.date}</span>
                    )}
                  </span>
                  <span className="text-gray-300"> — {e.note}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openSource === "news" && visibleEvents.length === 0 && newsCache && (
        <div className="text-xs muted">No upcoming events found.</div>
      )}

      {visibleIdeas && (
        <ul className="space-y-3">
          {visibleIdeas.map((it, i) => (
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
