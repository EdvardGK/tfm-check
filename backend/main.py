"""TFM-sjekk API + static SPA host.

Single deployable: serves the JSON API under /api and the built frontend (if
present) at /. Designed to run on Railway and be iframe-embedded under skiplum.no.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import usage
from engine import (
    ACCEPTED_SCHEMA_PREFIXES, APP_VERSION,
    TFMRules, run_checks, build_excel, build_pdf, build_bundle,
    open_ifc, list_products, model_facts, build_pset_index,
    detect_discipline_from_filename, extract_storey_codes_from_ifc,
    codes_for_bygningsdel, codes_for_komponent,
    list_presets, suggest_preset, suggest_field,
)
from engine.ifc_io import load_codes
from engine.inventory import ModelIndex, inventory_payload, preview
from engine.presets import PRESETS, preset_to_rules_dict
from store import UploadStore

HERE = Path(__file__).resolve().parent
FRONTEND_DIST = HERE.parent / "frontend" / "dist"

# Origins allowed to iframe-embed the tool.
FRAME_ANCESTORS = os.environ.get(
    "TFM_FRAME_ANCESTORS",
    "'self' https://skiplum.no https://*.skiplum.no https://*.vercel.app http://localhost:3000",
)

app = FastAPI(title="TFM-sjekk", version=APP_VERSION)
store = UploadStore(
    ttl_seconds=int(os.environ.get("TFM_STORE_TTL", "900")),
    max_items=int(os.environ.get("TFM_STORE_MAX", "3")),
)

# Public stateless API, no cookies — permissive CORS is fine and eases dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def embed_headers(request, call_next):
    resp = await call_next(request)
    # Allow embedding via CSP frame-ancestors (do NOT set X-Frame-Options: DENY).
    resp.headers["Content-Security-Policy"] = f"frame-ancestors {FRAME_ANCESTORS};"
    return resp


# =============================================================================
# Models
# =============================================================================

class CheckRequest(BaseModel):
    upload_id: str
    rules: dict
    session_id: str | None = None


class PreviewRequest(BaseModel):
    upload_id: str
    rules: dict


class ReportRequest(BaseModel):
    upload_id: str
    rules: dict
    fmt: str = "zip"  # zip | xlsx | pdf


# =============================================================================
# API
# =============================================================================

@app.get("/api/health")
def health():
    return {"ok": True, "version": APP_VERSION, "cached_models": len(store)}


@app.get("/api/presets")
def presets():
    return {"presets": list_presets()}


_CODE_FILES = {"ns3451": "ns3451_codes.json", "iec81346": "iec81346_letters.json"}


@app.get("/api/codes/{system}")
def codes(system: str):
    fname = _CODE_FILES.get(system.lower())
    if not fname:
        raise HTTPException(404, f"Ukjent kodesystem: {system!r}")
    return load_codes(fname)


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".ifc", ".ifczip"):
        raise HTTPException(400, "Filen må være en .ifc- eller .ifczip-fil.")

    t0 = time.time()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
        size = os.path.getsize(tmp_path)
        try:
            ifc = open_ifc(tmp_path)
        except Exception as e:
            raise HTTPException(400, f"Kunne ikke lese IFC-fil: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    schema = ifc.schema
    if not any(schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
        raise HTTPException(
            415, f"IFC-schema {schema!r} støttes ikke. Tillatt: IFC2X3 og IFC4 (inkl. IFC4X1/2/3).")

    products = list_products(ifc)
    facts = model_facts(ifc, products)
    psets = build_pset_index(ifc)
    storeys = extract_storey_codes_from_ifc(ifc)
    detected = detect_discipline_from_filename(file.filename)
    load_seconds = time.time() - t0

    up = store.put(
        ifc=ifc, products=products, facts=facts, psets=psets, storeys=storeys,
        detected_discipline=detected, file_name=file.filename, file_size=size,
        load_seconds=load_seconds,
    )

    return {
        "upload_id": up.upload_id,
        "file_name": file.filename,
        "file_size": size,
        "facts": facts,
        "psets": psets,
        "storeys": storeys,
        "detected_discipline": detected,
        "suggested_preset": suggest_preset(detected),
        "suggested_field": suggest_field(psets),
        "load_seconds": round(load_seconds, 2),
    }


def _resolve(upload_id: str):
    up = store.get(upload_id)
    if up is None:
        raise HTTPException(
            404, "Modellen er ikke lenger i minnet (utløpt). Last opp filen på nytt.")
    return up


def _index(up) -> ModelIndex:
    with up.index_lock:
        if up.index is None:
            up.index = ModelIndex(up.ifc, up.products)
        return up.index


@app.get("/api/inventory/{upload_id}")
def inventory(upload_id: str):
    """The loaded model's property sets, properties (elements carrying a
    value, distinct values, samples), attributes, candidates and storeys."""
    up = _resolve(upload_id)
    preset_rules = [TFMRules.from_dict(preset_to_rules_dict(p)) for p in PRESETS]
    return inventory_payload(_index(up), preset_rules)


@app.post("/api/preview")
def preview_rules(req: PreviewRequest):
    """A rule set's result on the loaded model's values, without the full
    check: matched, off values, floor codes seen, components and types."""
    up = _resolve(req.upload_id)
    return preview(_index(up), TFMRules.from_dict(req.rules))


@app.post("/api/check")
def check(req: CheckRequest):
    up = _resolve(req.upload_id)
    rules = TFMRules.from_dict(req.rules)
    bd_codes = codes_for_bygningsdel(rules.bygningsdel_system)
    komp_codes = codes_for_komponent(rules.komponent_system)

    t0 = time.time()
    results = run_checks(up.ifc, up.products, rules, bd_codes, komp_codes)
    duration = time.time() - t0 + up.load_seconds

    usage.log_upload(
        session_id=req.session_id or usage.new_session_id(),
        file_size_bytes=up.file_size,
        ifc_schema=up.facts["schema"],
        product_count=up.facts["n_products"],
        duration_sec=duration,
        app_version=APP_VERSION,
    )

    loc = rules.tfm_location
    loc_str = ("Alle felt" if loc[0] == "all"
               else loc[2] if loc[0] == "attr"
               else f"{loc[1]}.{loc[2]}")
    return {"results": results, "duration": round(duration, 2), "location_label": loc_str}


@app.post("/api/report")
def report(req: ReportRequest):
    up = _resolve(req.upload_id)
    rules = TFMRules.from_dict(req.rules)
    bd_codes = codes_for_bygningsdel(rules.bygningsdel_system)
    komp_codes = codes_for_komponent(rules.komponent_system)

    t0 = time.time()
    results = run_checks(up.ifc, up.products, rules, bd_codes, komp_codes)
    duration = time.time() - t0 + up.load_seconds

    stem = Path(up.file_name).stem
    xlsx = build_excel(rules, up.facts, results, up.file_name, up.file_size, duration)

    if req.fmt == "xlsx":
        return Response(
            xlsx,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stem}_tfm-sjekk.xlsx"'},
        )

    pdf = build_pdf(rules, up.facts, results, up.file_name, up.file_size, duration)
    if req.fmt == "pdf":
        return Response(
            pdf, media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{stem}_tfm-sjekk.pdf"'},
        )

    bundle = build_bundle(xlsx, pdf, stem)
    return Response(
        bundle, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{stem}_tfm-sjekk.zip"'},
    )


# =============================================================================
# Static SPA (mounted last so /api wins). Only if a build exists.
# =============================================================================

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="spa")
