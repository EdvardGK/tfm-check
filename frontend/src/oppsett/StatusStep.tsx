import { useEffect, useRef, useState } from "react";
import { getValues, peek, peekLatest } from "../api";
import type { Inventory, Location, Phase, RulesDict, SourceValues } from "../types";
import { Canvas, Fig, Meter, StepBar, Val } from "./Shell";
import SourceTree, { propOf, type Pin } from "./SourceTree";
import { ChoiceCard, modeOf, type SourceMode } from "./SourceChoice";
import SourceName from "./SourceName";
import { useDraft, useLiveAnswer } from "./live";
import { STATUS_STANDARD, fmt, locationText, sameLocation, sourceCount } from "./setup";

const PHASES: Exclude<Phase, "">[] = ["ny", "bevares", "ombruk", "rives"];

/** A source's values, following the pick: what is already fetched (or the
 *  previous values) at once, updated in place. */
function useValues(uploadId: string, loc: Location | null): SourceValues | null {
  const [vals, setVals] = useState<SourceValues | null>(
    () => (loc ? peek<SourceValues>("values", uploadId, loc) : null) ?? peekLatest<SourceValues>("values", uploadId),
  );
  const key = loc ? JSON.stringify(loc) : "";
  useEffect(() => {
    if (!key) return;
    const parsed = JSON.parse(key) as Location;
    const ready = peek<SourceValues>("values", uploadId, parsed);
    if (ready) {
      setVals(ready);
      return;
    }
    let live = true;
    getValues(uploadId, parsed)
      .then((v) => {
        if (live) setVals(v);
      })
      .catch(() => {
        /* the model left the cache: the bar says so */
      });
    return () => {
      live = false;
    };
  }, [uploadId, key]);
  return vals;
}

/** Status: where the element's MMI code lives, read as its phase (0–6xx
 *  ny, 7xx bevares, 8xx ombruk, 9xx rives). Same bands as Kilde: the
 *  standard | the pick with its phases; the tree | the values. */
export default function StatusStep({
  uploadId,
  inv,
  rules,
  saved,
  fresh,
  onUse,
}: {
  uploadId: string;
  inv: Inventory;
  rules: RulesDict;
  saved: RulesDict | null;
  fresh: boolean;
  onUse: (patch: Partial<RulesDict>) => void;
}) {
  const std = STATUS_STANDARD;
  const stdN = inv.roles.status.standard.n;
  const missing = stdN === 0;
  const cands = inv.roles.status.candidates.map((c) => c.location);
  const cur = rules.status_location ?? std;
  const [draft, setDraft] = useState<Location>(() =>
    fresh && missing && cands[0] && sameLocation(cur, std) ? cands[0] : cur,
  );
  const search = useRef<HTMLInputElement>(null);
  const isStd = sameLocation(draft, std);
  useLiveAnswer("status", locationText(draft), isStd);
  useDraft({ status_location: draft });

  const [mode, setMode] = useState<SourceMode>(() => modeOf(draft, std));
  const [lastOther, setLastOther] = useState<Location | null>(null);
  const other = !isStd ? draft : lastOther;
  const chooseMode = (m: SourceMode) => {
    setMode(m);
    if (m === "standard") setDraft(std);
    else {
      const back = other ?? cands[0] ?? null;
      if (back) setDraft(back);
    }
  };
  const pick = (loc: Location) => {
    setLastOther(loc);
    setDraft(loc);
  };

  const vals = useValues(uploadId, draft);
  const count = sourceCount(inv, draft);

  const pins: Pin[] = cands.map((loc) => ({ loc, tag: "Forslag" }));
  const s = saved?.status_location;
  if (s && !sameLocation(s, std) && !pins.some((p) => sameLocation(p.loc, s))) pins.push({ loc: s, tag: "Regelsett" });

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" onClick={() => onUse({ status_location: draft })}>
          Bruk
        </button>
      </StepBar>

      <ChoiceCard std={std} stdFound={!missing} other={other} mode={mode} onMode={chooseMode} />

      {mode === "other" ? (
        <SourceTree inv={inv} draft={draft} pins={pins} onPick={pick} searchRef={search} />
      ) : (
        <section className="tile card major std" aria-label="Standard">
          <span className="lbl">Standard</span>
          <div className="row1">
            <span className="src">
              <SourceName loc={std} />
            </span>
          </div>
          <Fig n={stdN} total={inv.products} verdict={missing ? "fail" : "ok"} />
          <Meter n={stdN} total={inv.products} verdict={missing ? undefined : "ok"} />
          <div className="vals3">
            {(propOf(inv, std)?.samples ?? []).map((v) => (
              <Val key={v.v} v={v.v} n={v.n} />
            ))}
          </div>
        </section>
      )}

      <section className="tile card minor ev vals" aria-label="Valgt">
        <span className="lbl">Valgt</span>
        <span className="src">
          <SourceName loc={draft} />
        </span>
        <div>
          <span className="lbl">Med verdi</span>
          <Fig n={count} total={inv.products} verdict={count === 0 ? "fail" : undefined} />
          <Meter n={count ?? 0} total={inv.products} />
        </div>
        <div className="phases">
          {PHASES.map((ph) => (
            <div key={ph}>
              <span>
                <span className="ph" data-ph={ph}>
                  {ph}
                </span>
              </span>
              <span className="num" style={{ textAlign: "left" }}>
                {vals ? fmt(vals.phases[ph] ?? 0) : "–"}
              </span>
            </div>
          ))}
        </div>
        <div className="lh">
          <span className="lbl">Verdier</span>
          <span className="lbl num">{vals ? `${fmt(vals.distinct)} ulike` : ""}</span>
        </div>
        <div className="scroll">
          {(vals?.values ?? []).map((v) => (
            <div key={v.v} className="lrow rule">
              <span>{v.phase ? <span className="ph" data-ph={v.phase} title={v.phase} style={{ display: "inline-block", width: 12, height: 12, padding: 0 }} /> : null}</span>
              <span className="mono ell" title={v.v}>
                {v.v}
              </span>
              <span className="num sub">{fmt(v.n)}</span>
            </div>
          ))}
        </div>
      </section>
    </Canvas>
  );
}
