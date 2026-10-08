import { useEffect, useMemo, useRef, useState } from "react";
import type { Inventory, RulesDict } from "../types";
import { Bar10, Canvas, Fig, Lamp, Meter, RailOptions, RailSection, RailTile, StepBar } from "./Shell";
import { useDraft, useLiveAnswer, type LiveAnswer } from "./live";
import { usePreview } from "./usePreview";
import { allowedFloors, likelyStyle, proposeCodes, reflowCodes, type FloorStyle } from "./floors";
import { fmt, verdictOf } from "./setup";

export interface FloorPatch {
  storey_codes: Record<string, string>;
  floor_codes: string[];
  floor_style: FloorStyle;
  storey_manual: string[];
}

/** «Ordning»: the schemes, each named by its own codes (and Statsbygg by name). */
const SCHEMES: { key: FloorStyle; title?: string; example?: string }[] = [
  { key: "statsbygg", title: "Statsbygg", example: "00U · 01 · 02M" },
  { key: "u", example: "U1 · 01 · 01M" },
  { key: "custom", title: "Egendefinert" },
];

/** A scheme as the rail prints it. */
export function schemeAnswer(style: string): LiveAnswer {
  const s = SCHEMES.find((x) => x.key === style);
  if (!s) return { answer: "", standard: false };
  return { answer: s.example ?? s.title ?? "", standard: s.key === "statsbygg" };
}

const kote = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Etasjer: every storey mapped to a floor code. The scheme (rail) proposes
 *  the codes; a typed code is sticky (manual) with a revert, and the auto
 *  codes reflow around it (data-workspace 2026-08-16). Beside the table:
 *  the floor codes the model's values carry, against the mapping. */
export default function EtasjerStep({
  uploadId,
  inv,
  rules,
  autoScheme,
  onUse,
}: {
  /** null while the model is still being read: the scheme can be picked,
   *  the storeys come with the model. */
  uploadId: string | null;
  inv: Inventory | null;
  rules: RulesDict;
  /** Egendefinert, first visit: pick the scheme the model's own floor
   *  codes are written in, once they are counted. */
  autoScheme: boolean;
  onUse: (patch: FloorPatch) => void;
}) {
  const storeys = useMemo(() => inv?.storeys ?? [], [inv]);
  const initialScheme: FloorStyle =
    rules.floor_style === "u" || rules.floor_style === "custom" ? rules.floor_style : "statsbygg";
  const [scheme, setScheme] = useState<FloorStyle>(initialScheme);
  const [manual, setManual] = useState<Record<string, string>>(() => {
    const saved = rules.storey_codes ?? {};
    const out: Record<string, string> = {};
    if (initialScheme === "custom") {
      const proposed = proposeCodes(storeys, "statsbygg");
      for (const s of storeys) out[s.name] = saved[s.name] ?? proposed[s.name];
      return out;
    }
    // The typed ones, when the file says which; else every saved code that
    // differs from the scheme's proposal.
    const names = rules.storey_manual ?? Object.keys(saved);
    const proposed = reflowCodes(storeys, initialScheme, {});
    for (const n of names) if (saved[n] !== undefined && (rules.storey_manual || saved[n] !== proposed[n])) out[n] = saved[n];
    return out;
  });

  const codes = useMemo(
    () => (scheme === "custom" ? { ...manual } : reflowCodes(storeys, scheme, manual)),
    [scheme, manual, storeys],
  );
  const patch: FloorPatch = useMemo(
    () => ({
      storey_codes: codes,
      floor_codes: allowedFloors(codes),
      floor_style: scheme,
      storey_manual: scheme === "custom" ? storeys.map((s) => s.name) : Object.keys(manual),
    }),
    [codes, scheme, manual, storeys],
  );
  const previewRules = useMemo(() => ({ ...rules, ...patch }), [rules, patch]);
  const preview = usePreview(uploadId, previewRules);

  useDraft(patch);
  const sa = schemeAnswer(scheme);
  useLiveAnswer("etasjer", sa.answer, sa.standard);

  // Once: the scheme the model's floor codes are written in (Egendefinert).
  const touched = useRef(!autoScheme);
  useEffect(() => {
    if (touched.current || !preview) return;
    touched.current = true;
    if (preview.floor_part) setScheme(likelyStyle(storeys, preview.floors.seen));
  }, [preview, storeys]);

  const pick = (s: FloorStyle) => {
    touched.current = true;
    // Egendefinert pins every code; leaving it hands them back to the scheme.
    if (s === "custom") setManual({ ...codes });
    else if (scheme === "custom") setManual({});
    setScheme(s);
  };
  const type = (name: string, v: string) => {
    touched.current = true;
    setManual((m) => ({ ...m, [name]: v.toUpperCase() }));
  };
  const revert = (name: string) =>
    setManual((m) => {
      const n = { ...m };
      delete n[name];
      return n;
    });

  const maxN = Math.max(1, ...storeys.map((s) => s.n));
  const floors = preview?.floor_part ? preview.floors : null;
  const uncoded = storeys.filter((s) => (codes[s.name] ?? "").trim() === "").length;
  const seenCodes = new Set((floors?.seen ?? []).map((f) => f.code));
  const unseen = [...new Set(Object.values(codes).map((c) => c.trim()).filter((c) => c && !seenCodes.has(c)))];
  // Codes in the model: the mapping's in table order, then the rest by count.
  const order = new Map<string, number>();
  storeys.forEach((s, i) => {
    const c = (codes[s.name] ?? "").trim();
    if (c && !order.has(c)) order.set(c, i);
    if (c && !order.has(c + "M")) order.set(c + "M", i + 0.5);
  });
  const seen = [...(floors?.seen ?? [])].sort((a, b) =>
    a.ok !== b.ok ? (a.ok ? -1 : 1) : a.ok ? (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0) : b.n - a.n,
  );
  const maxSeen = Math.max(1, ...seen.map((f) => f.n));
  const byCodeMap = new Map<string, number>();
  for (const st of storeys) {
    const c = (codes[st.name] ?? "").trim();
    if (c) byCodeMap.set(c, (byCodeMap.get(c) ?? 0) + st.n);
  }
  const byCode = [...byCodeMap];
  const maxCode = Math.max(1, ...byCode.map(([, n]) => n));
  const verdict = floors ? verdictOf(floors.ok, floors.total) : "na";

  return (
    <Canvas rows="auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" onClick={() => onUse(patch)}>
          Bruk
        </button>
      </StepBar>

      <RailOptions>
        <RailSection label="Ordning">
          {SCHEMES.map((s) => (
            <RailTile key={s.key} title={s.title} example={s.example} pressed={scheme === s.key} onClick={() => pick(s.key)} />
          ))}
        </RailSection>
      </RailOptions>

      <section className="tile card major table ftab" aria-label="Etasjer">
        <div className="tcols colhead">
          <span className="lbl">Etasje</span>
          <span className="lbl num">Kote</span>
          <span className="lbl">Elementer</span>
          <span className="lbl" style={{ textAlign: "right", paddingRight: 34 }}>
            Kode
          </span>
        </div>
        <div className="tbody scroll">
          {storeys.map((s) => {
            const isManual = scheme === "custom" || manual[s.name] !== undefined;
            return (
              <div key={s.name} className="frow rule">
                <span className="tn">{s.name}</span>
                <span className="num">{s.elevation === null ? "–" : kote.format(s.elevation)}</span>
                <span className="tc">
                  <span className="num">{fmt(s.n)}</span>
                  <Bar10 n={s.n} max={maxN} />
                </span>
                <span className="tk">
                  <input
                    className="code"
                    value={codes[s.name] ?? ""}
                    aria-label={`Kode ${s.name}`}
                    data-src={isManual ? "manual" : "auto"}
                    onChange={(e) => type(s.name, e.target.value)}
                  />
                  {isManual && scheme !== "custom" ? (
                    <button type="button" className="rev" title="Tilbake til auto" aria-label="Tilbake til auto" onClick={() => revert(s.name)}>
                      ↺
                    </button>
                  ) : (
                    <span className="rev" />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="tile card minor ev2" aria-label="Koder i modellen">
        <div className="figs">
          <div>
            <span className="lbl">Treff i modellen</span>
            <Fig n={floors ? floors.ok : null} total={floors ? floors.total : null} verdict={verdict} />
            <Meter n={floors?.ok ?? 0} total={floors?.total ?? 0} verdict={verdict} />
          </div>
          <div>
            <span className="lbl">Uten kode</span>
            <Fig n={uncoded} total={storeys.length} verdict={uncoded > 0 ? "fail" : undefined} />
          </div>
        </div>
        {floors ? (
          <>
            <div className="lh">
              <span className="lbl">Ikke i modellen</span>
            </div>
            <div className="chips">
              {unseen.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
            <div className="lh" style={{ marginTop: 6 }}>
              <span className="lbl">Koder i modellen</span>
              <span className="lbl num">Verdier</span>
            </div>
            <div className="scroll codes">
              {seen.map((f) => (
                <div key={f.code} className="lrow crow rule">
                  <Lamp verdict={f.ok ? "ok" : "fail"} />
                  <span className="mono ell" title={f.code}>
                    {f.code}
                  </span>
                  <Bar10 n={f.n} max={maxSeen} />
                  <span className="num sub">{fmt(f.n)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* The form has no Etasje part, so no value carries a floor code:
                the codes the mapping gives, with the elements on their storeys. */}
            <div className="lh" style={{ marginTop: 6 }}>
              <span className="lbl">Koder</span>
              <span className="lbl num">Elementer</span>
            </div>
            <div className="scroll codes">
              {byCode.map(([code, n]) => (
                <div key={code} className="lrow crow rule">
                  <Lamp verdict="na" />
                  <span className="mono ell" title={code}>
                    {code}
                  </span>
                  <Bar10 n={n} max={maxCode} />
                  <span className="num sub">{fmt(n)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </Canvas>
  );
}
