"""Scope as include / exclude rules over any property.
Run from backend/: python -m pytest tests -q"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.ifc_io import list_products  # noqa: E402
from engine.inventory import ModelIndex, preview  # noqa: E402
from engine.rules import TFMRules  # noqa: E402
from engine.scope import out_of_scope, values_of  # noqa: E402

from test_inventory import ST28_FORM, _model  # noqa: E402


def rules(**kw):
    base = {"patterns": [{"sequence": ST28_FORM}], "tfm_location": ["pset", "NOSSB_Reference", "RefString"]}
    base.update(kw)
    return TFMRules.from_dict(base)


def setup_module(_):
    global F, IDX
    F = _model()
    IDX = ModelIndex(F, list_products(F))


def test_no_rules_all_in():
    assert out_of_scope(IDX, rules()) == set()


def test_include_by_class_and_exclude_by_component():
    r = rules(scope_include=[{"source": {"kind": "class"}, "op": "er", "values": ["IfcLightFixture"]}],
              scope_exclude=[{"source": {"kind": "komponentkode"}, "op": "starter", "values": ["UP1"]}])
    out = out_of_scope(IDX, r)
    p = preview(IDX, r)
    assert p["in_scope"] == 8 - len(out)
    # Lamps only (6), minus the UP1.. ones? UP is 2 letters: «starter UP1» matches none.
    assert p["in_scope"] == 6


def test_exclude_by_property_regex_and_systemkode():
    r = rules(scope_exclude=[{"source": {"kind": "prop", "loc": ["pset", "Annet_Sett", "Kode"]}, "op": "regex", "values": ["X[0-3]"]}])
    assert preview(IDX, r)["in_scope"] == 4
    r = rules(scope_include=[{"source": {"kind": "systemkode"}, "op": "er", "values": ["411"]}])
    assert preview(IDX, r)["in_scope"] == 1  # =411.001.01-KK001 (the other reads 4111)


def test_values_offered_with_counts():
    v = values_of(IDX, rules(), {"kind": "class"})
    assert {x["v"]: x["n"] for x in v} == {"IfcLightFixture": 6, "IfcCableCarrierSegment": 2}
    assert values_of(IDX, rules(), {"kind": "systemkode"})[0] == {"v": "433", "n": 4}


def test_older_fields_still_exclude():
    p = preview(IDX, rules(scope_components=["KK"], scope_types=["Lampe A"]))
    assert p["in_scope"] == 0
