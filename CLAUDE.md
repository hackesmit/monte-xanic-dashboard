# Monte Xanic Dashboard

## Project Overview
Wine analytics dashboard for Monte Xanic winery. Tracks berry chemistry (Brix, pH, tANT, TA), wine phenolics, extraction rates, and vintage comparisons across 12+ grape varieties and 9+ vineyard origins in Valle de Guadalupe & Valle de Ojos Negros, Baja California. Accessible by winery staff from anywhere via Vercel deployment.

---

## Tech Stack
- **Frontend:** Vanilla JavaScript (ES6) — no framework, single-page app
- **Charts:** Chart.js 4.4.1 (CDN)
- **Data Parsing:** SheetJS / XLSX 0.18.5 (CDN) — for Excel/CSV upload
- **Database:** Supabase (PostgreSQL) — replaces local JSON files
- **Weather:** Open-Meteo API (free, no key required)
- **Styling:** Custom CSS with CSS variables (dark/light themes)
- **Fonts:** Playfair Display + Jost (Google Fonts)
- **Hosting:** Vercel (auto-deploys on every GitHub push)
- **Auth:** Vercel Password Protection (internal staff access only)

---

## Data Sources & Upload Flow

### Source 1 — WineXRay CSV exports
- Exported directly from WineXRay software
- Contains: sample ID, vessel, sample type, vintage, variety, appellation, tANT, fANT, bANT, pH, TA, IPT, color values, berry measurements
- Upload: drag CSV into dashboard → auto-inserts into `wine_samples` table
- Special handling: values like `<50`, `<10` stored as NULL with `below_detection` flag

### Source 2 — Recepción de Tanque Excel
- Two sheets: `Recepción 2025` and `Prefermentativos 2025`
- Contains: tank reception data with up to 4 vineyard lots mixed per row
- Upload: drag Excel into dashboard → auto-splits lots → inserts into `tank_receptions` + `reception_lots` tables

### Source 3 — Open-Meteo API (automatic)
- Historical weather for Valle de Guadalupe: lat 32.0, lon -116.6
- Fetched automatically, cached in `meteorology` table

---

## Database Schema (Supabase)

### Table: `wine_samples`
Populated from WineXRay CSV exports
```
id                    -- auto
sample_id             -- '25CFCC-1', '25SYON-2', '23CSKMP-4'
vessel_id             -- 'B6', 'BCA', 'E6', 'H7'
sample_type           -- 'Aging Wine', 'Must', 'Berry', 'Young Wine', 'Control Wine'
sample_date           -- date of sample
crush_date            -- crush/harvest date
days_post_crush       -- integer
vintage_year          -- 2022, 2023, 2024, 2025
variety               -- 'Cabernet Sauvignon', 'Syrah', etc.
appellation           -- full string from WineXRay e.g. 'Valle de Ojos Negros (Kompali)'
tant                  -- total anthocyanins ppm ME (nullable)
fant                  -- free anthocyanins ppm ME (nullable)
bant                  -- bound anthocyanins ppm ME (nullable)
ptan                  -- pTAN ppm CE (nullable)
irps                  -- iRPs ppm CE (nullable)
ph                    -- pH units (nullable)
ta                    -- titratable acidity g/L (nullable)
ipt                   -- total phenolics index (nullable)
alcohol               -- % v/v (nullable)
va                    -- volatile acidity g/L (nullable)
malic_acid            -- g/L (nullable)
rs                    -- residual sugars g/L (nullable)
l_star                -- color L* (nullable)
a_star                -- color a* (nullable)
b_star                -- color b* (nullable)
berry_weight          -- Berry Fresh Weight g (nullable)
berry_anthocyanins    -- Berry extractable anthocyanins mg/100b (nullable)
berry_sugars_mg       -- Berry Sugars mg/b (nullable)
below_detection       -- boolean, true if any values were <50/<10 etc.
notes                 -- free text
uploaded_at           -- timestamp
```

### Table: `tank_receptions`
Populated from Recepción de Tanque Excel — Sheet: Recepción
```
id                    -- auto
report_code           -- 'RRT-001', 'RRT-002'
reception_date        -- date
batch_code            -- '25SBVDG-1' (lote de bodega / winery lot code)
tank_id               -- 'D1', 'B4', 'C2'
supplier              -- 'VDG', '7L' (proveedor)
variety               -- 'Sauvignon Blanc', 'Chenin Blanc'
brix                  -- °Brix
ph                    -- pH
ta                    -- Acidez Total g/L
ag                    -- Acido Glucónico g/L
am                    -- Ácido Málico g/L
av                    -- Acidez Volátil g/L
so2                   -- SO2 libre mg/L
nfa                   -- NFA (nullable)
temperature           -- °C
solidos_pct           -- % Sólidos
polifenoles_wx        -- Polifenoles WineXRay FFA (nullable)
antocianinas_wx       -- Antocianinas WineXRay FFA (nullable)
poli_spica            -- Polifenoles SPICA (nullable)
anto_spica            -- Antocianinas SPICA (nullable)
ipt_spica             -- IPT SPICA (nullable)
acidificado           -- boolean (Acidificado en recepción SI/NO)
p010_kg               -- P010 additive kg (nullable)
vintage_year          -- extracted from batch_code prefix (25 → 2025)
uploaded_at           -- timestamp
```

### Table: `reception_lots`
Handles the mix of up to 4 vineyard lots per tank reception
```
id                    -- auto
reception_id          -- foreign key → tank_receptions.id
lot_code              -- 'SBMX-3A', 'SBMX-4B', 'CB7L-1'
lot_position          -- 1, 2, 3, or 4
```

### Table: `prefermentativos`
Populated from Recepción de Tanque Excel — Sheet: Prefermentativos
```
id, report_code, measurement_date, batch_code, tank_id,
variety, brix, ph, ta, temperature, tant, notes, uploaded_at
```

### Table: `meteorology`
Auto-populated from Open-Meteo API, cached to avoid redundant calls
```
id, date, temp_max, temp_min, temp_avg,
rainfall_mm, humidity_pct, uv_index, wind_speed, uploaded_at
```

---

## Project Structure
```
Xanic Dashboard/
├── index.html                  # Single page
├── CLAUDE.md                   # This file
├── .gitignore                  # Excludes .env.local
├── .env.local                  # Supabase keys — NEVER commit
├── css/styles.css              # All styling, dark/light themes
├── js/
│   ├── app.js                  # Main app logic, routing, themes
│   ├── config.js               # Colors, grape types, column mappings
│   ├── dataLoader.js           # Supabase queries
│   ├── filters.js              # Filter state & UI management
│   ├── charts.js               # Chart.js rendering
│   ├── tables.js               # Table rendering & sorting
│   ├── kpis.js                 # KPI calculations
│   ├── weather.js              # Open-Meteo API (NEW)
│   └── upload.js               # Excel/CSV → Supabase pipeline (NEW)
├── data/                       # Legacy JSON files (reference only)
└── extract_data.py             # Legacy — deprecated after migration
```

---

## Existing Features
- **Bayas (Berries):** Scatter plots, bar charts, KPIs for Brix / pH / tANT / TA / Weight
- **Vino (Wine):** Tank reception & pre-fermentation tables, phenolic KPIs
- **Extracción:** Berry-to-wine tANT extraction % mapping
- **Vendimias:** 2024 vs 2025 vintage comparison with % change
- **UI:** Dark/light theme toggle, interactive legends, color-by-variety/origin, responsive layout

---

## Features Roadmap

### Phase 1 — Deploy Online ✅ COMPLETE
- [x] Push project to GitHub
- [x] Connect GitHub repo to Vercel
- [x] Dashboard live at https://monte-xanic-dashboard-ky5t.vercel.app/

### Phase 2 — Database Migration *(Priority: NOW)*
- [ ] Create Supabase project (free tier)
- [ ] Create tables using schema above
- [ ] Build `upload.js` — drag & drop CSV/Excel → Supabase
- [ ] Handle WineXRay CSV: detect `<50`/`<10` values → store as NULL
- [ ] Handle Recepción Excel: read both sheets, split reception_lots
- [ ] Update `dataLoader.js` to query Supabase instead of local JSON
- [ ] Add Spanish success/error messages on upload
- [ ] Import existing JSON data into Supabase as baseline

### Phase 3 — Meteorology Integration *(Priority: HIGH)*
- [ ] Create `weather.js` — fetch Open-Meteo historical data
- [ ] Cache in `meteorology` Supabase table
- [ ] Overlay temperature + rainfall on Vendimias charts
- [ ] Brix vs temperature correlation chart
- [ ] tANT vs rainfall correlation chart

### Phase 4 — Polish *(Priority: MEDIUM)*
- [ ] Export charts as PNG/PDF
- [ ] Mobile filter panel improvements
- [ ] Multi-vintage trend lines (3+ years)
- [ ] Per-origin chemistry comparison
- [ ] Harvest calendar with weather overlays

---

## Grape Varieties
**Red (12):** Cabernet Sauvignon, Cabernet Franc, Merlot, Syrah, Nebbiolo, Tempranillo, Grenache, Mourvèdre, Petite Sirah, Durif, Malbec, Petit Verdot

**White (4):** Chardonnay, Sauvignon Blanc, Viognier, Chenin Blanc

---

## Vineyard Origins & Appellations
Full appellation strings from WineXRay (preserve exactly as-is):
- `Valle de Guadalupe (Monte Xanic)`
- `Valle de Ojos Negros (Ojos Negros)`
- `Valle de Ojos Negros (Kompali)`
- `Valle de Ojos Negros (Dominio de las Abejas)`
- `Valle de Ojos Negros (Viña Alta)`
- `Valle de Ojos Negros (Dubacano)`
- `San Gerónimo`
- `California` (control samples)
- `Camino Corazón (Valle de Parras)` (external)

---

## Key Terminology
| Term | Meaning | Unit |
|---|---|---|
| Brix | Sugar content | °Bx |
| pH | Acidity level | — |
| tANT | Total anthocyanins | ppm ME |
| fANT | Free anthocyanins | ppm ME |
| bANT | Bound anthocyanins | ppm ME |
| TA / A.T. | Titratable acidity | g/L |
| IPT | Total phenolics index | — |
| A.G. | Acido Glucónico | g/L |
| A.M. | Ácido Málico | g/L |
| A.V. | Acidez Volátil | g/L |
| Bayas | Berries | — |
| Vino | Wine | — |
| Extracción | Berry-to-wine extraction | % |
| Vendimias | Vintages / Harvest years | — |
| Recepción | Tank reception event | — |
| Prefermentación | Pre-fermentation stage | — |
| Lote de viñedo | Vineyard lot/block | — |
| Lote de bodega | Winery batch code | — |

---

## Environment Variables
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```
- Store in `.env.local` locally — never commit
- Add identical keys to Vercel → Settings → Environment Variables

---

## Claude Code Instructions

### General
- Always preserve Spanish label conventions — never translate to English
- All units remain metric (°C, g/L, mg/L, ppm, °Bx)
- Every new feature must be mobile responsive before considered complete
- Never introduce npm packages or build tools — CDN only
- Never add heavy frameworks — Vanilla JS ES6 only
- Maintain Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility

### File Responsibilities
- KPI calculations → `kpis.js` only
- Chart rendering → `charts.js` only
- Filter logic → `filters.js` only
- Supabase queries → `dataLoader.js` only
- Weather API → `weather.js` only
- Upload pipeline → `upload.js` only
- Column mappings → `config.js` only

### Upload Pipeline Rules (`upload.js`)
- Auto-detect file type: `.csv` = WineXRay, `.xlsx` = Recepción de Tanque
- WineXRay CSV: skip rows where Sample Type = 'Control Wine' unless explicitly requested
- WineXRay CSV: values `<50`, `<10`, `-`, `NA` → store as NULL, set `below_detection = true`
- Recepción Excel: always read BOTH sheets (Recepción + Prefermentativos)
- Recepción Excel: split up to 4 vineyard lot columns into separate `reception_lots` rows
- Always show row count confirmation in Spanish before inserting
- Always handle duplicate `sample_id` / `report_code` gracefully (upsert, not duplicate)
- Show Spanish success message: "✓ X muestras agregadas correctamente"
- Show Spanish error message: "✗ Error al cargar datos. Verificar formato del archivo."

### Database Rules
- All Supabase queries go through `dataLoader.js`
- Never expose Supabase service key — anon key only in client code
- New data fields → add to both Supabase schema AND `config.js` column mappings
- `vintage_year` always extracted from batch code prefix (25 → 2025, 24 → 2024)

### Deployment
- Test locally with `serve.ps1` before pushing
- Never commit `.env.local`
- Vercel environment variables must match `.env.local` keys exactly

---

## Data Scale
- Current rows: ~3,500 wine_samples (grows ~500–800 per vendimia)
- Supabase free tier: 500MB — sufficient for 5+ years
- WineXRay exports: typically 30–100 rows per batch upload
- Recepción Excel: typically 100–150 rows per vendimia season