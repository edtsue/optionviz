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
      {/* Solid surface — the .card class is translucent and disappears
          against the dim backdrop, leaving only "haze". Use a real
          background so the title and buttons are actually visible. */}
      <div
        className="w-full max-w-sm space-y-3 rounded-2xl border border-border p-4 shadow-2xl"
        style={{ background: "var(--bg)" }}
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
