import { statusColor } from "../constants";

interface Props {
  label: string;
  pct: number;
  sub: string;
  skipped?: boolean;
}

export default function MetricCard({ label, pct, sub, skipped }: Props) {
  if (skipped) {
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </div>
        <div className="mt-2 text-2xl font-bold text-subtle">—</div>
        <div className="mt-1 text-xs text-subtle">{sub}</div>
      </div>
    );
  }
  const color = statusColor(pct);
  return (
    <div
      className="rounded-xl border border-line bg-card p-4"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums" style={{ color }}>
        {pct.toFixed(1)}%
      </div>
      <div className="mt-0.5 text-xs text-muted tabular-nums">{sub}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}
