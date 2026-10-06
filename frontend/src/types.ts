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
}

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
