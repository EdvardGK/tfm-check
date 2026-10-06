"""In-memory store for parsed IFC models, keyed by upload_id.

Parsing a 120 MB IFC is expensive, so we parse once on upload and keep the live
ifcopenshell model around so /check and /report can re-run instantly on rule
tweaks. Bounded by a TTL and a small LRU cap because a parsed model is heavy.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Upload:
    upload_id: str
    ifc: Any
    products: list
    facts: dict
    psets: dict
    storeys: list
    detected_discipline: str | None
    file_name: str
    file_size: int
    load_seconds: float
    created: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)


class UploadStore:
    def __init__(self, ttl_seconds: int = 900, max_items: int = 3):
        self.ttl = ttl_seconds
        self.max_items = max_items
        self._items: dict[str, Upload] = {}
        self._lock = threading.Lock()

    def _evict_locked(self) -> None:
        now = time.time()
        # TTL eviction
        expired = [k for k, u in self._items.items() if now - u.last_used > self.ttl]
        for k in expired:
            self._items.pop(k, None)
        # LRU cap
        while len(self._items) > self.max_items:
            oldest = min(self._items.values(), key=lambda u: u.last_used)
            self._items.pop(oldest.upload_id, None)

    def put(self, **kwargs) -> Upload:
        upload_id = uuid.uuid4().hex[:16]
        up = Upload(upload_id=upload_id, **kwargs)
        with self._lock:
            self._items[upload_id] = up
            self._evict_locked()
        return up

    def get(self, upload_id: str) -> Upload | None:
        with self._lock:
            self._evict_locked()
            up = self._items.get(upload_id)
            if up is not None:
                up.last_used = time.time()
            return up

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)
