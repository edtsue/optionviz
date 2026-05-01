"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { ChatLauncher } from "./ChatLauncher";
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const theme = themeFor(pathname);

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

        {/* Desktop sidebar */}
        <div className="hidden h-screen w-52 shrink-0 border-r border-border md:sticky md:top-0 md:flex">
          <Sidebar />
        </div>

        <main className="min-w-0 flex-1 pt-12 pb-20 md:pt-0 md:pb-20">{children}</main>

        <ChatLauncher />
      </div>
    </ChatContextProvider>
  );
}
