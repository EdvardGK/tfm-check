import { useEffect, useState } from "react";
import { getPreview } from "../api";
import type { Preview, RulesDict } from "../types";

/** The rules' result on the loaded model, following every edit (a short
 *  debounce; the backend answers from counted values, in milliseconds).
 *  Keeps the last result while the next is on its way. */
export function usePreview(uploadId: string | null, rules: RulesDict | null): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(null);
  const key = uploadId && rules ? JSON.stringify(rules) : "";
  useEffect(() => {
    if (!uploadId || !key) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      getPreview(uploadId, JSON.parse(key) as RulesDict, ctl.signal)
        .then(setPreview)
        .catch(() => {
          /* aborted, or the model left the cache: the check will say so */
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [uploadId, key]);
  return preview;
}

/** Several rule sets' results at once (Format's options). */
export function usePreviews(uploadId: string | null, list: readonly RulesDict[]): (Preview | null)[] {
  const [out, setOut] = useState<(Preview | null)[]>(() => list.map(() => null));
  const key = uploadId ? JSON.stringify(list) : "";
  useEffect(() => {
    if (!uploadId || !key) return;
    const ctl = new AbortController();
    const rules = JSON.parse(key) as RulesDict[];
    const timer = window.setTimeout(() => {
      Promise.all(rules.map((r) => getPreview(uploadId, r, ctl.signal).catch(() => null))).then((res) => {
        if (!ctl.signal.aborted) setOut(res);
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [uploadId, key]);
  return out;
}
