"""
Anonymous usage telemetry for TFM-sjekk.

Logs ONLY:
- timestamp (UTC)
- file size in bytes
- IFC schema (IFC2X3 / IFC4 / ...)
- product count
- processing duration in seconds
- random session id (to count distinct sessions, not users)

NEVER logs: filename, file content, element names/GUIDs, property values.
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.environ.get("TFM_USAGE_DB", Path(__file__).parent / "usage.db"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc          TEXT    NOT NULL,
    session_id      TEXT    NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    ifc_schema      TEXT,
    product_count   INTEGER,
    duration_sec    REAL,
    app_version     TEXT
);
CREATE INDEX IF NOT EXISTS idx_uploads_ts ON uploads(ts_utc);
"""


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript(_SCHEMA)
    return conn


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]


def log_upload(
    *,
    session_id: str,
    file_size_bytes: int,
    ifc_schema: str | None,
    product_count: int | None,
    duration_sec: float | None,
    app_version: str = "0.1.0",
) -> None:
    """Insert one upload row. Safe to call from Streamlit callbacks."""
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO uploads "
                "(ts_utc, session_id, file_size_bytes, ifc_schema, product_count, duration_sec, app_version) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    session_id,
                    int(file_size_bytes),
                    ifc_schema,
                    int(product_count) if product_count is not None else None,
                    float(duration_sec) if duration_sec is not None else None,
                    app_version,
                ),
            )
    except sqlite3.Error:
        # Telemetry must never break the app.
        pass


def stats() -> dict:
    """Return aggregate stats — for an admin/status page."""
    try:
        with _connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]
            sessions = conn.execute("SELECT COUNT(DISTINCT session_id) FROM uploads").fetchone()[0]
            avg_size = conn.execute("SELECT AVG(file_size_bytes) FROM uploads").fetchone()[0]
            avg_dur = conn.execute("SELECT AVG(duration_sec) FROM uploads").fetchone()[0]
            schemas = dict(conn.execute(
                "SELECT ifc_schema, COUNT(*) FROM uploads GROUP BY ifc_schema"
            ).fetchall())
            last = conn.execute(
                "SELECT ts_utc, file_size_bytes, ifc_schema, product_count, duration_sec "
                "FROM uploads ORDER BY id DESC LIMIT 20"
            ).fetchall()
        return {
            "total_uploads": total,
            "distinct_sessions": sessions,
            "avg_size_mb": (avg_size or 0) / 1_048_576,
            "avg_duration_sec": avg_dur or 0,
            "schemas": schemas,
            "recent": last,
        }
    except sqlite3.Error:
        return {"total_uploads": 0, "distinct_sessions": 0, "avg_size_mb": 0,
                "avg_duration_sec": 0, "schemas": {}, "recent": []}
