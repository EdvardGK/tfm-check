"""
TFM-sjekk — Streamlit-utgave.

Interim self-service-app for Streamlit Community Cloud mens Railway-hostingen av
React/FastAPI-utgaven settes opp. Bruker NØYAKTIG samme valideringsmotor som
backend (../backend/engine) — ingen duplisert logikk. Preset-først, så vi unngår
den smertefulle chip-byggeren.

Kjør lokalt:  streamlit run streamlit/app.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pandas as pd
import streamlit as st

# Reuse the shared engine + telemetry from the FastAPI backend.
BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from engine import (  # noqa: E402
    APP_VERSION, TFMRules, run_checks, applicable_checks,
    build_excel, build_pdf, build_bundle,
    open_ifc, list_products, model_facts, build_pset_index,
    detect_discipline_from_filename, extract_storey_codes_from_ifc,
    codes_for_bygningsdel, codes_for_komponent,
    list_presets, suggest_preset, suggest_field,
)
from engine.constants import (  # noqa: E402
    ACCEPTED_SCHEMA_PREFIXES, DISCIPLINES, DIGIT_LOCKABLE_PARTS,
    PART_TYPES, SEP_OPTIONS_DISPLAY, SEP_TO_CHAR, SEP_NORWEGIAN_NAMES, sequence_to_example,
)

SEP_KEYS = SEP_OPTIONS_DISPLAY
from engine.checks import status_for_pct  # noqa: E402
import usage  # noqa: E402

# =============================================================================
# Token <-> display helpers (for the advanced sequence editor)
# =============================================================================


def sep_display(s: str) -> str:
    if s == "mellomrom":
        return "␣ (mellomrom)"
    return f"{SEP_TO_CHAR[s]}  ({SEP_NORWEGIAN_NAMES.get(s, s)})"


SEP_DISPLAY = {s: sep_display(s) for s in SEP_KEYS}
DISPLAY_TO_SEP = {v: k for k, v in SEP_DISPLAY.items()}
EDITOR_OPTIONS = list(PART_TYPES) + list(SEP_DISPLAY.values())

PART_FOR_DIGITKEY = {
    "etasje": "Etasje", "subnr": "Subnr", "lopenummer": "Løpenummer",
    "kompnr": "Komp.nr", "rom": "Rom",
}


def token_to_display(t: str) -> str:
    if t in PART_TYPES:
        return t
    if t in SEP_TO_CHAR:
        return SEP_DISPLAY.get(t, t)
    return t


def display_to_token(d: str) -> str:
    if d in PART_TYPES:
        return d
    if d in DISPLAY_TO_SEP:
        return DISPLAY_TO_SEP[d]
    return d


@st.cache_data(show_spinner=False)
def load_presets():
    return list_presets()


# =============================================================================
# Page
# =============================================================================

st.set_page_config(page_title="TFM-sjekk", page_icon="🔎", layout="centered")

st.markdown(
    """
    <style>
      .stApp { background: #f4ede0; }
      .tfm-head { background: #4b4f55; color: #f4ede0; padding: 1.1rem 1.4rem;
                  border-radius: 14px; margin-bottom: 1rem; }
      .tfm-head h1 { margin: 0; font-size: 1.35rem; }
      .tfm-head p  { margin: .2rem 0 0; color: #cdbfa6; font-size: .9rem; }
      .card { background: #fbf7ef; border: 1px solid #ddd2bf; border-radius: 12px;
              padding: .9rem 1rem; }
      .metric { background:#fbf7ef; border:1px solid #ddd2bf; border-radius:12px;
                padding:.7rem .9rem; }
      .metric .lbl { font-size:.7rem; text-transform:uppercase; letter-spacing:.04em;
                     color:#5e564b; }
      .metric .val { font-size:1.5rem; font-weight:700; line-height:1.1; }
      .metric .sub { font-size:.72rem; color:#7a7163; }
      .ex { font-family: 'Geist Mono', monospace; background:#2d2a26; color:#f3e6cd;
            padding:.5rem .8rem; border-radius:8px; display:inline-block; }
    </style>
    <div class="tfm-head">
      <h1>🔎 TFM-sjekk</h1>
      <p>Mottakskontroll på TFM-merking i IFC-fagmodeller</p>
    </div>
    """,
    unsafe_allow_html=True,
)

presets = load_presets()
pmap = {p["id"]: p for p in presets}

# =============================================================================
# Step 1 — upload
# =============================================================================

uploaded = st.file_uploader("Last opp IFC-fil", type=["ifc"], label_visibility="collapsed")
if not uploaded:
    st.info("Last opp en IFC-fil for å starte. Støtter IFC2X3 og IFC4 (inkl. IFC4X1/2/3).")
    st.caption(f"TFM-sjekk v{APP_VERSION} · samme motor som web-utgaven · "
               "ingen elementdata forlater verktøyet.")
    st.stop()

file_key = f"{uploaded.name}:{uploaded.size}"
if st.session_state.get("file_key") != file_key:
    with st.spinner("Leser modellen…"):
        t0 = time.time()
        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
            tmp.write(uploaded.getvalue())
            tmp_path = tmp.name
        try:
            ifc = open_ifc(tmp_path)
        except Exception as e:  # noqa: BLE001
            st.error(f"Kunne ikke lese IFC-fil: {e}")
            st.stop()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        if not any(ifc.schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
            st.error(f"IFC-schema {ifc.schema!r} støttes ikke. Tillatt: IFC2X3 og IFC4.")
            st.stop()

        products = list_products(ifc)
        facts = model_facts(ifc, products)
        psets = build_pset_index(ifc)
        storeys = extract_storey_codes_from_ifc(ifc)
        detected = detect_discipline_from_filename(uploaded.name)
        suggested = suggest_preset(detected)
        field = suggest_field(psets)

    st.session_state.file_key = file_key
    st.session_state.parsed = dict(
        ifc=ifc, products=products, facts=facts, psets=psets,
        storeys=storeys, detected=detected, load_t=time.time() - t0,
    )
    # init editable config
    pr = pmap[suggested]
    st.session_state.seq = list(pr["rules"]["patterns"][0]["sequence"])
    st.session_state.bd_sys = pr["rules"]["bygningsdel_system"]
    st.session_state.komp_sys = pr["rules"]["komponent_system"]
    st.session_state.part_digits = dict(pr["rules"].get("part_digits", {}))
    st.session_state.applied_preset = suggested
    st.session_state.editor_nonce = 0
    st.session_state.disc = detected or "Annet"
    st.session_state.field_loc = list(field["location"])
    st.session_state.floors = list(storeys)
    st.session_state.pop("results", None)

P = st.session_state.parsed
facts = P["facts"]
psets = P["psets"]

st.markdown(
    f'<div class="card">📦 <b>{facts["schema"]}</b> · '
    f'{uploaded.size / 1_048_576:.1f} MB · '
    f'<b>{facts["n_products"]:,}</b> produkter · '
    f'<b>{len(facts["storey_names"])}</b> etasjer · '
    f'<b>{facts["n_systems"]}</b> IfcSystems</div>',
    unsafe_allow_html=True,
)

# =============================================================================
# Step 2 — preset + auto-config
# =============================================================================

st.subheader("Merkemønster")
ids = [p["id"] for p in presets]
choice = st.radio(
    "Ferdige mønstre",
    ids,
    index=ids.index(st.session_state.applied_preset)
    if st.session_state.applied_preset in ids else 0,
    format_func=lambda i: f'{pmap[i]["label"]}  ·  {pmap[i]["example"]}',
)
if choice != st.session_state.applied_preset:
    pr = pmap[choice]
    st.session_state.seq = list(pr["rules"]["patterns"][0]["sequence"])
    st.session_state.bd_sys = pr["rules"]["bygningsdel_system"]
    st.session_state.komp_sys = pr["rules"]["komponent_system"]
    st.session_state.part_digits = dict(pr["rules"].get("part_digits", {}))
    st.session_state.applied_preset = choice
    st.session_state.editor_nonce += 1
    st.session_state.pop("results", None)
    st.rerun()

st.markdown(
    f'<span class="ex">{sequence_to_example(st.session_state.seq) or "(tomt)"}</span>',
    unsafe_allow_html=True,
)

with st.expander("⚙️ Tilpass mønster (avansert)"):
    st.caption("Legg til/fjern blokker. Rader leses ovenfra og ned. "
               "(For full omrokering: bruk web-utgaven med dra-og-slipp.)")
    df = pd.DataFrame({"Blokk": [token_to_display(t) for t in st.session_state.seq]})
    edited = st.data_editor(
        df, num_rows="dynamic", hide_index=True, use_container_width=True,
        column_config={
            "Blokk": st.column_config.SelectboxColumn(
                "Blokk", options=EDITOR_OPTIONS, required=True),
        },
        key=f"seq_editor_{st.session_state.editor_nonce}",
    )
    new_seq = [display_to_token(x) for x in edited["Blokk"].tolist()
               if isinstance(x, str) and x]
    if new_seq != st.session_state.seq:
        st.session_state.seq = new_seq
        st.session_state.applied_preset = "(tilpasset)"

    c1, c2 = st.columns(2)
    with c1:
        if "Systemkode" in st.session_state.seq:
            opts = ["NS3451", "Ingen"]
            st.session_state.bd_sys = st.selectbox(
                "Systemkode-validering", opts,
                index=opts.index(st.session_state.bd_sys)
                if st.session_state.bd_sys in opts else 0)
    with c2:
        if "Komponent" in st.session_state.seq:
            opts = ["IEC81346", "Ingen"]
            st.session_state.komp_sys = st.selectbox(
                "Komponent-validering", opts,
                index=opts.index(st.session_state.komp_sys)
                if st.session_state.komp_sys in opts else 0)

    active_digit_keys = [k for k in DIGIT_LOCKABLE_PARTS
                         if PART_FOR_DIGITKEY[k] in st.session_state.seq]
    if active_digit_keys:
        st.caption("Lås antall sifre (nyttig for sammensatte tall som 360.103).")
        dcols = st.columns(len(active_digit_keys))
        for col, k in zip(dcols, active_digit_keys):
            with col:
                cur = st.session_state.part_digits.get(k)
                sel = st.selectbox(
                    PART_FOR_DIGITKEY[k], ["Fri", "1", "2", "3", "4"],
                    index=["Fri", "1", "2", "3", "4"].index(str(cur)) if cur else 0,
                    key=f"digit_{k}")
                if sel == "Fri":
                    st.session_state.part_digits.pop(k, None)
                else:
                    st.session_state.part_digits[k] = int(sel)

st.subheader("Auto-oppdaget")
ac1, ac2 = st.columns(2)
with ac1:
    disc_keys = list(DISCIPLINES.keys())
    st.session_state.disc = st.selectbox(
        "Disiplin", disc_keys,
        index=disc_keys.index(st.session_state.disc)
        if st.session_state.disc in disc_keys else len(disc_keys) - 1,
        format_func=lambda k: DISCIPLINES[k]["label"])
with ac2:
    field_opts: list[tuple[str, tuple]] = [
        ("Alle felt (skann alt)", ("all", None, None)),
        ("Element Name", ("attr", None, "Name")),
        ("Element Tag", ("attr", None, "Tag")),
    ]
    for ps, props in psets.items():
        for prop in props:
            field_opts.append((f"{ps} → {prop}", ("pset", ps, prop)))
    cur = st.session_state.field_loc
    idx = next((i for i, o in enumerate(field_opts) if list(o[1]) == list(cur)), 0)
    sel = st.selectbox("Hvor ligger TFM-koden?", range(len(field_opts)), index=idx,
                       format_func=lambda i: field_opts[i][0])
    st.session_state.field_loc = list(field_opts[sel][1])

floors_text = st.text_input(
    "Tillatte etasjekoder (komma-separert)", ", ".join(st.session_state.floors),
    help="Auto-hentet fra modellens IfcBuildingStorey. Brukes kun om mønsteret har et Etasje-ledd.")
st.session_state.floors = [x.strip() for x in floors_text.split(",") if x.strip()]

project_name = st.text_input("Prosjektnavn (for rapporten)",
                             st.session_state.get("project_name", ""),
                             placeholder="f.eks. Grønland 55")
st.session_state.project_name = project_name

# Regelmal (JSON) — del/gjenbruk konfigurasjon
rules = TFMRules(
    project_name=project_name,
    discipline_key=st.session_state.disc,
    bygningsdel_system=st.session_state.bd_sys,
    komponent_system=st.session_state.komp_sys,
    patterns=[{"sequence": list(st.session_state.seq)}],
    floor_codes=list(st.session_state.floors),
    tfm_location=tuple(st.session_state.field_loc),
    part_digits={k: int(v) for k, v in st.session_state.part_digits.items() if v},
)

with st.expander("💾 Regelmal (JSON) — lagre eller gjenopprett"):
    jcol1, jcol2 = st.columns(2)
    with jcol1:
        st.download_button(
            "📥 Last ned regelmal",
            data=json.dumps(rules.to_template_dict(), ensure_ascii=False, indent=2).encode("utf-8"),
            file_name=f"tfm-regelmal_{st.session_state.disc}.json",
            mime="application/json", use_container_width=True)
    with jcol2:
        up = st.file_uploader("Last opp regelmal", type=["json"], key="tpl_up")
        if up is not None:
            try:
                data = json.loads(up.read().decode("utf-8"))
                loaded = TFMRules.from_dict(data)
                st.session_state.seq = list(loaded.patterns[0]["sequence"])
                st.session_state.bd_sys = loaded.bygningsdel_system
                st.session_state.komp_sys = loaded.komponent_system
                st.session_state.part_digits = dict(loaded.part_digits)
                st.session_state.disc = loaded.discipline_key
                st.session_state.field_loc = list(loaded.tfm_location)
                if loaded.floor_codes:
                    st.session_state.floors = list(loaded.floor_codes)
                st.session_state.applied_preset = "(tilpasset)"
                st.session_state.editor_nonce += 1
                st.session_state.pop("tpl_up", None)
                st.success("Regelmal lastet.")
                st.rerun()
            except Exception as e:  # noqa: BLE001
                st.error(f"Kunne ikke lese regelmalen: {e}")

# =============================================================================
# Step 3 — run
# =============================================================================

if not any(p["sequence"] for p in rules.patterns):
    st.warning("Mønsteret må ha minst én blokk.")
    st.stop()

if st.button("▶️  Kjør TFM-sjekk", type="primary", use_container_width=True):
    with st.spinner("Analyserer modellen…"):
        t0 = time.time()
        bd_codes = codes_for_bygningsdel(rules.bygningsdel_system)
        komp_codes = codes_for_komponent(rules.komponent_system)
        results = run_checks(P["ifc"], P["products"], rules, bd_codes, komp_codes)
        duration = time.time() - t0 + P.get("load_t", 0)
        st.session_state.results = results
        st.session_state.duration = duration
        usage.log_upload(
            session_id=st.session_state.setdefault("sid", usage.new_session_id()),
            file_size_bytes=uploaded.size, ifc_schema=facts["schema"],
            product_count=facts["n_products"], duration_sec=duration,
            app_version=APP_VERSION)

# =============================================================================
# Dashboard
# =============================================================================

if "results" in st.session_state:
    results = st.session_state.results
    duration = st.session_state.duration
    checks = results["checks"]

    st.divider()
    st.markdown(f"#### Resultat — {project_name or '(uten navn)'} · {rules.discipline_label}")
    st.caption(f"Analysetid {duration:.1f}s")

    # Headline
    hl = checks["has_code"]
    _, hl_color = status_for_pct(hl["pct"])
    st.markdown(
        f'<div class="metric" style="text-align:center;border-top:4px solid {hl_color}">'
        f'<div class="lbl">Elementer med TFM-kode</div>'
        f'<div class="val" style="color:{hl_color};font-size:2.6rem">{hl["pct"]:.1f}%</div>'
        f'<div class="sub">{hl["n"]:,} av {hl["total"]:,} produkter</div></div>',
        unsafe_allow_html=True)
    st.write("")

    # Flags
    flags = []
    if sum(results["cross_disc"].values()):
        flags.append(("Kryssfag", results["cross_disc"]))
    if sum(results["invalid_bd"].values()):
        flags.append(("Ugyldige systemkoder", results["invalid_bd"]))
    if sum(results["invalid_komp"].values()):
        flags.append(("Ugyldige komponentbokstaver", results["invalid_komp"]))
    if flags:
        fcols = st.columns(len(flags))
        for col, (lbl, data) in zip(fcols, flags):
            with col:
                with st.popover(f"⚠️ {sum(data.values())} {lbl}", use_container_width=True):
                    st.dataframe(pd.DataFrame(list(data.items()), columns=["Kode", "Antall"]),
                                 hide_index=True, use_container_width=True)

    # Metric grid
    applic = applicable_checks(results)
    rows = [applic[i:i + 3] for i in range(0, len(applic), 3)]
    for row in rows:
        cols = st.columns(3)
        for col, (_, c) in zip(cols, row):
            _, color = status_for_pct(c["pct"])
            with col:
                st.markdown(
                    f'<div class="metric" style="border-left:4px solid {color}">'
                    f'<div class="lbl">{c["label"]}</div>'
                    f'<div class="val" style="color:{color}">{c["pct"]:.1f}%</div>'
                    f'<div class="sub">{c["n"]:,} / {c["total"]:,}</div></div>',
                    unsafe_allow_html=True)

    # Bar chart
    st.write("")
    chart_df = pd.DataFrame(
        [{"Sjekk": c["label"], "Andel %": round(c["pct"], 1)} for _, c in applic]
    ).set_index("Sjekk")
    st.bar_chart(chart_df, horizontal=True, color="#c89544")

    # Detail tables
    with st.expander(f"👁️ Elementer uten kode ({len(results['missing_samples'])})"):
        st.dataframe(pd.DataFrame(results["missing_samples"]),
                     hide_index=True, use_container_width=True)
    with st.expander(f"👁️ Elementer med ugyldig kode ({len(results['invalid_samples'])})"):
        st.dataframe(pd.DataFrame(results["invalid_samples"]),
                     hide_index=True, use_container_width=True)
    with st.expander(f"👁️ IfcSystems ({len(results['sys_rows'])})"):
        st.dataframe(pd.DataFrame(results["sys_rows"]),
                     hide_index=True, use_container_width=True)
    if results["type_rows"]:
        with st.expander(f"📊 Coverage per IfcType ({len(results['type_rows'])})"):
            st.dataframe(pd.DataFrame(results["type_rows"]),
                         hide_index=True, use_container_width=True)

    # Reports
    st.divider()
    st.markdown("##### Last ned rapport")
    with st.spinner("Bygger rapport…"):
        xlsx = build_excel(rules, facts, results, uploaded.name, uploaded.size, duration)
        pdf = build_pdf(rules, facts, results, uploaded.name, uploaded.size, duration)
        bundle = build_bundle(xlsx, pdf, Path(uploaded.name).stem)
    stem = Path(uploaded.name).stem
    d1, d2, d3 = st.columns(3)
    with d1:
        st.download_button("📦 ZIP (Excel + PDF)", bundle, f"{stem}_tfm-sjekk.zip",
                           "application/zip", type="primary", use_container_width=True)
    with d2:
        st.download_button("📄 Bare Excel", xlsx, f"{stem}_tfm-sjekk.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           use_container_width=True)
    with d3:
        st.download_button("📕 Bare PDF", pdf, f"{stem}_tfm-sjekk.pdf",
                           "application/pdf", use_container_width=True)
