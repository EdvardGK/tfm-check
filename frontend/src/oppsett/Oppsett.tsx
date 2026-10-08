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

import { useEffect, useRef, useState, type DragEvent } from "react";
import { downloadRegister, getInventory, getPreview, getRollup, getValues, importIds, onModelGone, readIfc as readModel, type IdsSpec, type ReadProgress } from "../api";
import type { ModelEntry } from "./Models";
import Pending from "./Pending";
import { progressText } from "./Loader";
import { allowedFloors, proposeCodes } from "./floors";
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
  ANY_FAG, STANDARD_LOCATION, STATUS_STANDARD, STEP_NAME, WALK, download, fagFromName, schemaFromHeader, floorResult, fmt, formatResult, isStandardFormat, isStandardSource,
  locationText, plainSource, parseSetup, rulesFor, sameLocation, setupFileName, setupJson, sourceResult, sourceText, statsbyggRules,
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
        answer: rules.status_location ? plainSource(rules.status_location) : "",
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
  const [readProgress, setReadProgress] = useState<ReadProgress | null>(null);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  // Read off the file in the browser at once: its discipline and schema.
  const [fileFag, setFileFag] = useState<string | null>(null);
  const [fileSchema, setFileSchema] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [detour, setDetour] = useState(false);
  const [live, setLive] = useState<(LiveAnswer & { step: Step }) | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The session's models (the walk shows the active one) and the rules per
  // discipline as edited in the walk.
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [session, setSession] = useState<Record<string, RulesDict>>({});
  const [ids, setIds] = useState<IdsSpec[] | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const loaded = upload !== null && inv !== null;
  const fag = upload?.detected_discipline ?? fileFag;
  const savedRules = rulesFor(saved, fag);
  const preview = usePreview(loaded ? upload.upload_id : null, rules);

  // A model the server no longer holds: said in the bar, not a silent wait.
  useEffect(() => onModelGone((msg) => onError(msg)), [onError]);

  // The walk's rules are its discipline's rules in the session.
  useEffect(() => {
    if (!rules || !activeKey) return;
    setSession((x) => (x[fag ?? ANY_FAG] === rules ? x : { ...x, [fag ?? ANY_FAG]: rules }));
  }, [rules, fag, activeKey]);

  /** The rules a model is read with: its discipline's in the session, else
   *  the opened ruleset's, else the base's defaults. */
  const defaultsFor = (f: string | null): RulesDict =>
    base === "custom" ? { ...statsbyggRules(f), floor_style: "" } : statsbyggRules(f);
  const rulesOf = (m: ModelEntry): RulesDict =>
    session[m.fag ?? ANY_FAG] ?? (opened ? rulesFor(saved, m.fag) : null) ?? defaultsFor(m.fag);

  // What later steps read, fetched in the background whenever the rules
  // change, so a step opens on current data: Scope's unscoped preview and
  // Status's values (the walk's own preview above serves the rest).
  const prefetchKey = loaded && rules ? JSON.stringify(rules) : "";
  useEffect(() => {
    if (!prefetchKey || !upload) return;
    const r = JSON.parse(prefetchKey) as RulesDict;
    const uid = upload.upload_id;
    const t = window.setTimeout(() => {
      void getPreview(uid, { ...r, scope_components: [], scope_types: [] }).catch(() => undefined);
      if (r.status_location) void getValues(uid, r.status_location).catch(() => undefined);
      // Status pre-picks the model's suggestion when the standard is missing.
      const cand = inv?.roles.status.candidates[0]?.location;
      if (cand) void getValues(uid, cand).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchKey]);

  // Later data in the background once a model is in: the rollup over the
  // loaded models for Oppsummering.
  const loadedItems = models
    .filter((m) => m.upload)
    .map((m) => ({ upload_id: m.upload?.upload_id ?? "", rules: m.key === activeKey && rules ? rules : rulesOf(m) }));
  const itemsKey = JSON.stringify(loadedItems);
  useEffect(() => {
    if (loadedItems.length === 0) return;
    const t = window.setTimeout(() => void getRollup(JSON.parse(itemsKey)).catch(() => undefined), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  /** Floors for a model's storeys in the rules' style, unless set already. */
  const withFloors = (r: RulesDict, inventory: Inventory): RulesDict => {
    const style = r.floor_style === "u" ? "u" : r.floor_style === "statsbygg" ? "statsbygg" : null;
    if (!style || Object.keys(r.storey_codes ?? {}).length > 0) return r;
    const codes = proposeCodes(inventory.storeys, style);
    return { ...r, storey_codes: codes, floor_codes: allowedFloors(codes) };
  };

  /** Make a loaded model the walk's. */
  const activate = (m: ModelEntry) => {
    if (!m.upload || !m.inv) return;
    setActiveKey(m.key);
    setUpload(m.upload);
    setInv(m.inv);
    setFileName(m.fileName);
    setFileFag(m.fag);
    setRules(withFloors(rulesOf(m), m.inv));
    setVisit((v) => v + 1);
  };

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
    // Statsbygg is a preset: every step is pre-filled and stays open to edit.
    go(loaded ? "kilde" : "ifc");
  };

  const openSetup = (f: File) => {
    const read: Promise<SetupFile> = /\.ids$/i.test(f.name)
      ? importIds(f).then((r) => {
          setIds(r.specs);
          return parseSetup(JSON.stringify(r.setup));
        })
      : f.text().then((text) => {
          setIds(null);
          return parseSetup(text);
        });
    read
      .then((s) => begin(s.base, rulesFor(s, fag) ?? statsbyggRules(fag), s))
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };

  // ---- Åpne IFC ----
  // A picked file holds the walk on the loader in the drop frame (gzip,
  // upload, read, index, with the counter) until the model's inventory is
  // in, then opens Kilde with its data. The file's name and header
  // (discipline, schema) show in the rail meanwhile.
  const readIfc = async (files: File[]) => {
    if (!rules || reading) return;
    const ok = files.filter((f) => isModelFile(f.name));
    if (ok.length === 0) {
      onError("Filen må være en .ifc- eller .ifczip-fil.");
      return;
    }
    onError(null);
    const entries: ModelEntry[] = ok.map((f, k) => ({
      key: `${Date.now()}-${k}-${f.name}`,
      fileName: f.name,
      fag: fagFromName(f.name),
      upload: null,
      inv: null,
      progress: null,
      error: null,
    }));
    setModels((ms) => [...ms, ...entries]);
    const patch = (key: string, p: Partial<ModelEntry>) =>
      setModels((ms) => ms.map((m) => (m.key === key ? { ...m, ...p } : m)));

    // The first model of the session holds the loader, then opens the walk
    // (Oppsummering when an opened ruleset covers its discipline: nothing
    // to pick). The others read in the background, one at a time.
    const first = activeKey === null && !loaded ? entries[0] : null;
    const read = async (e: ModelEntry, f: File) => {
      try {
        const up = await readModel(f, (p) => {
          patch(e.key, { progress: p });
          if (e === first) setReadProgress(p);
        });
        const inventory = up.inventory ?? (await getInventory(up.upload_id));
        const done: ModelEntry = { ...e, fag: up.detected_discipline ?? e.fag, upload: up, inv: inventory, progress: null };
        patch(e.key, done);
        if (e === first) {
          activate(done);
          const covered = opened && rulesFor(saved, done.fag) !== null;
          go(covered ? "end" : "kilde");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        patch(e.key, { error: msg, progress: null });
        if (e === first) {
          onError(msg);
          setFileName(null);
        }
      }
    };

    if (first) {
      setFileName(first.fileName);
      setFileFag(first.fag);
      setFileSchema(null);
      void schemaFromHeader(ok[0]).then(setFileSchema);
      setReading(true);
      setReadProgress({ stage: "pakk", pct: 0 });
      // Held on the loader in the drop frame until the inventory is in.
      try {
        await read(first, ok[0]);
      } finally {
        setReading(false);
        setReadProgress(null);
      }
    }
    for (let k = first ? 1 : 0; k < ok.length; k++) {
      const e = entries[k];
      const f = ok[k];
      queue.current = queue.current.then(() => read(e, f));
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
            const fs = Array.from(e.dataTransfer.files ?? []);
            if (fs.length) void readIfc(fs);
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
      enabled: base !== null && !reading,
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
        progress={readProgress}
        fileName={loaded ? upload.file_name : fileName}
        loaded={loaded ? { products: inv.products } : null}
        onFile={(fs) => void readIfc(fs)}
        onUse={() => go(detour ? "end" : "kilde")}
      />
    );
  } else if (rules && !loaded) {
    // The model is on its way: the steps that need none work, the others
    // wait for its data.
    if (step === "format") {
      body = (
        <FormatStep
          uploadId={null}
          rules={rules}
          presets={presets}
          pickBest={false}
          onUse={(patch) => commit("format", patch)}
        />
      );
    } else if (step === "etasjer") {
      body = <EtasjerStep uploadId={null} inv={null} rules={rules} autoScheme={false} onUse={(patch) => commit("etasjer", { floor_style: patch.floor_style })} />;
    } else if (step === "scope") {
      body = <ScopeStep uploadId={null} rules={rules} onUse={(patch) => commit("scope", patch)} />;
    } else if (step === "kilde") {
      body = <Pending standard={STANDARD_LOCATION} picked={sourceText(rules)} />;
    } else if (step === "status") {
      body = <Pending standard={STATUS_STANDARD} picked={rules.status_location ? locationText(rules.status_location) : ""} />;
    } else if (step === "end") {
      body = (
        <SummaryStep
          inv={null}
          upload={null}
          fileName={fileName ?? "–"}
          rules={rules}
          preview={null}
          checking={false}
          registering={false}
          onSave={() => {
            const file = withFag(saved, base ?? "custom", fag, rules);
            setSaved(file);
            storeSetup(file);
            onStored(file);
            download(setupFileName(rules, null), setupJson(file));
          }}
          onRegister={() => undefined}
          onRow={(s) => {
            setDetour(true);
            go(s);
          }}
          onReview={() => {
            setDetour(false);
            go("kilde");
          }}
          onAccept={() => undefined}
          onProjectName={(name) => setRules((r) => (r ? { ...r, project_name: name } : r))}
          models={models}
          rulesOf={rulesOf}
          activeKey={activeKey}
          onModel={() => undefined}
          ids={ids}
        />
      );
    }
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
      body = <ScopeStep uploadId={uid} inv={inv} rules={rules} onUse={(patch) => commit("scope", patch)} />;
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
          fileName={upload.file_name}
          rules={rules}
          preview={preview}
          checking={checking}
          registering={registering}
          onSave={() => {
            let file = withFag(opened ? saved : null, base ?? "custom", fag, rules);
            for (const [k, r] of Object.entries(session)) if (k !== (fag ?? ANY_FAG)) file = withFag(file, base ?? "custom", k, r);
            setSaved(file);
            storeSetup(file);
            onStored(file);
            download(setupFileName(rules, upload), setupJson(file));
          }}
          onRegister={() => {
            onError(null);
            setRegistering(true);
            downloadRegister(
              loadedItems,
              loadedItems.length > 1 ? (upload.file_name.split("_")[0] ?? "modeller") : upload.file_name.replace(/\.ifc(zip)?$/i, ""),
            )
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
          models={models}
          rulesOf={rulesOf}
          activeKey={activeKey}
          onModel={(key) => {
            const m = models.find((x) => x.key === key);
            if (m) activate(m);
          }}
          ids={ids}
        />
      );
    }
  }

  return (
    <div id="oppsett" {...dropProps}>
      <div className="flow">
        <div className="railcol">
          <Rail
            file={
              fileName !== null
                ? {
                    name: loaded ? upload.file_name : fileName,
                    schema: [fag, loaded ? upload.facts.schema : fileSchema, reading ? progressText(readProgress).figure : null]
                      .filter(Boolean)
                      .join(" · "),
                  }
                : null
            }
            items={items}
          />
          <div ref={setSlot} style={{ display: "contents" }} />
        </div>
        <RailSlot.Provider value={slot}>
          <Bar.Provider value={bar}>
            <Live.Provider value={setLive}>
              <StepFrame key={`${step}-${visit}-${activeKey ?? ""}${MODEL_STEPS.has(step) ? `-${loaded}` : ""}`} step={step}>
                {body}
              </StepFrame>
            </Live.Provider>
          </Bar.Provider>
        </RailSlot.Provider>
      </div>
    </div>
  );
}

/** Steps built from the model's data: they open again when it arrives. */
const MODEL_STEPS: ReadonlySet<Step> = new Set<Step>(["kilde", "etasjer", "scope", "status", "end"]);

/** Keys the step's state to the visit, so a step opens fresh each time. */
function StepFrame({ children, step }: { children: React.ReactNode; step: Step }) {
  return (
    <section aria-label={STEP_NAME[step]} style={{ display: "contents" }}>
      {children}
    </section>
  );
}
