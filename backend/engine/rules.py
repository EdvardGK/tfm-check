"""TFMRules — the validation rule-set, compiled from a token sequence to regexes."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict

from .constants import (
    APP_VERSION, DEFAULT_SEQUENCE, DISCIPLINES, DIGIT_LOCKABLE_PARTS,
    PLACEHOLDER_FALLBACK, PLACEHOLDER_RE, sequence_to_template,
)


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

    def _pattern_for_group(self, name: str) -> str:
        n = self.part_digits.get(name) if self.part_digits else None
        if n and name in DIGIT_LOCKABLE_PARTS and isinstance(n, int) and n > 0:
            return r"\d{" + str(n) + "}"
        return PLACEHOLDER_FALLBACK.get(name, r"\S+")

    def structures(self) -> list[str]:
        return [sequence_to_template(p.get("sequence", [])) for p in self.patterns]

    def regexes(self) -> list[re.Pattern]:
        out = []
        for s in self.structures():
            parts, i = [], 0
            for m in PLACEHOLDER_RE.finditer(s):
                parts.append(re.escape(s[i:m.start()]))
                name = m.group(1)
                parts.append(f"(?P<{name}>{self._pattern_for_group(name)})")
                i = m.end()
            parts.append(re.escape(s[i:]))
            out.append(re.compile("^" + "".join(parts)))
        return out

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
        )
