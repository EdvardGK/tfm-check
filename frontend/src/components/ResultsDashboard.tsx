import { useEffect, useRef, useState } from "react";
import {
  Download, FileSpreadsheet, FileText, Package, SlidersHorizontal,
  RefreshCw, AlertTriangle, Eye,
} from "lucide-react";

import { downloadReport } from "../api";
import { applicableChecks } from "../results";
import { statusColor } from "../constants";
import type { CheckResponse, RulesDict, UploadResponse } from "../types";
import MetricCard from "./MetricCard";
import DrillDownDialog from "./DrillDownDialog";

interface Props {
  upload: UploadResponse;
  config: RulesDict;
  check: CheckResponse;
  onAdjust: () => void;
  onReset: () => void;
}

type DialogState = { title: string; rows: Record<string, string | number>[] } | null;

function dictRows(
  d: Record<string, number>,
  keyCol: string,
  valCol = "Antall",
): Record<string, string | number>[] {
  return Object.entries(d).map(([k, v]) => ({ [keyCol]: k, [valCol]: v }));
}

const DISC_LABEL: Record<string, string> = {
  RIE: "RIE — Elektro", RIV: "RIV — VVS", RIB: "RIB — Bygg",
  ARK: "ARK — Arkitekt", RIBR: "RIBR — Brann", Annet: "Annet / ukjent",
};

export default function ResultsDashboard({ upload, config, check, onAdjust, onReset }: Props) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  const { results, duration, location_label } = check;
  const checks = results.checks;
  const headline = checks.has_code.pct;
  const headlineShown = useCountUp(headline);
  const fileStem = upload.file_name.replace(/\.ifc$/i, "");

  const flags: { key: string; label: string; data: Record<string, number> }[] = [];
  const cd = sum(results.cross_disc);
  const ib = sum(results.invalid_bd);
  const ik = sum(results.invalid_komp);
  if (cd) flags.push({ key: "cd", label: `${cd} kryssfag`, data: results.cross_disc });
  if (ib) flags.push({ key: "ib", label: `${ib} ugyldige systemkoder`, data: results.invalid_bd });
  if (ik) flags.push({ key: "ik", label: `${ik} ugyldige komponentbokstaver`, data: results.invalid_komp });

  const applicable = applicableChecks(results);

  async function dl(fmt: "zip" | "xlsx" | "pdf") {
    setDlError(null);
    setDownloading(fmt);
    try {
      await downloadReport(upload.upload_id, config, fmt, fileStem);
    } catch (e) {
      setDlError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {config.project_name || "(uten navn)"} ·{" "}
            <span className="text-muted">
              {DISC_LABEL[config.discipline_key] ?? config.discipline_key}
            </span>
          </h2>
          <p className="text-xs text-muted">
            {upload.file_name} · {duration.toFixed(1)}s · TFM-kode fra {location_label}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAdjust}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-sm hover:border-accent"
          >
            <SlidersHorizontal size={14} /> Juster og kjør på nytt
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-sm hover:border-accent"
          >
            <RefreshCw size={14} /> Ny fil
          </button>
        </div>
      </div>

      {/* Headline */}
      <div
        className="rounded-2xl border border-line bg-card p-6 text-center"
        style={{ borderTop: `4px solid ${statusColor(headline)}` }}
      >
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">
          Elementer med TFM-kode
        </div>
        <div
          className="mt-1 text-5xl font-bold tabular-nums"
          style={{ color: statusColor(headline) }}
        >
          {headlineShown.toFixed(1)}%
        </div>
        <div className="mt-1 text-sm text-muted tabular-nums">
          {checks.has_code.n.toLocaleString("nb-NO")} av{" "}
          {checks.has_code.total.toLocaleString("nb-NO")} produkter
        </div>
      </div>

      {/* Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flags.map((f) => (
            <button
              key={f.key}
              onClick={() =>
                setDialog({ title: f.label, rows: dictRows(f.data, "Kode") })
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm font-medium text-warn hover:bg-warn/20"
            >
              <AlertTriangle size={14} /> {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {applicable.map(([key, c]) => (
          <MetricCard
            key={key}
            label={c.label}
            pct={c.pct}
            sub={`${c.n.toLocaleString("nb-NO")} / ${c.total.toLocaleString("nb-NO")}`}
          />
        ))}
      </div>

      {/* Bar chart */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Andel per sjekk
        </h3>
        <div className="space-y-2">
          {applicable.map(([key, c]) => (
            <div key={key} className="flex items-center gap-3">
              <div className="w-44 shrink-0 truncate text-xs text-fg" title={c.label}>
                {c.label}
              </div>
              <div className="h-4 flex-1 overflow-hidden rounded bg-line">
                <div
                  className="h-full rounded transition-all duration-700"
                  style={{ width: `${Math.min(c.pct, 100)}%`, background: statusColor(c.pct) }}
                />
              </div>
              <div className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">
                {c.pct.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail drill-downs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DetailBtn
          label="Uten kode"
          count={results.missing_samples.length}
          onClick={() =>
            setDialog({ title: "Elementer uten TFM-kode (utvalg)", rows: results.missing_samples })
          }
        />
        <DetailBtn
          label="Ugyldig kode"
          count={results.invalid_samples.length}
          onClick={() =>
            setDialog({ title: "Elementer med ugyldig kode (utvalg)", rows: results.invalid_samples })
          }
        />
        <DetailBtn
          label="IfcSystems"
          count={results.sys_rows.length}
          onClick={() => setDialog({ title: "IfcSystems i modellen", rows: results.sys_rows })}
        />
        <DetailBtn
          label="Uten system"
          count={sum(results.unassigned_by_type)}
          onClick={() =>
            setDialog({
              title: "Elementtyper uten systemtilhørighet",
              rows: dictRows(results.unassigned_by_type, "IfcType"),
            })
          }
        />
      </div>

      {/* Aggregations */}
      <div className="space-y-2">
        <Agg title="Coverage per IfcType" rows={results.type_rows} />
        <Agg title="TFM-koder funnet" rows={dictRows(results.seen_systems, "Kode")} />
        <Agg title="Komponentkoder funnet" rows={dictRows(results.seen_components, "Kode")} />
        <Agg title="Etasjekoder funnet" rows={dictRows(results.seen_floors, "Kode")} />
      </div>

      {/* Reports */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Last ned rapport
        </h3>
        {dlError && <p className="mb-2 text-sm text-bad">{dlError}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            onClick={() => dl("zip")}
            disabled={downloading !== null}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-fg hover:brightness-105 disabled:opacity-50"
          >
            {downloading === "zip" ? <RefreshCw size={16} className="animate-spin" /> : <Package size={16} />}
            ZIP (Excel + PDF)
          </button>
          <button
            onClick={() => dl("xlsx")}
            disabled={downloading !== null}
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg py-3 font-medium hover:border-accent disabled:opacity-50"
          >
            <FileSpreadsheet size={16} /> Bare Excel
          </button>
          <button
            onClick={() => dl("pdf")}
            disabled={downloading !== null}
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-bg py-3 font-medium hover:border-accent disabled:opacity-50"
          >
            <FileText size={16} /> Bare PDF
          </button>
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-subtle">
          <Download size={12} /> Rapporten lastes ned lokalt. Ingen modelldata lagres.
        </p>
      </div>

      {dialog && (
        <DrillDownDialog title={dialog.title} rows={dialog.rows} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function sum(d: Record<string, number>): number {
  return Object.values(d).reduce((a, b) => a + b, 0);
}

// Ease a number from 0 → target once on mount (respects reduced-motion).
function useCountUp(target: number, ms = 700): number {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(target * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

function DetailBtn({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm hover:border-accent disabled:opacity-40"
    >
      <span className="flex items-center gap-1.5">
        <Eye size={14} className="text-muted" /> {label}
      </span>
      <span className="rounded-full bg-bg px-2 text-xs font-semibold tabular-nums">{count}</span>
    </button>
  );
}

function Agg({ title, rows }: { title: string; rows: Record<string, string | number>[] }) {
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]);
  return (
    <details className="rounded-lg border border-line bg-card">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
        {title} <span className="text-muted">({rows.length})</span>
      </summary>
      <div className="max-h-72 overflow-auto border-t border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-3 py-1.5 text-left font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/50 last:border-0">
                {columns.map((c) => (
                  <td key={c} className="px-3 py-1 tabular-nums">{String(r[c] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
