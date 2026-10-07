import { useMemo, useRef, useState } from "react";
import type { Inventory, InventoryProp, Location, RulesDict, ValueCount } from "../types";
import { Canvas, Fig, Lamp, Meter, StepBar, Val, breakDots } from "./Shell";
import { useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import { STANDARD_LOCATION, fmt, locationText, sameLocation, sourceCount, verdictOf } from "./setup";

const ATTRS = "\u0000attr";
const ALL: Location = ["all", null, null];

/** Kilde: where the TFM code lives. Band 1: the Statsbygg standard (found
 *  or not, and when not: «Kartlegg» or «Behold standard») | the picked
 *  source's evidence. Band 2: the model's property sets as a tree, with the
 *  standard and the suggestion pinned on top | the picked source's values.
 *  Never a silent fallback: a missing standard stays red until «Bruk» takes
 *  a source, and «Behold standard» keeps it (the check then fails). */
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
  /** The saved setup's source, pinned as «Regelsett». */
  saved: Location | null;
  /** Not taken before: a missing standard pre-picks the suggestion. */
  fresh: boolean;
  onUse: (loc: Location) => void;
}) {
  const std = STANDARD_LOCATION;
  const stdN = inv.standard.n;
  const missing = stdN === 0;
  const cand = inv.candidates.find((c) => !sameLocation(c.location, std))?.location ?? null;

  const cur = rules.tfm_location ?? std;
  const initial = fresh && missing && cand && sameLocation(cur, std) ? cand : cur;
  const [draft, setDraft] = useState<Location>(initial);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() =>
    new Set(initial[0] === "attr" ? [ATTRS] : initial[0] === "pset" && initial[1] ? [initial[1]] : []),
  );
  const search = useRef<HTMLInputElement>(null);

  const isStd = sameLocation(draft, std);
  useLiveAnswer("kilde", locationText(draft), isStd);

  const preview = usePreview(uploadId, { ...rules, tfm_location: draft });
  const count = sourceCount(inv, draft);

  const propOf = (loc: Location): InventoryProp | undefined => {
    const [kind, set, prop] = loc;
    if (kind === "pset") return inv.sets.find((s) => s.name === set)?.props.find((p) => p.name === prop);
    if (kind === "attr") return inv.attributes.find((a) => a.name === prop);
    return undefined;
  };
  const stdProp = propOf(std);

  // The tree: sets most carried first, their properties likewise.
  const sets = useMemo(
    () =>
      [...inv.sets]
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
        .map((s) => ({ ...s, props: [...s.props].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)) })),
    [inv.sets],
  );
  const ql = q.trim().toLowerCase();
  const typed = useMemo<Location | null>(() => {
    const t = q.trim();
    const dot = t.lastIndexOf(".");
    if (dot <= 0 || dot === t.length - 1) return null;
    const loc: Location = ["pset", t.slice(0, dot).trim(), t.slice(dot + 1).trim()];
    const known = inv.sets.some((s) => s.name === loc[1] && s.props.some((p) => p.name === loc[2]));
    return known || sameLocation(loc, std) ? null : loc;
  }, [q, inv.sets, std]);

  const pinned: { loc: Location; tag?: string }[] = [{ loc: std, tag: "Standard" }];
  if (cand) pinned.push({ loc: cand, tag: "Forslag" });
  if (saved && !pinned.some((p) => sameLocation(p.loc, saved))) pinned.push({ loc: saved, tag: "Regelsett" });
  if (typed) pinned.push({ loc: typed });
  if (!pinned.some((p) => sameLocation(p.loc, draft)) && draft[0] === "pset" && !propOf(draft)) pinned.push({ loc: draft });

  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const kartlegg = () => {
    if (cand && isStd) setDraft(cand);
    else search.current?.focus();
  };

  const valued = preview?.valued ?? 0;
  const shaped = preview?.shaped ?? 0;
  const countable = draft[0] !== "all";

  const propRow = (loc: Location, name: string, p: InventoryProp | undefined, sub?: string, tag?: string) => {
    const n = p?.n ?? 0;
    const samples: ValueCount[] = p?.samples ?? [];
    return (
      <button
        key={`${tag ?? ""}${JSON.stringify(loc)}`}
        type="button"
        className={"trow prop pick rule" + (n === 0 && loc[0] !== "all" ? " empty" : "") + (sameLocation(loc, draft) ? " chosen" : "")}
        aria-pressed={sameLocation(loc, draft)}
        onClick={() => setDraft(loc)}
      >
        <span className="pn">
          <span className="l1">
            {tag ? <span className="tag">{tag}</span> : null}
            <span className="pnm">{name}</span>
          </span>
          {sub ? <span className="ps">{sub}</span> : null}
        </span>
        <span className="pc">
          <span className="num">{loc[0] === "all" ? "–" : fmt(n)}</span>
          <Meter n={n} total={inv.products} />
        </span>
        {samples.length === 0 ? <span className="val none">–</span> : <Val v={samples[0].v} n={samples[0].n} />}
        {samples[1] ? <Val v={samples[1].v} n={samples[1].n} /> : <span />}
        {samples[2] ? <Val v={samples[2].v} n={samples[2].n} /> : <span />}
      </button>
    );
  };

  const setRow = (key: string, name: string, n: number, expanded: boolean) => (
    <button key={`set:${key}`} type="button" className="trow set pick rule" aria-expanded={expanded} onClick={() => toggle(key)}>
      <span className="pn">
        <span className="tw">{expanded ? "▾" : "▸"}</span>
        {name}
      </span>
      <span className="num sc">{fmt(n)}</span>
    </button>
  );

  const tree: React.ReactNode[] = [];
  for (const s of sets) {
    const setHit = ql !== "" && s.name.toLowerCase().includes(ql);
    const props = ql === "" || setHit ? s.props : s.props.filter((p) => p.name.toLowerCase().includes(ql));
    if (ql !== "" && props.length === 0) continue;
    const expanded = open.has(s.name) || (ql !== "" && !setHit);
    tree.push(setRow(s.name, s.name, s.n, expanded));
    if (expanded) for (const p of props) tree.push(propRow(["pset", s.name, p.name], p.name, p));
  }
  {
    const attrs = ql === "" ? inv.attributes : inv.attributes.filter((a) => a.name.toLowerCase().includes(ql));
    if (ql === "" || attrs.length > 0) {
      const expanded = open.has(ATTRS) || ql !== "";
      tree.push(setRow(ATTRS, "Attributter", inv.products, expanded));
      if (expanded) {
        for (const a of attrs) tree.push(propRow(["attr", null, a.name], a.name, a));
        if (ql === "") tree.push(propRow(ALL, "Alle felt", undefined));
      }
    }
  }

  const avvik = Math.max(0, valued - shaped);

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" onClick={() => onUse(draft)}>
          Bruk
        </button>
      </StepBar>

      <section className="tile card major std" aria-label="Standard">
        <span className="lbl">Standard</span>
        <div className="row1">
          <span className="src">{locationText(std)}</span>
          {missing ? (
            <span className="badge" data-verdict="fail">
              ✕ Ikke i modellen
            </span>
          ) : (
            <span className="badge" data-verdict="pass">
              ✓ I modellen
            </span>
          )}
        </div>
        <Fig n={stdN} total={inv.products} verdict={missing ? "fail" : "ok"} />
        <Meter n={stdN} total={inv.products} verdict={missing ? undefined : "ok"} />
        {missing ? (
          <div className="choice">
            <button type="button" className="key" aria-pressed={!isStd} onClick={kartlegg}>
              Kartlegg
            </button>
            <button type="button" className="key" aria-pressed={isStd} onClick={() => setDraft(std)}>
              Behold standard
            </button>
          </div>
        ) : (
          <div className="vals3">
            {(stdProp?.samples ?? []).map((s) => (
              <Val key={s.v} v={s.v} n={s.n} />
            ))}
          </div>
        )}
      </section>

      <section className="tile card minor ev" aria-label="Valgt">
        <span className="lbl">Valgt</span>
        <span className="src">{breakDots(locationText(draft))}</span>
        <div className="figs">
          <div>
            <span className="lbl">Med verdi</span>
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

      <section className="tile card major tree" aria-label="I modellen">
        <div className="top">
          <span className="lbl">I modellen</span>
          <input ref={search} className="search" type="search" placeholder="Søk" aria-label="Søk" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="scroll">
          <div className="tcols colhead">
            <span className="lbl">Egenskap</span>
            <span className="lbl num">Elementer</span>
            <span className="lbl vh">Verdier</span>
          </div>
          {pinned.map((p) => {
            const [kind, set, prop] = p.loc;
            return propRow(p.loc, kind === "pset" ? (prop ?? "") : locationText(p.loc), propOf(p.loc), kind === "pset" ? (set ?? "") : undefined, p.tag ?? "");
          })}
          {tree}
        </div>
      </section>

      <section className="tile card minor vals" aria-label="Verdier">
        <div className="lh">
          <span className="lbl">Verdier</span>
          <span className="lbl num">{preview && countable ? `${fmt(preview.distinct)} ulike` : ""}</span>
        </div>
        <div className="scroll">
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
