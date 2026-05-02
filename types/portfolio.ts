export interface Holding {
  symbol: string;
  name?: string | null;
  quantity: number;
  costBasis?: number | null;
  marketPrice?: number | null;
  marketValue?: number | null;
  unrealizedPnL?: number | null;
  unrealizedPnLPct?: number | null;
  assetType?: "stock" | "etf" | "option" | "cash" | "other" | null;
  /** Broker-reported implied volatility (e.g. 41.08 means 41.08%) */
  iv?: number | null;
  /** Broker-reported per-share delta (long convention, decimal) */
  delta?: number | null;
  /** Any additional broker columns the parser captured. Keys are the column
   * labels as shown by the broker (e.g. "Bid", "Day Change %"); values are
   * primitives. */
  extras?: Record<string, string | number | null> | null;
}

export interface PortfolioSnapshot {
  totalValue?: number | null;
  cashBalance?: number | null;
  /** Broker-reported "as of" date from the screenshot, if visible. */
  asOf?: string | null;
  /** ISO timestamp of when the user uploaded this screenshot. */
  uploadedAt?: string | null;
  holdings: Holding[];
}

export interface UpcomingEvent {
  ticker?: string | null;
  type: "earnings" | "dividend" | "fomc" | "product" | "regulatory" | "other";
  date: string;
  note: string;
}

export interface PortfolioAnalysis {
  summary: string;
  concentrationRisk: string;
  diversification: string;
  notableObservations: string[];
  recommendations: PortfolioRecommendation[];
  ideas: PortfolioIdea[];
  events?: UpcomingEvent[];
}

export interface PortfolioRecommendation {
  title: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

export interface PortfolioIdea {
  name: string;
  thesis: string;
  structure: string;
  fitWith: string;
}
