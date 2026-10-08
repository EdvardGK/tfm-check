import { sequenceToExample } from "../constants";
import type { Inventory, Preview, RulesDict, UploadResponse } from "../types";
import { Canvas, Lamp, RailOptions, StepBar } from "./Shell";
import { schemeAnswer } from "./EtasjerStep";
import RollupTiles, { useRollup } from "./Rollup";
import { IdsSection, ModelsSection, type ModelEntry } from "./Models";
import type { IdsSpec, ModelRules } from "../api";
import {
  STATUS_STANDARD, STEP_NAME, floorResult, fmt, formatResult, isStandardFormat, isStandardSource, plainSource,
  sameLocation, sourceResult, sourceText, statusResult, type StepResult, type WalkStep,
} from "./setup";

interface Row {
  step: WalkStep;
  text: string;
  result: StepResult | null;
  standard: boolean;
}

/** The rows; with no model yet (`inv` null) the answers alone, the
 *  results come with the model. */
export function summaryRows(
  inv: Inventory | null,
  fileName: string,
  rules: RulesDict,
  preview: Preview | null,
): Row[] {
  const coded = Object.values(rules.storey_codes ?? {}).filter((c) => c.trim() !== "").length;
  const scope = [...(rules.scope_components ?? []), ...(rules.scope_types ?? [])];
  const scheme = schemeAnswer(rules.floor_style ?? "");
  return [
    { step: "ifc", text: fileName, result: inv ? { verdict: "na", figure: `${fmt(inv.products)}` } : null, standard: false },
    { step: "kilde", text: sourceText(rules), result: inv ? sourceResult(inv, rules, preview) : null, standard: isStandardSource(rules) },
    {
      step: "format",
      text: rules.patterns.map((p) => sequenceToExample(p.sequence)).join("  |  "),
      result: formatResult(preview),
      standard: isStandardFormat(rules),
    },
    {
      step: "etasjer",
      text: [scheme.answer, inv ? `${coded} / ${inv.storeys.length}` : ""].filter(Boolean).join("  ·  "),
      result: floorResult(preview),
      standard: scheme.standard,
    },
    {
      step: "scope",
      text: scope.length ? scope.join(", ") : "–",
      result: preview ? { verdict: "na", figure: `${fmt(preview.excluded)} / ${fmt(preview.products)}` } : null,
      standard: scope.length === 0,
    },
    {
      step: "status",
      text: rules.status_location ? plainSource(rules.status_location) : "–",
      result: inv ? statusResult(inv, rules) : null,
      standard: sameLocation(rules.status_location ?? undefined, STATUS_STANDARD),
    },
  ];
}

/** Oppsummering: one row per step, its answer, «Standard» and its result
 *  on the loaded model; a row opens its step. The bar's primary follows the
 *  result: «Gjennomgå» when a row at the standard fails, else «Aksepter
 *  oppsett», which runs the check. */
export default function SummaryStep({
  inv,
  upload,
  fileName,
  rules,
  preview,
  checking,
  registering,
  onSave,
  onRegister,
  models,
  rulesOf,
  activeKey,
  onModel,
  ids,
  onRow,
  onReview,
  onAccept,
  onProjectName,
}: {
  inv: Inventory | null;
  upload: UploadResponse | null;
  fileName: string;
  rules: RulesDict;
  preview: Preview | null;
  checking: boolean;
  registering: boolean;
  onSave: () => void;
  onRegister: () => void;
  models: ModelEntry[];
  rulesOf: (m: ModelEntry) => RulesDict;
  activeKey: string | null;
  onModel: (key: string) => void;
  ids: IdsSpec[] | null;
  onRow: (s: WalkStep) => void;
  onReview: () => void;
  onAccept: () => void;
  onProjectName: (name: string) => void;
}) {
  const rows = summaryRows(inv, fileName, rules, preview);
  const items: ModelRules[] = models
    .filter((m) => m.upload)
    .map((m) => ({ upload_id: m.upload?.upload_id ?? "", rules: m.key === activeKey ? rules : rulesOf(m) }));
  const roll = useRollup(items);
  const failing = rows.some((r) => r.standard && r.result?.verdict === "fail");

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <RailOptions>
        <ModelsSection models={models} rulesOf={(m) => (m.key === activeKey ? rules : rulesOf(m))} activeKey={activeKey} onPick={onModel} />
        <IdsSection specs={ids} />
      </RailOptions>
      <StepBar>
        <button type="button" className="key" onClick={onSave}>
          Lagre oppsett
        </button>
        <button type="button" className="key" disabled={registering || !upload} onClick={onRegister}>
          {registering ? "Lager register …" : "Register"}
        </button>
        <button type="button" className={failing ? "primary" : "key"} onClick={onReview}>
          Gjennomgå
        </button>
        <button type="button" className={failing ? "key" : "primary"} disabled={checking || !upload} onClick={onAccept}>
          {checking ? "Kjører …" : "Aksepter oppsett"}
        </button>
      </StepBar>

      <section className="tile card full" style={{ padding: 0, gap: 0 }} aria-label="Oppsummering">
        {rows.map((r) => (
          <button key={r.step} type="button" className="srow pick rule" onClick={() => onRow(r.step)}>
            <span className="nm">{STEP_NAME[r.step]}</span>
            <span className="a">{r.text}</span>
            <span>{r.standard ? <span className="tag">Standard</span> : null}</span>
            {r.result ? <Lamp verdict={r.result.verdict} /> : <span />}
            <span className="fg">{r.result?.figure ?? "–"}</span>
          </button>
        ))}
        <label className="pname">
          <span className="lbl">Prosjektnavn</span>
          <input value={rules.project_name ?? ""} onChange={(e) => onProjectName(e.target.value)} />
        </label>
      </section>

      <RollupTiles roll={roll} />
    </Canvas>
  );
}
