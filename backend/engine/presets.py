"""Bundled TFM presets + auto-config suggestions.

A preset is a named rule template (the same shape ``TFMRules`` consumes), with
display metadata for the gallery. Presets, the builder, and the engine all share
the token-``sequence`` data model, so they round-trip freely.
"""

from __future__ import annotations

import re

from .constants import sequence_to_example

# Each preset carries an explicit `example` for display certainty; `sequence` is
# the source of truth that feeds TFMRules.
PRESETS: list[dict] = [
    {
        "id": "pa0802",
        "label": "PA-0802 (Statsbygg)",
        "discipline": "Annet",
        "description": "Statsbygg TFM rev.3 kanonisk form med lokasjon og systemledd.",
        "example": "+123456=244.001-DI001",
        "sequence": ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr"],
        # PA 0802 also codes a system without a component: +123456=244.001.
        "extra_sequences": [["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer"]],
        "bygningsdel_system": "NS3451",
        "komponent_system": "IEC81346",
        "part_digits": {},
    },
    {
        "id": "rie-element",
        "label": "RIE — element-nivå",
        "discipline": "RIE",
        "description": "Elektro, merking på elementnivå: systemkode · etasje · komponent.",
        "example": "433.001-KW001",
        "sequence": ["Systemkode", ".", "Etasje", "-", "Komponent", "Løpenummer"],
        "bygningsdel_system": "NS3451",
        "komponent_system": "IEC81346",
        "part_digits": {"etasje": 3, "lopenummer": 3},
    },
    {
        "id": "riv-system",
        "label": "RIV — system-nivå",
        "discipline": "RIV",
        "description": "VVS, system-prefiks: systemkode · løpenummer · subnummer.",
        "example": "310.011.01",
        "sequence": ["Systemkode", ".", "Løpenummer", ".", "Subnr"],
        "bygningsdel_system": "NS3451",
        "komponent_system": "Ingen",
        "part_digits": {"subnr": 2},
    },
    {
        "id": "minimal",
        "label": "Minimal / generisk",
        "discipline": "Annet",
        "description": "Enkelt utgangspunkt: systemkode og komponentbokstav.",
        "example": "433-KW",
        "sequence": ["Systemkode", "-", "Komponent"],
        "bygningsdel_system": "NS3451",
        "komponent_system": "IEC81346",
        "part_digits": {},
    },
]

_PRESET_BY_ID = {p["id"]: p for p in PRESETS}

_DISCIPLINE_TO_PRESET = {
    "RIE": "rie-element",
    "RIV": "riv-system",
}

# Pset names that strongly suggest a dedicated TFM field
_FIELD_PSET_RE = re.compile(r"(tfm|ns3451|merke|merking)", re.I)
_FIELD_PROP_RE = re.compile(r"(tfm|kode|code|merke)", re.I)


def list_presets() -> list[dict]:
    """Public gallery payload. Includes a freshly computed example as a sanity
    cross-check against the hardcoded one."""
    out = []
    for p in PRESETS:
        out.append({
            "id": p["id"],
            "label": p["label"],
            "discipline": p["discipline"],
            "description": p["description"],
            "example": p["example"] or sequence_to_example(p["sequence"]),
            "rules": preset_to_rules_dict(p),
        })
    return out


def preset_to_rules_dict(preset: dict) -> dict:
    """Convert a preset into the TFMRules dict shape the API/builder use."""
    return {
        "discipline_key": preset.get("discipline", "Annet"),
        "bygningsdel_system": preset.get("bygningsdel_system", "NS3451"),
        "komponent_system": preset.get("komponent_system", "IEC81346"),
        "patterns": [{"sequence": list(preset["sequence"])}]
        + [{"sequence": list(x)} for x in preset.get("extra_sequences") or []],
        "part_digits": dict(preset.get("part_digits") or {}),
    }


def suggest_preset(discipline_key: str | None) -> str:
    return _DISCIPLINE_TO_PRESET.get(discipline_key or "", "pa0802")


def suggest_field(psets_index: dict[str, list[str]]) -> dict:
    """Best guess where the TFM code lives. Prefer a dedicated TFM/NS3451 pset;
    otherwise scan all fields. Returns {location: [...], label: str}."""
    for pset_name in psets_index:
        if _FIELD_PSET_RE.search(pset_name):
            props = psets_index[pset_name]
            prop = next((p for p in props if _FIELD_PROP_RE.search(p)), props[0] if props else None)
            if prop:
                return {"location": ["pset", pset_name, prop],
                        "label": f"{pset_name} → {prop}"}
    return {"location": ["all", None, None], "label": "Alle felt"}
