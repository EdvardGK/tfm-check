"""The block model: a form is an ordered list of blocks with nothing implied
between them; a block's data type makes it a separator (fixed value), an
accepted-separator slot (list), a code part (pattern / standard list) or text.
Run from backend/: python -m pytest tests -q"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.codes import coded_objects  # noqa: E402
from engine.rules import TFMRules  # noqa: E402
from engine.shape import diagnose  # noqa: E402
from engine.standards import links  # noqa: E402


def sl(*vals):
    return "SL:" + json.dumps(list(vals))


def test_blocks_next_to_each_other():
    # KKA immediately followed by 001, no separator between them.
    r = TFMRules.from_dict({
        "patterns": [{"sequence": ["Komponent", "Komp.nr"]}],
        "part_rules": {"komponent": {"kind": "pattern", "pattern": "[A-Z]{3}"}},
    })
    assert diagnose("KKA001", r).ok
    assert not diagnose("KKA.001", r).ok


def test_accepted_separators_list():
    r = TFMRules.from_dict({"patterns": [{"sequence": ["=", "Systemkode", sl(".", "_"), "Løpenummer"]}]})
    assert diagnose("=360.001", r).ok
    assert diagnose("=360_001", r).ok
    d = diagnose("=360-001", r)
    assert not d.ok and "«-» der formatet har «.» eller «_»" in d.reason
    assert d.fix == "=360.001"


def test_pattern_block():
    r = TFMRules.from_dict({"patterns": [{"sequence": ["Systemkode", "SR:[.:]", "Løpenummer"]}]})
    assert diagnose("360:001", r).ok and diagnose("360.001", r).ok
    d = diagnose("360/001", r)
    assert not d.ok and d.fix == ""


def test_fixed_text_block():
    r = TFMRules.from_dict({"patterns": [{"sequence": ["T:<>", "=", "Systemkode"]}]})
    assert diagnose("<>=360", r).ok


def test_standard_list_as_data_type():
    r = TFMRules.from_dict({
        "patterns": [{"sequence": ["=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr"]}],
        "part_rules": {"systemkode": {"kind": "standard", "standard": "NS3451"},
                       "komponent": {"kind": "standard", "standard": "NS3457-8"}},
        "bygningsdel_system": "Ingen", "komponent_system": "Ingen",
    })
    # The data type links the part: validity beyond form follows it.
    assert links(r) == {"systemkode": "NS3451", "komponent": "NS3457-8"}
    assert diagnose("=361.001-KRA016", r).ok  # three letters: an NS 3457-8 code form

    class One:
        product_ids = [1, 2]
        type_of: dict = {}

        def code_values(self, rules):
            return {1: "=361.001-KRA016", 2: "=360.001-SFZ004"}

    coded, _ = coded_objects(One(), r)
    by = {c.pid: c for c in coded}
    assert by[1].std_ok is True
    assert by[2].std_ok is False and "«360» finnes ikke i NS 3451" in by[2].reason()


def test_old_ruleset_reads_unchanged():
    old = {"patterns": [{"sequence": ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr"]}],
           "part_digits": {"lokasjon": 2}, "bygningsdel_system": "NS3451", "komponent_system": "NS3457-8"}
    r = TFMRules.from_dict(old)
    assert diagnose("+02=320.003-JP401", r).ok
    assert links(r) == {"systemkode": "NS3451", "komponent": "NS3457-8"}


def test_generic_number_block():
    # «Nummer» not yet said what it represents: a number, no specific part.
    r = TFMRules.from_dict({
        "patterns": [{"sequence": ["Komponent", "Nummer"]}],
        "part_rules": {"komponent": {"kind": "pattern", "pattern": "[A-Z]{3}"},
                       "nummer": {"kind": "pattern", "pattern": r"\d{3}"}},
    })
    d = diagnose("KKA001", r)
    assert d.ok and d.parts == {"komponent": "KKA", "nummer": "001"}
    # Said: the component occurrence number, as an older ruleset has it.
    r2 = TFMRules.from_dict({"patterns": [{"sequence": ["Komponent", "Komp.nr", "%", "Typekode", "Typenr", ".", "Typeundernr"]}],
                             "part_rules": {"komponent": {"kind": "pattern", "pattern": "[A-Z]{3}"}}})
    d2 = diagnose("KKA001%SQZ008.06", r2)
    assert d2.ok and d2.parts["kompnr"] == "001" and d2.parts["typeundernr"] == "06"


def test_own_named_numbers_are_parts_of_their_own():
    from engine.ifc_io import list_products  # noqa: F401
    from engine.register import register_rows  # noqa: F401

    r = TFMRules.from_dict({
        "patterns": [{"sequence": ["=", "Systemkode", ".", "Løpenummer", ".", "N:Sløyfe", ".", "N:Linje", "-", "Komponent", "Komp.nr"]}],
        "part_rules": {"n_sloyfe": {"kind": "pattern", "pattern": r"\d{2}"}},
    })
    assert r.own_numbers() == {"n_sloyfe": "Sløyfe", "n_linje": "Linje"}
    d = diagnose("=542.501.08.5-RY012", r)
    assert d.ok and d.parts["n_sloyfe"] == "08" and d.parts["n_linje"] == "5"
    d = diagnose("=542.501.8.5-RY012", r)
    assert not d.ok and "Sløyfe «8», skal være" in d.reason and d.fix == "=542.501.08.5-RY012"
