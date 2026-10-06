"""Engine parity check against the documented G55 manual analysis.

Oracle: ../../skiplum/.../G55_TFM-sjekk/docs/2026-05-19_manuell-analyse-RIE-RIV.md
Run:  .venv/Scripts/python.exe backend/parity_check.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from engine import (  # noqa: E402
    TFMRules, run_checks, open_ifc, list_products, model_facts,
    detect_discipline_from_filename, codes_for_bygningsdel, codes_for_komponent,
    list_presets, suggest_preset,
)

MODELS = Path(
    r"c:\workspace\skiplum\client-projects\10027-grønland-55"
    r"\underprosjekter\G55_TFM-sjekk\01_Inn\models"
)

PRESETS = {p["id"]: p for p in list_presets()}


def run_one(fname: str):
    path = MODELS / fname
    if not path.exists():
        print(f"  !! missing fixture: {path}")
        return None
    ifc = open_ifc(str(path))
    products = list_products(ifc)
    facts = model_facts(ifc, products)
    disc = detect_discipline_from_filename(fname)
    preset = PRESETS[suggest_preset(disc)]
    rules = TFMRules.from_dict(preset["rules"])
    bd = codes_for_bygningsdel(rules.bygningsdel_system)
    komp = codes_for_komponent(rules.komponent_system)
    res = run_checks(ifc, products, rules, bd, komp)
    c = res["checks"]

    def pct(d):
        return f'{d["n"]:,}/{d["total"]:,} ({d["pct"]:.1f}%)'

    print(f"\n=== {fname}  ·  schema {facts['schema']}  ·  disiplin {disc}  "
          f"·  preset {preset['id']} ===")
    print(f"  produkter            : {facts['n_products']:,}")
    print(f"  IfcSystems           : {facts['n_systems']}")
    print(f"  has_code             : {pct(c['has_code'])}")
    print(f"  system_prefix        : {pct(c['system_prefix'])}")
    print(f"  system_assign        : {pct(c['system_assign'])}")
    print(f"  tfm_system           : {pct(c['tfm_system'])}")
    return facts, c


def check(label, cond):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
    return cond


def main():
    ok = True

    rie = run_one("G55_RIE.ifc")
    if rie:
        facts, c = rie
        print("  — parity vs doc (RIE):")
        ok &= check("produkter == 7748", facts["n_products"] == 7748)
        ok &= check("IfcSystems == 24", facts["n_systems"] == 24)
        ok &= check("has_code == 0 (ingen element-TFM)", c["has_code"]["n"] == 0)
        ok &= check("system_assign == 7570 (97.7%)", c["system_assign"]["n"] == 7570)
        ok &= check("tfm_system == 0", c["tfm_system"]["n"] == 0)

    riv = run_one("G55_RIV.ifc")
    if riv:
        facts, c = riv
        print("  — parity vs doc (RIV):")
        ok &= check("produkter == 34963", facts["n_products"] == 34963)
        ok &= check("IfcSystems == 37", facts["n_systems"] == 37)
        ok &= check("system_assign == 30228 (86.5%)", c["system_assign"]["n"] == 30228)
        # system_prefix/tfm_system depend on strict pattern matching; report only.

    print(f"\n==> {'ALL PARITY CHECKS PASSED' if ok else 'SOME CHECKS FAILED'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
