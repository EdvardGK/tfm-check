import { useMemo, useState } from "react";
import type { Inventory, InventoryProp, Location } from "../types";
import { sameLocation } from "./setup";
import { INPUT, LABEL, PANEL, SECONDARY } from "./ui";

/** The model's property sets; a click on one shows its properties, a click
 *  on a property picks it (edkjo: "I want to see what psets are in the
 *  model, then what properties they have when clicked"). Element
 *  attributes are a set of their own. A name the model lacks is typed. */
const ATTRS = "\u0000attr";

export default function PsetBrowser({
  inv,
  current,
  onPick,
}: {
  inv: Inventory;
  current: Location | undefined;
  onPick: (loc: Location) => void;
}) {
  const [kind, curSet] = current ?? ["all", null, null];
  const [open, setOpen] = useState<string>(kind === "attr" ? ATTRS : (curSet ?? inv.sets[0]?.name ?? ATTRS));
  const [q, setQ] = useState("");
  const [typing, setTyping] = useState(false);
  const [typedSet, setTypedSet] = useState("");
  const [typedProp, setTypedProp] = useState("");

  const ql = q.trim().toLowerCase();
  const sets = useMemo(
    () =>
      inv.sets.filter(
        (s) => ql === "" || s.name.toLowerCase().includes(ql) || s.props.some((p) => p.name.toLowerCase().includes(ql)),
      ),
    [inv.sets, ql],
  );
  const props: InventoryProp[] =
    open === ATTRS ? inv.attributes : (inv.sets.find((s) => s.name === open)?.props ?? []);
  const shown = props.filter(
    (p) => ql === "" || p.name.toLowerCase().includes(ql) || (open !== ATTRS && open.toLowerCase().includes(ql)),
  );
  const locFor = (p: InventoryProp): Location => (open === ATTRS ? ["attr", null, p.name] : ["pset", open, p.name]);

  const setRow = (key: string, name: string, n: number | null) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={open === key}
        onClick={() => setOpen(key)}
        className={
          "flex w-full items-baseline gap-3 px-3 py-1.5 text-left " +
          (open === key ? "bg-ink text-cream" : "text-ink hover:bg-input")
        }
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={name}>
          {name}
        </span>
        {n !== null ? (
          <span className={"shrink-0 font-mono text-[12px] tabular-nums " + (open === key ? "text-cream" : "text-muted")}>
            {n.toLocaleString("nb-NO")}
          </span>
        ) : null}
      </button>
    </li>
  );

  return (
    <div data-pset-browser className={"flex flex-col gap-3 " + PANEL}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter"
        aria-label="Filter"
        className={INPUT + " w-full max-w-sm"}
      />
      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Egenskapssett</span>
          <ul className="m-0 flex max-h-80 list-none flex-col overflow-auto border border-line bg-input p-0">
            {sets.map((s) => setRow(s.name, s.name, s.n))}
            {setRow(ATTRS, "Attributter", null)}
          </ul>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Egenskaper</span>
          <ul className="m-0 flex max-h-80 list-none flex-col overflow-auto border border-line bg-input p-0">
            {shown.map((p) => {
              const loc = locFor(p);
              const picked = sameLocation(loc, current);
              return (
                <li key={p.name} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    aria-pressed={picked}
                    onClick={() => onPick(loc)}
                    className={
                      "flex w-full flex-col gap-1 px-3 py-2 text-left " +
                      (picked ? "outline-2 -outline-offset-2 outline-ink" : "hover:bg-panel")
                    }
                  >
                    <span className="flex items-baseline gap-3">
                      <span className={"min-w-0 flex-1 truncate font-mono text-[13px] text-ink " + (picked ? "font-semibold" : "")}>
                        {p.name}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                        {p.n.toLocaleString("nb-NO")} / {inv.products.toLocaleString("nb-NO")}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
                      {p.samples.map((s) => (
                        <span key={s.v} className="max-w-full truncate" title={`${s.v} · ${s.n}`}>
                          {s.v}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
            {open === ATTRS ? (
              <li>
                <button
                  type="button"
                  aria-pressed={sameLocation(current, ["all", null, null])}
                  onClick={() => onPick(["all", null, null])}
                  className={
                    "flex w-full px-3 py-2 text-left font-mono text-[13px] text-ink " +
                    (sameLocation(current, ["all", null, null]) ? "font-semibold outline-2 -outline-offset-2 outline-ink" : "hover:bg-panel")
                  }
                >
                  Alle felt
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
      {typing ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (typedSet.trim() && typedProp.trim()) onPick(["pset", typedSet.trim(), typedProp.trim()]);
          }}
        >
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Egenskapssett</span>
            <input value={typedSet} onChange={(e) => setTypedSet(e.target.value)} className={INPUT + " w-64"} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Egenskap</span>
            <input value={typedProp} onChange={(e) => setTypedProp(e.target.value)} className={INPUT + " w-48"} />
          </label>
          <button type="submit" className={SECONDARY + " min-h-9"} disabled={!typedSet.trim() || !typedProp.trim()}>
            Velg
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setTyping(true)} className="w-fit text-[13px] text-muted hover:text-ink">
          Egenskapen er ikke med
        </button>
      )}
    </div>
  );
}
