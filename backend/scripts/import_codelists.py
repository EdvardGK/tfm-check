"""Copy the code lists tfm-check validates against from their existing sources.

No list is authored here. The most complete lists in the workspace are
ifc-check's generated ones (`src/codelists/ns3451.ts`: NS 3451:2022, 813
codes with the reserved ones marked; `ns3457-8.ts`: NS 3457-8:2021, 910
codes), each carrying its provenance. PA 0802 komponentkoder come from
`resources/standards/pa0802/pa0802_codes.json`. Each is written to
backend/data as {meta, codes, reserved}.

Run from the repo root:  python backend/scripts/import_codelists.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[4]
IFC_CHECK = WORKSPACE / "toolkit" / "ifc-check" / "src" / "codelists"
PA0802 = WORKSPACE / "resources" / "standards" / "pa0802" / "pa0802_codes.json"
OUT = Path(__file__).resolve().parents[1] / "data"


def _object(text: str, key: str):
    """The JSON value after `key:` in a generated TS file (an object or an
    array literal; a trailing comma before the close is dropped)."""
    m = re.search(rf"^\s*{key}:\s*", text, re.M)
    if not m:
        return None
    i = m.end()
    open_, close = text[i], {"{": "}", "[": "]"}[text[i]]
    depth, j, in_str, esc = 0, i, False, False
    while j < len(text):
        c = text[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == open_:
            depth += 1
        elif c == close:
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = text[i:j + 1]
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    return json.loads(body)


def from_ifc_check(ts_name: str, out_name: str) -> int:
    text = (IFC_CHECK / ts_name).read_text(encoding="utf-8")
    meta = _object(text, "meta")
    codes = _object(text, "codes")
    reserved = _object(text, "reserved") or []
    meta = {**meta, "copiedFrom": f"toolkit/ifc-check/src/codelists/{ts_name}"}
    (OUT / out_name).write_text(
        json.dumps({"meta": meta, "codes": codes, "reserved": reserved}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    return len(codes)


def from_pa0802(out_name: str) -> int:
    rows = json.loads(PA0802.read_text(encoding="utf-8"))
    codes = {r["Code"]: r["Name"] for r in rows}
    meta = {"id": "pa0802", "label": "PA 0802", "edition": "PA 0802 TFM vedlegg 9.2 rev. 3",
            "copiedFrom": "resources/standards/pa0802/pa0802_codes.json", "count": len(codes)}
    (OUT / out_name).write_text(
        json.dumps({"meta": meta, "codes": codes, "reserved": []}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    return len(codes)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print("ns3451:", from_ifc_check("ns3451.ts", "ns3451_2022.json"))
    print("ns3457-8:", from_ifc_check("ns3457-8.ts", "ns3457-8_2021.json"))
    print("pa0802:", from_pa0802("pa0802_komponent.json"))
