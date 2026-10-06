import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  rows: Record<string, string | number>[];
  onClose: () => void;
}

export default function DrillDownDialog({ title, rows, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const columns = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">Ingen rader.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-surface text-surface-fg">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 align-top">
                        {String(row[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-line px-5 py-2 text-right text-xs text-muted">
          {rows.length} rader vist
        </div>
      </div>
    </div>
  );
}
