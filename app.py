"""
TFM-sjekk — IFC-mottakskontroll for TFM-merking.

Centric, progressive-disclosure UI inspired by mmi-color-marker.

Run: streamlit run app.py
"""

from __future__ import annotations

import io
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

APP_VERSION = "0.2.0"

ACCEPTED_SCHEMA_PREFIXES = ("IFC2X3", "IFC4")
SPATIAL_TYPES = {"IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace"}

DISCIPLINES = {
    "RIE":  dict(label="RIE — Elektro",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 bygningsdel=["433", "515", "521", "542", "543", "564"],
                 etasje=["001", "101", "201", "301", "401", "501", "601", "701"],
                 komponent=["KW", "OS", "UE", "UD", "KX", "RY", "RK", "RB", "XS", "OU"]),
    "RIV":  dict(label="RIV — VVS",
                 structure="{bygningsdel}.{etasje}.{lopenummer}",
                 bygningsdel=["310", "320", "332", "350", "360", "370"],
                 etasje=["001", "002", "003", "004", "011", "021"],
                 komponent=[]),
    "RIB":  dict(label="RIB — Bygg",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 bygningsdel=["211", "221", "231", "241", "251", "261"],
                 etasje=["001", "101", "201", "301"],
                 komponent=[]),
    "ARK":  dict(label="ARK — Arkitekt",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 bygningsdel=["232", "234", "242", "244"],
                 etasje=["001", "101", "201"],
                 komponent=[]),
    "RIBR": dict(label="RIBR — Brann",
                 structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                 bygningsdel=["542", "551"], etasje=[], komponent=[]),
    "Annet": dict(label="Annet",
                  structure="{bygningsdel}.{etasje}-{komponent}{lopenummer}",
                  bygningsdel=[], etasje=[], komponent=[]),
}

PLACEHOLDER_FALLBACK = {
    "bygningsdel": r"\d{3}",
    "etasje":      r"\d{2,4}",
    "komponent":   r"[A-Za-zÆØÅæøå]{1,4}",
    "lopenummer":  r"\d{1,4}(?:\.\d{1,4})?",
}
PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")

THRESHOLDS = {"ok": 95, "warn": 50}


# =============================================================================
# RULES + REGEX
# =============================================================================


@dataclass
class TFMRules:
    project_name: str = ""
    discipline: str = ""
    structure: str = "{bygningsdel}.{etasje}-{komponent}{lopenummer}"
    allowlists: dict = field(default_factory=lambda: {
        "bygningsdel": [], "etasje": [], "komponent": [], "lopenummer": [],
    })

    def _piece_pattern(self, name: str) -> str:
        vals = self.allowlists.get(name) or []
        if vals:
            return "(?:" + "|".join(re.escape(v) for v in vals) + ")"
        return PLACEHOLDER_FALLBACK.get(name, r"\S+")

    def _build(self, strict: bool) -> re.Pattern:
        parts, i = [], 0
        for m in PLACEHOLDER_RE.finditer(self.structure):
            parts.append(re.escape(self.structure[i:m.start()]))
            name = m.group(1)
            pat = self._piece_pattern(name) if strict else PLACEHOLDER_FALLBACK.get(name, r"\S+")
            parts.append(f"(?P<{name}>{pat})")
            i = m.end()
        parts.append(re.escape(self.structure[i:]))
        return re.compile("^" + "".join(parts))

    def strict_regex(self) -> re.Pattern: return self._build(True)
    def loose_regex(self) -> re.Pattern:  return self._build(False)


def parse_csv_list(s: str) -> list[str]:
    return [t.strip() for t in (s or "").replace(";", ",").split(",") if t.strip()]


# =============================================================================
# IFC ANALYSIS
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
        "storeys": [s.Name or "" for s in ifc.by_type("IfcBuildingStorey")],
        "n_systems": len(systems),
        "n_products": len(products),
        "top_types": Counter(e.is_a() for e in products).most_common(10),
        "originating_system": (ifc.header.file_name.originating_system or "").strip(),
    }


def candidate_strings(elem):
    out = []
    if elem.Name:
        out.append(("Name", elem.Name))
    tag = getattr(elem, "Tag", None)
    if tag:
        out.append(("Tag", str(tag)))
    for pn, pdict in eu.get_psets(elem).items():
        for k, v in pdict.items():
            if k == "id":
                continue
            if isinstance(v, str) and v.strip():
                out.append((f"{pn}.{k}", v))
    return out


def run_checks(ifc, products, rules: TFMRules) -> dict:
    rx_strict = rules.strict_regex()
    rx_loose  = rules.loose_regex()

    n_total = len(products)
    n_has_any = n_struct = n_strict_ok = 0
    per_part_ok = Counter()
    per_part_total = Counter()
    field_hits = Counter()
    missing, invalid = [], []

    for e in products:
        chosen = None
        for fld, val in candidate_strings(e):
            ms = rx_strict.search(val)
            if ms:
                chosen = (fld, val, "strict", ms); break
            ml = rx_loose.search(val)
            if ml and chosen is None:
                chosen = (fld, val, "loose", ml)
        if chosen is None:
            if len(missing) < 500:
                missing.append({"GUID": e.GlobalId, "Type": e.is_a(),
                                "Navn": (e.Name or "")[:80],
                                "Tag": str(getattr(e, "Tag", "") or "")[:40]})
            continue

        fld, val, mode, m = chosen
        n_has_any += 1
        field_hits[fld] += 1
        n_struct += 1
        if mode == "strict":
            n_strict_ok += 1
            for name in rules.allowlists.keys():
                per_part_total[name] += 1
                per_part_ok[name] += 1
        else:
            for name in rules.allowlists.keys():
                if name not in m.groupdict():
                    continue
                per_part_total[name] += 1
                allow = rules.allowlists.get(name) or []
                if not allow or m.group(name) in allow:
                    per_part_ok[name] += 1
            if len(invalid) < 500:
                invalid.append({
                    "GUID": e.GlobalId, "Type": e.is_a(),
                    "Navn": (e.Name or "")[:60],
                    "Felt": fld, "Funnet": val[:60],
                    **{k: m.groupdict().get(k, "") for k in rules.allowlists.keys()},
                })

    try:
        systems = ifc.by_type("IfcSystem")
    except RuntimeError:
        systems = []
    sys_rows, n_sys_ok = [], 0
    for s in systems:
        ok = bool(rx_loose.search(s.Name or ""))
        if ok: n_sys_ok += 1
        sys_rows.append({"Navn": s.Name or "", "TFM-prefiks": "Ja" if ok else "Nei"})

    n_assigned = n_tfm_assigned = 0
    unassigned_types = Counter()
    for e in products:
        sys_for = []
        for rel in getattr(e, "HasAssignments", []) or []:
            if rel.is_a("IfcRelAssignsToGroup"):
                g = rel.RelatingGroup
                if g.is_a("IfcSystem"):
                    sys_for.append(g)
        if sys_for:
            n_assigned += 1
            if any(rx_loose.search(s.Name or "") for s in sys_for):
                n_tfm_assigned += 1
        else:
            unassigned_types[e.is_a()] += 1

    def pct(a, b): return (a / b * 100) if b else 0.0

    return {
        "n_total": n_total,
        "checks": {
            "has_any_code":  dict(n=n_has_any,      total=n_total,        pct=pct(n_has_any, n_total)),
            "structure_ok":  dict(n=n_struct,       total=n_total,        pct=pct(n_struct, n_total)),
            "fully_valid":   dict(n=n_strict_ok,    total=n_total,        pct=pct(n_strict_ok, n_total)),
            "system_prefix": dict(n=n_sys_ok,       total=len(systems),   pct=pct(n_sys_ok, len(systems))),
            "system_assign": dict(n=n_assigned,     total=n_total,        pct=pct(n_assigned, n_total)),
            "tfm_system":    dict(n=n_tfm_assigned, total=n_total,        pct=pct(n_tfm_assigned, n_total)),
        },
        "per_part": {
            name: dict(n=per_part_ok[name], total=per_part_total[name],
                       pct=pct(per_part_ok[name], per_part_total[name]))
            for name in rules.allowlists.keys()
        },
        "field_hits": dict(field_hits),
        "missing_samples": missing,
        "invalid_samples": invalid,
        "sys_rows": sys_rows,
        "unassigned_by_type": dict(unassigned_types.most_common(20)),
    }


def extract_storey_codes(ifc) -> list[str]:
    code_re = re.compile(r"\b(\d{2,4})\b")
    seen, out = set(), []
    for st_ in ifc.by_type("IfcBuildingStorey"):
        nm = st_.Name or ""
        m = code_re.search(nm)
        v = m.group(1) if m else nm
        if v and v not in seen:
            seen.add(v); out.append(v)
    return out


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
        summary = [
            ["Prosjekt", rules.project_name],
            ["Disiplin", rules.discipline],
            ["Modellfil", file_name],
            ["Filstørrelse", f"{file_size/1_048_576:.1f} MB"],
            ["IFC schema", facts["schema"]],
            ["Eksportør", facts["originating_system"]],
            ["Produkter", facts["n_products"]],
            ["Etasjer", len(facts["storeys"])],
            ["IfcSystems", facts["n_systems"]],
            ["TFM-struktur", rules.structure],
            ["Kjøretid", f"{duration:.1f} s"],
            ["Generert", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
            ["App", f"TFM-sjekk v{APP_VERSION}"],
        ]
        for k, v in rules.allowlists.items():
            summary.append([f"Tillatt {k}", ", ".join(v) if v else "(uten begrensning)"])
        pd.DataFrame(summary, columns=["Felt", "Verdi"]).to_excel(xw, sheet_name="Sammendrag", index=False)

        labels = {
            "has_any_code": "Element har TFM-kode",
            "structure_ok": "Kode følger struktur",
            "fully_valid":  "Kode fullt gyldig",
            "system_prefix": "IfcSystem-navn TFM-prefiks",
            "system_assign": "Element tildelt IfcSystem",
            "tfm_system":   "Tildelt TFM-navnet system",
        }
        pd.DataFrame(
            [[lbl, results["checks"][k]["n"], results["checks"][k]["total"], f"{results['checks'][k]['pct']:.1f}%"]
             for k, lbl in labels.items()],
            columns=["Sjekk", "OK", "Totalt", "Andel"],
        ).to_excel(xw, sheet_name="Sjekker", index=False)

        if any(v["total"] for v in results["per_part"].values()):
            pd.DataFrame(
                [[k, v["n"], v["total"], f"{v['pct']:.1f}%"] for k, v in results["per_part"].items()],
                columns=["Kodedel", "Gyldig", "Av funnet", "Andel"],
            ).to_excel(xw, sheet_name="Delkontroll", index=False)

        if results["field_hits"]:
            pd.DataFrame(sorted(results["field_hits"].items(), key=lambda kv: -kv[1]),
                         columns=["Felt", "Antall"]).to_excel(xw, sheet_name="Hvor_koden_ligger", index=False)
        pd.DataFrame(results["sys_rows"]).to_excel(xw, sheet_name="IfcSystems", index=False)
        if results["missing_samples"]:
            pd.DataFrame(results["missing_samples"]).to_excel(xw, sheet_name="Uten_kode_utvalg", index=False)
        if results["invalid_samples"]:
            pd.DataFrame(results["invalid_samples"]).to_excel(xw, sheet_name="Ugyldig_kode_utvalg", index=False)
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
        f"<b>{rules.project_name or '(prosjekt ikke navngitt)'}</b> &nbsp;·&nbsp; "
        f"{rules.discipline or '(disiplin ikke valgt)'}", body))
    story.append(Spacer(1, 4*mm))

    facts_tbl = [
        ["Modellfil", file_name],
        ["Filstørrelse", f"{file_size/1_048_576:.1f} MB"],
        ["IFC schema", facts["schema"]],
        ["Eksportør", facts["originating_system"] or "—"],
        ["Antall produkter", f"{facts['n_products']:,}".replace(",", " ")],
        ["Antall etasjer", str(len(facts["storeys"]))],
        ["Antall IfcSystems", str(facts["n_systems"])],
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

    story.append(Paragraph("TFM-regler", h2))
    rtbl = [["Struktur", rules.structure]] + [
        [f"Tillatt {k}", ", ".join(v) if v else "(uten begrensning)"]
        for k, v in rules.allowlists.items()
    ]
    t = Table(rtbl, colWidths=[40*mm, 125*mm])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    story.append(Paragraph("Resultater", h2))
    labels = {
        "has_any_code": "Element har TFM-kode",
        "structure_ok": "Kode følger struktur",
        "fully_valid":  "Kode fullt gyldig (alle deler tillatt)",
        "system_prefix": "IfcSystem med TFM-prefiks",
        "system_assign": "Element tildelt IfcSystem",
        "tfm_system":    "Tildelt TFM-navnet system",
    }
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
    for i, (k, lbl) in enumerate(labels.items(), start=1):
        c = results["checks"][k]
        status, color = status_for_pct(c["pct"])
        data.append([lbl, f"{c['pct']:.1f}%",
                     f"{c['n']:,}/{c['total']:,}".replace(",", " "), status])
        cmds.append(("BACKGROUND", (3, i), (3, i), colors.HexColor(color)))
        cmds.append(("TEXTCOLOR", (3, i), (3, i), colors.white))
        cmds.append(("FONTNAME", (3, i), (3, i), "Helvetica-Bold"))
    t = Table(data, colWidths=[80*mm, 25*mm, 35*mm, 25*mm])
    t.setStyle(TableStyle(cmds))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    if any(v["total"] for v in results["per_part"].values()):
        story.append(Paragraph("Delkontroll", h2))
        d = [["Kodedel", "Gyldig", "Av funnet", "Andel"]]
        for k, v in results["per_part"].items():
            d.append([k, f"{v['n']:,}".replace(",", " "),
                      f"{v['total']:,}".replace(",", " "),
                      f"{v['pct']:.1f}%" if v["total"] else "—"])
        t = Table(d, colWidths=[40*mm, 30*mm, 40*mm, 30*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3d5a4e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(t)
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
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
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
def show_table_dialog(title: str, rows: list[dict]):
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


def reset_results():
    for k in list(st.session_state.keys()):
        if k.startswith("results_") or k in ("_xlsx", "_pdf", "_bundle"):
            del st.session_state[k]


# =============================================================================
# APP
# =============================================================================


def main():
    st.set_page_config(page_title="TFM-sjekk", page_icon="🔍", layout="centered",
                       initial_sidebar_state="collapsed")

    if "session_id" not in st.session_state:
        st.session_state.session_id = usage.new_session_id()
    st.session_state.setdefault("step", 1)  # 1=upload, 2=config, 3=run, 4=results
    st.session_state.setdefault("discipline_key", None)

    st.markdown("""
    <style>
        .stApp { background: linear-gradient(135deg, #f5f5f0 0%, #e8e4dc 100%); }
        .block-container { padding-top: 3rem; padding-bottom: 4rem; max-width: 860px; }
        header[data-testid="stHeader"] { background: transparent; }
        [data-testid="stSidebar"] { display: none; }

        .app-header {
            background: linear-gradient(135deg, #2d4a3e 0%, #3d5a4e 100%);
            color: white; padding: 1.5rem 2rem; border-radius: 12px;
            margin-bottom: 1.5rem;
            display: flex; align-items: center; justify-content: space-between;
        }
        .app-header h1 { color: white; margin: 0; font-size: 1.5rem; font-weight: 600; }
        .app-header p { color: #b8c9bf; margin: 0.25rem 0 0 0; font-size: 0.9rem; }
        .app-header .stats-link a {
            color: #b8c9bf; text-decoration: none; font-size: 0.85rem;
            background: rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 999px;
        }

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

        /* Big primary action buttons */
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

        .rule-preview {
            background: #1e293b; color: #cbd5e1; font-family: monospace;
            padding: 8px 12px; border-radius: 6px; font-size: 0.8rem;
            margin-top: 4px; overflow-x: auto;
        }

        #MainMenu { visibility: hidden; }
        footer { visibility: hidden; }
        .stDeployButton { display: none; }
    </style>
    """, unsafe_allow_html=True)

    # Header with stats button
    hdr_left, hdr_right = st.columns([5, 1])
    with hdr_left:
        st.markdown("""
        <div class="app-header">
            <div>
                <h1>🔍 TFM-sjekk</h1>
                <p>Mottakskontroll på TFM-merking i IFC-fagmodeller</p>
            </div>
        </div>
        """, unsafe_allow_html=True)
    with hdr_right:
        st.write("")
        if st.button("📊 Stats", use_container_width=True):
            show_stats_dialog()

    # =========================================================================
    # STEP 1 — Upload IFC
    # =========================================================================
    st.markdown('<div class="step-label">Steg 1 — Last opp modell</div>', unsafe_allow_html=True)
    uploaded = st.file_uploader("Last opp IFC-fil", type=["ifc"],
                                label_visibility="collapsed",
                                key="target_uploader")

    if not uploaded:
        st.info("Last opp en IFC-fil for å starte. Støttede schemaer: IFC2X3, IFC4, IFC4X1/2/3.")
        with st.expander("ℹ️ Om verktøyet"):
            st.markdown(f"""
**Hva sjekkes:**
- **Element-TFM** — andel elementer der Name, Tag eller et Pset-felt inneholder en TFM-kode
- **Strukturmatch** — koden følger oppgitt struktur (placeholders)
- **Fullt gyldig** — alle kodedeler er i de oppgitte tillatte listene
- **IfcSystem-prefiks** — andel `IfcSystem` med navn som starter på TFM-kode
- **Systemtilhørighet** — andel elementer tildelt et `IfcSystem`

**Personvern:** Filnavn, elementnavn og verdier forlater ikke appen. Kun aggregerte
tellinger logges anonymt (tidsstempel, filstørrelse, schema, produkter, kjøretid).

App v{APP_VERSION}
            """)
        return

    # Parse + validate schema
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
            reset_results()
    ifc = st.session_state[file_key]
    facts = st.session_state[file_key + "_facts"]

    # Show model facts
    size_mb = uploaded.size / 1_048_576
    st.markdown(f"""
    <div class="fact-row">
        <strong>{facts['schema']}</strong> · {size_mb:.1f} MB ·
        <strong>{facts['n_products']:,}</strong> produkter ·
        <strong>{len(facts['storeys'])}</strong> etasjer ·
        <strong>{facts['n_systems']}</strong> IfcSystems
    </div>
    """, unsafe_allow_html=True)

    # =========================================================================
    # STEP 2 — Project + Discipline
    # =========================================================================
    st.markdown('<div class="step-label">Steg 2 — Prosjekt og disiplin</div>', unsafe_allow_html=True)

    project_name = st.text_input("Prosjektnavn",
                                 st.session_state.get("project_name", ""),
                                 placeholder="f.eks. Grønland 55",
                                 key="project_name_input")
    st.session_state.project_name = project_name

    st.caption("Velg disiplin (forhåndsutfyller TFM-regler):")
    keys = list(DISCIPLINES.keys())
    for row_start in range(0, len(keys), 3):
        cols = st.columns(3)
        for j, col in enumerate(cols):
            idx = row_start + j
            if idx >= len(keys):
                break
            k = keys[idx]
            preset = DISCIPLINES[k]
            is_sel = st.session_state.discipline_key == k
            with col:
                if st.button(preset["label"], key=f"disc_{k}",
                             use_container_width=True,
                             type="primary" if is_sel else "secondary"):
                    st.session_state.discipline_key = k
                    p = DISCIPLINES[k]
                    st.session_state.structure = p["structure"]
                    st.session_state.allow_bygningsdel = ", ".join(p["bygningsdel"])
                    st.session_state.allow_etasje = ", ".join(p["etasje"])
                    st.session_state.allow_komponent = ", ".join(p["komponent"])
                    st.session_state.allow_lopenummer = ""
                    reset_results()
                    st.rerun()

    if st.session_state.discipline_key is None:
        st.info("Velg disiplin for å fortsette.")
        return

    discipline_label = DISCIPLINES[st.session_state.discipline_key]["label"]

    # =========================================================================
    # STEP 3 — TFM-regler (revealed after discipline)
    # =========================================================================
    st.markdown('<div class="step-label">Steg 3 — TFM-regler</div>', unsafe_allow_html=True)

    rc1, rc2 = st.columns(2)
    with rc1:
        allow_bygningsdel = st.text_input(
            "Bygningsdelskoder",
            st.session_state.get("allow_bygningsdel", ""),
            key="allow_bygningsdel",
            help="Komma-separert. Tom = ingen begrensning.")
        allow_komponent = st.text_input(
            "Komponentkoder",
            st.session_state.get("allow_komponent", ""),
            key="allow_komponent")
    with rc2:
        allow_etasje = st.text_input(
            "Etasjekoder",
            st.session_state.get("allow_etasje", ""),
            key="allow_etasje",
            help="Komma-separert. Bruk knappen under for å hente fra referansemodell.")
        allow_lopenummer = st.text_input(
            "Løpenummer (sjelden)",
            st.session_state.get("allow_lopenummer", ""),
            key="allow_lopenummer")

    with st.expander("⚙️ Avansert — endre struktur eller hent etasjer fra referansemodell"):
        structure = st.text_input(
            "Struktur (template)",
            st.session_state.get("structure", "{bygningsdel}.{etasje}-{komponent}{lopenummer}"),
            key="structure",
            help="Placeholdere: {bygningsdel}, {etasje}, {komponent}, {lopenummer}")

        st.caption("📥 Hent etasjekoder fra referansemodell")
        ref = st.file_uploader("Referanse-IFC", type=["ifc"], key="ref_uploader",
                               label_visibility="collapsed")
        if ref is not None:
            try:
                ifc_ref, _ = load_ifc(ref)
                if not any(ifc_ref.schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
                    st.warning(f"Schema {ifc_ref.schema} støttes ikke.")
                else:
                    codes = extract_storey_codes(ifc_ref)
                    storey_names = [s.Name for s in ifc_ref.by_type("IfcBuildingStorey") if s.Name]
                    pad = [""] * max(0, len(storey_names) - len(codes))
                    st.dataframe(
                        pd.DataFrame({"Etasjenavn": storey_names,
                                      "Tolket kode": (codes + pad)[:len(storey_names)]}),
                        hide_index=True, height=200, use_container_width=True)
                    if st.button("Bruk disse som tillatte etasjekoder", use_container_width=True):
                        st.session_state.allow_etasje = ", ".join(codes)
                        st.rerun()
            except Exception as e:
                st.error(f"Kunne ikke lese referansemodell: {e}")
    structure = st.session_state.get("structure", "{bygningsdel}.{etasje}-{komponent}{lopenummer}")

    rules = TFMRules(
        project_name=project_name,
        discipline=discipline_label,
        structure=structure,
        allowlists={
            "bygningsdel": parse_csv_list(allow_bygningsdel),
            "etasje":      parse_csv_list(allow_etasje),
            "komponent":   parse_csv_list(allow_komponent),
            "lopenummer":  parse_csv_list(allow_lopenummer),
        },
    )

    try:
        rx = rules.strict_regex()
        st.markdown(f'<div class="rule-preview">{rx.pattern}</div>', unsafe_allow_html=True)
    except re.error as e:
        st.error(f"Ugyldig regex: {e}")
        return

    # =========================================================================
    # STEP 4 — Run
    # =========================================================================
    st.markdown('<div class="step-label">Steg 4 — Kjør kontroll</div>', unsafe_allow_html=True)

    rules_sig = repr(rules)
    results_key = f"results_{file_key}_{hash(rules_sig)}"

    if results_key not in st.session_state:
        if st.button("▶️ Kjør TFM-sjekk", type="primary", use_container_width=True):
            with st.spinner("Analyserer modellen..."):
                t0 = time.time()
                products = list_products(ifc)
                results = run_checks(ifc, products, rules)
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

    # =========================================================================
    # STEP 5 — Results dashboard
    # =========================================================================
    st.markdown("---")
    st.markdown(f"#### Resultat — {project_name or '(uten navn)'} · {discipline_label}")
    st.caption(f"Analysetid {duration:.1f}s")

    checks = results["checks"]
    c1, c2, c3 = st.columns(3)
    with c1:
        metric_card("Har TFM-kode", checks["has_any_code"]["pct"],
                    f"{checks['has_any_code']['n']:,} / {checks['has_any_code']['total']:,}")
    with c2:
        metric_card("Struktur OK", checks["structure_ok"]["pct"],
                    f"{checks['structure_ok']['n']:,} / {checks['structure_ok']['total']:,}")
    with c3:
        metric_card("Fullt gyldig", checks["fully_valid"]["pct"],
                    f"{checks['fully_valid']['n']:,} / {checks['fully_valid']['total']:,}")

    c4, c5, c6 = st.columns(3)
    with c4:
        metric_card("System-prefiks", checks["system_prefix"]["pct"],
                    f"{checks['system_prefix']['n']} / {checks['system_prefix']['total']}")
    with c5:
        metric_card("Systemtilhørighet", checks["system_assign"]["pct"],
                    f"{checks['system_assign']['n']:,} / {checks['system_assign']['total']:,}")
    with c6:
        metric_card("TFM-navnet system", checks["tfm_system"]["pct"],
                    f"{checks['tfm_system']['n']:,} / {checks['tfm_system']['total']:,}")

    # Bar chart
    labels_map = {
        "has_any_code":  "Har TFM-kode",
        "structure_ok":  "Struktur OK",
        "fully_valid":   "Fullt gyldig",
        "system_prefix": "System-prefiks",
        "system_assign": "Systemtilhørighet",
        "tfm_system":    "TFM-navnet system",
    }
    chart_df = pd.DataFrame([
        {"Sjekk": v, "Andel (%)": checks[k]["pct"]} for k, v in labels_map.items()
    ])
    bar = alt.Chart(chart_df).mark_bar(cornerRadius=4).encode(
        x=alt.X("Andel (%):Q", scale=alt.Scale(domain=[0, 100])),
        y=alt.Y("Sjekk:N", sort="-x"),
        color=alt.condition(
            "datum['Andel (%)'] >= 95", alt.value("#059669"),
            alt.condition("datum['Andel (%)'] >= 50",
                          alt.value("#d97706"), alt.value("#dc2626")),
        ),
        tooltip=["Sjekk", alt.Tooltip("Andel (%):Q", format=".1f")],
    ).properties(height=220)
    st.altair_chart(bar, use_container_width=True)

    if any(v["total"] for v in results["per_part"].values()):
        with st.expander("🔬 Delkontroll — gyldighet per kodedel"):
            st.dataframe(
                pd.DataFrame([
                    {"Del": k, "Andel gyldig": f"{v['pct']:.1f}%",
                     "Av koder funnet": v["total"], "Gyldig": v["n"]}
                    for k, v in results["per_part"].items()
                ]),
                hide_index=True, use_container_width=True,
            )

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
