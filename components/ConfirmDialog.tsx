"use client";
import { useEffect } from "react";

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
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      {/* Solid surface — the .card class is translucent (transparent rgba
          + backdrop-filter blur) and disappears against the dim overlay.
          Earlier fix used var(--bg) which is #06080a, basically the same
          shade as the dimmed page; the card outline showed but the
          surface had no contrast. Use a clearly lighter solid + a
          stronger border so the title and buttons read clearly. */}
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl p-4 shadow-2xl"
        style={{
          background: "#1a1f2a",
          border: "1px solid rgba(255,255,255,0.16)",
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
    </div>
  );
}
