import { useEffect, useMemo, useRef, useState } from "react";
import type { Preset, RulesDict } from "../types";
import { DISCIPLINES } from "../constants";
import PatternBuilder from "../components/PatternBuilder";
import PatternPreview from "../components/PatternPreview";
import { usePreview, usePreviews } from "./usePreview";
import { STATSBYGG_EXAMPLE, fmt } from "./setup";
import {
  Count, Figure, LABEL, MappingRow, OptionList, PILL, StepConfirm, ToZone, ValueList, type MapOption,
} from "./ui";

type FormatDraft = Pick<
  RulesDict,
  "patterns" | "part_digits" | "bygningsdel_system" | "komponent_system" | "discipline_key"
>;

const draftOf = (r: RulesDict): FormatDraft => ({
  patterns: r.patterns.map((p) => ({ sequence: [...p.sequence] })),
  part_digits: { ...(r.part_digits ?? {}) },
  bygningsdel_system: r.bygningsdel_system,
  komponent_system: r.komponent_system,
  discipline_key: r.discipline_key,
});

const presetDraft = (p: Preset, cur: FormatDraft): FormatDraft => ({
  ...cur,
  patterns: p.rules.patterns.map((x) => ({ sequence: [...x.sequence] })),
  part_digits: { ...(p.rules.part_digits ?? {}) },
  bygningsdel_system: p.rules.bygningsdel_system ?? cur.bygningsdel_system,
  komponent_system: p.rules.komponent_system ?? cur.komponent_system,
});

const samePatterns = (a: FormatDraft, b: FormatDraft) =>
  JSON.stringify(a.patterns) === JSON.stringify(b.patterns) &&
  JSON.stringify(a.part_digits ?? {}) === JSON.stringify(b.part_digits ?? {});

/** Format: the TFM code builder as a step. FROM is the code form as it
 *  stands, with what it gives on the model's values (matched of valued,
 *  and the values it misses); OPTIONS the bundled forms with theirs; the
 *  builder under them edits it. `pickBest`: the form taking most of the
 *  model's values is pre-picked once the counts are in (Egendefinert). */
export default function FormatStep({
  uploadId,
  rules,
  presets,
  pickBest,
  onUse,
}: {
  uploadId: string;
  rules: RulesDict;
  presets: Preset[];
  pickBest: boolean;
  onUse: (patch: FormatDraft) => void;
}) {
  const [draft, setDraft] = useState<FormatDraft>(() => draftOf(rules));
  const [builderKey, setBuilderKey] = useState(0);
  const preview = usePreview(uploadId, { ...rules, ...draft });
  const presetRules = useMemo(
    () => presets.map((p) => ({ ...rules, ...presetDraft(p, draftOf(rules)) })),
    [presets, rules],
  );
  const presetPreviews = usePreviews(uploadId, presetRules);

  // Egendefinert: once the counts are in, the form that takes the most of
  // the model's values, when one takes any. Once, and never over an edit.
  const picked = useRef(!pickBest);
  useEffect(() => {
    if (picked.current || presetPreviews.some((p) => p === null)) return;
    picked.current = true;
    let best = -1;
    presetPreviews.forEach((p, i) => {
      if (p && p.matched > 0 && (best < 0 || p.matched > (presetPreviews[best]?.matched ?? 0))) best = i;
    });
    if (best >= 0) {
      setDraft((d) => (samePatterns(d, draftOf(rules)) ? presetDraft(presets[best], d) : d));
      setBuilderKey((k) => k + 1);
    }
  }, [presetPreviews, presets, rules]);

  const options: MapOption[] = presets.map((p, i) => {
    const pv = presetPreviews[i];
    return {
      key: p.id,
      tag: p.id === "pa0802" ? "Standard" : undefined,
      head: p.label,
      title: p.example,
      count: pv && pv.countable ? <Count n={pv.matched} total={pv.valued} /> : undefined,
      current: samePatterns(draft, presetDraft(p, draft)),
      onPick: () => {
        setDraft((d) => presetDraft(p, d));
        setBuilderKey((k) => k + 1);
      },
    };
  });

  const countable = preview?.countable ?? false;
  const none = countable && preview !== null && preview.matched === 0;
  const hasPattern = draft.patterns.some((p) => p.sequence.length > 0);

  return (
    <>
      <MappingRow
        to={<ToZone name="Format" example={STATSBYGG_EXAMPLE} />}
        fromState={none ? "missing" : "found"}
        from={
          <>
            <div className="flex flex-col gap-2">
              {draft.patterns.map((p, i) => (
                <div key={i} className="text-base">
                  <PatternPreview sequence={p.sequence} />
                </div>
              ))}
            </div>
            {preview && countable ? (
              <Figure label="Treff" value={`${fmt(preview.matched)} / ${fmt(preview.valued)}`} bad={none} />
            ) : null}
            {preview && countable && preview.off.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className={LABEL}>Treffer ikke</span>
                <ValueList values={preview.off} bad />
              </div>
            ) : null}
          </>
        }
        options={<OptionList options={options} label="Format" />}
      />

      <PatternBuilder
        key={builderKey}
        initial={{ ...rules, ...draft }}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Disiplin</span>
        <div className="flex flex-wrap gap-1.5">
          {DISCIPLINES.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={draft.discipline_key === d.key}
              onClick={() => setDraft((x) => ({ ...x, discipline_key: d.key }))}
              className={PILL}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <StepConfirm lead={!none && hasPattern} disabled={!hasPattern} onClick={() => onUse(draft)} />
    </>
  );
}
