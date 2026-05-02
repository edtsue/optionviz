export type OptionType = "call" | "put";
export type Side = "long" | "short";
export type Action = "buy_to_open" | "sell_to_open" | "buy_to_close" | "sell_to_close";

export interface Leg {
  id?: string;
  type: OptionType;
  side: Side;
  strike: number;
  expiration: string;
  quantity: number;
  premium: number;
  iv?: number | null;
}

export interface UnderlyingPosition {
  shares: number;
  costBasis: number;
}

export interface Trade {
  id?: string;
  symbol: string;
  underlyingPrice: number;
  riskFreeRate: number;
  legs: Leg[];
  underlying?: UnderlyingPosition | null;
  notes?: string | null;
  ticketImagePath?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type StrategyName =
  | "long_call"
  | "long_put"
  | "short_call"
  | "short_put"
  | "covered_call"
  | "cash_secured_put"
  | "vertical_spread"
  | "calendar_spread"
  | "straddle"
  | "strangle"
  | "iron_condor"
  | "butterfly"
  | "custom";

export interface DetectedStrategy {
  name: StrategyName;
  label: string;
  bias: "bullish" | "bearish" | "neutral" | "volatility";
}
