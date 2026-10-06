import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Play, RefreshCw, SlidersHorizontal, X, Plus, Check, Ban } from "lucide-react";

import type { Location, Preset, RulesDict, UploadResponse } from "../types";
import { DISCIPLINES } from "../constants";
import { applyPreset, checksSummary, usedParts } from "../derive";
import ModelSummary from "./ModelSummary";
import PresetGallery from "./PresetGallery";
import PatternBuilder from "./PatternBuilder";
import PatternPreview from "./PatternPreview";

interface Props {
  upload: UploadResponse;
  config: RulesDict;
  setConfig: Dispatch<SetStateAction<RulesDict | null>>;
  presets: Preset[];
  onRun: () => void;
  checking: boolean;
  onReset: () => void;
}

interface FieldOption {
  value: string;
  label: string;
  location: Location;
}

export default function ConfirmPanel({
  upload, config, setConfig, presets, onRun, checking, onReset,
}: Props) {
  const [customize, setCustomize] = useState(false);
  const [builderKey, setBuilderKey] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(
    upload.suggested_preset,
  );
  const [floorInput, setFloorInput] = useState("");

  const merge = (patch: Partial<RulesDict>) =>
    setConfig((c) => (c ? { ...c, ...patch } : c));

  const fieldOptions = useMemo<FieldOption[]>(() => {
    const opts: FieldOption[] = [
      { value: "all", label: "Alle felt (skann alt)", location: ["all", null, null] },
      { value: "name", label: "Element Name", location: ["attr", null, "Name"] },
      { value: "tag", label: "Element Tag", location: ["attr", null, "Tag"] },
    ];
    for (const [pset, props] of Object.entries(upload.psets)) {
      for (const prop of props) {
        opts.push({
          value: `pset:${pset}:${prop}`,
          label: `${pset} → ${prop}`,
          location: ["pset", pset, prop],
        });
      }
    }
    return opts;
  }, [upload.psets]);

  const currentFieldValue = useMemo(() => {
    const loc = config.tfm_location ?? ["all", null, null];
    const match = fieldOptions.find(
      (o) => JSON.stringify(o.location) === JSON.stringify(loc),
    );
    return match?.value ?? "all";
  }, [config.tfm_location, fieldOptions]);

  const summary = checksSummary(config);
  const hasPattern = config.patterns.some((p) => p.sequence.length > 0);
  const activeSeq = config.patterns[0]?.sequence ?? [];

  function onPickPreset(p: Preset) {
    setConfig((c) => (c ? applyPreset(p, c) : c));
    setSelectedPreset(p.id);
    setBuilderKey((k) => k + 1); // remount builder from new config
  }

  function addFloor() {
    const v = floorInput.trim();
    if (!v) return;
    if (!(config.floor_codes ?? []).includes(v)) {
      merge({ floor_codes: [...(config.floor_codes ?? []), v] });
    }
    setFloorInput("");
  }

  const usesEtasje = usedParts(config).has("Etasje");

  return (
    <div className="space-y-6">
      {/* Summary + change file */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ModelSummary upload={upload} />
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <RefreshCw size={14} /> Bytt fil
        </button>
      </div>

      {/* Auto-detected config */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Auto-oppdaget — juster om nødvendig
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Disiplin</label>
            <div className="flex flex-wrap gap-1.5">
              {DISCIPLINES.map((d) => {
                const active = config.discipline_key === d.key;
                return (
                  <button
                    key={d.key}
                    onClick={() => merge({ discipline_key: d.key })}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line bg-bg hover:border-accent"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            {upload.detected_discipline && (
              <p className="mt-1.5 text-xs text-muted">
                Filnavnet antyder{" "}
                <strong>{upload.detected_discipline}</strong>.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Hvor ligger TFM-koden?
              </label>
              <select
                value={currentFieldValue}
                onChange={(e) => {
                  const opt = fieldOptions.find((o) => o.value === e.target.value);
                  if (opt) merge({ tfm_location: opt.location });
                }}
                className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                {fieldOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Tillatte etasjekoder{" "}
                {!usesEtasje && (
                  <span className="font-normal text-subtle">(brukes ikke i mønsteret)</span>
                )}
              </label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-bg p-2">
                {(config.floor_codes ?? []).map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium"
                  >
                    {f}
                    <button
                      onClick={() =>
                        merge({
                          floor_codes: (config.floor_codes ?? []).filter((x) => x !== f),
                        })
                      }
                      className="opacity-60 hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  value={floorInput}
                  onChange={(e) => setFloorInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFloor())}
                  placeholder="legg til…"
                  className="min-w-16 flex-1 bg-transparent px-1 text-xs focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pattern */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Merkemønster
          </h2>
          <button
            onClick={() => setCustomize((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              customize
                ? "border-accent bg-accent-soft"
                : "border-line bg-bg hover:border-accent"
            }`}
          >
            <SlidersHorizontal size={14} />
            {customize ? "Skjul tilpasning" : "Tilpass mønster"}
          </button>
        </div>

        {!customize && (
          <>
            <PresetGallery
              presets={presets}
              selectedId={selectedPreset}
              onSelect={onPickPreset}
            />
            <div className="mt-4 rounded-lg bg-bg/70 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Aktivt mønster:{" "}
              </span>
              <PatternPreview sequence={activeSeq} size="sm" />
            </div>
          </>
        )}

        {customize && (
          <PatternBuilder
            key={builderKey}
            initial={config}
            onChange={(patch) => {
              merge(patch);
              setSelectedPreset(null);
            }}
          />
        )}
      </section>

      {/* What gets checked */}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Dette sjekkes
        </h2>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {summary.map((line) => (
            <li
              key={line.label}
              className={`flex items-center gap-2 text-sm ${
                line.active ? "text-fg" : "text-subtle line-through"
              }`}
            >
              {line.active ? (
                <Check size={14} className="shrink-0 text-ok" />
              ) : (
                <Ban size={14} className="shrink-0 text-subtle" />
              )}
              <span>{line.label}</span>
              {!line.active && line.hint && (
                <span className="text-xs no-underline">({line.hint})</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Project + run */}
      <section className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Prosjektnavn (for rapporten)</span>
          <input
            value={config.project_name ?? ""}
            onChange={(e) => merge({ project_name: e.target.value })}
            placeholder="f.eks. Grønland 55"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>

        <button
          onClick={onRun}
          disabled={checking || !hasPattern}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-base font-semibold text-accent-fg shadow-sm transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? (
            <>
              <RefreshCw size={18} className="animate-spin" /> Analyserer…
            </>
          ) : (
            <>
              <Play size={18} /> Kjør kontroll
            </>
          )}
        </button>
        {!hasPattern && (
          <p className="flex items-center gap-1.5 text-sm text-bad">
            <Plus size={14} /> Mønsteret må ha minst én blokk.
          </p>
        )}
      </section>
    </div>
  );
}
