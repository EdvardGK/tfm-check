import { useEffect, useRef, useState } from "react";
import type { Inventory, RulesDict } from "../types";
import { allowedFloors, likelyStyle, mergeCodes, proposeCodes, type FloorStyle } from "./floors";
import { usePreview } from "./usePreview";
import { fmt } from "./setup";
import { Figure, INPUT, LABEL, PANEL, STEP_TITLE, StepConfirm } from "./ui";

export interface FloorPatch {
  storey_codes: Record<string, string>;
  floor_codes: string[];
  floor_style: FloorStyle;
}

/** The styles, each named by its own codes (and Statsbygg by name). */
const STYLES: { key: FloorStyle; name?: string; example?: string }[] = [
  { key: "statsbygg", name: "Statsbygg", example: "00U · 01 · 02M · 04L · 05T" },
  { key: "u", example: "U1 · 01 · 01M" },
  { key: "custom", name: "Egendefinert" },
];

/** Etasjer: every storey of the model mapped to a floor code. A style
 *  proposes the codes from the storeys' names (elevation when no name
 *  reads); any code can be corrected, which makes the mapping custom.
 *  Beside it: the floor codes the model's values carry, against it. */
export default function FloorStep({
  uploadId,
  inv,
  rules,
  initialStyle,
  autoStyle,
  onUse,
}: {
  uploadId: string;
  inv: Inventory;
  rules: RulesDict;
  initialStyle: FloorStyle;
  /** Pre-pick the style the model's own floor codes are written in, once
   *  they are counted (Egendefinert). */
  autoStyle: boolean;
  onUse: (patch: FloorPatch) => void;
}) {
  const [style, setStyle] = useState<FloorStyle>(initialStyle);
  const [codes, setCodes] = useState<Record<string, string>>(() =>
    mergeCodes(inv.storeys, rules.storey_codes ?? {}, initialStyle),
  );
  const patch: FloorPatch = { storey_codes: codes, floor_codes: allowedFloors(codes), floor_style: style };
  const preview = usePreview(uploadId, { ...rules, ...patch });

  const touched = useRef(!autoStyle);
  useEffect(() => {
    if (touched.current || !preview) return;
    touched.current = true;
    if (!preview.floor_part) return;
    const s = likelyStyle(inv.storeys, preview.floors.seen);
    setStyle(s);
    setCodes(proposeCodes(inv.storeys, s));
  }, [preview, inv.storeys]);

  const pick = (s: FloorStyle) => {
    touched.current = true;
    setStyle(s);
    if (s !== "custom") setCodes(proposeCodes(inv.storeys, s));
  };

  const floors = preview?.floor_part ? preview.floors : null;
  const mapped = inv.storeys.filter((s) => (codes[s.name] ?? "").trim() !== "").length;

  return (
    <>
      <h1 className={STEP_TITLE}>Etasjer</h1>
      <div role="radiogroup" aria-label="Etasjer" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STYLES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={style === s.key}
            onClick={() => pick(s.key)}
            className={
              "flex min-h-16 flex-col items-start justify-center gap-1 border-2 px-4 py-3 text-left " +
              (style === s.key ? "border-ink bg-panel" : "border-line bg-panel hover:border-green")
            }
          >
            {s.name ? <span className="text-[17px] font-semibold text-ink">{s.name}</span> : null}
            {s.example ? (
              <span className={"font-mono text-ink " + (s.name ? "text-[12px] text-muted" : "text-[17px] font-semibold")}>
                {s.example}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className={PANEL + " p-0"}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className={LABEL + " px-4 py-2"}>Etasje</th>
                <th className={LABEL + " px-4 py-2 text-right"}>Kote</th>
                <th className={LABEL + " px-4 py-2 text-right"}>Elementer</th>
                <th className={LABEL + " px-4 py-2"}>Kode</th>
              </tr>
            </thead>
            <tbody>
              {inv.storeys.map((s) => (
                <tr key={s.name} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-1.5 text-ink">{s.name}</td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-muted">
                    {s.elevation === null ? "–" : fmt(Math.round(s.elevation))}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums text-muted">{fmt(s.n)}</td>
                  <td className="px-4 py-1">
                    <input
                      value={codes[s.name] ?? ""}
                      aria-label={`Kode ${s.name}`}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        touched.current = true;
                        setCodes((c) => ({ ...c, [s.name]: v }));
                        setStyle("custom");
                      }}
                      className={INPUT + " w-24"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={"flex flex-col gap-3 " + PANEL}>
          <Figure label="Etasjer" value={`${mapped} / ${inv.storeys.length}`} bad={mapped === 0} />
          {floors && floors.total > 0 ? (
            <>
              <Figure label="Etasjekode" value={`${fmt(floors.ok)} / ${fmt(floors.total)}`} bad={floors.ok === 0} />
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {floors.seen.map((f) => (
                  <li
                    key={f.code}
                    title={`${f.code} · ${fmt(f.n)}`}
                    className={
                      "flex items-baseline gap-2 border px-2 py-0.5 font-mono text-[12px] " +
                      (f.ok ? "border-line bg-input text-ink" : "border-bad bg-input text-bad")
                    }
                  >
                    <span className={f.ok ? "" : "line-through"}>{f.code}</span>
                    <span className="tabular-nums text-muted">{fmt(f.n)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <StepConfirm lead={mapped > 0} onClick={() => onUse(patch)} />
    </>
  );
}
