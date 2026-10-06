import { useRef } from "react";

/** The IFC stage, after ifc-check's `IfcDrop`: one drop target, the step's
 *  name once and the formats taken. A file held over the page lights it;
 *  while the model uploads and is read, the sweep runs along its foot. */
export const STAGE_WIDTH = "w-[min(100%,calc(72cqh*1.6))]";

export default function IfcStage({
  dragging,
  busy,
  pct,
  fileName,
  onFile,
}: {
  dragging: boolean;
  busy: boolean;
  /** Upload progress; null once the file is up and being read. */
  pct: number | null;
  fileName: string | null;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        autoFocus
        data-ifc-drop={dragging ? "over" : busy ? "busy" : "rest"}
        aria-busy={busy}
        disabled={busy}
        onClick={() => input.current?.click()}
        className={
          "group relative flex aspect-[16/10] min-h-44 w-full flex-col items-center justify-center gap-5 overflow-hidden border-2 border-dashed p-6 text-center transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green " +
          (dragging
            ? "border-green bg-palegreen text-green"
            : "border-muted bg-input text-ink hover:border-green hover:text-green")
        }
      >
        <svg
          width="72"
          height="72"
          viewBox="0 0 72 72"
          aria-hidden="true"
          className={"shrink-0 " + (dragging ? "text-green" : "text-muted group-hover:text-green")}
        >
          <path d="M8 46v16h56V46" fill="none" stroke="currentColor" strokeWidth="3" />
          <g
            className={
              "transition-transform duration-150 motion-reduce:transition-none " +
              (dragging ? "-translate-y-1" : "group-hover:-translate-y-0.5")
            }
          >
            <path d="M36 50V12" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M22 26 36 12l14 14" fill="none" stroke="currentColor" strokeWidth="3" />
          </g>
        </svg>
        <span className="text-2xl leading-tight font-medium tracking-tight sm:text-[28px]">
          {busy && fileName ? fileName : "Åpne IFC"}
        </span>
        <span className="font-mono text-[13px] tracking-wide text-muted">
          {busy && pct !== null && pct < 100 ? `${pct} %` : ".ifc · IFC2X3 · IFC4"}
        </span>
        {busy ? (
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-line">
            {pct !== null && pct < 100 ? (
              <span className="block h-full bg-green transition-[width] duration-200" style={{ width: `${pct}%` }} />
            ) : (
              <span className="ifc-sweep block h-full w-1/3 bg-green" />
            )}
          </span>
        ) : null}
      </button>
      <input
        ref={input}
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
