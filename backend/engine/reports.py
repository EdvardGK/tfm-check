"""Excel + PDF report builders. PDF chrome uses the Skiplum palette
(gunmetal surface, graphite text, amber accent); status colors stay semantic."""

from __future__ import annotations

import io
import zipfile
from datetime import datetime

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak)

from .constants import APP_VERSION
from .checks import applicable_checks, status_for_pct

# Skiplum brand
GUNMETAL = colors.HexColor("#4b4f55")
GRAPHITE = colors.HexColor("#2d2a26")
AMBER = colors.HexColor("#c89544")
CREAM_LINE = colors.HexColor("#ddd2bf")
CREAM_FILL = colors.HexColor("#f3e6cd")


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
            ["TFM-mønstre", " | ".join(results.get("structures") or [])],
            ["Systemkode-system", results["bd_sys_label"]],
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

        if results.get("type_rows"):
            pd.DataFrame(results["type_rows"]).to_excel(xw, sheet_name="Type_dekning", index=False)
        if results.get("seen_systems"):
            pd.DataFrame(list(results["seen_systems"].items()),
                         columns=["Systemkode", "Antall"]).to_excel(
                xw, sheet_name="TFM-koder_funnet", index=False)
        if results.get("seen_systemkode"):
            pd.DataFrame(list(results["seen_systemkode"].items()),
                         columns=["Systemkode", "Antall"]).to_excel(
                xw, sheet_name="Systemkoder_funnet", index=False)
        if results.get("seen_components"):
            pd.DataFrame(list(results["seen_components"].items()),
                         columns=["Komponentkode", "Antall"]).to_excel(
                xw, sheet_name="Komponentkoder_funnet", index=False)
        if results.get("seen_floors"):
            pd.DataFrame(list(results["seen_floors"].items()),
                         columns=["Etasjekode", "Antall"]).to_excel(
                xw, sheet_name="Etasjekoder_funnet", index=False)
        if results.get("floor_mismatch"):
            pd.DataFrame(list(results["floor_mismatch"].items()),
                         columns=["Kode-etasje ≠ Storey", "Antall"]).to_excel(
                xw, sheet_name="Etasje_avvik", index=False)
        if results.get("pattern_hits"):
            pd.DataFrame(list(results["pattern_hits"].items()),
                         columns=["Mønster", "Antall treff"]).to_excel(
                xw, sheet_name="Mønstertreff", index=False)
        if results["cross_disc"]:
            pd.DataFrame(list(results["cross_disc"].items()),
                         columns=["Systemkode utenfor disiplin", "Antall"]).to_excel(
                xw, sheet_name="Kryssfag", index=False)
        if results["invalid_bd"]:
            pd.DataFrame(list(results["invalid_bd"].items()),
                         columns=[f"Ikke-{rules.bygningsdel_system} kode", "Antall"]).to_excel(
                xw, sheet_name="Ugyldig_systemkode", index=False)
        if results["invalid_komp"]:
            pd.DataFrame(list(results["invalid_komp"].items()),
                         columns=[f"Ikke-{rules.komponent_system} bokstav", "Antall"]).to_excel(
                xw, sheet_name="Ugyldig_komponent", index=False)
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
                         columns=["IfcType", "Antall"]).to_excel(
                xw, sheet_name="Uten_systemtilhørighet", index=False)
    return out.getvalue()


def build_pdf(rules, facts, results, file_name, file_size, duration) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
                            topMargin=18*mm, bottomMargin=18*mm,
                            title=f"TFM-sjekk — {rules.project_name}")
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=GRAPHITE, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=GUNMETAL)
    body = styles["BodyText"]
    small = ParagraphStyle("small", parent=body, fontSize=8.5, textColor=colors.HexColor("#5e564b"))

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
        ["TFM-mønstre", " | ".join(results.get("structures") or [])],
        ["Systemkode-system", results["bd_sys_label"]],
        ["Komponent-system", results["komp_sys_label"]],
        ["TFM-kode hentes fra", loc_str],
        ["Generert", datetime.now().strftime("%Y-%m-%d %H:%M")],
        ["Kjøretid", f"{duration:.1f} s"],
    ]
    t = Table(facts_tbl, colWidths=[55*mm, 110*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), CREAM_FILL),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, CREAM_LINE),
    ]))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    story.append(Paragraph("Resultater", h2))
    data = [["Sjekk", "Andel", "Antall", "Status"]]
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), GUNMETAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, CREAM_LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i, (_, c) in enumerate(applicable_checks(results), start=1):
        status, color = status_for_pct(c["pct"])
        data.append([c["label"], f"{c['pct']:.1f}%",
                     f"{c['n']:,}/{c['total']:,}".replace(",", " "), status])
        cmds.append(("BACKGROUND", (3, i), (3, i), colors.HexColor(color)))
        cmds.append(("TEXTCOLOR", (3, i), (3, i), colors.white))
        cmds.append(("FONTNAME", (3, i), (3, i), "Helvetica-Bold"))
    t = Table(data, colWidths=[80*mm, 25*mm, 35*mm, 25*mm])
    t.setStyle(TableStyle(cmds))
    story.append(t)
    story.append(Spacer(1, 6*mm))

    if results["cross_disc"]:
        story.append(Paragraph("Kryssfagsmarkører (utenfor disiplinens forventede område)", h2))
        d = [["Systemkode", "Antall"]]
        for k, v in list(results["cross_disc"].items())[:20]:
            d.append([k, str(v)])
        t = Table(d, colWidths=[40*mm, 25*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), GUNMETAL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, CREAM_LINE),
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
            ("BACKGROUND", (0, 0), (-1, 0), GUNMETAL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("LINEBELOW", (0, 0), (-1, -1), 0.2, CREAM_LINE),
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
