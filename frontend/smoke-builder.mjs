// Focused test of the PatternBuilder editing logic (add/remove tokens, emit→merge).
import { chromium } from "playwright";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8000";
const RIE = path.resolve(
  "c:/workspace/skiplum/client-projects/10027-grønland-55/underprosjekter/G55_TFM-sjekk/01_Inn/models/G55_RIE.ifc",
);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const chipCount = () =>
  page.locator("div.min-h-10 > span").count();

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', RIE);
  await page.getByText("Auto-oppdaget", { exact: false }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Tilpass mønster/ }).click();
  await page.getByText("Innhold", { exact: false }).first().waitFor();

  const before = await chipCount();
  // Add a "Subnr" content block via the palette.
  await page.getByRole("button", { name: "Subnr", exact: true }).click();
  await page.waitForTimeout(150);
  const afterAdd = await chipCount();
  if (afterAdd !== before + 1) throw new Error(`add: expected ${before + 1} chips, got ${afterAdd}`);
  console.log(`  PASS add token (${before} → ${afterAdd})`);

  // Remove first chip via its × button.
  await page.locator("div.min-h-10 > span button[aria-label='Fjern blokk']").first().click();
  await page.waitForTimeout(150);
  const afterRemove = await chipCount();
  if (afterRemove !== afterAdd - 1) throw new Error(`remove: expected ${afterAdd - 1}, got ${afterRemove}`);
  console.log(`  PASS remove token (${afterAdd} → ${afterRemove})`);

  // Add a free-text block.
  await page.getByPlaceholder("skriv tekst…").fill("ABC");
  await page.getByRole("button", { name: /Legg til/ }).first().click();
  await page.waitForTimeout(150);
  const afterFt = await chipCount();
  if (afterFt !== afterRemove + 1) throw new Error(`freetext: expected ${afterRemove + 1}, got ${afterFt}`);
  console.log(`  PASS add free-text (${afterRemove} → ${afterFt})`);

  // Edits must survive a run (config merge intact).
  await page.getByRole("button", { name: /Kjør kontroll/ }).click();
  await page.getByText("Elementer med TFM-kode").waitFor({ timeout: 30000 });
  console.log("  PASS run after edits");
} catch (e) {
  console.error(`\n  FAIL: ${e.message}`);
  errors.push(e.message);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error("\n==> BUILDER TEST FAILED:\n" + errors.map((e) => "   - " + e).join("\n"));
  process.exit(1);
}
console.log("\n==> BUILDER TEST PASSED");
