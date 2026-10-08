"""Shape check per segment: one code read against the rule set's forms.

``diagnose`` answers three things for a code: does it take one of the forms
(anchored at both ends), and if not, why (per segment), and whether a
mechanical fix makes it take the form. Mechanical means only:

- whitespace and separators at the ends of a segment removed (``05.`` -> ``05``),
- a separator where the form has another one replaced (``360-001`` -> ``360.001``),
- letters upper-cased in Lokasjon and Komponent,
- a running number zero-padded to its fixed width (``4`` -> ``004``).

Never content: no segment is truncated, no letter or digit added or dropped,
Systemkode and Lokasjon are never padded. A fix is proposed only when the
fixed code takes the form in full.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .constants import (
    PART_TO_TEMPLATE, PLACEHOLDER_RE, SEP_TO_CHAR, freetext_value, is_freetext,
)
from .rules import TFMRules

# Template part name (lokasjon) -> the part's display name (Lokasjon).
PART_NAME = {PLACEHOLDER_RE.search(t).group(1): p for p, t in PART_TO_TEMPLATE.items()}

SEP_CHARS = ".-_/ =+%"
_SEP_CLASS = "[" + re.escape(SEP_CHARS) + "]"
_EDGE = SEP_CHARS + "\t"

LETTER_PARTS = {"komponent", "typekode"}
UPPER_PARTS = {"komponent", "lokasjon", "typekode"}
# Running numbers: zero-padding keeps the number.
PADDABLE = {"lopenummer", "kompnr", "subnr", "rom", "etasje", "omrade", "linje", "sloyfe", "adresse", "typenr",
            "instansnr"}

# What a part takes when no length is locked, in plain terms.
_PART_RULE = {
    "lokasjon": "6 tegn", "rom": "1–5 siffer", "systemkode": "3 siffer", "etasje": "1–12 tegn",
    "subnr": "1–4 siffer", "lopenummer": "3 siffer", "komponent": "2 bokstaver", "kompnr": "3 siffer",
    "typeflag": "T", "omrade": "1–2 siffer", "linje": "1–2 siffer", "sloyfe": "2 siffer", "adresse": "3 siffer",
    "typekode": "1–3 bokstaver", "typenr": "3 siffer", "instansnr": "2 siffer",
}


def part_rule(name: str, rules: TFMRules) -> str:
    own = (rules.part_rules or {}).get(name)
    if own:
        if own["kind"] == "value":
            return f"«{own['value']}»"
        if own["kind"] == "list":
            vals = own["values"]
            return "en av " + ", ".join(vals[:6]) + (" …" if len(vals) > 6 else "")
        return f"mønsteret {own['pattern']}"
    n = (rules.part_digits or {}).get(name)
    if isinstance(n, int) and n > 0:
        if name == "lokasjon":
            return f"{n} tegn"
        if name in PADDABLE:
            return f"{n} siffer"
    return _PART_RULE.get(name, "")


def _tokens(sequence: list[str]) -> list[tuple[str, str]]:
    """("part", name) | ("lit", text), adjacent literals merged."""
    out: list[tuple[str, str]] = []
    for t in sequence:
        if t in PART_TO_TEMPLATE:
            out.append(("part", PLACEHOLDER_RE.search(PART_TO_TEMPLATE[t]).group(1)))
            continue
        text = SEP_TO_CHAR.get(t) if t in SEP_TO_CHAR else (freetext_value(t) if is_freetext(t) else "")
        if not text:
            continue
        if out and out[-1][0] == "lit":
            out[-1] = ("lit", out[-1][1] + text)
        else:
            out.append(("lit", text))
    return out


def _lenient(tokens, loose_seps: bool) -> re.Pattern:
    """Each part as a loose group, each literal exact (or any separator)."""
    src = []
    for i, (kind, val) in enumerate(tokens):
        if kind == "lit":
            if loose_seps and all(c in SEP_CHARS for c in val):
                src.append(f"({_SEP_CLASS}{{{len(val)}}})")
            else:
                src.append(f"({re.escape(val)})")
            continue
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if nxt is not None and nxt[0] == "part":
            src.append("([A-Za-zÆØÅæøå]*)" if val in LETTER_PARTS else r"(\d*)")
        elif nxt is None:
            src.append("(.*)")
        else:
            src.append("(.*?)")
    return re.compile("^" + "".join(src) + "$")


@dataclass
class Diagnosis:
    ok: bool
    reason: str = ""
    fix: str = ""
    # The parts as read (strict when ok, loose otherwise), by template name.
    parts: dict | None = None


def _fix_part(name: str, text: str, form: re.Pattern) -> str:
    t = text.strip().strip(_EDGE)
    if name in UPPER_PARTS:
        t = t.upper()
    if name in PADDABLE and t.isdigit():
        m = re.fullmatch(r"\\d\{(\d+)\}", form.pattern)
        if m and len(t) < int(m.group(1)):
            t = t.zfill(int(m.group(1)))
    return t


def _read(code: str, tokens, rules: TFMRules, loose_seps: bool):
    """A loose reading of the code against one form: (bad segments, reasons,
    fixed code or "", parts) or None when the code cannot be read so."""
    m = _lenient(tokens, loose_seps).match(code)
    if not m:
        return None
    reasons, fixed, parts, bad = [], [], {}, 0
    unfixable = 0
    for (kind, val), got in zip(tokens, m.groups()):
        if kind == "lit":
            if got != val:
                bad += 1
                reasons.append(f"«{got}» der formatet har «{val}»")
            fixed.append(val)
            continue
        parts[val] = got
        form = re.compile(rules.part_form(val))
        label = PART_NAME.get(val, val)
        if form.fullmatch(got):
            fixed.append(got)
            continue
        bad += 1
        # A bad segment swallowing separators is likely a misread: count them.
        bad += sum(1 for c in got.strip().strip(_EDGE) if c in SEP_CHARS)
        if got.strip() == "":
            reasons.append(f"{label} mangler")
        else:
            reasons.append(f"{label} «{got}», skal være {part_rule(val, rules)}")
        f = _fix_part(val, got, form)
        if not form.fullmatch(f):
            unfixable += 1
        fixed.append(f)
    if loose_seps and unfixable:
        # Another separator only explains a code whose segments then fit.
        return None
    return bad, reasons, "".join(fixed), parts


def _missing(code: str, tokens) -> list[str]:
    """The literals of a form a code lacks, in order, naming the part after."""
    out, at = [], 0
    for i, (kind, val) in enumerate(tokens):
        if kind != "lit":
            continue
        j = code.find(val, at)
        if j < 0:
            nxt = tokens[i + 1] if i + 1 < len(tokens) and tokens[i + 1][0] == "part" else None
            out.append(f"«{val}» {PART_NAME.get(nxt[1], '')}".strip() if nxt else f"«{val}»")
        else:
            at = j + len(val)
    return out


def diagnose(code: str, rules: TFMRules, regexes: list[re.Pattern] | None = None) -> Diagnosis:
    """One code against the rule set's forms."""
    full = regexes if regexes is not None else rules.full_regexes()
    for rx in full:
        m = rx.match(code)
        if m:
            return Diagnosis(ok=True, parts=m.groupdict())

    stripped = code.strip()
    best = None  # (score, reasons, fixed, parts, full regex)
    for p, rx in zip(rules.patterns, full):
        tokens = _tokens(p.get("sequence") or [])
        if not tokens:
            continue
        for loose in (False, True):
            r = _read(stripped, tokens, rules, loose)
            if r is None:
                continue
            bad, reasons, fixed, parts = r
            if stripped != code:
                reasons = ["mellomrom før eller etter koden", *reasons]
            score = bad + (1 if loose else 0)
            if best is None or score < best[0]:
                best = (score, reasons, fixed, parts, rx)
            break
    if best is not None:
        _, reasons, fixed, parts, rx = best
        fix = fixed if fixed != code and rx.match(fixed) else ""
        return Diagnosis(ok=False, reason="; ".join(reasons) or "avviker fra formatet", fix=fix, parts=parts)

    # Not readable against any form: the separators it lacks.
    lacks = None
    for p in rules.patterns:
        miss = _missing(stripped, _tokens(p.get("sequence") or []))
        if miss and (lacks is None or len(miss) < len(lacks)):
            lacks = miss
    reason = ("mangler " + ", ".join(lacks)) if lacks else "avviker fra formatet"
    return Diagnosis(ok=False, reason=reason)
