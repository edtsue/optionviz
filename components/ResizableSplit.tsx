"use client";
import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface Props {
  /** Persistence key */
  id: string;
  /** Which side is the fixed-pixel column; the other is flex */
  fixedSide: "start" | "end";
  /** Initial pixel width of the fixed pane */
  defaultPx: number;
  minPx?: number;
  maxPx?: number;
  /** Tailwind breakpoint to enable the split layout — below this, panes stack */
  breakpoint?: "md" | "lg" | "xl";
  className?: string;
  children: ReactNode;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function ResizableSplit({
  id,
  fixedSide,
  defaultPx,
  minPx = 200,
  maxPx = 800,
  breakpoint = "lg",
  className,
  children,
}: Props) {
  const [px, setPx] = useState(defaultPx);
  const [enabled, setEnabled] = useState(false);
  const dragRef = useRef<{ x: number; px: number } | null>(null);

  // Read persisted size on mount
  useEffect(() => {
    try {
      const v = localStorage.getItem(`resize.${id}`);
      if (v) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) setPx(clamp(n, minPx, maxPx));
      }
    } catch {}
  }, [id, minPx, maxPx]);

  // Track viewport size to decide if the split is active
  useLayoutEffect(() => {
    const px = breakpoint === "md" ? 768 : breakpoint === "lg" ? 1024 : 1280;
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      const direction = fixedSide === "end" ? -1 : 1;
      const delta = (e.clientX - d.x) * direction;
      const next = clamp(d.px + delta, minPx, maxPx);
      setPx(next);
    },
    [fixedSide, minPx, maxPx],
  );

  const onUp = useCallback(() => {
    if (dragRef.current) {
      try {
        localStorage.setItem(`resize.${id}`, String(Math.round(dragRef.current.px)));
      } catch {}
    }
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }, [id, onMove]);

  function onDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { x: e.clientX, px };
    // Save the live px on dragRef so onMove sees it; also persist on up
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // After dragging ends, capture the latest px into dragRef for persistence
  useEffect(() => {
    if (dragRef.current) dragRef.current.px = px;
  }, [px]);

  const kids = Children.toArray(children);
  const [first, second] = kids;

  if (!enabled) {
    return (
      <div className={`flex flex-col gap-4 ${className ?? ""}`}>
        <div className="min-w-0">{first}</div>
        <div className="min-w-0">{second}</div>
      </div>
    );
  }

  const cols =
    fixedSide === "start"
      ? `${px}px 8px minmax(0, 1fr)`
      : `minmax(0, 1fr) 8px ${px}px`;

  return (
    <div
      className={`grid ${className ?? ""}`}
      style={{ gridTemplateColumns: cols, columnGap: 0 }}
    >
      <div className="min-w-0">{first}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onDown}
        className="group relative flex cursor-col-resize items-center justify-center"
        title="Drag to resize"
      >
        <div className="h-full w-px bg-border transition group-hover:bg-accent/60" />
        <div className="absolute h-12 w-1 rounded-full bg-border opacity-0 transition group-hover:opacity-100 group-hover:bg-accent" />
      </div>
      <div className="min-w-0">{second}</div>
    </div>
  );
}
