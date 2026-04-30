import type { NetGreeks, TradeStats } from "@/lib/payoff";

interface Props {
  greeks: NetGreeks;
  stats: TradeStats;
}

function fmt(v: number | "unlimited", prefix = "$"): string {
  if (v === "unlimited") return "∞";
  return `${prefix}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function GreeksPanel({ greeks, stats }: Props) {
  const items: Array<[string, string, string?]> = [
    ["Net cost", fmt(stats.cost), stats.cost >= 0 ? "Debit" : "Credit"],
    ["Max profit", fmt(stats.maxProfit)],
    ["Max loss", fmt(stats.maxLoss)],
    ["Breakevens", stats.breakevens.length ? stats.breakevens.map((b) => `$${b}`).join(", ") : "—"],
    ["Margin (est)", fmt(stats.marginEstimate)],
    ["PoP", stats.pop != null ? `${(stats.pop * 100).toFixed(0)}%` : "—"],
  ];

  const greekItems: Array<[string, number, number]> = [
    ["Delta", greeks.delta, 2],
    ["Gamma", greeks.gamma, 4],
    ["Theta", greeks.theta, 2],
    ["Vega", greeks.vega, 2],
    ["Rho", greeks.rho, 2],
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="card space-y-3">
        <div className="label">Trade stats</div>
        <div className="grid grid-cols-2 gap-3">
          {items.map(([k, v, sub]) => (
            <div key={k}>
              <div className="text-xs text-gray-400">{k}</div>
              <div className="kpi">{v}</div>
              {sub && <div className="text-xs text-gray-500">{sub}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="card space-y-3">
        <div className="label">Net Greeks</div>
        <div className="grid grid-cols-2 gap-3">
          {greekItems.map(([k, v, dp]) => (
            <div key={k}>
              <div className="text-xs text-gray-400">{k}</div>
              <div className="kpi">{v.toFixed(dp)}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-500">
          Greeks are net per-position (×100 share multiplier already applied to dollar Greeks).
        </div>
      </div>
    </div>
  );
}
