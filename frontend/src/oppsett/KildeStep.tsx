import { useRef, useState } from "react";
import { ASPECTS, type Aspect, type Inventory, type Location, type RulesDict, type TfmMode } from "../types";
import { Canvas, Fig, Lamp, Meter, RailOptions, RailSection, RailTile, StepBar, Val, breakDots } from "./Shell";
import { MiniLoader } from "./Loader";
import { ChoiceCard, modeOf, type SourceMode } from "./SourceChoice";
import SourceTree, { propOf, type Pin } from "./SourceTree";
import { useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import {
  ASPECT_NAME, ASPECT_SIGN, PART_STANDARD, STANDARD_LOCATION, fmt, locationText, sameLocation, sourceCount, sourceText,
  verdictOf,
} from "./setup";

type Parts = Partial<Record<Aspect, Location>>;

const QUESTION = "Hvor skal TFM-koden være lagret i denne modellen?";

/** Kilde: where the TFM code lives, whole in one property or composed from
 *  the PA 0802 aspects (+lokasjon =system -komponent), each in its own
 *  property (the rail's «Hel kode» / «Fra deler»).
 *
 *  Band 1: the question and its three answers: the standard (with whether
 *  the model has it), a property picked from the model, or one entered by
 *  hand. Band 2: the answer's own work (the standard's values, the model
 *  tree, the entry) | what is picked, its evidence and its values. Never a
 *  silent fallback: the standard or a hand-entered property the model lacks
 *  stays as chosen, and the check fails there. */
export default function KildeStep({
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
  /** The saved ruleset for this discipline, pinned as «Regelsett». */
  saved: RulesDict | null;
  /** Not taken before: a missing standard pre-picks the suggestion. */
  fresh: boolean;
  onUse: (patch: Partial<RulesDict>) => void;
}) {
  const wholeStd = STANDARD_LOCATION;
  const wholeCand = inv.candidates.find((c) => !sameLocation(c.location, wholeStd))?.location ?? null;
  const partCand = (a: Aspect) => inv.roles[a].candidates[0]?.location ?? null;
  const partFound = (a: Aspect) => inv.roles[a].standard.n > 0;

  // ---- The pre-picked answer ----
  const [codeMode, setCodeMode] = useState<TfmMode>(() => {
    if (fresh && inv.standard.n === 0 && !wholeCand && ASPECTS.some((a) => partFound(a) || partCand(a))) return "parts";
    return rules.tfm_mode ?? "whole";
  });
  const cur = rules.tfm_location ?? wholeStd;
  const [draft, setDraft] = useState<Location>(() =>
    fresh && inv.standard.n === 0 && wholeCand && sameLocation(cur, wholeStd) ? wholeCand : cur,
  );
  const [parts, setParts] = useState<Parts>(() => {
    const out: Parts = {};
    for (const a of ASPECTS) {
      const have = rules.tfm_parts?.[a];
      const std = PART_STANDARD[a];
      if (fresh && !partFound(a) && partCand(a) && (!have || sameLocation(have, std))) out[a] = partCand(a) ?? undefined;
      else if (have) out[a] = have;
      else if (fresh) out[a] = std;
    }
    return out;
  });
  const [active, setActive] = useState<Aspect>("lokasjon");
  const composed = codeMode === "parts";

  // The source being answered: the whole code's, or the active aspect's.
  const std = composed ? PART_STANDARD[active] : wholeStd;
  const stdN = composed ? inv.roles[active].standard.n : inv.standard.n;
  const current: Location | null = composed ? (parts[active] ?? null) : draft;
  const setCurrent = (loc: Location) => {
    if (composed) setParts((p) => ({ ...p, [active]: loc }));
    else setDraft(loc);
  };

  // The answer chosen, per source; opens on what the source already is.
  const [modes, setModes] = useState<Record<string, SourceMode>>({});
  const modeKey = composed ? active : "whole";
  const mode = modes[modeKey] ?? modeOf(current, std);
  // What «Velg annen» last pointed at, per source.
  const [lastOther, setLastOther] = useState<Record<string, Location>>({});
  const other = current && modeOf(current, std) === "other" ? current : (lastOther[modeKey] ?? null);

  const chooseMode = (m: SourceMode) => {
    setModes((x) => ({ ...x, [modeKey]: m }));
    if (m === "standard") setCurrent(std);
    else {
      const back = other ?? (composed ? partCand(active) : wholeCand);
      if (back) setCurrent(back);
    }
  };
  const pick = (loc: Location) => {
    setLastOther((x) => ({ ...x, [modeKey]: loc }));
    setCurrent(loc);
  };

  const search = useRef<HTMLInputElement>(null);
  const draftRules: RulesDict = composed
    ? { ...rules, tfm_mode: "parts", tfm_parts: parts }
    : { ...rules, tfm_mode: "whole", tfm_location: draft };
  const isStd = composed ? ASPECTS.every((a) => sameLocation(parts[a], PART_STANDARD[a])) : sameLocation(draft, wholeStd);
  useLiveAnswer("kilde", sourceText(draftRules), isStd);

  const preview = usePreview(uploadId, draftRules);
  const valued = preview?.valued ?? 0;
  const shaped = preview?.shaped ?? 0;
  const countable = composed || draft[0] !== "all";
  const count = composed ? (preview ? valued : null) : sourceCount(inv, draft);

  const savedFor = (a: Aspect | null): Location | null =>
    !saved ? null : a === null ? (saved.tfm_mode !== "parts" ? (saved.tfm_location ?? null) : null) : (saved.tfm_parts?.[a] ?? null);
  const pins: Pin[] = [];
  const cands = composed ? inv.roles[active].candidates.map((c) => c.location) : wholeCand ? [wholeCand] : [];
  for (const c of cands) pins.push({ loc: c, tag: "Forslag" });
  const s = savedFor(composed ? active : null);
  if (s && !sameLocation(s, std) && !pins.some((p) => sameLocation(p.loc, s))) pins.push({ loc: s, tag: "Regelsett" });

  let work: React.ReactNode;
  if (mode === "other") {
    work = (
      <SourceTree
        key={`${modeKey}`}
        inv={inv}
        draft={current}
        pins={pins}
        onPick={pick}
        allowAll={!composed}
        searchRef={search}
      />
    );
  } else {
    work = (
      <section className="tile card major std" aria-label="Standard">
        <span className="lbl">Standard</span>
        <div className="row1">
          <span className="src">{locationText(std)}</span>
        </div>
        <Fig n={stdN} total={inv.products} verdict={stdN > 0 ? "ok" : "fail"} />
        <Meter n={stdN} total={inv.products} verdict={stdN > 0 ? "ok" : undefined} />
        <div className="vals3">
          {(propOf(inv, std)?.samples ?? []).map((v) => (
            <Val key={v.v} v={v.v} n={v.n} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button
          type="button"
          className="primary"
          disabled={composed && !ASPECTS.some((a) => parts[a])}
          onClick={() => onUse(composed ? { tfm_mode: "parts", tfm_parts: parts } : { tfm_mode: "whole", tfm_location: draft })}
        >
          Bruk
        </button>
      </StepBar>

      <RailOptions>
        <RailSection label="Kode">
          <RailTile title="Hel kode" example="+123456=360.001-JV401" pressed={!composed} onClick={() => setCodeMode("whole")} />
          <RailTile title="Fra deler" example="+ … = … - …" pressed={composed} onClick={() => setCodeMode("parts")} />
        </RailSection>
      </RailOptions>

      <ChoiceCard
        question={QUESTION}
        std={std}
        stdFound={stdN > 0}
        other={other}
        mode={mode}
        onMode={chooseMode}
      />

      {work}

      <section className="tile card minor ev vals" aria-label="Valgt">
        <span className="lbl">Valgt</span>
        {composed ? (
          <div className="slots">
            {ASPECTS.map((a) => {
              const loc = parts[a];
              const n = loc ? (sourceCount(inv, loc) ?? 0) : null;
              return (
                <div key={a} className={"slot pick rule" + (a === active ? " chosen" : "")}>
                  <button type="button" className="slotpick" aria-pressed={a === active} onClick={() => setActive(a)}>
                    <span className="sg">{ASPECT_SIGN[a]}</span>
                    <span className="sn">{ASPECT_NAME[a]}</span>
                    <span className="ss ell" title={loc ? locationText(loc) : ""}>
                      {loc ? (loc[2] ?? "") : "–"}
                    </span>
                    <span className="num">{n === null ? "" : fmt(n)}</span>
                  </button>
                  {loc ? (
                    <button
                      type="button"
                      className="mini"
                      aria-label="Fjern"
                      onClick={() =>
                        setParts((p) => {
                          const x = { ...p };
                          delete x[a];
                          return x;
                        })
                      }
                    >
                      ✕
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="src">{breakDots(locationText(draft))}</span>
        )}
        <div className="figs">
          <div>
            <span className="lbl">Med kode</span>
            <Fig n={count} total={countable ? inv.products : null} verdict={count === 0 ? "fail" : undefined} />
            <Meter n={count ?? 0} total={inv.products} />
          </div>
          <div>
            <span className="lbl">TFM-format</span>
            <Fig n={preview && countable ? shaped : null} total={preview && countable ? valued : null} verdict={verdictOf(shaped, valued)} />
            <Meter n={shaped} total={valued} verdict={verdictOf(shaped, valued)} />
          </div>
        </div>
        <div className="lh">
          <span className="lbl">Verdier</span>
          <span className="lbl num">{preview && countable ? `${fmt(preview.distinct)} ulike` : ""}</span>
        </div>
        <div className="scroll">
          {!preview && countable ? <MiniLoader /> : null}
          {(preview && countable ? preview.values : []).map((v) => (
            <div key={v.v} className="lrow rule">
              <Lamp verdict={v.shaped ? "ok" : "fail"} />
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
