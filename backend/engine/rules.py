"""TFMRules — the validation rule-set, compiled from a token sequence to regexes."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict

from .blocks import STANDARD_FORM, block_of, list_regex, safe_regex
from .constants import (
    APP_VERSION, DEFAULT_SEQUENCE, DISCIPLINES, DIGIT_LOCKABLE_PARTS,
    PLACEHOLDER_FALLBACK, sequence_to_template,
)


# A component code at the end of a value that does not take the format:
# two letters and their number after a separator (=411%KK003 -> KK).
_LOOSE_COMPONENT = re.compile(r"(?<![A-Za-zÆØÅæøå])([A-ZÆØÅ]{2})\d{0,4}$")


def loose_component(value: str) -> str:
    """The component code a malformed value still ends with, else ""."""
    m = _LOOSE_COMPONENT.search((value or "").strip())
    return m.group(1) if m else ""


# The PA 0802 aspects a composed code is built from, in order, each after
# its sign: +lokasjon =system -komponent.
ASPECTS = ("lokasjon", "system", "komponent")
ASPECT_SIGN = {"lokasjon": "+", "system": "=", "komponent": "-"}


def _loc(v) -> tuple | None:
    """A source as a 3-tuple, or None for none."""
    if not v:
        return None
    v = list(v) + [None, None, None]
    if v[0] not in ("pset", "attr"):
        return None
    return tuple(v[:3])


NEVER = r"(?!x)x"


def base_part(name: str) -> str:
    """A template part name without its repeat suffix (komponent__2)."""
    return name.split("__", 1)[0]


def clean_rule(r) -> dict | None:
    """A part rule as the engine takes it, or None when it sets nothing."""
    if not isinstance(r, dict):
        return None
    kind = r.get("kind")
    if kind == "pattern" and str(r.get("pattern") or "").strip():
        return {"kind": "pattern", "pattern": str(r["pattern"]).strip()}
    if kind == "value" and str(r.get("value") or "") != "":
        return {"kind": "value", "value": str(r["value"])}
    if kind == "list":
        vals = [str(v).strip() for v in (r.get("values") or []) if str(v).strip()]
        if vals:
            return {"kind": "list", "values": list(dict.fromkeys(vals))}
    if kind == "standard" and r.get("standard") in STANDARD_FORM:
        return {"kind": "standard", "standard": r["standard"]}
    return None


def rule_form(r: dict | None) -> str | None:
    """A part rule as a regex fragment: the pattern (anchors dropped), the
    value literally, or the listed values. A pattern that does not compile
    matches nothing, so the check fails loudly rather than passing."""
    if not r:
        return None
    if r["kind"] == "value":
        return re.escape(r["value"])
    if r["kind"] == "list":
        return list_regex(r["values"])
    if r["kind"] == "standard":
        return STANDARD_FORM[r["standard"]]
    return safe_regex(r["pattern"])


def compose(values: dict[str, str]) -> str:
    """A code composed from aspect values, each behind its sign (a value
    already carrying its sign keeps it). Empty aspects are left out."""
    out = []
    for a in ASPECTS:
        v = (values.get(a) or "").strip()
        if not v:
            continue
        sign = ASPECT_SIGN[a]
        out.append(v if v.startswith(sign) else sign + v)
    return "".join(out)


@dataclass
class TFMRules:
    project_name: str = ""
    discipline_key: str = "Annet"
    bygningsdel_system: str = "NS3451"
    komponent_system: str = "IEC81346"
    # Each pattern: {"sequence": list[str]} — sequence may include literal text.
    patterns: list[dict] = field(default_factory=lambda: [
        {"sequence": ["Systemkode", ".", "Etasje", "-", "Komponent", "Løpenummer"]}
    ])
    floor_codes: list[str] = field(default_factory=list)
    # ("all", None, None) | ("attr", None, "Name"/"Tag") | ("pset", pset_name, prop)
    tfm_location: tuple = ("all", None, None)
    # Optional exact digit-counts per digit-type part. {name: int}.
    part_digits: dict = field(default_factory=dict)
    # Etasjer: each model storey's floor code {storey name: code}, and the
    # style the codes were proposed in (statsbygg | u | custom).
    storey_codes: dict = field(default_factory=dict)
    floor_style: str = ""
    # Scope: component codes and type names left out of every check.
    scope_components: list[str] = field(default_factory=list)
    scope_types: list[str] = field(default_factory=list)
    # Kilde: the whole code in one source (tfm_location), or composed from
    # the PA 0802 aspects, each in its own source: {"lokasjon": loc,
    # "system": loc, "komponent": loc} (a missing aspect is left out).
    tfm_mode: str = "whole"
    tfm_parts: dict = field(default_factory=dict)
    # Status: the source of the element's MMI (status) code, or None.
    status_location: tuple | None = None
    # A part's own rule, over its standard form: {part: {"kind": "pattern",
    # "pattern": "..."} | {"kind": "value", "value": "..."} |
    # {"kind": "list", "values": [...]}}.
    part_rules: dict = field(default_factory=dict)
    # A part linked to a standard beyond Systemkode / Komponent (which use
    # bygningsdel_system / komponent_system): {"typekode": "NS3457-8"}.
    part_links: dict = field(default_factory=dict)
    # A project's own name for a part ({"sloyfe": "Sløyfe"}); display only.
    part_labels: dict = field(default_factory=dict)

    def _pattern_for_group(self, name: str) -> str:
        name = base_part(name)
        own = rule_form((self.part_rules or {}).get(name))
        if own is not None:
            return own
        n = self.part_digits.get(name) if self.part_digits else None
        if n and isinstance(n, int) and n > 0:
            if name in DIGIT_LOCKABLE_PARTS:
                return r"\d{" + str(n) + "}"
            if name == "lokasjon":
                return r"[A-Za-z0-9]{" + str(n) + "}"
        return PLACEHOLDER_FALLBACK.get(name, r"\S+")

    def part_form(self, name: str) -> str:
        """A template part's strict form (lokasjon, systemkode …)."""
        return self._pattern_for_group(name)

    def structures(self) -> list[str]:
        return [sequence_to_template(p.get("sequence", [])) for p in self.patterns]

    def regexes(self) -> list[re.Pattern]:
        """Each form's blocks in order, nothing implied between them: a part
        as a named group, a fixed value literally, a list as its values, a
        pattern as itself."""
        out = []
        for p in self.patterns:
            src = []
            used: dict[str, int] = {}
            for token in p.get("sequence") or []:
                b = block_of(token)
                if b is None:
                    continue
                kind, v = b
                if kind == "part":
                    used[v] = used.get(v, 0) + 1
                    group = v if used[v] == 1 else f"{v}__{used[v]}"
                    src.append(f"(?P<{group}>{self._pattern_for_group(v)})")
                elif kind == "fixed":
                    src.append(re.escape(v))
                elif kind == "list":
                    src.append(list_regex(v))
                else:
                    src.append(safe_regex(v))
            out.append(re.compile("^" + "".join(src)))
        return out

    def full_regexes(self) -> list[re.Pattern]:
        """The forms anchored at both ends: the value IS the code, with
        nothing trailing (what an element's code is checked against)."""
        return [re.compile(rx.pattern + "$") for rx in self.regexes()]

    @property
    def composed(self) -> bool:
        return self.tfm_mode == "parts"

    @property
    def discipline_label(self) -> str:
        return DISCIPLINES.get(self.discipline_key, DISCIPLINES["Annet"])["label"]

    @property
    def expected_ns_range(self) -> list[str]:
        return DISCIPLINES.get(self.discipline_key, {}).get("ns_range", []) or []

    def has_part(self, part_type: str) -> bool:
        return any(part_type in (p.get("sequence") or []) for p in self.patterns)

    def to_template_dict(self) -> dict:
        d = asdict(self)
        d["tfm_location"] = list(self.tfm_location)
        d["app_version"] = APP_VERSION
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "TFMRules":
        """Build from a plain dict (API payload or saved template). Tolerant of
        missing keys and of tfm_location arriving as a list."""
        loc = data.get("tfm_location", ("all", None, None))
        if isinstance(loc, list):
            loc = tuple(loc + [None] * (3 - len(loc)))[:3]
        patterns = data.get("patterns") or [{"sequence": list(DEFAULT_SEQUENCE)}]
        patterns = [{"sequence": list(p.get("sequence") or [])} for p in patterns]
        part_digits = {}
        for k, v in (data.get("part_digits") or {}).items():
            try:
                part_digits[k] = int(v)
            except (TypeError, ValueError):
                pass
        return cls(
            project_name=data.get("project_name", "") or "",
            discipline_key=data.get("discipline_key", "Annet") or "Annet",
            bygningsdel_system=data.get("bygningsdel_system", "NS3451") or "NS3451",
            komponent_system=data.get("komponent_system", "IEC81346") or "IEC81346",
            patterns=patterns,
            floor_codes=list(data.get("floor_codes") or []),
            tfm_location=loc,
            part_digits=part_digits,
            storey_codes={str(k): str(v) for k, v in (data.get("storey_codes") or {}).items()},
            floor_style=str(data.get("floor_style") or ""),
            scope_components=[str(c) for c in (data.get("scope_components") or [])],
            scope_types=[str(t) for t in (data.get("scope_types") or [])],
            tfm_mode="parts" if data.get("tfm_mode") == "parts" else "whole",
            tfm_parts={k: _loc(v) for k, v in (data.get("tfm_parts") or {}).items()
                       if k in ASPECTS and _loc(v) is not None},
            status_location=_loc(data.get("status_location")),
            part_links={str(k): str(v) for k, v in (data.get("part_links") or {}).items() if v},
            part_labels={str(k): str(v).strip() for k, v in (data.get("part_labels") or {}).items()
                         if str(v or "").strip()},
            part_rules={str(k): r for k, r in ((k, clean_rule(v)) for k, v in
                                               (data.get("part_rules") or {}).items()) if r},
        )._with_rule_links()

    def _with_rule_links(self) -> "TFMRules":
        """A part whose data type is a standard list is linked to it (the
        older fields bygningsdel_system / komponent_system / part_links)."""
        for part, r in (self.part_rules or {}).items():
            if r.get("kind") != "standard":
                continue
            if part == "systemkode":
                self.bygningsdel_system = r["standard"]
            elif part == "komponent":
                self.komponent_system = r["standard"]
            else:
                self.part_links = {**(self.part_links or {}), part: r["standard"]}
        return self
