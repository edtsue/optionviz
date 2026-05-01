import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { anthropic, VISION_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const HoldingSchema = z.object({
  symbol: z.string().nullish().transform((v) => v ?? ""),
  name: z.string().nullish(),
  quantity: z.coerce.number().nullish().transform((v) => v ?? 0),
  costBasis: z.coerce.number().nullish(),
  marketPrice: z.coerce.number().nullish(),
  marketValue: z.coerce.number().nullish(),
  unrealizedPnL: z.coerce.number().nullish(),
  unrealizedPnLPct: z.coerce.number().nullish(),
  assetType: z.enum(["stock", "etf", "option", "cash", "other"]).nullish(),
  iv: z.coerce.number().nullish(),
  delta: z.coerce.number().nullish(),
});

const PortfolioSchema = z.object({
  totalValue: z.coerce.number().nullish(),
  cashBalance: z.coerce.number().nullish(),
  asOf: z.string().nullish(),
  holdings: z.array(HoldingSchema),
});

const SYSTEM = `You are a portfolio screenshot parser. Extract holdings from a brokerage portfolio/positions screenshot (Schwab, Fidelity, Robinhood, IBKR, ToS, Tastytrade, Vanguard, etc.).

For each holding, extract:
- symbol: ticker (or "CASH" for cash positions). Include the full option descriptor when it's an option (e.g. "AMZN 05/01/2026 262.50 C").
- name: full name if shown (else null)
- quantity: shares/contracts (number; negative for short option positions)
- costBasis: per-share cost (if shown) — total cost / quantity
- marketPrice: per-share/per-contract price (e.g. \$0.665 for an option, NOT the contract value of \$66.50)
- marketValue: total market value of the position (typically marketPrice × quantity × 100 for options)
- unrealizedPnL: \$ unrealized P/L if shown
- unrealizedPnLPct: % unrealized P/L if shown
- assetType: "stock" | "etf" | "option" | "cash" | "other"
- iv: implied volatility AS A PERCENT (e.g. 41.08 — not 0.4108). Many brokers show this in an "IV" column for option rows. null if not shown.
- delta: per-share option delta IN DECIMAL (e.g. 0.1158, or -0.1278 for a put). Long-convention regardless of position side. Many brokers show this in a "Delta" column. null if not shown.

Also extract totalValue (account total) and cashBalance if visible. Return ISO date for asOf if shown.

Return ONLY a JSON object:
{ "totalValue": number|null, "cashBalance": number|null, "asOf": string|null, "holdings": [...] }
No prose, no markdown.`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mediaType } = (await req.json()) as {
      imageBase64: string;
      mediaType: string;
    };
    if (!imageBase64 || !mediaType) {
      return NextResponse.json({ error: "imageBase64 and mediaType required" }, { status: 400 });
    }

    const resp = await anthropic().messages.create({
      model: VISION_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            { type: "text", text: "Extract all holdings. Return JSON only." },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("\n");

    const parsed = PortfolioSchema.parse(extractJson(text));
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[parse-portfolio] failed:", err);
    const m = err instanceof Error ? err.message : "parse failed";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
