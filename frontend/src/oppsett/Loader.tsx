import { useEffect, useState } from "react";
import type { ReadProgress } from "../api";
import { fmt } from "./setup";

/** The loading screen while a model goes up and is read: the Skiplum logo
 *  outline animation from skiplum.com's «Norge i punkter» loader
 *  (nettside-studio public/brand/logo-outline.webm, used as is), centred,
 *  with the counter of the current stage under it. Reduced motion holds the
 *  first frame. */
export default function Loader({ progress }: { progress: ReadProgress | null }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  let label = "Laster opp";
  let figure = "0 %";
  if (progress?.stage === "opp") figure = `${progress.pct} %`;
  else if (progress?.stage === "les") {
    label = "Leser";
    figure = `${Math.floor(progress.elapsed)} s`;
  } else if (progress?.stage === "indekser") {
    label = "Indekserer";
    figure = progress.products !== null ? `${progress.pct} %  ·  ${fmt(progress.products)} elementer` : `${progress.pct} %`;
  }

  return (
    <div className="loader" role="status" aria-live="polite">
      <video
        src="/brand/logo-outline.webm"
        autoPlay={!reduced}
        loop={!reduced}
        muted
        playsInline
        preload="auto"
        aria-hidden
      />
      <div className="count">
        <span className="lbl">{label}</span>
        <span className="num">{figure}</span>
      </div>
    </div>
  );
}
