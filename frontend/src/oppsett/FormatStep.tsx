import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { getPreview } from "../api";
import {
  DISCIPLINES, FREETEXT_COLOR, FREETEXT_PREFIX, PART_COLORS, PART_EXAMPLE, PART_TO_DIGITKEY, PART_TYPES, SEP_KEYS,
  SEP_TO_CHAR, freetextValue, isFreetext, sequenceToExample, type Palette,
} from "../constants";
import type { PartRule, Preset, PreviewValue, RulesDict } from "../types";
import { Canvas, Fig, Lamp, Meter, RailOptions, RailSection, RailTile, StepBar } from "./Shell";
import { useLiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import { STATSBYGG_PATTERNS, fmt, verdictOf } from "./setup";

export type FormatDraft = Pick<
  RulesDict,
  "patterns" | "part_digits" | "part_rules" | "part_links" | "bygningsdel_system" | "komponent_system" | "discipline_key"
>;

const draftOf = (r: RulesDict): FormatDraft => ({
  patterns: r.patterns.map((p) => ({ sequence: [...p.sequence] })),
  part_digits: { ...(r.part_digits ?? {}) },
  part_rules: { ...(r.part_rules ?? {}) },
  part_links: { ...(r.part_links ?? {}) },
  bygningsdel_system: r.bygningsdel_system,
  komponent_system: r.komponent_system,
  discipline_key: r.discipline_key,
});

const presetDraft = (p: Preset, cur: FormatDraft): FormatDraft => ({
  ...cur,
  patterns: p.rules.patterns.map((x) => ({ sequence: [...x.sequence] })),
  part_digits: { ...(p.rules.part_digits ?? {}) },
  part_rules: {},
  part_links: {},
  bygningsdel_system: p.rules.bygningsdel_system ?? cur.bygningsdel_system,
  komponent_system: p.rules.komponent_system ?? cur.komponent_system,
});

const sameForm = (a: FormatDraft, b: FormatDraft) =>
  JSON.stringify(a.patterns) === JSON.stringify(b.patterns) &&
  JSON.stringify(a.part_digits ?? {}) === JSON.stringify(b.part_digits ?? {}) &&
  JSON.stringify(a.part_rules ?? {}) === JSON.stringify(b.part_rules ?? {});

/** The backend's template part names (engine/constants.py PART_TO_TEMPLATE). */
const TEMPLATE_PART: Record<string, string> = {
  lokasjon: "Lokasjon", rom: "Rom", systemkode: "Systemkode", etasje: "Etasje", subnr: "Subnr",
  lopenummer: "Løpenummer", komponent: "Komponent", kompnr: "Komp.nr", typeflag: "T-suffiks",
  omrade: "Område", linje: "Linje", sloyfe: "Sløyfe", adresse: "Adresse 2", typekode: "Typekode", typenr: "Typenr",
  instansnr: "Instansnr",
};
const PART_KEY: Record<string, string> = Object.fromEntries(Object.entries(TEMPLATE_PART).map(([k, v]) => [v, k]));

/** What each part takes, in plain terms (engine/constants.py
 *  PLACEHOLDER_FALLBACK); a digit part can be locked to a count. */
const PART_RULE: Record<string, string> = {
  Lokasjon: "6 tegn", Rom: "1–5 siffer", Systemkode: "3 siffer", Etasje: "1–12 tegn", Subnr: "1–4 siffer",
  Løpenummer: "3 siffer", Komponent: "2 bokstaver", "Komp.nr": "3 siffer", "T-suffiks": "T",
  "Område": "1–2 siffer", Linje: "1–2 siffer", "Sløyfe": "2 siffer", "Adresse 2": "3 siffer",
  Typekode: "1–3 bokstaver", Typenr: "3 siffer", Instansnr: "2 siffer",
};

/** The standards a part can be linked to (backend engine/standards.py). */
const COMPONENT_LISTS: [string, string][] = [["NS3457-8", "NS 3457-8"], ["PA0802", "PA 0802"], ["IEC81346", "IEC 81346"]];
/** Typekode links through part_links; the field is the part's key. */
const LINKS: Record<string, { field: "bygningsdel_system" | "komponent_system" | "typekode"; options: [string, string][] }> = {
  Typekode: { field: "typekode", options: [...COMPONENT_LISTS, ["Ingen", "–"]] },
  Systemkode: { field: "bygningsdel_system", options: [["NS3451", "NS 3451"], ["Ingen", "–"]] },
  Komponent: {
    field: "komponent_system",
    options: [["NS3457-8", "NS 3457-8"], ["PA0802", "PA 0802"], ["IEC81346", "IEC 81346"], ["Ingen", "–"]],
  },
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
    const part = TEMPLATE_PART[name.split("__")[0]];
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

/** One part's rule: its standard form (or a length lock), a pattern, a
 *  fixed value or a list of accepted values; and, for Systemkode and
 *  Komponent, the standard it is checked against. */
function PartRow({
  part,
  draft,
  edit,
}: {
  part: string;
  draft: FormatDraft;
  edit: (f: (d: FormatDraft) => FormatDraft) => void;
}) {
  const key = PART_KEY[part];
  const rule = draft.part_rules?.[key];
  const dk = PART_TO_DIGITKEY[part];
  const digits = dk ? draft.part_digits?.[dk] : undefined;
  const mode = rule ? rule.kind : digits ? `n:${digits}` : "";
  const [text, setText] = useState(() =>
    rule?.kind === "pattern" ? rule.pattern : rule?.kind === "value" ? rule.value : rule?.kind === "list" ? rule.values.join(", ") : "",
  );

  const setRule = (r: PartRule | null) =>
    edit((d) => {
      const pr = { ...(d.part_rules ?? {}) };
      if (r) pr[key] = r;
      else delete pr[key];
      return { ...d, part_rules: pr };
    });
  const ruleOf = (kind: string, t: string): PartRule | null => {
    if (kind === "pattern") return t.trim() ? { kind, pattern: t.trim() } : null;
    if (kind === "value") return t !== "" ? { kind, value: t.trim() } : null;
    if (kind === "list") {
      const values = t.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
      return values.length ? { kind, values } : null;
    }
    return null;
  };
  // A kind picked with nothing typed yet is held here until the first entry.
  const [pending, setPending] = useState<string | null>(null);
  const shown = pending ?? mode;

  const onMode = (m: string) => {
    if (m.startsWith("n:") || m === "") {
      setPending(null);
      setRule(null);
      edit((d) => {
        const pd = { ...(d.part_digits ?? {}) };
        if (dk) {
          if (m === "") delete pd[dk];
          else pd[dk] = Number(m.slice(2));
        }
        return { ...d, part_digits: pd };
      });
      return;
    }
    const r = ruleOf(m, text);
    if (r) {
      setPending(null);
      setRule(r);
    } else {
      setPending(m);
      setRule(null);
    }
  };
  const onText = (t: string) => {
    setText(t);
    const kind = shown;
    if (kind === "pattern" || kind === "value" || kind === "list") {
      const r = ruleOf(kind, t);
      setRule(r);
      if (r) setPending(null);
      else setPending(kind);
    }
  };

  const link = LINKS[part];
  const unit = part === "Lokasjon" ? "tegn" : "siffer";
  return (
    <div className="prow rule">
      <span className="sw" style={paint(PART_COLORS[part] ?? FREETEXT_COLOR)}>
        {part}
      </span>
      <span className="pr">
        <select className="field" aria-label={`${part} regel`} value={shown} onChange={(e) => onMode(e.target.value)}>
          <option value="">{PART_RULE[part]}</option>
          {dk
            ? [1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={`n:${n}`}>
                  {n} {unit}
                </option>
              ))
            : null}
          <option value="pattern">Mønster</option>
          <option value="value">Verdi</option>
          <option value="list">Liste</option>
        </select>
        {shown === "pattern" || shown === "value" || shown === "list" ? (
          <input
            className="field mono"
            aria-label={`${part} ${shown === "pattern" ? "mønster" : shown === "value" ? "verdi" : "liste"}`}
            value={text}
            onChange={(e) => onText(e.target.value)}
          />
        ) : null}
        {link ? (
          <select
            className="field"
            aria-label={`${part} standard`}
            value={link.field === "typekode" ? (draft.part_links?.typekode ?? "Ingen") : draft[link.field]}
            onChange={(e) => {
              const v = e.target.value;
              if (link.field === "typekode") {
                edit((d) => {
                  const pl = { ...(d.part_links ?? {}) };
                  if (v === "Ingen") delete pl.typekode;
                  else pl.typekode = v;
                  return { ...d, part_links: pl };
                });
              } else edit((d) => ({ ...d, [link.field]: v }));
            }}
          >
            {link.options.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        ) : null}
      </span>
    </div>
  );
}

type Sel = { pi: number; ti: number } | null;
type Drag = { pi: number; ti: number } | { token: string };
type Drop = { pi: number; at: number } | null;

/** Format: the TFM code form. Band 1: the form as segment chips (drag a
 *  segment, or a piece from below, to where it goes; or pick a segment and
 *  move it with ‹ ›, and click a piece to add it after the picked one) |
 *  what it takes of the model's values, and each part's rule. Band 2: the
 *  model's values, each part coloured where it falls | the values the form
 *  does not take, with why and the fix. Rail: the bundled forms and the
 *  discipline. Every preview is debounced and keyed on the form's JSON. */
export default function FormatStep({
  uploadId,
  rules,
  presets,
  pickBest,
  onUse,
}: {
  /** null while the model is still being read: the form is built all the
   *  same, its evidence comes when the model does. */
  uploadId: string | null;
  rules: RulesDict;
  presets: Preset[];
  /** Egendefinert: pre-pick the bundled form taking most of the values. */
  pickBest: boolean;
  onUse: (patch: FormatDraft) => void;
}) {
  const [draft, setDraft] = useState<FormatDraft>(() => draftOf(rules));
  const [sel, setSel] = useState<Sel>(null);
  const [text, setText] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [formKey, setFormKey] = useState(0);
  const touched = useRef(false);

  const edit = (f: (d: FormatDraft) => FormatDraft) => {
    touched.current = true;
    setDraft(f);
  };

  // Egendefinert: once, the bundled form that takes the most values, unless
  // the form was touched first. One batch of requests, cancelled on leave.
  const picked = useRef(!pickBest);
  useEffect(() => {
    if (picked.current || presets.length === 0 || !uploadId) return;
    picked.current = true;
    let live = true;
    const base = draftOf(rules);
    Promise.all(presets.map((p) => getPreview(uploadId, { ...rules, ...presetDraft(p, base) }).catch(() => null))).then((res) => {
      if (!live || touched.current) return;
      let best = -1;
      res.forEach((p, i) => {
        if (p && p.matched > 0 && (best < 0 || p.matched > (res[best]?.matched ?? 0))) best = i;
      });
      if (best >= 0) {
        setDraft((d) => presetDraft(presets[best], d));
        setFormKey((k) => k + 1);
      }
    });
    return () => {
      live = false;
    };
  }, [presets, uploadId, rules]);

  const previewRules = useMemo(() => ({ ...rules, ...draft }), [rules, draft]);
  const preview = usePreview(uploadId, previewRules);

  const standard =
    JSON.stringify(draft.patterns.map((p) => p.sequence)) === JSON.stringify(STATSBYGG_PATTERNS) &&
    Object.keys(draft.part_rules ?? {}).length === 0;
  useLiveAnswer("format", standard ? "" : draft.patterns.map((p) => sequenceToExample(p.sequence)).join(" | "), standard);

  const current = presets.find((p) => sameForm(draft, presetDraft(p, draft))) ?? null;
  const hasPattern = draft.patterns.some((p) => p.sequence.length > 0);

  // ---- Editing the form ----
  const setPatterns = (f: (ps: string[][]) => string[][]) =>
    edit((d) => ({ ...d, patterns: f(d.patterns.map((p) => [...p.sequence])).map((sequence) => ({ sequence })) }));

  /** Put a token (new, or moved from its place) at `at` in pattern `pi`. */
  const place = (src: Drag, pi: number, at: number) => {
    let to = at;
    if (!("token" in src) && src.pi === pi && src.ti < at) to -= 1;
    if (!("token" in src) && src.pi === pi && src.ti === to) return;
    setPatterns((ps) => {
      if (ps.length === 0) ps.push([]);
      let tok: string;
      if ("token" in src) tok = src.token;
      else [tok] = ps[src.pi].splice(src.ti, 1);
      ps[pi].splice(Math.max(0, Math.min(to, ps[pi].length)), 0, tok);
      return ps;
    });
    setSel({ pi, ti: to });
  };

  const insert = (token: string) => {
    const pi = sel ? sel.pi : Math.max(0, draft.patterns.length - 1);
    const seq = draft.patterns[pi]?.sequence ?? [];
    place({ token }, pi, sel ? sel.ti + 1 : seq.length);
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
    place(sel, sel.pi, by > 0 ? to + 1 : to);
  };
  const addPattern = () => {
    setPatterns((ps) => [...ps, ["Systemkode", "-", "Komponent"]]);
    setSel(null);
  };
  const dropPattern = (pi: number) => {
    setPatterns((ps) => ps.filter((_, i) => i !== pi));
    setSel(null);
  };

  // ---- Drag and drop ----
  const startDrag = (src: Drag) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "token" in src ? src.token : "segment");
    setDrag(src);
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };
  /** Over a segment: before it on its left half, after it on its right. */
  const overSegment = (pi: number, ti: number) => (e: DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = e.clientX < r.left + r.width / 2 ? ti : ti + 1;
    if (drop?.pi !== pi || drop.at !== at) setDrop({ pi, at });
  };
  const overEnd = (pi: number) => (e: DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    const at = draft.patterns[pi]?.sequence.length ?? 0;
    if (drop?.pi !== pi || drop.at !== at) setDrop({ pi, at });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag && drop) place(drag, drop.pi, drop.at);
    endDrag();
  };

  // The parts the form uses, once each, in order.
  const parts = [...new Set(draft.patterns.flatMap((p) => p.sequence))].filter((t) => t in PART_RULE);

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
    const mark = drop?.pi === pi ? (drop.at === ti ? "before" : drop.at === ti + 1 ? "after" : undefined) : undefined;
    const dnd = {
      draggable: true,
      onDragStart: startDrag({ pi, ti }),
      onDragEnd: endDrag,
      onDragOver: overSegment(pi, ti),
      onDrop,
      "data-drop": mark,
      "data-dragging": drag !== null && "pi" in drag && drag.pi === pi && drag.ti === ti ? true : undefined,
    };
    if (t in SEP_TO_CHAR) {
      return (
        <button key={ti} type="button" className="seg sep" aria-pressed={pressed} onClick={onClick} title={t} {...dnd}>
          <span className="sx">{SEP_TO_CHAR[t] === " " ? "␣" : SEP_TO_CHAR[t]}</span>
        </button>
      );
    }
    const free = isFreetext(t);
    const c = free ? FREETEXT_COLOR : (PART_COLORS[t] ?? FREETEXT_COLOR);
    const dk = PART_TO_DIGITKEY[t];
    const digits = dk ? draft.part_digits?.[dk] : undefined;
    const own = draft.part_rules?.[PART_KEY[t]];
    const ex = own?.kind === "value" ? own.value : own?.kind === "list" ? own.values[0] : (PART_EXAMPLE[t] ?? t);
    return (
      <button key={ti} type="button" className="seg" aria-pressed={pressed} onClick={onClick} style={paint(c)} {...dnd}>
        <span className="sn">{free ? "Tekst" : digits ? `${t} · ${digits}` : t}</span>
        <span className="sx">{free ? freetextValue(t) || "–" : ex}</span>
      </button>
    );
  };

  const piece = (token: string, label: ReactNode, style?: React.CSSProperties, cls = "mini") => (
    <button
      key={token}
      type="button"
      className={cls}
      style={style}
      draggable
      onDragStart={startDrag({ token })}
      onDragEnd={endDrag}
      onClick={() => insert(token)}
      title={token}
    >
      {label}
    </button>
  );

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
                setFormKey((k) => k + 1);
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
            <div key={pi} className="pat" onDragOver={overEnd(pi)} onDrop={onDrop}>
              {p.sequence.map((t, ti) => segment(t, pi, ti))}
              {drag && drop?.pi === pi && drop.at === p.sequence.length ? <span className="dropmark" /> : null}
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
        <div className="palette">{PART_TYPES.map((t) => piece(t, `+ ${t}`, paint(PART_COLORS[t])))}</div>
        <div className="palette">
          {SEP_KEYS.map((k) => piece(k, SEP_TO_CHAR[k] === " " ? "␣" : SEP_TO_CHAR[k], undefined, "mini mono"))}
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
        <div className="parts scroll">
          {parts.map((t) => (
            <PartRow key={`${t}-${formKey}`} part={t} draft={draft} edit={edit} />
          ))}
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
