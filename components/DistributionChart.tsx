"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PayoffPoint } from "@/lib/payoff";
import type { DistributionResult } from "@/lib/distribution";

interface Props {
  /** Spots paired with the expiry-payoff $ P/L. Drives the profit/loss
      shading underneath the density curve. */
  payoff: PayoffPoint[];
  /** Output of buildDistribution() over the same spot grid as `payoff`. */
  distribution: DistributionResult;
  underlying: number;
  breakevens: number[];
  stopSpot?: number | null;
  profitSpot?: number | null;
  /** Total P(net profit at expiry) — shown as the headline chip. */
  pProfit: number;
}

const RAIL = {
  spot: 14,
  stop: 30,
  profit: 46,
  beStart: 64,
  beStep: 14,
  sigma: 100,
} as const;

const COLORS = {
  density: "#a78bfa",
  fill: "rgba(167,139,250,0.18)",
  spot: "#a3e635",
  stop: "#f43f5e",
  profit: "#10b981",
  be: "#f59e0b",
  grid: "rgba(255,255,255,0.06)",
  axis: "#9ca3af",
  gain: "rgba(16,185,129,0.22)",
  loss: "rgba(244,63,94,0.18)",
  expected: "#22d3ee",
} as const;

function fmtMoney(v: number, big = false): string {
  if (big && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
}

interface Marker {
  x: number;
  color: string;
  label: string;
  offset: number;
  dashed?: boolean;
  bold?: boolean;
}

export function DistributionChart({
  payoff,
  distribution,
  underlying,
  breakevens,
  stopSpot,
  profitSpot,
  pProfit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const bumpLayout = () => setLayoutTick((t) => (t + 1) & 0xffff);

  // Columnar data for uPlot: [xs, density]. The profit/loss shading is
  // drawn in the canvas hook from the parallel `payoff` array.
  const series = useMemo(() => {
    const xs = distribution.points.map((p) => p.spot);
    const ys = distribution.points.map((p) => p.density);
    return [xs, ys] as const;
  }, [distribution]);

  // Indexed lookup of expiry $ P/L by spot index — same length as the
  // density grid because they were built off the same x.
  const expiryAtIdx = useMemo(() => payoff.map((p) => p.expiry), [payoff]);

  const markers = useMemo<Marker[]>(() => {
    const m: Marker[] = [
      {
        x: underlying,
        color: COLORS.spot,
        label: `Spot ${fmtMoney(underlying)}`,
        offset: RAIL.spot,
        dashed: true,
        bold: true,
      },
      {
        x: distribution.expected,
        color: COLORS.expected,
        label: `E[Sₜ] ${fmtMoney(distribution.expected)}`,
        offset: RAIL.spot + 16,
        dashed: true,
      },
    ];
    if (stopSpot != null) {
      m.push({
        x: stopSpot,
        color: COLORS.stop,
        label: `▼ Stop ${fmtMoney(stopSpot)}`,
        offset: RAIL.stop,
        dashed: true,
        bold: true,
      });
    }
    if (profitSpot != null) {
      m.push({
        x: profitSpot,
        color: COLORS.profit,
        label: `▲ Take ${fmtMoney(profitSpot)}`,
        offset: RAIL.profit,
        dashed: true,
        bold: true,
      });
    }
    breakevens.forEach((b, i) => {
      m.push({
        x: b,
        color: COLORS.be,
        label: `BE ${fmtMoney(b)}`,
        offset: RAIL.beStart + i * RAIL.beStep,
        dashed: true,
      });
    });
    return m;
  }, [underlying, distribution.expected, stopSpot, profitSpot, breakevens]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const initialW = el.clientWidth || 600;
    const initialH = el.clientHeight || 320;

    const opts: Options = {
      width: initialW,
      height: initialH,
      pxAlign: 0,
      cursor: {
        drag: { x: false, y: false, setScale: false },
        x: true,
        y: false,
        points: { show: false },
      },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: { auto: true, range: (_u, _min, max) => [0, max * 1.05] },
      },
      axes: [
        {
          stroke: COLORS.axis,
          grid: { stroke: COLORS.grid, dash: [3, 3] },
          ticks: { show: false },
          values: (_u, ticks) => ticks.map((t) => `$${t.toFixed(0)}`),
          font: '11px ui-sans-serif, system-ui, sans-serif',
          size: 28,
        },
        {
          show: false,
        },
      ],
      series: [
        {},
        {
          label: "Density",
          stroke: COLORS.density,
          fill: COLORS.fill,
          width: 2,
          points: { show: false },
        },
      ],
      hooks: {
        // Profit/loss shading on the x-axis strip beneath the density curve.
        // Reads the parallel expiry payoff series rather than the density,
        // so the shaded region matches the actual P/L sign at each spot.
        drawClear: [
          (u) => {
            const ctx = u.ctx;
            const { top, height } = u.bbox;
            const xs = u.data[0] as number[];
            if (!xs.length || expiryAtIdx.length !== xs.length) return;

            ctx.save();
            // Walk adjacent pairs and shade each segment by the sign of the
            // expiry payoff at the start of the segment. Simple, no edge
            // interpolation — good enough at 61 samples.
            for (let i = 0; i < xs.length - 1; i++) {
              const e = expiryAtIdx[i];
              if (e == null || e === 0) continue;
              const x1 = u.valToPos(xs[i], "x", true);
              const x2 = u.valToPos(xs[i + 1], "x", true);
              ctx.fillStyle = e > 0 ? COLORS.gain : COLORS.loss;
              ctx.fillRect(x1, top, x2 - x1, height);
            }
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
              return;
            }
            const xs = u.data[0] as number[];
            const x = xs[idx];
            const density = (u.data[1] as number[])[idx];
            const expiry = expiryAtIdx[idx] ?? 0;
            const pct = ((x - underlying) / underlying) * 100;
            const pctText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
            const tt = tooltipRef.current;
            if (tt) {
              tt.innerHTML = `
                <div style="font-weight:600;margin-bottom:2px">$${x.toFixed(2)} (${pctText})</div>
                <div>Density: ${density.toFixed(4)}</div>
                <div>Expiry P/L: ${expiry >= 0 ? "+" : "−"}$${Math.abs(expiry).toFixed(0)}</div>
              `;
              const cx = u.cursor.left ?? 0;
              const cy = u.cursor.top ?? 0;
              tt.style.left = `${cx + 12}px`;
              tt.style.top = `${cy + 12}px`;
              tt.style.opacity = "1";
            }
          },
        ],
      },
    };

    const u = new uPlot(opts, series as unknown as uPlot.AlignedData, el);
    plotRef.current = u;
    bumpLayout();

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w && h) {
        u.setSize({ width: w, height: h });
        bumpLayout();
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
    // Init only once — series update handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    u.setData(series as unknown as uPlot.AlignedData);
    bumpLayout();
  }, [series]);

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div className="label">
          Distribution (likelihood of underlying at expiry · lognormal)
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <ProbChip
            label="P(profit)"
            value={`${(pProfit * 100).toFixed(0)}%`}
            tone="gain"
          />
          {distribution.legItm.slice(0, 3).map((it, i) => (
            <ProbChip
              key={i}
              label={`P(ITM ${it.leg.type === "call" ? "C" : "P"}${it.leg.strike})`}
              value={`${(it.p * 100).toFixed(0)}%`}
              tone={it.leg.side === "short" ? "loss" : "gain"}
            />
          ))}
          {distribution.oneSigma && (
            <ProbChip
              label="±1σ"
              value={`${fmtMoney(distribution.oneSigma[0])} – ${fmtMoney(distribution.oneSigma[1])}`}
              tone="muted"
            />
          )}
        </div>
      </div>
      <div className="relative h-80 w-full sm:h-[28rem]">
        <div ref={containerRef} className="absolute inset-0" />
        <MarkerOverlay
          markers={markers}
          plotRef={plotRef}
          dataXs={series[0]}
          layoutTick={layoutTick}
        />
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-20 rounded-md border border-border bg-bg/95 px-2 py-1 text-[11px] backdrop-blur"
          style={{ opacity: 0, transition: "opacity 80ms" }}
        />
      </div>
    </div>
  );
}

function ProbChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "gain" | "loss" | "muted";
}) {
  const cls =
    tone === "gain"
      ? "border-gain/40 bg-gain/10 gain"
      : tone === "loss"
        ? "border-loss/40 bg-loss/10 loss"
        : "border-border bg-white/[0.02] muted";
  return (
    <span className={`rounded-md border px-2 py-0.5 tabular-nums ${cls}`}>
      <span className="opacity-80">{label} </span>
      <strong className="ml-1">{value}</strong>
    </span>
  );
}

function MarkerOverlay({
  markers,
  plotRef,
  dataXs,
  layoutTick,
}: {
  markers: Marker[];
  plotRef: React.MutableRefObject<uPlot | null>;
  dataXs: readonly number[];
  layoutTick: number;
}) {
  void layoutTick;
  const u = plotRef.current;
  if (!u || !u.bbox) return null;
  const dpr = typeof window !== "undefined" ? devicePixelRatio || 1 : 1;
  const { top, height } = u.bbox;
  const minX = dataXs[0];
  const maxX = dataXs[dataXs.length - 1];
  const topPx = top / dpr;
  const heightPx = height / dpr;
  return (
    <>
      {markers.map((m, i) => {
        if (m.x < minX || m.x > maxX) return null;
        const px = u.valToPos(m.x, "x", true) / dpr;
        return (
          <div key={i} className="pointer-events-none absolute inset-0">
            <div
              style={{
                position: "absolute",
                left: px,
                top: topPx,
                width: 0,
                height: heightPx,
                borderLeft: `${m.bold ? 2 : 1.25}px ${m.dashed ? "dashed" : "solid"} ${m.color}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: px + 6,
                top: topPx + m.offset,
                color: m.color,
                fontSize: 11,
                fontWeight: m.bold ? 700 : 600,
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </div>
          </div>
        );
      })}
    </>
  );
}
