"""
TFM-sjekk — IFC-mottakskontroll for TFM-merking.

Centric, progressive-disclosure UI. Visual structure builder følger Statsbygg
TFM-veiledning (lokasjon/system/komponent-aspekter). Klassifikasjonsvelger
(NS3451 + IEC 81346-2). Nedlastbar regelmal.

Run: streamlit run app.py
"""

from __future__ import annotations

import io
import json
import re
import tempfile
import time
import zipfile
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from collections import Counter

import streamlit as st
import pandas as pd
import altair as alt
import ifcopenshell
import ifcopenshell.util.element as eu

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak)

import usage

# =============================================================================
# CONSTANTS
# =============================================================================

APP_VERSION = "0.5.0"
HERE = Path(__file__).parent

ACCEPTED_SCHEMA_PREFIXES = ("IFC2X3", "IFC4")
SPATIAL_TYPES = {"IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace"}

DISCIPLINES = {
    "RIE":   dict(label="RIE — Elektro",       ns_range=["4", "5"]),
    "RIV":   dict(label="RIV — VVS",            ns_range=["3"]),
    "RIB":   dict(label="RIB — Bygg",           ns_range=["2"]),
    "ARK":   dict(label="ARK — Arkitekt",       ns_range=["2", "7"]),
    "RIBR":  dict(label="RIBR — Brann",         ns_range=["5"]),
    "Annet": dict(label="Annet / ukjent",       ns_range=[]),
}

FILENAME_DISCIPLINE_PATTERNS = [
    ("RIBR", re.compile(r"(?<![A-Za-z])RIBR(?![A-Za-z])|RIBfy", re.I)),
    ("RIE",  re.compile(r"(?<![A-Za-z])RIE(?![A-Za-z])",  re.I)),
    ("RIV",  re.compile(r"(?<![A-Za-z])RIV(?![A-Za-z])",  re.I)),
    ("RIB",  re.compile(r"(?<![A-Za-z])RIB(?![A-Za-z])",  re.I)),
    ("ARK",  re.compile(r"(?<![A-Za-z])I?ARK(?![A-Za-z])", re.I)),
]

# --- Classification systems --------------------------------------------------

BYGNINGSDEL_SYSTEMS = {
    "NS3451": dict(label="NS3451 — Bygningsdelstabell (norsk)",
                   file="ns3451_codes.json"),
    "Ingen":  dict(label="Ingen sjekk", file=None),
}

KOMPONENT_SYSTEMS = {
    "IEC81346": dict(label="IEC 81346-2 — Funksjonsbokstaver",
                     file="iec81346_letters.json"),
    "Ingen":    dict(label="Ingen sjekk", file=None),
}

# --- Visual structure builder ------------------------------------------------
# Følger Statsbygg TFM-veiledning: aspekter ++ (lokasjon), = (system), - (komponent).

PART_TYPES = [
    "Lokasjon", "Rom",            # ++lokasjon-aspekt
    "Bygningsdel", "Etasje",       # =system-aspekt (etasje her er TFM-internt nr, ikke storey-navn)
    "Subnr", "Løpenummer",
    "Komponent",                   # -komponent-aspekt: IEC 81346 funksjonsbokstav
    "Komp.nr",
]
PART_TO_TEMPLATE = {
    "Lokasjon":    "{lokasjon}",
    "Rom":         "{rom}",
    "Bygningsdel": "{bygningsdel}",
    "Etasje":      "{etasje}",
    "Subnr":       "{subnr}",
    "Løpenummer":  "{lopenummer}",
    "Komponent":   "{komponent}",
    "Komp.nr":     "{kompnr}",
}
SEP_OPTIONS = ["(ingen)", ".", "-", "_", "/", "(mellomrom)", "=", "++"]
SEP_TO_CHAR = {
    "(ingen)":      "",
    ".":            ".",
    "-":            "-",
    "_":            "_",
    "/":            "/",
    "(mellomrom)":  " ",
    "=":            "=",
    "++":           "++",
}

# Default builder rows — minimal system aspect (matches what most projects use).
DEFAULT_BUILDER = [
    {"Datatype": "Bygningsdel", "Skilletegn etter": "."},
    {"Datatype": "Etasje",       "Skilletegn etter": "-"},
    {"Datatype": "Komponent",    "Skilletegn etter": "(ingen)"},
    {"Datatype": "Løpenummer",   "Skilletegn etter": "(ingen)"},
]

PRESETS = {
    "Enkel (system)":          [
        {"Datatype": "Bygningsdel", "Skilletegn etter": "."},
        {"Datatype": "Etasje",       "Skilletegn etter": "-"},
        {"Datatype": "Komponent",    "Skilletegn etter": "(ingen)"},
        {"Datatype": "Løpenummer",   "Skilletegn etter": "(ingen)"},
    ],
    "VVS (tre-leddet)":        [
        {"Datatype": "Bygningsdel", "Skilletegn etter": "."},
        {"Datatype": "Etasje",       "Skilletegn etter": "."},
        {"Datatype": "Løpenummer",   "Skilletegn etter": "(ingen)"},
    ],
    "Statsbygg (full)":        [
        {"Datatype": "Lokasjon",    "Skilletegn etter": "."},
        {"Datatype": "Rom",          "Skilletegn etter": "="},
        {"Datatype": "Bygningsdel",  "Skilletegn etter": "."},
        {"Datatype": "Etasje",       "Skilletegn etter": "."},
        {"Datatype": "Subnr",        "Skilletegn etter": "-"},
        {"Datatype": "Komponent",    "Skilletegn etter": "."},
        {"Datatype": "Komp.nr",      "Skilletegn etter": "(ingen)"},
    ],
}

PLACEHOLDER_FALLBACK = {
    "lokasjon":    r"[A-Za-z0-9æøåÆØÅ_\-]{1,12}",
    "rom":         r"\d{1,5}",
    "bygningsdel": r"\d{3}",
    "etasje":      r"[A-Za-z0-9æøåÆØÅ_\- ]{1,12}",
    "subnr":       r"\d{1,4}",
    "lopenummer":  r"\d{1,4}(?:\.\d{1,4})?",
    "komponent":   r"[A-Za-zÆØÅæøå]{1,4}",
    "kompnr":      r"\d{1,4}",
}
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")

THRESHOLDS = {"ok": 95, "warn": 50}


@st.cache_resource
def load_codes(file_name: str | None) -> dict:
    if not file_name:
        return {}
    p = HERE / file_name
    if not p.exists():
        return {}
    with p.open(encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# HELPERS
# =============================================================================


def detect_discipline_from_filename(name: str) -> str | None:
    for key, pat in FILENAME_DISCIPLINE_PATTERNS:
        if pat.search(name):
            return key
    return None


def parse_storey_name_to_code(name: str) -> str:
    s = (name or "").strip()
    if not s:
        return ""
    m = re.search(r"\b(\d{1,3})\b", s)
    if m:
        return m.group(1).zfill(2)
    return s


def extract_storey_codes_from_ifc(ifc) -> list[str]:
    seen, out = set(), []
    for s in ifc.by_type("IfcBuildingStorey"):
        code = parse_storey_name_to_code(s.Name or "")
        if code and code not in seen:
            seen.add(code); out.append(code)
    return out


def load_ifc(uploaded_file) -> tuple[ifcopenshell.file, str]:
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp.write(uploaded_file.getvalue())
        tmp_path = tmp.name
    return ifcopenshell.open(tmp_path), tmp_path


def list_products(ifc):
    return [e for e in ifc.by_type("IfcProduct") if e.is_a() not in SPATIAL_TYPES]


def model_facts(ifc, products) -> dict:
    try:
        systems = ifc.by_type("IfcSystem")
    except RuntimeError:
        systems = []
    return {
        "schema": ifc.schema,
        "storey_names": [s.Name or "" for s in ifc.by_type("IfcBuildingStorey")],
        "n_systems": len(systems),
        "n_products": len(products),
        "originating_system": (ifc.header.file_name.originating_system or "").strip(),
    }


def build_pset_index(ifc) -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for rel in ifc.by_type("IfcRelDefinesByProperties"):
        if not any(o.is_a("IfcProduct") for o in rel.RelatedObjects):
            continue
        pset = rel.RelatingPropertyDefinition
        if not pset.is_a("IfcPropertySet") or not pset.Name:
            continue
        for p in pset.HasProperties or []:
            if p.is_a("IfcPropertySingleValue") and p.Name:
                out.setdefault(pset.Name, set()).add(p.Name)
    return {k: sorted(v) for k, v in sorted(out.items())}


def builder_rows_to_structure(rows: list[dict], start_prefix: str = "") -> str:
    parts = [start_prefix] if start_prefix else []
    for r in rows:
        dt = r.get("Datatype")
        sep = r.get("Skilletegn etter", "(ingen)")
        if dt not in PART_TYPES:
            continue
        parts.append(PART_TO_TEMPLATE.get(dt, ""))
        parts.append(SEP_TO_CHAR.get(sep, ""))
    return "".join(parts)


# =============================================================================
# RULES + REGEX
# =============================================================================


@dataclass
class TFMRules:
    project_name: str = ""
    discipline_key: str = "Annet"
    bygningsdel_system: str = "NS3451"
    komponent_system: str = "IEC81346"
    start_prefix: str = ""
    structure: str = "{bygningsdel}.{etasje}-{komponent}"
    builder_rows: list[dict] = field(default_factory=lambda: list(DEFAULT_BUILDER))
    floor_codes: list[str] = field(default_factory=list)
    tfm_location: tuple = ("all", None, None)

    def regex(self) -> re.Pattern:
        parts, i = [], 0
        for m in PLACEHOLDER_RE.finditer(self.structure):
            parts.append(re.escape(self.structure[i:m.start()]))
            name = m.group(1)
            parts.append(f"(?P<{name}>{PLACEHOLDER_FALLBACK.get(name, r'\\S+')})")
            i = m.end()
        parts.append(re.escape(self.structure[i:]))
        return re.compile("^" + "".join(parts))

    @property
    def discipline_label(self) -> str:
        return DISCIPLINES.get(self.discipline_key, DISCIPLINES["Annet"])["label"]

    @property
    def expected_ns_range(self) -> list[str]:
        return DISCIPLINES.get(self.discipline_key, {}).get("ns_range", []) or []

    def to_template_dict(self) -> dict:
        d = asdict(self)
        d["tfm_location"] = list(self.tfm_location)
        d["app_version"] = APP_VERSION
        return d


# =============================================================================
# ANALYSIS
# =============================================================================


def candidate_strings_for(elem, location: tuple):
    kind, ps, prop = location
    if kind == "attr":
        if prop == "Name" and elem.Name:
            yield ("Name", elem.Name)
        elif prop == "Tag":
            tag = getattr(elem, "Tag", None)
            if tag:
                yield ("Tag", str(tag))
        return
    if kind == "pset":
        psets = eu.get_psets(elem)
        v = psets.get(ps, {}).get(prop)
        if isinstance(v, str) and v.strip():
            yield (f"{ps}.{prop}", v)
        return
    if elem.Name:
        yield ("Name", elem.Name)
    tag = getattr(elem, "Tag", None)
    if tag:
        yield ("Tag", str(tag))
    for pn, pdict in eu.get_psets(elem).items():
        for k, v in pdict.items():
            if k == "id":
                continue
            if isinstance(v, str) and v.strip():
                yield (f"{pn}.{k}", v)


def run_checks(ifc, products, rules: TFMRules,
               bygningsdel_codes: dict, komponent_codes: dict) -> dict:
    rx = rules.regex()
    floor_set = set(rules.floor_codes)
    has_floor = bool(floor_set)
    has_bd = bool(bygningsdel_codes)
    has_komp = bool(komponent_codes)
    expected_ns = set(rules.expected_ns_range)

    n_total = len(products)
    n_has_code = n_struct_ok = 0
    part_total = Counter(); part_ok = Counter()
    n_bd_valid = n_bd_total = 0
    n_in_disc = n_disc_total = 0
    n_komp_valid = n_komp_total = 0
    cross_disc = Counter(); invalid_bd = Counter(); invalid_komp = Counter()
    field_hits = Counter()
    missing, invalid, code_samples = [], [], []

    for e in products:
        chosen = None
        for fld, val in candidate_strings_for(e, rules.tfm_location):
            m = rx.search(val)
            if m:
                chosen = (fld, val, m); break
        if chosen is None:
            if len(missing) < 500:
                missing.append({
                    "GUID": e.GlobalId, "Type": e.is_a(),
                    "Navn": (e.Name or "")[:80],
                    "Tag": str(getattr(e, "Tag", "") or "")[:40],
                })
            continue

        fld, val, m = chosen
        n_has_code += 1; n_struct_ok += 1
        field_hits[fld] += 1
        g = m.groupdict()
        any_invalid = False

        bd = g.get("bygningsdel")
        if bd is not None and has_bd:
            part_total["bygningsdel"] += 1; n_bd_total += 1
            if bd in bygningsdel_codes:
                part_ok["bygningsdel"] += 1; n_bd_valid += 1
                if expected_ns:
                    n_disc_total += 1
                    if bd[:1] in expected_ns: n_in_disc += 1
                    else: cross_disc[bd] += 1
            else:
                invalid_bd[bd] += 1; any_invalid = True

        et = g.get("etasje")
        if et is not None and has_floor:
            part_total["etasje"] += 1
            if et in floor_set: part_ok["etasje"] += 1
            else: any_invalid = True

        ko = g.get("komponent")
        if ko is not None and has_komp:
            part_total["komponent"] += 1; n_komp_total += 1
            first = ko[:1].upper()
            if first in komponent_codes:
                part_ok["komponent"] += 1; n_komp_valid += 1
            else:
                invalid_komp[first or "(tom)"] += 1; any_invalid = True

        for nm in ("lopenummer", "subnr", "kompnr", "lokasjon", "rom"):
            if nm in g:
                part_total[nm] += 1; part_ok[nm] += 1

        if len(code_samples) < 200:
            code_samples.append({
                "GUID": e.GlobalId, "Type": e.is_a(),
                "Felt": fld, "Kode": val[:80],
                **{k: g.get(k, "") for k in g.keys()},
            })
        if any_invalid and len(invalid) < 500:
            invalid.append({
                "GUID": e.GlobalId, "Type": e.is_a(),
                "Navn": (e.Name or "")[:60], "Felt": fld, "Kode": val[:60],
                **{k: g.get(k, "") for k in g.keys()},
            })

    try:
        systems = ifc.by_type("IfcSystem")
    except RuntimeError:
        systems = []
    sys_rows, n_sys_ok = [], 0
    for s in systems:
        ok = bool(rx.search(s.Name or ""))
        if ok: n_sys_ok += 1
        sys_rows.append({"Navn": s.Name or "", "TFM-prefiks": "Ja" if ok else "Nei"})

    n_assigned = n_tfm_assigned = 0
    unassigned_types = Counter()
    for e in products:
        sf = []
        for rel in getattr(e, "HasAssignments", []) or []:
            if rel.is_a("IfcRelAssignsToGroup"):
                gobj = rel.RelatingGroup
                if gobj.is_a("IfcSystem"):
                    sf.append(gobj)
        if sf:
            n_assigned += 1
            if any(rx.search(s.Name or "") for s in sf):
                n_tfm_assigned += 1
        else:
            unassigned_types[e.is_a()] += 1

    def pct(a, b): return (a / b * 100) if b else 0.0

    bd_sys_label = BYGNINGSDEL_SYSTEMS.get(rules.bygningsdel_system, {}).get("label", "klassifikasjon")
    komp_sys_label = KOMPONENT_SYSTEMS.get(rules.komponent_system, {}).get("label", "klassifikasjon")

    checks = {
        "has_code":      dict(n=n_has_code, total=n_total, pct=pct(n_has_code, n_total),
                              label="Element har TFM-kode"),
        "bd_valid":      dict(n=n_bd_valid, total=n_bd_total, pct=pct(n_bd_valid, n_bd_total),
                              label=f"Bygningsdel i {rules.bygningsdel_system}"),
        "in_discipline": dict(n=n_in_disc, total=n_disc_total, pct=pct(n_in_disc, n_disc_total),
                              label=f"I forventet område for {rules.discipline_key}"),
        "floor_valid":   dict(n=part_ok["etasje"], total=part_total["etasje"],
                              pct=pct(part_ok["etasje"], part_total["etasje"]),
                              label="Etasjekode tillatt"),
        "komp_valid":    dict(n=n_komp_valid, total=n_komp_total,
                              pct=pct(n_komp_valid, n_komp_total),
                              label=f"Komponent i {rules.komponent_system}"),
        "system_prefix": dict(n=n_sys_ok, total=len(systems),
                              pct=pct(n_sys_ok, len(systems)),
                              label="IfcSystem-prefiks"),
        "system_assign": dict(n=n_assigned, total=n_total, pct=pct(n_assigned, n_total),
                              label="Element tildelt IfcSystem"),
        "tfm_system":    dict(n=n_tfm_assigned, total=n_total,
                              pct=pct(n_tfm_assigned, n_total),
                              label="Tildelt TFM-navnet system"),
    }

    return {
        "n_total": n_total,
        "checks": checks,
        "has_floor_check": has_floor,
        "has_komp_check":  has_komp,
        "has_bd_check":    has_bd,
        "has_disc_check":  bool(expected_ns) and has_bd,
        "field_hits": dict(field_hits),
        "cross_disc": dict(cross_disc.most_common(40)),
        "invalid_bd":   dict(invalid_bd.most_common(40)),
        "invalid_komp": dict(invalid_komp.most_common(20)),
        "missing_samples": missing,
        "invalid_samples": invalid,
        "code_samples":    code_samples,
        "sys_rows": sys_rows,
        "unassigned_by_type": dict(unassigned_types.most_common(20)),
        "bd_sys_label": bd_sys_label,
        "komp_sys_label": komp_sys_label,
    }


# =============================================================================
# EXPORT
# =============================================================================


def status_for_pct(pct: float):
    if pct >= THRESHOLDS["ok"]:   return ("OK", "#059669")
    if pct >= THRESHOLDS["warn"]: return ("Advarsel", "#d97706")
    return ("Avvik", "#dc2626")


CHECK_ORDER = ["has_code", "bd_valid", "in_discipline", "floor_valid",
               "komp_valid", "system_prefix", "system_assign", "tfm_system"]


def applicable_checks(results: dict):
    out = []
    for k in CHECK_ORDER:
        c = results["checks"][k]
        if k == "floor_valid"   and not results["has_floor_check"]: continue
        if k == "komp_valid"    and not results["has_komp_check"]:  continue
        if k == "bd_valid"      and not results["has_bd_check"]:    continue
        if k == "in_discipline" and not results["has_disc_check"]:  continue
        if c["total"] == 0 and k not in ("has_code", "system_prefix",
                                          "system_assign", "tfm_system"):
            continue
        out.append((k, c))
    return out


def build_excel(rules, facts, results, file_name, file_size, duration) -> bytes:
    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="openpyxl") as xw:
        loc = rules.tfm_location
        loc_str = ("Alle felt" if loc[0] == "all"
                   else f"IfcProduct.{loc[2]}" if loc[0] == "attr"
                   else f"{loc[1]}.{loc[2]}")
        summary = [
            ["Prosjekt", rules.project_name],
            ["Disiplin", rules.discipline_label],
            ["Modellfil", file_name],
            ["Filstørrelse", f"{file_size/1_048_576:.1f} MB"],
            ["IFC schema", facts["schema"]],
            ["Eksportør", facts["originating_system"]],
            ["Produkter", facts["n_products"]],
            ["Etasjer (modell)", len(facts["storey_names"])],
            ["IfcSystems", facts["n_systems"]],
            ["TFM-struktur", rules.structure],
            ["Bygningsdel-system", results["bd_sys_label"]],
            ["Komponent-system", results["komp_sys_label"]],
            ["TFM-kode hentes fra", loc_str],
            ["Tillatte etasjekoder", ", ".join(rules.floor_codes) or "(ingen — sjekk hoppes over)"],
            ["Kjøretid", f"{duration:.1f} s"],
            ["Generert", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
            ["App", f"TFM-sjekk v{APP_VERSION}"],
        ]
        pd.DataFrame(summary, columns=["Felt", "Verdi"]).to_excel(xw, sheet_name="Sammendrag", index=False)

        rows = [[c["label"], c["n"], c["total"], f"{c['pct']:.1f}%"]
                for _, c in applicable_checks(results)]
        pd.DataFrame(rows, columns=["Sjekk", "OK", "Totalt", "Andel"]).to_excel(
            xw, sheet_name="Sjekker", index=False)

        if results["cross_disc"]:
            pd.DataFrame(list(results["cross_disc"].items()),
                         columns=["Bygningsdel utenfor disiplin", "Antall"]
                         ).to_excel(xw, sheet_name="Kryssfag", index=False)
        if results["invalid_bd"]:
            pd.DataFrame(list(results["invalid_bd"].items()),
                         columns=[f"Ikke-{rules.bygningsdel_system} kode", "Antall"]
                         ).to_excel(xw, sheet_name="Ugyldig_bygningsdel", index=False)
        if results["invalid_komp"]:
            pd.DataFrame(list(results["invalid_komp"].items()),
                         columns=[f"Ikke-{rules.komponent_system} bokstav", "Antall"]
                         ).to_excel(xw, sheet_name="Ugyldig_komponent", index=False)
        if results["field_hits"]:
            pd.DataFrame(sorted(results["field_hits"].items(), key=lambda kv: -kv[1]),
                         columns=["Felt", "Antall"]).to_excel(xw, sheet_name="Hvor_koden_ligger", index=False)
        pd.DataFrame(results["sys_rows"]).to_excel(xw, sheet_name="IfcSystems", index=False)
        if results["code_samples"]:
            pd.DataFrame(results["code_samples"]).to_excel(xw, sheet_name="Funne_koder", index=False)
        if results["missing_samples"]:
            pd.DataFrame(results["missing_samples"]).to_excel(xw, sheet_name="Uten_kode", index=False)
        if results["invalid_samples"]:
            pd.DataFrame(results["invalid_samples"]).to_excel(xw, sheet_name="Ugyldig_kode", index=False)
        if results["unassigned_by_type"]:
            pd.DataFrame(list(results["unassigned_by_type"].items()),
                         columns=["IfcType", "Antall"]
                         ).to_excel(xw, sheet_name="Uten_systemtilhørighet", index=False)
    return out.getvalue()


def build_pdf(rules, facts, results, file_name, file_size, duration) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
                            topMargin=18*mm, bottomMargin=18*mm,
                            title=f"TFM-sjekk — {rules.project_name}")
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=colors.HexColor("#2d4a3e"), spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=colors.HexColor("#3d5a4e"))
    body = styles["BodyText"]
    small = ParagraphStyle("small", parent=body, fontSize=8.5, textColor=colors.HexColor("#475569"))

    story = []
    story.append(Paragraph("TFM-mottakskontroll", h1))
    story.append(Paragraph(
        f"<b>{rules.project_name or '(uten prosjektnavn)'}</b> &nbsp;·&nbsp; "
        f"{rules.discipline_label}", body))
    story.append(Spacer(1, 4*mm))

    loc = rules.tfm_location
    loc_str = ("Alle felt" if loc[0] == "all"
               else f"IfcProduct.{loc[2]}" if loc[0] == "attr"
               else f"{loc[1]} → {loc[2]}")

    facts_tbl = [
        ["Modellfil", file_name],
        ["Filstørrelse", f"{file_size/1_048_576:.1f} MB"],
        ["IFC schema", facts["schema"]],
        ["Eksportør", facts["originating_system"] or "—"],
        ["Antall produkter", f"{facts['n_products']:,}".replace(",", " ")],
        ["Antall etasjer i modell", str(len(facts["storey_names"]))],
        ["Antall IfcSystems", str(facts["n_systems"])],
        ["TFM-struktur", rules.structure],
        ["Bygningsdel-system", results["bd_sys_label"]],
        ["Komponent-system", results["komp_sys_label"]],
        ["TFM-kode hentes fra", loc_str],
        ["Generert", datetime.now().strftime("%Y-%m-%d %H:%M")],
        ["Kjøretid", f"{duration:.1f} s"],
    ]
    t = Table(facts_tbl, colWidths=[55*mm, 110*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f0f0e8")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
    ]))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    story.append(Paragraph("Resultater", h2))
    data = [["Sjekk", "Andel", "Antall", "Status"]]
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d4a3e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i, (_, c) in enumerate(applicable_checks(results), start=1):
        status, color = status_for_pct(c["pct"])
        data.append([c["label"], f"{c['pct']:.1f}%",
                     f"{c['n']:,}/{c['total']:,}".replace(",", " "), status])
        cmds.append(("BACKGROUND", (3, i), (3, i), colors.HexColor(color)))
        cmds.append(("TEXTCOLOR",  (3, i), (3, i), colors.white))
        cmds.append(("FONTNAME",   (3, i), (3, i), "Helvetica-Bold"))
    t = Table(data, colWidths=[80*mm, 25*mm, 35*mm, 25*mm])
    t.setStyle(TableStyle(cmds))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    if results["cross_disc"]:
        story.append(Paragraph("Kryssfagsmarkører (utenfor disiplinens forventede område)", h2))
        d = [["Bygningsdel", "Antall"]]
        for k, v in list(results["cross_disc"].items())[:20]:
            d.append([k, str(v)])
        t = Table(d, colWidths=[40*mm, 25*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3d5a4e")),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ]))
        story.append(t)
        story.append(Paragraph(
            "<i>Kryssfagsmarkører er ikke nødvendigvis feil — verifiser om de hører hjemme her.</i>", small))
        story.append(Spacer(1, 6*mm))

    if results["sys_rows"]:
        story.append(PageBreak())
        story.append(Paragraph("IfcSystems", h2))
        d = [["Navn", "TFM-prefiks"]]
        for r in results["sys_rows"][:120]:
            d.append([r["Navn"][:90], r["TFM-prefiks"]])
        t = Table(d, colWidths=[130*mm, 35*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3d5a4e")),
            ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
            ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("LINEBELOW", (0, 0), (-1, -1), 0.2, colors.HexColor("#e2e8f0")),
        ]))
        story.append(t)
        if len(results["sys_rows"]) > 120:
            story.append(Paragraph(
                f"<i>… {len(results['sys_rows'])-120} flere vises ikke. Se Excel.</i>", small))

    story.append(Spacer(1, 8*mm))
    story.append(Paragraph(
        f"<i>Generert av Skiplum TFM-sjekk v{APP_VERSION}. Ingen elementnavn eller verdier "
        f"forlater verktøyet — kun aggregerte tellinger logges anonymt.</i>", small))
    doc.build(story)
    return buf.getvalue()


def build_bundle(xlsx: bytes, pdf: bytes, file_stem: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{file_stem}_tfm-sjekk.xlsx", xlsx)
        zf.writestr(f"{file_stem}_tfm-sjekk.pdf", pdf)
    return buf.getvalue()


# =============================================================================
# DIALOGS
# =============================================================================


@st.dialog("Detaljer", width="large")
def show_table_dialog(title: str, rows):
    st.markdown(f"##### {title}")
    if not rows:
        st.info("Ingen rader."); return
    st.dataframe(pd.DataFrame(rows), hide_index=True, height=520)


@st.dialog("Statistikk", width="small")
def show_stats_dialog():
    s = usage.stats()
    c1, c2 = st.columns(2)
    with c1:
        st.metric("Modeller behandlet", s["total_uploads"])
        st.metric("Snitt-størrelse", f"{s['avg_size_mb']:.1f} MB")
    with c2:
        st.metric("Distinkte sesjoner", s["distinct_sessions"])
        st.metric("Snitt-tid", f"{s['avg_duration_sec']:.1f} s")
    if s["schemas"]:
        st.caption("IFC-schema fordeling")
        st.dataframe(pd.DataFrame(list(s["schemas"].items()), columns=["Schema", "Antall"]),
                     hide_index=True, use_container_width=True)
    st.caption(f"App v{APP_VERSION} · Anonym telemetri: tidsstempel, filstørrelse, schema, "
               "produkter, kjøretid. Ingen filnavn eller modellinnhold.")


# =============================================================================
# UI HELPERS
# =============================================================================


def metric_card(label: str, pct: float, sub: str):
    status, color = status_for_pct(pct)
    st.markdown(f"""
    <div class="summary-card" style="border-left-color: {color};">
        <h4>{label}</h4>
        <div class="value" style="color: {color};">{pct:.1f}%</div>
        <div class="sub">{sub}</div>
        <div class="badge" style="background:{color};">{status}</div>
    </div>
    """, unsafe_allow_html=True)


def info_card(label: str, value: str, sub: str = ""):
    st.markdown(f"""
    <div class="summary-card" style="border-left-color: #94a3b8;">
        <h4>{label}</h4>
        <div class="value" style="color: #64748b; font-size: 1.3rem;">{value}</div>
        <div class="sub">{sub}</div>
    </div>
    """, unsafe_allow_html=True)


def floor_list_editor(key: str, seed: list[str] | None = None) -> list[str]:
    if key not in st.session_state:
        st.session_state[key] = list(seed or [])
    df = pd.DataFrame({"Etasjekode": st.session_state[key] or [""]})
    edited = st.data_editor(
        df, num_rows="dynamic", use_container_width=True, hide_index=True,
        key=f"editor_{key}",
        column_config={"Etasjekode": st.column_config.TextColumn("Etasjekode", width="medium")},
    )
    vals = [str(v).strip() for v in edited["Etasjekode"].tolist()
            if str(v).strip() and str(v).strip().lower() != "nan"]
    seen, out = set(), []
    for v in vals:
        if v not in seen:
            seen.add(v); out.append(v)
    st.session_state[key] = out
    return out


def structure_builder(key: str, seed: list[dict] | None = None) -> tuple[str, list[dict]]:
    if key not in st.session_state:
        st.session_state[key] = list(seed or DEFAULT_BUILDER)
    df = pd.DataFrame(st.session_state[key])
    edited = st.data_editor(
        df,
        num_rows="dynamic", hide_index=False, use_container_width=True,
        key=f"editor_{key}",
        column_config={
            "Datatype": st.column_config.SelectboxColumn(
                "📦 Datatype", options=PART_TYPES, required=True, width="medium",
                help="Hvilket kodeledd er dette? (Statsbygg-aspekter: Lokasjon/Rom for "
                     "++-aspekt, Bygningsdel/Etasje/Subnr/Løpenummer for =-aspekt, "
                     "Komponent/Komp.nr for --aspekt.)",
            ),
            "Skilletegn etter": st.column_config.SelectboxColumn(
                "🔗 Skilletegn etter", options=SEP_OPTIONS, required=False, width="small",
                help="Tegnet som følger leddet. Bruk `=` for å avslutte lokasjons-"
                     "aspektet, eller `-` for å starte komponent-aspektet.",
            ),
        },
    )
    rows = [r for r in edited.to_dict("records") if r.get("Datatype") in PART_TYPES]
    st.session_state[key] = rows
    return "", rows  # template built later including start_prefix


def reset_results():
    for k in list(st.session_state.keys()):
        if k.startswith("results_") or k in ("_xlsx", "_pdf", "_bundle", "_bundle_key", "_stem"):
            del st.session_state[k]


# =============================================================================
# APP
# =============================================================================


def main():
    st.set_page_config(page_title="TFM-sjekk", page_icon="🔍", layout="centered",
                       initial_sidebar_state="collapsed")

    if "session_id" not in st.session_state:
        st.session_state.session_id = usage.new_session_id()

    st.markdown("""
    <style>
        .stApp { background: linear-gradient(135deg, #f5f5f0 0%, #e8e4dc 100%); }
        .block-container { padding-top: 3rem; padding-bottom: 4rem; max-width: 880px; }
        header[data-testid="stHeader"] { background: transparent; }
        [data-testid="stSidebar"] { display: none; }

        .app-header {
            background: linear-gradient(135deg, #2d4a3e 0%, #3d5a4e 100%);
            color: white; padding: 1.5rem 2rem; border-radius: 12px;
            margin-bottom: 1rem;
        }
        .app-header h1 { color: white; margin: 0; font-size: 1.5rem; font-weight: 600; }
        .app-header p { color: #b8c9bf; margin: 0.25rem 0 0 0; font-size: 0.9rem; }

        .summary-card {
            background: white; border-radius: 10px;
            padding: 0.9rem 1rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            text-align: center; border-left: 4px solid #2d4a3e; min-height: 140px;
        }
        .summary-card h4 { font-size: 0.68rem; color: #64748b; margin: 0;
                            text-transform: uppercase; letter-spacing: 0.05em; }
        .summary-card .value { font-size: 1.7rem; font-weight: 700; color: #334155;
                                line-height: 1.1; margin: 0.3rem 0; }
        .summary-card .sub { font-size: 0.72rem; color: #94a3b8; }
        .summary-card .badge { display:inline-block; color:white; font-size:0.68rem;
                                font-weight:600; padding: 2px 8px; border-radius: 999px;
                                margin-top: 6px; }

        .fact-row {
            background: white; border-radius: 10px; padding: 0.7rem 1rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06); font-size: 0.85rem;
            color: #475569; margin-bottom: 1rem; text-align: center;
        }
        .fact-row strong { color: #1e293b; }

        [data-testid="stFileUploader"] {
            background: white; padding: 1rem; border-radius: 10px;
            border: 2px dashed #94a3b8;
        }

        .stButton > button[kind="primary"] {
            min-height: 54px; font-size: 1rem; font-weight: 600;
            border-radius: 10px; background: #2d4a3e; border: none;
        }
        .stButton > button[kind="primary"]:hover { background: #3d5a4e; }
        .stButton > button[kind="secondary"] {
            min-height: 44px; border-radius: 10px; font-weight: 500;
        }

        .step-label {
            font-size: 0.7rem; color: #2d4a3e; text-transform: uppercase;
            letter-spacing: 0.1em; font-weight: 700; margin: 1.5rem 0 0.25rem 0;
        }

        .detect-banner {
            background: #ecfeff; color: #155e75; border-left: 4px solid #06b6d4;
            padding: 0.6rem 1rem; border-radius: 6px; font-size: 0.85rem;
            margin-bottom: 0.5rem;
        }

        .preview-chip {
            display:inline-block; background:#1e293b; color:#a7f3d0;
            font-family: 'Consolas', 'Courier New', monospace;
            padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 1.05rem;
            margin: 0.25rem 0 0.5rem 0; letter-spacing: 0.03em;
            box-shadow: 0 2px 4px rgba(0,0,0,0.08);
        }

        #MainMenu { visibility: hidden; }
        footer { visibility: hidden; }
        .stDeployButton { display: none; }
    </style>
    """, unsafe_allow_html=True)

    # Header
    hdr_l, hdr_r = st.columns([5, 1])
    with hdr_l:
        st.markdown("""
        <div class="app-header">
            <h1>🔍 TFM-sjekk</h1>
            <p>Mottakskontroll på TFM-merking i IFC-fagmodeller</p>
        </div>
        """, unsafe_allow_html=True)
    with hdr_r:
        st.write("")
        if st.button("📊 Stats", use_container_width=True):
            show_stats_dialog()

    # ----- Step 1: Upload IFC -----
    st.markdown('<div class="step-label">Steg 1 — Last opp modell</div>', unsafe_allow_html=True)
    uploaded = st.file_uploader("Last opp IFC-fil", type=["ifc"], label_visibility="collapsed",
                                key="target_uploader")
    if not uploaded:
        st.info("Last opp en IFC-fil for å starte. Støttede schemaer: IFC2X3, IFC4, IFC4X1/2/3.")
        with st.expander("ℹ️ Om verktøyet"):
            st.markdown(f"""
**Hva sjekkes:**
- Element har TFM-kode i valgt felt
- Bygningsdelskoden er gyldig i valgt klassifikasjon (f.eks. NS3451)
- Bygningsdelskoden er i forventet område for disiplinen (kryssfagsflagg)
- Etasjekoden er i tillatt liste
- Komponentbokstaven er gyldig i valgt system (f.eks. IEC 81346-2)
- IfcSystem-navn har TFM-prefiks
- Elementtilhørighet til IfcSystem

**Struktur:** Bygges visuelt med utgangspunkt i Statsbygg TFM-veiledning
(`++lokasjon=system-komponent`). Velg en preset eller bygg din egen.

**Personvern:** Filnavn, elementnavn og verdier forlater ikke appen. Kun aggregerte
tellinger logges anonymt.

App v{APP_VERSION}
            """)
        return

    file_key = f"ifc_{uploaded.name}_{uploaded.size}"
    if file_key not in st.session_state:
        with st.spinner("Laster IFC-fil..."):
            t0 = time.time()
            try:
                ifc, _ = load_ifc(uploaded)
            except Exception as e:
                st.error(f"Kunne ikke lese IFC-fil: {e}"); return
            schema = ifc.schema
            if not any(schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
                st.error(f"IFC schema {schema!r} støttes ikke. Tillatt: IFC2X3 og IFC4 (inkl. IFC4X1/2/3).")
                return
            st.session_state[file_key] = ifc
            st.session_state[file_key + "_load_t"] = time.time() - t0
            st.session_state[file_key + "_facts"] = model_facts(ifc, list_products(ifc))
            st.session_state[file_key + "_psets"] = build_pset_index(ifc)
            st.session_state[file_key + "_auto_floors"] = extract_storey_codes_from_ifc(ifc)
            st.session_state.setdefault(f"floor_codes_{file_key}",
                                        list(st.session_state[file_key + "_auto_floors"]))
            detected = detect_discipline_from_filename(uploaded.name)
            st.session_state.setdefault(f"discipline_{file_key}", detected or "Annet")
            reset_results()
    ifc = st.session_state[file_key]
    facts = st.session_state[file_key + "_facts"]
    psets_idx = st.session_state[file_key + "_psets"]

    size_mb = uploaded.size / 1_048_576
    st.markdown(f"""
    <div class="fact-row">
        <strong>{facts['schema']}</strong> · {size_mb:.1f} MB ·
        <strong>{facts['n_products']:,}</strong> produkter ·
        <strong>{len(facts['storey_names'])}</strong> etasjer ·
        <strong>{facts['n_systems']}</strong> IfcSystems
    </div>
    """, unsafe_allow_html=True)

    # ----- Step 2: TFM-struktur (regex-bygger) -----
    st.markdown('<div class="step-label">Steg 2 — TFM-struktur (bygg merkereglen)</div>',
                unsafe_allow_html=True)
    st.caption("Bygg TFM-koden ledd for ledd. Følger Statsbygg TFM-veiledning: "
               "valgfritt **++lokasjon** (avsluttes med `=`), **system** (NS3451 + etasje + nr.), "
               "valgfritt **-komponent** (IEC 81346-bokstav + nr.). "
               "Hopp over deler du ikke trenger.")

    # Presets
    pcol = st.columns(len(PRESETS))
    for i, (pname, pseq) in enumerate(PRESETS.items()):
        with pcol[i]:
            if st.button(pname, key=f"preset_{pname}_{file_key}",
                         use_container_width=True):
                st.session_state[f"builder_{file_key}"] = list(pseq)
                st.session_state.pop(f"editor_builder_{file_key}", None)
                st.session_state[f"start_prefix_{file_key}"] = "++" if "Statsbygg" in pname else ""
                reset_results(); st.rerun()

    start_prefix = st.text_input(
        "Start-prefiks (valgfritt, f.eks. `++` for Statsbygg-lokasjon)",
        st.session_state.get(f"start_prefix_{file_key}", ""),
        key=f"start_prefix_{file_key}",
        max_chars=4,
    )

    _, builder_rows = structure_builder(f"builder_{file_key}")
    template = builder_rows_to_structure(builder_rows, start_prefix)

    st.markdown(f'<div class="preview-chip">Eksempel: {template or "(tomt)"}</div>',
                unsafe_allow_html=True)

    if not builder_rows:
        st.warning("Strukturen er tom. Legg til minst ett ledd, eller velg en preset over.")
        return
    try:
        re.compile(template)
    except re.error as e:
        st.error(f"Strukturen er ugyldig regex: {e}"); return

    # ----- Step 3: Klassifikasjonssystemer -----
    st.markdown('<div class="step-label">Steg 3 — Klassifikasjonssystemer</div>',
                unsafe_allow_html=True)
    sk1, sk2 = st.columns(2)
    with sk1:
        bd_sys = st.selectbox(
            "Bygningsdelskode",
            list(BYGNINGSDEL_SYSTEMS.keys()),
            format_func=lambda k: BYGNINGSDEL_SYSTEMS[k]["label"],
            key=f"bd_sys_{file_key}",
            help="Validerer {bygningsdel}-leddet.",
        )
    with sk2:
        komp_sys = st.selectbox(
            "Komponentbokstaver",
            list(KOMPONENT_SYSTEMS.keys()),
            format_func=lambda k: KOMPONENT_SYSTEMS[k]["label"],
            key=f"komp_sys_{file_key}",
            help="Validerer {komponent}-leddet (første bokstav mot standardens funksjonsklasser).",
        )

    # ----- Step 4: TFM-kode-lokasjon -----
    st.markdown('<div class="step-label">Steg 4 — Hvor ligger TFM-koden?</div>',
                unsafe_allow_html=True)
    loc_options = ["(Skann alle felt)", "Element Name", "Element Tag"] + list(psets_idx.keys())
    loc_choice = st.selectbox(
        "Felt der TFM-koden ligger", loc_options, key=f"loc_choice_{file_key}",
        help="Pek på det feltet rådgiveren skal ha lagt TFM-koden i.",
    )
    tfm_location = ("all", None, None)
    if loc_choice == "Element Name":
        tfm_location = ("attr", None, "Name")
    elif loc_choice == "Element Tag":
        tfm_location = ("attr", None, "Tag")
    elif loc_choice in psets_idx:
        prop = st.selectbox(f"Property i {loc_choice}", psets_idx[loc_choice],
                            key=f"loc_prop_{file_key}_{loc_choice}")
        tfm_location = ("pset", loc_choice, prop)

    # ----- Step 5: Etasjekoder -----
    st.markdown('<div class="step-label">Steg 5 — Etasjekoder</div>', unsafe_allow_html=True)
    st.caption("Tillatte verdier for {etasje}-leddet. Auto-detektert fra denne modellens "
               "IfcBuildingStorey. Rediger fritt eller hent fra referansemodell.")

    fcb1, fcb2 = st.columns(2)
    with fcb1:
        if st.button("🔄 Hent fra denne modellen", use_container_width=True,
                     key=f"reseed_{file_key}"):
            st.session_state[f"floor_codes_{file_key}"] = list(
                st.session_state[file_key + "_auto_floors"])
            st.session_state.pop(f"editor_floor_codes_{file_key}", None)
            reset_results(); st.rerun()
    with fcb2:
        with st.popover("📁 Hent fra referansemodell", use_container_width=True):
            ref = st.file_uploader("Referanse-IFC", type=["ifc"], key=f"ref_uploader_{file_key}")
            if ref is not None:
                try:
                    ref_ifc, _ = load_ifc(ref)
                    if not any(ref_ifc.schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
                        st.warning(f"Schema {ref_ifc.schema} støttes ikke.")
                    else:
                        codes = extract_storey_codes_from_ifc(ref_ifc)
                        names = [s.Name for s in ref_ifc.by_type("IfcBuildingStorey") if s.Name]
                        st.dataframe(pd.DataFrame({"Etasjenavn": names,
                                                   "Tolket kode": codes + [""] * max(0, len(names)-len(codes))}),
                                     hide_index=True, height=180, use_container_width=True)
                        if st.button("Bruk disse kodene", use_container_width=True,
                                     key=f"use_ref_{file_key}"):
                            st.session_state[f"floor_codes_{file_key}"] = codes
                            st.session_state.pop(f"editor_floor_codes_{file_key}", None)
                            reset_results(); st.rerun()
                except Exception as e:
                    st.error(f"Kunne ikke lese referansemodell: {e}")

    floor_codes = floor_list_editor(f"floor_codes_{file_key}")
    if not floor_codes:
        st.caption("📋 Ingen etasjekoder oppgitt — etasje-sjekken hoppes over.")
    with st.expander(f"Vis råe IfcBuildingStorey-navn ({len(facts['storey_names'])} stk.)"):
        st.write([n for n in facts["storey_names"] if n])

    # ----- Step 6: Prosjekt + disiplin -----
    st.markdown('<div class="step-label">Steg 6 — Prosjekt og disiplin (for rapporten)</div>',
                unsafe_allow_html=True)
    project_name = st.text_input("Prosjektnavn", st.session_state.get("project_name", ""),
                                 placeholder="f.eks. Grønland 55", key="project_name")
    detected = detect_discipline_from_filename(uploaded.name)
    disc_key = f"discipline_{file_key}"
    if detected:
        cur = st.session_state.get(disc_key)
        st.markdown(
            f'<div class="detect-banner">🔍 Filnavnet antyder <b>{DISCIPLINES[detected]["label"]}</b>. '
            f'{"Klikk en annen om dette ikke stemmer." if cur == detected else "Stemmer dette? Klikk for å bekrefte."}</div>',
            unsafe_allow_html=True)

    st.caption("Disiplin styrer kun rapportens etikett + kryssfagsflagging.")
    keys = list(DISCIPLINES.keys())
    for row_start in range(0, len(keys), 3):
        cols = st.columns(3)
        for j, col in enumerate(cols):
            idx = row_start + j
            if idx >= len(keys): break
            k = keys[idx]
            is_sel = st.session_state.get(disc_key) == k
            with col:
                if st.button(DISCIPLINES[k]["label"], key=f"disc_btn_{k}",
                             use_container_width=True,
                             type="primary" if is_sel else "secondary"):
                    st.session_state[disc_key] = k
                    reset_results(); st.rerun()
    discipline_key = st.session_state[disc_key]

    # Build the rules object
    rules = TFMRules(
        project_name=project_name,
        discipline_key=discipline_key,
        bygningsdel_system=bd_sys,
        komponent_system=komp_sys,
        start_prefix=start_prefix,
        structure=template,
        builder_rows=builder_rows,
        floor_codes=floor_codes,
        tfm_location=tfm_location,
    )

    # ----- Step 7: Regelmal -----
    st.markdown('<div class="step-label">Steg 7 — Regelmal (valgfritt)</div>',
                unsafe_allow_html=True)
    st.caption("Lagre denne konfigurasjonen som JSON for senere gjenbruk eller deling. "
               "Last opp en eksisterende mal for å gjenopprette innstillingene.")
    rmc1, rmc2 = st.columns(2)
    with rmc1:
        tpl_json = json.dumps(rules.to_template_dict(), ensure_ascii=False, indent=2)
        st.download_button(
            "📥 Last ned regelmal (JSON)", data=tpl_json.encode("utf-8"),
            file_name=f"tfm-regelmal_{discipline_key}.json", mime="application/json",
            use_container_width=True,
        )
    with rmc2:
        with st.popover("📁 Last opp regelmal", use_container_width=True):
            tpl_up = st.file_uploader("Velg .json", type=["json"], key=f"tpl_up_{file_key}")
            if tpl_up is not None:
                try:
                    data = json.loads(tpl_up.read().decode("utf-8"))
                    st.session_state["project_name"] = data.get("project_name", "")
                    st.session_state[disc_key] = data.get("discipline_key", "Annet")
                    st.session_state[f"bd_sys_{file_key}"] = data.get("bygningsdel_system", "NS3451")
                    st.session_state[f"komp_sys_{file_key}"] = data.get("komponent_system", "IEC81346")
                    st.session_state[f"start_prefix_{file_key}"] = data.get("start_prefix", "")
                    st.session_state[f"builder_{file_key}"] = data.get(
                        "builder_rows", list(DEFAULT_BUILDER))
                    st.session_state.pop(f"editor_builder_{file_key}", None)
                    st.session_state[f"floor_codes_{file_key}"] = data.get("floor_codes", [])
                    st.session_state.pop(f"editor_floor_codes_{file_key}", None)
                    reset_results()
                    st.success("Regelmal lastet. Klikk for å oppdatere visningen.")
                    st.rerun()
                except Exception as e:
                    st.error(f"Kunne ikke lese regelmalen: {e}")

    # ----- Step 8: Run -----
    st.markdown('<div class="step-label">Steg 8 — Kjør kontroll</div>', unsafe_allow_html=True)
    rules_sig = repr(rules)
    results_key = f"results_{file_key}_{hash(rules_sig)}"

    if results_key not in st.session_state:
        if st.button("▶️ Kjør TFM-sjekk", type="primary", use_container_width=True):
            with st.spinner("Analyserer modellen..."):
                t0 = time.time()
                products = list_products(ifc)
                bd_codes = load_codes(BYGNINGSDEL_SYSTEMS.get(bd_sys, {}).get("file"))
                komp_codes = load_codes(KOMPONENT_SYSTEMS.get(komp_sys, {}).get("file"))
                results = run_checks(ifc, products, rules, bd_codes, komp_codes)
                duration = time.time() - t0 + st.session_state.get(file_key + "_load_t", 0)
                st.session_state[results_key] = {"results": results, "duration": duration}
                usage.log_upload(
                    session_id=st.session_state.session_id,
                    file_size_bytes=uploaded.size,
                    ifc_schema=facts["schema"],
                    product_count=facts["n_products"],
                    duration_sec=duration,
                    app_version=APP_VERSION,
                )
            st.rerun()
        return

    res = st.session_state[results_key]
    results, duration = res["results"], res["duration"]

    # ----- Dashboard -----
    st.markdown("---")
    st.markdown(f"#### Resultat — {project_name or '(uten navn)'} · {rules.discipline_label}")
    st.caption(f"Analysetid {duration:.1f}s · TFM-kode hentet fra "
               f"{'alle felt' if tfm_location[0] == 'all' else (tfm_location[2] if tfm_location[0] == 'attr' else f'{tfm_location[1]}.{tfm_location[2]}')}")

    c = results["checks"]
    r1c1, r1c2, r1c3 = st.columns(3)
    with r1c1:
        metric_card(c["has_code"]["label"], c["has_code"]["pct"],
                    f"{c['has_code']['n']:,} / {c['has_code']['total']:,}")
    with r1c2:
        if results["has_bd_check"] and c["bd_valid"]["total"]:
            metric_card(c["bd_valid"]["label"], c["bd_valid"]["pct"],
                        f"{c['bd_valid']['n']:,} / {c['bd_valid']['total']:,}")
        else:
            info_card("Bygningsdel", "—",
                      "Hoppes over" if not results["has_bd_check"] else "Ingen koder")
    with r1c3:
        if results["has_disc_check"] and c["in_discipline"]["total"]:
            metric_card(c["in_discipline"]["label"], c["in_discipline"]["pct"],
                        f"{c['in_discipline']['n']:,} / {c['in_discipline']['total']:,}")
        else:
            info_card("Disiplinområde", "—", "Hoppes over")

    r2c1, r2c2, r2c3 = st.columns(3)
    with r2c1:
        if results["has_floor_check"] and c["floor_valid"]["total"]:
            metric_card(c["floor_valid"]["label"], c["floor_valid"]["pct"],
                        f"{c['floor_valid']['n']:,} / {c['floor_valid']['total']:,}")
        else:
            info_card("Etasje", "—", "Ingen liste" if not results["has_floor_check"] else "—")
    with r2c2:
        if results["has_komp_check"] and c["komp_valid"]["total"]:
            metric_card(c["komp_valid"]["label"], c["komp_valid"]["pct"],
                        f"{c['komp_valid']['n']:,} / {c['komp_valid']['total']:,}")
        else:
            info_card("Komponent", "—",
                      "Hoppes over" if not results["has_komp_check"] else "—")
    with r2c3:
        metric_card(c["system_prefix"]["label"], c["system_prefix"]["pct"],
                    f"{c['system_prefix']['n']} / {c['system_prefix']['total']}")

    r3c1, r3c2 = st.columns(2)
    with r3c1:
        metric_card(c["system_assign"]["label"], c["system_assign"]["pct"],
                    f"{c['system_assign']['n']:,} / {c['system_assign']['total']:,}")
    with r3c2:
        metric_card(c["tfm_system"]["label"], c["tfm_system"]["pct"],
                    f"{c['tfm_system']['n']:,} / {c['tfm_system']['total']:,}")

    chart_rows = [{"Sjekk": ch["label"], "Andel (%)": ch["pct"]}
                  for _, ch in applicable_checks(results)]
    if chart_rows:
        bar = alt.Chart(pd.DataFrame(chart_rows)).mark_bar(cornerRadius=4).encode(
            x=alt.X("Andel (%):Q", scale=alt.Scale(domain=[0, 100])),
            y=alt.Y("Sjekk:N", sort="-x"),
            color=alt.condition(
                "datum['Andel (%)'] >= 95", alt.value("#059669"),
                alt.condition("datum['Andel (%)'] >= 50",
                              alt.value("#d97706"), alt.value("#dc2626"))),
            tooltip=["Sjekk", alt.Tooltip("Andel (%):Q", format=".1f")],
        ).properties(height=max(180, 32 * len(chart_rows) + 40))
        st.altair_chart(bar, use_container_width=True)

    if results["cross_disc"]:
        with st.expander(f"⚠️ Kryssfagsmarkører — {sum(results['cross_disc'].values()):,} treff "
                          f"på koder utenfor {discipline_key}-området"):
            st.caption("Gyldige bygningsdelskoder fra andre disipliner. Verifiser om de hører hjemme.")
            ns_view = load_codes(BYGNINGSDEL_SYSTEMS.get(bd_sys, {}).get("file"))
            df = pd.DataFrame([{"Bygningsdel": k, "Antall": v,
                                 "Navn": ns_view.get(k, {}).get("name", "")}
                                for k, v in results["cross_disc"].items()])
            st.dataframe(df, hide_index=True, use_container_width=True, height=240)
    if results["invalid_bd"]:
        with st.expander(f"❌ Ugyldige bygningsdelskoder — {sum(results['invalid_bd'].values()):,} treff"):
            st.caption(f"Matcher ikke {bd_sys}-tabellen.")
            st.dataframe(pd.DataFrame(list(results["invalid_bd"].items()),
                                       columns=["Kode", "Antall"]),
                         hide_index=True, use_container_width=True, height=200)
    if results["invalid_komp"]:
        with st.expander(f"❌ Ugyldige komponentbokstaver — {sum(results['invalid_komp'].values()):,} treff"):
            st.caption(f"Første bokstav matcher ikke {komp_sys}-listen.")
            st.dataframe(pd.DataFrame(list(results["invalid_komp"].items()),
                                       columns=["Bokstav", "Antall"]),
                         hide_index=True, use_container_width=True, height=200)

    st.markdown("##### Detaljer")
    b1, b2 = st.columns(2)
    with b1:
        if st.button(f"👁️ Uten kode  ·  {len(results['missing_samples'])}",
                     use_container_width=True, disabled=not results["missing_samples"]):
            show_table_dialog("Elementer uten TFM-kode (utvalg)", results["missing_samples"])
        if st.button(f"👁️ IfcSystems  ·  {len(results['sys_rows'])}",
                     use_container_width=True, disabled=not results["sys_rows"]):
            show_table_dialog("IfcSystems i modellen", results["sys_rows"])
    with b2:
        if st.button(f"👁️ Ugyldig kode  ·  {len(results['invalid_samples'])}",
                     use_container_width=True, disabled=not results["invalid_samples"]):
            show_table_dialog("Elementer med ugyldig kode (utvalg)", results["invalid_samples"])
        if st.button(f"👁️ Uten systemtilhørighet  ·  {sum(results['unassigned_by_type'].values())}",
                     use_container_width=True, disabled=not results["unassigned_by_type"]):
            rows = [{"IfcType": k, "Antall": v} for k, v in results["unassigned_by_type"].items()]
            show_table_dialog("Elementtyper uten systemtilhørighet", rows)

    # Export
    st.markdown("---")
    st.markdown("##### Rapport")
    file_stem = Path(uploaded.name).stem
    if "_bundle" not in st.session_state or st.session_state.get("_bundle_key") != results_key:
        if st.button("📥 Generer rapport-pakke", type="primary", use_container_width=True):
            with st.spinner("Bygger Excel og PDF..."):
                xlsx = build_excel(rules, facts, results, uploaded.name, uploaded.size, duration)
                pdf  = build_pdf(rules, facts, results, uploaded.name, uploaded.size, duration)
                st.session_state["_xlsx"] = xlsx
                st.session_state["_pdf"] = pdf
                st.session_state["_bundle"] = build_bundle(xlsx, pdf, file_stem)
                st.session_state["_stem"] = file_stem
                st.session_state["_bundle_key"] = results_key
            st.rerun()
    else:
        st.download_button(
            "⬇️ Last ned ZIP (Excel + PDF)",
            st.session_state["_bundle"],
            file_name=f"{st.session_state['_stem']}_tfm-sjekk.zip",
            mime="application/zip", type="primary", use_container_width=True,
        )
        d1, d2 = st.columns(2)
        with d1:
            st.download_button(
                "📄 Bare Excel",
                st.session_state["_xlsx"],
                file_name=f"{st.session_state['_stem']}_tfm-sjekk.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )
        with d2:
            st.download_button(
                "📕 Bare PDF",
                st.session_state["_pdf"],
                file_name=f"{st.session_state['_stem']}_tfm-sjekk.pdf",
                mime="application/pdf",
                use_container_width=True,
            )


if __name__ == "__main__":
    main()
