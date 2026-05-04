// Remove markdown formatting from chat replies that are supposed to be plain
// text. Used by both the floating chat launcher and the inline trade chat.
export function stripFormatting(s: string): string {
  return s
    .replace(/```[\w]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
