// Headless smoke test for the Streamlit app. Usage: node smoke.mjs [baseURL]
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8502";
const RIE = path.resolve(
  "c:/workspace/skiplum/client-projects/10027-grønland-55/underprosjekter/G55_TFM-sjekk/01_Inn/models/G55_RIE.ifc",
);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
let step = "start";

try {
  step = "load";
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("TFM-sjekk").first().waitFor({ timeout: 20000 });
  console.log("  PASS app loaded");

  step = "upload";
  await page.setInputFiles('input[type="file"]', RIE);
  await page.getByText("Merkemønster").waitFor({ timeout: 60000 });
  console.log("  PASS upload → config screen");

  step = "presets";
  for (const label of ["element-nivå", "system-nivå", "PA-0802", "Minimal"]) {
    await page.getByText(label, { exact: false }).first().waitFor({ timeout: 5000 });
  }
  console.log("  PASS preset options present");

  step = "run";
  await page.getByRole("button", { name: /Kjør TFM-sjekk/ }).click();
  await page.getByText(/Resultat —/).waitFor({ timeout: 60000 });
  console.log("  PASS results rendered");

  step = "report";
  await page.getByText("Last ned rapport").waitFor({ timeout: 30000 });
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("button", { name: /ZIP \(Excel \+ PDF\)/ }).click(),
  ]);
  const fn = dl.suggestedFilename();
  console.log(`  PASS report download (${fn})`);

  step = "no-exceptions";
  const traceback = await page.getByText("Traceback").count();
  if (traceback > 0) throw new Error("Streamlit exception (Traceback) shown");
  console.log("  PASS no Streamlit exceptions");
} catch (e) {
  console.error(`\n  FAIL at "${step}": ${e.message}`);
  await page.screenshot({ path: path.join(import.meta.dirname, "smoke-fail.png"), fullPage: true });
  errors.push(e.message);
} finally {
  await browser.close();
}

if (errors.length) {
  console.error("\n==> STREAMLIT SMOKE FAILED");
  process.exit(1);
}
console.log("\n==> STREAMLIT SMOKE PASSED");
