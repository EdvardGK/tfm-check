import type { PartRule } from "./types";
// Builder data model — mirrors backend/engine/constants.py.

export const PART_TYPES = [
  "Lokasjon", "Rom",
  "Systemkode", "Etasje",
  "Subnr", "Løpenummer",
  "Komponent", "Komp.nr",
  "T-suffiks",
  "Område", "Linje", "Sløyfe", "Adresse 2",
  "Typekode", "Typenr", "Instansnr",
  "Kode",
  "Nummer", "Typeundernr",
] as const;
export type PartType = (typeof PART_TYPES)[number];

/** A part's name in the UI, from NS 8360-1 G1:2025 tables 3-4 where it has
 *  one; the token (the ruleset key) stays as it is. A project may rename a
 *  part (rules.part_labels). */
export const PART_LABEL: Record<string, string> = {
  Lokasjon: "Plasserings-ID",
  // Numbers, named for what they number; «Nummer» is one not yet said.
  Løpenummer: "Systemnr",
  Subnr: "Undernr",
  Komponent: "Komponentkode",
  "Komp.nr": "Forekomstnr",
  Typekode: "Komponentkode (type)",
  Typenr: "Typenr",
  // The older instance segment is a Forekomstnr (instance = occurrence).
  Instansnr: "Forekomstnr",
  Kode: "TFM-ID",
  Typeundernr: "Typeundernr",
  Sløyfe: "Sløyfenr",
  Linje: "Linjenr",
  Område: "Områdenr",
  "Adresse 2": "Adressenr",
};
export const partLabel = (t: string, own?: Record<string, string>): string => {
  const key = PART_TEMPLATE_KEY[t];
  return (key && own?.[key]) || PART_LABEL[t] || t;
};

/** The kind a part is, which decides its data types: a classification code
 *  (validated against a code list), a running number (a counter of so many
 *  digits) or a separator (a fixed value or accepted ones). */
export type PartKind = "klassifikasjon" | "lopenummer" | "skilletegn";
export const PART_KIND: Record<string, PartKind> = {
  Lokasjon: "klassifikasjon", Systemkode: "klassifikasjon", Komponent: "klassifikasjon", Typekode: "klassifikasjon",
  Etasje: "klassifikasjon", Rom: "klassifikasjon", Kode: "klassifikasjon",
  Løpenummer: "lopenummer", Subnr: "lopenummer", "Komp.nr": "lopenummer", Typenr: "lopenummer",
  Instansnr: "lopenummer", Område: "lopenummer", Linje: "lopenummer", Sløyfe: "lopenummer", "Adresse 2": "lopenummer",
  Nummer: "lopenummer", Typeundernr: "lopenummer",
  "T-suffiks": "skilletegn",
};
/** The technical key of a part (NS 8360-1 G1:2025, NONS_Reference), shown
 *  under its name; none for a project's own part. */
export const PART_TECH: Record<string, string> = {
  Lokasjon: "RefPriSysLoc", Systemkode: "RefPriSysClass", Løpenummer: "RefPriSysNo1", Subnr: "RefPriSysNo2",
  Komponent: "RefCompClass", "Komp.nr": "RefCompOccNo", Typekode: "RefCompClass", Typenr: "RefCompTypeNo1",
  Etasje: "RefCompLocVer", Rom: "RefCompLocRoom", Kode: "RefString", Typeundernr: "RefCompTypeNo2",
  Instansnr: "RefCompOccNo",
};

/** What a number block can represent: its segment token. The generic
 *  «Nummer» is a number not yet said (no specific part in the register). */
export const NUMBER_ROLES: string[] = [
  "Løpenummer", "Subnr", "Komp.nr", "Typenr", "Typeundernr", "Sløyfe", "Linje", "Område", "Adresse 2",
];

export const KIND_LABEL: Record<PartKind, string> = {
  klassifikasjon: "Klassifikasjon",
  lopenummer: "Løpenummer",
  skilletegn: "Skilletegn",
};

/** Part token → its template key (backend PART_TO_TEMPLATE). */
export const PART_TEMPLATE_KEY: Record<string, string> = {
  Lokasjon: "lokasjon", Rom: "rom", Systemkode: "systemkode", Etasje: "etasje", Subnr: "subnr",
  Løpenummer: "lopenummer", Komponent: "komponent", "Komp.nr": "kompnr", "T-suffiks": "typeflag",
  Område: "omrade", Linje: "linje", Sløyfe: "sloyfe", "Adresse 2": "adresse", Typekode: "typekode",
  Typenr: "typenr", Instansnr: "instansnr", Kode: "kode", Nummer: "nummer", Typeundernr: "typeundernr",
};

// Separator key → rendered character
export const SEP_TO_CHAR: Record<string, string> = {
  "+": "+", ".": ".", "-": "-", "_": "_", "/": "/",
  mellomrom: " ", "=": "=", "++": "++", "%": "%",
};
export const SEP_KEYS = Object.keys(SEP_TO_CHAR);

export const SEP_NAMES: Record<string, string> = {
  "+": "pluss", ".": "punktum", "-": "bindestrek", _: "understrek",
  "/": "skråstrek", "=": "likhetstegn", "++": "dobbeltpluss", mellomrom: "mellomrom", "%": "prosent",
};

export function sepLabel(key: string): string {
  if (key === "mellomrom") return "␣ (mellomrom)";
  return `${key}  (${SEP_NAMES[key] ?? key})`;
}

export const PART_EXAMPLE: Record<string, string> = {
  Lokasjon: "123456", Rom: "012", Systemkode: "244", Etasje: "01",
  Subnr: "01", Løpenummer: "001", Komponent: "DI", "Komp.nr": "001",
  "T-suffiks": "T", "Område": "1", "Linje": "5", "Sløyfe": "08", "Adresse 2": "013",
  Typekode: "SQZ", Typenr: "008", Instansnr: "06", Kode: "+02=360.017",
  Nummer: "001", Typeundernr: "01",
};

export const FREETEXT_PREFIX = "T:";
export function isFreetext(t: string): boolean {
  return t.startsWith(FREETEXT_PREFIX);
}
export function freetextValue(t: string): string {
  return isFreetext(t) ? t.slice(FREETEXT_PREFIX.length) : t;
}

// ---- Blocks (backend engine/blocks.py) ----
// A form is an ordered list of blocks. A token is a code part (a name in
// PART_TYPES), a fixed value (a separator key or "T:text"), a list
// ("SL:" + JSON array) or a pattern ("SR:" + regex).
export const LIST_PREFIX = "SL:";
export const REGEX_PREFIX = "SR:";
/** A part block with its own config: B:{"p": part, "r": rule, "l": name}. */
export const CONFIG_PREFIX = "B:";

export type Block =
  | { kind: "part"; part: string; rule?: PartRule; label?: string }
  | { kind: "fixed"; text: string }
  | { kind: "list"; values: string[] }
  | { kind: "pattern"; rx: string };

export function blockOf(t: string): Block | null {
  if ((PART_TYPES as readonly string[]).includes(t)) return { kind: "part", part: t };
  if (t.startsWith(CONFIG_PREFIX)) {
    try {
      const d = JSON.parse(t.slice(CONFIG_PREFIX.length)) as { p?: string; r?: PartRule; l?: string };
      const part = d.p && (PART_TYPES as readonly string[]).includes(d.p) ? d.p : "Nummer";
      return { kind: "part", part, rule: d.r ?? undefined, label: d.l ?? undefined };
    } catch {
      return null;
    }
  }
  if (t in SEP_TO_CHAR) return { kind: "fixed", text: SEP_TO_CHAR[t] };
  if (isFreetext(t)) return { kind: "fixed", text: freetextValue(t) };
  if (t.startsWith(LIST_PREFIX)) {
    try {
      const v = JSON.parse(t.slice(LIST_PREFIX.length));
      return { kind: "list", values: Array.isArray(v) ? v.map(String).filter((x) => x !== "") : [] };
    } catch {
      return { kind: "list", values: [] };
    }
  }
  if (t.startsWith(REGEX_PREFIX)) return { kind: "pattern", rx: t.slice(REGEX_PREFIX.length) };
  return null;
}

/** A fixed value as a token: its separator key when it is one, else text. */
export function fixedToken(text: string): string {
  const key = Object.keys(SEP_TO_CHAR).find((k) => SEP_TO_CHAR[k] === text);
  return key ?? FREETEXT_PREFIX + text;
}
export const listToken = (values: string[]) => LIST_PREFIX + JSON.stringify(values);
export const regexToken = (rx: string) => REGEX_PREFIX + rx;
export const configToken = (d: Record<string, unknown>) => CONFIG_PREFIX + JSON.stringify(d);

// Per-part chip palette — cohesive, on-brand, distinguishable.
export interface Palette {
  bg: string;
  border: string;
  text: string;
}
export const PART_COLORS: Record<string, Palette> = {
  Lokasjon: { bg: "#e7eaef", border: "#9aa6b5", text: "#3a4452" },
  Rom: { bg: "#eee7f0", border: "#b29ab5", text: "#52465a" },
  Systemkode: { bg: "#f3e6cd", border: "#c89544", text: "#7a5a1e" },
  Etasje: { bg: "#e3ede4", border: "#7fae8b", text: "#37553f" },
  Subnr: { bg: "#eef0e3", border: "#aab07f", text: "#535739" },
  Løpenummer: { bg: "#e4ecf0", border: "#85a9b8", text: "#3a525c" },
  Komponent: { bg: "#f7e6e0", border: "#cf9077", text: "#7a4632" },
  "Komp.nr": { bg: "#f0e8e0", border: "#c0a487", text: "#5e4a36" },
  "T-suffiks": { bg: "#e9e6e0", border: "#a89f90", text: "#4a4438" },
  "Område": { bg: "#e6edf2", border: "#8fa7bb", text: "#384a59" },
  "Linje": { bg: "#e8eef0", border: "#94adb3", text: "#3c4f54" },
  "Sløyfe": { bg: "#f2e9e4", border: "#c39d8a", text: "#5c4337" },
  "Adresse 2": { bg: "#ecebe2", border: "#a9a68a", text: "#4f4d39" },
  "Typekode": { bg: "#f4e4e4", border: "#c98d8d", text: "#6e3a3a" },
  "Typenr": { bg: "#efe6ea", border: "#b896a4", text: "#5a4049" },
  "Instansnr": { bg: "#ebe7f0", border: "#a597b8", text: "#4a4058" },
  Kode: { bg: "#e9eef0", border: "#7f97a3", text: "#2f4049" },
  Nummer: { bg: "#eceae6", border: "#9c968a", text: "#45413a" },
  Typeundernr: { bg: "#ece6ee", border: "#a896b0", text: "#4c4052" },
};
export const SEP_COLOR: Palette = { bg: "var(--color-ink)", border: "var(--color-ink)", text: "var(--color-cream)" };
export const FREETEXT_COLOR: Palette = { bg: "var(--color-input)", border: "var(--color-line)", text: "var(--color-muted)" };

export function tokenPalette(token: string): Palette {
  if (isFreetext(token)) return FREETEXT_COLOR;
  if (token in SEP_TO_CHAR) return SEP_COLOR;
  return PART_COLORS[token] ?? FREETEXT_COLOR;
}

export const DISCIPLINES: { key: string; label: string }[] = [
  { key: "RIE", label: "RIE — Elektro" },
  { key: "RIV", label: "RIV — VVS" },
  { key: "RIB", label: "RIB — Bygg" },
  { key: "ARK", label: "ARK — Arkitekt" },
  { key: "RIBR", label: "RIBR — Brann" },
  { key: "RIA", label: "RIA — Automasjon" },
  { key: "Annet", label: "Annet / ukjent" },
];

export const DIGIT_LOCKABLE: { key: string; label: string }[] = [
  { key: "etasje", label: "Etasje" },
  { key: "subnr", label: "Subnr" },
  { key: "lopenummer", label: "Løpenummer" },
  { key: "kompnr", label: "Komp.nr" },
  { key: "rom", label: "Rom" },
];

// Map a part-type token to its internal digit-lock key (for part_digits).
export const PART_TO_DIGITKEY: Record<string, string> = {
  Lokasjon: "lokasjon",
  "Område": "omrade",
  Linje: "linje",
  "Sløyfe": "sloyfe",
  "Adresse 2": "adresse",
  Typenr: "typenr",
  Instansnr: "instansnr",
  Nummer: "nummer",
  Typeundernr: "typeundernr",
  Etasje: "etasje", Subnr: "subnr", Løpenummer: "lopenummer",
  "Komp.nr": "kompnr", Rom: "rom",
};

// Build an example string from a token sequence (for live preview).
export function sequenceToExample(seq: string[]): string {
  return seq
    .map((t) => {
      if (t in PART_EXAMPLE) return PART_EXAMPLE[t];
      if (t in SEP_TO_CHAR) return SEP_TO_CHAR[t];
      if (isFreetext(t)) return freetextValue(t);
      if (t.startsWith(LIST_PREFIX)) {
        const b = blockOf(t);
        return b && b.kind === "list" ? (b.values[0] ?? "") : "";
      }
      if (t.startsWith(REGEX_PREFIX)) return "…";
      const b = blockOf(t);
      if (b && b.kind === "part") {
        if (b.rule?.kind === "value") return b.rule.value;
        if (b.rule?.kind === "list") return b.rule.values[0] ?? "";
        return PART_EXAMPLE[b.part] ?? "";
      }
      return "";
    })
    .join("");
}

export function statusColor(pct: number): string {
  if (pct >= 95) return "var(--color-ok)";
  if (pct >= 50) return "var(--color-warn)";
  return "var(--color-bad)";
}
