# TFM-sjekk

Mottakskontroll på TFM-merking i IFC-fagmodeller. Last opp en IFC, få en
auto-konfigurert kontroll og en Excel + PDF-rapport. Self-service for rådgivere.

**Arkitektur:** React-SPA (Vite + Tailwind) servert av et FastAPI-API som kjører
selve IFC-kontrollen (ifcopenshell). Én prosess, ett deploy — designet for
Railway og iframe-innbygging på `skiplum.no/apps/tfm-sjekk`.

```
tfm-check/
├── backend/              FastAPI + valideringsmotor (Python)
│   ├── main.py           API: /upload /check /report /presets /codes (+ static SPA)
│   ├── store.py          In-memory modellcache (TTL + LRU) → momentan re-kjøring
│   ├── usage.py          Anonym telemetri (SQLite)
│   ├── data/             ns3451_codes.json, iec81346_letters.json
│   ├── parity_check.py   Motor-paritet mot G55-fixtures
│   └── engine/           rules · checks · ifc_io · reports · presets · constants
├── frontend/             Vite + React + TS + Tailwind v4 (Skiplum-tokens)
│   ├── src/components/    Upload → Confirm (preset-galleri + builder) → Results
│   └── smoke.mjs         Headless ende-til-ende-røyktest (Playwright)
├── streamlit/            Interim Streamlit-utgave (samme motor, Community Cloud)
│   ├── app.py            Preset-først UI som importerer ../backend/engine
│   └── requirements.txt
├── legacy/streamlit_app.py   Opprinnelig Streamlit-monolitt (referanse)
└── Dockerfile
```

## Flyt

1. **Last opp** — IFC slippes inn; backend parser én gang og cacher modellen.
2. **Bekreft** — alt auto-oppdages (disiplin fra filnavn, etasjer fra
   `IfcBuildingStorey`, TFM-felt fra Pset, mønster fra disiplin). Velg et ferdig
   merkemønster i galleriet, eller åpne **Tilpass** for drag-and-drop-byggeren.
3. **Resultat** — fargekodet dashboard + nedlastbar rapport. «Juster og kjør på
   nytt» er momentant (modellen ligger i cache — ingen ny opplasting).

## Sjekker

Element har TFM-kode · systemkode gyldig i NS3451 · i forventet område for
disiplinen (kryssfag) · etasjekode i tillatt liste · etasje = elementets storey ·
komponentbokstav gyldig i IEC 81346-2 · IfcSystem-prefiks · element tildelt
IfcSystem · tildelt TFM-navnet system.

Schema: IFC2X3, IFC4, IFC4X1/2/3.

## Utvikling

Backend (terminal 1):

```bash
python -m venv .venv
.venv/Scripts/activate          # Windows  (kilde: .venv/bin/activate på *nix)
pip install -r backend/requirements.txt
cd backend && uvicorn main:app --reload --port 8000
```

Frontend (terminal 2) — Vite proxyer `/api` til :8000:

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

### Verifisering

```bash
.venv/Scripts/python.exe backend/parity_check.py     # motor mot G55-fixtures
cd frontend && npm run build && npm run smoke         # ende-til-ende i headless Chromium
```

## Streamlit-utgave (interim)

Mens Railway-hostingen settes opp kan tooltet kjøres som en Streamlit-app — samme
valideringsmotor (`backend/engine`), preset-først UI, ingen duplisert logikk.

```bash
.venv/Scripts/activate
pip install -r streamlit/requirements.txt
streamlit run streamlit/app.py            # http://localhost:8501
```

**Streamlit Community Cloud:** pek deployen på `streamlit/app.py` i dette repoet.
Den finner `streamlit/requirements.txt`, og appen legger `backend/` på `sys.path`
selv — så `engine` og kodelistene (`backend/data/*.json`) lastes uten ekstra steg.
Filsystemet er flyktig, så telemetri-`usage.db` nullstilles ved redeploy (ufarlig).

Forskjeller fra web-utgaven: mønsteret bygges via et tabell-redigeringsfelt (legg
til/fjern blokker) i stedet for dra-og-slipp; ellers identiske sjekker og rapporter.

## Produksjon (web-utgaven)

```bash
docker build -t tfm-sjekk .
docker run -p 8000:8000 tfm-sjekk        # SPA + API på samme origin
```

På Railway binder containeren `$PORT` automatisk. Innbygging styres av CSP
`frame-ancestors` (env `TFM_FRAME_ANCESTORS`); standard tillater `skiplum.no`,
`*.skiplum.no` og Vercel-previews.

| Env | Standard | Beskrivelse |
|-----|----------|-------------|
| `TFM_STORE_TTL` | `900` | Sekunder en parset modell beholdes i minnet |
| `TFM_STORE_MAX` | `3` | Maks antall cachede modeller (LRU) |
| `TFM_FRAME_ANCESTORS` | skiplum.no + vercel | CSP-kilder som får iframe-embedde |
| `TFM_USAGE_DB` | `backend/usage.db` | Sti til telemetri-SQLite |

## Personvern

Telemetri logger kun: tidsstempel, filstørrelse, IFC-schema, antall produkter,
kjøretid, tilfeldig sesjons-ID. **Aldri** filnavn, elementnavn, GUID-er eller
property-verdier. Modeller holdes bare i minnet og forsvinner ved TTL/omstart.
