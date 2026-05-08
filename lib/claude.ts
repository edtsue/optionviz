import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (client) return client;
  const raw = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  const apiKey = raw?.trim();
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY or CLAUDE_API_KEY");
  client = new Anthropic({ apiKey });
  return client;
}

export const VISION_MODEL = "claude-sonnet-4-6";
export const REASONING_MODEL = "claude-sonnet-4-6";
// Cheap workhorse for fan-out routes (e.g. /api/earnings web_search backfill)
// where we'd burn Sonnet budget on dozens of low-difficulty lookups.
export const CHEAP_MODEL = "claude-haiku-4-5-20251001";
