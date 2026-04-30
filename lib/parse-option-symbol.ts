// Parse common broker option symbol formats into structured fields.
// Returns null when the input clearly isn't an option (plain stock ticker, cash, etc.).

export interface ParsedOption {
  underlying: string;
  expiration: string; // ISO YYYY-MM-DD
  strike: number;
  type: "call" | "put";
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseOptionSymbol(input: string | null | undefined): ParsedOption | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  // Format A — OCC: AAPL250719C00250000  (root + YYMMDD + C/P + 8-digit strike×1000)
  const occ = s.match(/^([A-Z.]+)\s*(\d{6})([CP])(\d{8})$/);
  if (occ) {
    const [, root, yymmdd, cp, strikeRaw] = occ;
    const yy = Number(yymmdd.slice(0, 2));
    const mm = Number(yymmdd.slice(2, 4));
    const dd = Number(yymmdd.slice(4, 6));
    const yyyy = yy + (yy < 50 ? 2000 : 1900);
    return {
      underlying: root,
      expiration: iso(yyyy, mm, dd),
      strike: Number(strikeRaw) / 1000,
      type: cp === "C" ? "call" : "put",
    };
  }

  // Format B — verbose: "AAPL Jul 19 2025 250 Call" / "AAPL Jul 19 250 C"
  const verbose = s.match(/^([A-Z.]+)[\s,]+([A-Za-z]{3,9})\s+(\d{1,2})(?:[\s,]+(\d{2,4}))?[\s,]+\$?(\d+(?:\.\d+)?)\s*(C(?:all)?|P(?:ut)?)$/i);
  if (verbose) {
    const [, root, monStr, dayStr, yrStr, strikeStr, cp] = verbose;
    const month = MONTHS[monStr.toLowerCase().slice(0, 3)];
    if (month != null) {
      const day = Number(dayStr);
      const now = new Date();
      let year = yrStr ? Number(yrStr) : now.getFullYear();
      if (year < 100) year += 2000;
      // If parsed date is in the past relative to today, assume next year
      if (!yrStr) {
        const candidate = new Date(year, month, day);
        if (candidate.getTime() < now.getTime() - 86_400_000) year += 1;
      }
      return {
        underlying: root,
        expiration: iso(year, month + 1, day),
        strike: Number(strikeStr),
        type: cp.toLowerCase().startsWith("c") ? "call" : "put",
      };
    }
  }

  // Format C — broker descriptions like "AAPL 07/19/2025 250.00 C"
  const slashed = s.match(/^([A-Z.]+)\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+\$?(\d+(?:\.\d+)?)\s*(C|P|Call|Put)$/i);
  if (slashed) {
    const [, root, mm, dd, yy, strikeStr, cp] = slashed;
    let year = Number(yy);
    if (year < 100) year += 2000;
    return {
      underlying: root,
      expiration: iso(year, Number(mm), Number(dd)),
      strike: Number(strikeStr),
      type: cp.toLowerCase().startsWith("c") ? "call" : "put",
    };
  }

  return null;
}

function iso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}
