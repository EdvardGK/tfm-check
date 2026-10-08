import { useEffect, useState } from "react";
import type { ReadProgress } from "../api";
import { fmt } from "./setup";

/** The figure of a reading stage, for the drop frame and the rail. */
export function progressText(p: ReadProgress | null): { label: string; figure: string } {
  if (p?.stage === "pakk") return { label: "Komprimerer", figure: `${p.pct} %` };
  if (p?.stage === "les") return { label: "Leser", figure: `${Math.floor(p.elapsed)} s` };
  if (p?.stage === "indekser")
    return {
      label: "Indekserer",
      figure: p.products !== null ? `${p.pct} %  ·  ${fmt(p.products)} elementer` : `${p.pct} %`,
    };
  return { label: "Laster opp", figure: `${p?.stage === "opp" ? p.pct : 0} %` };
}

/** The loader inside the IFC drop frame while a model goes up and is read:
 *  the Skiplum logo outline animation from skiplum.com's «Norge i punkter»
 *  loader (nettside-studio public/brand/logo-outline.webm, used as is) with
 *  the counter of the current stage. Reduced motion holds the first frame. */
export default function Loader({ progress }: { progress: ReadProgress | null }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const { label, figure } = progressText(progress);
  return (
    <span className="loader" role="status" aria-live="polite">
      <video src="/brand/logo-outline.webm" autoPlay={!reduced} loop={!reduced} muted playsInline preload="auto" aria-hidden />
      <span className="count">
        <span className="lbl">{label}</span>
        <span className="num">{figure}</span>
      </span>
    </span>
  );
}

/** The same animation, small, in a tile whose data is still on its way. */
export function MiniLoader() {
  return (
    <span className="miniload" role="status" aria-busy="true">
      <video src="/brand/logo-outline.webm" autoPlay loop muted playsInline preload="auto" aria-hidden />
    </span>
  );
}
