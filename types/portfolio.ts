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
}

export interface PortfolioSnapshot {
  totalValue?: number | null;
  cashBalance?: number | null;
  asOf?: string | null;
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
