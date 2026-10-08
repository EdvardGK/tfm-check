import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";

import { getPresets, runCheck } from "./api";
import { saveLastProject } from "./derive";
import type { CheckResponse, Preset, RulesDict, UploadResponse } from "./types";
import ResultsDashboard from "./components/ResultsDashboard";
import Oppsett, { type Accepted } from "./oppsett/Oppsett";
import { loadStoredSetup, type SetupFile } from "./oppsett/setup";

/** Oppsett walk → Results. The walk stays mounted under Results, so
 *  «Juster» returns to it as it was; a new file starts a fresh walk. */
export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stored, setStored] = useState<SetupFile | null>(() => loadStoredSetup());
  const [walkKey, setWalkKey] = useState(0);
  const [accepted, setAccepted] = useState<{ upload: UploadResponse; rules: RulesDict } | null>(null);
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPresets().then(setPresets).catch((e) => setError(String(e.message ?? e)));
  }, []);

  async function handleAccept({ upload, rules }: Accepted) {
    setError(null);
    setChecking(true);
    try {
      saveLastProject(rules.project_name ?? "");
      const res = await runCheck(upload.upload_id, rules);
      setAccepted({ upload, rules });
      setCheck(res);
      setShowResults(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  function handleReset() {
    setAccepted(null);
    setCheck(null);
    setError(null);
    setShowResults(false);
    setWalkKey((k) => k + 1);
  }

  return (
    <>
      <div hidden={showResults}>
        <Oppsett
          key={walkKey}
          presets={presets}
          stored={stored}
          onStored={setStored}
          checking={checking}
          error={showResults ? null : error}
          onError={setError}
          onAccept={handleAccept}
        />
      </div>

      {showResults && accepted && check ? (
        <div className="min-h-screen text-ink">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-surface-fg shadow-sm">
                <ScanSearch size={22} strokeWidth={2.2} />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">TFM-sjekk</h1>
                <p className="text-sm text-muted">Mottakskontroll på TFM-merking i IFC-fagmodeller</p>
              </div>
            </div>

            {error && (
              <div className="mb-5 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
            )}

            <div className="stage-in">
              <ResultsDashboard
                upload={accepted.upload}
                config={accepted.rules}
                check={check}
                onAdjust={() => setShowResults(false)}
                onReset={handleReset}
              />
            </div>

            <footer className="mt-12 text-center text-xs text-subtle">
              Skiplum · TFM-sjekk · ingen elementnavn eller verdier forlater verktøyet
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
