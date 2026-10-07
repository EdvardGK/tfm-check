/** Etasjer, pure: a storey's proposed floor written in a floor style, the
 *  codes a mapping allows, and which style the model's own codes are in.
 *
 *  Statsbygg (PA 0603 §5.3): 00U is the first floor below ground, then 01U,
 *  02U …; 01, 02, 03 … above; 02M mezzanine over the 2nd floor; 04L loft;
 *  05T tak; XX not tied to a floor.
 *  U style (ST28): U1, U2, U3 … below; 01, 02 … above.
 *  Either way an M suffix is valid on any configured floor.
 */

import type { InventoryStorey, StoreyFloor } from "../types.ts";

export type FloorStyle = "statsbygg" | "u" | "custom";

export const NOT_A_FLOOR = "XX";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** One storey's floor in a style. A storey whose name reads as no floor
 *  (Havnivå) is not tied to a floor. */
export function floorCode(floor: StoreyFloor | null, style: "statsbygg" | "u"): string {
  if (floor === null) return NOT_A_FLOOR;
  const m = floor.mezz ? "M" : "";
  switch (floor.kind) {
    case "below":
      return (style === "statsbygg" ? `${pad2(Math.max(0, floor.n - 1))}U` : `U${floor.n}`) + m;
    case "above":
      return pad2(floor.n) + m;
    case "loft":
      return `${pad2(floor.n)}L`;
    case "roof":
      return `${pad2(floor.n)}T`;
  }
}

/** Every storey's code in a style, by storey name. */
export function proposeCodes(
  storeys: readonly InventoryStorey[],
  style: "statsbygg" | "u",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of storeys) out[s.name] = floorCode(s.floor, style);
  return out;
}

/** The codes a mapping allows: each storey's code and the code with M. */
export function allowedFloors(codes: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const raw of Object.values(codes)) {
    const c = raw.trim();
    if (!c) continue;
    out.add(c);
    if (c !== NOT_A_FLOOR && !c.endsWith("M")) out.add(`${c}M`);
  }
  return [...out];
}

/** The style the floor codes in the model's values are written in: the one
 *  whose allowed codes cover the most elements. Statsbygg on a tie or with
 *  nothing seen. */
export function likelyStyle(
  storeys: readonly InventoryStorey[],
  seen: readonly { code: string; n: number }[],
): "statsbygg" | "u" {
  const score = (style: "statsbygg" | "u") => {
    const allowed = new Set(allowedFloors(proposeCodes(storeys, style)));
    return seen.reduce((sum, s) => sum + (allowed.has(s.code) ? s.n : 0), 0);
  };
  return score("u") > score("statsbygg") ? "u" : "statsbygg";
}

/** A typed code read back as a floor number in a style, or null when it
 *  does not read as one (XX, 04L, free text). */
export function readCode(code: string, kind: StoreyFloor["kind"], style: "statsbygg" | "u"): number | null {
  const c = code.trim().toUpperCase();
  if (kind === "below") {
    const m = style === "statsbygg" ? /^(\d{1,2})UM?$/.exec(c) : /^U(\d{1,2})M?$/.exec(c);
    if (!m) return null;
    return style === "statsbygg" ? Number(m[1]) + 1 : Number(m[1]);
  }
  const m = /^(\d{1,2})M?$/.exec(c);
  return m ? Number(m[1]) : null;
}

/** Every storey's code (canon 2026-08-16, "a config table must not hand
 *  the user a blank row"): a typed code is sticky and is never overwritten;
 *  every other code follows the style, and the sequence RESUMES from a
 *  typed code. Above ground counts up from the lowest storey, below ground
 *  down from the highest, so a typed «03» on Plan 02 makes the auto codes
 *  above it 04, 05 …. Storeys come top to bottom (the inventory's order). */
export function reflowCodes(
  storeys: readonly InventoryStorey[],
  style: "statsbygg" | "u",
  manual: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Above ground (and loft, roof): bottom-up.
  let up = 0;
  for (let i = storeys.length - 1; i >= 0; i--) {
    const s = storeys[i];
    const f = s.floor;
    if (f === null || f.kind === "below") continue;
    const typed = manual[s.name];
    if (typed !== undefined) {
      out[s.name] = typed;
      const n = f.kind === "above" ? readCode(typed, "above", style) : null;
      if (n !== null) up = n - f.n;
      continue;
    }
    out[s.name] = floorCode({ ...f, n: f.n + up }, style);
  }
  // Below ground: top-down, deeper is a higher number.
  let down = 0;
  for (const s of storeys) {
    const f = s.floor;
    if (f === null || f.kind !== "below") continue;
    const typed = manual[s.name];
    if (typed !== undefined) {
      out[s.name] = typed;
      const n = readCode(typed, "below", style);
      if (n !== null) down = n - f.n;
      continue;
    }
    out[s.name] = floorCode({ ...f, n: Math.max(1, f.n + down) }, style);
  }
  for (const s of storeys) if (s.floor === null) out[s.name] = manual[s.name] ?? NOT_A_FLOOR;
  return out;
}

/** A saved mapping laid over a model: the saved code for a storey the
 *  model has, else the style's proposal (Statsbygg for a custom one). */
export function mergeCodes(
  storeys: readonly InventoryStorey[],
  saved: Record<string, string>,
  style: FloorStyle,
): Record<string, string> {
  const proposed = proposeCodes(storeys, style === "u" ? "u" : "statsbygg");
  const out: Record<string, string> = {};
  for (const s of storeys) out[s.name] = saved[s.name] ?? proposed[s.name];
  return out;
}
