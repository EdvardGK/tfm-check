"""
Shared constants and the TFM token-sequence data model.

A TFM pattern is a flat ``sequence`` of string tokens. Each token is one of:
- a *part* (kodeledd) name from ``PART_TYPES`` (e.g. "Systemkode") → a named regex group
- a *separator* key from ``SEP_TO_CHAR`` (e.g. "." or "mellomrom")
- a *free-text* literal, marked with the ``FREETEXT_PREFIX`` sentinel ("T:...")

Defaults follow Statsbygg PA-0802 rev.3.
"""

from __future__ import annotations

import re

APP_VERSION = "1.0.0"

ACCEPTED_SCHEMA_PREFIXES = ("IFC2X3", "IFC4")
SPATIAL_TYPES = {"IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace"}

# Discipline → 1st-digit NS3451 range. RIV cited from PA-0802 §3.1 (VVS = 3xx);
# RIE cited indirectly from §4 (Elkraft) + §5 (Tele/automatisering, 5xx).
# ARK/RIB ranges are NOT PA-0802 — inferred from common NS3451 usage. Treat as hint.
DISCIPLINES = {
    "RIE":   dict(label="RIE — Elektro",   ns_range=["4", "5"]),
    "RIV":   dict(label="RIV — VVS",       ns_range=["3"]),
    "RIB":   dict(label="RIB — Bygg",      ns_range=["2"]),
    "ARK":   dict(label="ARK — Arkitekt",  ns_range=["2", "7"]),
    "RIBR":  dict(label="RIBR — Brann",    ns_range=["5"]),
    "RIA":   dict(label="RIA — Automasjon", ns_range=[]),
    "Annet": dict(label="Annet / ukjent",  ns_range=[]),
}

FILENAME_DISCIPLINE_PATTERNS = [
    ("RIBR", re.compile(r"(?<![A-Za-z])RIBR(?![A-Za-z])|RIBfy", re.I)),
    ("RIE",  re.compile(r"(?<![A-Za-z])RIE(?![A-Za-z])",  re.I)),
    ("RIV",  re.compile(r"(?<![A-Za-z])RIV(?![A-Za-z])",  re.I)),
    ("RIB",  re.compile(r"(?<![A-Za-z])RIB(?![A-Za-z])",  re.I)),
    ("ARK",  re.compile(r"(?<![A-Za-z])I?ARK(?![A-Za-z])", re.I)),
]

BYGNINGSDEL_SYSTEMS = {
    "NS3451": dict(label="NS 3451:2022", file="ns3451_2022.json"),
    "Ingen":  dict(label="Ingen sjekk", file=None),
}

KOMPONENT_SYSTEMS = {
    "NS3457-8": dict(label="NS 3457-8:2021", file="ns3457-8_2021.json"),
    "PA0802":   dict(label="PA 0802 komponentkoder", file="pa0802_komponent.json"),
    "IEC81346": dict(label="IEC 81346-2 — Funksjonsbokstaver", file="iec81346_letters.json"),
    "Ingen":    dict(label="Ingen sjekk", file=None),
}

# Part types — kodeledd parsed as named regex groups
PART_TYPES = [
    "Lokasjon", "Rom",
    "Systemkode", "Etasje",
    "Subnr", "Løpenummer",
    "Komponent", "Komp.nr",
    "T-suffiks",
]
PART_TO_TEMPLATE = {
    "Lokasjon":   "{lokasjon}",
    "Rom":        "{rom}",
    "Systemkode": "{systemkode}",
    "Etasje":     "{etasje}",
    "Subnr":      "{subnr}",
    "Løpenummer": "{lopenummer}",
    "Komponent":  "{komponent}",
    "Komp.nr":    "{kompnr}",
    "T-suffiks":  "{typeflag}",
}
SEP_TO_CHAR = {
    "+": "+", ".": ".", "-": "-", "_": "_", "/": "/",
    "mellomrom": " ", "=": "=", "++": "++",
}
SEP_OPTIONS_DISPLAY = list(SEP_TO_CHAR.keys())

SEP_NORWEGIAN_NAMES = {
    "+": "pluss", ".": "punktum", "-": "bindestrek", "_": "understrek",
    "/": "skråstrek", "=": "likhetstegn", "++": "dobbeltpluss", "mellomrom": "mellomrom",
}

# Default starting sequence — minimal system aspect (RIE element-level shape)
DEFAULT_SEQUENCE = ["Systemkode", ".", "Etasje", "-", "Komponent", "Løpenummer"]

# Statsbygg PA-0802 rev.3 canonical form: +123456=360.001-JV401
STATSBYGG_SEQUENCE = [
    "+", "Lokasjon", "=",
    "Systemkode", ".", "Løpenummer", "-",
    "Komponent", "Komp.nr",
]
# ... and a system without a component: +123456=360.001
STATSBYGG_SYSTEM_SEQUENCE = ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer"]

# PA-0802 rev.3 canonical forms (looser project-extension fallbacks where the
# standard doesn't specify). Etasje/Subnr/Rom are project-local — kept loose.
PLACEHOLDER_FALLBACK = {
    "lokasjon":   r"[A-Za-z0-9]{6}",
    "rom":        r"\d{1,5}",
    "systemkode": r"\d{3}",
    "etasje":     r"[A-Za-z0-9æøåÆØÅ_\- ]{1,12}",
    "subnr":      r"\d{1,4}",
    "lopenummer": r"\d{3}",
    "komponent":  r"[A-Z]{2}",
    "kompnr":     r"\d{3}",
    "typeflag":   r"T?",
}
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")

# Digit-type parts where users may lock an exact digit count
# (so {etasje}{subnr} on "103" parses as etasje="1" + subnr="03").
DIGIT_LOCKABLE_PARTS = ["etasje", "subnr", "kompnr", "lopenummer", "rom"]

THRESHOLDS = {"ok": 95, "warn": 50}

FREETEXT_PREFIX = "T:"  # sentinel for free-text literal blocks

# Concrete example values for live previews. Picked to look like real TFM codes.
PART_EXAMPLE = {
    "Lokasjon": "123456", "Rom": "012", "Systemkode": "244", "Etasje": "01",
    "Subnr": "01", "Løpenummer": "001", "Komponent": "DI", "Komp.nr": "001",
    "T-suffiks": "T",
}


def is_freetext(item: str) -> bool:
    return isinstance(item, str) and item.startswith(FREETEXT_PREFIX)


def freetext_value(item: str) -> str:
    return item[len(FREETEXT_PREFIX):] if is_freetext(item) else item


def sequence_to_template(seq: list[str]) -> str:
    parts = []
    for item in seq:
        if item in PART_TO_TEMPLATE:
            parts.append(PART_TO_TEMPLATE[item])
        elif item in SEP_TO_CHAR:
            parts.append(SEP_TO_CHAR[item])
        elif is_freetext(item):
            parts.append(freetext_value(item))
    return "".join(parts)


def sequence_to_example(seq: list[str]) -> str:
    parts = []
    for item in seq:
        if item in PART_EXAMPLE:
            parts.append(PART_EXAMPLE[item])
        elif item in SEP_TO_CHAR:
            parts.append(SEP_TO_CHAR[item])
        elif is_freetext(item):
            parts.append(freetext_value(item))
    return "".join(parts)
