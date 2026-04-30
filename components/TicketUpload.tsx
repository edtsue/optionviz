"use client";
import { useEffect, useRef, useState } from "react";
import { resizeImage } from "@/lib/image";

interface ParsedTicket {
  symbol: string;
  underlyingPrice: number;
  legs: Array<{
    type: "call" | "put";
    side: "long" | "short";
    strike: number;
    expiration: string;
    quantity: number;
    premium: number;
  }>;
  notes?: string | null;
}

interface Staged {
  file: File;
  dataUrl: string;
  mediaType: string;
  resizedBytes: number;
  originalBytes: number;
  width: number;
  height: number;
}

export function TicketUpload({ onParsed }: { onParsed: (t: ParsedTicket) => void }) {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function stage(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file");
      return;
    }
    setError(null);
    try {
      const resized = await resizeImage(file);
      setStaged({
        file,
        dataUrl: resized.dataUrl,
        mediaType: resized.mediaType,
        resizedBytes: resized.resizedBytes,
        originalBytes: resized.originalBytes,
        width: resized.width,
        height: resized.height,
      });
    } catch (e) {
      setError(e instanceof Error ? `Image processing failed: ${e.message}` : "Image processing failed");
    }
  }

  async function upload() {
    if (!staged) return;
    setBusy(true);
    setError(null);
    try {
      const base64 = staged.dataUrl.split(",")[1];
      const res = await fetch("/api/parse-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: staged.mediaType }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Parse failed (${res.status})`);
      }
      const parsed = (await res.json()) as ParsedTicket;
      onParsed(parsed);
      setStaged(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse ticket");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setStaged(null);
    setError(null);
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        stage(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || !staged || busy) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      upload();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, busy]);

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="label">Upload ticket screenshot</div>
        <div className="text-xs text-gray-500">Drop · Paste · Click</div>
      </div>

      {!staged && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHover(false);
            const f = e.dataTransfer.files[0];
            if (f) stage(f);
          }}
          className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
            hover ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"
          }`}
        >
          <div className="text-sm font-medium">
            {hover ? "Drop to stage" : "Drag a screenshot here"}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            or paste from clipboard (⌘V) · or click to choose a file
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && stage(e.target.files[0])}
        className="hidden"
      />

      {staged && (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={staged.dataUrl} alt="Staged" className="max-h-72 rounded-lg border border-border" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
            <span>
              {staged.file.name || "pasted image"} · resized to {staged.width}×{staged.height} ·{" "}
              {(staged.resizedBytes / 1024).toFixed(0)} KB
              {staged.originalBytes !== staged.resizedBytes && (
                <span className="text-gray-500"> (from {(staged.originalBytes / 1024).toFixed(0)} KB)</span>
              )}
            </span>
            <span className="text-gray-500">Press Enter to upload</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={upload}
              disabled={busy}
              className="btn-primary flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold"
            >
              {busy ? "Parsing with Claude…" : "Upload & parse"}
            </button>
            <button onClick={clear} disabled={busy} className="rounded-lg px-4 py-2.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-loss">{error}</div>}
    </div>
  );
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
