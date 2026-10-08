import { Fragment, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getPreview } from "../api";
import {
  DISCIPLINES, FREETEXT_COLOR, FREETEXT_PREFIX, PART_COLORS, PART_EXAMPLE, PART_TO_DIGITKEY, PART_TYPES, SEP_KEYS,
  SEP_COLOR, SEP_TO_CHAR, KIND_LABEL, NUMBER_ROLES, PART_KIND, PART_TECH, blockOf, configToken, fixedToken, listToken,
  partLabel, sequenceToExample, type Palette,
} from "../constants";
import type { PartRule, Preset, RulesDict } from "../types";
import { Canvas, RailOptions, RailSection, RailTile, StepBar } from "./Shell";
import { useLiveAnswer } from "./live";
import { STATSBYGG_PATTERNS } from "./setup";

export type FormatDraft = Pick<
  RulesDict,
  | "patterns"
  | "part_digits"
  | "part_rules"
  | "part_links"
  | "part_labels"
  | "bygningsdel_system"
  | "komponent_system"
  | "discipline_key"
>;

const draftOf = (r: RulesDict): FormatDraft => ({
  patterns: r.patterns.map((p) => ({ sequence: [...p.sequence] })),
  part_digits: { ...(r.part_digits ?? {}) },
  part_rules: { ...(r.part_rules ?? {}) },
  part_links: { ...(r.part_links ?? {}) },
  part_labels: { ...(r.part_labels ?? {}) },
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
  instansnr: "Instansnr", kode: "Kode", nummer: "Nummer", typeundernr: "Typeundernr",
};
const PART_KEY: Record<string, string> = Object.fromEntries(Object.entries(TEMPLATE_PART).map(([k, v]) => [v, k]));

const paint = (c: Palette) => ({ background: c.bg, color: c.text, boxShadow: `inset 0 0 0 1px ${c.border}` });

/** Each part's form when no rule is set (engine/constants.py
 *  PLACEHOLDER_FALLBACK). */
const DEFAULT_FORM: Record<string, string> = {
  lokasjon: "[A-Za-z0-9]{6}", rom: "\\d{1,5}", systemkode: "\\d{3}", etasje: "[A-Za-z0-9æøåÆØÅ_\\- ]{1,12}",
  subnr: "\\d{1,4}", lopenummer: "\\d{3}", komponent: "[A-Z]{2}", kompnr: "\\d{3}", typeflag: "T?",
  omrade: "\\d{1,2}", linje: "\\d{1,2}", sloyfe: "\\d{2}", adresse: "\\d{3}", typekode: "[A-ZÆØÅ]{1,3}",
  typenr: "\\d{3}", instansnr: "\\d{2}", kode: "\\S+", nummer: "\\d{1,6}", typeundernr: "\\d{1,3}",
};

/** Mønster in plain words: the regex shown under the pick. */
export const PATTERN_PRESETS: [string, string][] = [
  ["1 siffer", "\\d"], ["2 siffer", "\\d{2}"], ["3 siffer", "\\d{3}"], ["4 siffer", "\\d{4}"],
  ["5 siffer", "\\d{5}"], ["6 siffer", "\\d{6}"], ["1–2 siffer", "\\d{1,2}"], ["1–3 siffer", "\\d{1,3}"],
  ["1–4 siffer", "\\d{1,4}"], ["1–5 siffer", "\\d{1,5}"], ["1–6 siffer", "\\d{1,6}"],
  ["1 bokstav (A–Z)", "[A-Z]"], ["2 bokstaver (A–Z)", "[A-Z]{2}"], ["3 bokstaver (A–Z)", "[A-Z]{3}"],
  ["1–3 bokstaver", "[A-ZÆØÅ]{1,3}"], ["2 tegn", "[A-Za-z0-9]{2}"], ["3 tegn", "[A-Za-z0-9]{3}"],
  ["4 tegn", "[A-Za-z0-9]{4}"], ["6 tegn", "[A-Za-z0-9]{6}"], ["1–12 tegn", "[A-Za-z0-9æøåÆØÅ_\\- ]{1,12}"],
  ["T eller ingenting", "T?"], ["Hele koden", "\\S+"],
];
/** For a separator block given as a pattern (older files). */
export const BLOCK_PRESETS: [string, string][] = [["Ett av . - _ / ␣", "[.\\-_/ ]"]];

/** The standard lists a part can take as its data type. */
const STANDARD_LISTS: [string, string][] = [
  ["NS3451", "NS 3451"], ["NS3457-8", "NS 3457-8"], ["PA0802", "PA 0802"], ["IEC81346", "IEC 81346"],
];
const LISTS_FOR: Record<string, string[]> = {
  systemkode: ["NS3451"],
  komponent: ["NS3457-8", "PA0802", "IEC81346"],
  typekode: ["NS3457-8", "PA0802", "IEC81346"],
};

type DataType = "value" | "list" | "pattern";

/** The rule a plain part block reads with from an older ruleset: its
 *  part_rules, a length lock, an older standard link, or the default form. */
function legacyRule(d: FormatDraft, part: string): PartRule {
  const key = PART_KEY[part];
  const own = key ? d.part_rules?.[key] : undefined;
  if (own) return own;
  if (key === "systemkode" && d.bygningsdel_system === "NS3451") return { kind: "standard", standard: "NS3451" };
  if (key === "komponent" && d.komponent_system && d.komponent_system !== "Ingen")
    return { kind: "standard", standard: d.komponent_system };
  if (key && d.part_links?.[key]) return { kind: "standard", standard: d.part_links[key] };
  const dk = PART_TO_DIGITKEY[part];
  const n = dk ? d.part_digits?.[dk] : undefined;
  if (n) return { kind: "pattern", pattern: key === "lokasjon" ? `[A-Za-z0-9]{${n}}` : `\\d{${n}}` };
  return { kind: "pattern", pattern: DEFAULT_FORM[key ?? ""] ?? "\\S+" };
}

/** A part block's config: what it represents, its rule, its own name. */
interface PartConfig {
  part: string;
  rule: PartRule;
  label: string;
}

function partConfig(token: string, d: FormatDraft): PartConfig | null {
  const b = blockOf(token);
  if (!b || b.kind !== "part") return null;
  return { part: b.part, rule: b.rule ?? legacyRule(d, b.part), label: b.label ?? "" };
}

/** A block's name, example value and technical key, as its chip shows them. */
function blockView(token: string, d: FormatDraft): { name: string; ex: string; tech: string; part: boolean } {
  const b = blockOf(token);
  if (!b) return { name: "", ex: "", tech: "", part: false };
  if (b.kind === "fixed") return { name: "", ex: b.text, tech: "", part: false };
  if (b.kind === "list") return { name: "", ex: b.values.join(" "), tech: "", part: false };
  if (b.kind === "pattern") return { name: "", ex: `/${b.rx}/`, tech: "", part: false };
  const c = partConfig(token, d);
  const own = c?.label ?? "";
  const generic = b.part === "Nummer";
  return {
    name: own || partLabel(b.part, d.part_labels),
    ex: c ? ruleExample(b.part, c.rule) : "",
    tech: generic ? "" : (PART_TECH[b.part] ?? ""),
    part: true,
  };
}

/** An example value fitting a rule. */
function ruleExample(part: string, rule: PartRule): string {
  if (rule.kind === "value") return rule.value;
  if (rule.kind === "list") return rule.values[0] ?? "";
  const ex = PART_EXAMPLE[part] ?? "";
  if (rule.kind === "standard") return ex;
  const rx = rule.pattern;
  try {
    if (new RegExp(`^(?:${rx})$`).test(ex)) return ex;
  } catch {
    return ex;
  }
  const m = /^\\d(?:\{(\d+)(?:,\d+)?\})?$/.exec(rx);
  if (m) return "1".padStart(Number(m[1] ?? 1), "0");
  const l = /^\[A-Z[^\]]*\](?:\{(\d+)(?:,\d+)?\})?$/.exec(rx);
  if (l) return "ABCDEF".slice(0, Number(l[1] ?? 1));
  const c = /^\[A-Za-z0-9\](?:\{(\d+)\})?$/.exec(rx);
  if (c) return "1".padStart(Number(c[1] ?? 1), "0");
  return ex;
}

/** A variant as it reads: each block an example value. */
function exampleString(seq: string[], d: FormatDraft): string {
  return seq.map((t) => (blockOf(t)?.kind === "pattern" ? "…" : blockView(t, d).ex.split(" ")[0])).join("");
}

/** A variant with each part's technical key (its name where it has none). */
function techString(seq: string[], d: FormatDraft): string {
  return seq
    .map((t) => {
      const v = blockView(t, d);
      if (!v.part) return blockOf(t)?.kind === "pattern" ? "…" : v.ex.split(" ")[0];
      return v.tech || v.name;
    })
    .join("");
}

const show = (t: string) => (t === " " ? "␣" : t);

/** One block's dropdown: everything it is. A part: what it represents (a
 *  number: one of the number parts, or its own name), its name, its data
 *  type by kind (Klassifikasjon: Liste / Fast verdi; Løpenummer: digits;
 *  Skilletegn: Fast verdi) with the list, preset or value. Any other block:
 *  Fast verdi or a Liste of accepted values. A change writes the block. */
function BlockConfig({ token, draft, onToken }: { token: string; draft: FormatDraft; onToken: (t: string) => void }) {
  const b = blockOf(token);
  const c = partConfig(token, draft);
  const [label, setLabel] = useState(c?.label ?? "");
  const [text, setText] = useState(
    c?.rule.kind === "value" ? c.rule.value : c?.rule.kind === "list" ? c.rule.values.join(", ") : b?.kind === "fixed" ? b.text : "",
  );
  const cp = c?.rule.kind === "pattern" ? c.rule.pattern : null;
  const [custom, setCustom] = useState(cp !== null && !PATTERN_PRESETS.some(([, r]) => r === cp) ? cp : "");

  if (!b) return null;

  // ---- A block that is not a part: a fixed value, accepted values, a pattern.
  if (!c || b.kind !== "part") {
    const values = b.kind === "list" ? b.values : b.kind === "fixed" ? [b.text] : [];
    const type: DataType = b.kind === "list" ? "list" : b.kind === "pattern" ? "pattern" : "value";
    const toggle = (ch: string) => {
      const next = values.includes(ch) ? values.filter((v) => v !== ch) : [...values, ch];
      if (next.length) onToken(listToken(next));
    };
    return (
      <span className="cfg">
        <span className="cfgrow">
          <span className="lbl">Datatype</span>
          <select
            className="field"
            value={type}
            onChange={(e) => {
              const t = e.target.value as DataType;
              if (t === "value") onToken(fixedToken(values[0] || text || "."));
              else if (t === "list") onToken(listToken(values.length ? values : ["."]));
            }}
          >
            <option value="value">Fast verdi</option>
            <option value="list">Liste</option>
            {type === "pattern" ? <option value="pattern">Mønster</option> : null}
          </select>
        </span>
        {type === "value" ? (
          <input
            className="field mono"
            aria-label="Verdi"
            value={text}
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value !== "") onToken(fixedToken(e.target.value));
            }}
          />
        ) : null}
        {type === "list" ? (
          <span className="rchips">
            {Object.values(SEP_TO_CHAR).map((ch) => (
              <button key={ch} type="button" className="mini mono" aria-pressed={values.includes(ch)} onClick={() => toggle(ch)}>
                {show(ch)}
              </button>
            ))}
          </span>
        ) : null}
        {type === "pattern" && b.kind === "pattern" ? <span className="rx mono">{b.rx}</span> : null}
      </span>
    );
  }

  // ---- A part.
  const kind = PART_KIND[c.part] ?? "klassifikasjon";
  const key = PART_KEY[c.part] ?? "";
  const write = (p: Partial<PartConfig>) => {
    const next = { ...c, ...p };
    const d: Record<string, unknown> = { p: next.part, r: next.rule };
    if (next.label.trim()) d.l = next.label.trim();
    onToken(configToken(d));
  };
  const type: DataType = c.rule.kind === "value" ? "value" : c.rule.kind === "pattern" ? "pattern" : "list";
  const types: DataType[] = kind === "klassifikasjon" ? ["list", "value"] : kind === "lopenummer" ? ["pattern"] : ["value"];
  if (!types.includes(type)) types.push(type);
  const presets = kind === "lopenummer" ? PATTERN_PRESETS.filter(([, rx]) => rx.startsWith("\\d")) : PATTERN_PRESETS;
  const listKey = c.rule.kind === "standard" ? c.rule.standard : "";
  const pick = c.rule.kind === "pattern" ? (presets.some(([, r]) => r === (c.rule as { pattern: string }).pattern) ? c.rule.pattern : "custom") : "";
  const ownValues = (t: string) => t.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);

  return (
    <span className="cfg">
      <span className="cfghead">
        <span className="t">{label.trim() || partLabel(c.part, draft.part_labels)}</span>
        {c.part !== "Nummer" && PART_TECH[c.part] ? <span className="tech">{PART_TECH[c.part]}</span> : null}
      </span>
      {kind === "lopenummer" ? (
        <span className="cfgrow">
          <span className="lbl">Representerer</span>
          <select className="field" value={c.part} onChange={(e) => write({ part: e.target.value })}>
            <option value="Nummer">–</option>
            {NUMBER_ROLES.map((t) => (
              <option key={t} value={t}>
                {partLabel(t)}
                {PART_TECH[t] ? ` · ${PART_TECH[t]}` : ""}
              </option>
            ))}
          </select>
        </span>
      ) : null}
      <span className="cfgrow">
        <span className="lbl">Navn</span>
        <input
          className="field"
          value={label}
          placeholder={partLabel(c.part)}
          onChange={(e) => {
            setLabel(e.target.value);
            write({ label: e.target.value });
          }}
        />
      </span>
      {types.length > 1 ? (
        <span className="cfgrow">
          <span className="lbl">Datatype</span>
          <select
            className="field"
            value={type}
            onChange={(e) => {
              const t = e.target.value as DataType;
              if (t === "value") write({ rule: { kind: "value", value: text || ruleExample(c.part, c.rule) } });
              else if (t === "list") {
                const lists = LISTS_FOR[key] ?? [];
                write({ rule: lists.length ? { kind: "standard", standard: lists[0] } : { kind: "list", values: ownValues(text).length ? ownValues(text) : [ruleExample(c.part, c.rule)] } });
              } else write({ rule: { kind: "pattern", pattern: DEFAULT_FORM[key] ?? "\\d{3}" } });
            }}
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {t === "value" ? "Fast verdi" : t === "list" ? "Liste" : "Mønster"}
              </option>
            ))}
          </select>
        </span>
      ) : null}
      {type === "value" ? (
        <input
          className="field mono"
          aria-label="Verdi"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value !== "") write({ rule: { kind: "value", value: e.target.value } });
          }}
        />
      ) : null}
      {type === "list" ? (
        <>
          <select
            className="field"
            aria-label="Liste"
            value={listKey}
            onChange={(e) =>
              e.target.value
                ? write({ rule: { kind: "standard", standard: e.target.value } })
                : write({ rule: { kind: "list", values: ownValues(text).length ? ownValues(text) : [ruleExample(c.part, c.rule)] } })
            }
          >
            <option value="">Egen liste</option>
            {STANDARD_LISTS.filter(([k]) => (LISTS_FOR[key] ?? []).includes(k)).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          {listKey === "" ? (
            <input
              className="field mono"
              aria-label="Verdier"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const v = ownValues(e.target.value);
                if (v.length) write({ rule: { kind: "list", values: v } });
              }}
            />
          ) : null}
        </>
      ) : null}
      {type === "pattern" ? (
        <>
          <select
            className="field"
            aria-label="Mønster"
            value={pick}
            onChange={(e) =>
              e.target.value === "custom"
                ? setCustom(c.rule.kind === "pattern" ? c.rule.pattern : "")
                : write({ rule: { kind: "pattern", pattern: e.target.value } })
            }
          >
            {presets.map(([l, rx]) => (
              <option key={rx} value={rx}>
                {l}
              </option>
            ))}
            {kind !== "lopenummer" || pick === "custom" ? <option value="custom">Egendefinert</option> : null}
          </select>
          {pick === "custom" ? (
            <input
              className="field mono"
              aria-label="Regex"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                if (e.target.value) write({ rule: { kind: "pattern", pattern: e.target.value } });
              }}
            />
          ) : (
            <span className="rx mono">{c.rule.kind === "pattern" ? c.rule.pattern : ""}</span>
          )}
        </>
      ) : null}
    </span>
  );
}

const SEP_COLOR_STYLE = { background: SEP_COLOR.bg, color: SEP_COLOR.text, boxShadow: `inset 0 0 0 1px ${SEP_COLOR.border}` };

/** The two areas' headers, edkjo's terms; the Norwegian words to come. */
const BUILT_STRING = "Merkestreng";
const BUILDING_BLOCKS = "building blocks";

/** The «Sett inn» picker, outside every tile's overflow (in #oppsett's top
 *  level, position fixed), at its bubble: below it, or above when there is
 *  no room, shifted to stay inside the viewport. */
function FloatingPop({ anchor, label, children }: { anchor: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = document.querySelector(`#oppsett ${anchor}`);
      const p = ref.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const m = 8;
      const left = Math.min(Math.max(m, r.left + r.width / 2 - 16), window.innerWidth - w - m);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - m) top = Math.max(m, r.top - 6 - h);
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  const root = document.getElementById("oppsett");
  if (!root) return null;
  return createPortal(
    <span
      ref={ref}
      className="pop"
      role="dialog"
      aria-label={label}
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, transform: "none" }}
    >
      {children}
    </span>,
    root,
  );
}

type Sel = { pi: number; ti: number } | null;
type Drag = { pi: number; ti: number } | { token: string };
type Drop = { pi: number; at: number } | null;

/** Format: building the TFM code form, without model data (the data
 *  belongs with the results). Band 1, full width: the built string, its
 *  forms as rows of segments with «eller» between them (a code passes on
 *  any one). Band 2: «Deler», each part's rule and standard link | the
 *  building blocks by kind: Klassifikasjon, Løpenummer, Skilletegn (and
 *  text). A block drags to where it goes,
 *  or a gap's «+» bubble picks one there; a segment drags, or is picked and
 *  moved with ‹ › ✕. Rail: the bundled forms and the discipline. */
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
  // The gap whose «+» bubble is open (its blocks to pick from).
  const [picker, setPicker] = useState<{ pi: number; at: number } | null>(null);
  const [popText, setPopText] = useState("");
  // The block whose dropdown is open.
  const [cfg, setCfg] = useState<{ pi: number; ti: number } | null>(null);
  useEffect(() => {
    if (!cfg) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".pop") && !t?.closest("[data-cfg]")) setCfg(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCfg(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [cfg]);
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
  /** A new, empty variant at `at` (between rows or after the last). */
  const addPatternAt = (at: number) => {
    setPatterns((ps) => {
      ps.splice(at, 0, []);
      return ps;
    });
    setSel(null);
    setPicker({ pi: at, at: 0 });
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
  /** Over a gap bubble: the block lands exactly there. */
  const overGap = (pi: number, at: number) => (e: DragEvent) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
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
    const b = blockOf(t);
    const v = blockView(t, draft);
    const open = cfg?.pi === pi && cfg.ti === ti;
    const sep = !v.part;
    const caret = (
      <button
        type="button"
        className="caret"
        aria-label="Innstillinger"
        aria-expanded={open}
        data-cfg={`${pi}-${ti}`}
        onClick={(e) => {
          e.stopPropagation();
          setPicker(null);
          setCfg(open ? null : { pi, ti });
        }}
      >
        ▾
      </button>
    );
    const c = sep ? SEP_COLOR_STYLE : paint(b && b.kind === "part" ? (PART_COLORS[b.part] ?? FREETEXT_COLOR) : FREETEXT_COLOR);
    return (
      <span key={ti} className={"segw" + (sep ? " sepw" : "")} data-open={open || undefined}>
        <button type="button" className={"seg" + (sep ? " sep" : "")} aria-pressed={pressed} onClick={onClick} style={c} {...dnd}>
          {v.part ? <span className="sn">{v.name}</span> : null}
          <span className="sx">{sep ? show(v.ex) || "–" : v.ex}</span>
          {v.tech ? <span className="tech">{v.tech}</span> : null}
        </button>
        {caret}
        {open ? (
          <FloatingPop anchor={`[data-cfg="${pi}-${ti}"]`} label="Innstillinger">
            <span className="popbar">
              <button type="button" className="mini" aria-label="Lukk" onClick={() => setCfg(null)}>
                ✕
              </button>
            </span>
            <BlockConfig
              key={`${pi}-${ti}-${formKey}`}
              token={t}
              draft={draft}
              onToken={(nt) =>
                setPatterns((ps) => {
                  ps[pi][ti] = nt;
                  return ps;
                })
              }
            />
          </FloatingPop>
        ) : null}
      </span>
    );
  };

  const closePicker = () => {
    const pk = picker;
    setPopText("");
    setPicker(null);
    // A variant opened for its first block and left empty goes again.
    if (pk && (draft.patterns[pk.pi]?.sequence.length ?? 0) === 0 && draft.patterns.length > 1) {
      setPatterns((ps) => ps.filter((_, i) => i !== pk.pi));
    }
  };
  const closeRef = useRef(closePicker);
  closeRef.current = closePicker;
  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".gap[data-open]") && !t?.closest(".pop")) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker]);
  const choose = (token: string, pi: number, at: number) => {
    place({ token }, pi, at);
    setPopText("");
    setPicker(null);
  };

  /** A gap in a row (before a segment, or at the end): a small «+» bubble
   *  that opens the blocks to put there, and a drop target for a dragged
   *  block. */
  const gap = (pi: number, at: number) => {
    const open = picker?.pi === pi && picker.at === at;
    const over = drag !== null && drop?.pi === pi && drop.at === at;
    return (
      <span className="gap" data-open={open || undefined} data-over={over || undefined} onDragOver={overGap(pi, at)} onDrop={onDrop}>
        <button
          type="button"
          className="bub"
          aria-label="Sett inn"
          title="Sett inn"
          aria-expanded={open}
          data-gap={`${pi}-${at}`}
          onClick={() => (open ? closePicker() : setPicker({ pi, at }))}
        >
          +
        </button>
        {open ? (
          <FloatingPop anchor={`[data-gap="${pi}-${at}"]`} label="Sett inn">
            <span className="popbar">
              <button type="button" className="mini" aria-label="Lukk" onClick={closePicker}>
                ✕
              </button>
            </span>
            {(["klassifikasjon", "lopenummer"] as const).map((kd, gi) => (
              <Fragment key={kd}>
                <span className="lbl">{KIND_LABEL[kd]}</span>
                <span className="palette">
                  {PART_TYPES.filter((t) => (kd === "lopenummer" ? t === "Nummer" : PART_KIND[t] === kd)).map((t, k) => (
                    <button
                      key={t}
                      type="button"
                      className="mini"
                      style={paint(PART_COLORS[t])}
                      autoFocus={gi === 0 && k === 0}
                      onClick={() => choose(t, pi, at)}
                    >
                      {partLabel(t, draft.part_labels)}
                    </button>
                  ))}
                </span>
              </Fragment>
            ))}
            <span className="lbl">{KIND_LABEL.skilletegn}</span>
            <span className="palette">
              {SEP_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="mini mono"
                  title={k}
                  onClick={() => choose(k, pi, at)}
                >
                  {SEP_TO_CHAR[k] === " " ? "␣" : SEP_TO_CHAR[k]}
                </button>
              ))}
              <button type="button" className="mini mono" onClick={() => choose("T-suffiks", pi, at)}>
                T
              </button>
            </span>
            <form
              className="palette"
              onSubmit={(e) => {
                e.preventDefault();
                if (popText) choose(FREETEXT_PREFIX + popText, pi, at);
              }}
            >
              <input className="field mono" value={popText} onChange={(e) => setPopText(e.target.value)} aria-label="Tekst" size={8} />
              <button type="submit" className="mini" disabled={!popText}>
                + Tekst
              </button>
            </form>
          </FloatingPop>
        ) : null}
      </span>
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
    <Canvas rows="auto minmax(0, 1fr) auto">
      <StepBar>
        <button
          type="button"
          className="primary"
          disabled={!hasPattern}
          onClick={() => onUse({ ...draft, patterns: draft.patterns.filter((x) => x.sequence.length > 0) })}
        >
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

      <section className="tile card full built" aria-label={BUILT_STRING}>
        <div className="lh">
          <span className="lbl">{BUILT_STRING}</span>
          <span className="tag">{current ? current.label : "Egendefinert"}</span>
        </div>
        <div className="pats scroll" data-dragging={drag !== null || undefined}>
          {draft.patterns.map((p, pi) => (
            <Fragment key={pi}>
              {pi > 0 ? (
                <div className="orrow">
                  <span className="lbl">eller</span>
                  <button type="button" className="bub" aria-label="Ny variant" title="Ny variant" onClick={() => addPatternAt(pi)}>
                    +
                  </button>
                </div>
              ) : null}
              <div className="pat" onDragOver={overEnd(pi)} onDrop={onDrop}>
                {p.sequence.map((t, ti) => (
                  <Fragment key={ti}>
                    {gap(pi, ti)}
                    {segment(t, pi, ti)}
                  </Fragment>
                ))}
                {gap(pi, p.sequence.length)}
                {draft.patterns.length > 1 ? (
                  <button type="button" className="rowdel" aria-label="Fjern variant" title="Fjern variant" onClick={() => dropPattern(pi)}>
                    ✕
                  </button>
                ) : null}
              </div>
            </Fragment>
          ))}
          <div className="orrow end">
            <button
              type="button"
              className="bub"
              aria-label="Ny variant"
              title="Ny variant"
              onClick={() => addPatternAt(draft.patterns.length)}
            >
              +
            </button>
          </div>
        </div>
        <div className="patsum">
          {draft.patterns.map((p, pi) => (
            <div key={pi} className="patex">
              <span className="mono">{exampleString(p.sequence, draft)}</span>
              <span className="mono tech">{techString(p.sequence, draft)}</span>
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
      </section>

      <section className="tile card full blocks" aria-label={BUILDING_BLOCKS}>
        <span className="lbl">{BUILDING_BLOCKS}</span>
        {(["klassifikasjon", "lopenummer"] as const).map((k) => (
          <Fragment key={k}>
            <span className="lbl">{KIND_LABEL[k]}</span>
            <div className="palette">
              {PART_TYPES.filter((t) => (k === "lopenummer" ? t === "Nummer" : PART_KIND[t] === k)).map((t) =>
                piece(t, `+ ${partLabel(t, draft.part_labels)}`, paint(PART_COLORS[t])),
              )}
            </div>
          </Fragment>
        ))}
        <span className="lbl">{KIND_LABEL.skilletegn}</span>
        <div className="palette">
          {SEP_KEYS.map((k) => piece(k, SEP_TO_CHAR[k] === " " ? "␣" : SEP_TO_CHAR[k], undefined, "mini mono"))}
          {piece("T-suffiks", "T", undefined, "mini mono")}
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
    </Canvas>
  );
}
