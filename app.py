"""
TFM-sjekk — IFC-mottakskontroll for TFM-merking.

Centric, progressive-disclosure UI inspired by mmi-color-marker.

Run: streamlit run app.py
"""

from __future__ import annotations

import io
import json
import re
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
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
# CONFIG
# =============================================================================

APP_VERSION = "0.3.0"
HERE = Path(__file__).parent

ACCEPTED_SCHEMA_PREFIXES = ("IFC2X3", "IFC4")
SPATIAL_TYPES = {"IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace"}

# Disciplines are LABELS for the report — they do not prime any allowlists.
# Each one has a default structure template + an expected NS3451-category range
# (used for cross-discipline flagging, not for validation).
DISCIPLINES = {
    "RIE":  dict(label="RIE — Elektro",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 ns_range=["4", "5"]),
    "RIV":  dict(label="RIV — VVS",
                 structure="{bygningsdel}.{etasje}.{lopenummer}",
                 ns_range=["3"]),
    "RIB":  dict(label="RIB — Bygg",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 ns_range=["2"]),
    "ARK":  dict(label="ARK — Arkitekt",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 ns_range=["2", "7"]),
    "RIBR": dict(label="RIBR — Brann",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 ns_range=["5"]),
    "Annet": dict(label="Annet / ukjent",
                  structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                  ns_range=[]),
}

FILENAME_DISCIPLINE_PATTERNS = [
    ("RIBR", re.compile(r"(?<![A-Za-z])RIBR(?![A-Za-z])|RIBfy|RIBR_", re.I)),
    ("RIE",  re.compile(r"(?<![A-Za-z])RIE(?![A-Za-z])",  re.I)),
    ("RIV",  re.compile(r"(?<![A-Za-z])RIV(?![A-Za-z])",  re.I)),
    ("RIB",  re.compile(r"(?<![A-Za-z])RIB(?![A-Za-z])",  re.I)),
    ("ARK",  re.compile(r"(?<![A-Za-z])I?ARK(?![A-Za-z])", re.I)),
]

# Classification systems for bygningsdel validation. Add new entries here as
# additional reference data is bundled with the app (e.g. ebkph, NS3451:2022).
CLASSIFICATION_SYSTEMS = {
    "NS3451": dict(label="NS3451 (norsk standard for bygningsdeler)",
                   file="ns3451_codes.json"),
    "Ingen":  dict(label="Ingen sjekk", file=None),
}

PLACEHOLDER_FALLBACK = {
    "bygningsdel": r"\d{3}",
    "etasje":      r"[A-Za-z0-9æøåÆØÅ_\- ]{1,12}",
    "komponent":   r"[A-Za-zÆØÅæøå]{1,4}",
    "lopenummer":  r"\d{1,4}(?:\.\d{1,4})?",
}
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")

THRESHOLDS = {"ok": 95, "warn": 50}


@st.cache_resource
def load_classification_codes(system_key: str) -> dict:
    cfg = CLASSIFICATION_SYSTEMS.get(system_key)
    if not cfg or not cfg.get("file"):
        return {}
    p = HERE / cfg["file"]
    if not p.exists():
        return {}
    with p.open(encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# DETECTION HELPERS
# =============================================================================


def detect_discipline_from_filename(name: str) -> str | None:
    for key, pat in FILENAME_DISCIPLINE_PATTERNS:
        if pat.search(name):
            return key
    return None


def parse_storey_name_to_code(name: str) -> str:
    """Heuristic: extract a short floor code from a storey name."""
    s = (name or "").strip()
    if not s:
        return ""
    # "Plan 01 - VVS" -> "01"; "Plan 1" -> "01"; "Kjeller" -> "Kjeller"
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


# =============================================================================
# IFC LOADING
# =============================================================================


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
    """Return {pset_name: sorted_prop_names} found on actual IfcProducts."""
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


# =============================================================================
# RULES + REGEX
# =============================================================================


@dataclass
class TFMRules:
    project_name: str = ""
    discipline_key: str = "Annet"
    structure: str = "{bygningsdel}.{etasje}-{komponent}{lopenummer}"
    floor_codes: list[str] = field(default_factory=list)
    komponent_codes: list[str] = field(default_factory=list)
    # Where to search for the TFM code. Examples:
    #   ("all", None, None)         — scan Name, Tag, and all psets
    #   ("attr", None, "Name")      — only IfcProduct.Name
    #   ("attr", None, "Tag")       — only IfcProduct.Tag
    #   ("pset", "PsetX", "PropY")  — only that pset/property
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


# =============================================================================
# ANALYSIS
# =============================================================================


def candidate_strings_for(elem, location: tuple):
    """Yield (field_label, value_str) pairs to test against TFM regex."""
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
    # "all" — scan everywhere
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


def run_checks(ifc, products, rules: TFMRules, ns3451_codes: dict) -> dict:
    rx = rules.regex()
    floor_set = set(rules.floor_codes)
    komp_set = set(rules.komponent_codes)
    has_komp_check = bool(komp_set)
    has_floor_check = bool(floor_set)
    expected_ns = set(rules.expected_ns_range)

    n_total = len(products)
    n_has_code = 0
    n_struct_ok = 0

    part_total = Counter()
    part_ok = Counter()
    n_ns3451_valid = 0
    n_ns3451_total = 0
    n_in_discipline = 0
    n_discipline_total = 0
    cross_disc_codes = Counter()       # bygningsdel codes outside expected range
    invalid_ns_codes = Counter()

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
        n_has_code += 1
        n_struct_ok += 1
        field_hits[fld] += 1
        g = m.groupdict()
        any_invalid = False

        # bygningsdel — validate against chosen classification system (if any)
        bd = g.get("bygningsdel")
        if bd is not None and ns3451_codes:
            part_total["bygningsdel"] += 1
            n_ns3451_total += 1
            if bd in ns3451_codes:
                part_ok["bygningsdel"] += 1
                n_ns3451_valid += 1
                if expected_ns:
                    n_discipline_total += 1
                    if bd[:1] in expected_ns:
                        n_in_discipline += 1
                    else:
                        cross_disc_codes[bd] += 1
            else:
                invalid_ns_codes[bd] += 1
                any_invalid = True

        # etasje — validate against floor_codes (if any)
        et = g.get("etasje")
        if et is not None and has_floor_check:
            part_total["etasje"] += 1
            if et in floor_set:
                part_ok["etasje"] += 1
            else:
                any_invalid = True

        # komponent — validate against komponent_codes (if any)
        ko = g.get("komponent")
        if ko is not None and has_komp_check:
            part_total["komponent"] += 1
            if ko in komp_set:
                part_ok["komponent"] += 1
            else:
                any_invalid = True

        # løpenummer — already format-checked by the regex itself; count as valid
        if "lopenummer" in g:
            part_total["lopenummer"] += 1
            part_ok["lopenummer"] += 1

        if len(code_samples) < 200:
            code_samples.append({
                "GUID": e.GlobalId, "Type": e.is_a(),
                "Felt": fld, "Kode": val[:80],
                **{k: g.get(k, "") for k in ("bygningsdel", "etasje", "komponent", "lopenummer")},
            })

        if any_invalid and len(invalid) < 500:
            invalid.append({
                "GUID": e.GlobalId, "Type": e.is_a(),
                "Navn": (e.Name or "")[:60], "Felt": fld, "Kode": val[:60],
                **{k: g.get(k, "") for k in ("bygningsdel", "etasje", "komponent", "lopenummer")},
            })

    # IfcSystem
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
                g = rel.RelatingGroup
                if g.is_a("IfcSystem"):
                    sf.append(g)
        if sf:
            n_assigned += 1
            if any(rx.search(s.Name or "") for s in sf):
                n_tfm_assigned += 1
        else:
            unassigned_types[e.is_a()] += 1

    def pct(a, b): return (a / b * 100) if b else 0.0

    checks = {
        "has_code":      dict(n=n_has_code,      total=n_total,
                              pct=pct(n_has_code, n_total),
                              label="Element har TFM-kode"),
        "ns3451_valid":  dict(n=n_ns3451_valid,  total=n_ns3451_total,
                              pct=pct(n_ns3451_valid, n_ns3451_total),
                              label="Bygningsdel i NS3451"),
        "in_discipline": dict(n=n_in_discipline, total=n_discipline_total,
                              pct=pct(n_in_discipline, n_discipline_total),
                              label=f"I forventet område for {rules.discipline_key}"),
        "floor_valid":   dict(n=part_ok["etasje"], total=part_total["etasje"],
                              pct=pct(part_ok["etasje"], part_total["etasje"]),
                              label="Etasjekode tillatt"),
        "komp_valid":    dict(n=part_ok["komponent"], total=part_total["komponent"],
                              pct=pct(part_ok["komponent"], part_total["komponent"]),
                              label="Komponentkode tillatt"),
        "system_prefix": dict(n=n_sys_ok, total=len(systems),
                              pct=pct(n_sys_ok, len(systems)),
                              label="IfcSystem-prefiks"),
        "system_assign": dict(n=n_assigned, total=n_total,
                              pct=pct(n_assigned, n_total),
                              label="Element tildelt IfcSystem"),
        "tfm_system":    dict(n=n_tfm_assigned, total=n_total,
                              pct=pct(n_tfm_assigned, n_total),
                              label="Tildelt TFM-navnet system"),
    }

    return {
        "n_total": n_total,
        "checks": checks,
        "has_floor_check": has_floor_check,
        "has_komp_check": has_komp_check,
        "has_disc_check": bool(expected_ns),
        "field_hits": dict(field_hits),
        "cross_disc_codes": dict(cross_disc_codes.most_common(40)),
        "invalid_ns_codes": dict(invalid_ns_codes.most_common(40)),
        "missing_samples": missing,
        "invalid_samples": invalid,
        "code_samples": code_samples,
        "sys_rows": sys_rows,
        "unassigned_by_type": dict(unassigned_types.most_common(20)),
    }


# =============================================================================
# EXPORT
# =============================================================================


def status_for_pct(pct: float):
    if pct >= THRESHOLDS["ok"]:   return ("OK", "#059669")
    if pct >= THRESHOLDS["warn"]: return ("Advarsel", "#d97706")
    return ("Avvik", "#dc2626")


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
            ["TFM-kode hentes fra", loc_str],
            ["Tillatte etasjekoder", ", ".join(rules.floor_codes) or "(ingen — sjekk hoppes over)"],
            ["Tillatte komponentkoder", ", ".join(rules.komponent_codes) or "(ingen — sjekk hoppes over)"],
            ["Kjøretid", f"{duration:.1f} s"],
            ["Generert", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
            ["App", f"TFM-sjekk v{APP_VERSION}"],
        ]
        pd.DataFrame(summary, columns=["Felt", "Verdi"]).to_excel(xw, sheet_name="Sammendrag", index=False)

        rows = []
        for k, c in results["checks"].items():
            applicable = True
            if k == "floor_valid":  applicable = results["has_floor_check"]
            if k == "komp_valid":   applicable = results["has_komp_check"]
            if k == "in_discipline": applicable = results["has_disc_check"]
            if not applicable:
                continue
            rows.append([c["label"], c["n"], c["total"], f"{c['pct']:.1f}%"])
        pd.DataFrame(rows, columns=["Sjekk", "OK", "Totalt", "Andel"]).to_excel(
            xw, sheet_name="Sjekker", index=False)

        if results["cross_disc_codes"]:
            pd.DataFrame(
                list(results["cross_disc_codes"].items()),
                columns=["Bygningsdel utenfor disiplin", "Antall"],
            ).to_excel(xw, sheet_name="Kryssfag", index=False)

        if results["invalid_ns_codes"]:
            pd.DataFrame(
                list(results["invalid_ns_codes"].items()),
                columns=["Ikke-NS3451-kode", "Antall"],
            ).to_excel(xw, sheet_name="Ugyldig_NS3451", index=False)

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
                         columns=["IfcType", "Antall"]).to_excel(xw, sheet_name="Uten_systemtilhørighet", index=False)
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
    loc_str = ("Alle felt (Name, Tag, alle Psets)" if loc[0] == "all"
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
    i = 1
    for k, c in results["checks"].items():
        applicable = True
        if k == "floor_valid":   applicable = results["has_floor_check"]
        if k == "komp_valid":    applicable = results["has_komp_check"]
        if k == "in_discipline": applicable = results["has_disc_check"]
        if not applicable:
            continue
        status, color = status_for_pct(c["pct"])
        data.append([c["label"], f"{c['pct']:.1f}%",
                     f"{c['n']:,}/{c['total']:,}".replace(",", " "), status])
        cmds.append(("BACKGROUND", (3, i), (3, i), colors.HexColor(color)))
        cmds.append(("TEXTCOLOR",  (3, i), (3, i), colors.white))
        cmds.append(("FONTNAME",   (3, i), (3, i), "Helvetica-Bold"))
        i += 1
    t = Table(data, colWidths=[80*mm, 25*mm, 35*mm, 25*mm])
    t.setStyle(TableStyle(cmds))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    if results["cross_disc_codes"]:
        story.append(Paragraph("Kryssfagsmarkører (bygningsdelskoder utenfor disiplinens forventede område)", h2))
        d = [["Bygningsdel", "Antall"]]
        for k, v in list(results["cross_disc_codes"].items())[:20]:
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
            "<i>Kryssfagsmarkører er ikke nødvendigvis feil — men de fortjener verifisering: "
            "skal koder fra andre faggrupper egentlig være i denne modellen?</i>", small))
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
        st.info("Ingen rader.")
        return
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
    <div class="summary-card" style="border-left-color: #64748b;">
        <h4>{label}</h4>
        <div class="value" style="color: #334155; font-size: 1.3rem;">{value}</div>
        <div class="sub">{sub}</div>
    </div>
    """, unsafe_allow_html=True)


def list_editor(label: str, key: str, seed: list[str] | None = None,
                placeholder: str = "Skriv inn kode") -> list[str]:
    """Editable list — single column. Add/edit/delete via st.data_editor."""
    if key not in st.session_state:
        st.session_state[key] = list(seed or [])
    df = pd.DataFrame({label: st.session_state[key] or [""]})
    edited = st.data_editor(
        df, num_rows="dynamic", use_container_width=True, hide_index=True,
        key=f"editor_{key}",
        column_config={label: st.column_config.TextColumn(label, width="medium",
                                                          help=placeholder)},
    )
    vals = [str(v).strip() for v in edited[label].tolist() if str(v).strip() and str(v).strip().lower() != "nan"]
    # de-dupe preserving order
    seen, out = set(), []
    for v in vals:
        if v not in seen:
            seen.add(v); out.append(v)
    st.session_state[key] = out
    return out


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
- Bygningsdelskoden er en gyldig NS3451-kode
- Bygningsdelskoden er i forventet område for disiplinen (kryssfagsflagg)
- Etasjekoden er i tillatt liste
- Komponentkoden er i tillatt liste
- IfcSystem-navn har TFM-prefiks
- Elementtilhørighet til IfcSystem

**Personvern:** Filnavn, elementnavn og verdier forlater ikke appen. Kun aggregerte
tellinger logges anonymt (tidsstempel, filstørrelse, schema, produkter, kjøretid).

App v{APP_VERSION}
            """)
        return

    file_key = f"ifc_{uploaded.name}_{uploaded.size}"
    if file_key not in st.session_state:
        with st.spinner("Laster IFC-fil..."):
            t0 = time.time()
            try:
                ifc, tmp_path = load_ifc(uploaded)
            except Exception as e:
                st.error(f"Kunne ikke lese IFC-fil: {e}")
                return
            schema = ifc.schema
            if not any(schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
                st.error(f"IFC schema {schema!r} støttes ikke. Tillatt: IFC2X3 og IFC4 (inkl. IFC4X1/2/3).")
                return
            st.session_state[file_key] = ifc
            st.session_state[file_key + "_load_t"] = time.time() - t0
            st.session_state[file_key + "_facts"] = model_facts(ifc, list_products(ifc))
            st.session_state[file_key + "_psets"] = build_pset_index(ifc)
            st.session_state[file_key + "_auto_floors"] = extract_storey_codes_from_ifc(ifc)
            # Seed floor list with auto-detected once per file
            st.session_state.setdefault(f"floor_codes_{file_key}",
                                        list(st.session_state[file_key + "_auto_floors"]))
            # Set discipline default from filename
            detected = detect_discipline_from_filename(uploaded.name)
            st.session_state.setdefault(f"discipline_{file_key}", detected or "Annet")
            reset_results()
    ifc = st.session_state[file_key]
    facts = st.session_state[file_key + "_facts"]
    psets_idx = st.session_state[file_key + "_psets"]

    # Fact row
    size_mb = uploaded.size / 1_048_576
    st.markdown(f"""
    <div class="fact-row">
        <strong>{facts['schema']}</strong> · {size_mb:.1f} MB ·
        <strong>{facts['n_products']:,}</strong> produkter ·
        <strong>{len(facts['storey_names'])}</strong> etasjer ·
        <strong>{facts['n_systems']}</strong> IfcSystems
    </div>
    """, unsafe_allow_html=True)

    # ----- Step 2: Prosjekt + disiplin -----
    st.markdown('<div class="step-label">Steg 2 — Prosjekt og disiplin</div>', unsafe_allow_html=True)

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

    st.caption("Velg disiplin (bare for rapporten — påvirker ikke regler, men brukes til kryssfagsflagg):")
    keys = list(DISCIPLINES.keys())
    for row_start in range(0, len(keys), 3):
        cols = st.columns(3)
        for j, col in enumerate(cols):
            idx = row_start + j
            if idx >= len(keys):
                break
            k = keys[idx]
            is_sel = st.session_state.get(disc_key) == k
            with col:
                if st.button(DISCIPLINES[k]["label"], key=f"disc_btn_{k}",
                             use_container_width=True,
                             type="primary" if is_sel else "secondary"):
                    st.session_state[disc_key] = k
                    reset_results()
                    st.rerun()

    discipline_key = st.session_state[disc_key]

    # Classification system for bygningsdel validation (compact selector — no code list shown)
    sys_keys = list(CLASSIFICATION_SYSTEMS.keys())
    classification_key = st.selectbox(
        "Klassifikasjonssystem for bygningsdelskode",
        sys_keys, index=0,
        format_func=lambda k: CLASSIFICATION_SYSTEMS[k]["label"],
        key=f"classification_{file_key}",
        help="Bygningsdelskoden valideres mot dette systemet. Velg «Ingen sjekk» for å hoppe over.",
    )

    # ----- Step 3: Hvor ligger TFM-koden? -----
    st.markdown('<div class="step-label">Steg 3 — Hvor ligger TFM-koden?</div>', unsafe_allow_html=True)
    loc_options = ["(Skann alle felt)", "Element Name", "Element Tag"] + list(psets_idx.keys())
    loc_choice = st.selectbox(
        "Velg felt", loc_options, key=f"loc_choice_{file_key}",
        help="Pek på det feltet rådgiveren skal ha lagt TFM-koden i. Standard «Skann alle felt» går "
             "gjennom Name, Tag og alle Psets — bra for å oppdage hvor merking faktisk ligger.",
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

    # ----- Step 4: Etasjekoder -----
    st.markdown('<div class="step-label">Steg 4 — Etasjekoder</div>', unsafe_allow_html=True)
    st.caption("Hvilke etasjebetegnelser regnes som gyldige? Standard er auto-detektert fra denne "
               "modellens IfcBuildingStorey-navn. Du kan redigere listen, eller hente etasjer fra en "
               "annen referansemodell.")

    fcb1, fcb2 = st.columns(2)
    with fcb1:
        if st.button("🔄 Hent fra denne modellen", use_container_width=True):
            st.session_state[f"floor_codes_{file_key}"] = list(st.session_state[file_key + "_auto_floors"])
            reset_results()
            st.rerun()
    with fcb2:
        with st.popover("📁 Hent fra referansemodell", use_container_width=True):
            ref = st.file_uploader("Last opp referanse-IFC", type=["ifc"],
                                   key=f"ref_uploader_{file_key}")
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
                            reset_results()
                            st.rerun()
                except Exception as e:
                    st.error(f"Kunne ikke lese referansemodell: {e}")

    floor_codes = list_editor("Etasjekode", key=f"floor_codes_{file_key}",
                              placeholder="f.eks. 01, 02, U1")
    if not floor_codes:
        st.caption("📋 Ingen etasjekoder oppgitt — etasje-sjekken hoppes over.")

    with st.expander(f"Vis råe IfcBuildingStorey-navn ({len(facts['storey_names'])} stk.)"):
        st.write([n for n in facts["storey_names"] if n])

    # ----- Step 5: Komponentkoder (optional) -----
    st.markdown('<div class="step-label">Steg 5 — Komponentkoder (valgfritt)</div>', unsafe_allow_html=True)
    st.caption("Liste over tillatte komponentkode-forkortelser (f.eks. KW, OS, UE, XS for RIE). "
               "Tom liste = sjekken hoppes over.")
    komp_codes = list_editor("Komponentkode", key=f"komp_codes_{file_key}",
                             placeholder="f.eks. KW, OS, UE")

    # ----- Step 6: Struktur (advanced) -----
    with st.expander("⚙️ Avansert — TFM-strukturmønster"):
        default_struct = DISCIPLINES[discipline_key]["structure"]
        structure = st.text_input(
            "Struktur (template)",
            st.session_state.get(f"structure_{file_key}", default_struct),
            key=f"structure_{file_key}",
            help="Placeholdere: {bygningsdel}, {etasje}, {komponent}, {lopenummer}",
        )
        st.caption("Endring her invaliderer eksisterende resultater.")
    structure = st.session_state.get(f"structure_{file_key}", DISCIPLINES[discipline_key]["structure"])

    rules = TFMRules(
        project_name=project_name,
        discipline_key=discipline_key,
        structure=structure,
        floor_codes=floor_codes,
        komponent_codes=komp_codes,
        tfm_location=tfm_location,
    )

    try:
        rx = rules.regex()
    except re.error as e:
        st.error(f"Ugyldig regex: {e}")
        return

    # ----- Step 7: Run -----
    st.markdown('<div class="step-label">Steg 7 — Kjør kontroll</div>', unsafe_allow_html=True)
    rules_sig = repr(rules)
    results_key = f"results_{file_key}_{hash(rules_sig)}"

    if results_key not in st.session_state:
        if st.button("▶️ Kjør TFM-sjekk", type="primary", use_container_width=True):
            with st.spinner("Analyserer modellen..."):
                t0 = time.time()
                products = list_products(ifc)
                ns_codes = load_classification_codes(classification_key)
                results = run_checks(ifc, products, rules, ns_codes)
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
        if c["ns3451_valid"]["total"]:
            metric_card(c["ns3451_valid"]["label"], c["ns3451_valid"]["pct"],
                        f"{c['ns3451_valid']['n']:,} / {c['ns3451_valid']['total']:,}")
        else:
            info_card("NS3451", "—", "Ingen koder funnet")
    with r1c3:
        if results["has_disc_check"] and c["in_discipline"]["total"]:
            metric_card(c["in_discipline"]["label"], c["in_discipline"]["pct"],
                        f"{c['in_discipline']['n']:,} / {c['in_discipline']['total']:,}")
        else:
            info_card("Disiplinområde", "—", "Hoppes over for «Annet»")

    r2c1, r2c2, r2c3 = st.columns(3)
    with r2c1:
        if results["has_floor_check"] and c["floor_valid"]["total"]:
            metric_card(c["floor_valid"]["label"], c["floor_valid"]["pct"],
                        f"{c['floor_valid']['n']:,} / {c['floor_valid']['total']:,}")
        else:
            info_card("Etasje", "—", "Ingen liste — hoppet over")
    with r2c2:
        if results["has_komp_check"] and c["komp_valid"]["total"]:
            metric_card(c["komp_valid"]["label"], c["komp_valid"]["pct"],
                        f"{c['komp_valid']['n']:,} / {c['komp_valid']['total']:,}")
        else:
            info_card("Komponent", "—", "Ingen liste — hoppet over")
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

    # Bar chart of all applicable checks
    chart_rows = []
    for k, ch in c.items():
        applicable = True
        if k == "floor_valid":   applicable = results["has_floor_check"] and ch["total"] > 0
        if k == "komp_valid":    applicable = results["has_komp_check"]  and ch["total"] > 0
        if k == "in_discipline": applicable = results["has_disc_check"]  and ch["total"] > 0
        if not applicable or ch["total"] == 0:
            continue
        chart_rows.append({"Sjekk": ch["label"], "Andel (%)": ch["pct"]})
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

    # Cross-discipline + invalid NS callouts
    if results["cross_disc_codes"]:
        with st.expander(f"⚠️ Kryssfagsmarkører — {sum(results['cross_disc_codes'].values()):,} treff "
                          f"på koder utenfor {discipline_key}-området"):
            st.caption("Disse er gyldige NS3451-koder, men tilhører andre disipliner. "
                       "Verifiser om de skal være i denne modellen.")
            ns_codes_view = load_classification_codes(classification_key)
            df = pd.DataFrame(
                [{"Bygningsdel": k, "Antall": v,
                  "Navn": ns_codes_view.get(k, {}).get("name", "")}
                 for k, v in results["cross_disc_codes"].items()]
            )
            st.dataframe(df, hide_index=True, use_container_width=True, height=240)
    if results["invalid_ns_codes"]:
        with st.expander(f"❌ Ikke-NS3451 bygningsdelskoder — {sum(results['invalid_ns_codes'].values()):,} treff"):
            st.caption("Disse 3-sifrede tallene matcher ikke en gyldig NS3451-kode.")
            st.dataframe(pd.DataFrame(list(results["invalid_ns_codes"].items()),
                                       columns=["Kode", "Antall"]),
                         hide_index=True, use_container_width=True, height=200)

    # Drill-downs
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
