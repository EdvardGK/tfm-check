import { useRef } from "react";
import type { ReadProgress } from "../api";
import { Canvas, StepBar } from "./Shell";
import Loader from "./Loader";
import { fmt } from "./setup";

/** Åpne IFC: one drop target filling the canvas. A file held over the page
 *  lights it. While the model goes up and is read, the frame plays the
 *  loader with its counter, and the walk waits; once the model is read,
 *  the walk opens and the rail's first row carries the file. */
export default function IfcStep({
  dragging,
  busy,
  progress,
  fileName,
  loaded,
  onFile,
  onUse,
}: {
  dragging: boolean;
  busy: boolean;
  progress: ReadProgress | null;
  fileName: string | null;
  loaded: { products: number } | null;
  onFile: (file: File) => void;
  onUse: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Canvas rows="auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" disabled={!loaded || busy} onClick={onUse}>
          Bruk
        </button>
      </StepBar>
      <section className="tile dropcard full">
        <button
          type="button"
          className="drop"
          data-ifc-drop={dragging ? "over" : busy ? "busy" : "rest"}
          data-over={dragging}
          aria-busy={busy}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? (
            <Loader progress={progress} />
          ) : (
            <svg width="64" height="64" viewBox="0 0 72 72" aria-hidden="true">
              <path d="M8 46v16h56V46" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M36 50V12" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M22 26 36 12l14 14" fill="none" stroke="currentColor" strokeWidth="3" />
            </svg>
          )}
          <span className="nm">{fileName ?? "Åpne IFC"}</span>
          {busy ? null : (
            <span className="fx">{loaded ? `${fmt(loaded.products)} elementer` : ".ifc · .ifczip · IFC2X3 · IFC4"}</span>
          )}
        </button>
        <input
          ref={input}
          type="file"
          accept=".ifc,.ifczip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </section>
    </Canvas>
  );
}
