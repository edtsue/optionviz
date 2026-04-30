"use client";
import { useEffect, useRef, useState } from "react";
import type { PortfolioSnapshot, PortfolioAnalysis } from "@/types/portfolio";
import { resizeImage } from "@/lib/image";

interface StagedImage {
  file: File;
  dataUrl: string;
  mediaType: string;
  resizedBytes: number;
  originalBytes: number;
  width: number;
  height: number;
}

const KEY = "optionviz.portfolio.v1";

export default function PortfolioPage() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [busyParse, setBusyParse] = useState(false);
  const [busyAnalyze, setBusyAnalyze] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [staged, setStaged] = useState<StagedImage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setSnapshot(saved.snapshot ?? null);
        setAnalysis(saved.analysis ?? null);
      }
    } catch {}
  }, []);

  function persist(s: PortfolioSnapshot | null, a: PortfolioAnalysis | null) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ snapshot: s, analysis: a }));
    } catch {}
  }

  async function stage(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file");
      return;
    }
    setError(null);
    try {
      const r = await resizeImage(file);
      setStaged({
        file,
        dataUrl: r.dataUrl,
        mediaType: r.mediaType,
        resizedBytes: r.resizedBytes,
        originalBytes: r.originalBytes,
        width: r.width,
        height: r.height,
      });
    } catch (e) {
      setError(e instanceof Error ? `Image processing failed: ${e.message}` : "Image processing failed");
    }
  }

  async function uploadStaged() {
    if (!staged) return;
    setBusyParse(true);
    setError(null);
    try {
      const base64 = staged.dataUrl.split(",")[1];
      const res = await fetch("/api/parse-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: staged.mediaType }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Parse failed (${res.status})`);
      }
      const parsed = (await res.json()) as PortfolioSnapshot;
      setSnapshot(parsed);
      setAnalysis(null);
      setStaged(null);
      persist(parsed, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse");
    } finally {
      setBusyParse(false);
    }
  }

  async function analyze() {
    if (!snapshot) return;
    setBusyAnalyze(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Analyze failed (${res.status})`);
      }
      const data = await res.json();
      setAnalysis(data.analysis);
      persist(snapshot, data.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyze failed");
    } finally {
      setBusyAnalyze(false);
    }
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
      if (e.key !== "Enter" || !staged || busyParse) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      uploadStaged();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, busyParse]);

  function clear() {
    setSnapshot(null);
    setAnalysis(null);
    setStaged(null);
    persist(null, null);
  }

  function cancelStaged() {
    setStaged(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        {snapshot && (
          <button onClick={clear} className="btn-danger rounded-lg px-3 py-1.5 text-sm">
            Clear
          </button>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="label">Upload portfolio screenshot</div>
          <div className="text-xs text-gray-500">Drop · Paste · Click</div>
        </div>

        {!staged && !snapshot && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
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
              {hover ? "Drop to stage" : "Drag a portfolio screenshot here"}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              or paste (⌘V) · or click to choose a file
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
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={staged.dataUrl} alt="Staged" className="max-h-72 rounded-lg border border-border" />
              <button
                type="button"
                onClick={cancelStaged}
                disabled={busyParse}
                aria-label="Remove screenshot"
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg text-sm text-gray-300 shadow hover:border-loss hover:text-loss"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
              <span>
                {staged.file.name || "pasted image"} · resized to {staged.width}×{staged.height} ·{" "}
                {(staged.resizedBytes / 1024).toFixed(0)} KB
                {staged.originalBytes !== staged.resizedBytes && (
                  <span className="text-gray-500">
                    {" "}
                    (from {(staged.originalBytes / 1024).toFixed(0)} KB)
                  </span>
                )}
              </span>
              <span className="text-gray-500">Press Enter to upload</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={uploadStaged}
                disabled={busyParse}
                className="btn-primary flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold"
              >
                {busyParse ? "Parsing with Claude…" : "Upload & parse"}
              </button>
              <button onClick={cancelStaged} disabled={busyParse} className="rounded-lg px-4 py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <div className="text-sm text-loss">{error}</div>}
      </div>

      {snapshot && (
        <>
          <PortfolioOverview snapshot={snapshot} />

          <div className="flex items-center justify-between">
            <div className="label">Analysis & ideas</div>
            <button onClick={analyze} disabled={busyAnalyze} className="btn-primary rounded-lg px-3 py-1.5 text-sm">
              {busyAnalyze ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze with Claude"}
            </button>
          </div>

          {analysis && <AnalysisView analysis={analysis} />}
        </>
      )}
    </div>
  );
}

function PortfolioOverview({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const total = snapshot.totalValue ??
    snapshot.holdings.reduce((acc, h) => acc + (h.marketValue ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total value" value={`$${(total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <Stat label="Cash" value={snapshot.cashBalance != null ? `$${snapshot.cashBalance.toLocaleString()}` : "—"} />
        <Stat label="Holdings" value={`${snapshot.holdings.length}`} />
        <Stat label="As of" value={snapshot.asOf ?? "—"} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-400">
            <tr>
              <th className="px-2 py-2 text-left">Symbol</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-2 py-2 text-right">Value</th>
              <th className="px-2 py-2 text-right">P/L</th>
              <th className="px-2 py-2 text-right">% of port</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.holdings
              .slice()
              .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
              .map((h, i) => {
                const pct = total ? ((h.marketValue ?? 0) / total) * 100 : 0;
                const pnl = h.unrealizedPnL ?? 0;
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-2">
                      <div className="font-semibold">{h.symbol}</div>
                      {h.name && <div className="text-xs text-gray-500">{h.name}</div>}
                    </td>
                    <td className="px-2 py-2 text-right">{h.quantity}</td>
                    <td className="px-2 py-2 text-right">{h.marketPrice != null ? `$${h.marketPrice.toFixed(2)}` : "—"}</td>
                    <td className="px-2 py-2 text-right">{h.marketValue != null ? `$${h.marketValue.toLocaleString()}` : "—"}</td>
                    <td className={`px-2 py-2 text-right ${pnl > 0 ? "text-gain" : pnl < 0 ? "text-loss" : ""}`}>
                      {h.unrealizedPnL != null ? `${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString()}` : "—"}
                      {h.unrealizedPnLPct != null && (
                        <div className="text-xs">{`${pnl >= 0 ? "+" : ""}${h.unrealizedPnLPct.toFixed(1)}%`}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">{pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalysisView({ analysis }: { analysis: PortfolioAnalysis }) {
  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="label">Summary</div>
        <p className="text-sm">{analysis.summary}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Block title="Concentration risk" body={analysis.concentrationRisk} />
          <Block title="Diversification" body={analysis.diversification} />
        </div>
      </div>

      <div className="card space-y-2">
        <div className="label">Notable observations</div>
        <ul className="space-y-1 text-sm">
          {analysis.notableObservations.map((o, i) => (
            <li key={i}>• {o}</li>
          ))}
        </ul>
      </div>

      <div className="card space-y-3">
        <div className="label">Recommendations</div>
        <ul className="space-y-2">
          {analysis.recommendations.map((r, i) => (
            <li key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{r.title}</div>
                <span
                  className={`rounded-md border px-2 py-0.5 text-xs ${
                    r.priority === "high"
                      ? "border-loss/40 text-loss"
                      : r.priority === "medium"
                        ? "border-yellow-600/40 text-yellow-400"
                        : "border-border text-gray-400"
                  }`}
                >
                  {r.priority}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-300">{r.rationale}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="card space-y-3">
        <div className="label">Options ideas (paired with your holdings)</div>
        <ul className="space-y-2">
          {analysis.ideas.map((it, i) => (
            <li key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{it.name}</div>
                <span className="rounded-md border border-border px-2 py-0.5 text-xs text-gray-300">
                  Pairs with: {it.fitWith}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-300">{it.thesis}</p>
              <pre className="mt-2 text-xs text-gray-400 font-mono whitespace-pre-wrap">{it.structure}</pre>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="kpi">{value}</div>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-gray-400">{title}</div>
      <p className="mt-1 text-sm">{body}</p>
    </div>
  );
}

