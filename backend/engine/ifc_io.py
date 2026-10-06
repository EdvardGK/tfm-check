"""IFC parsing helpers: load, facts, pset index, storey/discipline detection,
candidate-string extraction, and codelist loading."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as eu

from .constants import (
    BYGNINGSDEL_SYSTEMS, FILENAME_DISCIPLINE_PATTERNS, KOMPONENT_SYSTEMS, SPATIAL_TYPES,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@lru_cache(maxsize=8)
def load_codes(file_name: str | None) -> dict:
    if not file_name:
        return {}
    p = DATA_DIR / file_name
    if not p.exists():
        return {}
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def codes_for_bygningsdel(system_key: str) -> dict:
    return load_codes(BYGNINGSDEL_SYSTEMS.get(system_key, {}).get("file"))


def codes_for_komponent(system_key: str) -> dict:
    return load_codes(KOMPONENT_SYSTEMS.get(system_key, {}).get("file"))


def detect_discipline_from_filename(name: str) -> str | None:
    for key, pat in FILENAME_DISCIPLINE_PATTERNS:
        if pat.search(name):
            return key
    return None


def parse_storey_name_to_code(name: str) -> str:
    s = (name or "").strip()
    if not s:
        return ""
    m = re.search(r"\b(\d{1,3})\b", s)
    if m:
        return m.group(1).zfill(2)
    return s


def extract_storey_codes_from_ifc(ifc) -> list[str]:
    seen, out = set(), []
    for s in ifc.by_type("IfcBuildingStorey"):
        code = parse_storey_name_to_code(s.Name or "")
        if code and code not in seen:
            seen.add(code)
            out.append(code)
    return out


def open_ifc(path: str) -> ifcopenshell.file:
    return ifcopenshell.open(path)


def list_products(ifc) -> list:
    return [e for e in ifc.by_type("IfcProduct") if e.is_a() not in SPATIAL_TYPES]


def model_facts(ifc, products) -> dict:
    try:
        systems = ifc.by_type("IfcSystem")
    except RuntimeError:
        systems = []
    return {
        "schema": ifc.schema,
        "storey_names": [s.Name or "" for s in ifc.by_type("IfcBuildingStorey")],
        "n_systems": len(systems),
        "n_products": len(products),
        "originating_system": (ifc.header.file_name.originating_system or "").strip(),
    }


def build_pset_index(ifc) -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for rel in ifc.by_type("IfcRelDefinesByProperties"):
        if not any(o.is_a("IfcProduct") for o in rel.RelatedObjects):
            continue
        pset = rel.RelatingPropertyDefinition
        if not pset.is_a("IfcPropertySet") or not pset.Name:
            continue
        for p in pset.HasProperties or []:
            if p.is_a("IfcPropertySingleValue") and p.Name:
                out.setdefault(pset.Name, set()).add(p.Name)
    return {k: sorted(v) for k, v in sorted(out.items())}


def candidate_strings_for(elem, location: tuple):
    kind, ps, prop = location
    if kind == "attr":
        if prop == "Name" and elem.Name:
            yield ("Name", elem.Name)
        elif prop == "Tag":
            tag = getattr(elem, "Tag", None)
            if tag:
                yield ("Tag", str(tag))
        return
    if kind == "pset":
        psets = eu.get_psets(elem)
        v = psets.get(ps, {}).get(prop)
        if isinstance(v, str) and v.strip():
            yield (f"{ps}.{prop}", v)
        return
    if elem.Name:
        yield ("Name", elem.Name)
    tag = getattr(elem, "Tag", None)
    if tag:
        yield ("Tag", str(tag))
    for pn, pdict in eu.get_psets(elem).items():
        for k, v in pdict.items():
            if k == "id":
                continue
            if isinstance(v, str) and v.strip():
                yield (f"{pn}.{k}", v)


def build_storey_map(ifc) -> dict[int, str]:
    out = {}
    for st_ in ifc.by_type("IfcBuildingStorey"):
        code = parse_storey_name_to_code(st_.Name or "")
        for rel in getattr(st_, "ContainsElements", []) or []:
            for elem in rel.RelatedElements:
                out[elem.id()] = code
    return out
