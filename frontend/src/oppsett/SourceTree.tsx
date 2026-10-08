/** The model browser every mapping step uses (Kilde, Status): the loaded
 *  model's property sets as a tree (set ▸ properties, elements carrying a
 *  value, three sample values), with the step's pinned sources on top
 *  («Standard», «Forslag», «Regelsett») and a search that also takes a
 *  typed `Pset.Egenskap` the model does not have. A click picks. */

import { useMemo, useState, type Ref } from "react";
import type { Inventory, InventoryProp, Location, ValueCount } from "../types";
import { Meter, Val } from "./Shell";
import { CustomEntry } from "./SourceChoice";
import { fmt, locationText, sameLocation } from "./setup";

const ATTRS = "\u0000attr";
const ALL: Location = ["all", null, null];

export interface Pin {
  loc: Location;
  tag?: string;
}

export function propOf(inv: Inventory, loc: Location | null | undefined): InventoryProp | undefined {
  if (!loc) return undefined;
  const [kind, set, prop] = loc;
  if (kind === "pset") return inv.sets.find((s) => s.name === set)?.props.find((p) => p.name === prop);
  if (kind === "attr") return inv.attributes.find((a) => a.name === prop);
  return undefined;
}

export default function SourceTree({
  inv,
  draft,
  pins,
  onPick,
  allowAll = false,
  searchRef,
}: {
  inv: Inventory;
  draft: Location | null;
  pins: Pin[];
  onPick: (loc: Location) => void;
  /** «Alle felt» under the attributes (the whole code only). */
  allowAll?: boolean;
  searchRef?: Ref<HTMLInputElement>;
}) {
  const [q, setQ] = useState("");
  // «Angi egen»: open when the source is a property the model lacks.
  const [own, setOwn] = useState(() => draft?.[0] === "pset" && !propOf(inv, draft));
  const [open, setOpen] = useState<ReadonlySet<string>>(() =>
    new Set(draft?.[0] === "attr" ? [ATTRS] : draft?.[0] === "pset" && draft[1] ? [draft[1]] : []),
  );

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
    return known || pins.some((p) => sameLocation(p.loc, loc)) ? null : loc;
  }, [q, inv.sets, pins]);

  const pinned: Pin[] = [...pins];
  if (typed) pinned.push({ loc: typed });
  if (draft && !pinned.some((p) => sameLocation(p.loc, draft)) && draft[0] === "pset" && !propOf(inv, draft)) pinned.push({ loc: draft });

  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const propRow = (loc: Location, name: string, p: InventoryProp | undefined, sub?: string, tag?: string) => {
    const n = p?.n ?? 0;
    const samples: ValueCount[] = p?.samples ?? [];
    const chosen = sameLocation(loc, draft ?? undefined) && draft !== null;
    return (
      <button
        key={`${tag ?? ""}${JSON.stringify(loc)}`}
        type="button"
        className={"trow prop pick rule" + (n === 0 && loc[0] !== "all" ? " empty" : "") + (chosen ? " chosen" : "")}
        aria-pressed={chosen}
        onClick={() => onPick(loc)}
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
        if (allowAll && ql === "") tree.push(propRow(ALL, "Alle felt", undefined));
      }
    }
  }

  return (
    <section className="tile card major tree" aria-label="I modellen">
      <div className="top">
        <span className="lbl">I modellen</span>
        <div className="srow2">
          <input ref={searchRef} className="search" type="search" placeholder="Søk" aria-label="Søk" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="key" aria-pressed={own} onClick={() => setOwn((o) => !o)}>
            Angi egen
          </button>
        </div>
        {own ? <CustomEntry value={draft?.[0] === "pset" && !propOf(inv, draft) ? draft : null} onChange={onPick} /> : null}
      </div>
      <div className="scroll">
        <div className="tcols colhead">
          <span className="lbl">Egenskap</span>
          <span className="lbl num">Elementer</span>
          <span className="lbl vh">Verdier</span>
        </div>
        {pinned.map((p) => {
          const [kind, set, prop] = p.loc;
          return propRow(p.loc, kind === "pset" ? (prop ?? "") : locationText(p.loc), propOf(inv, p.loc), kind === "pset" ? (set ?? "") : undefined, p.tag ?? "");
        })}
        {tree}
      </div>
    </section>
  );
}
