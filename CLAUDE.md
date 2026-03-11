# Monte Xanic Dashboard

## Project Overview
Wine analytics dashboard for Monte Xanic winery. Tracks berry chemistry (Brix, pH, tANT, TA), wine phenolics, extraction rates, and vintage comparisons across 12+ grape varieties and 9+ vineyard origins in Valle de Guadalupe & Valle de Ojos Negros, Baja California. Accessible by winery staff from anywhere via Vercel deployment.

---

## Tech Stack
- **Frontend:** Vanilla JavaScript (ES6) — no framework, single-page app
- **Charts:** Chart.js 4.4.1 (CDN)
- **Data Parsing:** SheetJS / XLSX 0.18.5 (CDN) — for Excel upload feature
- **Database:** Supabase (PostgreSQL) — replaces local JSON files
- **Weather:** Open-Meteo API (free, no key required) — historical & current weather
- **Styling:** Custom CSS with CSS variables (dark/light themes)
- **Fonts:** Playfair Display + Jost (Google Fonts)
- **Hosting:** Vercel (auto-deploys on every GitHub push)
- **Auth:** Vercel Password Protection (internal staff access only)
- **Data Extraction:** Python script (`extract_data.py`) — legacy, being replaced by Excel upload

---

## Data Sources
- **Primary:** Supabase database (migrated from JSON files)
- **Weather:** Open-Meteo API — coordinates 32.0°N, 116.6°W (Valle de Guadalupe)
- **Updates:** Excel/CSV upload from WineXRay → auto-inserts into Supabase
- **Legacy:** `berry_data.json`, `wine_recepcion.json`, `wine_preferment.json` (pre-migration)

---

## Database Schema (Supabase)

### Table: `berry_samples`
```
id, vintage_year, origin, variety, brix, ph, tant, ta, weight, sample_date
```

### Table: `wine_recepcion`
```
id, vintage_year, origin, variety, tank_id, volume, ph, tant, ta, reception_date
```

### Table: `wine_preferment`
```
id, vintage_year, origin, variety, tank_id, brix, ph, tant, ta, temperature, date
```

### Table: `meteorology`
```
id, date, temp_max, temp_min, temp_avg, rainfall, humidity, uv_index, wind_speed
```
*(auto-populated from Open-Meteo API)*

---

## Project Structure
```
Xanic Dashboard/
├── index.html                  # Single page
├── css/styles.css              # All styling, dark/light themes
├── js/
│   ├── app.js                  # Main app logic, routing, themes
│   ├── config.js               # Colors, grape types, mappings
│   ├── dataLoader.js           # Supabase queries + SheetJS Excel upload
│   ├── filters.js              # Filter state & UI management
│   ├── charts.js               # Chart.js rendering
│   ├── tables.js               # Table rendering & sorting
│   ├── kpis.js                 # KPI calculations
│   ├── weather.js              # Open-Meteo API integration (NEW)
│   └── upload.js               # Excel → Supabase insert pipeline (NEW)
├── data/                       # Legacy JSON files (pre-migration reference)
├── extract_data.py             # Legacy Python extractor (deprecated after migration)
├── serve.ps1                   # Local dev server
├── .env.local                  # Supabase keys (never commit this file)
└── .gitignore                  # Must include .env.local
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

### Phase 1 — Deploy Online *(Priority: NOW)*
- [ ] Push project to GitHub repository
- [ ] Connect GitHub repo to Vercel
- [ ] Enable Vercel Password Protection for staff access
- [ ] Confirm dashboard loads at vercel URL

### Phase 2 — Database Migration *(Priority: HIGH)*
- [ ] Create Supabase project (free tier)
- [ ] Import existing JSON data into Supabase tables
- [ ] Update `dataLoader.js` to query Supabase instead of local JSON
- [ ] Build Excel upload → Supabase auto-insert feature in `upload.js`
- [ ] Remove dependency on `extract_data.py` Python script
- [ ] Test with new WineXRay export

### Phase 3 — Meteorology Integration *(Priority: HIGH)*
- [ ] Create `weather.js` — fetch historical weather from Open-Meteo API
- [ ] Store weather data in Supabase `meteorology` table
- [ ] Add temperature + rainfall overlay to Vendimias charts
- [ ] Build Brix vs temperature correlation view
- [ ] Build tANT vs rainfall correlation view

### Phase 4 — Polish *(Priority: MEDIUM)*
- [ ] Export charts as PNG/PDF
- [ ] Mobile filter panel improvements
- [ ] Multi-vintage trend lines (3+ years)
- [ ] Per-origin chemistry comparison view
- [ ] Harvest calendar with weather overlays

---

## Grape Varieties
**Red (12):** Cabernet Sauvignon, Merlot, Syrah, Nebbiolo, Tempranillo, Grenache, Mourvèdre, Petite Sirah, Zinfandel, Malbec, Cabernet Franc, Petit Verdot

**White (4):** Chardonnay, Sauvignon Blanc, Viognier, Chenin Blanc

---

## Vineyard Origins
Valle de Guadalupe + Valle de Ojos Negros, Baja California (9+ designated origins)

---

## Key Metrics & Terminology
| Spanish Term | Meaning | Unit |
|---|---|---|
| Brix | Sugar content | °Bx |
| pH | Acidity level | — |
| tANT | Total anthocyanins | mg/L |
| TA | Titratable acidity | g/L |
| Bayas | Berries | — |
| Vino | Wine | — |
| Extracción | Berry-to-wine extraction rate | % |
| Vendimias | Vintages / Harvest years | — |
| Recepción | Tank reception | — |
| Prefermentación | Pre-fermentation stage | — |

---

## Environment Variables
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```
- Store in `.env.local` locally
- Add to Vercel Environment Variables in project settings
- Never hardcode in JS files
- Never commit to GitHub

---

## Claude Code Instructions

### General
- Always preserve Spanish label conventions — never translate to English
- All units must remain metric (Celsius, g/L, mg/L, °Bx)
- Every new feature must be mobile responsive before considered complete
- Never introduce npm packages or build tools — CDN only
- Never add heavy frameworks (React, Vue, Angular) — Vanilla JS only
- Chart.js 4.4.1 and SheetJS 0.18.5 API compatibility must be maintained

### File Responsibilities
- New KPI calculations → `kpis.js` only
- New chart types → `charts.js` only
- New filter logic → `filters.js` only
- Database queries → `dataLoader.js` only
- Weather API calls → `weather.js` only
- Excel upload logic → `upload.js` only

### Database Rules
- All Supabase queries go through `dataLoader.js`
- Never expose Supabase service key in client-side code — anon key only
- Always handle Supabase errors gracefully with Spanish error messages
- New data fields must be added to both Supabase schema AND `config.js` mappings

### Deployment Rules
- Never commit `.env.local` — always in `.gitignore`
- Test locally with `serve.ps1` before pushing to Vercel
- All Vercel environment variables must match `.env.local` keys exactly

### Weather Integration Rules
- Open-Meteo base URL: `https://api.open-meteo.com/v1`
- Valle de Guadalupe coordinates: latitude 32.0, longitude -116.6
- Always fetch hourly temperature + daily rainfall as minimum
- Cache weather responses in Supabase `meteorology` table to avoid redundant API calls

---

## Data Scale Reference
- Current rows: ~3,500 (grows each vendimia)
- Supabase free tier: 500MB — sufficient for 5+ years of growth
- Expected vendimia growth: ~500–800 new rows per harvest season
