"""The TFM register: one row per object carrying a code, as an .xlsx.

Each row: the code as found (verbatim, and per source field when the code is
composed), whether it takes the format and why not, the mechanically fixed
code, the object's status from its MMI, and its link to the model (file,
GlobalId, IFC class, storey, systems).
"""

from __future__ import annotations

import io
import re
from collections import Counter
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .constants import sequence_to_example
from .inventory import ModelIndex, phase_of
from .rules import ASPECTS, TFMRules, loose_component
from .shape import diagnose

KODE = "Kode som funnet"
COLUMNS_AFTER = [
    "Kilde", "Gyldig format", "Årsak", "Ny kode", "Status", "MMI",
    "Modellkobling (fil)", "GlobalId", "IFC-klasse", "Etasje (modell)",
    "Fag", "Systemkode", "IfcSystem", "Avvik",
]

# Phase colours (design canon 2026-10-08, HI90 Typebank): N, EK, R, EW.
PHASE_FILL = {"ny": "FAF050", "bevares": "D9A633", "ombruk": "66E6B3", "rives": "803366"}
PHASE_FONT = {"rives": "FFFFFF"}
OK_FILL, BAD_FILL = "C6EFCE", "FFC7CE"
HEAD_FILL = "D9D9D9"


def _loc_text(loc) -> str:
    if not loc:
        return ""
    kind, pset, prop = (list(loc) + [None, None, None])[:3]
    if kind == "pset":
        return f"{pset}.{prop}"
    return prop or ""


def _field_columns(rules: TFMRules) -> list[tuple[str, tuple]]:
    """(header, source) per source field of a composed code, aspect order,
    each source once. The header is the property's own name."""
    if not rules.composed:
        return []
    out, seen = [], set()
    for a in ASPECTS:
        loc = rules.tfm_parts.get(a)
        if not loc or loc in seen:
            continue
        seen.add(loc)
        out.append((loc[2] or _loc_text(loc), loc))
    # Two sets sharing a property name: name them in full.
    names = Counter(h for h, _ in out)
    return [(_loc_text(loc) if names[h] > 1 else h, loc) for h, loc in out]


def _storey_names(ifc) -> dict[int, str]:
    out = {}
    for st in ifc.by_type("IfcBuildingStorey"):
        for rel in getattr(st, "ContainsElements", None) or []:
            for el in rel.RelatedElements:
                out[el.id()] = st.Name or ""
    return out


def _systems(ifc) -> dict[int, list[str]]:
    out: dict[int, list[str]] = {}
    try:
        groups = ifc.by_type("IfcRelAssignsToGroup")
    except RuntimeError:
        return out
    for rel in groups:
        g = rel.RelatingGroup
        if g is None or not g.is_a("IfcSystem"):
            continue
        for o in rel.RelatedObjects or []:
            out.setdefault(o.id(), []).append(g.Name or "")
    return out


def register_rows(ifc, products, index: ModelIndex, rules: TFMRules,
                  file_name: str, fag: str | None) -> tuple[list[str], list[dict], dict]:
    """(columns, rows, summary) for one model."""
    fields = _field_columns(rules)
    columns = [KODE, *[h for h, _ in fields], *COLUMNS_AFTER]
    codes = index.code_values(rules) or {}
    field_values = [(h, index.values_for(loc) or {}) for h, loc in fields]
    status = index.values_for(rules.status_location) if rules.status_location else {}
    status = status or {}
    storeys = _storey_names(ifc)
    systems = _systems(ifc)
    regexes = rules.full_regexes()
    scope_comp = {c.upper() for c in rules.scope_components}
    scope_types = set(rules.scope_types)

    diag_cache: dict[str, object] = {}
    rows: list[dict] = []
    n_products = n_excluded = 0
    for e in products:
        pid = e.id()
        n_products += 1
        code = codes.get(pid)
        if not code:
            continue
        d = diag_cache.get(code)
        if d is None:
            d = diag_cache[code] = diagnose(code, rules, regexes)
        parts = d.parts or {}
        comp = (parts.get("komponent") or "").upper() if d.ok else loose_component(code)
        if (comp and comp in scope_comp) or (scope_types and index.type_of.get(pid) in scope_types):
            n_excluded += 1
            continue
        mmi = status.get(pid, "")
        sk = parts.get("systemkode") or ""
        if not re.fullmatch(rules.part_form("systemkode"), sk):
            sk = ""
        row = {KODE: code}
        for h, vals in field_values:
            row[h] = vals.get(pid, "")
        row.update({
            "Kilde": "modell",
            "Gyldig format": "ja" if d.ok else "nei",
            "Årsak": d.reason,
            "Ny kode": d.fix,
            "Status": phase_of(mmi),
            "MMI": mmi,
            "Modellkobling (fil)": file_name,
            "GlobalId": e.GlobalId,
            "IFC-klasse": e.is_a(),
            "Etasje (modell)": storeys.get(pid, ""),
            "Fag": fag or "",
            "Systemkode": sk,
            "IfcSystem": "; ".join(sorted(set(systems.get(pid, [])))),
            "Avvik": "",
        })
        rows.append(row)

    rows.sort(key=lambda r: (r[KODE], r["GlobalId"]))
    summary = {
        "Fil": file_name,
        "Fag": fag or "",
        "Kilde": (" + ".join(_loc_text(rules.tfm_parts.get(a)) for a in ASPECTS if rules.tfm_parts.get(a))
                  if rules.composed else _loc_text(rules.tfm_location)),
        "Format": "  |  ".join(sequence_to_example(p.get("sequence") or []) for p in rules.patterns),
        "Status fra": _loc_text(rules.status_location),
        "Elementer": n_products,
        "Med kode": len(rows),
        "Utenfor scope": n_excluded,
        "Gyldig format": sum(1 for r in rows if r["Gyldig format"] == "ja"),
        "Ugyldig format": sum(1 for r in rows if r["Gyldig format"] == "nei"),
        "Med ny kode": sum(1 for r in rows if r["Ny kode"]),
        "Dato": date.today().isoformat(),
    }
    for ph in ("ny", "bevares", "ombruk", "rives"):
        summary[f"Status {ph}"] = sum(1 for r in rows if r["Status"] == ph)
    return columns, rows, summary


def _head(ws, ncols: int) -> None:
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor=HEAD_FILL)
        cell.alignment = Alignment(vertical="center")
    ws.freeze_panes = "A2"


def build_register_xlsx(columns: list[str], rows: list[dict], summary: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sammendrag"
    ws.append(["Felt", "Verdi"])
    for k, v in summary.items():
        ws.append([k, v])
    _head(ws, 2)
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 60

    reg = wb.create_sheet("Register")
    reg.append(columns)
    ok_col = columns.index("Gyldig format") + 1
    st_col = columns.index("Status") + 1
    for r in rows:
        reg.append([r.get(c, "") for c in columns])
        i = reg.max_row
        ok = reg.cell(row=i, column=ok_col)
        ok.fill = PatternFill("solid", fgColor=OK_FILL if r["Gyldig format"] == "ja" else BAD_FILL)
        ph = r.get("Status")
        if ph in PHASE_FILL:
            st = reg.cell(row=i, column=st_col)
            st.fill = PatternFill("solid", fgColor=PHASE_FILL[ph])
            if ph in PHASE_FONT:
                st.font = Font(color=PHASE_FONT[ph])
    _head(reg, len(columns))
    reg.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{max(1, reg.max_row)}"
    for idx, c in enumerate(columns, start=1):
        longest = max([len(str(c))] + [len(str(r.get(c, ""))) for r in rows[:500]])
        reg.column_dimensions[get_column_letter(idx)].width = min(60, max(10, longest + 2))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
