import { Fragment, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getPreview } from "../api";
import {
  DISCIPLINES, FREETEXT_COLOR, FREETEXT_PREFIX, PART_COLORS, PART_EXAMPLE, PART_TO_DIGITKEY, PART_TYPES, SEP_KEYS,
  SEP_TO_CHAR, KIND_LABEL, NUMBER_ROLES, PART_KIND, PART_TECH, blockOf, fixedToken, freetextValue, isFreetext, listToken, partLabel,
  regexToken, sequenceToExample, type Palette,
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

/** What each part takes, in plain terms (engine/constants.py
 *  PLACEHOLDER_FALLBACK); a digit part can be locked to a count. */
const PART_RULE: Record<string, string> = {
  Lokasjon: "6 tegn", Rom: "1–5 siffer", Systemkode: "3 siffer", Etasje: "1–12 tegn", Subnr: "1–4 siffer",
  Løpenummer: "3 siffer", Komponent: "2 bokstaver", "Komp.nr": "3 siffer", "T-suffiks": "T",
  "Område": "1–2 siffer", Linje: "1–2 siffer", "Sløyfe": "2 siffer", "Adresse 2": "3 siffer",
  Typekode: "1–3 bokstaver", Typenr: "3 siffer", Instansnr: "2 siffer", Kode: "hele koden",
  Nummer: "1–6 siffer", Typeundernr: "1–3 siffer",
};

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
  ["5 siffer", "\\d{5}"], ["6 siffer", "\\d{6}"], ["1–2 siffer", "\\d{1,2}"], ["1–4 siffer", "\\d{1,4}"],
  ["1–5 siffer", "\\d{1,5}"], ["1 bokstav (A–Z)", "[A-Z]"], ["2 bokstaver (A–Z)", "[A-Z]{2}"],
  ["3 bokstaver (A–Z)", "[A-Z]{3}"], ["1–3 bokstaver", "[A-ZÆØÅ]{1,3}"], ["2 tegn", "[A-Za-z0-9]{2}"],
  ["3 tegn", "[A-Za-z0-9]{3}"], ["4 tegn", "[A-Za-z0-9]{4}"], ["6 tegn", "[A-Za-z0-9]{6}"],
  ["1–12 tegn", "[A-Za-z0-9æøåÆØÅ_\\- ]{1,12}"], ["T eller ingenting", "T?"], ["Hele koden", "\\S+"],
];
/** For a block between code parts. */
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

/** The standard a part is linked to by the older fields, if any. */
function legacyLink(d: FormatDraft, key: string): string | null {
  if (key === "systemkode" && d.bygningsdel_system === "NS3451") return "NS3451";
  if (key === "komponent" && d.komponent_system && d.komponent_system !== "Ingen") return d.komponent_system;
  return d.part_links?.[key] ?? null;
}

/** The draft with a part's older link fields cleared or set. */
function withLink(d: FormatDraft, key: string, std: string | null): FormatDraft {
  if (key === "systemkode") return { ...d, bygningsdel_system: std ?? "Ingen" };
  if (key === "komponent") return { ...d, komponent_system: std ?? "Ingen" };
  const pl = { ...(d.part_links ?? {}) };
  if (std) pl[key] = std;
  else delete pl[key];
  return { ...d, part_links: pl };
}

/** The data type a part shows, from what the draft holds (older files
 *  included: a length lock is a Mønster, a linked part a standard Liste). */
function partState(d: FormatDraft, part: string, key: string): { type: DataType; list: string; rx: string; text: string } {
  const rule = d.part_rules?.[key];
  if (rule?.kind === "value") return { type: "value", list: "", rx: "", text: rule.value };
  if (rule?.kind === "list") return { type: "list", list: "", rx: "", text: rule.values.join(", ") };
  if (rule?.kind === "standard") return { type: "list", list: rule.standard, rx: "", text: "" };
  if (rule?.kind === "pattern") return { type: "pattern", list: "", rx: rule.pattern, text: "" };
  const link = legacyLink(d, key);
  if (link) return { type: "list", list: link, rx: "", text: "" };
  const dk = PART_TO_DIGITKEY[part];
  const n = dk ? d.part_digits?.[dk] : undefined;
  if (n) return { type: "pattern", list: "", rx: key === "lokasjon" ? `[A-Za-z0-9]{${n}}` : `\\d{${n}}`, text: "" };
  return { type: "pattern", list: "", rx: DEFAULT_FORM[key] ?? "\\S+", text: "" };
}

/** One part's data type in «Deler»: Fast verdi, Liste (own values or a
 *  standard list) or Mønster (a preset in plain words, its regex shown, or
 *  «Egendefinert»). */
function PartRow({
  part,
  draft,
  edit,
  onRepresent,
}: {
  part: string;
  draft: FormatDraft;
  edit: (f: (d: FormatDraft) => FormatDraft) => void;
  /** A number part: what it represents (every block of this part). */
  onRepresent?: (to: string) => void;
}) {
  const key = PART_KEY[part];
  const st = partState(draft, part, key);
  const [type, setType] = useState<DataType>(st.type);
  const [text, setText] = useState(st.text);
  const [list, setList] = useState(st.list);
  const preset = PATTERN_PRESETS.find(([, rx]) => rx === st.rx)?.[1] ?? (st.type === "pattern" ? "custom" : "");
  const [pick, setPick] = useState(preset || "\\d{3}");
  const [custom, setCustom] = useState(preset === "custom" ? st.rx : "");
  const lists = LISTS_FOR[key] ?? [];
  const kind = PART_KIND[part] ?? "klassifikasjon";
  // The data types a kind offers; a type the draft already holds (an older
  // file) stays listed so it shows as it reads.
  const types: DataType[] =
    kind === "klassifikasjon" ? ["list", "value"] : kind === "lopenummer" ? ["pattern"] : ["value"];
  if (!types.includes(st.type)) types.push(st.type);
  const presets = kind === "lopenummer" ? PATTERN_PRESETS.filter(([, rx]) => rx.startsWith("\\d")) : PATTERN_PRESETS;
  const setLabel = (v: string) =>
    edit((d) => {
      const pl = { ...(d.part_labels ?? {}) };
      if (v.trim() && v.trim() !== partLabel(part)) pl[key] = v;
      else delete pl[key];
      return { ...d, part_labels: pl };
    });

  /** Write the part's rule; a length lock and an older link give way. */
  const write = (rule: PartRule | null, link: string | null) =>
    edit((d) => {
      const pr = { ...(d.part_rules ?? {}) };
      if (rule) pr[key] = rule;
      else delete pr[key];
      const pd = { ...(d.part_digits ?? {}) };
      const dk = PART_TO_DIGITKEY[part];
      if (dk) delete pd[dk];
      return withLink({ ...d, part_rules: pr, part_digits: pd }, key, link);
    });
  const writeValue = (t: string) => write(t !== "" ? { kind: "value", value: t } : null, null);
  const writeList = (l: string, t: string) => {
    if (l) write({ kind: "standard", standard: l }, l);
    else {
      const values = t.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
      write(values.length ? { kind: "list", values } : null, null);
    }
  };
  const writePattern = (rx: string) => {
    if (!rx.trim()) return write(null, null);
    // The part's own standard form is no rule at all.
    write(rx === DEFAULT_FORM[key] ? null : { kind: "pattern", pattern: rx.trim() }, null);
  };

  const onType = (t: DataType) => {
    setType(t);
    if (t === "value") writeValue(text);
    else if (t === "list") writeList(list, text);
    else writePattern(pick === "custom" ? custom : pick);
  };
  const shownRx = type === "pattern" ? (pick === "custom" ? custom : pick) : "";

  return (
    <div className="prow rule">
      <span className="swl">
        <input
          className="sw lblin"
          style={paint(PART_COLORS[part] ?? FREETEXT_COLOR)}
          aria-label={`${partLabel(part)} navn`}
          value={draft.part_labels?.[key] ?? partLabel(part)}
          onChange={(e) => setLabel(e.target.value)}
        />
        {PART_TECH[part] ? <span className="tech">{PART_TECH[part]}</span> : null}
      </span>
      <span className="pr">
        {onRepresent ? <RepresentSelect token={part} onChange={onRepresent} /> : null}
        {types.length > 1 ? (
          <select className="field" aria-label={`${part} datatype`} value={type} onChange={(e) => onType(e.target.value as DataType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t === "value" ? "Fast verdi" : t === "list" ? "Liste" : "Mønster"}
              </option>
            ))}
          </select>
        ) : null}
        {type === "value" ? (
          <input
            className="field mono"
            aria-label={`${part} verdi`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              writeValue(e.target.value);
            }}
          />
        ) : null}
        {type === "list" ? (
          <>
            <select
              className="field"
              aria-label={`${part} liste`}
              value={list}
              onChange={(e) => {
                setList(e.target.value);
                writeList(e.target.value, text);
              }}
            >
              <option value="">Egen liste</option>
              {STANDARD_LISTS.filter(([k]) => lists.includes(k)).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {list === "" ? (
              <input
                className="field mono"
                aria-label={`${part} verdier`}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  writeList("", e.target.value);
                }}
              />
            ) : null}
          </>
        ) : null}
        {type === "pattern" ? (
          <select
            className="field"
            aria-label={`${part} mønster`}
            value={pick}
            onChange={(e) => {
              setPick(e.target.value);
              writePattern(e.target.value === "custom" ? custom : e.target.value);
            }}
          >
            {presets.map(([label, rx]) => (
              <option key={rx} value={rx}>
                {label}
              </option>
            ))}
            {kind !== "lopenummer" || pick === "custom" ? <option value="custom">Egendefinert</option> : null}
          </select>
        ) : null}
      </span>
      {type === "pattern" ? (
        pick === "custom" ? (
          <input
            className="field mono rx"
            aria-label={`${part} regex`}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              writePattern(e.target.value);
            }}
          />
        ) : (
          <span className="rx mono">{shownRx}</span>
        )
      ) : null}
    </div>
  );
}

/** A block that is not a named code part (a separator, text, accepted
 *  separators, a pattern), configured where it stands: Fast verdi, Liste
 *  of accepted values, or Mønster. */
function BlockRow({
  token,
  context,
  onToken,
}: {
  token: string;
  /** Where it stands: the blocks either side. */
  context: string;
  onToken: (t: string) => void;
}) {
  const b = blockOf(token);
  const initial: DataType = b?.kind === "list" ? "list" : b?.kind === "pattern" ? "pattern" : "value";
  const [type, setType] = useState<DataType>(initial);
  const [text, setText] = useState(b?.kind === "fixed" ? b.text : "");
  const [values, setValues] = useState<string[]>(b?.kind === "list" ? b.values : b?.kind === "fixed" ? [b.text] : []);
  const [rx, setRx] = useState(b?.kind === "pattern" ? b.rx : BLOCK_PRESETS[0][1]);
  const presetRx = BLOCK_PRESETS.some(([, r]) => r === rx);
  const [own, setOwn] = useState(!presetRx);

  const onType = (t: DataType) => {
    setType(t);
    if (t === "value") onToken(fixedToken(text || values[0] || "."));
    else if (t === "list") onToken(listToken(values.length ? values : [text || "."]));
    else onToken(regexToken(rx));
  };
  const toggle = (ch: string) => {
    const next = values.includes(ch) ? values.filter((v) => v !== ch) : [...values, ch];
    setValues(next);
    if (next.length) onToken(listToken(next));
  };
  const show = (t: string) => (t === " " ? "␣" : t);

  return (
    <div className="prow rule">
      <span className="sw blk mono" title={context}>
        {b?.kind === "fixed" ? show(b.text) || "–" : b?.kind === "list" ? b.values.map(show).join(" ") : "/…/"}
      </span>
      <span className="pr">
        <select className="field" aria-label="Datatype" value={type} onChange={(e) => onType(e.target.value as DataType)}>
          <option value="value">Fast verdi</option>
          <option value="list">Liste</option>
          {initial === "pattern" ? <option value="pattern">Mønster</option> : null}
        </select>
        {type === "value" ? (
          <input
            className="field mono"
            aria-label="Verdi"
            value={text}
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
        {type === "pattern" ? (
          <select
            className="field"
            aria-label="Mønster"
            value={own ? "custom" : rx}
            onChange={(e) => {
              if (e.target.value === "custom") setOwn(true);
              else {
                setOwn(false);
                setRx(e.target.value);
                onToken(regexToken(e.target.value));
              }
            }}
          >
            {BLOCK_PRESETS.map(([label, r]) => (
              <option key={r} value={r}>
                {label}
              </option>
            ))}
            <option value="custom">Egendefinert</option>
          </select>
        ) : null}
      </span>
      {type === "pattern" ? (
        own ? (
          <input
            className="field mono rx"
            aria-label="Regex"
            value={rx}
            onChange={(e) => {
              setRx(e.target.value);
              if (e.target.value) onToken(regexToken(e.target.value));
            }}
          />
        ) : (
          <span className="rx mono">{rx}</span>
        )
      ) : null}
    </div>
  );
}

/** What a number block represents: the generic «Nummer» (not said), a
 *  standard number (NS 8360-1) or a project's own number part. */
function RepresentSelect({ token, onChange }: { token: string; onChange: (to: string) => void }) {
  return (
    <select className="field" aria-label="Representerer" value={token} onChange={(e) => onChange(e.target.value)}>
      <option value="Nummer">–</option>
      {NUMBER_ROLES.map((t) => (
        <option key={t} value={t}>
          {partLabel(t)}
          {PART_TECH[t] ? ` · ${PART_TECH[t]}` : ""}
        </option>
      ))}
    </select>
  );
}

/** An example value for a part, fitting its rule. */
function partExample(t: string, d: FormatDraft): string {
  const key = PART_KEY[t];
  const rule = key ? d.part_rules?.[key] : undefined;
  if (rule?.kind === "value") return rule.value;
  if (rule?.kind === "list") return rule.values[0] ?? "";
  const dk = PART_TO_DIGITKEY[t];
  const n = dk ? d.part_digits?.[dk] : undefined;
  const rx = rule?.kind === "pattern" ? rule.pattern : n ? (key === "lokasjon" ? `[A-Za-z0-9]{${n}}` : `\\d{${n}}`) : null;
  const ex = PART_EXAMPLE[t] ?? "";
  if (!rx) return ex;
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
  return seq
    .map((t) => {
      const b = blockOf(t);
      if (!b) return "";
      if (b.kind === "part") return partExample(t, d);
      if (b.kind === "fixed") return b.text;
      if (b.kind === "list") return b.values[0] ?? "";
      return "…";
    })
    .join("");
}

/** A variant with each part's technical key (its label where it has none). */
function techString(seq: string[], d: FormatDraft): string {
  return seq
    .map((t) => {
      const b = blockOf(t);
      if (!b) return "";
      if (b.kind === "part") return PART_TECH[t] ?? partLabel(t, d.part_labels);
      if (b.kind === "fixed") return b.text;
      if (b.kind === "list") return b.values[0] ?? "";
      return "…";
    })
    .join("");
}

/** The two areas' headers, edkjo's terms; the Norwegian words to come. */
const BUILT_STRING = "Merkestreng";
const BUILDING_BLOCKS = "building blocks";

/** The «Sett inn» picker, outside every tile's overflow (in #oppsett's top
 *  level, position fixed), at its bubble: below it, or above when there is
 *  no room, shifted to stay inside the viewport. */
function FloatingPop({ anchor, children }: { anchor: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = document.querySelector(`#oppsett [data-gap="${anchor}"]`);
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
      aria-label="Sett inn"
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

  /** A number block (or every block of a number part) made to represent
   *  another part; its digit rule goes with it when the target has none. */
  const represent = (from: string, to: string, only: { pi: number; ti: number } | null) => {
    if (from === to) return;
    const fk = PART_KEY[from];
    const tk = PART_KEY[to];
    edit((d) => {
      const patterns = d.patterns.map((p, pi) => ({
        sequence: p.sequence.map((t, ti) => (t === from && (!only || (only.pi === pi && only.ti === ti)) ? to : t)),
      }));
      const pr = { ...(d.part_rules ?? {}) };
      if (fk && tk && pr[fk] && !pr[tk]) pr[tk] = pr[fk];
      const pd = { ...(d.part_digits ?? {}) };
      if (fk && tk && pd[fk] && !pd[tk]) pd[tk] = pd[fk];
      return { ...d, patterns, part_rules: pr, part_digits: pd };
    });
    setFormKey((k) => k + 1);
  };
  const selToken = sel ? (draft.patterns[sel.pi]?.sequence[sel.ti] ?? null) : null;

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

  // The parts the form uses, once each, in order.
  const parts = [...new Set(draft.patterns.flatMap((p) => p.sequence))].filter((t) => t in PART_RULE);

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
    const blk = blockOf(t);
    if (blk && (blk.kind === "list" || blk.kind === "pattern")) {
      const label = blk.kind === "list" ? blk.values.map((v) => (v === " " ? "␣" : v)).join(" ") : `/${blk.rx}/`;
      return (
        <button key={ti} type="button" className="seg sep alt" aria-pressed={pressed} onClick={onClick} title={label} {...dnd}>
          <span className="sx">{label}</span>
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
        <span className="sn">
          {free ? "Tekst" : digits ? `${partLabel(t, draft.part_labels)} · ${digits}` : partLabel(t, draft.part_labels)}
        </span>
        <span className="sx">{free ? freetextValue(t) || "–" : ex}</span>
        {!free && PART_TECH[t] ? <span className="tech">{PART_TECH[t]}</span> : null}
      </button>
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
          <FloatingPop anchor={`${pi}-${at}`}>
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
    <Canvas rows="auto minmax(0, 1fr) minmax(0, 1fr)">
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
          {selToken && PART_KIND[selToken] === "lopenummer" ? (
            <RepresentSelect token={selToken} onChange={(to) => sel && represent(selToken, to, sel)} />
          ) : null}
        </div>
      </section>

      <section className="tile card major" aria-label="Deler">
        <span className="lbl">Deler</span>
        <div className="parts scroll">
          {parts.map((t) => (
            <PartRow
              key={`${t}-${formKey}`}
              part={t}
              draft={draft}
              edit={edit}
              onRepresent={PART_KIND[t] === "lopenummer" ? (to) => represent(t, to, null) : undefined}
            />
          ))}
          {draft.patterns.flatMap((p, pi) =>
            p.sequence.map((t, ti) => {
              const b = blockOf(t);
              if (!b || b.kind === "part") return null;
              const side = (k: number) => {
                const n = p.sequence[k];
                const nb = n !== undefined ? blockOf(n) : null;
                return nb?.kind === "part" ? partLabel(nb.part, draft.part_labels) : "";
              };
              const context = [side(ti - 1), side(ti + 1)].filter(Boolean).join(" · ");
              return (
                <BlockRow
                  key={`${pi}-${ti}-${formKey}`}
                  token={t}
                  context={context}
                  onToken={(nt) =>
                    setPatterns((ps) => {
                      ps[pi][ti] = nt;
                      return ps;
                    })
                  }
                />
              );
            }),
          )}
        </div>
      </section>

      <section className="tile card minor blocks" aria-label={BUILDING_BLOCKS}>
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
