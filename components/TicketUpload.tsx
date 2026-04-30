"use client";
import { useState } from "react";

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

  async function handleFile(file: File) {
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

  return (
    <div className="card space-y-3">
      <div className="label">Upload ticket screenshot</div>
      <label className="block">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={busy}
          className="block w-full"
        />
      </label>
      {busy && <div className="text-sm text-gray-400">Parsing with Claude vision…</div>}
      {error && <div className="text-sm text-loss">{error}</div>}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Ticket preview" className="max-h-72 rounded-lg border border-border" />
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
