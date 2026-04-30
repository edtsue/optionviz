"use client";

interface Props {
  value: number;
  onChange: (v: number) => void;
  dteAtTarget: number;
}

export function TimeSlider({ value, onChange, dteAtTarget }: Props) {
  const label = value <= 0.001 ? "Today" : value >= 0.999 ? "Expiry" : `${dteAtTarget.toFixed(0)}d to expiry`;
  return (
    <div className="card space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="label">Time to expiration</div>
        <div className="text-sm font-semibold">{label}</div>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-gray-500">
        <span>Today</span>
        <span>Halfway</span>
        <span>Expiry</span>
      </div>
    </div>
  );
}
