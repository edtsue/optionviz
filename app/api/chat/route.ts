import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, REASONING_MODEL } from "@/lib/claude";
import { ALLOWED_MEDIA_TYPES, MAX_IMAGE_BASE64_LEN } from "@/lib/api-validate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are Claude embedded inside OptionViz, an options trade visualizer.

Output rules:
- Plain English only. No code blocks. No backticks. No markdown formatting (no **, no #, no tables). No JSON.
- Be terse. Default to 1-3 short sentences. Bullet lists only when the user explicitly asks for several distinct items, and use plain "- " prefixes (no markdown).
- No filler ("Great question", "Sure!", "Of course"). No restating the question.

You are given the user's current view as JSON context (the page they're on and any data loaded). Use it to ground your answers — refer to specific symbols, strikes, expiries, holdings, Greeks, or stats from the context when relevant. Mention values in plain English ("delta is +65"), not as code or JSON.

When the user attaches an image, read it carefully and reference what you see directly. Common attachments: broker order tickets, portfolio screenshots, payoff charts, headlines.

When relevant to the user's holdings or trades, proactively flag upcoming catalysts that could move the position: earnings, ex-dividend dates, FOMC meetings, product events, lockup expiries. Use your knowledge; if you're not sure of a date, say "around [quarter/month]" rather than guess.

Stay focused on options, equities, payoff structures, Greeks, IV, and risk. Decline politely if asked something outside that scope.`;

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(20_000),
});
const ImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    media_type: z.enum(ALLOWED_MEDIA_TYPES),
    data: z.string().max(MAX_IMAGE_BASE64_LEN),
  }),
});
const ContentSchema = z.union([z.string().max(20_000), z.array(z.union([TextBlockSchema, ImageBlockSchema])).max(8)]);
const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: ContentSchema,
});
const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(20),
  context: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`chat:${clientIp(req)}`, 60, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = ChatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid request" },
        { status: 400 },
      );
    }
    const { messages, context } = parsed.data;

    const trimmed = messages.slice(-12);
    const sdkMessages: Anthropic.MessageParam[] = trimmed.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((b) =>
              b.type === "text"
                ? { type: "text" as const, text: b.text }
                : {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: b.source.media_type,
                      data: b.source.data,
                    },
                  },
            ),
    }));

    // Build a multi-block system so we can prompt-cache the (large) per-page
    // context across multi-turn chats. The cache_control mark is on the LAST
    // block of the prefix we want cached. On follow-up turns within the 5-min
    // TTL, system + context replay as a cache hit; only the new user turn
    // pays full input price.
    const systemBlocks: Anthropic.TextBlockParam[] = [{ type: "text", text: SYSTEM }];
    if (context !== undefined) {
      systemBlocks.push({
        type: "text",
        text: `Current view (JSON):\n${JSON.stringify(context).slice(0, 50_000)}`,
        cache_control: { type: "ephemeral" },
      });
    } else {
      systemBlocks[0].cache_control = { type: "ephemeral" };
    }

    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 800,
      system: systemBlocks,
      messages: sdkMessages,
    });

    const text = resp.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error("[chat] failed:", err);
    const m = err instanceof Error ? err.message : "chat failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
