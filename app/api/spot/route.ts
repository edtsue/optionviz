import { NextRequest, NextResponse } from "next/server";
import { anthropic, REASONING_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM = `You fetch the latest stock/ETF price using the web_search tool.

Always call web_search first with a query like "<TICKER> stock price". Read the most recent quote from the results.

Reply with JSON ONLY (no prose, no code fences) in this exact shape:
{"price": <number>, "asOf": "<ISO 8601 timestamp or human-readable time>", "source": "<short source name>"}

If you cannot determine a current price, reply with: {"error": "<short reason>"}`;

interface SpotRequest {
  symbol?: string;
}

interface SpotJson {
  price?: number;
  asOf?: string;
  source?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { symbol } = (await req.json()) as SpotRequest;
    const ticker = symbol?.trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "symbol required" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await anthropic().messages.create({
      model: REASONING_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      messages: [
        {
          role: "user",
          content: `What is the latest trading price for ${ticker}? Return JSON only.`,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = resp.content ?? [];
    const text = blocks
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    const parsed = parseSpotJson(text);
    if (!parsed || parsed.error || typeof parsed.price !== "number") {
      return NextResponse.json(
        { error: parsed?.error ?? `Could not parse price for ${ticker}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      symbol: ticker,
      price: parsed.price,
      asOf: parsed.asOf ?? new Date().toISOString(),
      source: parsed.source ?? null,
    });
  } catch (err) {
    console.error("[spot] failed:", err);
    const m = err instanceof Error ? err.message : "spot failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

function parseSpotJson(text: string): SpotJson | null {
  if (!text) return null;
  // Strip code fences if Claude added them despite the instruction
  const stripped = text.replace(/```json\s*|```\s*/g, "").trim();
  try {
    return JSON.parse(stripped) as SpotJson;
  } catch {
    // Fall back to extracting the first {...} block
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as SpotJson;
    } catch {
      return null;
    }
  }
}
