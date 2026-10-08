"""TFM-sjekk API + static SPA host.

Single deployable: serves the JSON API under /api and the built frontend (if
present) at /. Runs as a Docker service on the Skiplum apps box and is iframe-embedded on skiplum.com.
"""

from __future__ import annotations

import gzip
import os
import shutil
import tempfile
import threading
import time
import uuid
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
from engine.inventory import ModelIndex, inventory_payload, preview, values_payload
from engine.codes import coded_objects, rollup
from engine.register import build_register_xlsx, register_rows
from engine.standards import STANDARDS, codelist
from engine.presets import PRESETS, preset_to_rules_dict
from store import UploadStore

HERE = Path(__file__).resolve().parent
FRONTEND_DIST = HERE.parent / "frontend" / "dist"

# Origins allowed to iframe-embed the tool.
FRAME_ANCESTORS = os.environ.get(
    "TFM_FRAME_ANCESTORS",
    "'self' https://skiplum.com https://*.skiplum.com https://skiplum.no https://*.skiplum.no "
    "https://*.vercel.app http://localhost:3000",
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


class ValuesRequest(BaseModel):
    upload_id: str
    location: list


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


@app.get("/api/codes/{system}")
def codes(system: str):
    """A linked standard's code list: {code: name}."""
    key = next((k for k in STANDARDS if k.lower() == system.lower()), None)
    cl = codelist(key)
    if cl is None:
        raise HTTPException(404, f"Ukjent kodesystem: {system!r}")
    return cl.codes


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


# =============================================================================
# Upload as a job: the client polls the reading and indexing progress.
# =============================================================================

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _job_set(job_id: str, **kw) -> None:
    with _jobs_lock:
        _jobs[job_id].update(kw)


def _read_job(job_id: str, tmp_path: str, file_name: str, size: int) -> None:
    t0 = time.time()
    try:
        try:
            ifc = open_ifc(tmp_path)
        except Exception as e:
            raise HTTPException(400, f"Kunne ikke lese IFC-fil: {e}")
        schema = ifc.schema
        if not any(schema.upper().startswith(p) for p in ACCEPTED_SCHEMA_PREFIXES):
            raise HTTPException(
                415, f"IFC-schema {schema!r} støttes ikke. Tillatt: IFC2X3 og IFC4 (inkl. IFC4X1/2/3).")
        products = list_products(ifc)
        _job_set(job_id, stage="indekser", fraction=0.0, products=len(products))
        index = ModelIndex(ifc, products, progress=lambda f: _job_set(job_id, fraction=round(f, 3)))
        facts = model_facts(ifc, products)
        # The property sets from the index just built (a second pass over
        # the relationships, build_pset_index, took as long as the index).
        psets: dict[str, set] = {}
        for pset_name, prop in index.props:
            psets.setdefault(pset_name, set()).add(prop)
        psets = {k: sorted(v) for k, v in sorted(psets.items())}
        storeys = extract_storey_codes_from_ifc(ifc)
        detected = detect_discipline_from_filename(file_name)
        load_seconds = time.time() - t0
        up = store.put(
            ifc=ifc, products=products, facts=facts, psets=psets, storeys=storeys,
            detected_discipline=detected, file_name=file_name, file_size=size,
            load_seconds=load_seconds,
        )
        up.index = index
        # The inventory rides with the result: the walk opens on it with no
        # further round trip.
        inventory = inventory_payload(index, [TFMRules.from_dict(preset_to_rules_dict(p)) for p in PRESETS])
        _job_set(job_id, stage="ferdig", fraction=1.0, result={
            "inventory": inventory,
            "upload_id": up.upload_id,
            "file_name": file_name,
            "file_size": size,
            "facts": facts,
            "psets": psets,
            "storeys": storeys,
            "detected_discipline": detected,
            "suggested_preset": suggest_preset(detected),
            "suggested_field": suggest_field(psets),
            "load_seconds": round(load_seconds, 2),
        })
    except HTTPException as e:
        _job_set(job_id, stage="feil", error=e.detail)
    except Exception as e:  # noqa: BLE001 — reported to the client, not swallowed
        _job_set(job_id, stage="feil", error=f"Kunne ikke lese IFC-fil: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/jobs")
def start_job(file: UploadFile = File(...)):
    """Take the file, then read and index it in the background. A file sent
    gzipped (`<name>.ifc.gz`, the browser compresses before upload) is
    unpacked here; the model keeps its own name."""
    name = file.filename or ""
    gz = name.lower().endswith(".gz")
    if gz:
        name = name[:-3]
    suffix = Path(name).suffix.lower()
    if suffix not in (".ifc", ".ifczip"):
        raise HTTPException(400, "Filen må være en .ifc- eller .ifczip-fil.")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        if gz:
            try:
                with gzip.GzipFile(fileobj=file.file) as src:
                    shutil.copyfileobj(src, tmp, 1 << 20)
            except (OSError, EOFError) as e:
                tmp.close()
                os.unlink(tmp.name)
                raise HTTPException(400, f"Kunne ikke pakke ut filen: {e}")
        else:
            shutil.copyfileobj(file.file, tmp, 1 << 20)
        tmp_path = tmp.name
    size = os.path.getsize(tmp_path)
    job_id = uuid.uuid4().hex[:16]
    with _jobs_lock:
        # Finished jobs older than an hour are dropped.
        now = time.time()
        for k in [k for k, j in _jobs.items() if now - j["t"] > 3600]:
            _jobs.pop(k, None)
        _jobs[job_id] = {"t": now, "stage": "les", "fraction": None, "products": None,
                         "file_size": size, "result": None, "error": None}
    threading.Thread(target=_read_job, args=(job_id, tmp_path, name, size), daemon=True).start()
    return {"job_id": job_id, "file_size": size}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with _jobs_lock:
        j = _jobs.get(job_id)
        if j is None:
            raise HTTPException(404, "Ukjent jobb.")
        out = {k: v for k, v in j.items() if k != "t"}
        out["elapsed"] = round(time.time() - j["t"], 1)
        return out


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


@app.post("/api/values")
def source_values(req: ValuesRequest):
    """One source's values with counts (and the phase an MMI value means)."""
    up = _resolve(req.upload_id)
    return values_payload(_index(up), req.location)


@app.post("/api/register")
def register(req: PreviewRequest):
    """The TFM register for the loaded model, one row per object with a code."""
    up = _resolve(req.upload_id)
    rules = TFMRules.from_dict(req.rules)
    columns, rows, summary, roll = register_rows(
        up.ifc, up.products, _index(up), rules, up.file_name, up.detected_discipline)
    data = build_register_xlsx(columns, rows, summary, roll)
    stem = Path(up.file_name).stem
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{stem}_TFM-register.xlsx"'},
    )


@app.post("/api/rollup")
def code_rollup(req: PreviewRequest):
    """System and component codes rolled up: objects, valid in the linked
    standard, description, and what they appear with."""
    up = _resolve(req.upload_id)
    rules = TFMRules.from_dict(req.rules)
    coded, _ = coded_objects(_index(up), rules)
    return rollup(coded, rules)


def _codes(up, rules: TFMRules):
    return _index(up).code_values(rules) if rules.composed else None


@app.post("/api/check")
def check(req: CheckRequest):
    up = _resolve(req.upload_id)
    rules = TFMRules.from_dict(req.rules)
    bd_codes = codes_for_bygningsdel(rules.bygningsdel_system)
    komp_codes = codes_for_komponent(rules.komponent_system)

    t0 = time.time()
    results = run_checks(up.ifc, up.products, rules, bd_codes, komp_codes, _codes(up, rules))
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
    loc_str = ("Sammensatt" if rules.composed
               else "Alle felt" if loc[0] == "all"
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
    results = run_checks(up.ifc, up.products, rules, bd_codes, komp_codes, _codes(up, rules))
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
