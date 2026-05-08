"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PayoffPoint } from "@/lib/payoff";

interface Props {
  data: PayoffPoint[];
  underlying: number;
  breakevens: number[];
  midLabel?: string;
  oneSigmaBand?: [number, number] | null;
  stopSpot?: number | null;
  stopLoss?: number | null;
  profitSpot?: number | null;
  profitGain?: number | null;
}

// Top-margin rail for vertical-line callouts. Each row is a y-pixel offset
// from the top of the plot canvas, measured downward. Reproduces the stacked
// rail we built on top of recharts so labels never collide horizontally.
const RAIL = {
  spot: 14,
  stop: 30,
  profit: 46,
  beStart: 64,
  beStep: 14,
  sigma: 100,
} as const;

const COLORS = {
  today: "#6b7280",
  mid: "#a78bfa",
  expiry: "#e5e7eb",
  spot: "#a3e635",
  scrub: "#fbbf24",
  stop: "#f43f5e",
  profit: "#10b981",
  be: "#f59e0b",
  grid: "rgba(255,255,255,0.06)",
  axis: "#9ca3af",
  zero: "rgba(255,255,255,0.25)",
  gain: "rgba(16,185,129,0.18)",
  loss: "rgba(244,63,94,0.18)",
} as const;

function fmtMoney(v: number, big = false): string {
  if (big && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (big) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

function fmtSigned(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface Marker {
  x: number;
  color: string;
  label: string;
  /** y-pixel offset from top of plotting area (rail row). */
  offset: number;
  dashed?: boolean;
  bold?: boolean;
}

export function PayoffChart({
  data,
  underlying,
  breakevens,
  midLabel = "Mid",
  oneSigmaBand,
  stopSpot,
  stopLoss,
  profitSpot,
  profitGain,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [scrubSpot, setScrubSpot] = useState<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Full data x-range (refreshed on every setData) — used as the clamp
  // for zoom-out and as the target for double-click reset.
  const xRangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });
  // Bumped on plot init, setData, and resize so the marker overlay re-reads
  // the plot's bbox / x-scale and reflows its labels. Replaces a runaway
  // requestAnimationFrame loop that was re-rendering at 60fps forever.
  const [layoutTick, setLayoutTick] = useState(0);
  const bumpLayout = () => setLayoutTick((t) => (t + 1) & 0xffff);

  // uPlot wants columnar data: [xs, today, mid, expiry].
  const series = useMemo(() => {
    const xs = data.map((p) => p.spot);
    const today = data.map((p) => p.today);
    const mid = data.map((p) => p.mid);
    const expiry = data.map((p) => p.expiry);
    return [xs, today, mid, expiry] as const;
  }, [data]);

  const markers = useMemo<Marker[]>(() => {
    const m: Marker[] = [];
    m.push({
      x: underlying,
      color: COLORS.spot,
      label: `Spot ${fmtMoney(underlying)}`,
      offset: RAIL.spot,
      dashed: true,
      bold: true,
    });
    if (stopSpot != null) {
      const lossText = stopLoss != null ? ` · ${fmtSigned(stopLoss)}` : "";
      m.push({
        x: stopSpot,
        color: COLORS.stop,
        label: `▼ Stop ${fmtMoney(stopSpot)}${lossText}`,
        offset: RAIL.stop,
        dashed: true,
        bold: true,
      });
    }
    if (profitSpot != null) {
      const gainText = profitGain != null ? ` · ${fmtSigned(profitGain)}` : "";
      m.push({
        x: profitSpot,
        color: COLORS.profit,
        label: `▲ Take ${fmtMoney(profitSpot)}${gainText}`,
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
    if (scrubSpot != null) {
      m.push({
        x: scrubSpot,
        color: COLORS.scrub,
        label: `Cursor ${fmtMoney(scrubSpot)}`,
        offset: RAIL.spot,
        bold: true,
      });
    }
    return m;
  }, [underlying, stopSpot, stopLoss, profitSpot, profitGain, breakevens, scrubSpot]);

  function scheduleScrub(v: number | null) {
    pendingScrubRef.current = v;
    if (scrubRafRef.current != null) return;
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      setScrubSpot(pendingScrubRef.current);
    });
  }

  // Init plot once. Later renders update via setData; markers re-render on
  // their own via React DOM. Tearing down the plot on every prop change
  // would defeat the entire reason we switched off recharts.
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
        y: { auto: true },
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
          stroke: COLORS.axis,
          grid: { stroke: COLORS.grid, dash: [3, 3] },
          ticks: { show: false },
          values: (_u, ticks) => ticks.map((t) => fmtMoney(t, true)),
          font: '11px ui-sans-serif, system-ui, sans-serif',
          size: 56,
        },
      ],
      series: [
        {},
        // points.show: false on every series — uPlot's default shows dots at
        // each sample when data density is low (we use 61 points), which the
        // recharts version never had. Forcing them off keeps the lines clean.
        { label: "Today", stroke: COLORS.today, width: 1.5, points: { show: false } },
        { label: midLabel, stroke: COLORS.mid, width: 2, points: { show: false } },
        { label: "Expiry", stroke: COLORS.expiry, width: 2.25, points: { show: false } },
      ],
      hooks: {
        // Draw the gain/loss shading + ±1σ band + zero baseline before the
        // series strokes are painted on top.
        drawClear: [
          (u) => {
            const ctx = u.ctx;
            const dpr = devicePixelRatio || 1;
            const { left, top, width, height } = u.bbox;
            const xs = u.data[0] as number[];
            const expiry = u.data[3] as number[] | undefined;
            if (!expiry || !xs.length) return;

            ctx.save();

            if (oneSigmaBand) {
              const x1 = u.valToPos(oneSigmaBand[0], "x", true);
              const x2 = u.valToPos(oneSigmaBand[1], "x", true);
              ctx.fillStyle = "rgba(163,230,53,0.04)";
              ctx.strokeStyle = "rgba(163,230,53,0.25)";
              ctx.setLineDash([2, 4]);
              ctx.lineWidth = 1 * dpr;
              ctx.beginPath();
              ctx.rect(x1, top, x2 - x1, height);
              ctx.fill();
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = "rgba(163,230,53,0.7)";
              ctx.font = `${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
              ctx.textBaseline = "top";
              ctx.fillText("±1σ at expiry", x1 + 6 * dpr, top + RAIL.sigma * dpr);
            }

            const y0 = u.valToPos(0, "y", true);

            // Gain region: between expiry curve (above 0) and y=0.
            ctx.fillStyle = COLORS.gain;
            ctx.beginPath();
            ctx.moveTo(u.valToPos(xs[0], "x", true), y0);
            for (let i = 0; i < xs.length; i++) {
              const ex = expiry[i];
              if (ex == null || isNaN(ex)) continue;
              const px = u.valToPos(xs[i], "x", true);
              const py = u.valToPos(Math.max(ex, 0), "y", true);
              ctx.lineTo(px, py);
            }
            ctx.lineTo(u.valToPos(xs[xs.length - 1], "x", true), y0);
            ctx.closePath();
            ctx.fill();

            // Loss region: between expiry curve (below 0) and y=0.
            ctx.fillStyle = COLORS.loss;
            ctx.beginPath();
            ctx.moveTo(u.valToPos(xs[0], "x", true), y0);
            for (let i = 0; i < xs.length; i++) {
              const ex = expiry[i];
              if (ex == null || isNaN(ex)) continue;
              const px = u.valToPos(xs[i], "x", true);
              const py = u.valToPos(Math.min(ex, 0), "y", true);
              ctx.lineTo(px, py);
            }
            ctx.lineTo(u.valToPos(xs[xs.length - 1], "x", true), y0);
            ctx.closePath();
            ctx.fill();

            // y=0 baseline.
            ctx.strokeStyle = COLORS.zero;
            ctx.lineWidth = 1 * dpr;
            ctx.beginPath();
            ctx.moveTo(left, y0);
            ctx.lineTo(left + width, y0);
            ctx.stroke();

            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0) {
              scheduleScrub(null);
              if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
              return;
            }
            const xs = u.data[0] as number[];
            const x = xs[idx];
            scheduleScrub(x);
            const today = (u.data[1] as number[])[idx];
            const mid = (u.data[2] as number[])[idx];
            const expiry = (u.data[3] as number[])[idx];
            const tt = tooltipRef.current;
            if (tt) {
              const pct = ((x - underlying) / underlying) * 100;
              const pctText = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
              tt.innerHTML = `
                <div style="font-weight:600;margin-bottom:2px">$${x.toFixed(2)} (${pctText})</div>
                <div>Today: ${fmtSigned(today)}</div>
                ${midLabel !== "Today" ? `<div>${midLabel}: ${fmtSigned(mid)}</div>` : ""}
                <div>At expiry: ${fmtSigned(expiry)}</div>
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
    // First marker layout pass after the plot has computed its bbox.
    bumpLayout();

    // Initialize the data-range ref from the first series. Updated on each
    // setData (see series useEffect below).
    const xs0 = series[0];
    xRangeRef.current = { min: xs0[0], max: xs0[xs0.length - 1] };

    // Zoom handler: anchored to the cursor's x position so the underlying
    // value under the pointer stays put while the range expands/contracts.
    // dirSign > 0 = zoom out, < 0 = zoom in.
    function zoomAtCursor(dirSign: number, intensity: number) {
      const scale = u.scales.x;
      if (scale.min == null || scale.max == null) return;
      const cursorLeft = u.cursor.left ?? -1;
      const anchorVal =
        cursorLeft >= 0
          ? u.posToVal(cursorLeft, "x")
          : (scale.min + scale.max) / 2;
      const factor = Math.exp(dirSign * intensity);
      const newMin = anchorVal - (anchorVal - scale.min) * factor;
      const newMax = anchorVal + (scale.max - anchorVal) * factor;
      const { min: dataMin, max: dataMax } = xRangeRef.current;
      const minSpan = (dataMax - dataMin) * 0.01;
      if (newMax - newMin < minSpan) return;
      const clampedMin = Math.max(newMin, dataMin);
      const clampedMax = Math.min(newMax, dataMax);
      if (clampedMax - clampedMin < minSpan) return;
      u.setScale("x", { min: clampedMin, max: clampedMax });
      bumpLayout();
    }

    function onWheel(e: WheelEvent) {
      // ctrlKey = true on Mac trackpad pinch gestures (the OS synthesizes
      // wheel-with-ctrl). Plain wheel without modifiers also zooms — feels
      // natural on charts and matches uPlot's reference plugin.
      e.preventDefault();
      const perPixel = e.ctrlKey ? 0.012 : 0.0015;
      const dirSign = e.deltaY > 0 ? 1 : -1;
      const intensity = Math.min(0.3, Math.abs(e.deltaY) * perPixel);
      zoomAtCursor(dirSign, intensity);
    }

    function onDblClick() {
      const { min, max } = xRangeRef.current;
      u.setScale("x", { min, max });
      bumpLayout();
    }

    // Hold-and-drag pan: click + drag horizontally translates the x-domain.
    // Pan is clamped so the user cannot drag past the full data range.
    // We also bypass uPlot's hover scrub during a pan gesture.
    let panStart: { x: number; min: number; max: number } | null = null;
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const scale = u.scales.x;
      if (scale.min == null || scale.max == null) return;
      panStart = { x: e.clientX, min: scale.min, max: scale.max };
      el.style.cursor = "grabbing";
      e.preventDefault();
    }
    function onMouseMove(e: MouseEvent) {
      if (!panStart) return;
      const bbox = u.bbox;
      const plotWidth = bbox.width / (devicePixelRatio || 1);
      if (plotWidth <= 0) return;
      const span = panStart.max - panStart.min;
      const dxPx = e.clientX - panStart.x;
      // Drag right → reveal earlier values → scroll left in data terms.
      const dxVal = -(dxPx / plotWidth) * span;
      const { min: dataMin, max: dataMax } = xRangeRef.current;
      let newMin = panStart.min + dxVal;
      let newMax = panStart.max + dxVal;
      if (newMin < dataMin) {
        newMax += dataMin - newMin;
        newMin = dataMin;
      }
      if (newMax > dataMax) {
        newMin -= newMax - dataMax;
        newMax = dataMax;
      }
      u.setScale("x", { min: newMin, max: newMax });
      bumpLayout();
    }
    function onMouseUp() {
      panStart = null;
      el.style.cursor = "";
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

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
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      u.destroy();
      plotRef.current = null;
      if (scrubRafRef.current != null) cancelAnimationFrame(scrubRafRef.current);
    };
    // Init only once — series.useEffect below handles updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    u.setData(series as unknown as uPlot.AlignedData);
    const xs = series[0];
    if (xs.length) {
      xRangeRef.current = { min: xs[0], max: xs[xs.length - 1] };
    }
    bumpLayout();
  }, [series]);

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div className="label">Payoff (P/L vs underlying)</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] muted">
          <Legend dot={COLORS.today} label="Today" />
          {midLabel !== "Today" && <Legend dot={COLORS.mid} label={midLabel} />}
          <Legend dot={COLORS.expiry} label="Expiry" />
        </div>
      </div>
      <div className="relative h-80 w-full sm:h-[28rem]">
        <div ref={containerRef} className="absolute inset-0 cursor-grab" />
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

function MarkerOverlay({
  markers,
  plotRef,
  dataXs,
  layoutTick,
}: {
  markers: Marker[];
  plotRef: React.MutableRefObject<uPlot | null>;
  dataXs: readonly number[];
  /** Bumped by parent on plot init / setData / resize so the overlay re-reads
      pixel positions. Replaces an earlier 60fps rAF loop that was the cause
      of catastrophic CPU usage on this page. */
  layoutTick: number;
}) {
  // Reading the prop forces React to re-render this component when the parent
  // bumps it. Suppress unused-var lint since the value itself is unused.
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

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-textDim">
      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: dot }} />
      {label}
    </span>
  );
}
