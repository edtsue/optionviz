// Curated watchlist for the Today → "Find earnings calls" button. Sourced
// from the user's Schwab "DryPowder" watchlist; ETFs/trusts (VTI, URA, BTC)
// were dropped because they don't report earnings. Spans tech, AI, space,
// nuclear energy, and finance — the themes the user cares about.
export const EARNINGS_WATCHLIST = [
  "RKLB",
  "INTC",
  "AMD",
  "AVGO",
  "TSLA",
  "NVDA",
  "GS",
  "OKLO",
  "ORCL",
  "GOOGL",
  "PLTR",
  "RTX",
  "TSM",
  "NFLX",
  "META",
  "ADBE",
  "JPM",
  "LLY",
] as const;

export type WatchlistTicker = (typeof EARNINGS_WATCHLIST)[number];
