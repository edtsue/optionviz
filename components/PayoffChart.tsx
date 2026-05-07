"use client";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  CartesianGrid,
} from "recharts";
import type { PayoffPoint } from "@/lib/payoff";

interface Props {
  data: PayoffPoint[];
  underlying: number;
  breakevens: number[];
  midLabel?: string;
  /** Optional 1σ band edges from current spot at expiry (lower, upper) */
  oneSigmaBand?: [number, number] | null;
  /** Locked scrub spot (vertical line + readout); null = follow cursor only */
  scrubSpot?: number | null;
  onScrub?: (spot: number | null) => void;
  /** BTC stop trigger spot — drawn as a labeled red ReferenceLine */
  stopSpot?: number | null;
  /** Multiplier label suffix (e.g., "2.0x"). */
  stopMultiplierLabel?: string;
  /** Dollar P/L if the BTC stop is hit at stopSpot (typically negative). */
  stopLoss?: number | null;
}

export function PayoffChart({
  data,
  underlying,
  breakevens,
  midLabel = "Mid",
  oneSigmaBand,
  scrubSpot,
  onScrub,
  stopSpot,
  stopMultiplierLabel,
  stopLoss,
}: Props) {
  // Build positive/negative envelopes from the expiry curve so we can shade
  // the gain and loss zones behind the lines.
  const shaded = data.map((p) => ({
    ...p,
    posExpiry: p.expiry > 0 ? p.expiry : 0,
    negExpiry: p.expiry < 0 ? p.expiry : 0,
  }));

  const pctFromSpot = (v: number) => ((v - underlying) / underlying) * 100;

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div className="label">Payoff (P/L vs underlying)</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] muted">
          <Legend dot="#6b7280" label="Today" />
          <Legend dot="#a78bfa" label={midLabel} />
          <Legend dot="#e5e7eb" label="Expiry" />
        </div>
      </div>
      <div className="h-80 w-full sm:h-[28rem]">
        <ResponsiveContainer>
          <ComposedChart
            data={shaded}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
            onMouseMove={(state: { activeLabel?: number | string }) => {
              if (!onScrub) return;
              const v = state?.activeLabel;
              if (typeof v === "number") onScrub(v);
              else if (typeof v === "string") {
                const n = parseFloat(v);
                if (Number.isFinite(n)) onScrub(n);
              }
            }}
          >
            <defs>
              <linearGradient id="gainFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="lossFill" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
            <XAxis
              dataKey="spot"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              tickFormatter={(v: number) => `$${v}`}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              width={64}
              tickFormatter={(v: number) =>
                Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
              }
            />
            <Tooltip
              contentStyle={{
                background: "rgba(15, 18, 24, 0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                fontSize: 12,
              }}
              labelFormatter={(v: number) =>
                `Underlying $${v.toFixed(2)} (${pctFromSpot(v) >= 0 ? "+" : ""}${pctFromSpot(v).toFixed(1)}% from spot)`
              }
              formatter={(v: number, name: string) => {
                if (name === "posExpiry" || name === "negExpiry") return null as never;
                const sign = v >= 0 ? "+" : "−";
                return [`${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, prettyName(name)];
              }}
            />

            {/* 1σ probability band (background rectangle) */}
            {oneSigmaBand && (
              <ReferenceArea
                x1={oneSigmaBand[0]}
                x2={oneSigmaBand[1]}
                fill="rgb(var(--accent-rgb))"
                fillOpacity={0.04}
                stroke="rgb(var(--accent-rgb))"
                strokeOpacity={0.25}
                strokeDasharray="2 4"
                label={{
                  value: "±1σ at expiry",
                  position: "insideTop",
                  fill: "rgb(var(--accent-rgb))",
                  fontSize: 10,
                }}
              />
            )}

            {/* Profit/loss zone shading from expiry curve */}
            <Area
              type="monotone"
              dataKey="posExpiry"
              stroke="none"
              fill="url(#gainFill)"
              isAnimationActive={false}
              tooltipType="none"
              legendType="none"
            />
            <Area
              type="monotone"
              dataKey="negExpiry"
              stroke="none"
              fill="url(#lossFill)"
              isAnimationActive={false}
              tooltipType="none"
              legendType="none"
            />

            <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />

            {/* Spot price line */}
            <ReferenceLine
              x={underlying}
              stroke="rgb(var(--accent-rgb))"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              label={{
                value: `Spot $${underlying.toFixed(2)}`,
                position: "top",
                fill: "rgb(var(--accent-rgb))",
                fontSize: 11,
                fontWeight: 600,
              }}
            />

            {/* Scrub line — user-driven what-if */}
            {scrubSpot != null && (
              <ReferenceLine
                x={scrubSpot}
                stroke="#fbbf24"
                strokeWidth={2}
                label={{
                  value: `$${scrubSpot.toFixed(2)}`,
                  position: "insideBottomLeft",
                  fill: "#fbbf24",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}

            {/* BTC stop trigger — vertical red line w/ arrowhead + loss readout */}
            {stopSpot != null && (
              <ReferenceLine
                x={stopSpot}
                stroke="#f43f5e"
                strokeWidth={2}
                strokeDasharray="6 3"
                label={(labelProps: {
                  viewBox?: { x?: number; y?: number; width?: number; height?: number };
                }) => {
                  const vb = labelProps?.viewBox ?? {};
                  const cx = typeof vb.x === "number" ? vb.x : 0;
                  const top = (typeof vb.y === "number" ? vb.y : 0) + 4;
                  const lossText =
                    stopLoss != null
                      ? `${stopLoss < 0 ? "−" : "+"}$${Math.abs(stopLoss).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      : null;
                  const headline = stopMultiplierLabel
                    ? `Stop ${stopMultiplierLabel} · $${stopSpot.toFixed(2)}`
                    : `Stop $${stopSpot.toFixed(2)}`;
                  return (
                    <g pointerEvents="none">
                      <polygon
                        points={`${cx - 6},${top} ${cx + 6},${top} ${cx},${top + 10}`}
                        fill="#f43f5e"
                      />
                      <text
                        x={cx + 10}
                        y={top + 9}
                        fill="#f43f5e"
                        fontSize={11}
                        fontWeight={700}
                      >
                        {headline}
                      </text>
                      {lossText && (
                        <text
                          x={cx + 10}
                          y={top + 22}
                          fill="#f43f5e"
                          fontSize={11}
                          fontWeight={600}
                        >
                          {lossText}
                        </text>
                      )}
                    </g>
                  );
                }}
              />
            )}

            {/* Breakeven lines, always labeled */}
            {breakevens.map((b, i) => (
              <ReferenceLine
                key={`be-${i}`}
                x={b}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                strokeWidth={1.25}
                label={{
                  value: `BE $${b.toFixed(2)}`,
                  position: i % 2 === 0 ? "insideTopRight" : "insideBottomRight",
                  fill: "#f59e0b",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            ))}

            {/* Curves */}
            <Line type="monotone" dataKey="today" stroke="#6b7280" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="mid" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="expiry" stroke="#e5e7eb" strokeWidth={2.25} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-textDim">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: dot }} />
      {label}
    </span>
  );
}

function prettyName(k: string): string {
  if (k === "expiry") return "At expiry";
  if (k === "today") return "Today";
  if (k === "mid") return "Mid";
  return k;
}
