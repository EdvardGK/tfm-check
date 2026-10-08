import type { CheckResponse, Inventory, Location, Preset, Preview, RulesDict, SourceValues, UploadResponse } from "./types";

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

export async function getPreview(
  uploadId: string,
  rules: RulesDict,
  signal?: AbortSignal,
): Promise<Preview> {
  return jsonOrThrow<Preview>(
    await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: uploadId, rules }),
      signal,
    }),
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
export async function downloadRegister(uploadId: string, rules: RulesDict, fileStem: string): Promise<void> {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: uploadId, rules }),
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
