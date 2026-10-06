import { Check } from "lucide-react";
import type { Preset } from "../types";
import PatternPreview from "./PatternPreview";

interface Props {
  presets: Preset[];
  selectedId: string | null;
  onSelect: (preset: Preset) => void;
}

export default function PresetGallery({ presets, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {presets.map((p) => {
        const active = p.id === selectedId;
        const seq = p.rules.patterns[0]?.sequence ?? [];
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            className={`relative rounded-xl border p-4 text-left transition-all ${
              active
                ? "border-accent bg-accent-soft shadow-sm ring-1 ring-accent"
                : "border-line bg-card hover:border-accent/60 hover:shadow-sm"
            }`}
          >
            {active && (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                <Check size={13} strokeWidth={3} />
              </span>
            )}
            <div className="mb-1 text-sm font-semibold">{p.label}</div>
            <div className="mb-3 rounded-lg bg-bg/70 px-2.5 py-1.5">
              <PatternPreview sequence={seq} size="sm" />
            </div>
            <p className="text-xs leading-relaxed text-muted">{p.description}</p>
          </button>
        );
      })}
    </div>
  );
}
