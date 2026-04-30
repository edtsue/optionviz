"use client";
import { useState } from "react";
import type { Trade } from "@/types/trade";

interface Idea {
  name: string;
  bias: string;
  thesis: string;
  structure: string | object;
  tradeoffs: string;
  whenToConsider: string;
}

export function IdeasPanel({ trade }: { trade: Trade }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trade),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Ideas failed (${res.status})`);
      }
      const data = await res.json();
      setIdeas(data.ideas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="label">Ideas to consider</div>
        <button onClick={load} disabled={busy} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
          {busy ? "Thinking…" : ideas ? "Regenerate" : "Generate"}
        </button>
      </div>
      {error && <div className="text-sm text-loss">{error}</div>}
      {!ideas && !error && (
        <p className="text-sm text-gray-400">
          Get 3 alternative structures or adjustments based on the current position. Requires
          ANTHROPIC_API_KEY.
        </p>
      )}
      {ideas && (
        <ul className="space-y-3">
          {ideas.map((it, i) => (
            <li key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{it.name}</div>
                <span className="rounded-md border border-border px-2 py-0.5 text-xs text-gray-300">
                  {it.bias}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-300">{it.thesis}</p>
              <div className="mt-2 text-xs text-gray-400">
                <div className="font-mono whitespace-pre-wrap">
                  {typeof it.structure === "string" ? it.structure : JSON.stringify(it.structure, null, 2)}
                </div>
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
