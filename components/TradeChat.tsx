"use client";
import { memo, useEffect, useRef, useState } from "react";
import type { Trade } from "@/types/trade";
import { detectStrategy } from "@/lib/strategies";
import { perShareGreeks, tradeStats } from "@/lib/payoff";
import { resizeImage } from "@/lib/image";
import { stripFormatting } from "@/lib/strip-markdown";
import { usePortfolioShares, externalSharesFor } from "@/lib/use-portfolio-shares";
import { ClaudeMark } from "./ClaudeMark";

interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
interface TextBlock {
  type: "text";
  text: string;
}
type Content = string | Array<TextBlock | ImageBlock>;
interface Msg {
  role: "user" | "assistant";
  content: Content;
}

interface StagedImage {
  dataUrl: string;
  mediaType: string;
  base64: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
}

const SUGGESTED = [
  "What's the worst-case scenario for this trade?",
  "Suggest a defensive adjustment",
  "Any earnings or catalysts before expiry?",
  "How exposed am I to a 5% drop in the stock?",
  "Should I roll this position?",
];

function TradeChatImpl({ trade }: { trade: Trade }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portfolioShares = usePortfolioShares();
  const externalShares = externalSharesFor(portfolioShares, trade.symbol);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Paste-from-clipboard support — only when chat is open and focused-ish
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        attachFile(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  async function attachFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Only image files are supported");
      return;
    }
    setError(null);
    try {
      const r = await resizeImage(file);
      setStaged({
        dataUrl: r.dataUrl,
        mediaType: r.mediaType,
        base64: r.dataUrl.split(",")[1] ?? "",
        name: file.name || "image",
        width: r.width,
        height: r.height,
        bytes: r.resizedBytes,
      });
    } catch (e) {
      setError(e instanceof Error ? `Image processing failed: ${e.message}` : "Image processing failed");
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !staged) || busy) return;

    // Build the user message content. If an image is staged, send mixed blocks.
    let content: Content;
    if (staged) {
      const blocks: Array<TextBlock | ImageBlock> = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: staged.mediaType,
            data: staged.base64,
          },
        },
      ];
      if (trimmed) {
        blocks.push({ type: "text", text: trimmed });
      } else {
        blocks.push({ type: "text", text: "Take a look at this." });
      }
      content = blocks;
    } else {
      content = trimmed;
    }

    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setStaged(null);
    setBusy(true);
    setError(null);
    try {
      const ctx = buildContext(trade, externalShares);
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

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) attachFile(f);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="card card-tight rainbow-halo flex w-full items-center justify-between text-left transition"
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
    <div
      className="card card-tight rainbow-halo space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
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
          <div className="px-1 py-2 text-xs muted">
            Ask anything about this position. Drop / paste / attach an image (broker ticket, chart, headline) for visual context.
          </div>
        )}
        <div className="space-y-2 pt-2">
          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
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

      {staged && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-white/[0.02] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={staged.dataUrl}
            alt="Attached"
            className="h-12 w-12 rounded object-cover border border-border"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs">{staged.name}</div>
            <div className="text-[10px] muted">
              {staged.width}×{staged.height} · {(staged.bytes / 1024).toFixed(0)} KB
            </div>
          </div>
          <button
            onClick={() => setStaged(null)}
            disabled={busy}
            className="rounded-md border border-border px-2 py-1 text-[11px] hover:border-loss/50 hover:text-loss"
          >
            Remove
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Attach image"
          title="Attach image (drop or ⌘V also work)"
          className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent/50"
        >
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && attachFile(e.target.files[0])}
          className="hidden"
        />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          type="text"
          name="trade-chat-message"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder={staged ? "Add a question (optional)…" : "Ask anything about this trade…"}
          disabled={busy}
          className="flex-1 rounded-md border border-border bg-white/[0.02] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || (!input.trim() && !staged)}
          className="btn-primary rounded-md px-3 py-2 text-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// Memoize so unrelated parent state changes (e.g., the user clicking a row in
// the profit table) don't force the chat to re-render. The trade prop comes
// from a useMemo upstream so reference identity is stable across re-renders.
export const TradeChat = memo(TradeChatImpl);

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  const blocks: Array<TextBlock | ImageBlock> =
    typeof msg.content === "string"
      ? [{ type: "text", text: msg.content }]
      : msg.content;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] space-y-2 rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser ? "bg-accent/20 text-text" : "border border-border bg-white/[0.03] text-text"
        }`}
      >
        {blocks.map((b, i) =>
          b.type === "text" ? (
            <div key={i} className="whitespace-pre-wrap">
              {b.text}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={`data:${b.source.media_type};base64,${b.source.data}`}
              alt="Attached"
              className="max-h-48 rounded-md border border-border"
            />
          ),
        )}
      </div>
    </div>
  );
}

function buildContext(trade: Trade, externalShares = 0) {
  const strategy = detectStrategy(trade, { externalShares });
  let stats, greeks;
  try {
    stats = tradeStats(trade);
    greeks = perShareGreeks(trade);
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
      // Per-share Greeks (broker-comparable units): delta in [-1, 1], theta/vega in $/share.
      perShareGreeks: greeks
        ? {
            delta: +greeks.delta.toFixed(4),
            theta: +greeks.theta.toFixed(4),
            vega: +greeks.vega.toFixed(4),
          }
        : null,
    },
  };
}

