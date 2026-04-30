"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import type { PayoffPoint } from "@/lib/payoff";

interface Props {
  data: PayoffPoint[];
  underlying: number;
  breakevens: number[];
  midLabel?: string;
}

export function PayoffChart({ data, underlying, breakevens, midLabel = "Mid" }: Props) {
  return (
    <div className="card">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="label">Payoff (P/L vs underlying)</div>
        <div className="flex gap-3 text-xs">
          <span className="text-gray-400">— Today</span>
          <span className="text-violet-400">— {midLabel}</span>
          <span className="text-white">— Expiry</span>
        </div>
      </div>
      <div className="h-72 w-full sm:h-96">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#222831" strokeDasharray="3 3" />
            <XAxis dataKey="spot" tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} width={56} />
            <Tooltip
              contentStyle={{ background: "#13171c", border: "1px solid #222831", borderRadius: 8 }}
              labelFormatter={(v) => `Underlying $${v}`}
              formatter={(v: number) => `$${v.toFixed(2)}`}
            />
            <ReferenceLine y={0} stroke="#4b5563" />
            <ReferenceLine
              x={underlying}
              stroke="#3b82f6"
              strokeDasharray="4 4"
              label={{ value: "now", fill: "#3b82f6", fontSize: 10, position: "insideTop" }}
            />
            {breakevens.map((b, i) => (
              <ReferenceLine key={i} x={b} stroke="#9ca3af" strokeDasharray="2 4" />
            ))}
            <Line type="monotone" dataKey="today" stroke="#6b7280" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="mid" stroke="#a78bfa" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="expiry" stroke="#e5e7eb" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
