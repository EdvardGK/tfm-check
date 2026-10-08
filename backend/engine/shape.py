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
from .blocks import block_display, block_of, list_regex, safe_regex
from .rules import TFMRules, base_part

# Template part name (lokasjon) -> the part's display name (Lokasjon).
# A part's display name: the token, except where the UI says it longer.
# Numbers are named for what they number (edkjo): Systemnr, Undernr,
# Forekomstnr, Typenr, Typeundernr, Sløyfenr …; «Nummer» is one not yet said.
PART_LABEL = {
    "Lokasjon": "Plasserings-ID", "Løpenummer": "Systemnr", "Subnr": "Undernr", "Komponent": "Komponentkode",
    "Komp.nr": "Forekomstnr", "Typekode": "Komponentkode (type)", "Typenr": "Typenr",
    "Instansnr": "Forekomstnr", "Kode": "TFM-ID", "Typeundernr": "Typeundernr",
    "Sløyfe": "Sløyfenr", "Linje": "Linjenr", "Område": "Områdenr", "Adresse 2": "Adressenr",
}
PART_NAME = {PLACEHOLDER_RE.search(t).group(1): PART_LABEL.get(p, p) for p, t in PART_TO_TEMPLATE.items()}

SEP_CHARS = ".-_/ =+%"
_SEP_CLASS = "[" + re.escape(SEP_CHARS) + "]"
_EDGE = SEP_CHARS + "\t"

LETTER_PARTS = {"komponent", "typekode"}
UPPER_PARTS = {"komponent", "lokasjon", "typekode"}
# Running numbers: zero-padding keeps the number.
PADDABLE = {"lopenummer", "kompnr", "subnr", "rom", "etasje", "omrade", "linje", "sloyfe", "adresse", "typenr",
            "instansnr", "nummer", "typeundernr"}

# What a part takes when no length is locked, in plain terms.
_PART_RULE = {
    "lokasjon": "6 tegn", "rom": "1–5 siffer", "systemkode": "3 siffer", "etasje": "1–12 tegn",
    "subnr": "1–4 siffer", "lopenummer": "3 siffer", "komponent": "2 bokstaver", "kompnr": "3 siffer",
    "typeflag": "T", "omrade": "1–2 siffer", "linje": "1–2 siffer", "sloyfe": "2 siffer", "adresse": "3 siffer",
    "typekode": "1–3 bokstaver", "typenr": "3 siffer", "instansnr": "2 siffer", "kode": "én kode uten mellomrom",
    "nummer": "1–6 siffer", "typeundernr": "1–3 siffer",
}


def part_rule(name: str, rules: TFMRules) -> str:
    own = _block_rule(name, rules) or (rules.part_rules or {}).get(base_part(name))
    name = base_part(name)
    if own:
        if own["kind"] == "value":
            return f"«{own['value']}»"
        if own["kind"] == "list":
            vals = own["values"]
            return "en av " + ", ".join(vals[:6]) + (" …" if len(vals) > 6 else "")
        if own["kind"] == "standard":
            from .standards import STANDARDS
            return f"en kode i {STANDARDS[own['standard']][1]}"
        m = re.fullmatch(r"\\d\{(\d+)(?:,(\d+))?\}", own["pattern"])
        if m:
            return f"{m.group(1)}–{m.group(2)} siffer" if m.group(2) else f"{m.group(1)} siffer"
        return f"mønsteret {own['pattern']}"
    n = (rules.part_digits or {}).get(name)
    if isinstance(n, int) and n > 0:
        if name == "lokasjon":
            return f"{n} tegn"
        if name in PADDABLE or name.startswith("n_"):
            return f"{n} siffer"
    if name.startswith("n_"):
        return "1–6 siffer"
    return _PART_RULE.get(name, "")


def _block_rule(group: str, rules: TFMRules) -> dict | None:
    """The rule a configured block carries, by its group name."""
    from .blocks import CONFIG_PREFIX, block_config
    from .rules import clean_rule
    for p in rules.patterns:
        used: dict[str, int] = {}
        for t in p.get("sequence") or []:
            b = block_of(t)
            if not b or b[0] != "part":
                continue
            used[b[1]] = used.get(b[1], 0) + 1
            g = b[1] if used[b[1]] == 1 else f"{b[1]}__{used[b[1]]}"
            if g == group and t.startswith(CONFIG_PREFIX):
                c = block_config(t)
                return clean_rule(c["rule"]) if c and c["rule"] else None
    return None


def _tokens(sequence: list[str]):
    """("part", key) | ("lit", text) | ("alt", {rx, show, fix}), adjacent
    fixed values merged. A list block's fix is its first value; a pattern
    block has none."""
    out: list = []
    used: dict[str, int] = {}
    for t in sequence:
        b = block_of(t)
        if b is None:
            continue
        kind, v = b
        if kind == "part":
            # By group name, as the form's regex names it (komponent__2).
            used[v] = used.get(v, 0) + 1
            out.append(("part", v if used[v] == 1 else f"{v}__{used[v]}"))
        elif kind == "fixed":
            if not v:
                continue
            if out and out[-1][0] == "lit":
                out[-1] = ("lit", out[-1][1] + v)
            else:
                out.append(("lit", v))
        elif kind == "list":
            sep = bool(v) and all(not ch.isalnum() for x in v for ch in x)
            out.append(("alt", {"rx": list_regex(v), "show": block_display(b), "fix": v[0] if v else None, "sep": sep}))
        else:
            out.append(("alt", {"rx": safe_regex(v), "show": block_display(b), "fix": None, "sep": False}))
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
        if kind == "alt":
            # Read loosely, any short text stands where the block is.
            if not loose_seps:
                src.append(f"({val['rx']})")
            else:
                # Read loosely: where accepted separators stand, any other
                # separator; else any short text.
                src.append("([^A-Za-z0-9ÆØÅæøå]{1,4})" if val["sep"] else "(.{1,4}?)")
            continue
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if nxt is not None and nxt[0] == "part":
            src.append("([A-Za-zÆØÅæøå]*)" if base_part(val) in LETTER_PARTS else r"(\d*)")
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
    if (name in PADDABLE or name.startswith("n_")) and t.isdigit():
        pat = form.pattern
        if pat.startswith("(?:") and pat.endswith(")"):
            pat = pat[3:-1]
        m = re.fullmatch(r"\\d\{(\d+)\}", pat)
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
        if kind == "alt":
            if re.fullmatch(val["rx"], got):
                fixed.append(got)
                continue
            bad += 1
            reasons.append(f"«{got}» der formatet har {val['show']}")
            if val["fix"] is None:
                unfixable += 1
            fixed.append(val["fix"] if val["fix"] is not None else got)
            continue
        if kind == "lit":
            if got != val:
                bad += 1
                reasons.append(f"«{got}» der formatet har «{val}»")
            fixed.append(val)
            continue
        parts[val] = got
        form = re.compile(rules.part_form(val))
        base = base_part(val)
        label = (rules.block_labels().get(val) or (rules.part_labels or {}).get(base)
                 or rules.own_numbers().get(base) or PART_NAME.get(base, base))
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
        f = _fix_part(base, got, form)
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
