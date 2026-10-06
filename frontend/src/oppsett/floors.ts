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
