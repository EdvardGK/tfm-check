/** The Oppsett wizard (issue #1), built from the approved mocks
 *  (frontend/mocks/oppsett-kilde.html, oppsett-etasjer.html): one centred
 *  measure, the rail (file, step index, the step's options) on the left,
 *  the step bar and the step's bands on the canvas.
 *
 *  The walk: the choice (Statsbygg, Egendefinert, Åpne regelsett), Åpne IFC,
 *  Kilde, Format, Etasjer, Scope, Oppsummering. Statsbygg lays the standard
 *  on every step and opens Oppsummering once the model is read. «Bruk» takes
 *  a step's answer and moves on; a summary row opens its step and its «Bruk»
 *  returns to the summary. «Forrige» goes back along the path taken. */

import { useRef, useState, type DragEvent } from "react";
import { downloadRegister, getInventory, readIfc as readModel, type ReadProgress } from "../api";
import Loader from "./Loader";
import { sequenceToExample } from "../constants";
import type { Inventory, Preset, RulesDict, UploadResponse } from "../types";
import "./oppsett.css";
import { Bar, Rail, RailSlot, type Dot, type RailItem } from "./Shell";
import { Live, type LiveAnswer } from "./live";
import StartStep from "./StartStep";
import IfcStep from "./IfcStep";
import KildeStep from "./KildeStep";
import FormatStep from "./FormatStep";
import EtasjerStep, { schemeAnswer } from "./EtasjerStep";
import ScopeStep from "./ScopeStep";
import StatusStep from "./StatusStep";
import SummaryStep from "./SummaryStep";
import { usePreview } from "./usePreview";
import {
  STATUS_STANDARD, STEP_NAME, WALK, download, floorResult, fmt, formatResult, isStandardFormat, isStandardSource,
  locationText, parseSetup, rulesFor, sameLocation, setupFileName, setupJson, sourceResult, sourceText, statsbyggRules,
  statusResult, storeSetup, withFag, withStatsbyggFloors, type Base, type SetupFile, type Step, type WalkStep,
} from "./setup";

/** The rail's steps, numbered. */
const INDEX: readonly (WalkStep | "end")[] = [...WALK, "end"];

const nextOf = (s: Step): Step => {
  if (s === "start") return "ifc";
  const i = WALK.indexOf(s as WalkStep);
  return i < 0 || i === WALK.length - 1 ? "end" : WALK[i + 1];
};

const isModelFile = (name: string) => /\.(ifc|ifczip)$/i.test(name);

export interface Accepted {
  upload: UploadResponse;
  rules: RulesDict;
}

/** A step's answer as the rail prints it, from the committed rules. */
function committedAnswer(s: WalkStep | "end", rules: RulesDict | null, inv: Inventory | null): LiveAnswer {
  if (!rules) return { answer: "", standard: false };
  switch (s) {
    case "ifc":
      return { answer: inv ? `${fmt(inv.products)} elementer` : "", standard: false };
    case "kilde":
      return { answer: sourceText(rules), standard: isStandardSource(rules) };
    case "format":
      return isStandardFormat(rules)
        ? { answer: "", standard: true }
        : { answer: rules.patterns.map((p) => sequenceToExample(p.sequence)).join(" | "), standard: false };
    case "etasjer":
      return schemeAnswer(rules.floor_style ?? "");
    case "scope": {
      const out = [...(rules.scope_components ?? []), ...(rules.scope_types ?? [])];
      return out.length ? { answer: out.join(", "), standard: false } : { answer: "", standard: true };
    }
    case "status":
      return {
        answer: rules.status_location ? locationText(rules.status_location) : "",
        standard: sameLocation(rules.status_location ?? undefined, STATUS_STANDARD),
      };
    default:
      return { answer: "", standard: false };
  }
}

export default function Oppsett({
  presets,
  stored,
  onStored,
  checking,
  error,
  onError,
  onAccept,
}: {
  presets: Preset[];
  /** The setup kept in this browser: its rules for the model's discipline
   *  are pinned as «Regelsett» on the mapping steps. */
  stored: SetupFile | null;
  onStored: (file: SetupFile) => void;
  checking: boolean;
  error: string | null;
  onError: (msg: string | null) => void;
  onAccept: (a: Accepted) => void;
}) {
  const [step, setStep] = useState<Step>("start");
  // The screens the walk came through, so «Forrige» returns to the one
  // before this (Statsbygg goes Åpne IFC → Oppsummering, a summary row to
  // its step and back), not to the step before it in the index.
  const [trail, setTrail] = useState<Step[]>([]);
  const [visit, setVisit] = useState(0);
  const [base, setBase] = useState<Base | null>(null);
  const [rules, setRules] = useState<RulesDict | null>(null);
  const [saved, setSaved] = useState<SetupFile | null>(stored);
  // The rules came from an opened setup (applied on load), not only pinned.
  const [opened, setOpened] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [confirmed, setConfirmed] = useState<ReadonlySet<WalkStep>>(new Set());
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [readProgress, setReadProgress] = useState<ReadProgress | null>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [detour, setDetour] = useState(false);
  const [live, setLive] = useState<(LiveAnswer & { step: Step }) | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const loaded = upload !== null && inv !== null;
  const fag = upload?.detected_discipline ?? null;
  const savedRules = rulesFor(saved, fag);
  const preview = usePreview(loaded ? upload.upload_id : null, rules);

  const go = (s: Step) => {
    if (s !== step) setTrail((t) => [...t, step]);
    setLive(null);
    setStep(s);
    setVisit((v) => v + 1);
  };

  const back: Step | null = trail.length > 0 ? trail[trail.length - 1] : null;
  const goBack = () => {
    if (back === null) return;
    setTrail((t) => t.slice(0, -1));
    setLive(null);
    setStep(back);
    setVisit((v) => v + 1);
  };

  // ---- The choice ----
  const begin = (b: Base, r: RulesDict, file: SetupFile | null) => {
    onError(null);
    setBase(b);
    if (file) setSaved(file);
    setOpened(file !== null);
    setConfirmed(new Set());
    setDetour(false);
    const statsbygg = b === "statsbygg" && !file;
    const fromFile = file ? rulesFor(file, fag) : null;
    const start = fromFile ?? r;
    setRules(loaded && inv && statsbygg ? withStatsbyggFloors(start, inv) : start);
    go(loaded ? (statsbygg ? "end" : "kilde") : "ifc");
  };

  const openSetup = (f: File) => {
    f.text()
      .then((text) => {
        const s = parseSetup(text);
        begin(s.base, rulesFor(s, fag) ?? statsbyggRules(fag), s);
      })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };

  // ---- Åpne IFC ----
  const readIfc = async (file: File) => {
    if (!rules) return;
    if (!isModelFile(file.name)) {
      onError("Filen må være en .ifc- eller .ifczip-fil.");
      return;
    }
    onError(null);
    setFileName(file.name);
    setProgress(0);
    setReading(true);
    try {
      setReadProgress({ stage: "opp", pct: 0 });
      const up = await readModel(file, (p) => {
        setReadProgress(p);
        setProgress(p.stage === "opp" && p.pct < 100 ? p.pct : null);
      });
      setProgress(null);
      const inventory = await getInventory(up.upload_id);
      setUpload(up);
      setInv(inventory);
      const statsbygg = base === "statsbygg" && !opened;
      // An opened setup applies its rules for the model's discipline.
      const fromFile = opened ? rulesFor(saved, up.detected_discipline) : null;
      let r: RulesDict = fromFile ?? { ...rules, discipline_key: up.detected_discipline ?? rules.discipline_key };
      if (statsbygg) r = withStatsbyggFloors(r, inventory);
      setRules(r);
      go(statsbygg ? "end" : "kilde");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      setProgress(null);
      setReadProgress(null);
    }
  };

  // ---- Bruk ----
  const commit = (s: WalkStep, patch: Partial<RulesDict>) => {
    setRules((r) => (r ? { ...r, ...patch } : r));
    setConfirmed((c) => new Set([...c, s]));
    go(detour ? "end" : nextOf(s));
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

  // ---- The rail ----
  const dotOf = (s: WalkStep | "end"): Dot => {
    if (s === "ifc") return loaded ? "ok" : "open";
    if (s === "end" || !inv || !rules) return "open";
    const res =
      s === "kilde"
        ? sourceResult(inv, rules, preview)
        : s === "format"
          ? formatResult(preview)
          : s === "etasjer"
            ? floorResult(preview)
            : s === "status"
              ? statusResult(inv, rules)
              : null;
    if (res?.verdict === "fail") return "bad";
    return confirmed.has(s) ? "ok" : "open";
  };

  const items: RailItem[] = INDEX.map((s, i) => {
    const current = s === step;
    const ans = base === null ? { answer: "", standard: false } : current && live?.step === s ? live : committedAnswer(s, rules, inv);
    const done = s === "ifc" ? loaded : s !== "end" && confirmed.has(s);
    return {
      key: s,
      name: STEP_NAME[s],
      n: i + 1,
      dot: base === null ? "open" : dotOf(s),
      answer: ans.answer,
      standard: ans.standard,
      current,
      pending: !current && !done,
      enabled: base !== null && !reading && (s === "ifc" || loaded),
      onClick: () => {
        if (s === step) return;
        setDetour(false);
        go(s);
      },
    };
  });

  // ---- The step ----
  const stepIndex = step === "start" ? null : INDEX.indexOf(step as WalkStep | "end") + 1;
  const bar = { name: STEP_NAME[step], n: stepIndex, total: INDEX.length, error, onBack: back !== null && !reading ? goBack : null };

  let body: React.ReactNode = null;
  if (step === "start") {
    body = (
      <StartStep
        onStatsbygg={() => begin("statsbygg", statsbyggRules(upload?.detected_discipline ?? null), null)}
        onCustom={() => begin("custom", { ...statsbyggRules(upload?.detected_discipline ?? null), floor_style: "" }, null)}
        onOpen={openSetup}
      />
    );
  } else if (step === "ifc") {
    body = (
      <IfcStep
        dragging={dragging}
        busy={reading}
        progress={progress}
        fileName={loaded ? upload.file_name : fileName}
        loaded={loaded ? { products: inv.products } : null}
        onFile={(f) => void readIfc(f)}
        onUse={() => go(detour ? "end" : "kilde")}
      />
    );
  } else if (rules && inv && upload) {
    const uid = upload.upload_id;
    if (step === "kilde") {
      body = (
        <KildeStep
          uploadId={uid}
          inv={inv}
          rules={rules}
          saved={savedRules}
          fresh={!confirmed.has("kilde") && !opened}
          onUse={(patch) => commit("kilde", patch)}
        />
      );
    } else if (step === "format") {
      body = (
        <FormatStep
          uploadId={uid}
          rules={rules}
          presets={presets}
          pickBest={base === "custom" && !opened && !confirmed.has("format")}
          onUse={(patch) => commit("format", patch)}
        />
      );
    } else if (step === "etasjer") {
      body = (
        <EtasjerStep
          uploadId={uid}
          inv={inv}
          rules={rules}
          autoScheme={base === "custom" && !opened && !confirmed.has("etasjer")}
          onUse={(patch) => commit("etasjer", patch)}
        />
      );
    } else if (step === "scope") {
      body = <ScopeStep uploadId={uid} rules={rules} onUse={(patch) => commit("scope", patch)} />;
    } else if (step === "status") {
      body = (
        <StatusStep
          uploadId={uid}
          inv={inv}
          rules={rules}
          saved={savedRules}
          fresh={!confirmed.has("status") && !opened}
          onUse={(patch) => commit("status", patch)}
        />
      );
    } else if (step === "end") {
      body = (
        <SummaryStep
          inv={inv}
          upload={upload}
          rules={rules}
          preview={preview}
          checking={checking}
          registering={registering}
          onSave={() => {
            const file = withFag(saved, base ?? "custom", fag, rules);
            setSaved(file);
            storeSetup(file);
            onStored(file);
            download(setupFileName(rules, upload), setupJson(file));
          }}
          onRegister={() => {
            onError(null);
            setRegistering(true);
            downloadRegister(upload.upload_id, rules, upload.file_name.replace(/\.ifc(zip)?$/i, ""))
              .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
              .finally(() => setRegistering(false));
          }}
          onRow={(s) => {
            setDetour(true);
            go(s);
          }}
          onReview={() => {
            setDetour(false);
            go("kilde");
          }}
          onAccept={() => onAccept({ upload, rules })}
          onProjectName={(name) => setRules((r) => (r ? { ...r, project_name: name } : r))}
        />
      );
    }
  }

  return (
    <div id="oppsett" {...dropProps}>
      {reading ? <Loader progress={readProgress} /> : null}
      <div className="flow">
        <div className="railcol">
          <Rail
            file={loaded ? { name: upload.file_name, schema: [fag, upload.facts.schema].filter(Boolean).join(" · ") } : null}
            items={items}
          />
          <div ref={setSlot} style={{ display: "contents" }} />
        </div>
        <RailSlot.Provider value={slot}>
          <Bar.Provider value={bar}>
            <Live.Provider value={setLive}>
              <StepFrame key={`${step}-${visit}`} step={step}>
                {body}
              </StepFrame>
            </Live.Provider>
          </Bar.Provider>
        </RailSlot.Provider>
      </div>
    </div>
  );
}

/** Keys the step's state to the visit, so a step opens fresh each time. */
function StepFrame({ children, step }: { children: React.ReactNode; step: Step }) {
  return (
    <section aria-label={STEP_NAME[step]} style={{ display: "contents" }}>
      {children}
    </section>
  );
}
