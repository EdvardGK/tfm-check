import { useState } from "react";
import type { Inventory, InventoryProp, Location } from "../types";
import PsetBrowser from "./PsetBrowser";
import { STANDARD_LOCATION, STATSBYGG_EXAMPLE, locationText, sameLocation, sourceCount } from "./setup";
import {
  Count, Figure, LABEL, MappingRow, OptionList, StepConfirm, ToZone, ValueList, fixClass, type MapOption,
} from "./ui";
import { VERDICT_FILL } from "./setup";

/** Kilde: where the TFM code lives. Pre-picked: the walk's current source
 *  (the standard, or the saved setup's). When the model lacks it, FROM
 *  says so in red, the browser is open, and the way on is «Behold
 *  standard»: the check then fails where the model lacks it. Never a
 *  silent fallback. */
export default function SourceStep({
  inv,
  current,
  saved,
  onUse,
}: {
  inv: Inventory;
  current: Location | undefined;
  /** The saved setup's source, tagged «Regelsett». */
  saved: Location | null;
  onUse: (loc: Location) => void;
}) {
  const [draft, setDraft] = useState<Location>(current ?? STANDARD_LOCATION);
  const count = sourceCount(inv, draft);
  const missing = count === 0;
  const [browsing, setBrowsing] = useState(missing);

  const isStd = sameLocation(draft, STANDARD_LOCATION);
  const isSaved = saved !== null && sameLocation(draft, saved);
  const tagOf = (loc: Location) =>
    sameLocation(loc, STANDARD_LOCATION) ? "Standard" : saved && sameLocation(loc, saved) ? "Regelsett" : undefined;

  const listed: Location[] = [STANDARD_LOCATION];
  if (saved && !listed.some((l) => sameLocation(l, saved))) listed.push(saved);
  for (const c of inv.candidates) if (!listed.some((l) => sameLocation(l, c.location))) listed.push(c.location);
  if (!listed.some((l) => sameLocation(l, draft))) listed.push(draft);

  const options: MapOption[] = listed.map((loc) => {
    const n = sourceCount(inv, loc);
    const [kind, set, prop] = loc;
    return {
      key: JSON.stringify(loc),
      tag: tagOf(loc),
      head: kind === "pset" ? `${set}.` : undefined,
      title: kind === "pset" ? (prop ?? "") : locationText(loc),
      count: n === null ? undefined : <Count n={n} total={inv.products} />,
      current: sameLocation(loc, draft),
      onPick: () => setDraft(loc),
    };
  });

  const prop = propOf(inv, draft);
  const [kind, set, name] = draft;
  const tag = isStd ? "Standard" : isSaved ? "Regelsett" : null;

  return (
    <>
      <MappingRow
        to={<ToZone name="Kilde" example={STATSBYGG_EXAMPLE} />}
        fromState={missing ? "missing" : "found"}
        fromKey={JSON.stringify(draft)}
        from={
          <>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2">
                {tag ? <span className={LABEL + " text-[11px]"}>{tag}</span> : null}
                <span className="truncate font-mono text-[12px] text-muted">
                  {kind === "pset" ? set : kind === "attr" ? "Attributt" : ""}
                </span>
              </span>
              <span className="text-2xl leading-tight font-medium [overflow-wrap:anywhere] text-ink">
                {kind === "all" ? "Alle felt" : name}
              </span>
            </div>
            {count !== null ? (
              <Figure label="Elementer" value={`${count.toLocaleString("nb-NO")} / ${inv.products.toLocaleString("nb-NO")}`} bad={missing} />
            ) : null}
            {missing ? (
              <span className={"w-fit px-2 py-0.5 font-mono text-[12px] " + VERDICT_FILL.fail}>Ikke i modellen</span>
            ) : null}
            {prop ? <ValueList values={prop.samples} /> : null}
          </>
        }
        options={
          <>
            <OptionList options={options} label="Kilde" />
            <button
              type="button"
              aria-expanded={browsing}
              onClick={() => setBrowsing((b) => !b)}
              className={fixClass(missing)}
            >
              {missing && isStd ? "Kartlegg" : "Endre"}
            </button>
          </>
        }
      />
      {browsing ? <PsetBrowser inv={inv} current={draft} onPick={setDraft} /> : null}
      <StepConfirm
        lead={!missing}
        label={missing && isStd ? "Behold standard" : "Bruk"}
        onClick={() => onUse(draft)}
      />
    </>
  );
}

function propOf(inv: Inventory, loc: Location): InventoryProp | undefined {
  const [kind, set, prop] = loc;
  if (kind === "pset") return inv.sets.find((s) => s.name === set)?.props.find((p) => p.name === prop);
  if (kind === "attr") return inv.attributes.find((a) => a.name === prop);
  return undefined;
}
