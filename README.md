# Monte Xanic Dashboard

Wine analytics dashboard for Monte Xanic winery. Tracks berry chemistry (Brix, pH, tANT, TA), wine phenolics, extraction rates, vintage comparisons, and field measurements across 17 grape varieties and 12 vineyard origins in Baja California, Mexico.

## Core Capabilities

- **Berry Analytics:** Scatter plots, KPIs, and evolution charts for Brix, pH, tANT, TA, berry weight vs days post-crush
- **Wine Phenolics:** Tank reception tables, pre-fermentation data, grouped phenolic comparisons by variety
- **Extraction Analysis:** Berry-to-wine anthocyanin transfer rates with quality-band color coding
- **Vintage Comparison:** Multi-vintage scatter overlays with 5-day-bin trend lines and weather overlays
- **Vineyard Map:** SVG map with color-coded quality metrics per vineyard section
- **Weather Integration:** Valley-specific temperature, rainfall, and GDD charts (VDG, VON, SV)
- **Mediciones Tecnicas:** Manual entry form for field measurements (tonnage, berry weight, 200-berry health sort)
- **Data Upload:** Drag-and-drop WineXRay CSV and Recepcion de Tanque Excel with validation and upsert
- **Export:** PNG and PDF chart export

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES6), no framework |
| Charts | Chart.js 4.4.1 (CDN) |
| Data Parsing | SheetJS 0.18.5 (CDN) |
| Database | Supabase (PostgreSQL) |
| Weather | Open-Meteo Archive API |
| Hosting | Vercel (auto-deploy) |
| Auth | HMAC session tokens + bcryptjs |

## Project Structure

```
index.html              Single-page app
js/                     Frontend modules (14 files)
  app.js                App lifecycle, routing, refresh
  auth.js               Login/logout, token management
  config.js             Colors, mappings, normalization
  dataLoader.js         Supabase queries, data transformation
  filters.js            Filter state, chip UI
  charts.js             All Chart.js rendering
  tables.js             Table rendering, sorting
  kpis.js               KPI calculations
  weather.js            Open-Meteo API, meteorology cache
  upload.js             File parsing, server upload
  mediciones.js         Mediciones form, table, charts
  maps.js               SVG vineyard map
  explorer.js           Dynamic chart builder
  events.js             Event delegation (CSP-safe)
api/                    Vercel serverless functions
  login.js              Authentication
  verify.js             Token validation
  logout.js             Token revocation
  config.js             Supabase credentials (auth-gated)
  upload.js             Data insertion (auth-gated)
  lib/verifyToken.js    Shared HMAC verification
  lib/rateLimit.js      In-memory rate limiter
css/styles.css          All styling, dark/light themes
sql/                    Database migrations
tests/                  Unit tests (47 tests, 5 suites)
docs/                   Detailed documentation
```

## Quick Start

```bash
npm install
npm start              # http://localhost:8080 (static only)
npx vercel dev         # With API endpoints (requires .env.local)
npm test               # Run unit tests
```

## Environment Variables

Create `.env.local` with:
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
SESSION_SECRET=...
AUTH_USERNAME=...
AUTH_PASSWORD_HASH=...
LAB_USERNAME=...
LAB_PASSWORD_HASH=...
```

See [docs/Operations.md](docs/Operations.md) for full setup instructions.

## Documentation

Detailed docs are in [`docs/`](docs/README.md):

| Doc | Content |
|-----|---------|
| [Architecture](docs/Architecture.md) | System design, data flows, auth flow |
| [Frontend Architecture](docs/Frontend-Architecture.md) | Module responsibilities, state ownership |
| [Database](docs/Database.md) | All table schemas with types and constraints |
| [API](docs/API.md) | Endpoint contracts, request/response shapes |
| [Data Dictionary](docs/Data-Dictionary.md) | Chemistry terms, units, naming conventions |
| [Data Validation](docs/Data-Validation.md) | Upload parsing, normalization, filtering rules |
| [Security](docs/Security.md) | Auth model, CSP, rate limiting, known limitations |
| [Operations](docs/Operations.md) | Setup, deployment, environment variables |
| [Test Coverage](docs/Test-Coverage.md) | Test suite details and coverage gaps |
| [Domain Model](docs/Domain-Model.md) | Entity relationships, identifier formats |
| [Roadmap](docs/Roadmap.md) | Completed phases, deferred work, future improvements |
| [Agent Rules](docs/AGENT_RULES.md) | Planner/builder/reviewer workflow rules |

## Status

All planned phases (1-7) are complete. See [docs/Roadmap.md](docs/Roadmap.md) for details.
