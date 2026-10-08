"""Linked standards (NS 3451, NS 3457-8), a segment's own rule (pattern,
value, list), the rollup of system and component codes, and the upload job.
Run from backend/: python -m pytest tests -q"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.codes import coded_objects, rollup  # noqa: E402
from engine.ifc_io import list_products  # noqa: E402
from engine.inventory import ModelIndex  # noqa: E402
from engine.presets import PRESETS, preset_to_rules_dict  # noqa: E402
from engine.rules import TFMRules  # noqa: E402
from engine.shape import diagnose  # noqa: E402
from engine.standards import check_code, codelist  # noqa: E402

from test_phase_a import KOMP, LOK, MMI, SET, SYS, _model  # noqa: E402


def rules(**kw) -> TFMRules:
    d = preset_to_rules_dict(PRESETS[0])
    d.update({"part_digits": {"lokasjon": 2}, "bygningsdel_system": "NS3451", "komponent_system": "NS3457-8"})
    d.update(kw)
    return TFMRules.from_dict(d)


# ---- standards -------------------------------------------------------------

def test_lists_are_the_complete_ones():
    assert len(codelist("NS3451").codes) == 813
    assert len(codelist("NS3457-8").codes) == 910
    assert codelist("PA0802").codes["JP"]


@pytest.mark.parametrize("value,key,ok,frag", [
    ("320", "NS3451", False, "(32 Varme)"),
    ("361", "NS3451", True, ""),
    ("227", "NS3451", False, "reservert"),
    ("JP", "NS3457-8", True, ""),
    ("KRA", "NS3457-8", True, ""),
    ("JPQ", "NS3457-8", False, "finnes ikke i NS 3457-8 (JP Pumper)"),
    ("Å", "NS3457-8", False, "bør ikke benyttes"),
    ("QA", "IEC81346", True, ""),
])
def test_check_code(value, key, ok, frag):
    v = check_code(value, key)
    assert v.ok is ok
    assert frag in v.reason


def test_unlinked_is_not_checked():
    assert check_code("320", "Ingen") is None


# ---- a segment's own rule --------------------------------------------------

def test_part_rule_value():
    r = rules(part_rules={"lokasjon": {"kind": "value", "value": "02"}})
    assert diagnose("+02=361.001", r).ok
    d = diagnose("+04=361.001", r)
    assert not d.ok and "Plasserings-ID «04», skal være «02»" in d.reason


def test_part_rule_list():
    r = rules(part_rules={"systemkode": {"kind": "list", "values": ["361", "362"]}})
    assert diagnose("+02=362.001", r).ok
    d = diagnose("+02=364.001", r)
    assert not d.ok and "en av 361, 362" in d.reason


def test_part_rule_pattern():
    r = rules(part_rules={"komponent": {"kind": "pattern", "pattern": "^[A-Z]{2,3}$"}})
    assert diagnose("+02=361.001-KRA016", r).ok
    assert not diagnose("+02=361.001-K016", r).ok


def test_bad_pattern_fails_loudly():
    r = rules(part_rules={"systemkode": {"kind": "pattern", "pattern": "[0-9"}})
    assert not diagnose("+02=361.001", r).ok


def test_empty_rule_is_dropped():
    r = rules(part_rules={"lokasjon": {"kind": "list", "values": [" ", ""]}})
    assert r.part_rules == {}


# ---- rollup ----------------------------------------------------------------

@pytest.fixture(scope="module")
def model():
    f = _model()
    products = list_products(f)
    return f, products, ModelIndex(f, products)


def parts_rules(**kw) -> TFMRules:
    return rules(
        tfm_mode="parts",
        tfm_parts={"lokasjon": ["pset", SET, LOK], "system": ["pset", SET, SYS], "komponent": ["pset", SET, KOMP]},
        status_location=["pset", SET, MMI],
        **kw,
    )


def test_rollup(model):
    _, _, index = model
    r = parts_rules()
    coded, excluded = coded_objects(index, r)
    assert len(coded) == 4 and excluded == 0
    roll = rollup(coded, r)
    assert roll["links"] == {"systemkode": "NS 3451", "komponent": "NS 3457-8"}
    sys_ = {s["code"]: s for s in roll["systems"]}
    assert sys_["320"]["valid"] is False and "finnes ikke" in sys_["320"]["reason"]
    assert sys_["360"]["n"] == 3
    assert {x["v"]: x["n"] for x in sys_["360"]["systems"]} == {"360.001": 2, "360.017": 1}
    comp = {c["code"]: c for c in roll["components"]}
    assert comp["JP"]["valid"] is True and comp["JP"]["description"] == "Pumper"
    assert comp["JP"]["systems"][0]["v"] == "320"


def test_coded_reason_joins_shape_and_standard(model):
    _, _, index = model
    coded, _ = coded_objects(index, parts_rules())
    c = next(x for x in coded if x.code == "+02=320.003-JP401")
    assert c.diag.ok and c.std_ok is False
    assert "«320» finnes ikke i NS 3451" in c.reason()


# ---- the upload job ----------------------------------------------------------

def test_upload_job_reads_and_indexes(model):
    import main

    f, _, _ = model
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        path = tmp.name
    f.write(path)
    main._jobs["t1"] = {"t": time.time(), "stage": "les", "fraction": None, "products": None,
                        "file_size": 0, "result": None, "error": None}
    seen = []
    orig = main._job_set

    def spy(job_id, **kw):
        seen.append(kw.get("stage") or kw.get("fraction"))
        orig(job_id, **kw)

    main._job_set = spy
    try:
        main._read_job("t1", path, "HI90_RIV.ifc", 1)
    finally:
        main._job_set = orig
    j = main._jobs["t1"]
    assert j["stage"] == "ferdig", j["error"]
    assert j["products"] == 5
    assert j["result"]["detected_discipline"] == "RIV"
    assert "indekser" in seen and 0.0 in seen
    up = main.store.get(j["result"]["upload_id"])
    assert up is not None and up.index is not None
    assert not Path(path).exists()


class _Codes:
    """The index surface coded_objects reads."""

    def __init__(self, codes):
        self.product_ids = list(codes)
        self.type_of = {}
        self._codes = codes

    def code_values(self, rules):
        return self._codes


def test_codes_off_the_form_still_roll_up():
    r = rules()
    coded, _ = coded_objects(_Codes({1: "-SFZ.004T", 2: "+04=360.001-KRA.016", 3: "+04-QLB.04T"}), r)
    by = {c.pid: c for c in coded}
    assert by[1].parts["komponent"] == "SFZ"
    assert by[2].parts["komponent"] == "KRA" and by[2].parts["systemkode"] == "360"
    assert by[3].parts["komponent"] == "QLB"
    roll = rollup(coded, r)
    comp = {c["code"]: c for c in roll["components"]}
    assert comp["KRA"]["valid"] is True and comp["KRA"]["description"] == "Rør for væske"
    assert comp["SFZ"]["valid"] is False


def test_gzipped_upload_is_unpacked(model, monkeypatch):
    import gzip
    import io

    import main

    f, _, _ = model
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        path = tmp.name
    f.write(path)
    raw = Path(path).read_bytes()
    Path(path).unlink()
    started = {}
    monkeypatch.setattr(main.threading, "Thread",
                        lambda target, args, daemon: type("T", (), {"start": lambda self: started.update(args=args)})())

    class Up:
        filename = "HI90_RIV.ifc.gz"
        file = io.BytesIO(gzip.compress(raw))

    out = main.start_job(Up())
    job_id, tmp_path, name, size = started["args"]
    assert name == "HI90_RIV.ifc" and size == len(raw) == out["file_size"]
    assert Path(tmp_path).read_bytes() == raw
    Path(tmp_path).unlink()


def test_register_over_two_models(model):
    import io

    from openpyxl import load_workbook

    from engine.register import build_register_xlsx, merge_registers, register_rows

    f, products, index = model
    a = register_rows(f, products, index, parts_rules(), "HI90_RIV.ifc", "RIV")
    b = register_rows(f, products, index, parts_rules(), "HI90_RIV_MMI800.ifc", "RIV")
    columns, rows, summaries, roll = merge_registers([a, b])
    assert len(rows) == len(a[1]) * 2
    assert {r["Modellkobling (fil)"] for r in rows} == {"HI90_RIV.ifc", "HI90_RIV_MMI800.ifc"}
    assert len(summaries) == 2
    sys_ = {s["code"]: s for s in roll["systems"]}
    assert sys_["360"]["n"] == 2 * {s["code"]: s for s in a[3]["systems"]}["360"]["n"]
    wb = load_workbook(io.BytesIO(build_register_xlsx(columns, rows, summaries, roll)))
    head = [c.value for c in wb["Sammendrag"][1]]
    assert head == ["Felt", "HI90_RIV.ifc", "HI90_RIV_MMI800.ifc"]


def test_own_part_label_in_reasons():
    r = rules(part_labels={"lopenummer": "Kurs"})
    assert "Kurs «3», skal være 3 siffer" in diagnose("+02=360.3", r).reason


def test_inventory_offers_ns8360_sources(model):
    from engine.inventory import inventory_payload

    _, _, index = model
    inv = inventory_payload(index, [])
    assert [s["location"][1:] for s in inv["roles"]["system"]["standards"]] == [
        ["NOSSB_Reference", "RefPriSysOcc"], ["NONS_Reference", "RefPriSysOcc"]]
    assert [s["location"][1:] for s in inv["standards"]] == [["NOSSB_Reference", "RefString"], ["NONS_Reference", "RefString"]]
