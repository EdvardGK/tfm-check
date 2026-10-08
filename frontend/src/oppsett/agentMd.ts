/** agent.md: the ruleset file's format, for an AI agent that fills or edits
 *  one. Written into every downloaded ruleset as the top-level field
 *  `agent_md`; the app ignores the field when it reads the file. */
export const AGENT_MD = `# agent.md — TFM-sjekk ruleset (tfm_sjekk_oppsett v2)

## What this file is
A ruleset for TFM-sjekk (test.tfm-sjekk.skiplum.com / skiplum.com). It says, per discipline, where an IFC model carries its TFM code, what form the code takes, how floors are coded, what is out of scope and where the status (MMI) code is. The app opens it with «Åpne regelsett», applies the rules for each loaded model's discipline and checks every model without per-model picking. «Lagre oppsett» writes the same format.

## Top level
- "tfm_sjekk_oppsett": 2 (required, the format version).
- "agent_md": this text. Ignored when read.
- "base": "statsbygg" | "custom". Informational.
- "fag": { "<DISCIPLINE>": <rules>, ... }. Keys are discipline codes as read from model file names "<PROJECT>_<DISCIPLINE>[_...].ifc", e.g. HI90_RIV_MMI700.ifc -> "RIV". Upper case. "*" applies to any discipline without its own entry.

## <rules> fields
- "discipline_key": the discipline (RIV, RIE, RIB, ARK, RIBR, RIA, Annet ...).
- "tfm_mode": "whole" | "parts".
  - "whole": the full code is in one source, "tfm_location".
  - "parts": the code is composed from up to three sources, "tfm_parts": {"lokasjon": <loc>, "system": <loc>, "komponent": <loc>}. Composition: "+" lokasjon, "=" system, "-" komponent; a value that already starts with its sign keeps it; an empty part is left out.
- <loc> (a source): ["pset", "<PropertySetName>", "<PropertyName>"] or ["attr", null, "Name"|"Tag"]. Names are case-sensitive, exactly as in the IFC. A source the model lacks is not replaced: the model fails the check there.
- "status_location": <loc> of the MMI / status code, or null. Read as phases: 0-6xx ny, 7xx bevares, 8xx ombruk, 9xx rives.
- "patterns": [ {"sequence": [<token>, ...]}, ... ]. A code is valid when it matches one sequence completely (anchored at both ends).
  - <token> is a segment name, a separator or "T:<literal text>".
  - Segments: "Lokasjon", "Rom", "Systemkode", "Etasje", "Subnr", "Løpenummer", "Komponent", "Komp.nr", "T-suffiks", "Område", "Linje", "Sløyfe", "Adresse 2", "Typekode", "Typenr", "Instansnr". A segment may appear more than once in a sequence.
  - Separators: "+", "++", "=", ".", "-", "_", "/", "%", "mellomrom" (a space).
- "part_rules": {"<segment key>": <rule>} overrides a segment's standard form. Segment keys: lokasjon, rom, systemkode, etasje, subnr, lopenummer, komponent, kompnr, typeflag, omrade, linje, sloyfe, adresse, typekode, typenr, instansnr. <rule> is one of:
  - {"kind": "pattern", "pattern": "<regex>"} (Python regex for the segment alone; ^ and $ are dropped; no named groups; a regex that does not compile matches nothing),
  - {"kind": "value", "value": "<exact text>"},
  - {"kind": "list", "values": ["<accepted>", ...]}.
- "part_digits": {"<segment key>": n} fixes a digit count (lokasjon: character count). "part_rules" wins over it.
- Standard links (validity beyond form):
  - "bygningsdel_system": "NS3451" | "Ingen" (Systemkode against NS 3451:2022),
  - "komponent_system": "NS3457-8" | "PA0802" | "IEC81346" | "Ingen" (Komponent),
  - "part_links": {"typekode": "NS3457-8" | "PA0802" | "IEC81346"}.
  A linked segment must be a real entry: not missing, not reserved, not «bør ikke benyttes».
- Segment standard forms when no rule is set: lokasjon 6 characters, systemkode 3 digits, lopenummer 3, komponent 2 capitals, kompnr 3, subnr 1-4, rom 1-5, etasje 1-12 characters, typeflag optional "T", omrade 1-2, linje 1-2, sloyfe 2, adresse 3, typekode 1-3 capitals, typenr 3, instansnr 2.
- "floor_style": "statsbygg" (00U, 01, 02M ...) | "u" (U1, 01, M ...) | "custom". "storey_codes": {"<IfcBuildingStorey name>": "<code>"}; "floor_codes": the accepted floor codes; "storey_manual": storeys whose code was typed.
- "scope_components": component codes left out of every check; "scope_types": type names left out.
- "project_name": free text for reports.

## Worked example (HI90 RIV, code composed from three properties, PA 0802 with a two-character location)
{
  "tfm_sjekk_oppsett": 2,
  "base": "custom",
  "fag": {
    "RIV": {
      "discipline_key": "RIV",
      "tfm_mode": "parts",
      "tfm_parts": {
        "lokasjon": ["pset", "HI90_Prosjektinfo", "TFM PLASSERINGS-ID"],
        "system": ["pset", "HI90_Prosjektinfo", "TFM SYSTEMFOREKOMST-ID (BYGNINGDELSTABELLEN)"],
        "komponent": ["pset", "HI90_Prosjektinfo", "TFM KOMPONENTTYPE-ID"]
      },
      "status_location": ["pset", "HI90_Prosjektinfo", "HI90_MMI"],
      "patterns": [
        {"sequence": ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer", "-", "Komponent", "Komp.nr"]},
        {"sequence": ["+", "Lokasjon", "=", "Systemkode", ".", "Løpenummer"]}
      ],
      "part_digits": {"lokasjon": 2},
      "bygningsdel_system": "NS3451",
      "komponent_system": "NS3457-8"
    }
  }
}
Valid codes for it: +02=320.003-JP401, +02=360.017.

## Editing rules for agents
- Keep "tfm_sjekk_oppsett": 2 and the "fag" map; add one entry per discipline.
- Use property names exactly as the model has them; do not invent a fallback.
- Prefer "part_rules" over changing "patterns" when only one segment's values differ.
`;
