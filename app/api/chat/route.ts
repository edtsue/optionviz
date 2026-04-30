import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are Claude embedded inside OptionViz, an options trade visualizer.

Output rules:
- Plain English only. No code blocks. No backticks. No markdown formatting (no **, no #, no tables). No JSON.
- Be terse. Default to 1-3 short sentences. Bullet lists only when the user explicitly asks for several distinct items, and use plain "- " prefixes (no markdown).
- No filler ("Great question", "Sure!", "Of course"). No restating the question.

You are given the user's current view as JSON context (the page they're on and any data loaded). Use it to ground your answers — refer to specific symbols, strikes, expiries, holdings, Greeks, or stats from the context when relevant. Mention values in plain English ("delta is +65"), not as code or JSON.

When relevant to the user's holdings or trades, proactively flag upcoming catalysts that could move the position: earnings, ex-dividend dates, FOMC meetings, product events, lockup expiries. Use your knowledge; if you're not sure of a date, say "around [quarter/month]" rather than guess.

Stay focused on options, equities, payoff structures, Greeks, IV, and risk. Decline politely if asked something outside that scope.`;

interface ChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = (await req.json()) as ChatRequest;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    // Inject the current view as a single short system-style message at the top
    // of the user thread to keep token usage tight.
    const trimmed = messages.slice(-12); // cap history
    const contextMessage = context
      ? [
          {
            role: "user" as const,
            content: `Current view (JSON):\n${JSON.stringify(context)}`,
          },
          {
            role: "assistant" as const,
            content: "Got it — I'll keep that in mind.",
          },
        ]
      : [];

    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [...contextMessage, ...trimmed],
    });

    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");

    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error("[chat] failed:", err);
    const m = err instanceof Error ? err.message : "chat failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
