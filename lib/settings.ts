"use client";
import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";
export type FontSize = "sm" | "md" | "lg";

export interface Settings {
  theme: ThemeMode;
  fontSize: FontSize;
  compact: boolean;
}

const DEFAULTS: Settings = {
  theme: "dark",
  fontSize: "md",
  compact: false,
};

const KEY = "optionviz.settings.v1";

function read(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function applyToDOM(s: Settings) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.compact = s.compact ? "1" : "0";
  const sizeMap: Record<FontSize, string> = { sm: "13px", md: "14.5px", lg: "16px" };
  document.documentElement.style.fontSize = sizeMap[s.fontSize];
}

export function useSettings(): [Settings, (next: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    const loaded = read();
    setS(loaded);
    applyToDOM(loaded);
  }, []);

  function update(next: Partial<Settings>) {
    setS((cur) => {
      const merged = { ...cur, ...next };
      try {
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {}
      applyToDOM(merged);
      return merged;
    });
  }

  return [s, update];
}
