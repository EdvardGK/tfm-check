"""Per-block config (B: tokens): each block carries what it represents, its
data type and its name; two blocks are two configs.
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


def blk(p=None, r=None, l=None):
    d = {}
    if p:
        d["p"] = p
    if r:
        d["r"] = r
    if l:
        d["l"] = l
    return "B:" + json.dumps(d, ensure_ascii=False)


DIG = lambda n: {"kind": "pattern", "pattern": r"\d{%d}" % n}  # noqa: E731


def test_two_number_blocks_are_two_configs():
    r = TFMRules.from_dict({"patterns": [{"sequence": [
        "=", "Systemkode", ".", "Løpenummer", ".",
        blk("Nummer", DIG(2), "Sløyfe"), ".", blk("Nummer", DIG(1), "Linje"), "-", "Komponent", "Komp.nr"]}]})
    assert r.own_numbers() == {"n_sloyfe": "Sløyfe", "n_linje": "Linje"}
    d = diagnose("=542.501.08.5-RY012", r)
    assert d.ok and d.parts["n_sloyfe"] == "08" and d.parts["n_linje"] == "5"
    d = diagnose("=542.501.8.5-RY012", r)
    assert not d.ok and "Sløyfe «8», skal være 2 siffer" in d.reason and d.fix == "=542.501.08.5-RY012"


def test_same_part_twice_with_different_rules():
    r = TFMRules.from_dict({"patterns": [{"sequence": [
        blk("Løpenummer", DIG(2)), ".", blk("Løpenummer", DIG(3))]}]})
    assert diagnose("04.010", r).ok
    assert not diagnose("004.10", r).ok


def test_block_type_links_and_unlinks_its_part():
    std = TFMRules.from_dict({"patterns": [{"sequence": [
        "=", blk("Systemkode", {"kind": "standard", "standard": "NS3451"}), "-", blk("Komponent", {"kind": "value", "value": "JP"}), "Komp.nr"]}],
        "komponent_system": "NS3457-8"})
    assert links(std) == {"systemkode": "NS3451"}
    assert diagnose("=361-JP401", std).ok
    assert not diagnose("=361-JV401", std).ok

    class One:
        product_ids = [1]
        type_of: dict = {}

        def code_values(self, rules):
            return {1: "=360-JP401"}

    coded, _ = coded_objects(One(), std)
    assert coded[0].std_ok is False


def test_block_label_names_the_part_in_reasons():
    r = TFMRules.from_dict({"patterns": [{"sequence": ["=", blk("Systemkode", None, "Anlegg"), ".", "Løpenummer"]}]})
    assert "Anlegg «36»" in diagnose("=36.001", r).reason


def test_register_has_own_number_columns():
    from test_phase_a import KOMP, LOK, MMI, SET, SYS, _model  # noqa: F401
    from engine.ifc_io import list_products
    from engine.inventory import ModelIndex
    from engine.register import register_rows

    f = _model()
    products = list_products(f)
    index = ModelIndex(f, products)
    r = TFMRules.from_dict({
        "patterns": [{"sequence": ["+", "Lokasjon", "=", "Systemkode", ".", blk("Nummer", DIG(3), "Kurs")]}],
        "part_digits": {"lokasjon": 2},
        "tfm_mode": "parts",
        "tfm_parts": {"lokasjon": ["pset", SET, LOK], "system": ["pset", SET, SYS]},
    })
    columns, rows, _, _ = register_rows(f, products, index, r, "X_RIV.ifc", "RIV")
    assert "Kurs" in columns and columns.index("Kurs") < columns.index("Kilde")
    by = {row["Kode som funnet"]: row for row in rows}
    assert by["+02=360.017"]["Kurs"] == "017"
