"use client";
import type { Trade } from "@/types/trade";

const KEY = "optionviz.trades.v1";

function read(): Trade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Trade[];
  } catch {
    return [];
  }
}

function write(trades: Trade[]) {
  localStorage.setItem(KEY, JSON.stringify(trades));
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const localStore = {
  list(): Trade[] {
    return read().sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    );
  },
  get(id: string): Trade | null {
    return read().find((t) => t.id === id) ?? null;
  },
  upsert(trade: Trade): string {
    const all = read();
    const id = trade.id ?? uid();
    const now = new Date().toISOString();
    const existingIdx = all.findIndex((t) => t.id === id);
    const next: Trade = {
      ...trade,
      id,
      createdAt: trade.createdAt ?? now,
      updatedAt: now,
    };
    if (existingIdx >= 0) all[existingIdx] = next;
    else all.push(next);
    write(all);
    return id;
  },
  remove(id: string) {
    write(read().filter((t) => t.id !== id));
  },
  exportJson(): string {
    return JSON.stringify(read(), null, 2);
  },
  importJson(json: string) {
    const arr = JSON.parse(json) as Trade[];
    if (!Array.isArray(arr)) throw new Error("Expected array");
    write(arr);
  },
};
