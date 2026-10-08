"""The code forms of two projects, as written in their own documents, built
from the builder's segments and rules (no project knowledge in the engine).

ST28: «Merkeinstruks for prosjekt STG 28 rev E» (Del A + Del B examples)
and «Oppsett regler merking elektro» (KNX, brann/nødlys, datakontakt).
HI90: Agilitek «1054-HIG90 Merkemanual VVS og automatikk» §2.6 and the
HI90 BIM- og merkemanual, pset HI90_TFM.
Run from backend/: python -m pytest tests -q"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.codes import coded_objects  # noqa: E402
from engine.rules import TFMRules  # noqa: E402
from engine.shape import diagnose  # noqa: E402

# Floor first in the system running number (U302, 802) and a floor of its
# own for where the component sits (.U3, .05).
ST28_RULES = {
    "lopenummer": {"kind": "pattern", "pattern": r"U?\d{3}"},
    "etasje": {"kind": "pattern", "pattern": r"U?\d{1,2}"},
}

ST28 = TFMRules.from_dict({
    "patterns": [
        # =320.U302.U3-JP401
        {"sequence": ["=", "Systemkode", ".", "Løpenummer", ".", "Etasje", "-", "Komponent", "Komp.nr"]},
        # =433.U301 (hovedsystem: no component floor)
        {"sequence": ["=", "Systemkode", ".", "Løpenummer"]},
        # KNX =564.201.1.5.02-RB012
        {"sequence": ["=", "Systemkode", ".", "Løpenummer", ".", "Område", ".", "Linje", ".", "Etasje", "-",
                      "Komponent", "Komp.nr"]},
        # Brann og nødlys =542.501.08.02-RY012
        {"sequence": ["=", "Systemkode", ".", "Løpenummer", ".", "Sløyfe", ".", "Etasje", "-", "Komponent", "Komp.nr"]},
        # Datakontakt, two addresses =521.402.04-UD012/013
        {"sequence": ["=", "Systemkode", ".", "Løpenummer", ".", "Etasje", "-", "Komponent", "Komp.nr", "/",
                      "Adresse 2"]},
        # Detektor: sentral, sløyfe, komponent 04.10-RY045
        {"sequence": ["Subnr", ".", "Sløyfe", "-", "Komponent", "Komp.nr"]},
        # Dør by room -DIH0621.1
        {"sequence": ["-", "Komponent", "Rom", ".", "Subnr"]},
    ],
    "part_rules": {
        **ST28_RULES,
        "subnr": {"kind": "pattern", "pattern": r"\d{1,2}"},
        "rom": {"kind": "pattern", "pattern": r"\d{4}"},
        "komponent": {"kind": "pattern", "pattern": r"[A-Z]{2,3}"},
    },
    "bygningsdel_system": "Ingen",
    "komponent_system": "Ingen",
})

ST28_CODES = [
    "=320.U302.U3-JP401", "=360.802.05-SQ442", "=547.601.06-XZ001", "=547.601.06-KA001",
    "=433.601.06-KW001", "=521.601.06-KX001", "=433.601.06-UE001", "=462.U301.U3-NB001",
    "=534.U101.U1-OS001", "=542.104.01-OS001", "=543.401.04-OS001", "=543.401.06-RK001",
    "=553.U301.U3-OS001", "=553.U301.01-RA001", "=564.401.05-RT601", "=564.403.05-RB601",
    "=433.U301", "=433.U302", "=360.801", "=360.804",
    "=564.201.1.5.02-RB012", "=542.501.08.02-RY012", "=521.402.04-UD012/013",
    "04.10-RY045", "-DIH0621.1",
]


@pytest.mark.parametrize("code", ST28_CODES)
def test_st28_forms(code):
    d = diagnose(code, ST28)
    assert d.ok, d.reason


def test_st28_parts_are_read():
    p = diagnose("=564.201.1.5.02-RB012", ST28).parts
    assert (p["systemkode"], p["lopenummer"], p["omrade"], p["linje"], p["etasje"]) == ("564", "201", "1", "5", "02")
    p = diagnose("=521.402.04-UD012/013", ST28).parts
    assert (p["kompnr"], p["adresse"]) == ("012", "013")
    p = diagnose("=320.U302.U3-JP401", ST28).parts
    assert (p["lopenummer"], p["etasje"]) == ("U302", "U3")


def test_st28_off_forms_still_fail():
    assert not diagnose("=320.U3020.U3-JP401", ST28).ok
    assert not diagnose("=564.201.1.5.02-RB12", ST28).ok


# ---- HI90 ------------------------------------------------------------------

AGILITEK = TFMRules.from_dict({
    "patterns": [
        {"sequence": ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr"]},
        {"sequence": ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer"]},
    ],
    "part_digits": {"lokasjon": 2},
})


@pytest.mark.parametrize("code", ["+02=320.003-JP401", "+02=320.003-RT401", "+02=320.003-SM401",
                                  "+02=360.017", "+02=434.002", "+02=434.002-XQ415", "+02=370.001-LK401",
                                  "+02=320.001-LV401", "+02=320.001-IE401"])
def test_hi90_agilitek_forms(code):
    d = diagnose(code, AGILITEK)
    assert d.ok, d.reason


# A Forekomstnr of two digits, as a block of its own.
FOREKOMST2 = 'B:{"p": "Komp.nr", "r": {"kind": "pattern", "pattern": "\\\\d{2}"}}'

# The HI90 BIM- og merkemanual, pset HI90_TFM, column «Eksempel».
HI90_MANUAL = TFMRules.from_dict({
    "patterns": [
        # TFM Systemforekomst-ID =360.014
        {"sequence": ["=", "Systemkode", ".", "Løpenummer"]},
        # TFM Komponenttype-ID -SQZ008T
        {"sequence": ["-", "Komponent", "Komp.nr", "T-suffiks"]},
        # TFM Komponentforekost-ID %SQZ.008.06: .06 is the Forekomstnr under type SQZ.008
        {"sequence": ["%", "Typekode", ".", "Typenr", ".", FOREKOMST2]},
        # TFM-ID <>++ =360.014-SQZ033%SQZ.008.06 (no location in the example)
        {"sequence": ["T:<>", "++", "Lokasjon", "mellomrom", "=", "Systemkode", ".", "Løpenummer", "-",
                      "Komponent", "Komp.nr", "%", "Typekode", ".", "Typenr", ".", FOREKOMST2]},
    ],
    "part_rules": {
        "komponent": {"kind": "pattern", "pattern": r"[A-ZÆØÅ]{1,3}"},
        "lokasjon": {"kind": "pattern", "pattern": r"[A-Za-z0-9]*"},
    },
    "bygningsdel_system": "NS3451",
    "komponent_system": "NS3457-8",
    "part_links": {"typekode": "NS3457-8"},
})


@pytest.mark.parametrize("code", ["=360.014", "-SQZ008T", "%SQZ.008.06", "<>++ =360.014-SQZ033%SQZ.008.06"])
def test_hi90_manual_forms(code):
    d = diagnose(code, HI90_MANUAL)
    assert d.ok, d.reason


def test_hi90_tfm_id_parts_and_standard():
    d = diagnose("<>++ =360.014-SQZ033%SQZ.008.06", HI90_MANUAL)
    p = d.parts
    assert (p["systemkode"], p["lopenummer"], p["komponent"], p["kompnr"]) == ("360", "014", "SQZ", "033")
    assert (p["typekode"], p["typenr"], p["kompnr__2"]) == ("SQZ", "008", "06")

    class One:
        product_ids = [1]
        type_of: dict = {}

        def code_values(self, rules):
            return {1: "<>++ =360.014-SQZ033%SQZ.008.06"}

    coded, _ = coded_objects(One(), HI90_MANUAL)
    v = coded[0].validity
    # 360 is not an NS 3451:2022 code; SQZ is in NS 3457-8, as Komponent and as Typekode.
    assert v["systemkode"].ok is False
    assert v["komponent"].ok is True and v["typekode"].ok is True


def test_part_used_twice_in_one_form():
    r = TFMRules.from_dict({"patterns": [{"sequence": ["Subnr", ".", "Subnr", "-", "Komponent", "Komp.nr"]}],
                            "part_rules": {"subnr": {"kind": "pattern", "pattern": r"\d{2}"}}})
    d = diagnose("04.10-RY045", r)
    assert d.ok and d.parts["subnr"] == "04" and d.parts["subnr__2"] == "10"



def test_older_instance_segment_reads_as_forekomstnr():
    r = TFMRules.from_dict({"patterns": [{"sequence": ["%", "Typekode", ".", "Typenr", ".", "Instansnr"]}]})
    d = diagnose("%SQZ.008.06", r)
    assert d.ok and d.parts["kompnr"] == "06"
