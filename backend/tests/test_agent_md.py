"""The worked example in agent.md (frontend/src/oppsett/agentMd.ts) is a
real ruleset: it parses and its stated valid codes validate."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.rules import TFMRules  # noqa: E402
from engine.shape import diagnose  # noqa: E402

MD = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "oppsett" / "agentMd.ts").read_text(encoding="utf-8")


def test_worked_example_validates():
    block = MD[MD.index('{\n  "tfm_sjekk_oppsett"'):MD.index("\nValid codes")]
    data = json.loads(block)
    assert data["tfm_sjekk_oppsett"] == 2
    rules = TFMRules.from_dict(data["fag"]["RIV"])
    assert rules.composed
    for code in re.search(r"Valid codes for it: (.+)\.", MD).group(1).split(", "):
        assert diagnose(code, rules).ok, code
