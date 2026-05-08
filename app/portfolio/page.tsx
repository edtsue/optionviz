"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioSnapshot, PortfolioAnalysis, Holding } from "@/types/portfolio";
import { resizeImage } from "@/lib/image";
import { HoldingDetail } from "@/components/HoldingDetail";
import { ResizableSplit } from "@/components/ResizableSplit";
import { useRegisterChatContext } from "@/lib/chat-context";

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
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate: localStorage first for instant display, then refresh from cloud
  // (source of truth). If cloud has a newer/different snapshot it overwrites.
  // Today page also reads localStorage so we keep that in sync.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setSnapshot(saved.snapshot ?? null);
        setAnalysis(saved.analysis ?? null);
      }
    } catch {}
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/portfolio", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const cloudSnap = data.portfolio?.snapshot ?? null;
        const cloudAnalysis = data.portfolio?.analysis ?? null;
        if (cloudSnap) {
          setSnapshot(cloudSnap);
          setAnalysis(cloudAnalysis);
          try {
            localStorage.setItem(
              KEY,
              JSON.stringify({ snapshot: cloudSnap, analysis: cloudAnalysis }),
            );
          } catch {}
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Save to localStorage immediately (so Today page picks it up + offline) and
  // mirror to the cloud. Returns a promise so callers can surface failure —
  // the previous fire-and-forget version dropped analyses on auth-expired
  // sessions without telling the user.
  async function persist(
    s: PortfolioSnapshot | null,
    a: PortfolioAnalysis | null,
  ): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify({ snapshot: s, analysis: a }));
    } catch {}
    try {
      const res = s
        ? await fetch("/api/portfolio", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot: s, analysis: a }),
          })
        : await fetch("/api/portfolio", { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Cloud save failed (HTTP ${res.status})`);
      }
    } catch (e) {
      console.warn("[portfolio] cloud save failed:", e);
      throw e;
    }
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
      const parsedRaw = (await res.json()) as PortfolioSnapshot;
      const parsed: PortfolioSnapshot = {
        ...parsedRaw,
        uploadedAt: new Date().toISOString(),
      };
      setSnapshot(parsed);
      setAnalysis(null);
      setStaged(null);
      setSelectedSymbol(null);
      await persist(parsed, null);
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
    setSelectedSymbol(null);
    setPaneOpen(true);
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
      try {
        await persist(snapshot, data.analysis);
      } catch (e) {
        // Analysis is in memory + localStorage already; cloud save failed.
        // Surface so the user knows the analysis won't be on other devices.
        setError(
          `Analysis ran but cloud save failed: ${
            e instanceof Error ? e.message : "unknown"
          }. It's saved locally on this device.`,
        );
      }
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
    setSelectedSymbol(null);
    void persist(null, null).catch(() => {
      // Best-effort delete; if cloud delete fails the next PUT will overwrite.
    });
  }

  function cancelStaged() {
    setStaged(null);
    setError(null);
  }

  const total =
    snapshot?.totalValue ??
    snapshot?.holdings.reduce((acc, h) => acc + (h.marketValue ?? 0), 0) ??
    0;

  const selectedHolding =
    snapshot && selectedSymbol
      ? snapshot.holdings.find((h) => h.symbol === selectedSymbol) ?? null
      : null;

  // CRITICAL: memoize. useRegisterChatContext fires its effect whenever
  // these change by reference. Without useMemo, every render produces a
  // fresh holdings array + wrapper object, the effect runs setContext,
  // the provider state updates, every context consumer (including this
  // page) re-renders, the cycle repeats — sidebar clicks never get CPU.
  const chatLabel = snapshot
    ? selectedHolding
      ? `Portfolio – inspecting ${selectedHolding.symbol}`
      : "Portfolio overview"
    : "Portfolio (no snapshot)";
  const chatData = useMemo(() => {
    if (!snapshot) return null;
    return {
      totalValue: total,
      cashBalance: snapshot.cashBalance,
      holdings: snapshot.holdings.map((h) => ({
        symbol: h.symbol,
        qty: h.quantity,
        value: h.marketValue,
        pnl: h.unrealizedPnL,
        pnlPct: h.unrealizedPnLPct,
        pctOfPort: total ? Math.round(((h.marketValue ?? 0) / total) * 1000) / 10 : null,
      })),
      selected: selectedHolding?.symbol ?? null,
      analysisLoaded: !!analysis,
    };
  }, [snapshot, total, selectedHolding, analysis]);
  useRegisterChatContext(chatLabel, chatData);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col pl-3 pr-4 py-4 md:h-screen">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-xs muted">Account-wide analysis · concentration · ideas</p>
        </div>
        <div className="flex items-center gap-2">
          {snapshot && (
            <button
              onClick={() => setPaneOpen((v) => !v)}
              className="btn-ghost rounded-lg px-3 py-1.5 text-sm"
              title={paneOpen ? "Hide analysis pane" : "Show analysis pane"}
            >
              {paneOpen ? "Hide pane ›" : "Show pane ‹"}
            </button>
          )}
          {snapshot && (
            <button
              onClick={analyze}
              disabled={busyAnalyze}
              className="btn-primary rounded-lg px-3 py-1.5 text-sm"
            >
              {busyAnalyze ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze with Claude"}
            </button>
          )}
          {snapshot && (
            <button onClick={clear} className="btn-danger rounded-lg px-3 py-1.5 text-sm">
              Clear
            </button>
          )}
        </div>
      </header>

      {/* When no snapshot: show big upload zone */}
      {!snapshot && (
        <div className="card space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="label">Upload portfolio screenshot</div>
            <div className="text-xs muted">Drop · Paste · Click</div>
          </div>

          {!staged && (
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
              className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
                hover ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"
              }`}
            >
              <div className="text-sm font-medium">
                {hover ? "Drop to stage" : "Drag a portfolio screenshot here"}
              </div>
              <div className="mt-1 text-xs muted">or paste (⌘V) · or click to choose a file</div>
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
            <StagedPanel
              staged={staged}
              busy={busyParse}
              onUpload={uploadStaged}
              onCancel={cancelStaged}
            />
          )}

          {error && <div className="text-sm loss">{error}</div>}
        </div>
      )}

      {/* When we have a snapshot: resizable horizontal layout */}
      {snapshot && (
        <ResizableSplit
          id="portfolio-stats"
          fixedSide="start"
          defaultPx={220}
          minPx={160}
          maxPx={360}
          breakpoint="lg"
          className="min-h-0 flex-1"
        >
          {/* Column 1: stats + reupload */}
          <div className="flex h-full flex-col gap-3 overflow-y-auto pr-2">
            <div className="card card-tight space-y-2">
              <Stat label="Total value" value={`$${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              <Stat label="Cash" value={snapshot.cashBalance != null ? `$${snapshot.cashBalance.toLocaleString()}` : "—"} />
              <Stat label="Holdings" value={`${snapshot.holdings.length}`} />
              {snapshot.asOf && <Stat label="Broker as of" value={snapshot.asOf} />}
              <Stat
                label="Uploaded"
                value={snapshot.uploadedAt ? formatRelative(snapshot.uploadedAt) : "—"}
                title={snapshot.uploadedAt ? new Date(snapshot.uploadedAt).toLocaleString() : undefined}
              />
            </div>

            <div className="card card-tight">
              <div className="label mb-2">Replace</div>
              {!staged ? (
                <button
                  onClick={() => inputRef.current?.click()}
                  className="btn-ghost w-full rounded-lg px-3 py-2 text-sm"
                >
                  Upload new screenshot
                </button>
              ) : (
                <StagedPanel
                  staged={staged}
                  busy={busyParse}
                  onUpload={uploadStaged}
                  onCancel={cancelStaged}
                  compact
                />
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && stage(e.target.files[0])}
                className="hidden"
              />
            </div>
            {error && <div className="text-sm loss">{error}</div>}
          </div>

          {/* Right side: holdings | detail (resizable when paneOpen) */}
          {paneOpen ? (
            <ResizableSplit
              id="portfolio-detail"
              fixedSide="end"
              defaultPx={380}
              minPx={300}
              maxPx={640}
              breakpoint="lg"
              className="h-full min-h-0"
            >
              <HoldingsTable
                holdings={snapshot.holdings}
                total={total}
                selectedSymbol={selectedSymbol}
                onSelect={(s) => {
                  setSelectedSymbol(s);
                  setPaneOpen(true);
                }}
                paneOpen={paneOpen}
                onShowPane={() => setPaneOpen(true)}
              />
              <div className="card card-flush flex h-full min-h-0 flex-col overflow-hidden">
            {selectedHolding ? (
              <>
                <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
                  <div>
                    <div className="text-base font-semibold">{selectedHolding.symbol}</div>
                    {selectedHolding.name && (
                      <div className="text-[11px] muted">{selectedHolding.name}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedSymbol(null)}
                      className="rounded-md border border-border px-2 py-1 text-[11px] hover:border-accent/50"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => {
                        setSelectedSymbol(null);
                        setPaneOpen(false);
                      }}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent/50"
                      aria-label="Close pane"
                      title="Hide pane"
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div className="scroll-soft flex-1 overflow-y-auto">
                  <HoldingDetail holding={selectedHolding} totalPortfolioValue={total} />
                </div>
              </>
            ) : analysis ? (
              <>
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div className="label">Analysis & ideas</div>
                  <button
                    onClick={() => setPaneOpen(false)}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent/50"
                    aria-label="Close pane"
                    title="Hide pane"
                  >
                    ›
                  </button>
                </div>
                <div className="scroll-soft flex-1 overflow-y-auto p-3">
                  <AnalysisView analysis={analysis} />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-end border-b border-border px-3 py-2">
                  <button
                    onClick={() => setPaneOpen(false)}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:border-accent/50"
                  >
                    ›
                  </button>
                </div>
                <div className="flex flex-1 items-center justify-center p-6 text-center">
                  <div>
                    <div className="text-sm muted">
                      Click a holding on the left to inspect it,
                    </div>
                    <div className="text-sm muted">or run analysis on the whole portfolio.</div>
                    <button
                      onClick={analyze}
                      disabled={busyAnalyze}
                      className="btn-primary mt-4 rounded-lg px-3 py-1.5 text-sm"
                    >
                      {busyAnalyze ? "Analyzing…" : "Analyze with Claude"}
                    </button>
                  </div>
                </div>
              </>
            )}
              </div>
            </ResizableSplit>
          ) : (
            <HoldingsTable
              holdings={snapshot.holdings}
              total={total}
              selectedSymbol={selectedSymbol}
              onSelect={(s) => {
                setSelectedSymbol(s);
                setPaneOpen(true);
              }}
              paneOpen={paneOpen}
              onShowPane={() => setPaneOpen(true)}
            />
          )}
        </ResizableSplit>
      )}
    </div>
  );
}

function HoldingsTable({
  holdings,
  total,
  selectedSymbol,
  onSelect,
  paneOpen,
  onShowPane,
}: {
  holdings: Holding[];
  total: number;
  selectedSymbol: string | null;
  onSelect: (s: string | null) => void;
  paneOpen: boolean;
  onShowPane: () => void;
}) {
  return (
    <div className="card card-flush flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="label">Holdings</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] muted">click to inspect →</span>
          {!paneOpen && (
            <button
              onClick={onShowPane}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:border-accent/50"
            >
              Show pane ‹
            </button>
          )}
        </div>
      </div>
      <div className="scroll-soft flex-1 overflow-y-auto">
        <table className="w-full text-sm data-grid">
          <thead className="sticky top-0 bg-bg/90 text-[10px] uppercase tracking-wider muted backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-right">P/L</th>
              <th className="px-3 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {holdings
              .slice()
              .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
              .map((h) => (
                <HoldingRow
                  key={h.symbol}
                  h={h}
                  total={total}
                  active={h.symbol === selectedSymbol}
                  onClick={() => onSelect(h.symbol === selectedSymbol ? null : h.symbol)}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldingRow({
  h,
  total,
  active,
  onClick,
}: {
  h: Holding;
  total: number;
  active: boolean;
  onClick: () => void;
}) {
  const pct = total ? ((h.marketValue ?? 0) / total) * 100 : 0;
  const pnl = h.unrealizedPnL ?? 0;
  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer border-t border-border transition ${
        active ? "bg-accent/[0.08]" : "hover:bg-white/[0.03]"
      }`}
    >
      <td className="px-3 py-2">
        <div className="font-semibold">{h.symbol}</div>
        {h.name && (
          <div className="truncate text-[11px] muted" title={h.name}>
            {h.name}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">{h.quantity}</td>
      <td className="px-3 py-2 text-right">
        {h.marketPrice != null ? `$${h.marketPrice.toFixed(2)}` : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        {h.costBasis != null ? `$${h.costBasis.toFixed(2)}` : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        {h.marketValue != null ? `$${h.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
      </td>
      <td className={`px-3 py-2 text-right ${pnl > 0 ? "gain" : pnl < 0 ? "loss" : ""}`}>
        {h.unrealizedPnL != null
          ? `${pnl >= 0 ? "+" : ""}$${pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : "—"}
        {h.unrealizedPnLPct != null && (
          <div className="text-[10px]">{`${pnl >= 0 ? "+" : ""}${h.unrealizedPnLPct.toFixed(1)}%`}</div>
        )}
      </td>
      <td className="px-3 py-2 text-right">{pct.toFixed(1)}%</td>
    </tr>
  );
}

function StagedPanel({
  staged,
  busy,
  onUpload,
  onCancel,
  compact,
}: {
  staged: StagedImage;
  busy: boolean;
  onUpload: () => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={staged.dataUrl}
          alt="Staged"
          className={`rounded-lg border border-border ${compact ? "max-h-32" : "max-h-72"}`}
        />
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Remove screenshot"
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg text-xs hover:border-loss hover:text-loss"
        >
          ×
        </button>
      </div>
      <div className="text-[11px] muted">
        {(staged.resizedBytes / 1024).toFixed(0)} KB · {staged.width}×{staged.height}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onUpload}
          disabled={busy}
          className="btn-primary flex-1 rounded-lg px-3 py-2 text-sm"
        >
          {busy ? "Parsing…" : "Upload & parse"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AnalysisView({ analysis }: { analysis: PortfolioAnalysis }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="label mb-1">Summary</div>
        <p className="text-sm">{analysis.summary}</p>
      </div>
      {analysis.events && analysis.events.length > 0 && (
        <div>
          <div className="label mb-1">Upcoming catalysts</div>
          <ul className="space-y-1.5">
            {analysis.events.map((e, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/[0.05] p-2 text-xs"
              >
                <span className="mt-0.5 rounded bg-warn/20 px-1.5 py-0.5 text-[10px] uppercase warn">
                  {e.type}
                </span>
                <div className="flex-1">
                  <div className="font-semibold">
                    {e.ticker ? `${e.ticker} · ` : ""}
                    <span className="muted">{e.date}</span>
                  </div>
                  <div className="text-[11px] text-gray-300">{e.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Block title="Concentration risk" body={analysis.concentrationRisk} />
        <Block title="Diversification" body={analysis.diversification} />
      </div>
      <div>
        <div className="label mb-1">Notable observations</div>
        <ul className="space-y-1 text-sm">
          {analysis.notableObservations.map((o, i) => (
            <li key={i}>• {o}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="label mb-1">Recommendations</div>
        <ul className="space-y-2">
          {analysis.recommendations.map((r, i) => (
            <li key={i} className="rounded-lg border border-border bg-white/[0.02] p-2.5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{r.title}</div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                    r.priority === "high"
                      ? "border border-loss/40 loss"
                      : r.priority === "medium"
                        ? "border border-warn/40 warn"
                        : "border border-border muted"
                  }`}
                >
                  {r.priority}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-300">{r.rationale}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="label mb-1">Options ideas</div>
        <ul className="space-y-2">
          {analysis.ideas.map((it, i) => (
            <li key={i} className="rounded-lg border border-border bg-white/[0.02] p-2.5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{it.name}</div>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] muted">
                  {it.fitWith}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-300">{it.thesis}</p>
              <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] muted">{it.structure}</pre>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between" title={title}>
      <span className="text-xs muted">{label}</span>
      <span className="kpi-sm">{value}</span>
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-white/[0.02] p-2.5">
      <div className="text-[10px] uppercase tracking-wider muted">{title}</div>
      <p className="mt-1 text-xs">{body}</p>
    </div>
  );
}
