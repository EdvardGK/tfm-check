"""What the Oppsett walk reads from a loaded model.

Built once per upload (lazily, on the first inventory request) and kept with
the cached model:

- every property set on the model's products, its properties, the elements
  carrying a value and a few sample values (the Kilde step's browser);
- the element attributes Name and Tag, the same way;
- each product's type name (the Scope step);
- the storeys with elevation, element count and a proposed floor (Etasjer).

``preview`` runs a rule set's patterns over one source's values. It works on
distinct values with counts, so it is instant on a 40 000-element model and
can follow every edit of the format builder.
"""

from __future__ import annotations

import re
from collections import Counter

from .rules import TFMRules

# The Statsbygg standard source (PA 0802 / NOSSB property sets).
STANDARD_SOURCE = ("NOSSB_Reference", "RefString")

ATTRIBUTES = ("Name", "Tag")


def _text(value) -> str | None:
    """A property's value as text, or None when it carries none."""
    if value is None:
        return None
    v = getattr(value, "wrappedValue", value)
    if v is None:
        return None
    s = str(v).strip()
    return s or None


class ModelIndex:
    def __init__(self, ifc, products):
        self.product_ids: list[int] = [e.id() for e in products]
        pid_set = set(self.product_ids)
        # (set, prop) -> {product id: value}
        self.props: dict[tuple[str, str], dict[int, str]] = {}
        self.attrs: dict[str, dict[int, str]] = {a: {} for a in ATTRIBUTES}
        self.type_of: dict[int, str] = {}

        for e in products:
            name = _text(e.Name)
            if name:
                self.attrs["Name"][e.id()] = name
            tag = _text(getattr(e, "Tag", None))
            if tag:
                self.attrs["Tag"][e.id()] = tag

        occurrence_sets: dict[str, set[int]] = {}
        for rel in ifc.by_type("IfcRelDefinesByProperties"):
            pset = rel.RelatingPropertyDefinition
            if not pset.is_a("IfcPropertySet") or not pset.Name:
                continue
            owners = [o.id() for o in rel.RelatedObjects if o.id() in pid_set]
            if not owners:
                continue
            occurrence_sets.setdefault(pset.Name, set()).update(owners)
            for p in pset.HasProperties or []:
                if not p.is_a("IfcPropertySingleValue") or not p.Name:
                    continue
                v = _text(p.NominalValue)
                if v is None:
                    continue
                d = self.props.setdefault((pset.Name, p.Name), {})
                for o in owners:
                    d[o] = v

        # Types: the type name per product, and the type's property sets for
        # every occurrence that does not carry the same set itself.
        for rel in ifc.by_type("IfcRelDefinesByType"):
            typ = rel.RelatingType
            owners = [o.id() for o in rel.RelatedObjects if o.id() in pid_set]
            tname = _text(typ.Name)
            if tname:
                for o in owners:
                    self.type_of[o] = tname
            for pset in getattr(typ, "HasPropertySets", None) or []:
                if not pset.is_a("IfcPropertySet") or not pset.Name:
                    continue
                own = occurrence_sets.get(pset.Name, set())
                inherit = [o for o in owners if o not in own]
                if not inherit:
                    continue
                for p in pset.HasProperties or []:
                    if not p.is_a("IfcPropertySingleValue") or not p.Name:
                        continue
                    v = _text(p.NominalValue)
                    if v is None:
                        continue
                    d = self.props.setdefault((pset.Name, p.Name), {})
                    for o in inherit:
                        d.setdefault(o, v)

        self.storeys: list[dict] = []
        for s in ifc.by_type("IfcBuildingStorey"):
            n = 0
            for rel in getattr(s, "ContainsElements", None) or []:
                n += sum(1 for el in rel.RelatedElements if el.id() in pid_set)
            elev = s.Elevation
            self.storeys.append({
                "name": s.Name or "",
                "elevation": float(elev) if elev is not None else None,
                "n": n,
            })

    def values_for(self, location) -> dict[int, str] | None:
        """The values a rule's source reads, per product. None for «all»,
        which reads every field and has no single source to count."""
        kind, pset, prop = (list(location) + [None, None, None])[:3]
        if kind == "pset":
            return self.props.get((pset, prop), {})
        if kind == "attr":
            return self.attrs.get(prop or "", {})
        return None


# =============================================================================
# Inventory (the Kilde step's browser)
# =============================================================================

def _samples(values: dict[int, str], k: int = 3) -> list[dict]:
    return [{"v": v[:80], "n": n} for v, n in Counter(values.values()).most_common(k)]


def _prop_entry(name: str, values: dict[int, str]) -> dict:
    return {
        "name": name,
        "n": len(values),
        "distinct": len(set(values.values())),
        "samples": _samples(values),
    }


def _matching(values: dict[int, str], regexes) -> int:
    hit: dict[str, bool] = {}
    n = 0
    for v in values.values():
        ok = hit.get(v)
        if ok is None:
            ok = any(rx.search(v) for rx in regexes)
            hit[v] = ok
        if ok:
            n += 1
    return n


def inventory_payload(index: ModelIndex, preset_rules: list[TFMRules]) -> dict:
    by_set: dict[str, dict[str, dict[int, str]]] = {}
    for (pset, prop), values in index.props.items():
        by_set.setdefault(pset, {})[prop] = values

    sets = []
    for pset in sorted(by_set, key=str.lower):
        props = by_set[pset]
        carriers: set[int] = set()
        for values in props.values():
            carriers.update(values.keys())
        sets.append({
            "name": pset,
            "n": len(carriers),
            "props": [_prop_entry(p, props[p]) for p in sorted(props, key=str.lower)],
        })

    std_values = index.props.get(STANDARD_SOURCE, {})

    # Candidates: properties whose values take a known TFM form (a bundled
    # preset), scored by elements matching. The standard is listed apart.
    regexes = [rx for r in preset_rules for rx in r.regexes()]
    scored = []
    sources = [(("pset", s, p), v) for (s, p), v in index.props.items() if (s, p) != STANDARD_SOURCE]
    sources += [(("attr", None, a), v) for a, v in index.attrs.items()]
    for loc, values in sources:
        if not values:
            continue
        m = _matching(values, regexes)
        if m == 0 or m * 2 < len(values):
            continue
        scored.append((m, loc, len(values)))
    scored.sort(key=lambda x: -x[0])
    candidates = [{"location": list(loc), "n": n, "matched": m} for m, loc, n in scored[:3]]

    return {
        "products": len(index.product_ids),
        "standard": {"location": ["pset", *STANDARD_SOURCE], "n": len(std_values)},
        "sets": sets,
        "attributes": [_prop_entry(a, index.attrs[a]) for a in ATTRIBUTES],
        "candidates": candidates,
        "storeys": classify_storeys(index.storeys),
    }


# =============================================================================
# Preview (live evidence on the loaded model)
# =============================================================================

def preview(index: ModelIndex, rules: TFMRules) -> dict:
    values = index.values_for(rules.tfm_location)
    regexes = rules.regexes()
    scope_comp = {c.upper() for c in rules.scope_components}
    scope_types = set(rules.scope_types)
    floors = set(rules.floor_codes)
    has_floor_part = rules.has_part("Etasje")

    parsed: dict[str, dict | None] = {}

    def parse(v: str):
        if v not in parsed:
            g = None
            for rx in regexes:
                m = rx.search(v)
                if m:
                    g = m.groupdict()
                    break
            parsed[v] = g
        return parsed[v]

    n_products = len(index.product_ids)
    excluded = valued = matched = 0
    off = Counter()
    seen_floors = Counter()
    components = Counter()
    types_all = Counter()
    types_out = Counter()

    for pid in index.product_ids:
        tname = index.type_of.get(pid)
        if tname:
            types_all[tname] += 1
        v = values.get(pid) if values is not None else None
        g = parse(v) if v else None
        comp = (g.get("komponent") or "").upper() if g else ""
        if comp:
            components[comp] += 1
        if (comp and comp in scope_comp) or (tname and tname in scope_types):
            excluded += 1
            if tname:
                types_out[tname] += 1
            continue
        if not v:
            continue
        valued += 1
        if g is None:
            off[v] += 1
            continue
        matched += 1
        et = g.get("etasje")
        if et is not None:
            seen_floors[et] += 1

    floor_total = sum(seen_floors.values())
    floor_ok = sum(n for code, n in seen_floors.items() if code in floors)
    return {
        "products": n_products,
        "excluded": excluded,
        "in_scope": n_products - excluded,
        "countable": values is not None,
        "valued": valued,
        "matched": matched,
        "off": [{"v": v[:80], "n": n} for v, n in off.most_common(6)],
        "floor_part": has_floor_part,
        "floors": {
            "total": floor_total,
            "ok": floor_ok,
            "seen": [{"code": c, "n": n, "ok": c in floors} for c, n in seen_floors.most_common(40)],
        },
        "components": [{"code": c, "n": n} for c, n in components.most_common(60)],
        "types": [{"name": t, "n": n, "out": types_out.get(t, 0)} for t, n in types_all.most_common()],
    }


# =============================================================================
# Storeys → proposed floor (Etasjer)
# =============================================================================

_BELOW_U = re.compile(r"(?<![a-zæøå])u\s*(\d{1,2})\s*(m)?(?![a-zæøå0-9])")
_BELOW_SB = re.compile(r"(?<![0-9])(\d{1,2})\s*u(?![a-zæøå])")
_ABOVE = re.compile(r"(?<![0-9a-zæøå])(\d{1,2})\s*([mlt])?(?![a-zæøå0-9])")
_ROOF = re.compile(r"\b(tak|roof)\b")
_LOFT = re.compile(r"\b(loft|attic)\b")
_BASEMENT = re.compile(r"(kjeller|underetasje|sokkel|basement)")
_MEZZ = re.compile(r"(mesanin|mezz)")


def classify_storey(name: str) -> dict | None:
    """A storey name read as a floor: {kind: below|above|loft|roof, n, mezz}.
    None when the name says nothing about a floor (Havnivå, Level A)."""
    s = (name or "").strip().lower()
    if not s:
        return None
    mezz = bool(_MEZZ.search(s))
    m = _BELOW_U.search(s)
    if m:
        return {"kind": "below", "n": int(m.group(1)), "mezz": bool(m.group(2)) or mezz}
    m = _BELOW_SB.search(s)
    if m:
        # Statsbygg: 00U is the first floor below ground.
        return {"kind": "below", "n": int(m.group(1)) + 1, "mezz": mezz}
    if _BASEMENT.search(s):
        m = re.search(r"(\d{1,2})", s)
        return {"kind": "below", "n": int(m.group(1)) if m else 1, "mezz": mezz}
    if _ROOF.search(s):
        return {"kind": "roof", "n": None, "mezz": False}
    if _LOFT.search(s):
        return {"kind": "loft", "n": None, "mezz": False}
    m = _ABOVE.search(s)
    if m:
        suffix = m.group(2) or ""
        if suffix == "l":
            return {"kind": "loft", "n": int(m.group(1)), "mezz": False}
        if suffix == "t":
            return {"kind": "roof", "n": int(m.group(1)), "mezz": False}
        return {"kind": "above", "n": int(m.group(1)), "mezz": suffix == "m" or mezz}
    return None


def classify_storeys(storeys: list[dict]) -> list[dict]:
    """Each storey with a proposed floor, top to bottom by elevation.

    Names decide. A loft or roof without a number takes the one above the
    highest floor. When no name reads as a floor, the storeys are numbered
    by elevation from the lowest (01) up.
    """
    ordered = sorted(
        storeys,
        key=lambda s: (s["elevation"] is None, -(s["elevation"] or 0.0)),
    )
    proposals = [classify_storey(s["name"]) for s in ordered]

    if not any(proposals):
        up = sorted(range(len(ordered)), key=lambda i: (ordered[i]["elevation"] or 0.0))
        for k, i in enumerate(up):
            proposals[i] = {"kind": "above", "n": k + 1, "mezz": False}
    else:
        top = max((p["n"] for p in proposals if p and p["kind"] == "above"), default=0)
        nxt = top + 1
        for kind in ("loft", "roof"):
            for p in proposals:
                if p and p["kind"] == kind and p["n"] is None:
                    p["n"] = nxt
            if any(p and p["kind"] == kind for p in proposals):
                nxt = max(p["n"] for p in proposals if p and p["kind"] == kind) + 1

    return [{**s, "floor": p} for s, p in zip(ordered, proposals)]
