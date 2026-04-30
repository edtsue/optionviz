"use client";
import { useEffect, useRef, useState } from "react";
import type { PortfolioSnapshot, PortfolioAnalysis } from "@/types/portfolio";

const KEY = "optionviz.portfolio.v1";

export default function PortfolioPage() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [busyParse, setBusyParse] = useState(false);
  const [busyAnalyze, setBusyAnalyze] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
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

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file");
      return;
    }
    setError(null);
    setBusyParse(true);
    try {
      const dataUrl = await fileToDataURL(file);
      setPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      const res = await fetch("/api/parse-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Parse failed (${res.status})`);
      }
      const parsed = (await res.json()) as PortfolioSnapshot;
      setSnapshot(parsed);
      setAnalysis(null);
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
        handleFile(file);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function clear() {
    setSnapshot(null);
    setAnalysis(null);
    setPreview(null);
    persist(null, null);
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
            if (f) handleFile(f);
          }}
          className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
            hover ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"
          } ${busyParse ? "opacity-60" : ""}`}
        >
          <div className="text-sm font-medium">
            {busyParse ? "Parsing with Claude vision…" : hover ? "Drop to parse" : "Drag a portfolio screenshot here"}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            or paste (⌘V) · or click to choose a file
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            disabled={busyParse}
            className="hidden"
          />
        </div>
        {error && <div className="text-sm text-loss">{error}</div>}
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="max-h-56 rounded-lg border border-border" />
        )}
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

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
