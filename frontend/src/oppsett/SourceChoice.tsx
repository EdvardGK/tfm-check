import { useState } from "react";
import type { Location } from "../types";
import { sameLocation } from "./setup";
import SourceName from "./SourceName";

/** How a mapping step's source is chosen: the standard, or another one,
 *  picked in the model's tree or entered there by name. */
export type SourceMode = "standard" | "other";

export const modeOf = (loc: Location | null | undefined, std: Location): SourceMode =>
  loc && sameLocation(loc, std) ? "standard" : "other";

/** The step's question and its two answers: the standard (with whether the
 *  model has it) or another source (what it points at now). */
export function ChoiceCard({
  question,
  std,
  stdFound,
  other,
  mode,
  onMode,
}: {
  question?: string;
  std: Location;
  stdFound: boolean;
  /** The other source chosen, if any. */
  other: Location | null;
  mode: SourceMode;
  onMode: (m: SourceMode) => void;
}) {
  return (
    <section className="tile card full qcard" aria-label={question ?? "Kilde"}>
      {question ? <h2>{question}</h2> : null}
      <div className="opts" role="radiogroup">
        <button type="button" className="opt" role="radio" aria-checked={mode === "standard"} onClick={() => onMode("standard")}>
          <span className="t">Bruk standard</span>
          <span className="x">
            <SourceName loc={std} />
          </span>
          <span className="badge" data-verdict={stdFound ? "pass" : "fail"}>
            {stdFound ? "✓ I modellen" : "✕ Ikke i modellen"}
          </span>
        </button>
        <button type="button" className="opt" role="radio" aria-checked={mode === "other"} onClick={() => onMode("other")}>
          <span className="t">Velg annen</span>
          <span className="x">
            <SourceName loc={other} />
          </span>
        </button>
      </div>
    </section>
  );
}

/** «Angi egen», inside the model tree: a property set and property by
 *  name, for what the model does not have. A model without it fails the
 *  check there. */
export function CustomEntry({ value, onChange }: { value: Location | null; onChange: (loc: Location) => void }) {
  const [pset, setPset] = useState(value?.[0] === "pset" ? (value[1] ?? "") : "");
  const [prop, setProp] = useState(value?.[0] === "pset" ? (value[2] ?? "") : "");
  const set = (s: string, p: string) => {
    setPset(s);
    setProp(p);
    if (s.trim() && p.trim()) onChange(["pset", s.trim(), p.trim()]);
  };
  return (
    <div className="centry">
      <label className="cfield">
        <span className="lbl">Egenskapssett</span>
        <input className="search mono" value={pset} onChange={(e) => set(e.target.value, prop)} autoFocus />
      </label>
      <label className="cfield">
        <span className="lbl">Egenskap</span>
        <input className="search mono" value={prop} onChange={(e) => set(pset, e.target.value)} />
      </label>
    </div>
  );
}
