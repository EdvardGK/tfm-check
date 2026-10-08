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

## Same day, round 2 (staging live at https://test.tfm-sjekk.skiplum.com)
- Loading screen: skiplum.com's «Norge i punkter» loader animation (`logo-outline.webm`, copied as is) with a counter: upload %, read seconds, index % (upload is a job, `/api/jobs`).
- Format: drag and drop of segments and pieces, click variant kept.
- A segment's rule: standard form, length, pattern, value or list.
- Linked standards: Systemkode → NS 3451:2022 (813), Komponent → NS 3457-8:2021 (910) / PA 0802 / IEC 81346, copied from ifc-check's generated lists (`backend/scripts/import_codelists.py`). Validity beyond shape, with reason and nearest parent.
- Rollup of system and component codes in Oppsummering and as register sheets Systemkoder / Komponentkoder.
- HI90_RIV on staging: 360 (154 objects) is not an NS 3451:2022 code (36 Luftbehandling); SFZ (260) is not in NS 3457-8 (SF Fraluftsventiler); KRA, QLB, KNA, KK… are.
- pytest 69 passed, tsc + vite build pass, parity passes.

## Round 3: the walk opens while the model loads
- Loader only inside the IFC drop frame; the rail's file row carries the counter.
- A picked file moves the walk on at once (discipline from the name, schema from the header, read in the browser). Format, Etasjer scheme and Scope work before the model is read; Kilde, Status and Oppsummering fill in when the inventory arrives.
- Browser gzips the IFC before upload; `/api/jobs` unpacks it.
- Measured from edkjo's box to staging, HI90_RIV (43 MB, 10 MB gzipped): upload 9–10 s raw, 7 s gzipped (RTT ~260 ms, so throughput ramps with size; the gain grows for bigger models). Server: open ~0.9 s, index (= the pset inventory) ~1.2 s. The upload is the long part; there is no earlier inventory to split out on the server.
