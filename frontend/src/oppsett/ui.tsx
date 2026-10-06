/** The walk's pieces, after ifc-check's `src/ui/setup/Walk.tsx` and
 *  `Mapping.tsx`: the bar, the landed strip, the step's one primary (in the
 *  walk's foot), the mapping row (TO ← FROM │ OPTIONS), figures. */

import { createContext, useContext, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { STEP_NAME, VERDICT_FILL, VERDICT_WORD, type StepResult, type WalkStep } from "./setup";

export const LABEL = "text-[12px] font-semibold tracking-[0.1em] text-gold uppercase";
export const STEP_TITLE =
  "m-0 text-[34px] leading-[1.1] font-semibold tracking-tight break-words hyphens-auto text-ink";
export const PANEL = "border border-line bg-panel p-4";
export const INPUT =
  "border border-line bg-input px-2 py-1.5 font-mono text-[13px] text-ink outline-none focus:border-green";
export const SECONDARY =
  "flex items-center gap-2 border border-line bg-cream px-3 py-1.5 text-[12px] text-ink hover:border-green hover:text-green";
export const PILL =
  "min-h-9 border px-3 py-1 font-mono text-[13px] aria-pressed:border-green aria-pressed:bg-green aria-pressed:text-cream " +
  "border-line bg-input text-ink hover:border-green";

export const CONFIRM =
  "flex min-h-12 items-center justify-center gap-3 bg-green px-8 text-[15px] font-medium text-cream hover:bg-ink";
export const CONFIRM_QUIET =
  "flex min-h-12 items-center justify-center gap-3 border-2 border-ink bg-panel px-8 text-[15px] font-medium text-ink hover:border-green hover:text-green";
export const confirmClass = (lead: boolean) => (lead ? CONFIRM : CONFIRM_QUIET);

/** «Endre»: quiet beside an answer that works, the lead when it gives
 *  nothing on the loaded model. */
export const fixClass = (lead: boolean) =>
  lead
    ? "w-fit border-2 border-ink bg-panel px-4 py-2 text-[14px] font-semibold text-ink hover:border-green hover:text-green"
    : "w-fit border border-line px-3 py-1 text-[12px] text-ink hover:border-green hover:text-green";

export type SegmentState = "done" | "saved" | "open";

const SEGMENT: Record<SegmentState | "here", string> = {
  done: "bg-green",
  here: "bg-ink",
  saved:
    "bg-[image:repeating-linear-gradient(135deg,var(--color-muted)_0_3px,transparent_3px_6px)] group-hover:bg-muted",
  open: "bg-muted/25 group-hover:bg-muted",
};

/** One segment per step; the current one taller. A segment is the jump. */
export function WalkProgress({
  steps,
  current,
  state,
  onStep,
}: {
  steps: readonly WalkStep[];
  current: WalkStep | null;
  state: (s: WalkStep) => SegmentState;
  onStep: (s: WalkStep) => void;
}) {
  const at = current === null ? steps.length : steps.indexOf(current) + 1;
  return (
    <nav data-walk-progress className="flex min-w-0 flex-1 items-center gap-3">
      <ol className="m-0 flex min-w-0 flex-1 list-none gap-1 p-0">
        {steps.map((s) => {
          const here = s === current;
          const st = state(s);
          return (
            <li key={s} className="min-w-0 flex-1">
              <button
                type="button"
                title={STEP_NAME[s]}
                aria-label={STEP_NAME[s]}
                aria-current={here ? "step" : undefined}
                data-segment={st}
                onClick={() => onStep(s)}
                className="group flex h-6 w-full items-center"
              >
                <span
                  className={
                    "block w-full transition-colors duration-500 motion-reduce:transition-none " +
                    (here ? "h-3 " : "h-1.5 ") +
                    SEGMENT[st === "done" || !here ? st : "here"]
                  }
                />
              </button>
            </li>
          );
        })}
      </ol>
      {current === null ? null : (
        <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink">
          {at} / {steps.length}
        </span>
      )}
    </nav>
  );
}

/** A result: the state, then the figure. */
export function ResultChip({ result }: { result: StepResult | null }) {
  if (result === null) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={"px-2 py-0.5 font-mono text-[12px] " + VERDICT_FILL[result.verdict]}>
        {VERDICT_WORD[result.verdict]}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-muted">{result.figure}</span>
    </span>
  );
}

/** What the step just confirmed gave, under the bar on the next step. */
export function Landed({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div data-landed className="pick-in flex flex-wrap items-center gap-3 border border-line bg-panel px-4 py-2">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
    </div>
  );
}

export function Figure({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={LABEL}>{label}</span>
      <span className={"px-1 font-mono text-[13px] tabular-nums " + (bad ? VERDICT_FILL.fail : "text-ink")}>
        {value}
      </span>
    </span>
  );
}

// ---- The step's primary, in the walk's foot ----

const ConfirmSlot = createContext<HTMLElement | null>(null);
export const ConfirmSlotProvider = ConfirmSlot.Provider;
export const SlotContext = ConfirmSlot;

export function StepConfirm({
  lead = true,
  disabled = false,
  label = "Bruk",
  onClick,
}: {
  lead?: boolean;
  disabled?: boolean;
  label?: string;
  onClick: () => void;
}) {
  const slot = useContext(ConfirmSlot);
  const button = (
    <button
      type="button"
      autoFocus
      data-step-confirm
      data-lead={lead}
      disabled={disabled}
      onClick={onClick}
      className={
        confirmClass(lead) +
        " disabled:cursor-not-allowed disabled:border-muted/50 disabled:bg-panel disabled:text-muted"
      }
    >
      {label} →
    </button>
  );
  return slot ? createPortal(button, slot) : null;
}

// ---- The mapping row: TO ← FROM │ OPTIONS ----

export type FromState = "found" | "missing" | "empty";

const FROM_LOOK: Record<FromState, string> = {
  found: "",
  missing: "outline-2 -outline-offset-2 outline-bad",
  empty: "outline-1 -outline-offset-2 outline-dashed outline-muted",
};

export function MappingRow({
  to,
  from,
  fromState,
  fromKey,
  options,
}: {
  to: ReactNode;
  from: ReactNode;
  fromState: FromState;
  fromKey?: string;
  options?: ReactNode;
}) {
  return (
    <div
      data-mapping-row
      className={
        "grid grid-cols-1 items-stretch gap-4 " +
        (options
          ? "md:grid-cols-[minmax(min-content,0.8fr)_auto_minmax(0,1fr)_minmax(0,1.3fr)]"
          : "md:grid-cols-[minmax(min-content,0.8fr)_auto_minmax(0,1fr)]")
      }
    >
      <div data-zone="to" className="flex min-w-0 flex-col gap-1">
        {to}
      </div>
      <div aria-hidden="true" className="flex items-start justify-center text-2xl leading-none text-muted md:pt-5">
        <span className="md:hidden">↑</span>
        <span className="hidden md:inline">←</span>
      </div>
      <div
        key={fromKey}
        data-zone="from"
        data-from={fromState}
        className={"pick-in flex min-w-0 flex-col gap-2 " + PANEL + " " + FROM_LOOK[fromState]}
      >
        {from}
      </div>
      {options ? (
        <div data-zone="options" className={"flex min-w-0 flex-col gap-2 " + PANEL}>
          {options}
        </div>
      ) : null}
    </div>
  );
}

/** TO: the step's name, and what it is (an example of the value). */
export function ToZone({ name, example }: { name: string; example?: string }) {
  return (
    <>
      <h1 className={STEP_TITLE}>{name}</h1>
      {example ? <span className="font-mono text-[13px] text-muted">{example}</span> : null}
    </>
  );
}

export interface MapOption {
  key: string;
  tag?: string;
  head?: string;
  title: string;
  count?: ReactNode;
  current: boolean;
  onPick: () => void;
}

/** OPTIONS: a pick changes FROM, never moves on. ↑ ↓ move, Enter picks. */
export function OptionList({ options, label }: { options: readonly MapOption[]; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.findIndex((o) => o.current));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const now = refs.current.findIndex((el) => el === document.activeElement);
    const from = now < 0 ? at : now;
    const next = event.key === "ArrowDown" ? Math.min(from + 1, options.length - 1) : Math.max(from - 1, 0);
    refs.current[next]?.focus();
  };
  if (options.length === 0) return null;
  return (
    <div role="listbox" aria-label={label} onKeyDown={onKey} className="flex flex-col gap-1">
      {options.map((o, i) => (
        <button
          key={o.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="option"
          aria-selected={o.current}
          tabIndex={i === at ? 0 : -1}
          onClick={o.onPick}
          className={
            "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-panel " +
            (o.current
              ? "border-2 border-ink bg-panel font-semibold text-ink"
              : "border-2 border-transparent bg-panel text-ink outline-1 -outline-offset-2 outline-line hover:outline-green")
          }
        >
          {o.tag ? <span className={"shrink-0 " + LABEL + " text-[11px]"}>{o.tag}</span> : null}
          <span className="min-w-0 flex-1 font-mono text-[13px] [overflow-wrap:anywhere]">
            {o.head ? <span className="opacity-70">{o.head} </span> : null}
            {o.title}
          </span>
          {o.count}
        </button>
      ))}
    </div>
  );
}

/** An option's count, `n / N`, red at 0. */
export function Count({ n, total }: { n: number; total: number }) {
  return (
    <span className={"shrink-0 px-1 font-mono text-[12px] tabular-nums " + (n === 0 ? VERDICT_FILL.fail : "text-muted")}>
      {n.toLocaleString("nb-NO")} / {total.toLocaleString("nb-NO")}
    </span>
  );
}

/** Values as they are in the model, with how many elements carry each. */
export function ValueList({ values, bad = false }: { values: readonly { v: string; n: number }[]; bad?: boolean }) {
  if (values.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {values.map((s) => (
        <li key={s.v} className="flex items-baseline gap-3 font-mono text-[12px]">
          <span
            className={
              "min-w-0 flex-1 truncate " + (bad ? "text-ink underline decoration-bad decoration-2 underline-offset-4" : "text-ink")
            }
            title={s.v}
          >
            {s.v}
          </span>
          <span className="shrink-0 tabular-nums text-muted">{s.n.toLocaleString("nb-NO")}</span>
        </li>
      ))}
    </ul>
  );
}
