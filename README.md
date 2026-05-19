# TFM-sjekk

Streamlit-app for mottakskontroll på TFM-merking i IFC-fagmodeller.
Designet for self-service hos klienter: konfigurer regler → last opp IFC → få Excel + PDF.

## Funksjonalitet

- **Filnavn → disiplin-deteksjon** — gjenkjenner `_RIE`, `_RIV`, `_RIB`, `_ARK`, `_RIBR` i filnavnet og pre-velger disiplinknappen for bekreftelse
- **Klassifikasjonssystem** for bygningsdelvalidering (NS3451 medsendt; «Ingen» hopper over sjekken)
- **Pset/Property-velger** — velg presist felt der TFM-koden ligger (eller skann alle felt)
- **Etasjekoder** — auto-detektert fra modellens `IfcBuildingStorey`, redigerbar liste (legg til / endre / slett rader). Knapp for å hente fra en referansemodell.
- **Komponentkoder** — redigerbar liste (valgfri)
- **Konfigurerbar struktur** — placeholdere `{bygningsdel}.{etasje}-{komponent}{lopenummer}` (skjult under Avansert)
- **Schema-støtte**: IFC2X3, IFC4, IFC4X1, IFC4X2, IFC4X3
- **Sjekker**:
  - Element har TFM-kode i valgt felt
  - Bygningsdelskoden er gyldig i klassifikasjonssystemet
  - Bygningsdelskoden er i forventet område for disiplinen (kryssfagsflagg)
  - Etasjekoden er i tillatt liste
  - Komponentkoden er i tillatt liste
  - IfcSystem-navn har TFM-prefiks
  - Element tildelt IfcSystem
  - Element tildelt TFM-navnet system
- **Dashboard** — fargekodede metric-cards (grønn/gul/rød) + bar chart, kryssfag-flagg
- **Drill-down** dialoger for elementer uten kode, ugyldige koder, systemer, m.m.
- **Eksport**: Excel + PDF i én ZIP

## Installasjon

```bash
pip install -r requirements.txt
```

## Kjøring

```bash
streamlit run app.py
```

## Personvern / telemetri

Appen logger anonymt til lokal `usage.db` (SQLite):
- Tidsstempel (UTC)
- Filstørrelse i bytes
- IFC-schema
- Antall produkter
- Kjøretid
- Tilfeldig sesjons-ID

**Logges aldri**: filnavn, elementnavn, GUIDs, propertyverdier, modellinnhold.

Legg telemetridatabasen et annet sted ved å sette miljøvariabel `TFM_USAGE_DB`.

## Hosting

Appen er designet for hosting på Streamlit Community Cloud eller tilsvarende. På
en Streamlit Cloud-deploy er filsystemet flyktig — SQLite-loggen tilbakestilles ved
omdistribusjon. For varig telemetri, pek `TFM_USAGE_DB` til en mountet volume eller
bytt `usage.py` til en ekstern DB.

## Struktur

```
tfm-check/
├── app.py             — Streamlit-UI
├── usage.py           — Anonym telemetri (SQLite)
├── .streamlit/
│   └── config.toml    — Tema + maxUploadSize=600 MB
├── requirements.txt
└── README.md
```

## Requirements

- Python 3.10+
- streamlit, pandas, ifcopenshell, openpyxl, altair, reportlab
