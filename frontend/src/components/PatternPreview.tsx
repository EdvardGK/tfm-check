import {
  PART_EXAMPLE, SEP_COLOR, SEP_TO_CHAR, FREETEXT_COLOR,
  PART_COLORS, isFreetext, freetextValue,
} from "../constants";

interface Props {
  sequence: string[];
  size?: "sm" | "md";
}

// Renders a token sequence as an example string with per-token colored pills,
// so each block traces visually to its slot. Mirrors the backend preview.
export default function PatternPreview({ sequence, size = "md" }: Props) {
  if (sequence.length === 0) {
    return <span className="italic text-subtle">(tomt mønster)</span>;
  }
  const pad = size === "sm" ? "px-1 py-px text-xs" : "px-1.5 py-0.5 text-sm";
  return (
    <span className="inline-flex flex-wrap items-center gap-px font-mono">
      {sequence.map((t, i) => {
        if (t in PART_EXAMPLE) {
          const c = PART_COLORS[t] ?? FREETEXT_COLOR;
          return (
            <span
              key={i}
              className={`rounded font-semibold ${pad}`}
              style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
            >
              {PART_EXAMPLE[t]}
            </span>
          );
        }
        if (t in SEP_TO_CHAR) {
          const ch = SEP_TO_CHAR[t];
          return (
            <span key={i} className="px-0.5 font-bold" style={{ color: SEP_COLOR.bg }}>
              {ch === " " ? "·" : ch}
            </span>
          );
        }
        if (isFreetext(t)) {
          return (
            <span
              key={i}
              className={`rounded font-semibold ${pad}`}
              style={{
                background: FREETEXT_COLOR.bg,
                color: FREETEXT_COLOR.text,
                border: `1px solid ${FREETEXT_COLOR.border}`,
              }}
            >
              {freetextValue(t) || "(tom)"}
            </span>
          );
        }
        return null;
      })}
    </span>
  );
}
