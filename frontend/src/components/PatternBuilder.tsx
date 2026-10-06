import { useState, type ReactNode } from "react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  horizontalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Plus, GripVertical, Trash2 } from "lucide-react";

import {
  PART_TYPES, SEP_KEYS, SEP_TO_CHAR, sepLabel, tokenPalette,
  isFreetext, freetextValue, FREETEXT_PREFIX, DIGIT_LOCKABLE, PART_TO_DIGITKEY,
} from "../constants";
import type { RulesDict } from "../types";
import PatternPreview from "./PatternPreview";

let _id = 0;
const nextId = () => `t${_id++}`;

interface Item {
  id: string;
  token: string;
}

interface Props {
  initial: RulesDict;
  onChange: (partial: Partial<RulesDict>) => void;
}

function chipLabel(token: string): string {
  if (isFreetext(token)) return freetextValue(token) || "(tom)";
  if (token in SEP_TO_CHAR) return sepLabel(token);
  return token;
}

function SortableChip({
  item,
  onRemove,
}: {
  item: Item;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const c = tokenPalette(item.token);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: c.bg,
    borderColor: c.border,
    color: c.text,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <span
      ref={setNodeRef}
      style={style}
      className="inline-flex select-none items-center gap-1 rounded-full border px-2.5 py-1 text-sm font-medium shadow-sm"
    >
      <button
        type="button"
        className="cursor-grab touch-none opacity-50 hover:opacity-90 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label="Dra for å sortere"
      >
        <GripVertical size={13} />
      </button>
      {chipLabel(item.token)}
      <button
        type="button"
        onClick={onRemove}
        className="opacity-50 hover:opacity-100"
        aria-label="Fjern blokk"
      >
        <X size={13} />
      </button>
    </span>
  );
}

export default function PatternBuilder({ initial, onChange }: Props) {
  const [patterns, setPatterns] = useState<Item[][]>(
    () => initial.patterns.map((p) => p.sequence.map((token) => ({ id: nextId(), token }))),
  );
  const [bdSys, setBdSys] = useState(initial.bygningsdel_system ?? "NS3451");
  const [kompSys, setKompSys] = useState(initial.komponent_system ?? "IEC81346");
  const [partDigits, setPartDigits] = useState<Record<string, number>>(
    () => ({ ...(initial.part_digits ?? {}) }),
  );
  const [freetext, setFreetext] = useState<Record<number, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function emit(
    nextPatterns: Item[][],
    nextBd = bdSys,
    nextKomp = kompSys,
    nextDigits = partDigits,
  ) {
    onChange({
      patterns: nextPatterns.map((p) => ({ sequence: p.map((x) => x.token) })),
      bygningsdel_system: nextBd,
      komponent_system: nextKomp,
      part_digits: nextDigits,
    });
  }

  function update(nextPatterns: Item[][]) {
    setPatterns(nextPatterns);
    emit(nextPatterns);
  }

  function dragEnd(pi: number, e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const list = patterns[pi];
    const from = list.findIndex((x) => x.id === active.id);
    const to = list.findIndex((x) => x.id === over.id);
    if (from < 0 || to < 0) return;
    const next = patterns.map((p, i) => (i === pi ? arrayMove(p, from, to) : p));
    update(next);
  }

  function addToken(pi: number, token: string) {
    const next = patterns.map((p, i) =>
      i === pi ? [...p, { id: nextId(), token }] : p,
    );
    update(next);
  }

  function removeToken(pi: number, id: string) {
    const next = patterns.map((p, i) =>
      i === pi ? p.filter((x) => x.id !== id) : p,
    );
    update(next);
  }

  function addPattern() {
    const next = [...patterns, [
      { id: nextId(), token: "Systemkode" },
      { id: nextId(), token: "-" },
      { id: nextId(), token: "Komponent" },
    ]];
    update(next);
  }

  function removePattern(pi: number) {
    update(patterns.filter((_, i) => i !== pi));
  }

  function setDigit(key: string, value: string) {
    const next = { ...partDigits };
    if (value === "Fri") delete next[key];
    else next[key] = parseInt(value, 10);
    setPartDigits(next);
    emit(patterns, bdSys, kompSys, next);
  }

  const allTokens = patterns.flat().map((x) => x.token);
  const usesSystemkode = allTokens.includes("Systemkode");
  const usesKomponent = allTokens.includes("Komponent");
  const activeDigitParts = DIGIT_LOCKABLE.filter(({ key }) =>
    allTokens.some((t) => PART_TO_DIGITKEY[t] === key),
  );

  return (
    <div className="space-y-4 rounded-xl border border-line bg-card p-4">
      {patterns.map((items, pi) => (
        <div key={pi} className="rounded-lg border border-line bg-bg/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Mønster {pi + 1}
            </span>
            {patterns.length > 1 && (
              <button
                type="button"
                onClick={() => removePattern(pi)}
                className="inline-flex items-center gap-1 text-xs text-bad hover:underline"
              >
                <Trash2 size={12} /> Fjern mønster
              </button>
            )}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => dragEnd(pi, e)}
          >
            <SortableContext
              items={items.map((x) => x.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line bg-card p-2">
                {items.length === 0 && (
                  <span className="px-1 text-xs text-subtle">
                    Legg til blokker under ↓
                  </span>
                )}
                {items.map((item) => (
                  <SortableChip
                    key={item.id}
                    item={item}
                    onRemove={() => removeToken(pi, item.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Add palette */}
          <div className="mt-3 space-y-2">
            <PaletteRow label="Innhold">
              {PART_TYPES.map((p) => (
                <PaletteBtn key={p} onClick={() => addToken(pi, p)}>
                  {p}
                </PaletteBtn>
              ))}
            </PaletteRow>
            <PaletteRow label="Skilletegn">
              {SEP_KEYS.map((s) => (
                <PaletteBtn key={s} onClick={() => addToken(pi, s)} mono>
                  {s === "mellomrom" ? "␣" : s}
                </PaletteBtn>
              ))}
            </PaletteRow>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs font-semibold text-muted">
                Fritekst
              </span>
              <input
                value={freetext[pi] ?? ""}
                onChange={(e) => setFreetext({ ...freetext, [pi]: e.target.value })}
                placeholder="skriv tekst…"
                className="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-sm focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const v = freetext[pi] ?? "";
                  if (!v) return;
                  addToken(pi, FREETEXT_PREFIX + v);
                  setFreetext({ ...freetext, [pi]: "" });
                }}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-1 text-xs font-medium hover:border-accent"
              >
                <Plus size={12} /> Legg til
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-bg/70 px-3 py-2">
            <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
              Eksempel
            </div>
            <div className="mt-1 text-base">
              <PatternPreview sequence={items.map((x) => x.token)} />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addPattern}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm font-medium hover:border-accent"
      >
        <Plus size={14} /> Legg til mønster
      </button>

      {/* Advanced: classification + digit locks */}
      {(usesSystemkode || usesKomponent || activeDigitParts.length > 0) && (
        <div className="grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
          {usesSystemkode && (
            <label className="text-sm">
              <span className="mb-1 block font-medium">Systemkode-validering</span>
              <select
                value={bdSys}
                onChange={(e) => {
                  setBdSys(e.target.value);
                  emit(patterns, e.target.value, kompSys, partDigits);
                }}
                className="w-full rounded-md border border-line bg-card px-2 py-1.5"
              >
                <option value="NS3451">NS3451 — Systemkodetabell</option>
                <option value="Ingen">Ingen sjekk</option>
              </select>
            </label>
          )}
          {usesKomponent && (
            <label className="text-sm">
              <span className="mb-1 block font-medium">Komponent-validering</span>
              <select
                value={kompSys}
                onChange={(e) => {
                  setKompSys(e.target.value);
                  emit(patterns, bdSys, e.target.value, partDigits);
                }}
                className="w-full rounded-md border border-line bg-card px-2 py-1.5"
              >
                <option value="IEC81346">IEC 81346-2 — Funksjonsbokstaver</option>
                <option value="Ingen">Ingen sjekk</option>
              </select>
            </label>
          )}
          {activeDigitParts.map(({ key, label }) => (
            <label key={key} className="text-sm">
              <span className="mb-1 block font-medium">Antall sifre — {label}</span>
              <select
                value={partDigits[key] ? String(partDigits[key]) : "Fri"}
                onChange={(e) => setDigit(key, e.target.value)}
                className="w-full rounded-md border border-line bg-card px-2 py-1.5"
              >
                {["Fri", "1", "2", "3", "4"].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function PaletteRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 w-20 shrink-0 text-xs font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function PaletteBtn({
  children,
  onClick,
  mono,
}: {
  children: ReactNode;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border border-line bg-bg px-2 py-0.5 text-xs font-medium hover:border-accent hover:bg-accent-soft ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </button>
  );
}
