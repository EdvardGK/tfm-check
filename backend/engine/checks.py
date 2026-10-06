"""The TFM validation engine — ports run_checks plus result helpers."""

from __future__ import annotations

from collections import Counter

import ifcopenshell.util.element as eu

from .constants import BYGNINGSDEL_SYSTEMS, KOMPONENT_SYSTEMS, THRESHOLDS
from .ifc_io import build_storey_map, candidate_strings_for
from .rules import TFMRules, loose_component


def status_for_pct(pct: float):
    if pct >= THRESHOLDS["ok"]:
        return ("OK", "#059669")
    if pct >= THRESHOLDS["warn"]:
        return ("Advarsel", "#d97706")
    return ("Avvik", "#dc2626")


CHECK_ORDER = ["has_code", "bd_valid", "in_discipline", "floor_valid",
               "floor_consistency", "komp_valid",
               "system_prefix", "system_assign", "tfm_system"]


def applicable_checks(results: dict):
    out = []
    for k in CHECK_ORDER:
        c = results["checks"][k]
        if k == "floor_valid" and not results["has_floor_check"]:
            continue
        if k == "komp_valid" and not results["has_komp_check"]:
            continue
        if k == "bd_valid" and not results["has_bd_check"]:
            continue
        if k == "in_discipline" and not results["has_disc_check"]:
            continue
        if k == "floor_consistency" and not results.get("has_floor_consistency_check"):
            continue
        if c["total"] == 0 and k not in ("has_code", "system_prefix",
                                         "system_assign", "tfm_system"):
            continue
        out.append((k, c))
    return out


def run_checks(ifc, products, rules: TFMRules,
               bygningsdel_codes: dict, komponent_codes: dict) -> dict:
    regexes = rules.regexes()
    structures = rules.structures()
    floor_set = set(rules.floor_codes)
    has_floor = bool(floor_set) and rules.has_part("Etasje")
    has_bd = bool(bygningsdel_codes) and rules.has_part("Systemkode")
    has_komp = bool(komponent_codes) and rules.has_part("Komponent")
    expected_ns = set(rules.expected_ns_range)

    storey_map = build_storey_map(ifc, rules.storey_codes)

    # Scope: elements whose component code or type name is out of scope
    # take part in no check.
    scope_comp = {c.upper() for c in rules.scope_components}
    scope_types = set(rules.scope_types)
    excluded_ids: set[int] = set()

    def _type_name(elem) -> str:
        t = eu.get_type(elem)
        return (t.Name or "") if t is not None else ""

    n_has_code = n_struct_ok = 0
    part_total = Counter()
    part_ok = Counter()
    n_bd_valid = n_bd_total = 0
    n_in_disc = n_disc_total = 0
    n_komp_valid = n_komp_total = 0
    n_floor_match = n_floor_match_total = 0
    cross_disc = Counter()
    invalid_bd = Counter()
    invalid_komp = Counter()
    field_hits = Counter()
    pattern_hits = Counter()
    seen_systems = Counter()
    seen_components = Counter()
    seen_systemkode = Counter()
    seen_floors = Counter()
    floor_mismatch = Counter()
    vvs_lopenummer = Counter()
    missing, invalid, code_samples = [], [], []

    type_stats: dict[str, dict] = {}

    def _bump(typ, **kw):
        d = type_stats.setdefault(typ, {"total": 0, "with_code": 0, "valid": 0, "errors": 0})
        for k, v in kw.items():
            d[k] = d.get(k, 0) + v

    for e in products:
        typ = e.is_a()
        if scope_types and _type_name(e) in scope_types:
            excluded_ids.add(e.id())
            continue

        chosen = None
        chosen_idx = None
        for fld, val in candidate_strings_for(e, rules.tfm_location):
            for idx, rx in enumerate(regexes):
                m = rx.search(val)
                if m:
                    chosen = (fld, val, m)
                    chosen_idx = idx
                    break
            if chosen:
                break

        if scope_comp:
            if chosen is not None:
                ko_scope = (chosen[2].groupdict().get("komponent") or "").upper()
            else:
                ko_scope = next((c for c in (loose_component(v) for _, v in
                                             candidate_strings_for(e, rules.tfm_location)) if c), "")
            if ko_scope and ko_scope in scope_comp:
                excluded_ids.add(e.id())
                continue
        _bump(typ, total=1)

        if chosen is None:
            if len(missing) < 500:
                missing.append({
                    "GUID": e.GlobalId, "Type": typ,
                    "Navn": (e.Name or "")[:80],
                    "Tag": str(getattr(e, "Tag", "") or "")[:40],
                })
            continue

        fld, val, m = chosen
        n_has_code += 1
        n_struct_ok += 1
        _bump(typ, with_code=1)
        field_hits[fld] += 1
        pattern_hits[f"Mønster {chosen_idx + 1}"] += 1
        g = m.groupdict()
        any_invalid = False

        bd = g.get("systemkode")
        if bd is not None:
            seen_systemkode[bd] += 1
            if has_bd:
                part_total["systemkode"] += 1
                n_bd_total += 1
                if bd in bygningsdel_codes:
                    part_ok["systemkode"] += 1
                    n_bd_valid += 1
                    if expected_ns:
                        n_disc_total += 1
                        if bd[:1] in expected_ns:
                            n_in_disc += 1
                        else:
                            cross_disc[bd] += 1
                else:
                    invalid_bd[bd] += 1
                    any_invalid = True

        et = g.get("etasje")
        if et is not None:
            seen_floors[et] += 1
            if has_floor:
                part_total["etasje"] += 1
                if et in floor_set:
                    part_ok["etasje"] += 1
                else:
                    any_invalid = True
            actual = storey_map.get(e.id())
            if actual:
                n_floor_match_total += 1
                if actual == et or actual == et.zfill(2) or et == actual.lstrip("0"):
                    n_floor_match += 1
                else:
                    floor_mismatch[f"{et} ≠ {actual}"] += 1

        ko = g.get("komponent")
        if ko is not None:
            seen_components[ko] += 1
            if has_komp:
                part_total["komponent"] += 1
                n_komp_total += 1
                first = ko[:1].upper()
                if first in komponent_codes:
                    part_ok["komponent"] += 1
                    n_komp_valid += 1
                else:
                    invalid_komp[first or "(tom)"] += 1
                    any_invalid = True

        for nm in ("lopenummer", "subnr", "kompnr", "lokasjon", "rom"):
            if nm in g:
                part_total[nm] += 1
                part_ok[nm] += 1

        # PA-0802 §3.1.3 VVS-funksjonsområder (informational, RIV + 3xx only)
        if rules.discipline_key == "RIV":
            bd_for_vvs = g.get("systemkode") or ""
            knr = g.get("kompnr") or ""
            if bd_for_vvs.startswith("3") and knr.isdigit() and len(knr) == 3:
                vvs_lopenummer[knr] += 1

        if bd:
            full = bd
            if et:
                full += f".{et}"
            lop = g.get("lopenummer")
            if lop:
                full += f".{lop}"
            seen_systems[full] += 1

        if any_invalid:
            _bump(typ, errors=1)
        else:
            _bump(typ, valid=1)

        if len(code_samples) < 200:
            code_samples.append({
                "GUID": e.GlobalId, "Type": typ, "Mønster": chosen_idx + 1,
                "Felt": fld, "Kode": val[:80],
                **{k: g.get(k, "") for k in g.keys()},
            })
        if any_invalid and len(invalid) < 500:
            invalid.append({
                "GUID": e.GlobalId, "Type": typ, "Mønster": chosen_idx + 1,
                "Navn": (e.Name or "")[:60], "Felt": fld, "Kode": val[:60],
                **{k: g.get(k, "") for k in g.keys()},
            })

    try:
        systems = ifc.by_type("IfcSystem")
    except RuntimeError:
        systems = []
    sys_rows, n_sys_ok = [], 0
    for s in systems:
        name = s.Name or ""
        ok = any(rx.search(name) for rx in regexes)
        if ok:
            n_sys_ok += 1
        sys_rows.append({"Navn": name, "TFM-prefiks": "Ja" if ok else "Nei"})

    n_assigned = n_tfm_assigned = 0
    unassigned_types = Counter()
    for e in products:
        if e.id() in excluded_ids:
            continue
        sf = []
        for rel in getattr(e, "HasAssignments", []) or []:
            if rel.is_a("IfcRelAssignsToGroup"):
                gobj = rel.RelatingGroup
                if gobj.is_a("IfcSystem"):
                    sf.append(gobj)
        if sf:
            n_assigned += 1
            if any(any(rx.search(s.Name or "") for rx in regexes) for s in sf):
                n_tfm_assigned += 1
        else:
            unassigned_types[e.is_a()] += 1

    def pct(a, b):
        return (a / b * 100) if b else 0.0

    n_excluded = len(excluded_ids)
    n_total = len(products) - n_excluded

    type_rows = []
    for t, d in sorted(type_stats.items(), key=lambda kv: -kv[1]["total"]):
        total = d["total"]
        type_rows.append({
            "IfcType": t, "Antall": total, "Med kode": d["with_code"],
            "Coverage %": round(d["with_code"] / total * 100, 1) if total else 0.0,
            "Gyldig": d["valid"], "Feil": d["errors"],
        })

    bd_sys_label = BYGNINGSDEL_SYSTEMS.get(rules.bygningsdel_system, {}).get("label", "klassifikasjon")
    komp_sys_label = KOMPONENT_SYSTEMS.get(rules.komponent_system, {}).get("label", "klassifikasjon")

    vvs_bands = {
        "401-499 (tur / tilluft)": 0,
        "501-599 (retur / avtrekk)": 0,
        "601-899 (rom)": 0,
        "901-999 (friluft)": 0,
        "Utenfor de definerte områdene": 0,
    }
    for code, count in vvs_lopenummer.items():
        try:
            n = int(code)
        except ValueError:
            vvs_bands["Utenfor de definerte områdene"] += count
            continue
        if 401 <= n <= 499:
            vvs_bands["401-499 (tur / tilluft)"] += count
        elif 501 <= n <= 599:
            vvs_bands["501-599 (retur / avtrekk)"] += count
        elif 601 <= n <= 899:
            vvs_bands["601-899 (rom)"] += count
        elif 901 <= n <= 999:
            vvs_bands["901-999 (friluft)"] += count
        else:
            vvs_bands["Utenfor de definerte områdene"] += count

    checks = {
        "has_code":      dict(n=n_has_code, total=n_total, pct=pct(n_has_code, n_total),
                              label="Element har TFM-kode"),
        "bd_valid":      dict(n=n_bd_valid, total=n_bd_total, pct=pct(n_bd_valid, n_bd_total),
                              label=f"Systemkode i {rules.bygningsdel_system}"),
        "in_discipline": dict(n=n_in_disc, total=n_disc_total, pct=pct(n_in_disc, n_disc_total),
                              label=f"I forventet område for {rules.discipline_key}"),
        "floor_valid":   dict(n=part_ok["etasje"], total=part_total["etasje"],
                              pct=pct(part_ok["etasje"], part_total["etasje"]),
                              label="Etasjekode tillatt"),
        "floor_consistency": dict(n=n_floor_match, total=n_floor_match_total,
                                  pct=pct(n_floor_match, n_floor_match_total),
                                  label="Kode-etasje = elementets storey"),
        "komp_valid":    dict(n=n_komp_valid, total=n_komp_total,
                              pct=pct(n_komp_valid, n_komp_total),
                              label=f"Komponent i {rules.komponent_system}"),
        "system_prefix": dict(n=n_sys_ok, total=len(systems),
                              pct=pct(n_sys_ok, len(systems)),
                              label="IfcSystem-prefiks"),
        "system_assign": dict(n=n_assigned, total=n_total, pct=pct(n_assigned, n_total),
                              label="Element tildelt IfcSystem"),
        "tfm_system":    dict(n=n_tfm_assigned, total=n_total, pct=pct(n_tfm_assigned, n_total),
                              label="Tildelt TFM-navnet system"),
    }

    return {
        "n_total": n_total, "n_excluded": n_excluded, "checks": checks,
        "has_floor_check": has_floor, "has_komp_check": has_komp,
        "has_bd_check": has_bd, "has_disc_check": bool(expected_ns) and has_bd,
        "has_floor_consistency_check": n_floor_match_total > 0,
        "field_hits": dict(field_hits), "pattern_hits": dict(pattern_hits),
        "structures": structures,
        "cross_disc": dict(cross_disc.most_common(40)),
        "invalid_bd": dict(invalid_bd.most_common(40)),
        "invalid_komp": dict(invalid_komp.most_common(20)),
        "floor_mismatch": dict(floor_mismatch.most_common(40)),
        "seen_systemkode": dict(seen_systemkode.most_common(50)),
        "seen_systems": dict(seen_systems.most_common(80)),
        "seen_components": dict(seen_components.most_common(50)),
        "seen_floors": dict(seen_floors.most_common(50)),
        "missing_samples": missing, "invalid_samples": invalid,
        "code_samples": code_samples, "type_rows": type_rows,
        "sys_rows": sys_rows,
        "unassigned_by_type": dict(unassigned_types.most_common(20)),
        "bd_sys_label": bd_sys_label, "komp_sys_label": komp_sys_label,
        "vvs_bands": vvs_bands,
        "vvs_lopenummer_total": int(sum(vvs_lopenummer.values())),
    }
