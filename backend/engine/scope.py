"""Scope: which objects the checks take.

A scope is two lists of rules, include and exclude. A rule reads one
property of an object and compares it:

- source: «all» (every object), «class» (the IFC class), «type» (the type's
  name), «systemkode» / «komponentkode» (the code's NS 3451 / NS 3457-8 part,
  as read from its TFM code), «mmi» (the status source), or «prop» (any
  property set's property, ``loc``);
- op: «er» (one of the values), «starter» (starts with one of them), «regex»
  (the whole value takes one of the patterns).

An object is in scope when it matches any include rule (no include rules:
every object) and no exclude rule. The older fields scope_components and
scope_types are exclude rules on komponentkode and type.
"""

from __future__ import annotations

import re
from collections import Counter

SOURCES = ("all", "class", "type", "systemkode", "komponentkode", "mmi", "prop")
OPS = ("er", "starter", "regex")


def clean_scope_rule(r) -> dict | None:
    if not isinstance(r, dict):
        return None
    src = r.get("source") or {}
    kind = src.get("kind") if isinstance(src, dict) else None
    if kind not in SOURCES:
        return None
    out_src = {"kind": kind}
    if kind == "prop":
        loc = src.get("loc")
        if not (isinstance(loc, list) and len(loc) >= 3 and loc[0] in ("pset", "attr")):
            return None
        out_src["loc"] = [loc[0], loc[1], loc[2]]
    op = r.get("op") if r.get("op") in OPS else "er"
    values = [str(v) for v in (r.get("values") or []) if str(v) != ""]
    if kind != "all" and not values:
        return None
    return {"source": out_src, "op": op, "values": values}


def scope_rules(rules) -> tuple[list[dict], list[dict]]:
    """(include, exclude), the older fields folded into exclude."""
    include = list(rules.scope_include or [])
    exclude = list(rules.scope_exclude or [])
    if rules.scope_components:
        exclude.append({"source": {"kind": "komponentkode"}, "op": "er",
                        "values": [c.upper() for c in rules.scope_components]})
    if rules.scope_types:
        exclude.append({"source": {"kind": "type"}, "op": "er", "values": list(rules.scope_types)})
    return include, exclude


def _code_parts(index, rules) -> dict[int, dict]:
    """Each object's Systemkode and Komponentkode as read from its code."""
    from .codes import read_code
    from .rules import loose_component

    codes = index.code_values(rules) or {}
    regexes = rules.full_regexes()
    cache: dict = {}
    out = {}
    for pid, code in codes.items():
        parts = dict(read_code(code, rules, regexes, cache)[1])
        if parts.get("komponent"):
            parts["komponent"] = parts["komponent"].upper()
        else:
            # A component code a malformed value still ends with (=411%KK003).
            lc = loose_component(code)
            if lc:
                parts["komponent"] = lc
        out[pid] = parts
    return out


def source_values(index, rules, source: dict, parts: dict | None = None) -> dict[int, str]:
    """{object id: value} of a rule's source."""
    kind = source.get("kind")
    if kind == "class":
        return dict(index.class_of)
    if kind == "type":
        return dict(index.type_of)
    if kind in ("systemkode", "komponentkode"):
        key = "systemkode" if kind == "systemkode" else "komponent"
        parts = parts if parts is not None else _code_parts(index, rules)
        return {pid: p[key] for pid, p in parts.items() if p.get(key)}
    if kind == "mmi":
        return index.values_for(rules.status_location) or {} if rules.status_location else {}
    if kind == "prop":
        return index.values_for(source.get("loc")) or {}
    return {}


def _matcher(rule: dict):
    op, values = rule["op"], rule["values"]
    if op == "starter":
        return lambda v: any(v.startswith(x) for x in values)
    if op == "regex":
        rxs = []
        for x in values:
            try:
                rxs.append(re.compile(x))
            except re.error:
                continue
        return lambda v: any(rx.fullmatch(v) for rx in rxs)
    vs = set(values)
    return lambda v: v in vs


def out_of_scope(index, rules) -> set[int]:
    """The objects the checks leave out."""
    include, exclude = scope_rules(rules)
    if not include and not exclude:
        return set()
    parts = None
    if any(r["source"]["kind"] in ("systemkode", "komponentkode") for r in include + exclude):
        parts = _code_parts(index, rules)

    def hits(rule) -> set[int]:
        if rule["source"]["kind"] == "all":
            return set(index.product_ids)
        vals = source_values(index, rules, rule["source"], parts)
        m = _matcher(rule)
        return {pid for pid, v in vals.items() if v and m(v)}

    ids = set(index.product_ids)
    inside = set().union(*(hits(r) for r in include)) if include else set(ids)
    for r in exclude:
        inside -= hits(r)
    return ids - inside


def values_of(index, rules, source: dict, k: int = 300) -> list[dict]:
    """A source's values over the model with counts, most carried first."""
    if source.get("kind") == "all":
        return []
    vals = source_values(index, rules, source)
    return [{"v": v, "n": n} for v, n in Counter(v for v in vals.values() if v).most_common(k)]
