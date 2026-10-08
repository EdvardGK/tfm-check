/** The Oppsett walk, pure: its steps, the Statsbygg standard, the saved
 *  setup file, and how a step's result reads. */

import { ASPECTS, type Aspect, type Inventory, type Location, type Preview, type RulesDict, type UploadResponse } from "../types.ts";
import { allowedFloors, proposeCodes } from "./floors.ts";
import { AGENT_MD } from "./agentMd.ts";

/** The walk, in order. «start» is the choice, «end» Oppsummering. */
export const WALK = ["ifc", "kilde", "format", "etasjer", "scope", "status"] as const;
export type WalkStep = (typeof WALK)[number];
export type Step = "start" | WalkStep | "end";

export const STEP_NAME: Record<Step, string> = {
  start: "Oppsett",
  ifc: "Åpne IFC",
  kilde: "Kilde",
  format: "Format",
  etasjer: "Etasjer",
  scope: "Scope",
  status: "Status",
  end: "Oppsummering",
};

export type Base = "statsbygg" | "custom";

/** Statsbygg: where the TFM code lives (the NOSSB property sets). */
export const STANDARD_LOCATION: Location = ["pset", "NOSSB_Reference", "RefString"];

/** Statsbygg: the sources of a code composed from its aspects (NOSSB). */
export const PART_STANDARD: Record<Aspect, Location> = {
  lokasjon: ["pset", "NOSSB_Reference", "RefPriSysLoc"],
  system: ["pset", "NOSSB_Reference", "RefPriSysOcc"],
  komponent: ["pset", "NOSSB_Reference", "RefCompOcc"],
};

/** The MMI (status) code's standard source (NS 8360-1 / POFIN). */
export const STATUS_STANDARD: Location = ["pset", "NONS_Process", "ProcessStatus"];

export const ASPECT_NAME: Record<Aspect, string> = { lokasjon: "Lokasjon", system: "System", komponent: "Komponent" };
export const ASPECT_SIGN: Record<Aspect, string> = { lokasjon: "+", system: "=", komponent: "-" };

/** Statsbygg PA 0802 rev.3: +Lokasjon=Systemkode.Løpenummer-KomponentKomp.nr */
export const STATSBYGG_SEQUENCE = [
  "+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr",
];
/** ... and a system without a component: +Lokasjon=Systemkode.Løpenummer */
export const STATSBYGG_SYSTEM_SEQUENCE = ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer"];
export const STATSBYGG_PATTERNS = [STATSBYGG_SEQUENCE, STATSBYGG_SYSTEM_SEQUENCE];
export const STATSBYGG_EXAMPLE = "+123456=360.001-JV401";

export function statsbyggRules(discipline: string | null): RulesDict {
  return {
    project_name: "",
    discipline_key: discipline ?? "Annet",
    bygningsdel_system: "NS3451",
    komponent_system: "NS3457-8",
    patterns: STATSBYGG_PATTERNS.map((p) => ({ sequence: [...p] })),
    part_digits: {},
    tfm_location: [...STANDARD_LOCATION] as Location,
    tfm_mode: "whole",
    tfm_parts: { ...PART_STANDARD },
    status_location: [...STATUS_STANDARD] as Location,
    floor_codes: [],
    storey_codes: {},
    floor_style: "statsbygg",
    scope_components: [],
    scope_types: [],
  };
}

/** Statsbygg's floors laid on a loaded model. */
export function withStatsbyggFloors(rules: RulesDict, inv: Inventory): RulesDict {
  const codes = proposeCodes(inv.storeys, "statsbygg");
  return { ...rules, storey_codes: codes, floor_codes: allowedFloors(codes), floor_style: "statsbygg" };
}

export const sameLocation = (a: Location | undefined, b: Location | undefined) =>
  JSON.stringify(a ?? ["all", null, null]) === JSON.stringify(b ?? ["all", null, null]);

export const isComposed = (rules: RulesDict) => rules.tfm_mode === "parts";

export const isStandardSource = (rules: RulesDict) =>
  isComposed(rules)
    ? ASPECTS.every((a) => sameLocation(rules.tfm_parts?.[a], PART_STANDARD[a]))
    : sameLocation(rules.tfm_location, STANDARD_LOCATION);

export const isStandardFormat = (rules: RulesDict) =>
  JSON.stringify(rules.patterns.map((p) => p.sequence)) === JSON.stringify(STATSBYGG_PATTERNS);

/** Where the code is read from, as it prints: the source, or the aspects'
 *  sources behind their signs. */
export function sourceText(rules: RulesDict): string {
  if (!isComposed(rules)) return locationText(rules.tfm_location);
  return ASPECTS.filter((a) => rules.tfm_parts?.[a])
    .map((a) => `${ASPECT_SIGN[a]} ${rules.tfm_parts?.[a]?.[2] ?? ""}`)
    .join("  ");
}

/** A source as it prints: `Pset.Prop`, the attribute, or «Alle felt». */
export function locationText(loc: Location | undefined): string {
  const [kind, set, prop] = loc ?? ["all", null, null];
  if (kind === "pset") return `${set}.${prop}`;
  if (kind === "attr") return prop ?? "";
  return "Alle felt";
}

/** Elements carrying a value in the source, from the inventory. null:
 *  not countable (Alle felt). */
export function sourceCount(inv: Inventory, loc: Location | undefined): number | null {
  const [kind, set, prop] = loc ?? ["all", null, null];
  if (kind === "pset") {
    const s = inv.sets.find((x) => x.name === set);
    return s?.props.find((p) => p.name === prop)?.n ?? 0;
  }
  if (kind === "attr") return inv.attributes.find((a) => a.name === prop)?.n ?? 0;
  return null;
}

// ---- Results, as the engine grades them (constants.THRESHOLDS) ----

export type Verdict = "ok" | "warn" | "fail" | "na";

export function verdictOf(n: number, total: number): Verdict {
  if (total === 0) return "na";
  const pct = (n / total) * 100;
  if (pct >= 95) return "ok";
  if (pct >= 50) return "warn";
  return "fail";
}

export const VERDICT_WORD: Record<Verdict, string> = {
  ok: "OK",
  warn: "Advarsel",
  fail: "Avvik",
  na: "–",
};

export const VERDICT_FILL: Record<Verdict, string> = {
  ok: "bg-green text-cream",
  warn: "bg-gold text-ink",
  fail: "bg-bad text-cream",
  na: "bg-muted text-cream",
};

export interface StepResult {
  verdict: Verdict;
  /** `n / N`, with what N counts. */
  figure: string;
}

const nb = new Intl.NumberFormat("nb-NO");
export const fmt = (n: number) => nb.format(n);
export const of = (n: number, total: number) => `${fmt(n)} / ${fmt(total)}`;

/** Kilde: found or not. Mapping is the infrastructure: any element
 *  carrying the source is a found source; 0 is a fail. A composed code
 *  counts the elements carrying any of its aspects (from the preview). */
export function sourceResult(inv: Inventory, rules: RulesDict, preview: Preview | null): StepResult | null {
  const n = isComposed(rules) ? (preview ? preview.valued : null) : sourceCount(inv, rules.tfm_location);
  if (n === null) return null;
  return { verdict: n > 0 ? "ok" : "fail", figure: of(n, inv.products) };
}

/** Status: the MMI source found or not; not set is no result. */
export function statusResult(inv: Inventory, rules: RulesDict): StepResult | null {
  if (!rules.status_location) return null;
  const n = sourceCount(inv, rules.status_location) ?? 0;
  return { verdict: n > 0 ? "ok" : "fail", figure: of(n, inv.products) };
}

export function formatResult(p: Preview | null): StepResult | null {
  if (p === null || !p.countable) return null;
  return { verdict: verdictOf(p.matched, p.valued), figure: of(p.matched, p.valued) };
}

export function floorResult(p: Preview | null): StepResult | null {
  if (p === null || !p.floor_part || p.floors.total === 0) return null;
  return { verdict: verdictOf(p.floors.ok, p.floors.total), figure: of(p.floors.ok, p.floors.total) };
}

// ---- The setup file («Lagre oppsett» / «Åpne regelsett») ----
//
// A ruleset is keyed by discipline (fag): the rules for RIV apply to every
// RIV model, read off the file name (<PROSJEKT>_<FAG>.ifc). «*» holds the
// rules of a setup saved without a discipline.

const FILE_KEY = "tfm_sjekk_oppsett";
const STORE_KEY = "tfm_sjekk_oppsett";
export const ANY_FAG = "*";

export interface SetupFile {
  base: Base;
  fag: Record<string, RulesDict>;
}

/** The rules a setup holds for a discipline, else its «*» rules. */
export function rulesFor(file: SetupFile | null, fag: string | null): RulesDict | null {
  if (!file) return null;
  return (fag ? file.fag[fag] : undefined) ?? file.fag[ANY_FAG] ?? null;
}

/** The setup with this discipline's rules put in (or replaced). */
export function withFag(file: SetupFile | null, base: Base, fag: string | null, rules: RulesDict): SetupFile {
  return { base: file?.base ?? base, fag: { ...(file?.fag ?? {}), [fag ?? ANY_FAG]: rules } };
}

/** The ruleset file, with agent.md (its format, for AI agents) inside. */
export function setupJson(file: SetupFile): string {
  return JSON.stringify({ [FILE_KEY]: 2, agent_md: AGENT_MD, base: file.base, fag: file.fag }, null, 2);
}

const fill = (rules: RulesDict): RulesDict => ({ ...statsbyggRules(rules.discipline_key ?? null), ...rules });

/** A saved setup: by discipline (2), one rules dict (1), or a bare rules
 *  dict (the May app's template). */
export function parseSetup(text: string): SetupFile {
  const data = JSON.parse(text) as Record<string, unknown>;
  const base: Base = data.base === "statsbygg" ? "statsbygg" : "custom";
  if (data[FILE_KEY] === 2 && data.fag && typeof data.fag === "object") {
    const fag: Record<string, RulesDict> = {};
    for (const [k, r] of Object.entries(data.fag as Record<string, RulesDict>)) {
      if (r && Array.isArray(r.patterns)) fag[k] = fill(r);
    }
    if (Object.keys(fag).length === 0) throw new Error("Filen er ikke et oppsett.");
    return { base, fag };
  }
  const rules = (data[FILE_KEY] ? data.rules : data) as RulesDict | undefined;
  if (!rules || !Array.isArray(rules.patterns)) throw new Error("Filen er ikke et oppsett.");
  return { base, fag: { [ANY_FAG]: fill(rules) } };
}

/** The setup kept in this browser (restored on load, written on save). */
export function loadStoredSetup(): SetupFile | null {
  try {
    const text = localStorage.getItem(STORE_KEY);
    return text ? parseSetup(text) : null;
  } catch {
    return null;
  }
}

export function storeSetup(file: SetupFile): void {
  try {
    localStorage.setItem(STORE_KEY, setupJson(file));
  } catch {
    /* storage blocked: the file download still holds it */
  }
}

export function setupFileName(rules: RulesDict, upload: UploadResponse | null): string {
  const stem =
    (rules.project_name ?? "").trim() || (upload ? upload.file_name.replace(/\.ifc(zip)?$/i, "").split("_")[0] : "") || "tfm";
  return `${stem.replace(/[\\/:*?"<>|]+/g, "_")}_tfm-oppsett.json`;
}

export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Read off the file before the server has it ----

const FAG_IN_NAME = /^[^_]+_([A-Za-zÆØÅæøå]{2,6})(?:[_.\- ]|$)/;
const FAG_KNOWN: [string, RegExp][] = [
  ["RIBR", /(?<![A-Za-z])RIBR(?![A-Za-z])|RIBfy/i],
  ["RIE", /(?<![A-Za-z])RIE(?![A-Za-z])/i],
  ["RIV", /(?<![A-Za-z])RIV(?![A-Za-z])/i],
  ["RIB", /(?<![A-Za-z])RIB(?![A-Za-z])/i],
  ["ARK", /(?<![A-Za-z])I?ARK(?![A-Za-z])/i],
];

/** The discipline a model file is named for, as the server reads it
 *  (engine/ifc_io.py detect_discipline_from_filename). */
export function fagFromName(name: string): string | null {
  const m = FAG_IN_NAME.exec(name);
  if (m) return m[1].toUpperCase();
  return FAG_KNOWN.find(([, rx]) => rx.test(name))?.[0] ?? null;
}

/** The schema from the file's header (FILE_SCHEMA), read in the browser. */
export async function schemaFromHeader(file: File): Promise<string | null> {
  if (/\.ifczip$/i.test(file.name)) return null;
  try {
    const head = await file.slice(0, 16384).text();
    return /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(head)?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}
