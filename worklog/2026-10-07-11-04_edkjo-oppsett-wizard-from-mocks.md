---
project: tfm-check
date: 2026-10-07
---

# Oppsett wizard: base commit, rejected first build, mocks, rebuild from the approved mock

Spec: EdvardGK/tfm-check#1. Run from the ST28 TFM-sjekk session.

## Base
- The May 2026 React/FastAPI rebuild was sitting uncommitted on `main`. edkjo approved committing it as found: `e66479a`, local, not pushed.
- Background is the G55 worklog `2026-05-21-16-18_tfm-check-full-rebuild.md`.
- Work happens in the worktree `toolkit/tfm-check-wt-oppsett`, branch `feat/oppsett-walk`, which is neither pushed nor merged.

## Rejected
- **First wizard** (`9c1bd40`..`52511e1`): the May layout restyled with ifc-check tokens. edkjo: "nonono. Very poor design. It seems you shouldnt have looked to the previous work at all."
- **The first full-width mock** was "on to something", but edkjo wants a windowed central column for wizards and fast UI, and full scale for workspaces.
- **Both verdicts are in the canon:** `resources/design-system/data-workspace.md`, 2026-10-06 and 2026-10-07.

## Approved
- `frontend/mocks/oppsett-kilde.html` ("second one looks good"). Etasjer is the same structure and drew no complaint.
- **Structure:** taken from ifc-check Oppsett v2 and sprucelab setup-v2 (`frontend/DESIGN.md` §1, §2, §2b, §2c).
  - A left rail holds the step index and the options for the current step.
  - The header is the step name plus `n / N`, with «Forrige» / «Bruk».
  - The canvas is an 8:5 grid composed in bands.
  - The model browser is a tree with «Standard» / «Forslag» pinned on top.
  - One converging measure of 1344 × 860.

## Built from the mock (`2afb47b`..`e0daea8`)
- **Steps:** the first screen, Åpne IFC, Kilde, Format, Etasjer, Scope and Oppsummering. The CSS is lifted from the mocks into `frontend/src/oppsett/oppsett.css`. Results is unchanged.
- **Backend:**
  - the preview returns each source's values with where the form's parts fall;
  - a TFM-shape count, so MagiCAD `ObjectID` is proposed on SM_RIE;
  - `.ifczip` accepted;
  - storey elevations in metres;
  - 21 tests.
- **Etasjer:** typed codes are sticky and the auto codes reflow around them, saved as `storey_manual`.
- **Verified:**
  - `tsc`, `vite build` and pytest pass;
  - the layout gate passes at 1440, 1920 and 2560 on SM_RIE (standard missing) and ST28_RIE (standard present): no page scroll, the rail never moves, band tops aligned;
  - shots in `frontend/mocks/shots/app/`.
- **Running locally** for edkjo on `http://127.0.0.1:8793`.

## Open
- **Format freeze:** seen once in the first build and not reproduced since. The new Format step has a single debounced preview; the longest task was 67 ms.
- **Labels the build agent added beyond the mocks, still to be checked:** «Deler», «Treff», «Avvik», the «3 siffer»-style part rules, «Valgt», and «Disiplin» / «Format» as rail headings.
- **Empty states:** free space under the first screen's two cards; Scope's «Valgt» list is empty until something is excluded.
- **Design manual for the apps on skiplum.com.** edkjo wants one: apps are never built from nothing, and any app that is must conform to skiplum.com before deploy.
  - Proposed: a shared package (tokens, shell, primitives), a binding guide, and a conformance gate in the Docker deploy.
  - Waiting on one question: skiplum.com's own tokens (sand, ink, Schibsted Grotesk, pill) versus ifc-check's glass as the app standard.
- **Deploy:** Docker on the Skiplum Hetzner box, staging first. Needs the box details; not started.
- **Repo:** EdvardGK owns it; moving it to Ed-Skiplum before publishing is undecided.
