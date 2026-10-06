import type { Preset, RulesDict, UploadResponse } from "./types";

const NS_RANGE: Record<string, string[]> = {
  RIE: ["4", "5"], RIV: ["3"], RIB: ["2"], ARK: ["2", "7"], RIBR: ["5"], Annet: [],
};

export function usedParts(rules: RulesDict): Set<string> {
  const s = new Set<string>();
  for (const p of rules.patterns) for (const t of p.sequence) s.add(t);
  return s;
}

const LAST_PROJECT_KEY = "tfm.lastProject";

export function loadLastProject(): string {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
}
export function saveLastProject(name: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, name);
  } catch {
    /* ignore */
  }
}

// Auto-config: combine the suggested preset with detected discipline, suggested
// field and extracted storeys into the editable rules the confirm screen shows.
export function buildInitialConfig(up: UploadResponse, presets: Preset[]): RulesDict {
  const preset = presets.find((p) => p.id === up.suggested_preset) ?? presets[0];
  const r = preset.rules;
  return {
    project_name: loadLastProject(),
    discipline_key: up.detected_discipline ?? r.discipline_key ?? "Annet",
    bygningsdel_system: r.bygningsdel_system ?? "NS3451",
    komponent_system: r.komponent_system ?? "IEC81346",
    patterns: r.patterns.map((p) => ({ sequence: [...p.sequence] })),
    floor_codes: [...up.storeys],
    tfm_location: up.suggested_field.location,
    part_digits: { ...(r.part_digits ?? {}) },
  };
}

// Apply a preset's pattern + classification while keeping the user's discipline,
// field and floor list unless the preset is discipline-specific.
export function applyPreset(preset: Preset, current: RulesDict): RulesDict {
  const r = preset.rules;
  return {
    ...current,
    discipline_key:
      r.discipline_key && r.discipline_key !== "Annet"
        ? r.discipline_key
        : current.discipline_key,
    bygningsdel_system: r.bygningsdel_system ?? current.bygningsdel_system,
    komponent_system: r.komponent_system ?? current.komponent_system,
    patterns: r.patterns.map((p) => ({ sequence: [...p.sequence] })),
    part_digits: { ...(r.part_digits ?? {}) },
  };
}

export interface CheckLine {
  label: string;
  active: boolean;
  hint?: string;
}

// Human summary of which checks will run given the current rules.
export function checksSummary(rules: RulesDict): CheckLine[] {
  const parts = usedParts(rules);
  const hasFloorList = (rules.floor_codes?.length ?? 0) > 0;
  const ns = NS_RANGE[rules.discipline_key] ?? [];
  const lines: CheckLine[] = [
    { label: "Element har TFM-kode", active: true },
    {
      label: `Systemkode gyldig i ${rules.bygningsdel_system}`,
      active: parts.has("Systemkode") && rules.bygningsdel_system !== "Ingen",
      hint: !parts.has("Systemkode") ? "krever Systemkode-ledd" : undefined,
    },
    {
      label: `I forventet område for ${rules.discipline_key}`,
      active: parts.has("Systemkode") && ns.length > 0 && rules.bygningsdel_system !== "Ingen",
      hint: ns.length === 0 ? "ingen område for disiplin" : undefined,
    },
    {
      label: "Etasjekode i tillatt liste",
      active: parts.has("Etasje") && hasFloorList,
      hint: !hasFloorList ? "ingen etasjeliste" : undefined,
    },
    {
      label: `Komponent gyldig i ${rules.komponent_system}`,
      active: parts.has("Komponent") && rules.komponent_system !== "Ingen",
      hint: !parts.has("Komponent") ? "krever Komponent-ledd" : undefined,
    },
    { label: "IfcSystem-navn har TFM-prefiks", active: true },
    { label: "Element tildelt IfcSystem", active: true },
    { label: "Tildelt TFM-navnet system", active: true },
  ];
  return lines;
}
