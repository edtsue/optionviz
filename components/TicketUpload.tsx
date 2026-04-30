"use client";
import { useEffect, useRef, useState } from "react";

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

export function TicketUpload({ onParsed }: { onParsed: (t: ParsedTicket) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file (PNG, JPEG, etc.)");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await fileToDataURL(file);
      setPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      const res = await fetch("/api/parse-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Parse failed (${res.status})`);
      }
      const parsed = (await res.json()) as ParsedTicket;
      onParsed(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse ticket");
    } finally {
      setBusy(false);
    }
  }

  // Paste from clipboard support
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        handleFile(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setHover(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="label">Upload ticket screenshot</div>
        <div className="text-xs text-gray-500">Drop · Paste · Click</div>
      </div>

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
        onDrop={onDrop}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
          hover ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"
        } ${busy ? "opacity-60" : ""}`}
      >
        <div className="text-sm font-medium">
          {busy ? "Parsing with Claude vision…" : hover ? "Drop screenshot to parse" : "Drag a screenshot here"}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          or paste from clipboard (⌘V) · or click to choose a file
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={busy}
          className="hidden"
        />
      </div>

      {error && <div className="text-sm text-loss">{error}</div>}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Preview" className="max-h-72 rounded-lg border border-border" />
      )}
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
