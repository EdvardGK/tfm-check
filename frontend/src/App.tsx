import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";

import { getPresets, runCheck, uploadIfc } from "./api";
import { buildInitialConfig, saveLastProject } from "./derive";
import type { CheckResponse, Preset, RulesDict, UploadResponse } from "./types";
import UploadDropzone from "./components/UploadDropzone";
import ConfirmPanel from "./components/ConfirmPanel";
import ResultsDashboard from "./components/ResultsDashboard";

type Stage = "upload" | "confirm" | "results";

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stage, setStage] = useState<Stage>("upload");
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [config, setConfig] = useState<RulesDict | null>(null);
  const [check, setCheck] = useState<CheckResponse | null>(null);

  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPresets().then(setPresets).catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function handleUpload(file: File) {
    setError(null);
    setUploadPct(0);
    try {
      const res = await uploadIfc(file, (pct) => {
        setUploadPct(pct);
        if (pct >= 100) setParsing(true);
      });
      setParsing(false);
      setUploadPct(null);
      setUpload(res);
      setConfig(buildInitialConfig(res, presets));
      setCheck(null);
      setStage("confirm");
    } catch (e) {
      setParsing(false);
      setUploadPct(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRun() {
    if (!upload || !config) return;
    setError(null);
    setChecking(true);
    try {
      saveLastProject(config.project_name ?? "");
      const res = await runCheck(upload.upload_id, config);
      setCheck(res);
      setStage("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  function handleReset() {
    setUpload(null);
    setConfig(null);
    setCheck(null);
    setError(null);
    setStage("upload");
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-surface-fg shadow-sm">
            <ScanSearch size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">TFM-sjekk</h1>
            <p className="text-sm text-muted">
              Mottakskontroll på TFM-merking i IFC-fagmodeller
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error}
          </div>
        )}

        <div key={stage} className="stage-in">
          {stage === "upload" && (
            <UploadDropzone
              onUpload={handleUpload}
              uploadPct={uploadPct}
              parsing={parsing}
            />
          )}

          {stage === "confirm" && upload && config && (
            <ConfirmPanel
              upload={upload}
              config={config}
              setConfig={setConfig}
              presets={presets}
              onRun={handleRun}
              checking={checking}
              onReset={handleReset}
            />
          )}

          {stage === "results" && upload && config && check && (
            <ResultsDashboard
              upload={upload}
              config={config}
              check={check}
              onAdjust={() => setStage("confirm")}
              onReset={handleReset}
            />
          )}
        </div>

        <footer className="mt-12 text-center text-xs text-subtle">
          Skiplum · TFM-sjekk · ingen elementnavn eller verdier forlater verktøyet
        </footer>
      </div>
    </div>
  );
}
