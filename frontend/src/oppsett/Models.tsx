/** The models of a session: each read with its discipline's rules, listed
 *  in Oppsummering's rail with its result; one is the walk's (active). */

import type { IdsSpec, ReadProgress } from "../api";
import type { Inventory, RulesDict, UploadResponse } from "../types";
import { progressText } from "./Loader";
import { Lamp, RailSection } from "./Shell";
import { usePreview } from "./usePreview";
import { fmt, verdictOf } from "./setup";

export interface ModelEntry {
  key: string;
  fileName: string;
  fag: string | null;
  upload: UploadResponse | null;
  inv: Inventory | null;
  progress: ReadProgress | null;
  error: string | null;
}

function ModelRow({
  m,
  rules,
  active,
  onPick,
}: {
  m: ModelEntry;
  rules: RulesDict;
  active: boolean;
  onPick: () => void;
}) {
  const p = usePreview(m.upload?.upload_id ?? null, rules);
  const figure = m.error
    ? "✕"
    : !m.upload
      ? progressText(m.progress).figure
      : p
        ? `${fmt(p.matched)} / ${fmt(p.valued)}`
        : "…";
  return (
    <button type="button" className="rtile mrow" aria-pressed={active} disabled={!m.upload} onClick={onPick} title={m.error ?? m.fileName}>
      <span className="t ell">{m.fileName}</span>
      <span className="mr">
        <span className="x">{m.fag ?? "–"}</span>
        {p && m.upload ? <Lamp verdict={verdictOf(p.matched, p.valued)} /> : null}
        <span className="x num">{figure}</span>
      </span>
    </button>
  );
}

/** «Modeller»: every model with its discipline and how many of its codes
 *  take the form; a click makes it the walk's model. */
export function ModelsSection({
  models,
  rulesOf,
  activeKey,
  onPick,
}: {
  models: ModelEntry[];
  rulesOf: (m: ModelEntry) => RulesDict;
  activeKey: string | null;
  onPick: (key: string) => void;
}) {
  if (models.length === 0) return null;
  return (
    <RailSection label="Modeller">
      {models.map((m) => (
        <ModelRow key={m.key} m={m} rules={rulesOf(m)} active={m.key === activeKey} onPick={() => onPick(m.key)} />
      ))}
    </RailSection>
  );
}

const ROLE: Record<string, string> = {
  whole: "Hel kode", lokasjon: "Lokasjonskode", system: "System", komponent: "Komponentkode", status: "Status",
};

/** «IDS»: what each specification of an imported IDS became, or why not. */
export function IdsSection({ specs }: { specs: IdsSpec[] | null }) {
  if (!specs || specs.length === 0) return null;
  const mapped = specs.filter((s) => s.mapped).length;
  return (
    <RailSection label={`IDS · ${fmt(mapped)} / ${fmt(specs.length)}`}>
      <div className="idslist">
        {specs.map((s, i) => (
          <div key={i} className="idsrow rule" title={[s.source, s.rule, s.detail].filter(Boolean).join(" · ")}>
            <Lamp verdict={s.mapped ? "ok" : "na"} />
            <span className="ell">{s.mapped ? `${ROLE[s.role ?? ""] ?? s.role}: ${s.source}` : s.name}</span>
          </div>
        ))}
      </div>
    </RailSection>
  );
}
