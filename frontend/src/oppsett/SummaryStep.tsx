import { createPortal } from "react-dom";
import { useContext } from "react";
import type { Inventory, Preview, RulesDict } from "../types";
import { sequenceToExample } from "../constants";
import {
  STEP_NAME, floorResult, fmt, formatResult, isStandardFormat, isStandardSource, locationText, sourceResult,
  type StepResult, type WalkStep,
} from "./setup";
import { CONFIRM, CONFIRM_QUIET, INPUT, LABEL, ResultChip, SlotContext } from "./ui";

interface Row {
  step: WalkStep;
  text: string;
  result: StepResult | null;
  standard: boolean;
}

const STYLE_NAME: Record<string, string> = { statsbygg: "Statsbygg", u: "U1 · 01", custom: "Egendefinert" };

export function summaryRows(inv: Inventory, rules: RulesDict, preview: Preview | null): Row[] {
  const codes = Object.values(rules.storey_codes ?? {}).filter((c) => c.trim() !== "");
  const scope = [...(rules.scope_components ?? []), ...(rules.scope_types ?? [])];
  return [
    { step: "kilde", text: locationText(rules.tfm_location), result: sourceResult(inv, rules), standard: isStandardSource(rules) },
    {
      step: "format",
      text: rules.patterns.map((p) => sequenceToExample(p.sequence)).join("  |  "),
      result: formatResult(preview),
      standard: isStandardFormat(rules),
    },
    {
      step: "etasjer",
      text: [STYLE_NAME[rules.floor_style ?? ""] ?? "", `${codes.length} / ${inv.storeys.length}`].filter(Boolean).join(" · "),
      result: floorResult(preview),
      standard: rules.floor_style === "statsbygg",
    },
    {
      step: "scope",
      text: scope.length ? scope.join(", ") : "–",
      result: preview ? { verdict: "na", figure: `${fmt(preview.excluded)} / ${fmt(preview.products)}` } : null,
      standard: false,
    },
  ];
}

/** Oppsummering: per step what is set and its result on the loaded model;
 *  a row opens its step. The primary follows the result: «Gjennomgå» when
 *  a row at the standard fails, else «Aksepter oppsett». */
export default function SummaryStep({
  inv,
  rules,
  preview,
  set,
  checking,
  onRow,
  onReview,
  onAccept,
  onProjectName,
}: {
  inv: Inventory;
  rules: RulesDict;
  preview: Preview | null;
  set: (s: WalkStep) => boolean;
  checking: boolean;
  onRow: (s: WalkStep) => void;
  onReview: () => void;
  onAccept: () => void;
  onProjectName: (name: string) => void;
}) {
  const slot = useContext(SlotContext);
  const rows = summaryRows(inv, rules, preview);
  const failing = rows.some((r) => r.standard && r.result?.verdict === "fail");

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-line bg-panel">
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.step} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onRow(r.step)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-input"
              >
                <span aria-hidden="true" className={"w-4 shrink-0 text-center text-[12px] " + (set(r.step) ? "text-ink" : "text-muted")}>
                  {set(r.step) ? "●" : "○"}
                </span>
                <span className="w-32 shrink-0 text-[14px] text-ink">{STEP_NAME[r.step]}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={r.text}>
                  {r.standard ? <span className={LABEL + " mr-2 text-[11px]"}>Standard</span> : null}
                  {r.text}
                </span>
                <ResultChip result={r.result} />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Prosjektnavn</span>
        <input
          value={rules.project_name ?? ""}
          onChange={(e) => onProjectName(e.target.value)}
          className={INPUT + " w-full max-w-md"}
        />
      </label>

      {slot
        ? createPortal(
            <>
              <button
                type="button"
                data-lead={failing}
                onClick={onReview}
                className={failing ? CONFIRM : CONFIRM_QUIET}
              >
                Gjennomgå →
              </button>
              <button
                type="button"
                data-lead={!failing}
                disabled={checking}
                onClick={onAccept}
                className={(failing ? CONFIRM_QUIET : CONFIRM) + " disabled:opacity-60"}
              >
                {checking ? "Kjører …" : "Aksepter oppsett →"}
              </button>
            </>,
            slot,
          )
        : null}
    </div>
  );
}
