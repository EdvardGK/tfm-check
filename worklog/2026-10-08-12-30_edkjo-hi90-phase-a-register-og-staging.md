---
project: tfm-check
date: 2026-10-08
---

# HI90 Phase A: code from parts, shape check per segment, register, staging on skiplum-apps-1

Spec: EdvardGK/tfm-check#1 plus the HI90 brief (`10021/.../HI90_BEP/02_arbeid/HI90_TFM-gjennomføringsplan.docx`, D1 = PA 0802 `+02=320.003-JP401`).
Branch `hi90-phase-a`, from `feat/oppsett-walk` (the approved Oppsett walk of 2026-10-07). Pushed.

## Built
- Kilde «Hel kode» / «Fra deler»: a code composed from the PA 0802 aspects (+lokasjon =system -komponent), each from its own property, picked in the model tree. Standard per aspect: `NOSSB_Reference.RefPriSysLoc / RefPriSysOcc / RefCompOcc`. Candidates from the loaded model only.
- Shape check per segment (`backend/engine/shape.py`): a reason per off code; a fix only when mechanical (separators, case, zero-padding a running number).
- Statsbygg form also takes the system code without component (`+02=360.017`). Element codes matched at both ends.
- Lokasjon length lockable (HI90 needs 2).
- Status step: the MMI source, read as ny / bevares / ombruk / rives.
- Register (.xlsx) from Oppsummering: Sammendrag + Register, Norwegian headers, verbatim value per source field.
- Discipline from `<PROSJEKT>_<FAG>.ifc`; the setup file is keyed by fag and kept in the browser on «Lagre oppsett».

## Verified
- pytest 50 passed; `tsc` and `vite build` pass; `parity_check.py` passes (G55_RIE; G55_RIV fixture missing).
- HI90_RIV.ifc (test copy in gitignored `testdata/`): 2 152 products, 1 932 with a composed code, 0 valid. Most lack lokasjon or system (`-SQ.001T`, `+04-QLB.002T`).
- Staging container on skiplum-apps-1 (`tfm-sjekk-test`): health, upload, inventory, preview, check and register all 200 through an ssh tunnel (measured on the box, not via the public host).

## Open
- DNS `test.tfm-sjekk.skiplum.com` not created (edkjo runs `dns.sh`), so staging is not public yet.
- HI90 RIV has KOMPONENTTYPE-ID (type, `SQ.001T`) but no component occurrence ID.
- Phase B left: ifc-check mapping interchange, ST28 cleanup steps and checks.
