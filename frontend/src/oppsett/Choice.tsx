import { useRef } from "react";
import { SECONDARY, STEP_TITLE } from "./ui";

/** The first screen: the standard or custom, and a saved setup under them. */
const TILE = "flex min-h-36 flex-col items-start justify-center border-2 p-8 text-left";

export default function Choice({
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
    <>
      <h1 className={STEP_TITLE}>Oppsett</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <button
          type="button"
          autoFocus
          data-choice="statsbygg"
          onClick={onStatsbygg}
          className={TILE + " border-green bg-green text-cream hover:border-ink hover:bg-ink"}
        >
          <span className="text-[28px] leading-tight font-semibold tracking-tight">Statsbygg →</span>
        </button>
        <button
          type="button"
          data-choice="custom"
          onClick={onCustom}
          className={TILE + " border-line bg-panel text-ink hover:border-green"}
        >
          <span className="text-[28px] leading-tight font-semibold tracking-tight">Egendefinert →</span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => input.current?.click()} className={SECONDARY}>
          <span>Åpne regelsett</span>
          <span className="font-mono text-[11px] tracking-wide text-muted">.json</span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpen(f);
            e.target.value = "";
          }}
        />
      </div>
    </>
  );
}
