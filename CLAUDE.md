# Monte Xanic Dashboard -- Claude Code Instructions

Wine analytics dashboard. Vanilla JS single-page app, Chart.js, Supabase, Vercel serverless.
Full documentation in [`docs/`](docs/README.md). This file is for code agent conventions only.

## Project Conventions

- All UI labels in Spanish. Never translate to English.
- All units metric (C, g/L, mg/L, ppm, Bx).
- Every new feature must be mobile responsive.
- Vite build. Dependencies managed via npm.
- No frameworks. Vanilla JS ES modules only.
- Run `npm run dev` for local development.
- Maintain Chart.js and SheetJS compatibility.

## File Responsibilities

| File | Owns |
|------|------|
| `kpis.js` | KPI calculations only |
| `charts.js` | Chart.js rendering only |
| `filters.js` | Filter state and chip UI only |
| `dataLoader.js` | All Supabase queries |
| `weather.js` | Open-Meteo API and meteorology cache |
| `upload.js` | File parsing and server upload pipeline |
| `config.js` | Colors, column mappings, normalization |
| `mediciones.js` | Mediciones form, table, and charts |
| `tables.js` | Table rendering and sorting |
| `events.js` | Event delegation (CSP-safe, no inline handlers) |
| `app.js` | View routing, refresh orchestration, init |
| `maps.js` | SVG vineyard map |
| `classification.js` | Quality rubric scoring and percentile only |
| `demoMode.js` | In-memory demo-data overlay (no DB/cache writes while active) |

Do not add chart rendering to dataLoader.js. Do not add data queries to charts.js. Respect boundaries. Do not add scoring logic to maps.js or dataLoader.js. Do not query Supabase from classification.js. Do not call `DataStore.cacheData()` or Supabase from `demoMode.js`.

## Upload Pipeline Rules

- `.csv` = WineXRay, `.xlsx` = Recepcion de Tanque
- WineXRay: values `<50`, `<10`, `-`, `NA` -> NULL with `below_detection = true`
- WineXRay: skip Control Wine, EXP/EXPERIMENTO/NORMAL, California, lab tests
- Recepcion: read BOTH sheets (Recepcion + Prefermentativos)
- Recepcion: split up to 4 lot columns into `reception_lots` rows
- Normalize `Petite Sirah` -> `Durif`, old appellations -> ranch-first format
- Upsert on `(sample_id, sample_date, sample_seq)` for wine_samples
- Spanish success/error messages

## Database Rules

- All Supabase queries go through `dataLoader.js`
- Never expose `SUPABASE_SERVICE_KEY` in client code. Anon key only.
- New fields -> add to both Supabase schema AND `config.js` column mappings
- `vintage_year` extracted from batch code prefix (25 -> 2025)

## Agent Roles

See [docs/AGENT_RULES.md](docs/AGENT_RULES.md) for full rules.

- **Planner/Reviewer:** NEVER edit source code. Only produce markdown (PLAN.md, REVIEW.md, TASK.md).
- **Builder:** Only role that edits source code.
- Do not write to PLAN.md, TASK.md, or REVIEW.md unless explicitly asked.

## Debugging Guidelines

- Identify root cause before patching. Do not apply surface-level fixes.
- Check first: schema drift, missing DB columns, incorrect query filters, CSP violations.
- Before writing fix code: read the error, trace root cause, list 2-3 possible causes ranked by likelihood. Wait for user confirmation.

## Git Workflow

- Always push changes to remote after fixing bugs or completing features.
- Do not tell the user something is fixed until `git push` succeeds.

## Completion Checklist

Before telling the user work is done:
1. Run the relevant tests and show output
2. Verify the fix by testing the actual user flow and show output
3. `git push` and show output

All three must succeed with output shown.

## Feature Implementation Workflow

1. Create a feature branch
2. Implement backend changes with tests
3. Implement frontend changes
4. Run full test suite, fix any failures
5. Commit with a descriptive message
6. Push and create a PR
7. Final summary: what shipped, known limitations

Verify each step before proceeding. If any step fails, diagnose and fix before moving on.

## Deployment

- Test locally with `npm start` before pushing
- Never commit `.env.local`
- Vercel environment variables must match `.env.local` keys exactly
- See [docs/Operations.md](docs/Operations.md) for full setup
