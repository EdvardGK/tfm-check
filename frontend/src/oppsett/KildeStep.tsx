import { useRef, useState } from "react";
import { ASPECTS, type Aspect, type Inventory, type Location, type RulesDict, type TfmMode } from "../types";
import { Canvas, Fig, Lamp, Meter, RailOptions, RailSection, RailTile, StepBar, Val, breakDots } from "./Shell";
import { MiniLoader } from "./Loader";
import SourceTree, { propOf, type Pin } from "./SourceTree";
import { useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import {
  ASPECT_NAME, ASPECT_SIGN, PART_STANDARD, STANDARD_LOCATION, fmt, locationText, sameLocation, sourceCount, sourceText,
  verdictOf,
} from "./setup";

type Parts = Partial<Record<Aspect, Location>>;

/** Kilde: where the TFM code lives, whole in one property or composed from
 *  the PA 0802 aspects (+lokasjon =system -komponent), each in its own
 *  property (the rail's «Hel kode» / «Fra deler»).
 *
 *  Band 1: the Statsbygg standard (found or not, and when not: «Kartlegg» or
 *  «Behold standard») | what is picked, with its evidence. Band 2: the
 *  model's property sets as a tree, the standard and the suggestions pinned
 *  on top | the codes the pick reads. Never a silent fallback: a missing
 *  standard stays red until «Bruk» takes a source, and «Behold standard»
 *  keeps it (the check then fails). */
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
  const std = STANDARD_LOCATION;
  const stdN = inv.standard.n;
  const wholeMissing = stdN === 0;
  const wholeCand = inv.candidates.find((c) => !sameLocation(c.location, std))?.location ?? null;
  const partCand = (a: Aspect) => inv.roles[a].candidates[0]?.location ?? null;
  const partFound = (a: Aspect) => inv.roles[a].standard.n > 0;

  // ---- The pre-picked answer ----
  const [mode, setMode] = useState<TfmMode>(() => {
    if (fresh && wholeMissing && !wholeCand && ASPECTS.some((a) => partFound(a) || partCand(a))) return "parts";
    return rules.tfm_mode ?? "whole";
  });
  const cur = rules.tfm_location ?? std;
  const [draft, setDraft] = useState<Location>(() =>
    fresh && wholeMissing && wholeCand && sameLocation(cur, std) ? wholeCand : cur,
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
  const search = useRef<HTMLInputElement>(null);

  const composed = mode === "parts";
  const draftRules: RulesDict = composed
    ? { ...rules, tfm_mode: "parts", tfm_parts: parts }
    : { ...rules, tfm_mode: "whole", tfm_location: draft };
  const isStd = composed ? ASPECTS.every((a) => sameLocation(parts[a], PART_STANDARD[a])) : sameLocation(draft, std);
  useLiveAnswer("kilde", sourceText(draftRules), isStd);

  const preview = usePreview(uploadId, draftRules);
  const valued = preview?.valued ?? 0;
  const shaped = preview?.shaped ?? 0;
  const countable = composed || draft[0] !== "all";
  const avvik = Math.max(0, valued - shaped);

  // ---- Picking ----
  const pick = (loc: Location) => {
    if (composed) setParts((p) => ({ ...p, [active]: loc }));
    else setDraft(loc);
  };
  const missing = composed ? ASPECTS.some((a) => !partFound(a)) : wholeMissing;
  const kartlegg = () => {
    if (composed) {
      setParts((p) => {
        const n = { ...p };
        for (const a of ASPECTS) if (!partFound(a) && partCand(a) && sameLocation(n[a], PART_STANDARD[a])) n[a] = partCand(a) ?? undefined;
        return n;
      });
      search.current?.focus();
    } else if (wholeCand && isStd) setDraft(wholeCand);
    else search.current?.focus();
  };
  const keepStandard = () => {
    if (composed) setParts({ ...PART_STANDARD });
    else setDraft(std);
  };

  const savedFor = (a: Aspect | null): Location | null =>
    !saved ? null : a === null ? (saved.tfm_mode !== "parts" ? (saved.tfm_location ?? null) : null) : (saved.tfm_parts?.[a] ?? null);

  const pins: Pin[] = [];
  if (composed) {
    pins.push({ loc: PART_STANDARD[active], tag: "Standard" });
    for (const c of inv.roles[active].candidates) pins.push({ loc: c.location, tag: "Forslag" });
    const s = savedFor(active);
    if (s && !pins.some((p) => sameLocation(p.loc, s))) pins.push({ loc: s, tag: "Regelsett" });
  } else {
    pins.push({ loc: std, tag: "Standard" });
    if (wholeCand) pins.push({ loc: wholeCand, tag: "Forslag" });
    const s = savedFor(null);
    if (s && !pins.some((p) => sameLocation(p.loc, s))) pins.push({ loc: s, tag: "Regelsett" });
  }

  const standardCard = composed ? (
    <section className="tile card major std" aria-label="Standard">
      <span className="lbl">Standard</span>
      <div className="slots">
        {ASPECTS.map((a) => {
          const n = inv.roles[a].standard.n;
          return (
            <div key={a} className="slot rule">
              <span className="sg">{ASPECT_SIGN[a]}</span>
              <span className="sn">{ASPECT_NAME[a]}</span>
              <span className="ss ell">{locationText(PART_STANDARD[a])}</span>
              <span className="num">{of(n, inv.products)}</span>
              <Lamp verdict={n > 0 ? "ok" : "fail"} />
            </div>
          );
        })}
      </div>
      {missing ? (
        <div className="choice">
          <button type="button" className="key" aria-pressed={!isStd} onClick={kartlegg}>
            Kartlegg
          </button>
          <button type="button" className="key" aria-pressed={isStd} onClick={keepStandard}>
            Behold standard
          </button>
        </div>
      ) : null}
    </section>
  ) : (
    <section className="tile card major std" aria-label="Standard">
      <span className="lbl">Standard</span>
      <div className="row1">
        <span className="src">{locationText(std)}</span>
        {wholeMissing ? (
          <span className="badge" data-verdict="fail">
            ✕ Ikke i modellen
          </span>
        ) : (
          <span className="badge" data-verdict="pass">
            ✓ I modellen
          </span>
        )}
      </div>
      <Fig n={stdN} total={inv.products} verdict={wholeMissing ? "fail" : "ok"} />
      <Meter n={stdN} total={inv.products} verdict={wholeMissing ? undefined : "ok"} />
      {wholeMissing ? (
        <div className="choice">
          <button type="button" className="key" aria-pressed={!isStd} onClick={kartlegg}>
            Kartlegg
          </button>
          <button type="button" className="key" aria-pressed={isStd} onClick={keepStandard}>
            Behold standard
          </button>
        </div>
      ) : (
        <div className="vals3">
          {(propOf(inv, std)?.samples ?? []).map((s) => (
            <Val key={s.v} v={s.v} n={s.n} />
          ))}
        </div>
      )}
    </section>
  );

  const count = composed ? (preview ? valued : null) : sourceCount(inv, draft);

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
          <RailTile title="Hel kode" example="+123456=360.001-JV401" pressed={!composed} onClick={() => setMode("whole")} />
          <RailTile title="Fra deler" example="+ … = … - …" pressed={composed} onClick={() => setMode("parts")} />
        </RailSection>
      </RailOptions>

      {standardCard}

      <section className="tile card minor ev" aria-label="Valgt">
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
            <Fig n={count} total={countable ? inv.products : null} />
            <Meter n={count ?? 0} total={inv.products} />
          </div>
          <div>
            <span className="lbl">TFM-format</span>
            <Fig n={preview && countable ? shaped : null} total={preview && countable ? valued : null} verdict={verdictOf(shaped, valued)} />
            <Meter n={shaped} total={valued} verdict={verdictOf(shaped, valued)} />
          </div>
        </div>
        <div className="av">
          <div className="lh">
            <span className="lbl">Avvik</span>
            <span className="lbl num">{preview && countable ? fmt(avvik) : "–"}</span>
          </div>
          <div className="chips">
            {(preview?.unshaped ?? []).slice(0, 16).map((u) => (
              <span key={u.v} className="chip warn" title={`${u.v} · ${fmt(u.n)}`}>
                {u.v}
                <span className="c">{fmt(u.n)}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <SourceTree
        key={composed ? `parts-${active}` : "whole"}
        inv={inv}
        draft={composed ? (parts[active] ?? null) : draft}
        pins={pins}
        onPick={pick}
        allowAll={!composed}
        searchRef={search}
      />

      <section className="tile card minor vals" aria-label="Verdier">
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

const of = (n: number, total: number) => `${fmt(n)} / ${fmt(total)}`;
