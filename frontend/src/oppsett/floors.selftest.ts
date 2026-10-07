// node src/oppsett/floors.selftest.ts  (Node ≥ 22.18 strips the types)
import assert from "node:assert/strict";
import type { InventoryStorey } from "../types.ts";
import { allowedFloors, floorCode, likelyStyle, mergeCodes, proposeCodes, readCode, reflowCodes } from "./floors.ts";

const st = (name: string, floor: InventoryStorey["floor"]): InventoryStorey => ({ name, elevation: 0, n: 1, floor });

// PA 0603 §5.3
assert.equal(floorCode({ kind: "below", n: 1, mezz: false }, "statsbygg"), "00U");
assert.equal(floorCode({ kind: "below", n: 2, mezz: false }, "statsbygg"), "01U");
assert.equal(floorCode({ kind: "above", n: 2, mezz: true }, "statsbygg"), "02M");
assert.equal(floorCode({ kind: "loft", n: 4, mezz: false }, "statsbygg"), "04L");
assert.equal(floorCode({ kind: "roof", n: 5, mezz: false }, "statsbygg"), "05T");
assert.equal(floorCode(null, "statsbygg"), "XX");
// U style
assert.equal(floorCode({ kind: "below", n: 3, mezz: false }, "u"), "U3");
assert.equal(floorCode({ kind: "below", n: 1, mezz: true }, "u"), "U1M");
assert.equal(floorCode({ kind: "above", n: 1, mezz: false }, "u"), "01");

const storeys = [
  st("Plan 02", { kind: "above", n: 2, mezz: false }),
  st("Plan 01", { kind: "above", n: 1, mezz: false }),
  st("Plan U1", { kind: "below", n: 1, mezz: false }),
  st("Havnivå", null),
];
assert.deepEqual(proposeCodes(storeys, "u"), { "Plan 02": "02", "Plan 01": "01", "Plan U1": "U1", Havnivå: "XX" });
assert.deepEqual(allowedFloors({ a: "01", b: "U1", c: "02M", d: "XX", e: " " }).sort(), ["01", "01M", "02M", "U1", "U1M", "XX"].sort());

// The model's codes decide the style; nothing seen keeps Statsbygg.
assert.equal(likelyStyle(storeys, [{ code: "U1", n: 50 }, { code: "01", n: 10 }]), "u");
assert.equal(likelyStyle(storeys, [{ code: "00U", n: 5 }]), "statsbygg");
assert.equal(likelyStyle(storeys, []), "statsbygg");

// A saved mapping keeps its codes for storeys the model has.
assert.deepEqual(mergeCodes(storeys, { "Plan 01": "1", Gone: "9" }, "u"), {
  "Plan 02": "02",
  "Plan 01": "1",
  "Plan U1": "U1",
  Havnivå: "XX",
});

// Reflow: a typed code is sticky, and the sequence resumes from it.
const tower = [
  st("Plan 03", { kind: "above", n: 3, mezz: false }),
  st("Plan 2M", { kind: "above", n: 2, mezz: true }),
  st("Plan 02", { kind: "above", n: 2, mezz: false }),
  st("Plan 01", { kind: "above", n: 1, mezz: false }),
  st("Plan U1", { kind: "below", n: 1, mezz: false }),
  st("Plan U2", { kind: "below", n: 2, mezz: false }),
  st("Havnivå", null),
];
assert.deepEqual(reflowCodes(tower, "u", {}), {
  "Plan 03": "03", "Plan 2M": "02M", "Plan 02": "02", "Plan 01": "01", "Plan U1": "U1", "Plan U2": "U2", Havnivå: "XX",
});
assert.deepEqual(reflowCodes(tower, "u", { "Plan 02": "05" }), {
  "Plan 03": "06", "Plan 2M": "05M", "Plan 02": "05", "Plan 01": "01", "Plan U1": "U1", "Plan U2": "U2", Havnivå: "XX",
});
assert.deepEqual(reflowCodes(tower, "statsbygg", { "Plan U1": "01U", Havnivå: "00" }), {
  "Plan 03": "03", "Plan 2M": "02M", "Plan 02": "02", "Plan 01": "01", "Plan U1": "01U", "Plan U2": "02U", Havnivå: "00",
});
// A typed code that reads as no floor number holds, and the rest stay put.
assert.equal(reflowCodes(tower, "u", { "Plan 02": "X" })["Plan 03"], "03");
assert.equal(readCode("00U", "below", "statsbygg"), 1);
assert.equal(readCode("U3M", "below", "u"), 3);
assert.equal(readCode("XX", "above", "u"), null);

console.log("floors selftest: ok");
