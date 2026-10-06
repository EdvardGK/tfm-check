import { useRef, useState } from "react";
import { UploadCloud, FileBox, Loader2 } from "lucide-react";

interface Props {
  onUpload: (file: File) => void;
  uploadPct: number | null;
  parsing: boolean;
}

export default function UploadDropzone({ onUpload, uploadPct, parsing }: Props) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = uploadPct !== null || parsing;

  function pick(files: FileList | null) {
    const f = files?.[0];
    if (f) onUpload(f);
  }

  if (busy) {
    return (
      <div className="rounded-2xl border border-line bg-card p-10 text-center shadow-sm">
        <Loader2 className="mx-auto mb-4 animate-spin text-accent" size={40} />
        <p className="text-lg font-medium">
          {parsing ? "Leser modellen…" : `Laster opp… ${uploadPct}%`}
        </p>
        <p className="mt-1 text-sm text-muted">
          {parsing
            ? "Store modeller kan ta noen sekunder."
            : "Filen lastes opp til kontrollen."}
        </p>
        <div className="mx-auto mt-5 h-2 w-64 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-all duration-200"
            style={{ width: parsing ? "100%" : `${uploadPct ?? 0}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files);
        }}
        className={`group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
          drag
            ? "border-accent bg-accent-soft"
            : "border-subtle bg-card hover:border-accent hover:bg-accent-soft/40"
        }`}
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent transition-transform group-hover:scale-105">
          <UploadCloud size={32} strokeWidth={2} />
        </div>
        <p className="text-lg font-semibold">Slipp IFC-filen her</p>
        <p className="mt-1 text-sm text-muted">
          eller klikk for å velge — vi finner disiplin, etasjer og merkemønster
          automatisk
        </p>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-bg px-3 py-1 text-xs text-muted">
          <FileBox size={13} /> IFC2X3 · IFC4 · IFC4X1/2/3
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
    </div>
  );
}
