import { createContext, useContext, useEffect } from "react";
import type { Step } from "./setup";

/** A step's answer as the rail prints it. */
export interface LiveAnswer {
  answer: string;
  standard: boolean;
}

export type LiveReport = LiveAnswer & { step: Step };

/** The rail shows the current step's answer while it is being picked. */
export const Live = createContext<((a: LiveReport) => void) | null>(null);

/** Report the step's answer. The effect runs only when the text or the tag
 *  changes, never on every render. */
export function useLiveAnswer(step: Step, answer: string, standard: boolean): void {
  const report = useContext(Live);
  useEffect(() => {
    report?.({ step, answer, standard });
  }, [report, step, answer, standard]);
}
