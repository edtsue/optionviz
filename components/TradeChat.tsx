"use client";
import { useEffect, useRef, useState } from "react";
import type { Trade } from "@/types/trade";
import { detectStrategy } from "@/lib/strategies";
import { netGreeks, tradeStats } from "@/lib/payoff";
import { ClaudeMark } from "./ClaudeMark";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED = [
  "What's the worst-case scenario for this trade?",
  "Suggest a defensive adjustment",
  "Any earnings or catalysts before expiry?",
  "How exposed am I to a 5% drop in the stock?",
  "Should I roll this position?",
];

export function TradeChat({ trade }: { trade: Trade }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const ctx = buildContext(trade);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: ctx }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Chat failed (${res.status})`);
      }
      const { reply } = (await res.json()) as { reply: string };
      setMessages((m) => [...m, { role: "assistant", content: stripFormatting(reply) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="card card-tight flex w-full items-center justify-between text-left transition hover:border-accent/40"
      >
        <span className="flex items-center gap-2">
          <ClaudeMark size={16} className="text-[#d97757]" />
          <span className="text-sm font-semibold">Chat about this trade</span>
        </span>
        <span className="text-[11px] muted">Open ▸</span>
      </button>
    );
  }

  return (
    <div className="card card-tight space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <ClaudeMark size={16} className="text-[#d97757]" />
          <span className="label">Chat about this trade</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-accent/50"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-accent/50"
          >
            Close
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-soft max-h-80 overflow-y-auto">
        {messages.length === 0 && (
          <div className="rounded-lg border border-border bg-white/[0.02] p-3 text-xs muted">
            Ask anything about this position. Claude knows the symbol, legs, strikes, expiry, Greeks, and stats.
          </div>
        )}
        <div className="space-y-2 pt-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent/20 text-text"
                    : "border border-border bg-white/[0.03] text-text"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs muted">Thinking…</div>}
          {error && <div className="text-xs loss">{error}</div>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {SUGGESTED.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => send(p)}
            disabled={busy}
            className="rounded-md border border-border bg-white/[0.02] px-2 py-1 text-[11px] hover:border-accent/50"
          >
            {p}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this trade…"
          disabled={busy}
          className="flex-1 rounded-md border border-border bg-white/[0.02] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="btn-primary rounded-md px-3 py-2 text-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function buildContext(trade: Trade) {
  const strategy = detectStrategy(trade);
  let stats, greeks;
  try {
    stats = tradeStats(trade);
    greeks = netGreeks(trade);
  } catch {
    stats = undefined;
    greeks = undefined;
  }
  return {
    view: `Trade: ${trade.symbol} ${strategy.label}`,
    data: {
      symbol: trade.symbol,
      underlyingPrice: trade.underlyingPrice,
      strategy: strategy.label,
      bias: strategy.bias,
      legs: trade.legs.map((l) => ({
        side: l.side,
        type: l.type,
        strike: l.strike,
        expiration: l.expiration,
        qty: l.quantity,
        premium: l.premium,
        iv: l.iv != null ? +(l.iv * 100).toFixed(1) + "%" : null,
      })),
      shares: trade.underlying,
      stats: stats
        ? {
            cost: stats.cost,
            maxProfit: stats.maxProfit,
            maxLoss: stats.maxLoss,
            breakevens: stats.breakevens,
            popPct: stats.pop != null ? Math.round(stats.pop * 100) : null,
          }
        : null,
      netGreeks: greeks
        ? {
            delta: +(greeks.delta / 100).toFixed(4),
            theta: +greeks.theta.toFixed(2),
            vega: +greeks.vega.toFixed(2),
          }
        : null,
    },
  };
}

function stripFormatting(s: string): string {
  return s
    .replace(/```[\w]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
