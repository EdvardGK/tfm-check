"""Every object's code read once: shape, the parts that fit their form, and
each linked part checked against its standard. The register and the rollup
of system and component codes are both built from this."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .inventory import ModelIndex
from .rules import TFMRules, loose_component
from .shape import Diagnosis, diagnose
from .standards import STANDARDS, Validity, check_code, links


_LOOSE_SYSTEM = re.compile(r"=(\d{2,4})(?:\.(\d{1,4}))?(?![\d])")
_LOOSE_COMPONENT = re.compile(r"-([A-Za-zÆØÅæøå]{1,4})(?=[\d.\s]|$)")


@dataclass
class Coded:
    pid: int
    code: str
    diag: Diagnosis
    # The parts as read that have their part's form (lokasjon, systemkode …).
    parts: dict = field(default_factory=dict)
    # Linked parts against their standard.
    validity: dict = field(default_factory=dict)

    @property
    def std_ok(self) -> bool | None:
        """All linked parts real entries; None when none was checked."""
        if not self.validity:
            return None
        return all(v.ok for v in self.validity.values())

    def reason(self) -> str:
        out = [self.diag.reason] if self.diag.reason else []
        out += [v.reason for v in self.validity.values() if not v.ok]
        return "; ".join(out)


def coded_objects(index: ModelIndex, rules: TFMRules) -> tuple[list[Coded], int]:
    """(objects with a code, in model order; objects left out by Scope)."""
    codes = index.code_values(rules) or {}
    regexes = rules.full_regexes()
    forms = {}
    scope_comp = {c.upper() for c in rules.scope_components}
    scope_types = set(rules.scope_types)
    cache: dict[str, tuple] = {}
    out, excluded = [], 0
    for pid in index.product_ids:
        code = codes.get(pid)
        if not code:
            continue
        hit = cache.get(code)
        if hit is None:
            d = diagnose(code, rules, regexes)
            parts = {}
            for name, text in (d.parts or {}).items():
                if not text:
                    continue
                form = forms.get(name) or forms.setdefault(name, rules.part_form(name))
                if re.fullmatch(form, text):
                    parts[name] = text
            # Off the form, the system and component codes are still read
            # behind their PA 0802 signs (=360.001, -SFZ.004T), so the rollup
            # and the standard check see every code that appears.
            if "systemkode" not in parts:
                m = _LOOSE_SYSTEM.search(code)
                if m:
                    parts["systemkode"] = m.group(1)
                    if m.group(2) and "lopenummer" not in parts:
                        parts["lopenummer"] = m.group(2)
            if "komponent" not in parts:
                m = _LOOSE_COMPONENT.search(code)
                if m:
                    parts["komponent"] = m.group(1)
            validity = {}
            for part, key in links(rules).items():
                if part in parts:
                    v = check_code(parts[part], key)
                    if v is not None:
                        validity[part] = v
            hit = cache[code] = (d, parts, validity)
        d, parts, validity = hit
        comp = (parts.get("komponent") or "").upper() or loose_component(code)
        if (comp and comp in scope_comp) or (scope_types and index.type_of.get(pid) in scope_types):
            excluded += 1
            continue
        out.append(Coded(pid, code, d, parts, validity))
    return out, excluded


def _top(c: Counter, k: int = 12) -> list[dict]:
    return [{"v": v, "n": n} for v, n in c.most_common(k)]


def merge_rollups(rolls: list[dict]) -> dict:
    """Rollups of several models as one: per code, objects summed and what
    it appears with merged; validity as the first model that links it."""
    def merge(rows_lists, keys):
        out: dict[str, dict] = {}
        for rows in rows_lists:
            for r in rows:
                m = out.get(r["code"])
                if m is None:
                    m = out[r["code"]] = {**r, **{k: Counter() for k in keys}}
                    m["n"] = 0
                elif m["valid"] is None and r["valid"] is not None:
                    m.update(valid=r["valid"], description=r["description"], reason=r["reason"])
                m["n"] += r["n"]
                for k in keys:
                    for x in r.get(k) or []:
                        m[k][x["v"]] += x["n"]
        return [{**m, **{k: _top(m[k]) for k in keys}} for _, m in sorted(out.items())]

    links: dict[str, str] = {}
    for r in rolls:
        for p, lbl in r["links"].items():
            links.setdefault(p, lbl)
    return {
        "links": links,
        "objects": sum(r["objects"] for r in rolls),
        "systems": merge([r["systems"] for r in rolls], ("systems", "components")),
        "components": merge([r["components"] for r in rolls], ("systems",)),
    }


def rollup(coded: list[Coded], rules: TFMRules) -> dict:
    """Per system code and per component code: objects, valid in the linked
    standard or not (with the reason), the standard's description, and the
    systems / components it appears with."""
    lk = links(rules)
    sys_n, comp_n = Counter(), Counter()
    sys_inst, sys_comp, comp_sys = defaultdict(Counter), defaultdict(Counter), defaultdict(Counter)
    validity: dict[tuple[str, str], Validity | None] = {}
    for c in coded:
        sk, ko, lop = c.parts.get("systemkode"), c.parts.get("komponent"), c.parts.get("lopenummer")
        if sk:
            sys_n[sk] += 1
            if lop:
                sys_inst[sk][f"{sk}.{lop}"] += 1
            if ko:
                sys_comp[sk][ko] += 1
            validity.setdefault(("systemkode", sk), c.validity.get("systemkode"))
        if ko:
            comp_n[ko] += 1
            if sk:
                comp_sys[ko][sk] += 1
            validity.setdefault(("komponent", ko), c.validity.get("komponent"))

    def row(part: str, code: str, n: int) -> dict:
        v = validity.get((part, code))
        if v is None and part in lk:
            v = check_code(code, lk[part])
        return {
            "code": code, "n": n,
            "valid": None if v is None else v.ok,
            "description": v.description if v else "",
            "reason": v.reason if v else "",
        }

    systems = []
    for code in sorted(sys_n):
        r = row("systemkode", code, sys_n[code])
        r["systems"] = _top(sys_inst[code])
        r["components"] = _top(sys_comp[code])
        systems.append(r)
    components = []
    for code in sorted(comp_n):
        r = row("komponent", code, comp_n[code])
        r["systems"] = _top(comp_sys[code])
        components.append(r)
    return {
        "links": {p: STANDARDS[k][1] for p, k in lk.items()},
        "objects": len(coded),
        "systems": systems,
        "components": components,
    }
