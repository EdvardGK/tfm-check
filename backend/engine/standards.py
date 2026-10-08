"""The standards a code segment can be linked to, and the validity check.

Shape (``shape.py``) says whether a segment has the right form; this says
whether the value is a real entry of the standard the segment is linked to:
Systemkode -> NS 3451, Komponent -> NS 3457-8 (or PA 0802 / IEC 81346).
The lists are copied from their existing sources by
``scripts/import_codelists.py`` (ifc-check's generated NS 3451:2022 and
NS 3457-8:2021 lists, PA 0802 vedlegg 9.2).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

# key -> (file, label, how a value is looked up)
STANDARDS = {
    "NS3451": ("ns3451_2022.json", "NS 3451", "whole"),
    "NS3457-8": ("ns3457-8_2021.json", "NS 3457-8", "whole"),
    "PA0802": ("pa0802_komponent.json", "PA 0802", "whole"),
    "IEC81346": ("iec81346_letters.json", "IEC 81346-2", "first"),
}
# Which part a link applies to.
LINKABLE = {
    "systemkode": ("NS3451",),
    "komponent": ("NS3457-8", "PA0802", "IEC81346"),
    "typekode": ("NS3457-8", "PA0802", "IEC81346"),
}
# A list entry that exists but is not to be used.
_AVOID = "bør ikke benyttes"


@dataclass
class Codelist:
    key: str
    label: str
    codes: dict[str, str]
    reserved: frozenset[str]
    lookup: str  # whole | first


@lru_cache(maxsize=8)
def codelist(key: str | None) -> Codelist | None:
    if not key or key not in STANDARDS:
        return None
    fname, label, lookup = STANDARDS[key]
    p = DATA / fname
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    if "codes" in data:
        codes = {str(k): str(v) for k, v in data["codes"].items()}
        reserved = frozenset(str(c) for c in data.get("reserved") or [])
    else:  # the May app's {code: {name}} / {letter: name}
        codes = {str(k): (v.get("name", "") if isinstance(v, dict) else str(v)) for k, v in data.items()}
        reserved = frozenset()
    return Codelist(key, label, codes, reserved, lookup)


@dataclass
class Validity:
    ok: bool
    description: str = ""
    reason: str = ""


def check_code(value: str, key: str | None) -> Validity | None:
    """Is the value a real entry of the linked standard? None: not linked."""
    cl = codelist(key)
    if cl is None or value is None:
        return None
    v = value.strip()
    probe = v[:1].upper() if cl.lookup == "first" else v
    name = cl.codes.get(probe)
    if name is None and cl.lookup == "whole" and probe.upper() != probe:
        name = cl.codes.get(probe.upper())
    if name is None:
        # The nearest parent that is in the list, as context.
        parent = next((v[:i] for i in range(len(v) - 1, 0, -1) if v[:i] in cl.codes), None)
        ctx = f" ({parent} {cl.codes[parent]})" if parent else ""
        return Validity(False, "", f"«{v}» finnes ikke i {cl.label}{ctx}")
    if probe in cl.reserved:
        return Validity(False, name, f"«{v}» er reservert i {cl.label}")
    if name.strip().lower() == _AVOID:
        return Validity(False, name, f"«{v}» bør ikke benyttes ({cl.label})")
    return Validity(True, name, "")


def links(rules) -> dict[str, str]:
    """The rule set's links: {part: standard key} for linked parts."""
    out = {}
    if rules.bygningsdel_system in LINKABLE["systemkode"]:
        out["systemkode"] = rules.bygningsdel_system
    if rules.komponent_system in LINKABLE["komponent"]:
        out["komponent"] = rules.komponent_system
    for part, key in (getattr(rules, "part_links", None) or {}).items():
        if key in LINKABLE.get(part, ()):
            out[part] = key
    return out


def check_parts(parts: dict, rules, forms: dict | None = None) -> dict[str, Validity]:
    """Each linked part of a parsed code against its standard. A part whose
    text does not have the part's form is not looked up (shape says why)."""
    import re

    out = {}
    for part, key in links(rules).items():
        v = (parts or {}).get(part)
        if not v:
            continue
        form = (forms or {}).get(part) or rules.part_form(part)
        if not re.fullmatch(form, v):
            continue
        res = check_code(v, key)
        if res is not None:
            out[part] = res
    return out
