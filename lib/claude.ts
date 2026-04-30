import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY or CLAUDE_API_KEY");
  client = new Anthropic({ apiKey });
  return client;
}

export const VISION_MODEL = "claude-sonnet-4-6";
export const REASONING_MODEL = "claude-sonnet-4-6";
