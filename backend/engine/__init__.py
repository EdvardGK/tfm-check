"""TFM-sjekk validation engine (framework-agnostic)."""

from .constants import (
    APP_VERSION, ACCEPTED_SCHEMA_PREFIXES, DISCIPLINES,
    BYGNINGSDEL_SYSTEMS, KOMPONENT_SYSTEMS, PART_TYPES, SEP_TO_CHAR,
    SEP_OPTIONS_DISPLAY, sequence_to_template, sequence_to_example,
)
from .rules import TFMRules
from .checks import run_checks, applicable_checks, status_for_pct
from .reports import build_excel, build_pdf, build_bundle
from .ifc_io import (
    open_ifc, list_products, model_facts, build_pset_index,
    detect_discipline_from_filename, extract_storey_codes_from_ifc,
    codes_for_bygningsdel, codes_for_komponent,
)
from .presets import list_presets, suggest_preset, suggest_field

__all__ = [
    "APP_VERSION", "ACCEPTED_SCHEMA_PREFIXES", "DISCIPLINES",
    "BYGNINGSDEL_SYSTEMS", "KOMPONENT_SYSTEMS", "PART_TYPES", "SEP_TO_CHAR",
    "SEP_OPTIONS_DISPLAY", "sequence_to_template", "sequence_to_example",
    "TFMRules", "run_checks", "applicable_checks", "status_for_pct",
    "build_excel", "build_pdf", "build_bundle",
    "open_ifc", "list_products", "model_facts", "build_pset_index",
    "detect_discipline_from_filename", "extract_storey_codes_from_ifc",
    "codes_for_bygningsdel", "codes_for_komponent",
    "list_presets", "suggest_preset", "suggest_field",
]
