/** The Oppsett walk (issue #1), after ifc-check's walk: the choice
 *  (Statsbygg, Egendefinert, Åpne regelsett), Åpne IFC, then one question
 *  per step with the answer pre-picked, «Bruk» taking it and moving on, a
 *  clickable bar, «Forrige», «Hopp over», and Oppsummering at the end.
 *
 *  Statsbygg lays the standard on every step and opens Oppsummering once
 *  the model is read: «Gjennomgå» walks the steps, «Aksepter oppsett» runs
 *  the check. A summary row opens its step, and the step's «Bruk» returns
 *  to the summary. */

import { useCallback, useRef, useState, type DragEvent } from "react";
import { getInventory, uploadIfc } from "../api";
import type { Inventory, Location, Preset, RulesDict, UploadResponse } from "../types";
import Choice from "./Choice";
import IfcStage, { STAGE_WIDTH } from "./IfcStage";
import SourceStep from "./SourceStep";
import FormatStep from "./FormatStep";
import FloorStep from "./FloorStep";
import ScopeStep from "./ScopeStep";
import SummaryStep from "./SummaryStep";
import type { FloorStyle } from "./floors";
import { usePreview } from "./usePreview";
import {
  STEP_NAME, WALK, download, floorResult, fmt, formatResult, parseSetup, setupFileName, setupJson,
  sourceResult, statsbyggRules, withStatsbyggFloors, type Base, type SetupFile, type Step, type StepResult,
  type WalkStep,
} from "./setup";
import { ConfirmSlotProvider, Landed, ResultChip, SECONDARY, StepConfirm, WalkProgress, type SegmentState } from "./ui";

const FRAME = "max-w-5xl 2xl:max-w-7xl min-[137.5rem]:max-w-[100rem]";

const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const nextOf = (s: Step): Step => {
  if (s === "start") return "ifc";
  const i = WALK.indexOf(s as WalkStep);
  return i < 0 || i === WALK.length - 1 ? "end" : WALK[i + 1];
};
const prevOf = (s: Step): Step | null => {
  if (s === "start") return null;
  if (s === "end") return WALK[WALK.length - 1];
  const i = WALK.indexOf(s as WalkStep);
  return i <= 0 ? "start" : WALK[i - 1];
};

export interface Accepted {
  upload: UploadResponse;
  rules: RulesDict;
}

export default function Oppsett({
  presets,
  checking,
  error,
  onError,
  onAccept,
}: {
  presets: Preset[];
  checking: boolean;
  error: string | null;
  onError: (msg: string | null) => void;
  onAccept: (a: Accepted) => void;
}) {
  const [step, setStep] = useState<Step>("start");
  const [visit, setVisit] = useState(0);
  const [base, setBase] = useState<Base | null>(null);
  const [rules, setRules] = useState<RulesDict | null>(null);
  const [saved, setSaved] = useState<SetupFile | null>(null);
  const [preset, setPreset] = useState<Set<WalkStep>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<WalkStep>>(new Set());
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [detour, setDetour] = useState(false);
  const [landed, setLanded] = useState<{ from: WalkStep; to: Step } | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const preview = usePreview(upload?.upload_id ?? null, rules);
  const loaded = upload !== null && inv !== null;

  const go = useCallback((s: Step) => {
    setStep(s);
    setVisit((v) => v + 1);
  }, []);

  // ---- The choice ----
  const begin = (b: Base, r: RulesDict, file: SetupFile | null) => {
    onError(null);
    setBase(b);
    setRules(r);
    setSaved(file);
    setPreset(new Set(file || b === "statsbygg" ? (["kilde", "format", "etasjer", "scope"] as WalkStep[]) : []));
    setConfirmed(new Set());
    setLanded(null);
    go(loaded ? (b === "statsbygg" && !file ? "end" : "kilde") : "ifc");
    if (loaded && inv && b === "statsbygg" && !file) setRules(withStatsbyggFloors(r, inv));
  };

  const openFile = (f: File) => {
    f.text()
      .then((text) => {
        const s = parseSetup(text);
        begin(s.base, s.rules, s);
      })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };

  // ---- Åpne IFC ----
  const readIfc = async (file: File) => {
    if (!rules) return;
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      onError("Filen må være en .ifc-fil.");
      return;
    }
    onError(null);
    setFileName(file.name);
    setPct(0);
    setReading(true);
    try {
      const up = await uploadIfc(file, (p) => setPct(p >= 100 ? null : p));
      setPct(null);
      const inventory = await getInventory(up.upload_id);
      setUpload(up);
      setInv(inventory);
      let r: RulesDict = saved ? rules : { ...rules, discipline_key: up.detected_discipline ?? rules.discipline_key };
      if (base === "statsbygg" && !saved) r = withStatsbyggFloors(r, inventory);
      setRules(r);
      setConfirmed((c) => new Set([...c, "ifc"]));
      setLanded({ from: "ifc", to: base === "statsbygg" && !saved ? "end" : "kilde" });
      go(base === "statsbygg" && !saved ? "end" : "kilde");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      setPct(null);
    }
  };

  // ---- Bruk ----
  const commit = (s: WalkStep, patch: Partial<RulesDict>) => {
    setRules((r) => (r ? { ...r, ...patch } : r));
    setConfirmed((c) => new Set([...c, s]));
    const to = detour ? "end" : nextOf(s);
    setLanded({ from: s, to });
    go(to);
  };

  const skip = () => {
    setLanded(null);
    go(detour ? "end" : nextOf(step));
  };

  const segment = (s: WalkStep): SegmentState => {
    if (s === "ifc") return loaded ? "done" : "open";
    if (loaded && confirmed.has(s)) return "done";
    return preset.has(s) || confirmed.has(s) ? "saved" : "open";
  };

  const onBar = (s: WalkStep) => {
    if (!loaded && s !== "ifc") return;
    setDetour(false);
    setLanded(null);
    go(s);
  };

  // ---- Page drop (Åpne IFC) ----
  const dropProps =
    step === "ifc" && !reading
      ? {
          onDragEnter: (e: DragEvent) => {
            e.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          },
          onDragOver: (e: DragEvent) => e.preventDefault(),
          onDragLeave: () => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void readIfc(f);
          },
        }
      : {};

  // ---- What a confirmed step gave ----
  const resultOf = (s: WalkStep): StepResult | null => {
    if (!inv || !rules) return null;
    if (s === "ifc") return null;
    if (s === "kilde") return sourceResult(inv, rules);
    if (s === "format") return formatResult(preview);
    if (s === "etasjer") return floorResult(preview);
    return null;
  };
  const landedText = (s: WalkStep): string | null => {
    if (!inv || !rules) return null;
    if (s === "ifc" && upload) return `${upload.file_name} · ${fmt(inv.products)}`;
    if (s === "etasjer") {
      const n = inv.storeys.filter((x) => (rules.storey_codes?.[x.name] ?? "").trim() !== "").length;
      return `${n} / ${inv.storeys.length}`;
    }
    if (s === "scope" && preview) return `${fmt(preview.excluded)} / ${fmt(preview.products)}`;
    return null;
  };

  // ---- The step ----
  const stage = step === "ifc" && !loaded;
  const centered = stage || step === "start";
  const uid = upload?.upload_id ?? "";

  let body: React.ReactNode = null;
  if (step === "start") {
    body = (
      <Choice
        onStatsbygg={() => begin("statsbygg", statsbyggRules(upload?.detected_discipline ?? null), null)}
        onCustom={() => begin("custom", { ...statsbyggRules(upload?.detected_discipline ?? null), floor_style: "" }, null)}
        onOpen={openFile}
      />
    );
  } else if (step === "ifc") {
    body = (
      <div className={"mx-auto flex flex-col gap-4 " + STAGE_WIDTH}>
        <IfcStage dragging={dragging} busy={reading} pct={pct} fileName={fileName} onFile={(f) => void readIfc(f)} />
        {!loaded && !reading ? (
          <button type="button" onClick={() => go("start")} className="w-fit px-1 py-2 text-[13px] text-muted hover:text-ink">
            ← Forrige
          </button>
        ) : null}
        {loaded ? <StepConfirm onClick={() => go(detour ? "end" : "kilde")} /> : null}
      </div>
    );
  } else if (rules && inv && upload) {
    const savedLoc: Location | null = saved?.rules.tfm_location ?? null;
    if (step === "kilde") {
      body = <SourceStep inv={inv} current={rules.tfm_location} saved={savedLoc} onUse={(loc) => commit("kilde", { tfm_location: loc })} />;
    } else if (step === "format") {
      body = (
        <FormatStep
          uploadId={uid}
          rules={rules}
          presets={presets}
          pickBest={base === "custom" && !saved && !confirmed.has("format")}
          onUse={(patch) => commit("format", patch)}
        />
      );
    } else if (step === "etasjer") {
      const fresh = base === "custom" && !saved && !confirmed.has("etasjer");
      const style: FloorStyle = fresh ? "statsbygg" : (rules.floor_style as FloorStyle) || "statsbygg";
      body = (
        <FloorStep
          uploadId={uid}
          inv={inv}
          rules={fresh ? { ...rules, storey_codes: {} } : rules}
          initialStyle={style}
          autoStyle={fresh}
          onUse={(patch) => commit("etasjer", patch)}
        />
      );
    } else if (step === "scope") {
      body = <ScopeStep uploadId={uid} rules={rules} onUse={(patch) => commit("scope", patch)} />;
    } else if (step === "end") {
      body = (
        <SummaryStep
          inv={inv}
          rules={rules}
          preview={preview}
          set={(s) => confirmed.has(s) || preset.has(s)}
          checking={checking}
          onRow={(s) => {
            setDetour(true);
            setLanded(null);
            go(s);
          }}
          onReview={() => {
            setDetour(false);
            setLanded(null);
            go("kilde");
          }}
          onAccept={() => onAccept({ upload, rules })}
          onProjectName={(name) => setRules((r) => (r ? { ...r, project_name: name } : r))}
        />
      );
    }
  }

  const back = prevOf(step);
  const showFoot = !centered;
  const canSkip = step !== "ifc" && step !== "end" && step !== "start";

  return (
    <ConfirmSlotProvider value={slot}>
      <div className="oppsett flex h-dvh flex-col" {...dropProps}>
        {framed ? null : (
          <header className="shrink-0 px-3 pt-3">
            <div className={"mx-auto w-full text-[15px] font-semibold tracking-tight text-ink " + FRAME}>TFM-sjekk</div>
          </header>
        )}

        {centered ? null : (
          <div className="shrink-0 px-3 pt-3">
            <div className={"mx-auto flex w-full items-center gap-4 " + FRAME}>
              <WalkProgress steps={WALK} current={step === "end" ? null : (step as WalkStep)} state={segment} onStep={onBar} />
              {rules ? (
                <button
                  type="button"
                  onClick={() => download(setupFileName(rules, upload), setupJson(base ?? "custom", rules))}
                  className={SECONDARY}
                >
                  Lagre oppsett
                </button>
              ) : null}
            </div>
          </div>
        )}

        {centered ? null : (
          <div className="shrink-0 px-3 pt-2">
            <div className={"mx-auto flex min-h-12 w-full flex-col justify-center " + FRAME}>
              {landed !== null && landed.to === step ? (
                <Landed key={landed.from} label={STEP_NAME[landed.from]}>
                  <ResultChip result={resultOf(landed.from)} />
                  {landedText(landed.from) ? (
                    <span className="font-mono text-[12px] tabular-nums text-muted">{landedText(landed.from)}</span>
                  ) : null}
                </Landed>
              ) : null}
            </div>
          </div>
        )}

        <div data-walk className="min-h-0 flex-1 overflow-auto px-3 pb-3 [container-type:size] [scrollbar-gutter:stable_both-edges]">
          <div className={"mx-auto flex min-h-full w-full flex-col " + FRAME}>
            <div aria-hidden="true" className={centered ? "min-h-6 flex-[2_1_0%]" : "h-4 shrink-0"} />
            <div className="flex min-w-0 flex-col gap-4">
              {error !== null ? (
                <pre className="m-0 bg-bad px-3 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap text-cream">{error}</pre>
              ) : null}
              <section key={`${step}-${visit}`} aria-label={STEP_NAME[step]} className="flex min-w-0 flex-col gap-4">
                {body}
              </section>
              {showFoot ? (
                <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-3">
                  {back ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLanded(null);
                        go(back);
                      }}
                      className="min-h-12 px-1 text-[15px] text-muted hover:text-ink"
                    >
                      ← Forrige
                    </button>
                  ) : null}
                  <span className="flex-1" />
                  {canSkip ? (
                    <button
                      type="button"
                      onClick={skip}
                      className="flex min-h-12 items-center border border-line bg-panel px-6 text-[15px] text-ink hover:border-green hover:text-green"
                    >
                      Hopp over
                    </button>
                  ) : null}
                  <div ref={setSlot} className="flex flex-wrap items-center gap-3" />
                </div>
              ) : null}
            </div>
            {centered ? <div aria-hidden="true" className="min-h-6 flex-[3_1_0%]" /> : null}
          </div>
        </div>
      </div>
    </ConfirmSlotProvider>
  );
}
