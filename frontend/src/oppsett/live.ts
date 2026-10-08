import { createContext, useContext, useEffect } from "react";
import type { RulesDict } from "../types";
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

/** The current step's edits not yet taken with «Bruk»: «Lagre oppsett»
 *  saves them too, so a file saved mid-step reopens as it was. */
export const Draft = createContext<((patch: Partial<RulesDict> | null) => void) | null>(null);

export function useDraft(patch: Partial<RulesDict> | null): void {
  const report = useContext(Draft);
  const key = patch ? JSON.stringify(patch) : "";
  useEffect(() => {
    report?.(key ? (JSON.parse(key) as Partial<RulesDict>) : null);
  }, [report, key]);
  useEffect(() => () => report?.(null), [report]);
}
