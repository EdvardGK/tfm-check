import { useMemo, useState } from "react";
import type { RulesDict } from "../types";
import { Bar10, Canvas, Fig, Meter, StepBar } from "./Shell";
import { useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import { fmt } from "./setup";

export interface ScopePatch {
  scope_components: string[];
  scope_types: string[];
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Scope: the component codes and types left out of every check. Band 1:
 *  the model's component codes as pills (a press takes one out) | how many
 *  elements leave. Band 2: the model's types | what is out, with counts. */
export default function ScopeStep({
  uploadId,
  rules,
  onUse,
}: {
  uploadId: string | null;
  rules: RulesDict;
  onUse: (patch: ScopePatch) => void;
}) {
  const [comps, setComps] = useState<string[]>(() => [...(rules.scope_components ?? [])]);
  const [types, setTypes] = useState<string[]>(() => [...(rules.scope_types ?? [])]);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const previewRules = useMemo(() => ({ ...rules, scope_components: comps, scope_types: types }), [rules, comps, types]);
  const preview = usePreview(uploadId, previewRules);
  // The codes and types as the model has them, before anything is taken out.
  const all = usePreview(uploadId, useMemo(() => ({ ...rules, scope_components: [], scope_types: [] }), [rules]));

  const out = [...comps, ...types];
  useLiveAnswer("scope", out.join(", "), out.length === 0);

  const seenComps = all?.components ?? [];
  const extraComps = comps.filter((c) => !seenComps.some((s) => s.code === c));
  const compN = new Map(seenComps.map((c) => [c.code, c.n]));
  const allTypes = all?.types ?? [];
  const typeN = new Map(allTypes.map((t) => [t.name, t.n]));
  const ql = q.trim().toLowerCase();
  const shownTypes = ql === "" ? allTypes : allTypes.filter((t) => t.name.toLowerCase().includes(ql));
  const maxType = Math.max(1, ...allTypes.map((t) => t.n));

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" onClick={() => onUse({ scope_components: comps, scope_types: types })}>
          Bruk
        </button>
      </StepBar>

      <section className="tile card major" aria-label="Komponentkode">
        <span className="lbl">Komponentkode</span>
        <div className="pills">
          {seenComps.map((c) => (
            <button key={c.code} type="button" className="pill" aria-pressed={comps.includes(c.code)} onClick={() => setComps((l) => toggle(l, c.code))}>
              {c.code}
              <span className="c">{fmt(c.n)}</span>
            </button>
          ))}
          {extraComps.map((c) => (
            <button key={c} type="button" className="pill" aria-pressed onClick={() => setComps((l) => toggle(l, c))}>
              {c}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = typed.trim().toUpperCase();
              if (v && !comps.includes(v)) setComps((l) => [...l, v]);
              setTyped("");
            }}
          >
            <input className="field mono" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Komponentkode" size={5} maxLength={4} style={{ height: 30, textTransform: "uppercase" }} />
          </form>
        </div>
      </section>

      <section className="tile card minor ev" aria-label="Utenfor scope">
        <div className="figs fill">
          <div>
            <span className="lbl">Utenfor scope</span>
            <Fig n={preview ? preview.excluded : null} total={preview ? preview.products : null} />
            <Meter n={preview?.excluded ?? 0} total={preview?.products ?? 0} />
          </div>
          <div>
            <span className="lbl">I scope</span>
            <Fig n={preview ? preview.in_scope : null} total={preview ? preview.products : null} />
            <Meter n={preview?.in_scope ?? 0} total={preview?.products ?? 0} />
          </div>
        </div>
      </section>

      <section className="tile card major tree" aria-label="Type">
        <div className="top">
          <span className="lbl">Type</span>
          <input className="search" type="search" placeholder="Søk" aria-label="Søk" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="scroll">
          {shownTypes.map((t) => (
            <button key={t.name} type="button" className="typerow pick rule" aria-pressed={types.includes(t.name)} onClick={() => setTypes((l) => toggle(l, t.name))}>
              <span className="tnm ell" title={t.name}>
                {t.name}
              </span>
              <span className="num">{fmt(t.n)}</span>
              <Bar10 n={t.n} max={maxType} />
            </button>
          ))}
        </div>
      </section>

      <section className="tile card minor vals" aria-label="Valgt">
        <div className="lh">
          <span className="lbl">Valgt</span>
          <span className="lbl num">{out.length}</span>
        </div>
        <div className="scroll">
          {comps.map((c) => (
            <button key={`c:${c}`} type="button" className="lrow outrow rule pick" onClick={() => setComps((l) => toggle(l, c))}>
              <span className="mono ell">{c}</span>
              <span className="num sub">{compN.has(c) ? fmt(compN.get(c) ?? 0) : "–"}</span>
              <span aria-hidden="true">✕</span>
            </button>
          ))}
          {types.map((t) => (
            <button key={`t:${t}`} type="button" className="lrow outrow rule pick" onClick={() => setTypes((l) => toggle(l, t))}>
              <span className="ell" title={t}>
                {t}
              </span>
              <span className="num sub">{typeN.has(t) ? fmt(typeN.get(t) ?? 0) : "–"}</span>
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      </section>
    </Canvas>
  );
}
