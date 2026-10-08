import { useRef } from "react";
import { Canvas, StepBar } from "./Shell";
import { ANY_FAG, STATSBYGG_EXAMPLE, STANDARD_LOCATION, download, locationText, setupJson, statsbyggRules } from "./setup";

/** The first screen: the Statsbygg standard or a custom setup, and a saved
 *  setup («Åpne regelsett») in the bar. */
export default function StartStep({
  onStatsbygg,
  onCustom,
  onOpen,
}: {
  onStatsbygg: () => void;
  onCustom: () => void;
  onOpen: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button
          type="button"
          className="key"
          onClick={() => download("tfm-oppsett-mal.json", setupJson({ base: "statsbygg", fag: { [ANY_FAG]: statsbyggRules(null) } }))}
        >
          Last ned mal
        </button>
        <button type="button" className="key" onClick={() => input.current?.click()}>
          Åpne regelsett
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,.ids,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpen(f);
            e.target.value = "";
          }}
        />
      </StepBar>
      <button type="button" data-choice="statsbygg" className="tile choicecard major lead" onClick={onStatsbygg}>
        <h2>Statsbygg</h2>
        <span className="kv">
          <span className="lbl">Kilde</span>
          <span className="v">{locationText(STANDARD_LOCATION)}</span>
          <span className="lbl">Format</span>
          <span className="v">{STATSBYGG_EXAMPLE}</span>
          <span className="lbl">Etasjer</span>
          <span className="v">00U · 01 · 02M</span>
        </span>
      </button>
      <button type="button" data-choice="custom" className="tile choicecard minor" onClick={onCustom}>
        <h2>Egendefinert</h2>
        <span className="kv">
          <span className="lbl">Kilde</span>
          <span className="v">–</span>
          <span className="lbl">Format</span>
          <span className="v">–</span>
          <span className="lbl">Etasjer</span>
          <span className="v">–</span>
        </span>
      </button>
    </Canvas>
  );
}
