// Headless smoke test of the full flow against a running server (default :8000).
// Usage: node smoke.mjs [baseURL]
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8000";
const RIE = path.resolve(
  "c:/workspace/skiplum/client-projects/10027-grønland-55/underprosjekter/G55_TFM-sjekk/01_Inn/models/G55_RIE.ifc",
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const errors = [];
let step = "start";
const log = (m) => console.log(`  ${m}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

try {
  step = "load";
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "TFM-sjekk" }).waitFor({ timeout: 10000 });
  log("PASS loaded, header visible");

  step = "upload";
  await page.setInputFiles('input[type="file"]', RIE);
  await page.getByText("Auto-oppdaget", { exact: false }).waitFor({ timeout: 30000 });
  log("PASS upload → confirm screen");

  step = "auto-config";
  // RIE discipline button should be active (amber bg → has accent class set inline via classes)
  const rieBtn = page.getByRole("button", { name: "RIE — Elektro" });
  await rieBtn.waitFor();
  const presetCount = await page.getByRole("button", { name: /PA-0802|element-nivå|system-nivå|Minimal/ }).count();
  if (presetCount < 4) throw new Error(`expected 4 presets, got ${presetCount}`);
  log(`PASS auto-config: discipline buttons + ${presetCount} presets`);

  step = "customize";
  await page.getByRole("button", { name: /Tilpass mønster/ }).click();
  await page.getByText("Innhold", { exact: false }).first().waitFor({ timeout: 5000 });
  log("PASS builder opens (palette visible)");
  await page.getByRole("button", { name: /Skjul tilpasning/ }).click();

  step = "run";
  await page.getByRole("button", { name: /Kjør kontroll/ }).click();
  await page.getByText("Elementer med TFM-kode").waitFor({ timeout: 30000 });
  const headline = await page.locator("text=/\\d+\\.\\d%/").first().textContent();
  log(`PASS results rendered, headline ${headline}`);

  step = "drilldown";
  await page.getByRole("button", { name: /Uten kode/ }).click();
  await page.getByText(/rader vist/).waitFor({ timeout: 5000 });
  log("PASS drill-down dialog opens");
  await page.keyboard.press("Escape");

  step = "download";
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: /ZIP \(Excel \+ PDF\)/ }).click(),
  ]);
  const out = path.join(os.tmpdir(), "tfm_smoke.zip");
  await dl.saveAs(out);
  const sz = fs.statSync(out).size;
  if (sz < 1000) throw new Error(`zip too small: ${sz} bytes`);
  log(`PASS report downloaded (${sz} bytes)`);
  fs.unlinkSync(out);
} catch (e) {
  console.error(`\n  FAIL at step "${step}": ${e.message}`);
  await page.screenshot({ path: path.join(__dirname, "smoke-fail.png"), fullPage: true });
  errors.push(`flow: ${e.message}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error("\n==> SMOKE FAILED:\n" + errors.map((e) => "   - " + e).join("\n"));
  process.exit(1);
}
console.log("\n==> SMOKE PASSED");
