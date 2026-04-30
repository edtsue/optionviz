"use client";
import { useState } from "react";
import { useSettings, type FontSize, type ThemeMode } from "@/lib/settings";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="rounded-lg border border-border px-2 py-1.5 text-xs hover:border-accent/50"
      >
        ⚙ Settings
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, set] = useSettings();
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="card relative m-0 w-full md:m-4 md:max-w-md">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs">×</button>
        </div>

        <div className="space-y-4">
          <Row label="Theme">
            <Toggle<ThemeMode>
              value={s.theme}
              onChange={(v) => set({ theme: v })}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </Row>

          <Row label="Font size">
            <Toggle<FontSize>
              value={s.fontSize}
              onChange={(v) => set({ fontSize: v })}
              options={[
                { value: "sm", label: "Small" },
                { value: "md", label: "Medium" },
                { value: "lg", label: "Large" },
              ]}
            />
          </Row>

          <Row label="Compact density">
            <Toggle<boolean>
              value={s.compact}
              onChange={(v) => set({ compact: v })}
              options={[
                { value: false, label: "Comfortable" },
                { value: true, label: "Tight" },
              ]}
            />
          </Row>
        </div>

        <div className="mt-6 text-[11px] muted">
          Settings are saved to this browser only.
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Toggle<T extends string | boolean>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-white/[0.02] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              active ? "bg-accent text-[#0a1502]" : "text-textDim hover:text-text"
            }`}
            style={active ? { color: "#0a1502" } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
