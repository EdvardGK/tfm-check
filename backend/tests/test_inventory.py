"""The Oppsett walk's backend: storey reading, the model index, the inventory
and the preview. Run from backend/: python -m pytest tests -q"""

from __future__ import annotations

import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.inventory import (  # noqa: E402
    ModelIndex, classify_storey, classify_storeys, inventory_payload, preview,
)
from engine.ifc_io import list_products  # noqa: E402
from engine.presets import PRESETS, preset_to_rules_dict  # noqa: E402
from engine.rules import TFMRules  # noqa: E402
from engine.checks import run_checks  # noqa: E402

STATSBYGG = ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr"]
ST28_FORM = ["=", "Systemkode", ".", "Løpenummer", ".", "Etasje", "-", "Komponent", "Komp.nr"]


@pytest.mark.parametrize("name,kind,n,mezz", [
    ("Plan U3", "below", 3, False),
    ("Plan U1M", "below", 1, True),
    ("Plan 1M", "above", 1, True),
    ("Plan 01", "above", 1, False),
    ("2. etasje", "above", 2, False),
    ("00U", "below", 1, False),
    ("01U Underetasje", "below", 2, False),
    ("Kjeller", "below", 1, False),
    ("04L", "loft", 4, False),
    ("05T", "roof", 5, False),
    ("02M Mesanin", "above", 2, True),
])
def test_classify_storey(name, kind, n, mezz):
    p = classify_storey(name)
    assert p is not None
    assert (p["kind"], p["n"], p["mezz"]) == (kind, n, mezz)


def test_classify_storey_not_a_floor():
    assert classify_storey("Havnivå") is None
    assert classify_storey("") is None


def test_classify_storeys_orders_and_fills():
    rows = classify_storeys([
        {"name": "Plan 01", "elevation": 0.0, "n": 1},
        {"name": "Tak", "elevation": 9000.0, "n": 1},
        {"name": "Plan 02", "elevation": 3000.0, "n": 1},
        {"name": "Plan U1", "elevation": -3000.0, "n": 1},
    ])
    assert [r["name"] for r in rows] == ["Tak", "Plan 02", "Plan 01", "Plan U1"]
    assert rows[0]["floor"] == {"kind": "roof", "n": 3, "mezz": False}


def test_classify_storeys_by_elevation_when_no_name_reads():
    rows = classify_storeys([
        {"name": "Level B", "elevation": 3.0, "n": 1},
        {"name": "Level A", "elevation": 0.0, "n": 1},
    ])
    assert [(r["name"], r["floor"]["n"]) for r in rows] == [("Level B", 2), ("Level A", 1)]


def _model():
    f = ifcopenshell.file(schema="IFC4")
    project = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcProject", name="P")
    ifcopenshell.api.run("unit.assign_unit", f)
    site = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcSite", name="S")
    building = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcBuilding", name="B")
    ifcopenshell.api.run("aggregate.assign_object", f, products=[site], relating_object=project)
    ifcopenshell.api.run("aggregate.assign_object", f, products=[building], relating_object=site)
    storeys = {}
    for name, elev in (("Plan U1", -3.0), ("Plan 01", 0.0), ("Havnivå", -20.0)):
        st = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name=name)
        st.Elevation = elev
        ifcopenshell.api.run("aggregate.assign_object", f, products=[st], relating_object=building)
        storeys[name] = st

    lamp_type = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcLightFixtureType", name="Lampe A")
    duct_type = ifcopenshell.api.run("root.create_entity", f, ifc_class="IfcCableCarrierSegmentType", name="Kanal K")

    codes = [
        ("=433.101.01-UP101", lamp_type, "Plan 01"),
        ("=433.101.01-UP102", lamp_type, "Plan 01"),
        ("=433.101.U1-UP103", lamp_type, "Plan U1"),
        ("=433.101.3-UP104", lamp_type, "Plan 01"),
        ("=411.001.01-KK001", duct_type, "Plan 01"),
        ("ikke en kode", lamp_type, "Plan 01"),
        ("++ST28=4111%KK003", duct_type, "Plan 01"),
        (None, lamp_type, "Plan 01"),
    ]
    for i, (code, typ, storey) in enumerate(codes):
        cls = "IfcLightFixture" if typ is lamp_type else "IfcCableCarrierSegment"
        el = ifcopenshell.api.run("root.create_entity", f, ifc_class=cls, name=f"E{i}")
        ifcopenshell.api.run("type.assign_type", f, related_objects=[el], relating_type=typ)
        ifcopenshell.api.run("spatial.assign_container", f, products=[el], relating_structure=storeys[storey])
        if code is not None:
            pset = ifcopenshell.api.run("pset.add_pset", f, product=el, name="NOSSB_Reference")
            ifcopenshell.api.run("pset.edit_pset", f, pset=pset, properties={"RefString": code})
        other = ifcopenshell.api.run("pset.add_pset", f, product=el, name="Annet_Sett")
        ifcopenshell.api.run("pset.edit_pset", f, pset=other, properties={"Kode": f"X{i}"})
    return f


@pytest.fixture(scope="module")
def model():
    f = _model()
    products = list_products(f)
    return f, products, ModelIndex(f, products)


def _rules(**kw) -> TFMRules:
    base = {
        "patterns": [{"sequence": ST28_FORM}],
        "tfm_location": ["pset", "NOSSB_Reference", "RefString"],
    }
    base.update(kw)
    return TFMRules.from_dict(base)


def test_inventory(model):
    _, products, index = model
    presets = [TFMRules.from_dict(preset_to_rules_dict(p)) for p in PRESETS]
    inv = inventory_payload(index, presets)
    assert inv["products"] == len(products) == 8
    assert inv["standard"] == {"location": ["pset", "NOSSB_Reference", "RefString"], "n": 7}
    names = [s["name"] for s in inv["sets"]]
    assert names == ["Annet_Sett", "NOSSB_Reference"]
    ref = inv["sets"][1]
    assert ref["n"] == 7
    assert ref["props"][0]["name"] == "RefString"
    assert ref["props"][0]["distinct"] == 7
    assert len(ref["props"][0]["samples"]) == 3
    # No bundled preset reads X0..X6: no candidates.
    assert inv["candidates"] == []
    assert [s["name"] for s in inv["storeys"]] == ["Plan 01", "Plan U1", "Havnivå"]
    assert inv["storeys"][2]["floor"] is None
    assert inv["storeys"][0]["n"] == 7


def test_preview_counts(model):
    _, _, index = model
    p = preview(index, _rules(floor_codes=["01", "U1"]))
    assert p["products"] == 8
    assert p["valued"] == 7
    assert p["matched"] == 5
    assert {o["v"] for o in p["off"]} == {"ikke en kode", "++ST28=4111%KK003"}
    assert p["floors"]["total"] == 5
    assert p["floors"]["ok"] == 4
    # The malformed KK003 value still counts as KK.
    assert {c["code"]: c["n"] for c in p["components"]} == {"UP": 4, "KK": 2}


def test_preview_scope(model):
    _, _, index = model
    p = preview(index, _rules(scope_components=["KK"]))
    assert p["excluded"] == 2 and p["in_scope"] == 6
    assert p["matched"] == 4
    p = preview(index, _rules(scope_types=["Lampe A"]))
    assert p["excluded"] == 6
    assert next(t for t in p["types"] if t["name"] == "Lampe A")["out"] == 6


def test_preview_standard_form_has_no_floor(model):
    _, _, index = model
    p = preview(index, _rules(patterns=[{"sequence": STATSBYGG}]))
    assert p["matched"] == 0 and p["floor_part"] is False


def test_run_checks_scope_and_storey_codes(model):
    f, products, _ = model
    rules = _rules(
        floor_codes=["01", "U1"],
        scope_components=["KK"],
        storey_codes={"Plan 01": "01", "Plan U1": "U1", "Havnivå": "XX"},
    )
    res = run_checks(f, products, rules, {}, {})
    assert res["n_excluded"] == 2
    assert res["checks"]["has_code"]["total"] == 6
    assert res["checks"]["has_code"]["n"] == 4
    # Code floor against the storey's mapped code: 01, 01, U1 agree; 3 ≠ 01.
    assert res["checks"]["floor_consistency"]["n"] == 3
    assert res["checks"]["floor_consistency"]["total"] == 4


def test_preview_values_and_spans(model):
    _, _, index = model
    p = preview(index, _rules())
    assert p["distinct"] == 7
    assert p["off_distinct"] == 2
    by_v = {v["v"]: v for v in p["values"]}
    assert len(by_v) == 7
    off = by_v["ikke en kode"]
    assert off["ok"] is False and off["spans"] == []
    hit = by_v["=433.101.01-UP101"]
    assert hit["ok"] is True
    # Each part of the form where it falls in the value.
    parts = {name: hit["v"][a:b] for name, a, b in hit["spans"]}
    assert parts == {"systemkode": "433", "lopenummer": "101", "etasje": "01", "komponent": "UP", "kompnr": "101"}


def test_preview_tfm_shape(model):
    _, _, index = model
    # The Statsbygg form takes none of these values, but five are TFM codes.
    p = preview(index, _rules(patterns=[{"sequence": STATSBYGG}]))
    assert p["matched"] == 0
    assert p["shaped"] == 5
    assert {u["v"] for u in p["unshaped"]} == {"ikke en kode", "++ST28=4111%KK003"}
