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
- Historical weather for 3 valleys: VDG (32.08, -116.62), VON (32.00, -116.25), SV (32.05, -116.45)
- Fetched automatically per valley, cached in `meteorology` table with `location` column

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
appellation           -- ranch-first format e.g. 'Kompali (VON)', 'Monte Xanic (VDG)'
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
id, date, location, temp_max, temp_min, temp_avg,
rainfall_mm, humidity_pct, uv_index, wind_speed, uploaded_at
```
- `location`: valley abbreviation — `'VDG'`, `'VON'`, or `'SV'` (default `'VDG'`)
- Unique constraint: `(date, location)`

### Table: `mediciones_tecnicas`
Physical berry field measurements — tonnage, berry size/weight, 200-berry health sort
```
id                    -- auto
medicion_code         -- 'MT-2025-001' (unique)
medicion_date         -- date of measurement
vintage_year          -- 2025, 2026, etc.
variety               -- normalized (same values as wine_samples)
appellation           -- ranch-first format (same as wine_samples)
lot_code              -- soft link to wine_samples.sample_id (not enforced FK)
tons_received         -- tonnage received for this lot (numeric 8,2)
berry_count_sample    -- number of berries in health sort sample
berry_avg_weight_g    -- average weight per berry (g, numeric 6,2)
berry_diameter_mm     -- average diameter (mm, numeric 5,2)
health_grade          -- 'Excelente', 'Bueno', 'Regular', 'Malo'
health_madura         -- count of mature berries in sort
health_inmadura       -- count of immature berries
health_sobremadura    -- count of overripe berries
health_picadura       -- count of insect-damaged berries
health_enfermedad     -- count of diseased berries
health_quemadura      -- count of sunburned berries
measured_by           -- who performed the measurement
notes                 -- free text
uploaded_at           -- timestamp
```

---

## Project Structure
```
monte-xanic-dashboard/
├── index.html                  # Single page
├── CLAUDE.md                   # This file
├── .gitignore                  # Excludes .env.local, .claude/
├── .env.local                  # Supabase keys — NEVER commit
├── .vercelignore               # Blocks non-public files from Vercel deploy
├── .editorconfig               # Editor formatting rules
├── .nvmrc                      # Node version pin (20)
├── css/styles.css              # All styling, dark/light themes
├── js/
│   ├── app.js                  # Main app logic, routing, themes
│   ├── auth.js                 # Client-side auth (token verify, login UI)
│   ├── config.js               # Colors, grape types, column mappings
│   ├── dataLoader.js           # Supabase queries (paginated)
│   ├── filters.js              # Filter state & UI management
│   ├── charts.js               # Chart.js rendering
│   ├── tables.js               # Table rendering & sorting
│   ├── kpis.js                 # KPI calculations
│   ├── maps.js                 # Vineyard quality map (NOT YET ACTIVE)
│   ├── weather.js              # Open-Meteo API + Supabase cache
│   ├── upload.js               # Excel/CSV → Supabase pipeline
│   └── mediciones.js           # Mediciones técnicas — form, table, charts
├── api/
│   ├── config.js               # Vercel serverless: Supabase credentials (auth-gated)
│   ├── login.js                # Vercel serverless: bcrypt login + HMAC token + persistent rate limit
│   ├── verify.js               # Vercel serverless: token verification + blacklist check
│   ├── logout.js               # Vercel serverless: token revocation (blacklist)
│   ├── upload.js               # Vercel serverless: auth-gated data upload (service key)
│   └── photo-url.js            # (Phase 7b) Presigned R2 upload URL generator (not yet implemented)
├── assets/
│   ├── logo_montexanic.svg     # Brand logo
│   ├── favicon.svg             # Favicon (logo symbol)
│   ├── fonts/
│   │   └── SackersGothicMedium.ttf  # Custom header font
│   └── maps/                   # Reserved for Phase 5 vineyard map
├── sql/
│   ├── migration_overhaul.sql  # Origin rename, Durif, composite key, meteorology location
│   ├── migration_rate_limits.sql # Persistent rate limiting table
│   ├── migration_token_blacklist.sql # Token revocation blacklist table
│   └── migration_mediciones.sql # Phase 7: mediciones_tecnicas table
├── vercel.json                 # Vercel config + security headers
└── package.json                # bcryptjs + npm scripts (+ @aws-sdk/client-s3 in Phase 7)
```

---

## Existing Features
- **Bayas (Berries):** Scatter plots, bar charts, KPIs for Brix / pH / tANT / TA / Weight. Last-point highlighting per lot (★ Punto final). Varietal bars show sample count (n=). Origin distribution as horizontal bar (sorted by count).
- **Evolución Fenólica:** Interactive evolution chart — phenolic compounds (tANT, fANT, bANT, pTAN, iRPs, IPT) on left Y-axis + Brix on right Y-axis. Per-lot lines, click-to-highlight, berry→wine linking via `berryToWine` mapping.
- **Vino (Wine):** Tank reception & pre-fermentation tables, phenolic KPIs, grouped bar chart of avg tANT/fANT/pTAN/IPT by variety
- **Extracción:** Berry-to-wine tANT extraction mapping (grouped bar) + extraction % horizontal bar color-coded by quality band (<30% red, 30–50% gold, >50% green)
- **Vendimias:** Multi-vintage scatter with 5-day-bin trend lines per vintage, weather overlays
- **Weather:** Valley-specific weather (VDG, VON, SV). Temperature time series, rainfall scatter, Brix vs temp and tANT vs rain correlations per valley.
- **Upload:** Drag & drop WineXRay CSV or Recepción Excel → Supabase (with validation, lab/EXP/California sample filtering). Composite key `(sample_id, sample_date)` preserves sample evolution.
- **Auth:** Login screen with bcrypt password, HMAC session tokens (2h expiry), persistent rate limiting, token revocation via blacklist, server-side upload validation
- **Mapa:** SVG vineyard section map with color-coded quality metrics (Brix, pH, tANT, TA), section detail panel, ranch tabs
- **UI:** Dark/light theme toggle, interactive legends, color-by-variety/origin, responsive layout, "Limpiar Todo" filter reset, mobile bottom-sheet filters, export menu (PNG/PDF)
- **Mediciones:** Manual entry form for physical berry field measurements (tonnage, berry weight/diameter, 200-berry health sort). Sortable table with colored health mini-bars. KPIs (count, tons, avg weight, avg % madura). Charts: tonnage by variety, berry weight timeline, health distribution by variety.
- **Security:** Auth-gated API, XSS escaping, CSP headers, no hardcoded credentials

---

## Features Roadmap

### Phase 1 — Deploy Online ✅ COMPLETE
- [x] Push project to GitHub
- [x] Connect GitHub repo to Vercel
- [x] Dashboard live at https://monte-xanic-dashboard-ky5t.vercel.app/

### Phase 2 — Database Migration ✅ COMPLETE
- [x] Create Supabase project (free tier)
- [x] Create tables using schema above
- [x] Build `upload.js` — drag & drop CSV/Excel → Supabase
- [x] Handle WineXRay CSV: detect `<50`/`<10` values → store as NULL
- [x] Handle Recepción Excel: read both sheets, split reception_lots
- [x] Update `dataLoader.js` to query Supabase instead of local JSON (paginated)
- [x] Add Spanish success/error messages on upload
- [x] Import existing JSON data into Supabase as baseline
- [x] Lab sample filtering (COLORPRO, CRUSH, WATER, blueberry, raspberry auto-skipped)

### Phase 3 — Meteorology Integration ✅ COMPLETE
- [x] Create `weather.js` — fetch Open-Meteo historical data
- [x] Cache in `meteorology` Supabase table
- [x] Overlay temperature + rainfall on Vendimias charts
- [x] Brix vs temperature correlation chart
- [x] tANT vs rainfall correlation chart

### Phase 4 — Authentication ✅ COMPLETE
- [x] Login screen with username/password
- [x] bcrypt password hashing + HMAC session tokens (2h expiry)
- [x] Auth-gated `/api/config` endpoint (Supabase credentials protected)
- [x] Rate limiting on login (10 attempts / 15 min)
- [x] **Login screen UI polish** — completed in Phase 6

### Phase 4b — Data & Visualization Overhaul ✅ COMPLETE
- [x] Origin naming: ranch-first format — `Monte Xanic (VDG)`, `Kompali (VON)`, etc.
- [x] Petite Sirah → Durif rename across all code paths and DB
- [x] Remove experimental (EXP/EXPERIMENTO), California, and flagged samples
- [x] Composite key `(sample_id, sample_date)` — preserves sample evolution history
- [x] Valley-specific weather for VDG, VON, SV with per-sample resolution
- [x] Last-point highlighting per lot (★ Punto final tooltip, larger marker)
- [x] Evolution chart: toggleable phenolic compounds + Brix dual-axis, berry→wine linking
- [x] Supabase migration script: `sql/migration_overhaul.sql`

### Phase 4c — Stability, Security & Visualization Improvements ✅ COMPLETE
Workflow 2 (REVIEW.md findings) + Workflow 3 (visualization improvements):
- [x] XSS escaping in table rendering
- [x] Rate limit TTL cleanup + correct IP extraction
- [x] Role fallback to 'viewer' (not 'admin')
- [x] Concurrent refresh guard (`_refreshInProgress` / `_refreshPending`)
- [x] IntersectionObserver disconnect + queue clear on view switch
- [x] Weather sync guard + API response validation
- [x] below_detection rows show † marker in tables
- [x] Empty filter results show Spanish "Sin datos" messages
- [x] All Chart.js constructors wrapped in try/catch
- [x] Stale lot IDs auto-cleared
- [x] V1: Origin doughnut → horizontal bar (sorted by count)
- [x] V2: Extraction % chart with quality-band colors
- [x] V3: Wine phenolics grouped bar (tANT/fANT/pTAN/IPT by variety)
- [x] V4: Sample count (n=) in varietal bar labels

### Phase 5 — Vineyard Quality Map ✅ COMPLETE
- [x] Add `maps.js` CONFIG: `fieldLotToSection`, `fieldLotRanchPatterns`, `mapMetrics`, `vineyardSections`
- [x] Add map view DOM elements to `index.html` (SVG container, metric selector, detail panel, KPIs)
- [x] Load `maps.js` via `<script>` tag in `index.html`
- [x] Add "Mapa" nav tab to sidebar
- [x] SVG vineyard section map with color-coded quality metrics (Brix, pH, tANT, TA)
- [x] Section detail panel with per-section KPIs
- [x] Ranch-level tonnage-weighted aggregation

### Phase 6 — Polish ✅ COMPLETE
- [x] Export charts as PNG (per-chart export buttons)
- [x] Export charts as PDF (jsPDF 2.5.2 CDN, export menu dropdown)
- [x] Login screen UI polish — radial gold glow, layered shadows, gradient divider, staggered entrance animation
- [x] Mobile filter panel — bottom sheet with rounded corners, pull handle, header with close button, slide-down dismiss
- [x] Multi-vintage trend lines — all data as scatter + 5-day-bin dashed trend lines per vintage
- [x] Per-origin chemistry comparison — normalized 5-axis radar chart (Brix, pH, AT, tANT, Peso Baya)
- [x] Harvest calendar with weather overlays — floating bars per variety + temp/rain overlay

### Security Hardening ✅ COMPLETE
- [x] Server-side upload endpoint (`api/upload.js`) — validates token + role before Supabase insert
- [x] Persistent rate limiting (`rate_limits` table in Supabase with fallback in-memory)
- [x] Token revocation (`token_blacklist` table + `api/logout.js` endpoint)
- [x] Token expiry reduced from 24h to 2h
- [x] Blacklist check in both `/api/verify` and `/api/upload`
- [x] SQL migrations: `migration_rate_limits.sql`, `migration_token_blacklist.sql`

### Phase 7 — Mediciones Técnicas ✅ COMPLETE
- [x] Supabase table: `mediciones_tecnicas` (migration script + upload allowlist)
- [x] `js/mediciones.js` — form, table, KPIs, 3 charts (tonnage, weight timeline, health distribution)
- [x] `view-mediciones` panel in `index.html` with sortable table + health mini-bars
- [x] `DataStore.loadMediciones()` + `_rowToMedicion` mapper in `dataLoader.js`
- [x] Nav tab, routing, event bindings in `app.js` / `events.js`
- [x] Form + health bar CSS styles

### Phase 7b — Evidencia Fotográfica *(deferred)*
- [ ] Cloudflare R2 bucket setup (`montexanic-mediciones`) + CORS config
- [ ] `medicion_fotos` Supabase table
- [ ] `api/photo-url.js` — presigned PUT URL generator (auth-gated, lab role only)
- [ ] Photo upload + gallery display in `js/mediciones.js`
- [ ] Update `vercel.json` CSP: add R2 domain to `img-src` and `connect-src`
- [ ] Add `@aws-sdk/client-s3` to `package.json` (server-side only, for presigned URLs)
- [ ] Mobile responsive: thumbnail grid reflows, lightbox supports touch/swipe

---

## Grape Varieties
**Red (13):** Cabernet Sauvignon, Cabernet Franc, Merlot, Syrah, Nebbiolo, Tempranillo, Grenache, Mourvèdre, Durif, Malbec, Petit Verdot, Marselan, Caladoc

**White (4):** Chardonnay, Sauvignon Blanc, Viognier, Chenin Blanc

---

## Vineyard Origins & Appellations
Ranch-first format with valley abbreviation:

| Valley | Abbr | Ranches |
|--------|------|---------|
| Valle de Guadalupe | VDG | Monte Xanic, Olé, Siete Leguas, Rancho 14 |
| Valle de Ojos Negros | VON | Viña Alta, Ojos Negros, Dominio de las Abejas, Kompali |
| San Vicente | SV | Dubacano, Llano Colorado |

Appellation strings stored in DB (ranch-first format):
- `Monte Xanic (VDG)`, `Olé (VDG)`, `Siete Leguas (VDG)`, `Rancho 14 (VDG)`
- `Kompali (VON)`, `Viña Alta (VON)`, `Ojos Negros (VON)`, `Dominio de las Abejas (VON)`
- `Dubacano (SV)`, `Llano Colorado (SV)`
- `San Gerónimo` (wine only, no berry weather)
- `Camino Corazón (VP)` (external)

Sample code → ranch mapping: `MX`→Monte Xanic, `OLE`→Olé, `7L`→Siete Leguas, `R14`→Rancho 14, `K*`→Kompali, `VA`→Viña Alta, `ON`→Ojos Negros, `DA/DLA`→Dominio de las Abejas, `DUB`→Dubacano, `LLC`→Llano Colorado

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
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
SESSION_SECRET=your_hmac_session_secret
```
- `SUPABASE_SERVICE_KEY` — service role key (bypasses RLS), used by server-side API endpoints (`/api/upload`, `/api/login`, `/api/verify`, `/api/logout`)
- `SESSION_SECRET` — HMAC secret for signing session tokens
- Store in `.env.local` locally — never commit
- Add identical keys to Vercel → Settings → Environment Variables

---

## Agent Roles
- When acting as PLANNER/REVIEWER agent, NEVER edit source code directly. Only produce markdown documentation (PLAN.md, REVIEW.md, TASK.md). Only BUILDER agents edit code.
- Do not write to PLAN.md, TASK.md, or REVIEW.md unless explicitly asked. These are structured project docs managed by specific agent roles.

---

## Debugging Guidelines
- When debugging, always identify and fix the root cause before applying surface-level patches
- Check for: schema drift, missing DB columns, incorrect query filters, and CSP violations before assuming application logic bugs

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
- Always handle duplicate `(sample_id, sample_date)` / `report_code` gracefully (upsert, not duplicate)
- Skip EXP/EXPERIMENTO/NORMAL samples and California appellation on upload
- Normalize variety (`Petite Sirah` → `Durif`) and appellation (old format → ranch-first) on upload
- Show Spanish success message: "✓ X muestras agregadas correctamente"
- Show Spanish error message: "✗ Error al cargar datos. Verificar formato del archivo."

### Database Rules
- All Supabase queries go through `dataLoader.js`
- Never expose Supabase service key — anon key only in client code
- New data fields → add to both Supabase schema AND `config.js` column mappings
- `vintage_year` always extracted from batch code prefix (25 → 2025, 24 → 2024)

### Git Workflow
- Always push changes to remote after fixing bugs or completing features
- Do not tell the user something is fixed until `git push` succeeds

### Deployment
- Test locally with `npm start` before pushing
- Never commit `.env.local`
- Vercel environment variables must match `.env.local` keys exactly

---

## Data Scale
- Current rows: ~3,500 wine_samples (grows ~500–800 per vendimia)
- Supabase free tier: 500MB — sufficient for 5+ years
- WineXRay exports: typically 30–100 rows per batch upload
- Recepción Excel: typically 100–150 rows per vendimia season