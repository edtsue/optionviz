"use client";

interface Props {
  value: number; // 0..1 progress from today → last expiry
  onChange: (v: number) => void;
  dteAtTarget: number; // days from target back to last expiry
  /** Total days from now to last expiry (so we can map button days → progress) */
  totalDte?: number;
}

export function TimeSlider({ value, onChange, dteAtTarget, totalDte }: Props) {
  const total = Math.max(1, totalDte ?? Math.max(dteAtTarget, 1));
  const daysForward = Math.round(value * total);
  const label =
    value <= 0.001 ? "Today" : value >= 0.999 ? "At expiry" : `+${daysForward}d (${dteAtTarget.toFixed(0)}d to expiry)`;

  // Buttons: today, +1d, +3d, +7d, +14d, halfway, at expiry — only show those within total
  const presets: Array<{ label: string; v: number }> = [
    { label: "Today", v: 0 },
    { label: "+1D", v: 1 / total },
    { label: "+3D", v: 3 / total },
    { label: "+7D", v: 7 / total },
    { label: "+14D", v: 14 / total },
    { label: "Halfway", v: 0.5 },
    { label: "Expiry", v: 1 },
  ].filter((p) => p.v <= 1.001 && p.v >= 0);

  return (
    <div className="card card-tight space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="label">Time to expiration</div>
        <div className="text-xs font-semibold">{label}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const active = Math.abs(value - p.v) < 0.5 / total;
          return (
            <button
              type="button"
              key={p.label}
              onClick={() => onChange(p.v)}
              className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border hover:border-accent/40"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
