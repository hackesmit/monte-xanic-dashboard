# Architecture

## Overview

Monte Xanic Dashboard is a single-page application for wine analytics. No frontend frameworks. All rendering is client-side vanilla JavaScript. Data lives in Supabase (PostgreSQL). Serverless API endpoints run on Vercel for authentication and protected data operations. Weather data is fetched from the Open-Meteo public API and cached in Supabase.

## Tech Stack

| Layer | Technology | Version/Source |
|-------|-----------|----------------|
| Frontend | Vanilla JavaScript (ES6) | No framework |
| Charts | Chart.js | 4.4.1 (CDN) |
| Data Parsing | SheetJS / XLSX | 0.18.5 (CDN) |
| Database | Supabase (PostgreSQL) | Hosted |
| Weather | Open-Meteo Archive API | Public, no key |
| Styling | Custom CSS + CSS variables | Dark/light themes |
| Fonts | Sackers Gothic Medium (local), Playfair Display + Jost (Google Fonts) | CDN |
| Hosting | Vercel | Auto-deploy on push |
| Auth | HMAC session tokens + bcryptjs | Server-side |
| PWA | manifest.json + icons | Standalone display |

## System Architecture

```
                           +-------------------+
                           |    Open-Meteo     |
                           | Archive API (free)|
                           +--------+----------+
                                    |
  +-------------+          +--------v----------+          +-----------------+
  |   Browser   |  HTTPS   |    Vercel Edge    |  REST    |    Supabase     |
  | (SPA + CDN) +--------->+  /api/login       +--------->+  PostgreSQL     |
  |             |          |  /api/verify      |          |                 |
  | index.html  |          |  /api/logout      |          | wine_samples    |
  | js/*.js     |          |  /api/config      |          | tank_receptions |
  | css/        |          |  /api/upload      |          | reception_lots  |
  +------+------+          +-------------------+          | prefermentativos|
         |                                                | meteorology     |
         | Supabase JS SDK (anon key)                     | mediciones_*    |
         +----------------------------------------------->+ rate_limits     |
                                                          | token_blacklist |
                                                          +-----------------+
```

## Data Flow

### Upload Flow (WineXRay CSV or Recepcion Excel)

```
File drop (browser)
  -> UploadManager detects type (.csv or .xlsx)
  -> SheetJS parses file
  -> Client normalizes: variety, appellation, below-detection values
  -> Client filters: lab samples, EXP, California
  -> Client assigns sample_seq for same-day duplicates
  -> POST /api/upload { table, rows }
  -> Server: verify token + role (lab/admin only)
  -> Server: validate table in allowlist, check row count
  -> Supabase REST API: INSERT with on_conflict (upsert)
  -> Client: reload data, refresh view
```

### Read Flow (page load)

```
Auth.init() -> POST /api/verify (check token)
  -> GET /api/config (fetch Supabase credentials)
  -> DataStore.initSupabase(url, anonKey)
  -> DataStore.loadFromSupabase()
     -> _fetchAll('wine_samples') in 1000-row pages
     -> Split into berryData + wineRecepcion by sample_type
     -> _fetchAll('prefermentativos') -> winePreferment
  -> DataStore.loadMediciones()
  -> WeatherStore.load() from meteorology table
  -> WeatherStore.sync() -> fill gaps from Open-Meteo API
  -> App.onDataLoaded() -> Filters.init() -> App.refresh()
```

### Render Cycle

```
User action (filter chip, view switch, etc.)
  -> App.refresh()
     -> Filters.getFiltered() applies state to DataStore.berryData
     -> switch(currentView):
        berry:      KPIs.update(), Charts.updateBerry(), Tables.updateBerry()
        wine:       KPIs.updateWine(), Charts.createWinePhenolics(), Tables.*
        extraction: Charts.createExtraction*()
        vintage:    Charts.createVintageComparison*(), harvest calendar, weather charts
        map:        MapStore.aggregateBySection(), MapStore.render()
        mediciones: Mediciones.refresh() (KPIs, table, charts)
        explorer:   Explorer.refreshAll()
```

### Auth Flow

```
Login form submit
  -> POST /api/login { username, password }
  -> Server: rate limit check (10/15min/IP, persistent in Supabase)
  -> Server: timing-safe compare username, bcrypt compare password
  -> Server: create HMAC-SHA256 token { exp: 2h, role, nonce }
  -> Client: store token + role in localStorage
  -> App.init()

Page reload
  -> POST /api/verify { token }
  -> Server: verify HMAC, check expiry, check blacklist
  -> If valid: continue. If not: show login.

Logout
  -> POST /api/logout { token }
  -> Server: verify HMAC (prevent forged spam), hash token, insert into blacklist
  -> Client: clear localStorage, show login
```

## Key Constraints

- No npm build step. All frontend code loads directly via `<script>` tags.
- CDN libraries only (Chart.js, SheetJS, Supabase JS SDK, jsPDF). No bundler.
- CSP enforced via vercel.json. No inline event handlers. All via `events.js` delegation.
- Two auth roles: `admin` and `lab`. Only lab/admin can upload data.
- Supabase service key is server-side only (api/ endpoints). Client uses anon key.
- All UI labels in Spanish. All units metric.
