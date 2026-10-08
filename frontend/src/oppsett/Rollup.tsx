import { useEffect, useState } from "react";
import { getRollup, peek, peekLatest, type ModelRules } from "../api";
import type { Rollup, RollupRow } from "../types";
import { Lamp } from "./Shell";
import { MiniLoader } from "./Loader";
import { fmt } from "./setup";

/** The rules' system and component codes rolled up, following the rules. */
export function useRollup(items: ModelRules[]): Rollup | null {
  const [roll, setRoll] = useState<Rollup | null>(() => peek<Rollup>("rollup", "*", items) ?? peekLatest<Rollup>("rollup", "*"));
  const key = JSON.stringify(items);
  useEffect(() => {
    const parsed = JSON.parse(key) as ModelRules[];
    if (parsed.length === 0) return;
    const ready = peek<Rollup>("rollup", "*", parsed);
    if (ready) {
      setRoll(ready);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      getRollup(parsed)
        .then((r) => {
          if (live) setRoll(r);
        })
        .catch(() => {
          /* the model left the cache */
        });
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key]);
  return roll;
}

const chips = (xs: { v: string; n: number }[]) => xs.map((x) => `${x.v} ${fmt(x.n)}`).join("  ·  ");

function Row({ r, with: also }: { r: RollupRow; with: { v: string; n: number }[] }) {
  return (
    <div className="rurow rule" title={r.reason || r.description}>
      {r.valid === null ? <span /> : <Lamp verdict={r.valid ? "ok" : "fail"} />}
      <span className="rc mono">{r.code}</span>
      <span className="rd">
        <span className="ell">{r.description || r.reason || "–"}</span>
        {also.length ? <span className="ra ell">{chips(also)}</span> : null}
      </span>
      <span className="num">{fmt(r.n)}</span>
    </div>
  );
}

/** Two tiles: system codes (with the systems and components under each) |
 *  component codes (with the system codes they appear under). A lamp is the
 *  code's validity in the linked standard; none when the part is not linked. */
export default function RollupTiles({ roll }: { roll: Rollup | null }) {
  const ok = (rows: RollupRow[]) => rows.filter((r) => r.valid).length;
  return (
    <>
      <section className="tile card major vals" aria-label="Systemkoder">
        <div className="lh">
          <span className="lbl">Systemkoder{roll?.links.systemkode ? ` · ${roll.links.systemkode}` : ""}</span>
          <span className="lbl num">{roll ? `${fmt(ok(roll.systems))} / ${fmt(roll.systems.length)}` : ""}</span>
        </div>
        <div className="scroll">
          {!roll ? <MiniLoader /> : null}
          {(roll?.systems ?? []).map((r) => (
            <Row key={r.code} r={r} with={[...r.systems, ...(r.components ?? [])]} />
          ))}
        </div>
      </section>
      <section className="tile card minor vals" aria-label="Komponentkoder">
        <div className="lh">
          <span className="lbl">Komponentkoder{roll?.links.komponent ? ` · ${roll.links.komponent}` : ""}</span>
          <span className="lbl num">{roll ? `${fmt(ok(roll.components))} / ${fmt(roll.components.length)}` : ""}</span>
        </div>
        <div className="scroll">
          {!roll ? <MiniLoader /> : null}
          {(roll?.components ?? []).map((r) => (
            <Row key={r.code} r={r} with={r.systems} />
          ))}
        </div>
      </section>
    </>
  );
}
