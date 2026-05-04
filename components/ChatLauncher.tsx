"use client";
import { useEffect, useRef, useState } from "react";
import { useChatContext } from "@/lib/chat-context";
import { stripFormatting } from "@/lib/strip-markdown";
import { ClaudeMark } from "./ClaudeMark";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx = useChatContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          context: ctx.current ? { view: ctx.current.label, data: ctx.current.data } : null,
        }),
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

  return (
    <>
      {/* Floating launcher — bottom-right corner */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Chat with Claude"
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border shadow-xl transition hover:scale-105"
        style={{
          background: "#f5f1ea",
          color: "#d97757",
          borderColor: "rgba(217, 119, 87, 0.4)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4), 0 0 0 6px rgba(217, 119, 87, 0.16)",
        }}
      >
        <ClaudeMark size={22} />
      </button>

      {/* Chat panel — anchored bottom-right next to launcher on desktop */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col md:bottom-20 md:left-auto md:right-4 md:max-h-[70vh] md:w-[400px] md:rounded-2xl">
          <div className="card card-flush flex h-[70vh] flex-col overflow-hidden md:h-[600px]">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <ClaudeMark size={16} className="text-[#d97757]" />
                <div>
                  <div className="text-sm font-semibold">Ask Claude</div>
                  <div className="text-[10px] muted">
                    {ctx.current ? `Context: ${ctx.current.label}` : "No view context"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="rounded-md border border-border px-2 py-1 text-[11px] hover:border-accent/50"
                    title="Clear conversation"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent/50"
                  aria-label="Close chat"
                >
                  ×
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="scroll-soft flex-1 overflow-y-auto p-3">
              {messages.length === 0 && (
                <div className="space-y-3 text-sm">
                  <p className="muted">
                    Ask about your current trade or portfolio. I&rsquo;ll keep responses tight.
                  </p>
                  <div className="grid gap-1.5">
                    <SuggestedPrompt onClick={setInput} text="What's the worst-case scenario?" />
                    <SuggestedPrompt onClick={setInput} text="Any earnings before expiry?" />
                    <SuggestedPrompt onClick={setInput} text="Suggest a defensive adjustment" />
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-accent/20 text-text"
                        : "bg-white/[0.04] text-text"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && <div className="text-xs muted">Thinking…</div>}
              {error && <div className="text-xs loss">{error}</div>}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex gap-2 border-t border-border p-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this view…"
                className="flex-1 rounded-lg px-3 py-2 text-sm"
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="btn-primary rounded-lg px-3 py-2 text-sm"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function SuggestedPrompt({ text, onClick }: { text: string; onClick: (s: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-left text-sm hover:border-accent/40"
    >
      {text}
    </button>
  );
}
