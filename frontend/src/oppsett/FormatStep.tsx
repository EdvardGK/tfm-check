import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getPreview } from "../api";
import {
  DISCIPLINES, FREETEXT_COLOR, FREETEXT_PREFIX, PART_COLORS, PART_EXAMPLE, PART_TO_DIGITKEY, PART_TYPES, SEP_KEYS,
  SEP_TO_CHAR, freetextValue, isFreetext, sequenceToExample, type Palette,
} from "../constants";
import type { Preset, PreviewValue, RulesDict } from "../types";
import { Canvas, Fig, Lamp, Meter, RailOptions, RailSection, RailTile, StepBar } from "./Shell";
import { useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import { STATSBYGG_PATTERNS, fmt, verdictOf } from "./setup";

export type FormatDraft = Pick<
  RulesDict,
  "patterns" | "part_digits" | "bygningsdel_system" | "komponent_system" | "discipline_key"
>;

const draftOf = (r: RulesDict): FormatDraft => ({
  patterns: r.patterns.map((p) => ({ sequence: [...p.sequence] })),
  part_digits: { ...(r.part_digits ?? {}) },
  bygningsdel_system: r.bygningsdel_system,
  komponent_system: r.komponent_system,
  discipline_key: r.discipline_key,
});

const presetDraft = (p: Preset, cur: FormatDraft): FormatDraft => ({
  ...cur,
  patterns: p.rules.patterns.map((x) => ({ sequence: [...x.sequence] })),
  part_digits: { ...(p.rules.part_digits ?? {}) },
  bygningsdel_system: p.rules.bygningsdel_system ?? cur.bygningsdel_system,
  komponent_system: p.rules.komponent_system ?? cur.komponent_system,
});

const sameForm = (a: FormatDraft, b: FormatDraft) =>
  JSON.stringify(a.patterns) === JSON.stringify(b.patterns) &&
  JSON.stringify(a.part_digits ?? {}) === JSON.stringify(b.part_digits ?? {});

/** The backend's template part names (engine/constants.py PART_TO_TEMPLATE). */
const TEMPLATE_PART: Record<string, string> = {
  lokasjon: "Lokasjon", rom: "Rom", systemkode: "Systemkode", etasje: "Etasje", subnr: "Subnr",
  lopenummer: "Løpenummer", komponent: "Komponent", kompnr: "Komp.nr", typeflag: "T-suffiks",
};

/** What each part takes, in plain terms (engine/constants.py
 *  PLACEHOLDER_FALLBACK); a digit part can be locked to a count. */
const PART_RULE: Record<string, string> = {
  Lokasjon: "6 tegn", Rom: "1–5 siffer", Systemkode: "3 siffer", Etasje: "1–12 tegn", Subnr: "1–4 siffer",
  Løpenummer: "3 siffer", Komponent: "2 bokstaver", "Komp.nr": "3 siffer", "T-suffiks": "T",
};

const paint = (c: Palette) => ({ background: c.bg, color: c.text, boxShadow: `inset 0 0 0 1px ${c.border}` });

/** A value with each part of the form coloured where it falls. */
function Coloured({ v }: { v: PreviewValue }): ReactNode {
  if (!v.ok || v.spans.length === 0) return v.v;
  const spans = [...v.spans].sort((a, b) => a[1] - b[1]);
  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach(([name, a, b], i) => {
    if (a > at) out.push(v.v.slice(at, a));
    const part = TEMPLATE_PART[name];
    out.push(
      <i key={i} style={paint(PART_COLORS[part] ?? FREETEXT_COLOR)} title={part}>
        {v.v.slice(a, b)}
      </i>,
    );
    at = b;
  });
  if (at < v.v.length) out.push(v.v.slice(at));
  return out;
}

type Sel = { pi: number; ti: number } | null;

/** Format: the TFM code form. Band 1: the form as segment chips (pick a
 *  segment to move, drop or lock its digits; the pieces below add one) |
 *  what it takes of the model's values. Band 2: the model's values, each
 *  part coloured where it falls | the values the form does not take. Rail:
 *  the bundled forms, each labelled by its example code, and the
 *  discipline. Every preview is debounced and keyed on the form's JSON; no
 *  effect here sets state on render (the old step froze the renderer). */
export default function FormatStep({
  uploadId,
  rules,
  presets,
  pickBest,
  onUse,
}: {
  uploadId: string;
  rules: RulesDict;
  presets: Preset[];
  /** Egendefinert: pre-pick the bundled form taking most of the values. */
  pickBest: boolean;
  onUse: (patch: FormatDraft) => void;
}) {
  const [draft, setDraft] = useState<FormatDraft>(() => draftOf(rules));
  const [sel, setSel] = useState<Sel>(null);
  const [text, setText] = useState("");
  const touched = useRef(false);

  const edit = (f: (d: FormatDraft) => FormatDraft) => {
    touched.current = true;
    setDraft(f);
  };

  // Egendefinert: once, the bundled form that takes the most values, unless
  // the form was touched first. One batch of requests, cancelled on leave.
  const picked = useRef(!pickBest);
  useEffect(() => {
    if (picked.current || presets.length === 0) return;
    picked.current = true;
    let live = true;
    const base = draftOf(rules);
    Promise.all(presets.map((p) => getPreview(uploadId, { ...rules, ...presetDraft(p, base) }).catch(() => null))).then((res) => {
      if (!live || touched.current) return;
      let best = -1;
      res.forEach((p, i) => {
        if (p && p.matched > 0 && (best < 0 || p.matched > (res[best]?.matched ?? 0))) best = i;
      });
      if (best >= 0) setDraft((d) => presetDraft(presets[best], d));
    });
    return () => {
      live = false;
    };
  }, [presets, uploadId, rules]);

  const previewRules = useMemo(() => ({ ...rules, ...draft }), [rules, draft]);
  const preview = usePreview(uploadId, previewRules);

  const standard = JSON.stringify(draft.patterns.map((p) => p.sequence)) === JSON.stringify(STATSBYGG_PATTERNS);
  useLiveAnswer("format", standard ? "" : draft.patterns.map((p) => sequenceToExample(p.sequence)).join(" | "), standard);

  const current = presets.find((p) => sameForm(draft, presetDraft(p, draft))) ?? null;
  const hasPattern = draft.patterns.some((p) => p.sequence.length > 0);

  // ---- Editing the form ----
  const setPatterns = (f: (ps: string[][]) => string[][]) =>
    edit((d) => ({ ...d, patterns: f(d.patterns.map((p) => [...p.sequence])).map((sequence) => ({ sequence })) }));

  const insert = (token: string) => {
    const pi = sel ? sel.pi : Math.max(0, draft.patterns.length - 1);
    const seq = draft.patterns[pi]?.sequence ?? [];
    const at = sel ? sel.ti + 1 : seq.length;
    setPatterns((ps) => {
      if (ps.length === 0) ps.push([]);
      ps[pi].splice(at, 0, token);
      return ps;
    });
    setSel({ pi, ti: at });
  };
  const remove = () => {
    if (!sel) return;
    setPatterns((ps) => {
      ps[sel.pi].splice(sel.ti, 1);
      return ps;
    });
    const len = draft.patterns[sel.pi].sequence.length - 1;
    setSel(len > 0 ? { pi: sel.pi, ti: Math.min(sel.ti, len - 1) } : null);
  };
  const move = (by: number) => {
    if (!sel) return;
    const to = sel.ti + by;
    if (to < 0 || to >= draft.patterns[sel.pi].sequence.length) return;
    setPatterns((ps) => {
      const [t] = ps[sel.pi].splice(sel.ti, 1);
      ps[sel.pi].splice(to, 0, t);
      return ps;
    });
    setSel({ pi: sel.pi, ti: to });
  };
  const addPattern = () => {
    setPatterns((ps) => [...ps, ["Systemkode", "-", "Komponent"]]);
    setSel(null);
  };
  const dropPattern = (pi: number) => {
    setPatterns((ps) => ps.filter((_, i) => i !== pi));
    setSel(null);
  };

  // The parts the form uses, once each, in order.
  const parts = [...new Set(draft.patterns.flatMap((p) => p.sequence))].filter((t) => t in PART_RULE);
  const setDigits = (key: string, value: string) =>
    edit((d) => {
      const pd = { ...(d.part_digits ?? {}) };
      if (value === "") delete pd[key];
      else pd[key] = Number(value);
      return { ...d, part_digits: pd };
    });

  const values = preview?.values;
  const valueRows = useMemo(
    () =>
      (values ?? []).map((v) => (
        <div key={v.v} className="lrow rule">
          <Lamp verdict={v.ok ? "ok" : "fail"} />
          <span className="cv ell" title={v.v}>
            <Coloured v={v} />
          </span>
          <span className="num sub">{fmt(v.n)}</span>
        </div>
      )),
    [values],
  );

  const countable = preview?.countable ?? false;
  const matched = preview?.matched ?? 0;
  const valued = preview?.valued ?? 0;
  const verdict = verdictOf(matched, valued);

  const segment = (t: string, pi: number, ti: number) => {
    const pressed = sel?.pi === pi && sel.ti === ti;
    const onClick = () => setSel(pressed ? null : { pi, ti });
    if (t in SEP_TO_CHAR) {
      return (
        <button key={ti} type="button" className="seg sep" aria-pressed={pressed} onClick={onClick} title={t}>
          <span className="sx">{SEP_TO_CHAR[t] === " " ? "␣" : SEP_TO_CHAR[t]}</span>
        </button>
      );
    }
    const free = isFreetext(t);
    const c = free ? FREETEXT_COLOR : (PART_COLORS[t] ?? FREETEXT_COLOR);
    const dk = PART_TO_DIGITKEY[t];
    const digits = dk ? draft.part_digits?.[dk] : undefined;
    return (
      <button key={ti} type="button" className="seg" aria-pressed={pressed} onClick={onClick} style={paint(c)}>
        <span className="sn">{free ? "Tekst" : digits ? `${t} · ${digits}` : t}</span>
        <span className="sx">{free ? freetextValue(t) || "–" : (PART_EXAMPLE[t] ?? t)}</span>
      </button>
    );
  };

  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" disabled={!hasPattern} onClick={() => onUse(draft)}>
          Bruk
        </button>
      </StepBar>

      <RailOptions>
        <RailSection label="Format">
          {presets.map((p) => (
            <RailTile
              key={p.id}
              title={p.id === "pa0802" ? "Statsbygg" : undefined}
              example={p.example}
              pressed={current?.id === p.id}
              onClick={() => {
                edit((d) => presetDraft(p, d));
                setSel(null);
              }}
            />
          ))}
        </RailSection>
        <RailSection label="Disiplin">
          <div className="rchips">
            {DISCIPLINES.map((d) => (
              <button
                key={d.key}
                type="button"
                className="mini"
                title={d.label}
                aria-pressed={draft.discipline_key === d.key}
                onClick={() => edit((x) => ({ ...x, discipline_key: d.key }))}
              >
                {d.key}
              </button>
            ))}
          </div>
        </RailSection>
      </RailOptions>

      <section className="tile card major" aria-label="Format">
        <span className="lbl">{current ? current.label : "Egendefinert"}</span>
        <div className="pats">
          {draft.patterns.map((p, pi) => (
            <div key={pi} className="pat">
              {p.sequence.map((t, ti) => segment(t, pi, ti))}
              {draft.patterns.length > 1 ? (
                <button type="button" className="seg add" aria-label="Fjern mønster" title="Fjern mønster" onClick={() => dropPattern(pi)}>
                  ✕
                </button>
              ) : null}
              {pi === draft.patterns.length - 1 ? (
                <button type="button" className="seg add" aria-label="Nytt mønster" title="Nytt mønster" onClick={addPattern}>
                  +
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="segtools">
          <button type="button" className="mini" disabled={!sel || sel.ti === 0} onClick={() => move(-1)} aria-label="Flytt til venstre">
            ‹
          </button>
          <button
            type="button"
            className="mini"
            disabled={!sel || sel.ti >= (draft.patterns[sel.pi]?.sequence.length ?? 0) - 1}
            onClick={() => move(1)}
            aria-label="Flytt til høyre"
          >
            ›
          </button>
          <button type="button" className="mini" disabled={!sel} onClick={remove} aria-label="Fjern">
            ✕
          </button>
        </div>
        <div className="palette">
          {PART_TYPES.map((t) => (
            <button key={t} type="button" className="mini" style={paint(PART_COLORS[t])} onClick={() => insert(t)}>
              + {t}
            </button>
          ))}
        </div>
        <div className="palette">
          {SEP_KEYS.map((k) => (
            <button key={k} type="button" className="mini mono" onClick={() => insert(k)} title={k}>
              {SEP_TO_CHAR[k] === " " ? "␣" : SEP_TO_CHAR[k]}
            </button>
          ))}
          <form
            className="palette"
            onSubmit={(e) => {
              e.preventDefault();
              if (text) insert(FREETEXT_PREFIX + text);
              setText("");
            }}
          >
            <input className="field mono" value={text} onChange={(e) => setText(e.target.value)} aria-label="Tekst" size={8} />
            <button type="submit" className="mini" disabled={!text}>
              + Tekst
            </button>
          </form>
        </div>
        <div className="systems">
          <button
            type="button"
            className="mini"
            aria-pressed={draft.bygningsdel_system === "NS3451"}
            onClick={() => edit((d) => ({ ...d, bygningsdel_system: d.bygningsdel_system === "NS3451" ? "Ingen" : "NS3451" }))}
          >
            NS 3451
          </button>
          <button
            type="button"
            className="mini"
            aria-pressed={draft.komponent_system === "IEC81346"}
            onClick={() => edit((d) => ({ ...d, komponent_system: d.komponent_system === "IEC81346" ? "Ingen" : "IEC81346" }))}
          >
            IEC 81346
          </button>
        </div>
      </section>

      <section className="tile card minor ev" aria-label="Treff">
        <div className="figs">
          <div>
            <span className="lbl">Treff</span>
            <Fig n={preview && countable ? matched : null} total={preview && countable ? valued : null} verdict={verdict} />
            <Meter n={matched} total={valued} verdict={verdict} />
          </div>
          <div>
            <span className="lbl">Avvik</span>
            <Fig n={preview && countable ? valued - matched : null} total={null} />
          </div>
        </div>
        <span className="lbl">Deler</span>
        <div className="parts">
          {parts.map((t) => {
            const dk = PART_TO_DIGITKEY[t];
            return (
              <div key={t} className="prow rule">
                <span className="sw" style={paint(PART_COLORS[t] ?? FREETEXT_COLOR)}>
                  {t}
                </span>
                {dk ? (
                  <select className="field" aria-label={`${t} siffer`} value={String(draft.part_digits?.[dk] ?? "")} onChange={(e) => setDigits(dk, e.target.value)}>
                    <option value="">{PART_RULE[t]}</option>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} {t === "Lokasjon" ? "tegn" : "siffer"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="sub">{PART_RULE[t]}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="tile card major vals" aria-label="Verdier">
        <div className="lh">
          <span className="lbl">Verdier</span>
          <span className="lbl num">{preview && countable ? `${fmt(preview.distinct)} ulike` : ""}</span>
        </div>
        <div className="scroll">{valueRows}</div>
      </section>

      <section className="tile card minor vals" aria-label="Avvik">
        <div className="lh">
          <span className="lbl">Avvik</span>
          <span className="lbl num">{preview && countable ? `${fmt(preview.off_distinct)} ulike` : ""}</span>
        </div>
        <div className="scroll">
          {(preview?.off ?? []).map((o) => (
            <div key={o.v} className="offrow rule">
              <Lamp verdict="fail" />
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="mono ell" title={o.v}>
                  {o.v}
                </span>
                {o.reason ? <span className="why">{o.reason}</span> : null}
                {o.fix ? <span className="fix">→ {o.fix}</span> : null}
              </span>
              <span className="num sub">{fmt(o.n)}</span>
            </div>
          ))}
        </div>
      </section>
    </Canvas>
  );
}
