import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  client = new Anthropic({ apiKey });
  return client;
}

export const VISION_MODEL = "claude-sonnet-4-6";
export const REASONING_MODEL = "claude-sonnet-4-6";
