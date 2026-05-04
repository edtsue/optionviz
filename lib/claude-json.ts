// Tolerant JSON parser for Claude responses: strips ``` fences, recovers from
// truncated outputs by closing dangling brackets, and validates against a zod
// schema. Throws on unrecoverable failure.
import type { ZodType, output as ZodOutput } from "zod";

function strip(text: string): string {
  return text.replace(/```(?:json)?\s*|```/g, "").trim();
}

export function parseClaudeJsonRaw(text: string): unknown | null {
  if (!text) return null;
  const cleaned = strip(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to truncation-recovery path
  }

  // Try to find the largest prefix that parses, optionally appended with
  // closing brackets to repair truncation.
  for (let i = cleaned.length - 1; i > 100; i--) {
    const ch = cleaned[i];
    if (ch !== "}" && ch !== "]") continue;
    const candidate = cleaned.slice(0, i + 1);
    const opens = (candidate.match(/[{[]/g) ?? []).length;
    const closes = (candidate.match(/[}\]]/g) ?? []).length;
    if (opens > closes) {
      for (const closer of ["]}", "}]}", "]}]}", "}]}]}"]) {
        try {
          return JSON.parse(candidate + closer);
        } catch {
          // try next
        }
      }
    } else {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next
      }
    }
  }

  // Last resort: extract the first {…} block.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  return null;
}

export function parseClaudeJson<S extends ZodType>(text: string, schema: S): ZodOutput<S> {
  const raw = parseClaudeJsonRaw(text);
  if (raw == null) throw new Error("Claude returned no JSON");
  return schema.parse(raw) as ZodOutput<S>;
}
