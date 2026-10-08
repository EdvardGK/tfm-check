import { useEffect, useMemo, useState } from "react";
import { getScopeValues, peek, peekLatest } from "../api";
import type { Inventory, Location, RulesDict, ScopeRule, ScopeSource } from "../types";
import { Canvas, Fig, Meter, StepBar } from "./Shell";
import SourceName from "./SourceName";
import { useDraft, useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import { fmt, locationText } from "./setup";

export interface ScopePatch {
  scope_include: ScopeRule[];
  scope_exclude: ScopeRule[];
  scope_components: string[];
  scope_types: string[];
}

/** The sources a rule reads: plain name, and the technical key under it. */
const SOURCES: { kind: ScopeSource["kind"]; label: string; tech: string }[] = [
  { kind: "all", label: "Alle", tech: "" },
  { kind: "class", label: "IFC-klasse", tech: "IfcClass" },
  { kind: "type", label: "Type", tech: "IfcTypeObject.Name" },
  { kind: "systemkode", label: "Systemkode", tech: "RefPriSysClass" },
  { kind: "komponentkode", label: "Komponentkode", tech: "RefCompClass" },
  { kind: "mmi", label: "MMI", tech: "" },
  { kind: "prop", label: "Egenskap", tech: "" },
];
const OPS: { op: ScopeRule["op"]; label: string }[] = [
  { op: "er", label: "er" },
  { op: "starter", label: "starter med" },
  { op: "regex", label: "regex" },
];

/** The older fields as exclude rules. */
function initialRules(r: RulesDict): { include: ScopeRule[]; exclude: ScopeRule[] } {
  const exclude = [...(r.scope_exclude ?? [])];
  if (r.scope_components?.length) exclude.push({ source: { kind: "komponentkode" }, op: "er", values: [...r.scope_components] });
  if (r.scope_types?.length) exclude.push({ source: { kind: "type" }, op: "er", values: [...r.scope_types] });
  return { include: [...(r.scope_include ?? [])], exclude };
}

/** The model's values of a source, with counts (cached; the previous ones
 *  meanwhile). */
function useScopeValues(uploadId: string | null, rules: RulesDict, source: ScopeSource): { v: string; n: number }[] {
  const key = JSON.stringify({ rules, source });
  const [vals, setVals] = useState<{ v: string; n: number }[]>(
    () => (uploadId ? (peek<{ values: { v: string; n: number }[] }>("values", uploadId, { rules, source })?.values ?? []) : []),
  );
  useEffect(() => {
    if (!uploadId || source.kind === "all") return;
    const { rules: r, source: s } = JSON.parse(key) as { rules: RulesDict; source: ScopeSource };
    let live = true;
    getScopeValues(uploadId, r, s)
      .then((x) => {
        if (live) setVals(x.values);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uploadId, key, source.kind]);
  return vals;
}

function RuleRow({
  rule,
  uploadId,
  rules,
  inv,
  onChange,
  onRemove,
}: {
  rule: ScopeRule;
  uploadId: string | null;
  rules: RulesDict;
  inv?: Inventory | null;
  onChange: (r: ScopeRule) => void;
  onRemove: () => void;
}) {
  const values = useScopeValues(uploadId, rules, rule.source);
  const [q, setQ] = useState("");
  const [text, setText] = useState(rule.op === "er" ? "" : rule.values.join(", "));
  const [prop, setProp] = useState(rule.source.kind === "prop" && rule.source.loc ? locationText(rule.source.loc) : "");
  const src = SOURCES.find((s) => s.kind === rule.source.kind) ?? SOURCES[0];
  const props = useMemo(
    () => (inv?.sets ?? []).flatMap((s) => s.props.map((p) => `${s.name}.${p.name}`)),
    [inv],
  );
  const tech =
    rule.source.kind === "mmi"
      ? rules.status_location
        ? locationText(rules.status_location)
        : ""
      : rule.source.kind === "prop"
        ? ""
        : src.tech;
  const ql = q.trim().toLowerCase();
  const shown = (ql ? values.filter((x) => x.v.toLowerCase().includes(ql)) : values).slice(0, 60);
  const toggle = (v: string) =>
    onChange({ ...rule, values: rule.values.includes(v) ? rule.values.filter((x) => x !== v) : [...rule.values, v] });

  return (
    <div className="srule rule">
      <span className="srhead">
        <span className="srsrc">
          <select
            className="field"
            aria-label="Egenskap"
            value={rule.source.kind}
            onChange={(e) => {
              const kind = e.target.value as ScopeSource["kind"];
              onChange({ source: { kind }, op: rule.op, values: [] });
            }}
          >
            {SOURCES.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.label}
              </option>
            ))}
          </select>
          {tech ? <span className="tech">{tech}</span> : null}
        </span>
        {rule.source.kind !== "all" ? (
          <select className="field" aria-label="Operator" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as ScopeRule["op"], values: [] })}>
            {OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="mini" aria-label="Fjern" title="Fjern" onClick={onRemove}>
          ✕
        </button>
      </span>
      {rule.source.kind === "prop" ? (
        <span className="srprop">
          <input
            className="field mono"
            list="scope-props"
            aria-label="Egenskap"
            value={prop}
            onChange={(e) => {
              setProp(e.target.value);
              const t = e.target.value;
              const dot = t.lastIndexOf(".");
              if (dot > 0 && dot < t.length - 1) {
                const loc: Location = ["pset", t.slice(0, dot), t.slice(dot + 1)];
                onChange({ source: { kind: "prop", loc }, op: rule.op, values: [] });
              }
            }}
          />
          <datalist id="scope-props">
            {props.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          {rule.source.loc ? <SourceName loc={rule.source.loc} /> : null}
        </span>
      ) : null}
      {rule.source.kind !== "all" && rule.op === "er" ? (
        <>
          {values.length > 12 ? (
            <input className="search" type="search" placeholder="Søk" aria-label="Søk" value={q} onChange={(e) => setQ(e.target.value)} />
          ) : null}
          <div className="pills">
            {shown.map((x) => (
              <button key={x.v} type="button" className="pill" aria-pressed={rule.values.includes(x.v)} onClick={() => toggle(x.v)}>
                {x.v}
                <span className="c">{fmt(x.n)}</span>
              </button>
            ))}
            {rule.values
              .filter((v) => !values.some((x) => x.v === v))
              .map((v) => (
                <button key={v} type="button" className="pill" aria-pressed onClick={() => toggle(v)}>
                  {v}
                </button>
              ))}
          </div>
        </>
      ) : null}
      {rule.source.kind !== "all" && rule.op !== "er" ? (
        <input
          className="field mono"
          aria-label="Verdier"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange({ ...rule, values: e.target.value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean) });
          }}
        />
      ) : null}
    </div>
  );
}

/** Scope: which objects the checks take. Two lists of rules: «Ta med» (any
 *  matches: in; none listed: all) and «Utelat» (any matches: out). Each rule
 *  reads a property (IFC class, type, Systemkode, Komponentkode, MMI or any
 *  property) and compares it (er / starter med / regex) with values offered
 *  from the model with counts. The count in scope follows live. */
export default function ScopeStep({
  uploadId,
  inv,
  rules,
  onUse,
}: {
  uploadId: string | null;
  inv?: Inventory | null;
  rules: RulesDict;
  onUse: (patch: ScopePatch) => void;
}) {
  const init = useMemo(() => initialRules(rules), [rules]);
  const [include, setInclude] = useState<ScopeRule[]>(init.include);
  const [exclude, setExclude] = useState<ScopeRule[]>(init.exclude);
  const complete = (l: ScopeRule[]) => l.filter((r) => r.source.kind === "all" || r.values.length > 0);
  const previewRules = useMemo(
    () => ({ ...rules, scope_include: complete(include), scope_exclude: complete(exclude), scope_components: [], scope_types: [] }),
    [rules, include, exclude],
  );
  const preview = usePreview(uploadId, previewRules) ?? (uploadId ? peekLatest("preview", uploadId) : null);

  useDraft({ scope_include: complete(include), scope_exclude: complete(exclude), scope_components: [], scope_types: [] });
  const n = include.length + exclude.length;
  useLiveAnswer("scope", n ? `${include.length} / ${exclude.length}` : "", n === 0);

  const list = (title: string, rs: ScopeRule[], set: (f: (l: ScopeRule[]) => ScopeRule[]) => void, fresh: ScopeRule) => (
    <section className={"tile card vals scopelist " + (title === "Ta med" ? "major" : "minor")} aria-label={title}>
      <div className="lh">
        <span className="lbl">{title}</span>
        <button type="button" className="mini" onClick={() => set((l) => [...l, fresh])}>
          + Regel
        </button>
      </div>
      <div className="scroll">
        {rs.map((r, i) => (
          <RuleRow
            key={i}
            rule={r}
            uploadId={uploadId}
            rules={rules}
            inv={inv}
            onChange={(nr) => set((l) => l.map((x, k) => (k === i ? nr : x)))}
            onRemove={() => set((l) => l.filter((_, k) => k !== i))}
          />
        ))}
      </div>
    </section>
  );

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button
          type="button"
          className="primary"
          onClick={() =>
            onUse({ scope_include: complete(include), scope_exclude: complete(exclude), scope_components: [], scope_types: [] })
          }
        >
          Bruk
        </button>
      </StepBar>

      <section className="tile card full ev" aria-label="I scope">
        <div className="figs">
          <div>
            <span className="lbl">I scope</span>
            <Fig n={preview ? preview.in_scope : null} total={preview ? preview.products : null} />
            <Meter n={preview?.in_scope ?? 0} total={preview?.products ?? 0} />
          </div>
          <div>
            <span className="lbl">Utenfor scope</span>
            <Fig n={preview ? preview.excluded : null} total={preview ? preview.products : null} />
            <Meter n={preview?.excluded ?? 0} total={preview?.products ?? 0} />
          </div>
        </div>
      </section>

      {list("Ta med", include, setInclude, { source: { kind: "class" }, op: "er", values: [] })}
      {list("Utelat", exclude, setExclude, { source: { kind: "komponentkode" }, op: "er", values: [] })}
    </Canvas>
  );
}
