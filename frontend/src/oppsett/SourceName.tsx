import type { Location } from "../types";
import { locationText, plainSource } from "./setup";

/** A source: the plain term first, the technical pset.property under it,
 *  smaller and muted (both always visible). */
export default function SourceName({ loc }: { loc: Location | null | undefined }) {
  if (!loc) return <span className="srcname">–</span>;
  const tech = locationText(loc);
  const plain = plainSource(loc);
  return (
    <span className="srcname">
      <span className="t">{plain}</span>
      {tech !== plain ? <span className="tech">{tech}</span> : null}
    </span>
  );
}
