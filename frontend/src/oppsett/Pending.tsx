import type { Location } from "../types";
import { Canvas, StepBar } from "./Shell";
import SourceName from "./SourceName";

/** A mapping step whose model data has not arrived yet: the same bands as
 *  the step (the standard | the pick; the model | the values), its known
 *  answer in place, the model's side empty until the inventory comes. The
 *  step opens with its data as soon as it does. */
export default function Pending({ standard, picked }: { standard: Location; picked: string }) {
  return (
    <Canvas rows="auto auto minmax(0, 1fr)">
      <StepBar>
        <button type="button" className="primary" disabled>
          Bruk
        </button>
      </StepBar>
      <section className="tile card major std" aria-label="Standard" aria-busy="true">
        <span className="lbl">Standard</span>
        <div className="row1">
          <span className="src">
            <SourceName loc={standard} />
          </span>
        </div>
        <span className="fig num">–</span>
      </section>
      <section className="tile card minor ev" aria-label="Valgt" aria-busy="true">
        <span className="lbl">Valgt</span>
        <span className="src">{picked || "–"}</span>
      </section>
      <section className="tile card major tree" aria-label="I modellen" aria-busy="true">
        <div className="top">
          <span className="lbl">I modellen</span>
        </div>
      </section>
      <section className="tile card minor vals" aria-label="Verdier" aria-busy="true">
        <div className="lh">
          <span className="lbl">Verdier</span>
        </div>
      </section>
    </Canvas>
  );
}
