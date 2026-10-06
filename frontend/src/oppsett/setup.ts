/** The Oppsett walk, pure: its steps, the Statsbygg standard, the saved
 *  setup file, and how a step's result reads. */

import type { Inventory, Location, Preview, RulesDict, UploadResponse } from "../types.ts";
import { allowedFloors, proposeCodes } from "./floors.ts";

/** The walk, in order. «start» is the choice, «end» Oppsummering. */
export const WALK = ["ifc", "kilde", "format", "etasjer", "scope"] as const;
export type WalkStep = (typeof WALK)[number];
export type Step = "start" | WalkStep | "end";

export const STEP_NAME: Record<Step, string> = {
  start: "Oppsett",
  ifc: "Åpne IFC",
  kilde: "Kilde",
  format: "Format",
  etasjer: "Etasjer",
  scope: "Scope",
  end: "Oppsummering",
};

export type Base = "statsbygg" | "custom";

/** Statsbygg: where the TFM code lives (the NOSSB property sets). */
export const STANDARD_LOCATION: Location = ["pset", "NOSSB_Reference", "RefString"];

/** Statsbygg PA 0802 rev.3: +Lokasjon=Systemkode.Løpenummer-KomponentKomp.nr */
export const STATSBYGG_SEQUENCE = [
  "+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr",
];
export const STATSBYGG_EXAMPLE = "+123456=360.001-JV401";

export function statsbyggRules(discipline: string | null): RulesDict {
  return {
    project_name: "",
    discipline_key: discipline ?? "Annet",
    bygningsdel_system: "NS3451",
    komponent_system: "IEC81346",
    patterns: [{ sequence: [...STATSBYGG_SEQUENCE] }],
    part_digits: {},
    tfm_location: [...STANDARD_LOCATION] as Location,
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

export const isStandardSource = (rules: RulesDict) => sameLocation(rules.tfm_location, STANDARD_LOCATION);

export const isStandardFormat = (rules: RulesDict) =>
  rules.patterns.length === 1 &&
  JSON.stringify(rules.patterns[0].sequence) === JSON.stringify(STATSBYGG_SEQUENCE);

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
 *  carrying the source is a found source; 0 is a fail. */
export function sourceResult(inv: Inventory, rules: RulesDict): StepResult | null {
  const n = sourceCount(inv, rules.tfm_location);
  if (n === null) return null;
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

const FILE_KEY = "tfm_sjekk_oppsett";

export interface SetupFile {
  base: Base;
  rules: RulesDict;
}

export function setupJson(base: Base, rules: RulesDict): string {
  return JSON.stringify({ [FILE_KEY]: 1, base, rules }, null, 2);
}

/** A saved setup, or a bare rules dict (the May app's template). */
export function parseSetup(text: string): SetupFile {
  const data = JSON.parse(text) as Record<string, unknown>;
  const rules = (data[FILE_KEY] ? data.rules : data) as RulesDict | undefined;
  if (!rules || !Array.isArray(rules.patterns)) throw new Error("Filen er ikke et oppsett.");
  const base = data.base === "statsbygg" ? "statsbygg" : "custom";
  return {
    base,
    rules: {
      ...statsbyggRules(rules.discipline_key ?? null),
      ...rules,
    },
  };
}

export function setupFileName(rules: RulesDict, upload: UploadResponse | null): string {
  const stem =
    (rules.project_name ?? "").trim() || (upload ? upload.file_name.replace(/\.ifc$/i, "") : "") || "tfm";
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
