import { useState } from "react";
import type { RulesDict } from "../types";
import { usePreview } from "./usePreview";
import { fmt } from "./setup";
import { Figure, INPUT, LABEL, PANEL, PILL, STEP_TITLE, StepConfirm } from "./ui";

export interface ScopePatch {
  scope_components: string[];
  scope_types: string[];
}

/** Scope: the component codes and types left out of every check. Both
 *  lists are the loaded model's, with the elements each carries; a code
 *  the model does not show can be typed. A click takes one out (or back). */
export default function ScopeStep({
  uploadId,
  rules,
  onUse,
}: {
  uploadId: string;
  rules: RulesDict;
  onUse: (patch: ScopePatch) => void;
}) {
  const [comps, setComps] = useState<string[]>(() => [...(rules.scope_components ?? [])]);
  const [types, setTypes] = useState<string[]>(() => [...(rules.scope_types ?? [])]);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const preview = usePreview(uploadId, { ...rules, scope_components: comps, scope_types: types });

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const seenComps = preview?.components ?? [];
  const extraComps = comps.filter((c) => !seenComps.some((s) => s.code === c));
  const ql = q.trim().toLowerCase();
  const allTypes = preview?.types ?? [];
  const shownTypes = allTypes
    .filter((t) => ql === "" || t.name.toLowerCase().includes(ql) || types.includes(t.name))
    .sort((a, b) => Number(types.includes(b.name)) - Number(types.includes(a.name)));

  return (
    <>
      <h1 className={STEP_TITLE}>Scope</h1>
      <div className="flex flex-wrap gap-6">
        <Figure
          label="Utenfor scope"
          value={preview ? `${fmt(preview.excluded)} / ${fmt(preview.products)}` : "–"}
        />
      </div>

      <section className={"flex flex-col gap-3 " + PANEL}>
        <span className={LABEL}>Komponentkode</span>
        <div className="flex flex-wrap gap-1.5">
          {seenComps.map((c) => (
            <button
              key={c.code}
              type="button"
              aria-pressed={comps.includes(c.code)}
              onClick={() => setComps((l) => toggle(l, c.code))}
              className={PILL + " flex items-baseline gap-2"}
            >
              <span className={comps.includes(c.code) ? "line-through" : ""}>{c.code}</span>
              <span className="text-[11px] tabular-nums opacity-70">{fmt(c.n)}</span>
            </button>
          ))}
          {extraComps.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed
              onClick={() => setComps((l) => toggle(l, c))}
              className={PILL}
            >
              <span className="line-through">{c}</span>
            </button>
          ))}
          <form
            className="flex"
            onSubmit={(e) => {
              e.preventDefault();
              const v = typed.trim().toUpperCase();
              if (v && !comps.includes(v)) setComps((l) => [...l, v]);
              setTyped("");
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Komponentkode"
              className={INPUT + " w-20 uppercase"}
              maxLength={4}
            />
          </form>
        </div>
      </section>

      <section className={"flex flex-col gap-3 " + PANEL}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={LABEL}>Type</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter"
            aria-label="Filter"
            className={INPUT + " w-full max-w-sm"}
          />
        </div>
        <ul className="m-0 grid max-h-96 list-none grid-cols-1 gap-x-4 overflow-auto p-0 md:grid-cols-2">
          {shownTypes.map((t) => {
            const out = types.includes(t.name);
            return (
              <li key={t.name}>
                <button
                  type="button"
                  aria-pressed={out}
                  onClick={() => setTypes((l) => toggle(l, t.name))}
                  className={
                    "flex w-full items-baseline gap-3 border-b border-line px-2 py-1.5 text-left " +
                    (out ? "bg-ink text-cream" : "text-ink hover:bg-input")
                  }
                >
                  <span className={"min-w-0 flex-1 truncate text-[13px] " + (out ? "line-through" : "")} title={t.name}>
                    {t.name}
                  </span>
                  <span className={"shrink-0 font-mono text-[12px] tabular-nums " + (out ? "text-cream" : "text-muted")}>
                    {fmt(t.n)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <StepConfirm onClick={() => onUse({ scope_components: comps, scope_types: types })} />
    </>
  );
}
