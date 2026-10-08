---
project: tfm-check
date: 2026-10-08
---

# Blokkmodell, NS 8360-1-termer, IDS, flere modeller, laster

Branch `hi90-phase-a` (pushed), staging `https://test.tfm-sjekk.skiplum.com` (service `tfm-sjekk-test` on skiplum-apps-1). Follows `2026-10-08-12-30_edkjo-hi90-phase-a-register-og-staging.md`.

## Rounds
- Loader: skiplum.com's outline animation (`logo-outline.webm`, copied) in the IFC drop frame only, with a counter; the walk holds on it until the inventory is in. Upload is gzipped in the browser and read as a job (`/api/jobs`); the inventory comes with the job result.
- Kilde and Status: «Bruk standard» / «Velg annen» (tree, «Angi egen» inside). Kilde asks «Hvor skal TFM-koden være lagret i denne modellen?». Standard source is Statsbygg NOSSB_Reference or NS 8360 NONS_Reference, whichever the model has.
- Ruleset first: several models per session, each with its discipline's rules; register and rollup over all; an opened ruleset covering the discipline goes straight to Oppsummering. agent.md embedded in every ruleset download.
- IDS as ruleset (`engine/ids_import.py`): property facets by name to TFM-ID / parts / status; pattern, enumeration and value to rules; everything else reported with its reason. KNM.ids: 3 of 40 map.
- Linked standards: NS 3451:2022 and NS 3457-8:2021 copied from ifc-check's generated lists, PA 0802 komponentkoder; validity beyond form, rollup of system and component codes (Oppsummering, register sheets).
- Format, now Merkestreng + building blocks: a code form is an ordered list of blocks, nothing implied between them (`engine/blocks.py`). Kinds Klassifikasjon / Løpenummer / Skilletegn. Every block has its own dropdown (click or ▾): what it represents, name, data type, list/preset/value, move/remove. Per-block config in `B:` tokens; own-named numbers are their own parts and register columns. «+» bubbles and a picker insert blocks; variants read «eller»; each variant shown as an example and as technical keys.
- Terms from NS 8360-1 G1:2025 (PA 0802 agrees): TFM-ID, Plasserings-ID, Systemforekomst-ID, Komponentforekomst-ID, Systemkode, Nummer, Undernummer, Komponentkode, Forekomstnr, Komponenttypenummer, (Komponenttype)undernummer. The technical key shows under every plain name and in register headers.
- ST28 rev E + elektro and HI90 (Agilitek, HI90_TFM) example strings are tests (`tests/test_project_forms.py`).

## Verified
- pytest 133, tsc, vite build, parity_check (G55_RIE). Staging checked by API: jobs, inventory, preview, rollup, register (multi-model), IDS. The UI changes were built and deployed but not clicked through in a browser.

## Open
- System code 360 is not in NS 3451:2022 (HI90 uses it); which edition / list governs.
- Component code: PA 0802 two letters vs NS 3457-8 one to three.
- HI90 TFM-ID example `<>++ =360.014-…`: the space and empty location, accepted literally.
- «Instansnummer» (HI90) vs NS 8360's (Komponenttype)undernummer.
- PA 0802 systemkodeliste is not in the workspace.
- A second block of the same part is checked but gets no register column of its own.
- The Results page (Aksepter) is still single-model.
- Phase B left: ifc-check mapping interchange; ST28 cleanup steps.
- Production on skiplum.com waits for edkjo's live look on staging.

## Reopened: Skilletegn as a data type, number names
- Skilletegn is a data type, not a block kind: any block can take it (presets . - _ / + = ++ % ␣ or typed); no Skilletegn group in building blocks or the picker, the separator presets insert a block of that type.
- Numbers named for what they number, «Nummer» while unset: Systemnr (RefPriSysNo1), Undernr (RefPriSysNo2), Forekomstnr (RefCompOccNo), Typenr (RefCompTypeNo1), Typeundernr (RefCompTypeNo2), Sløyfenr, Linjenr, Områdenr, Adressenr, or an own name.
- Instansnr dropped: instance = occurrence, so HI90's `.06` in `%SQZ.008.06` is a Forekomstnr; the older instance segment reads as one (two digits by default).

## Later rounds
- Each variant is its own card, «Regel N»; the rules are checked in order (first match recorded), «↓ ellers» between, ▲▼ to reorder. A code passes on any rule; the register's «Regel» column says which (or «ingen»), a failure's reason names the closest rule.
- Scope «loading again»: a step waited for its own fresh preview; steps now open on the latest data for the model and update in place. A model idle 15 min was dropped silently; now said in the bar, TTL 2 h.
- No loader on arriving at a step: rule-free data from the inventory (types, storeys), rule-dependent data (preview, Scope, Status values, rollup) prefetched whenever the rules change.
- Scope as «Ta med» / «Utelat» rules over Alle, IFC-klasse, Type, Systemkode, Komponentkode, MMI or any property; er / starter med / regex; values from the model with counts; in-scope count live. Older scope fields read as Utelat rules.
- «Lagre oppsett» in the rail at every step: the same file as «Last ned mal» (one format), every discipline, the open step's edits included.
- Open: saving to the account (konto.skiplum.com) waits for edkjo's approval of the konto changes: the tfm-check origins in the platform's `wrangler.jsonc` ALLOWED_ORIGINS (staging + production) and a migration registering app `tfm-check` and its origins (`app`, `app_origin`) in production.
