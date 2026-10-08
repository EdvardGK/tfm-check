import type { CheckResponse, Inventory, Location, Preset, Preview, Rollup, RulesDict, SourceValues, UploadResponse } from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function getPresets(): Promise<Preset[]> {
  const data = await jsonOrThrow<{ presets: Preset[] }>(await fetch("/api/presets"));
  return data.presets;
}

// XHR for upload progress (fetch can't report request-body progress).
export function uploadIfc(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        let detail = `HTTP ${xhr.status}`;
        try {
          detail = JSON.parse(xhr.responseText).detail ?? detail;
        } catch {
          /* ignore */
        }
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => reject(new Error("Nettverksfeil under opplasting."));
    xhr.send(form);
  });
}

export async function getInventory(uploadId: string): Promise<Inventory> {
  return jsonOrThrow<Inventory>(await fetch(`/api/inventory/${encodeURIComponent(uploadId)}`));
}

// Results per model and rules, kept so a step opens on what an earlier
// request (the walk's own, or a prefetch) already fetched.
const CACHE_MAX = 40;
const cache = new Map<string, { promise: Promise<unknown>; value?: unknown }>();
// The latest result per kind and model, whatever the rules: a step opens on
// it while its own result is on the way, so data once there never blanks.
const latest = new Map<string, unknown>();

/** The latest result of a kind for a model, or null. */
export function peekLatest<T>(kind: "preview" | "rollup", uploadId: string | null): T | null {
  return uploadId ? ((latest.get(`${kind}|${uploadId}`) as T | undefined) ?? null) : null;
}

// A model the server no longer holds (idle past its time): the walk says so
// instead of waiting for data that will not come.
const goneListeners = new Set<(msg: string) => void>();
export function onModelGone(cb: (msg: string) => void): () => void {
  goneListeners.add(cb);
  return () => goneListeners.delete(cb);
}

/** JSON with object keys sorted, so equal rules give one key. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** One model and the rules it is read with. */
export interface ModelRules {
  upload_id: string;
  rules: RulesDict;
}

function cached<T>(kind: string, uploadId: string, rules: unknown, load: () => Promise<T>): Promise<T> {
  const key = `${kind}|${uploadId}|${stable(rules)}`;
  const hit = cache.get(key);
  if (hit) return hit.promise as Promise<T>;
  const entry: { promise: Promise<unknown>; value?: unknown } = { promise: Promise.resolve() };
  entry.promise = load().then(
    (v) => {
      entry.value = v;
      latest.set(`${kind}|${uploadId}`, v);
      return v;
    },
    (e) => {
      cache.delete(key);
      const msg = e instanceof Error ? e.message : String(e);
      if (/ikke lenger i minnet/i.test(msg)) for (const cb of goneListeners) cb(msg);
      throw e;
    },
  );
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return entry.promise as Promise<T>;
}

/** A result already fetched for these rules, or null. */
export function peek<T>(kind: "preview" | "rollup", uploadId: string | null, rules: unknown): T | null {
  if (!uploadId || !rules) return null;
  return (cache.get(`${kind}|${uploadId}|${stable(rules)}`)?.value as T | undefined) ?? null;
}

export interface IdsSpec {
  name: string;
  mapped: boolean;
  role?: string | null;
  source?: string | null;
  rule?: string | null;
  detail: string;
}

/** An .ids file as a ruleset, and what each specification became. */
export async function importIds(file: File): Promise<{ title: string; setup: unknown; specs: IdsSpec[] }> {
  const form = new FormData();
  form.append("file", file);
  return jsonOrThrow(await fetch("/api/ids", { method: "POST", body: form }));
}

export function getPreview(uploadId: string, rules: RulesDict): Promise<Preview> {
  return cached("preview", uploadId, rules, async () =>
    jsonOrThrow<Preview>(
      await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId, rules }),
      }),
    ),
  );
}

export async function getValues(uploadId: string, location: Location, signal?: AbortSignal): Promise<SourceValues> {
  return jsonOrThrow<SourceValues>(
    await fetch("/api/values", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, location }),
      signal,
    }),
  );
}

/** The TFM register (.xlsx), saved as `<model>_TFM-register.xlsx`. */
export async function downloadRegister(items: ModelRules[], fileStem: string): Promise<void> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      detail = (await res.json())?.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem}_TFM-register.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function runCheck(uploadId: string, rules: RulesDict): Promise<CheckResponse> {
  return jsonOrThrow<CheckResponse>(
    await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, rules }),
    }),
  );
}

export async function downloadReport(
  uploadId: string,
  rules: RulesDict,
  fmt: "zip" | "xlsx" | "pdf",
  fileStem: string,
): Promise<void> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId, rules, fmt }),
  });
  if (!res.ok) throw new Error(`Kunne ikke lage rapport (HTTP ${res.status}).`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem}_tfm-sjekk.${fmt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Upload as a job: the file goes up (byte progress), then the server
// reads and indexes it (polled progress). ----

export interface JobStatus {
  stage: "les" | "indekser" | "ferdig" | "feil";
  /** Indexing, 0–1. */
  fraction: number | null;
  products: number | null;
  file_size: number;
  elapsed: number;
  result: (UploadResponse & { inventory?: Inventory }) | null;
  error: string | null;
}

export type ReadProgress =
  | { stage: "pakk"; pct: number }
  | { stage: "opp"; pct: number }
  | { stage: "les"; elapsed: number }
  | { stage: "indekser"; pct: number; products: number | null };

/** The file gzipped in the browser (IFC text packs about 4:1, and the upload
 *  is the slow part), with the share read so far; null where the browser
 *  has no CompressionStream. */
async function gzipped(file: File, onPct: (pct: number) => void): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined" || /\.ifczip$/i.test(file.name)) return null;
  let read = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      read += chunk.byteLength;
      onPct(Math.round((read / Math.max(1, file.size)) * 100));
      ctl.enqueue(chunk);
    },
  });
  const packed = file.stream().pipeThrough(count).pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Response(packed).blob();
}

function postFile(file: Blob, name: string, onPct: (pct: number) => void): Promise<{ job_id: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jobs");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(err);
        }
      } else {
        let detail = `HTTP ${xhr.status}`;
        try {
          detail = JSON.parse(xhr.responseText).detail ?? detail;
        } catch {
          /* ignore */
        }
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => reject(new Error("Nettverksfeil under opplasting."));
    xhr.send(form);
  });
}

/** Upload, then follow the server's reading until the model is ready. */
export async function readIfc(
  file: File,
  onProgress: (p: ReadProgress) => void,
): Promise<UploadResponse & { inventory?: Inventory }> {
  onProgress({ stage: "pakk", pct: 0 });
  const packed = await gzipped(file, (pct) => onProgress({ stage: "pakk", pct }));
  const { job_id } = await postFile(packed ?? file, packed ? `${file.name}.gz` : file.name, (pct) =>
    onProgress({ stage: "opp", pct }),
  );
  for (;;) {
    await new Promise((r) => window.setTimeout(r, 300));
    const j = await jsonOrThrow<JobStatus>(await fetch(`/api/jobs/${encodeURIComponent(job_id)}`));
    if (j.stage === "feil") throw new Error(j.error ?? "Kunne ikke lese IFC-fil.");
    if (j.stage === "ferdig" && j.result) return j.result;
    if (j.stage === "indekser") onProgress({ stage: "indekser", pct: Math.round((j.fraction ?? 0) * 100), products: j.products });
    else onProgress({ stage: "les", elapsed: j.elapsed });
  }
}

/** System and component codes rolled up over the models. */
export function getRollup(items: ModelRules[]): Promise<Rollup> {
  return cached("rollup", "*", items, async () =>
    jsonOrThrow<Rollup>(
      await fetch("/api/rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }),
    ),
  );
}
