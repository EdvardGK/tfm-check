"""IDS -> ruleset: what maps, and what is refused with its reason.
Run from backend/: python -m pytest tests -q"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.ids_import import import_ids  # noqa: E402
from engine.rules import TFMRules  # noqa: E402
from engine.shape import diagnose  # noqa: E402

KNM = Path(r"c:\workspace\skiplum\client-projects\10016-kistefos\underprosjekter\KNM_Mottakskontroll\02_arbeid\ids\KNM.ids")

HEAD = ('<?xml version="1.0" encoding="UTF-8"?><ids xmlns="http://standards.buildingsmart.org/IDS" '
        'xmlns:xs="http://www.w3.org/2001/XMLSchema"><info><title>T</title></info><specifications>')
TAIL = "</specifications></ids>"


def spec(name, facet):
    return (f'<specification name="{name}" ifcVersion="IFC4"><applicability><entity><name><simpleValue>IFCPUMP'
            f'</simpleValue></name></entity></applicability><requirements>{facet}</requirements></specification>')


def prop(pset, name, value=""):
    return (f'<property cardinality="required"><propertySet><simpleValue>{pset}</simpleValue></propertySet>'
            f'<baseName><simpleValue>{name}</simpleValue></baseName>{value}</property>')


def pattern(p):
    return f'<value><xs:restriction base="xs:string"><xs:pattern value="{p}"/></xs:restriction></value>'


def enum(*vs):
    return ('<value><xs:restriction base="xs:string">' + "".join(f'<xs:enumeration value="{v}"/>' for v in vs)
            + "</xs:restriction></value>")


def test_synthetic_ids():
    xml = HEAD + "".join([
        spec("tfm", prop("P_TFM", "TFM-ID", pattern(r"=\d{3}\.\d{3}-[A-Z]{2}\d{3}"))),
        spec("lok", prop("P_TFM", "Plasserings-ID", enum("02", "03"))),
        spec("mmi", prop("P_Info", "MMI", enum("300", "700"))),
        spec("sys", prop("P_TFM", "Systemforekomst-ID", pattern(r"\d{3}\.\d{3}"))),
        spec("name", '<attribute cardinality="required"><name><simpleValue>Name</simpleValue></name></attribute>'),
        spec("len", prop("P_TFM", "TFM", '<value><xs:restriction base="xs:string"><xs:length value="5"/>'
                                         '</xs:restriction></value>')),
    ]) + TAIL
    r = import_ids(xml.encode())
    rules = r["rules"]
    assert rules["tfm_mode"] == "whole" and rules["tfm_location"] == ["pset", "P_TFM", "TFM"]
    assert rules["tfm_parts"]["lokasjon"] == ["pset", "P_TFM", "Plasserings-ID"]
    assert rules["status_location"] == ["pset", "P_Info", "MMI"]
    assert rules["part_rules"]["lokasjon"] == {"kind": "list", "values": ["02", "03"]}
    by = {s["name"]: s for s in r["specs"]}
    assert by["tfm"]["mapped"] and "mønster" in by["tfm"]["rule"]
    assert "flere segmenter" in by["sys"]["detail"]
    assert "ingen verdisjekk" in by["mmi"]["detail"]
    assert not by["name"]["mapped"] and "attribute" in by["name"]["detail"]
    assert "length=5" in by["len"]["detail"]
    assert "gjelder 1 IFC-klasser" in by["tfm"]["detail"]


def test_whole_code_pattern_becomes_the_form():
    xml = HEAD + spec("tfm", prop("P_TFM", "TFM", pattern(r"=\d{3}\.\d{3}-[A-Z]{2}\d{3}"))) + TAIL
    rules = TFMRules.from_dict(import_ids(xml.encode())["rules"])
    assert diagnose("=360.001-JV401", rules).ok
    d = diagnose("=360.001-JV41", rules)
    assert not d.ok and "TFM-ID" in d.reason


def test_not_an_ids():
    with pytest.raises(ValueError):
        import_ids(b"<?xml version='1.0'?><root/>")


@pytest.mark.skipif(not KNM.exists(), reason="KNM.ids not on this machine")
def test_knm_ids():
    r = import_ids(KNM.read_bytes())
    rules = r["rules"]
    assert r["title"] == "KNM"
    assert rules["tfm_location"] == ["pset", "KNM_TFM", "TFM"]
    assert rules["tfm_parts"]["komponent"] == ["pset", "KNM_TFM", "KomponentID"]
    assert rules["status_location"] == ["pset", "KNM_Project", "MMI"]
    mapped = [s["name"] for s in r["specs"] if s["mapped"]]
    assert mapped == ["KNM: MMI is a BEP MMI level", "KNM: KNM_TFM.TFM present", "KNM: KNM_TFM.KomponentID present"]
    assert all(s["detail"] for s in r["specs"] if not s["mapped"])
