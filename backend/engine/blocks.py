"""The blocks a code form is built of.

A form is an ordered list of blocks; nothing between them is implied. A
block is one token of a sequence:

- a part name («Systemkode», «Komponent» …): a named code part, its rule in
  ``part_rules`` by its key (systemkode, komponent …) or its standard form;
- a fixed value: a separator key («.», «mellomrom» …) or ``T:<text>``;
- ``SL:<json list>``: one of the listed values (accepted separators, «.» or «_»);
- ``SR:<regex>``: text taking the pattern.

Old rulesets are plain sequences of the first two kinds and read unchanged:
their separators are fixed-value blocks.
"""

from __future__ import annotations

import json
import re

from .constants import PART_TO_TEMPLATE, PLACEHOLDER_RE, SEP_TO_CHAR, freetext_value, is_freetext

LIST_PREFIX = "SL:"
REGEX_PREFIX = "SR:"
NEVER = r"(?!x)x"

# The form of a code in each standard list, for a part whose data type is
# that list (validity: the value must also be an entry, standards.py).
STANDARD_FORM = {
    "NS3451": r"\d{1,4}",
    "NS3457-8": r"[A-ZÆØÅ]{1,3}",
    "PA0802": r"[A-Z]{2}",
    "IEC81346": r"[A-Z]{1,3}",
}


def part_key(token: str) -> str | None:
    t = PART_TO_TEMPLATE.get(token)
    return PLACEHOLDER_RE.search(t).group(1) if t else None


def safe_regex(p: str) -> str:
    """A user's regex as a fragment: anchors dropped; one that does not
    compile or has named groups matches nothing (the check fails loudly)."""
    if p.startswith("^"):
        p = p[1:]
    if p.endswith("$") and not p.endswith("\\$"):
        p = p[:-1]
    try:
        if re.compile(p).groupindex:
            return NEVER
    except re.error:
        return NEVER
    return "(?:" + p + ")"


def list_values(token: str) -> list[str]:
    try:
        vals = json.loads(token[len(LIST_PREFIX):])
    except (ValueError, TypeError):
        return []
    return [str(v) for v in vals if str(v) != ""] if isinstance(vals, list) else []


def block_of(token: str):
    """("part", key) | ("fixed", text) | ("list", values) | ("pattern", regex)
    | None for a token that is none of them."""
    k = part_key(token)
    if k:
        return ("part", k)
    if token in SEP_TO_CHAR:
        return ("fixed", SEP_TO_CHAR[token])
    if is_freetext(token):
        return ("fixed", freetext_value(token))
    if token.startswith(LIST_PREFIX):
        return ("list", list_values(token))
    if token.startswith(REGEX_PREFIX):
        return ("pattern", token[len(REGEX_PREFIX):])
    return None


def list_regex(values: list[str]) -> str:
    if not values:
        return NEVER
    return "(?:" + "|".join(re.escape(v) for v in sorted(values, key=len, reverse=True)) + ")"


def block_display(block) -> str:
    kind, v = block
    if kind == "fixed":
        return f"«{v}»"
    if kind == "list":
        return " eller ".join(f"«{x}»" for x in v)
    if kind == "pattern":
        return f"mønsteret {v}"
    return v
