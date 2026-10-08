// Shared types — mirror the backend payloads.

export type Token = string; // part name | separator key | "T:freetext"
export type Location = [string, string | null, string | null];

export interface RulesDict {
  project_name?: string;
  discipline_key: string;
  bygningsdel_system: string;
  komponent_system: string;
  patterns: { sequence: Token[] }[];
  floor_codes?: string[];
  tfm_location?: Location;
  part_digits?: Record<string, number>;
  /** Etasjer: each model storey's floor code, and the style proposed. */
  storey_codes?: Record<string, string>;
  floor_style?: string;
  /** The storeys whose code was typed (sticky; the others follow the style). */
  storey_manual?: string[];
  /** Scope: component codes and type names left out of every check. */
  scope_components?: string[];
  scope_types?: string[];
  /** Kilde: the whole code in tfm_location, or composed from the aspects'
   *  sources (+lokasjon =system -komponent). */
  tfm_mode?: TfmMode;
  tfm_parts?: Partial<Record<Aspect, Location>>;
  /** Status: the source of the element's MMI code. */
  status_location?: Location | null;
}

export type TfmMode = "whole" | "parts";
export const ASPECTS = ["lokasjon", "system", "komponent"] as const;
export type Aspect = (typeof ASPECTS)[number];
export type Role = Aspect | "status";

export interface Preset {
  id: string;
  label: string;
  discipline: string;
  description: string;
  example: string;
  rules: RulesDict;
}

export interface ModelFacts {
  schema: string;
  storey_names: string[];
  n_systems: number;
  n_products: number;
  originating_system: string;
}

export interface SuggestedField {
  location: Location;
  label: string;
}

export interface UploadResponse {
  upload_id: string;
  file_name: string;
  file_size: number;
  facts: ModelFacts;
  psets: Record<string, string[]>;
  storeys: string[];
  detected_discipline: string | null;
  suggested_preset: string;
  suggested_field: SuggestedField;
  load_seconds: number;
}

export interface CheckItem {
  n: number;
  total: number;
  pct: number;
  label: string;
}

export interface CheckResults {
  n_total: number;
  checks: Record<string, CheckItem>;
  has_floor_check: boolean;
  has_komp_check: boolean;
  has_bd_check: boolean;
  has_disc_check: boolean;
  has_floor_consistency_check: boolean;
  structures: string[];
  cross_disc: Record<string, number>;
  invalid_bd: Record<string, number>;
  invalid_komp: Record<string, number>;
  floor_mismatch: Record<string, number>;
  seen_systemkode: Record<string, number>;
  seen_systems: Record<string, number>;
  seen_components: Record<string, number>;
  seen_floors: Record<string, number>;
  missing_samples: Record<string, string>[];
  invalid_samples: Record<string, string>[];
  code_samples: Record<string, string>[];
  type_rows: Record<string, string | number>[];
  sys_rows: Record<string, string>[];
  unassigned_by_type: Record<string, number>;
  bd_sys_label: string;
  komp_sys_label: string;
  vvs_bands: Record<string, number>;
  vvs_lopenummer_total: number;
}

export interface CheckResponse {
  results: CheckResults;
  duration: number;
  location_label: string;
}

// ---- Oppsett walk (backend/engine/inventory.py) ----

export interface ValueCount {
  v: string;
  n: number;
}

export interface InventoryProp {
  name: string;
  n: number;
  distinct: number;
  samples: ValueCount[];
}

export interface InventorySet {
  name: string;
  n: number;
  props: InventoryProp[];
}

export interface StoreyFloor {
  kind: "below" | "above" | "loft" | "roof";
  n: number;
  mezz: boolean;
}

export interface InventoryStorey {
  name: string;
  elevation: number | null;
  n: number;
  floor: StoreyFloor | null;
}

export interface Inventory {
  products: number;
  standard: { location: Location; n: number };
  sets: InventorySet[];
  attributes: InventoryProp[];
  candidates: Candidate[];
  roles: Record<Role, { standard: { location: Location; n: number }; candidates: Candidate[] }>;
  storeys: InventoryStorey[];
}

export interface Candidate {
  location: Location;
  n: number;
  matched: number;
}

export type Phase = "ny" | "bevares" | "ombruk" | "rives" | "";

/** One source's values (POST /api/values). */
export interface SourceValues {
  products: number;
  valued: number;
  distinct: number;
  values: (ValueCount & { phase: Phase })[];
  phases: Record<Phase, number>;
}

/** A value off the form: why, and the mechanical fix when there is one. */
export interface OffValue extends ValueCount {
  reason: string;
  fix: string;
}

/** A source's value: whether it takes the form, whether it is shaped like
 *  a TFM code at all, and where each part of the form falls in it. */
export interface PreviewValue extends ValueCount {
  ok: boolean;
  shaped: boolean;
  /** [template part name, start, end] */
  spans: [string, number, number][];
}

export interface Preview {
  products: number;
  excluded: number;
  in_scope: number;
  countable: boolean;
  valued: number;
  matched: number;
  off: OffValue[];
  off_distinct: number;
  distinct: number;
  values: PreviewValue[];
  shaped: number;
  unshaped: ValueCount[];
  floor_part: boolean;
  floors: { total: number; ok: number; seen: { code: string; n: number; ok: boolean }[] };
  components: { code: string; n: number }[];
  types: { name: string; n: number; out: number }[];
}
