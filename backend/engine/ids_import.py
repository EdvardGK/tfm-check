"""IDS 1.0 -> a tfm-check ruleset, with a report per specification.

What maps (property facets in the requirements):
- a property read as the whole TFM code, a TFM part (lokasjon, system,
  komponent) or the status (MMI) -> that source (tfm_location / tfm_parts /
  status_location), by its name;
- its value restriction -> a rule on the segment it fills: xs:pattern ->
  regex, xs:enumeration -> list of accepted values, simpleValue -> fixed
  value. The whole code takes the «Kode» segment (the code as one segment).

Refused rather than guessed, per specification, with the reason: a property
set or name given as a pattern, facets other than property, value rules on a
source whose value spans several segments, rules tfm-check has no check for
(accepted MMI values, lengths, bounds), «prohibited». Applicability (IFC
classes) is reported: tfm-check checks every product.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from .presets import PRESETS, preset_to_rules_dict

NS = {"ids": "http://standards.buildingsmart.org/IDS", "xs": "http://www.w3.org/2001/XMLSchema"}
_I = "{%s}" % NS["ids"]
_X = "{%s}" % NS["xs"]

# A property's role, by its name (property set + property).
_ROLE = [
    ("lokasjon", re.compile(r"plass|lokasjon|location|SysLoc", re.I)),
    ("system", re.compile(r"systemforekomst|SysOcc", re.I)),
    ("komponenttype", re.compile(r"komponenttype|CompType", re.I)),
    ("komponent", re.compile(r"komponentforekomst|komponent.?id|CompOcc", re.I)),
    ("status", re.compile(r"\bmmi\b|^mmi|mmi$|ProcessStatus|status", re.I)),
    ("whole", re.compile(r"^(tfm|tfm[-_ ]?id|RefString)$", re.I)),
]

# The segment a role's value fills, when it is one segment.
_SEGMENT = {"whole": "kode", "lokasjon": "lokasjon"}


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1]


def _value(el) -> dict | None:
    """A facet value: {"simple": str} or {"patterns", "values", "other"}."""
    if el is None:
        return None
    sv = el.find(_I + "simpleValue")
    if sv is not None:
        return {"simple": (sv.text or "").strip()}
    r = el.find(_X + "restriction")
    if r is None:
        return None
    out = {"patterns": [], "values": [], "other": []}
    for f in r:
        name, v = _local(f.tag), f.get("value", "")
        if name == "pattern":
            out["patterns"].append(v)
        elif name == "enumeration":
            out["values"].append(v)
        else:
            out["other"].append(f"{name}={v}")
    return out


def _role(pset: str, name: str) -> str | None:
    for role, rx in _ROLE:
        if role == "whole":
            if rx.search(name):
                return role
            continue
        if rx.search(name):
            return role
    return None


def _rule(v: dict) -> tuple[dict | None, str]:
    """A segment rule from a value restriction, or why not."""
    if "simple" in v:
        return {"kind": "value", "value": v["simple"]}, f"verdi «{v['simple']}»"
    if v["other"]:
        return None, "restriksjon uten regel i tfm-check: " + ", ".join(v["other"])
    if v["patterns"] and v["values"]:
        return None, "både mønster og liste"
    if len(v["patterns"]) > 1:
        return None, "flere mønstre"
    if v["patterns"]:
        p = v["patterns"][0]
        try:
            re.compile(p)
        except re.error as e:
            return None, f"mønster som ikke kan leses ({e})"
        return {"kind": "pattern", "pattern": p}, f"mønster {p}"
    if v["values"]:
        return {"kind": "list", "values": v["values"]}, f"liste ({len(v['values'])} verdier)"
    return None, "tom restriksjon"


def _applicability(spec) -> str:
    app = spec.find(_I + "applicability")
    if app is None:
        return ""
    names = []
    for ent in app.findall(_I + "entity"):
        v = _value(ent.find(_I + "name"))
        if v and "simple" in v:
            names.append(v["simple"])
        elif v:
            names.extend(v["values"] or v["patterns"])
    other = [_local(c.tag) for c in app if _local(c.tag) != "entity"]
    parts = []
    if names:
        parts.append(f"gjelder {len(names)} IFC-klasser, sjekkes på alle produkter")
    if other:
        parts.append("anvendelse på " + ", ".join(sorted(set(other))) + " brukes ikke")
    return "; ".join(parts)


def import_ids(data: bytes) -> dict:
    """{title, rules, specs: [{name, mapped, role, source, rule, detail}]}."""
    root = ET.fromstring(data)
    if _local(root.tag) != "ids":
        raise ValueError("Filen er ikke en IDS (rotelementet er ikke <ids>).")
    title = (root.findtext(f"{_I}info/{_I}title") or "").strip()

    rules = preset_to_rules_dict(PRESETS[0])
    rules.update({"tfm_parts": {}, "status_location": None, "part_rules": {}})
    whole_loc = None
    specs = []
    for spec in root.iter(_I + "specification"):
        name = spec.get("name", "")
        app = _applicability(spec)
        req = spec.find(_I + "requirements")
        facets = list(req) if req is not None else []
        if not facets:
            specs.append({"name": name, "mapped": False, "detail": "ingen krav"})
            continue
        for facet in facets:
            kind = _local(facet.tag)
            row = {"name": name, "mapped": False, "role": None, "source": None, "rule": None, "detail": ""}
            specs.append(row)
            if kind != "property":
                row["detail"] = f"krav av typen {kind} har ingen regel i tfm-check"
                continue
            if facet.get("cardinality") == "prohibited":
                row["detail"] = "«prohibited» har ingen regel i tfm-check"
                continue
            ps, bn = _value(facet.find(_I + "propertySet")), _value(facet.find(_I + "baseName"))
            if not ps or "simple" not in ps or not bn or "simple" not in bn:
                row["detail"] = "egenskapssett eller navn gitt som mønster: tfm-check leser én navngitt egenskap"
                continue
            loc = ["pset", ps["simple"], bn["simple"]]
            row["source"] = f"{loc[1]}.{loc[2]}"
            role = _role(loc[1], loc[2])
            row["role"] = role
            if role is None or role == "komponenttype":
                row["detail"] = "verken TFM-kode, TFM-del eller status"
                continue
            row["mapped"] = True
            if role == "whole":
                whole_loc = loc
            elif role == "status":
                rules["status_location"] = loc
            else:
                rules["tfm_parts"][role] = loc
            notes = [app] if app else []
            v = _value(facet.find(_I + "value"))
            if v:
                seg = _SEGMENT.get(role)
                if role == "status":
                    notes.append("godkjente MMI-verdier: ingen verdisjekk for status i tfm-check")
                elif seg is None:
                    notes.append("verdiregel på en kilde som fyller flere segmenter: ikke brukt")
                else:
                    r, what = _rule(v)
                    if r is None:
                        notes.append(what)
                    else:
                        rules["part_rules"][seg] = r
                        row["rule"] = what
                        if seg == "kode":
                            rules["patterns"] = [{"sequence": ["Kode"]}]
            row["detail"] = "; ".join(n for n in notes if n)
    if whole_loc:
        rules["tfm_mode"], rules["tfm_location"] = "whole", whole_loc
    elif rules["tfm_parts"]:
        rules["tfm_mode"] = "parts"
    if not rules["part_rules"]:
        rules.pop("part_rules")
    return {"title": title, "rules": rules, "specs": specs}
