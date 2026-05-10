"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
}: Props) {
  // Mount guard so the portal target (document.body) exists before we render.
  // Without it, SSR / first paint can throw.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  // Render via portal to document.body so the dialog escapes any ancestor
  // stacking context (the sidebar lives inside AppShell with md:sticky and
  // the trade detail page mounts a fixed-positioned checklist drawer at
  // z-50 — without a portal those compete with the dialog and the dialog
  // can end up covered or have clicks intercepted).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      {/* Solid surface — the .card class is translucent (transparent rgba
          + backdrop-filter blur) and disappears against the dim overlay.
          Force text color too: var(--text) inherits from <body>, but if a
          parent ever sets a different color (light theme, themed pages),
          a dark-on-dark text invisibly defeats the dialog. */}
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl p-4 shadow-2xl"
        style={{
          background: "#1a1f2a",
          border: "1px solid rgba(255,255,255,0.16)",
          color: "#e5e7eb",
        }}
      >
        <div className="text-base font-semibold">{title}</div>
        {body && <p className="text-sm muted">{body}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent/50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`rounded-md px-3 py-1.5 text-sm ${destructive ? "btn-danger" : "btn-primary"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
