import { Box, Layers, Network, FileCode2, HardDrive } from "lucide-react";
import type { UploadResponse } from "../types";

function fmt(n: number): string {
  return n.toLocaleString("nb-NO");
}

export default function ModelSummary({ upload }: { upload: UploadResponse }) {
  const { facts, file_size } = upload;
  const items = [
    { icon: FileCode2, label: facts.schema },
    { icon: HardDrive, label: `${(file_size / 1_048_576).toFixed(1)} MB` },
    { icon: Box, label: `${fmt(facts.n_products)} produkter` },
    { icon: Layers, label: `${facts.storey_names.length} etasjer` },
    { icon: Network, label: `${facts.n_systems} IfcSystems` },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-fg"
        >
          <it.icon size={13} className="text-muted" />
          {it.label}
        </span>
      ))}
    </div>
  );
}
