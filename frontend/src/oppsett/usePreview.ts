import { useEffect, useState } from "react";
import { getPreview, peek } from "../api";
import type { Preview, RulesDict } from "../types";

/** The rules' result on the loaded model, following every edit (a short
 *  debounce; the backend answers from counted values, in milliseconds).
 *  Opens on a result already fetched for the same rules; keeps the last
 *  result while the next is on its way. */
export function usePreview(uploadId: string | null, rules: RulesDict | null): Preview | null {
  const [preview, setPreview] = useState<Preview | null>(() => peek<Preview>("preview", uploadId, rules));
  const key = uploadId && rules ? JSON.stringify(rules) : "";
  useEffect(() => {
    if (!uploadId || !key) return;
    const parsed = JSON.parse(key) as RulesDict;
    const ready = peek<Preview>("preview", uploadId, parsed);
    if (ready) {
      setPreview(ready);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      getPreview(uploadId, parsed)
        .then((p) => {
          if (live) setPreview(p);
        })
        .catch(() => {
          /* the model left the cache: the check will say so */
        });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [uploadId, key]);
  return preview;
}
