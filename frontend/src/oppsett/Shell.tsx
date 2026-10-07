/** The wizard's frame, after the approved mocks: the rail (file, step index,
 *  the step's options below it), the step bar and the canvas the step
 *  composes in bands. The pieces here only render; state lives in the steps. */

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fmt, type Verdict } from "./setup";

// ---- The rail ----

export type Dot = "ok" | "bad" | "open";

export interface RailItem {
  key: string;
  name: string;
  n: number;
  dot: Dot;
  answer: string;
  standard: boolean;
  current: boolean;
  pending: boolean;
  enabled: boolean;
  onClick: () => void;
}

/** Break a dotted name after its dots, so `Pset.Prop` wraps there. */
export function breakDots(text: string): ReactNode {
  const parts = text.split(".");
  if (parts.length < 2) return text;
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 ? (
        <>
          .<wbr />
        </>
      ) : null}
    </span>
  ));
}

export function Rail({
  file,
  items,
}: {
  file: { name: string; schema: string } | null;
  items: readonly RailItem[];
}) {
  return (
    <nav className="rail tile" aria-label="Oppsett">
      {file ? (
        <div className="file">
          <b className="ell" title={file.name}>
            {file.name}
          </b>
          <span>{file.schema}</span>
        </div>
      ) : null}
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={"ri" + (it.pending ? " pending" : "")}
          aria-current={it.current ? "step" : undefined}
          disabled={!it.enabled}
          onClick={it.onClick}
        >
          <span className="dot" data-s={it.dot} />
          <span className="nm">{it.name}</span>
          <span className="k">{it.n}</span>
          {it.answer || it.standard ? (
            <span className="ans">
              <span className="a">{breakDots(it.answer)}</span>
              {it.standard ? <span className="tag">Standard</span> : null}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

/** Where a step puts its rail options (a portal target under the index). */
export const RailSlot = createContext<HTMLElement | null>(null);

export function RailOptions({ children }: { children: ReactNode }) {
  const slot = useContext(RailSlot);
  return slot ? createPortal(children, slot) : null;
}

export function RailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rsec tile" role="group" aria-label={label}>
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

export function RailTile({
  title,
  example,
  pressed,
  onClick,
}: {
  title?: string;
  example?: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="rtile" aria-pressed={pressed} onClick={onClick}>
      {title ? <span className="t">{title}</span> : null}
      {example ? <span className="x">{example}</span> : null}
    </button>
  );
}

// ---- The canvas ----

/** The step's canvas. `rows`: the grid rows, the step bar first. */
export function Canvas({ rows, children }: { rows: string; children: ReactNode }) {
  return (
    <div className="canvas" style={{ gridTemplateRows: rows } as CSSProperties}>
      {children}
    </div>
  );
}

export interface BarContext {
  name: string;
  n: number | null;
  total: number;
  error: string | null;
  onBack: (() => void) | null;
}
export const Bar = createContext<BarContext>({ name: "", n: null, total: 6, error: null, onBack: null });

/** The step bar: the step's name, `n / N`, «Forrige» and the step's keys. */
export function StepBar({ children }: { children?: ReactNode }) {
  const bar = useContext(Bar);
  return (
    <header className="stepbar tile full">
      <h1>{bar.name}</h1>
      {bar.n !== null ? (
        <span className="of">
          {bar.n} / {bar.total}
        </span>
      ) : null}
      {bar.error ? (
        <span className="err ell" title={bar.error} role="alert">
          {bar.error}
        </span>
      ) : (
        <span className="sp" />
      )}
      {bar.onBack ? (
        <button type="button" className="key" onClick={bar.onBack}>
          Forrige
        </button>
      ) : null}
      {children}
    </header>
  );
}

// ---- Figures ----

export const pct = (n: number, total: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);

const VERDICT_ATTR: Record<Verdict, string | undefined> = { ok: "pass", warn: "warn", fail: "fail", na: undefined };
export const verdictAttr = (v: Verdict) => VERDICT_ATTR[v];

export function Fig({ n, total, verdict }: { n: number | null; total: number | null; verdict?: Verdict }) {
  return (
    <span className="fig num" data-verdict={verdict ? verdictAttr(verdict) : undefined}>
      {n === null ? "–" : fmt(n)}
      {total !== null ? <span className="o"> / {fmt(total)}</span> : null}
    </span>
  );
}

export function Meter({ n, total, verdict }: { n: number; total: number; verdict?: Verdict }) {
  const cls = verdict ? verdictAttr(verdict) : undefined;
  return (
    <span className={"meter" + (cls ? " " + cls : "")}>
      <span style={{ width: `${pct(n, total).toFixed(1)}%` }} />
    </span>
  );
}

export function Bar10({ n, max }: { n: number; max: number }) {
  return (
    <span className="bar">
      <span style={{ width: `${pct(n, max).toFixed(1)}%` }} />
    </span>
  );
}

export function Lamp({ verdict }: { verdict: Verdict }) {
  const glyph = verdict === "ok" ? "✓" : verdict === "fail" ? "✕" : verdict === "warn" ? "!" : "–";
  return (
    <span className="lamp" data-verdict={verdict === "ok" ? "pass" : verdict}>
      {glyph}
    </span>
  );
}

/** A sample value and its count, clamped to two lines. */
export function Val({ v, n }: { v: string; n: number }) {
  return (
    <span className="val" title={`${v} · ${fmt(n)}`}>
      <span className="vv">{v}</span>
      <span className="vc">{fmt(n)}</span>
    </span>
  );
}
