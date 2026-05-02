"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { ChatContextProvider } from "@/lib/chat-context";
import { SettingsButton } from "./SettingsPanel";

interface Theme {
  accent: string;
  accentRgb: string;
  accentDim: string;
  accentDimRgb: string;
}

const TRADE: Theme = {
  accent: "#a3e635",
  accentRgb: "163 230 53",
  accentDim: "#65a30d",
  accentDimRgb: "101 163 13",
};

const PORTFOLIO: Theme = {
  accent: "#22d3ee",
  accentRgb: "34 211 238",
  accentDim: "#0e7490",
  accentDimRgb: "14 116 144",
};

const TODAY: Theme = {
  accent: "#f59e0b",
  accentRgb: "245 158 11",
  accentDim: "#b45309",
  accentDimRgb: "180 83 9",
};

function themeFor(pathname: string | null): Theme {
  if (pathname?.startsWith("/portfolio")) return PORTFOLIO;
  if (pathname?.startsWith("/today")) return TODAY;
  return TRADE;
}

const SIDEBAR_KEY = "optionviz.sidebar-width";
const SIDEBAR_DEFAULT = 208; // w-52
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const pathname = usePathname();
  const theme = themeFor(pathname);

  // Load persisted width
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) setSidebarWidth(clamp(n, SIDEBAR_MIN, SIDEBAR_MAX));
      }
    } catch {}
  }, []);

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const next = clamp(dragRef.current.w + (e.clientX - dragRef.current.x), SIDEBAR_MIN, SIDEBAR_MAX);
    setSidebarWidth(next);
  }, []);

  const onUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }, [onMove]);

  // Persist after width settles
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(SIDEBAR_KEY, String(Math.round(sidebarWidth)));
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [sidebarWidth]);

  function onDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { x: e.clientX, w: sidebarWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const themeStyle = {
    "--accent": theme.accent,
    "--accent-rgb": theme.accentRgb,
    "--accent-dim": theme.accentDim,
    "--accent-dim-rgb": theme.accentDimRgb,
  } as React.CSSProperties;

  return (
    <ChatContextProvider>
      <div className="flex min-h-screen" style={themeStyle}>
        {/* Mobile top bar */}
        <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-bg/70 px-3 backdrop-blur md:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-md border border-border px-2 py-1 text-sm"
          >
            ☰
          </button>
          <span className="text-sm font-semibold">
            Option<span className="text-accent">Viz</span>
          </span>
          <SettingsButton />
        </header>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 h-full w-72 border-r border-border bg-bg shadow-2xl">
              <Sidebar onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        {/* Desktop sidebar — resizable */}
        <div
          className="hidden h-screen shrink-0 md:sticky md:top-0 md:flex"
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
        </div>

        {/* Drag handle (desktop only) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={onDown}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          title="Drag to resize · double-click to reset"
          className="group hidden shrink-0 cursor-col-resize md:sticky md:top-0 md:flex md:h-screen md:w-1.5 md:items-center md:justify-center"
        >
          <div className="h-full w-px bg-border transition group-hover:bg-accent/60" />
        </div>

        <main className="min-w-0 flex-1 pt-12 pb-6 md:pt-0 md:pb-6">{children}</main>
      </div>
    </ChatContextProvider>
  );
}
