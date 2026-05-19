# TFM-sjekk

Streamlit-app for mottakskontroll på TFM-merking i IFC-fagmodeller.
Designet for self-service hos klienter: konfigurer regler → last opp IFC → få Excel + PDF.

## Funksjonalitet

- **Prosjekt + disiplin** med presets for RIE, RIV, RIB, ARK, RIBR
- **Konfigurerbar struktur** (placeholdere `{bygningsdel}.{etasje}-{komponent}{lopenummer}`)
- **Allowlists** per kodedel (komma-separerte lister)
- **Etasjer fra referansemodell** — last opp en «ren» IFC for å hente ut tillatte etasjekoder
- **Schema-støtte**: IFC2X3, IFC4, IFC4X1, IFC4X2, IFC4X3
- **Sjekker**:
  - Element har TFM-kode (i Name / Tag / hvilket som helst Pset)
  - Kode følger struktur (loose regex)
  - Kode fullt gyldig (alle deler i lister)
  - IfcSystem-navn har TFM-prefiks
  - Element tildelt IfcSystem
  - Element tildelt TFM-navnet system
- **Dashboard** med fargekodede metric-cards + bar chart
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
