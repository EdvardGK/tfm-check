// Builder data model — mirrors backend/engine/constants.py.

export const PART_TYPES = [
  "Lokasjon", "Rom",
  "Systemkode", "Etasje",
  "Subnr", "Løpenummer",
  "Komponent", "Komp.nr",
  "T-suffiks",
  "Område", "Linje", "Sløyfe", "Adresse 2",
  "Typekode", "Typenr", "Instansnr",
] as const;
export type PartType = (typeof PART_TYPES)[number];

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
  Typekode: "SQZ", Typenr: "008", Instansnr: "06",
};

export const FREETEXT_PREFIX = "T:";
export function isFreetext(t: string): boolean {
  return t.startsWith(FREETEXT_PREFIX);
}
export function freetextValue(t: string): string {
  return isFreetext(t) ? t.slice(FREETEXT_PREFIX.length) : t;
}

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
      return "";
    })
    .join("");
}

export function statusColor(pct: number): string {
  if (pct >= 95) return "var(--color-ok)";
  if (pct >= 50) return "var(--color-warn)";
  return "var(--color-bad)";
}
