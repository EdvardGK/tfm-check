import type { CheckItem, CheckResults } from "./types";

const CHECK_ORDER = [
  "has_code", "bd_valid", "in_discipline", "floor_valid",
  "floor_consistency", "komp_valid",
  "system_prefix", "system_assign", "tfm_system",
];

const ALWAYS = new Set(["has_code", "system_prefix", "system_assign", "tfm_system"]);

// Mirrors backend applicable_checks().
export function applicableChecks(r: CheckResults): [string, CheckItem][] {
  const out: [string, CheckItem][] = [];
  for (const k of CHECK_ORDER) {
    const c = r.checks[k];
    if (k === "floor_valid" && !r.has_floor_check) continue;
    if (k === "komp_valid" && !r.has_komp_check) continue;
    if (k === "bd_valid" && !r.has_bd_check) continue;
    if (k === "in_discipline" && !r.has_disc_check) continue;
    if (k === "floor_consistency" && !r.has_floor_consistency_check) continue;
    if (c.total === 0 && !ALWAYS.has(k)) continue;
    out.push([k, c]);
  }
  return out;
}
