# Monte Xanic Dashboard -- Claude Code Instructions

Wine analytics dashboard. Vanilla JS single-page app, Chart.js, Supabase, Vercel serverless.
Full documentation in [`docs/`](docs/README.md). This file is for code agent conventions only.

## Project Conventions

- All UI labels in Spanish. Never translate to English.
- All units metric (C, g/L, mg/L, ppm, Bx).
- Every new feature must be mobile responsive.
- All CSS uses the design tokens. Never write a literal colour, radius, font
  size, font family or transition duration where a token exists. See
  [docs/Design-System.md](docs/Design-System.md); enforced by
  `tests/design-system.test.mjs`.
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
| `sinEnvero.js` | The "Sin envero" column of the días-post-envero charts: which readings lack an envero, where the column sits, its axis ticks. Pure, no DOM. |
| `utils.js` | Shared pure helpers (HTML escaping, etc.) — no DOM, no I/O, no imports |
| `demoMode.js` | In-memory demo-data overlay (no DB/cache writes while active) |
| `api/ping.js` | Daily Supabase keep-alive (Vercel cron, `CRON_SECRET`-gated). One read against `applied_migrations`. Nothing else. |
| `api/sweep-blacklist.js` | Daily `token_blacklist` cleanup (Vercel cron, `CRON_SECRET`-gated). Calls `public.token_blacklist_sweep` in bounded batches via `api/_lib/blacklistSweep.js`. Never called from logout or verify. |
| `mona/dataAccess.js` | Pure query/aggregate over row arrays. No DOM, no imports. |
| `mona/chartSpec.js` | Declarative chart/table spec validation + Chart.js rendering (themed). |
| `mona/toolDefs.js` | Mona tool schemas, the one copy. Pure data, no imports; `api/mona.js` sends these upstream. |
| `mona/tools.js` | Mona tool executors. Calls only public DataStore/KPIs APIs; DOM/app effects via ctx callbacks. |
| `mona/chat.js` | Conversation state + client-side agent loop (SSE parse, tool loop, persistence). |
| `mona/ui.js` | Mona tab + floating widget rendering, streaming, pin flow. |
| `mona/saved.js` | Guardados tab (saved views) + `saveView`. |
| `mona/knowledge.js` | Knowledge-base context assembly (pure) + Conocimiento panel. |
| `mona/index.js` | Mona facade: init, tool-effect wiring, view-change hook. |
| `api/mona.js` | Session-gated SSE proxy to Claude (`claude-sonnet-4-6`). The server owns the key, model, max_tokens, system prompt (plus approved knowledge) and tools; the client sends messages only. Aborts upstream on client disconnect. No business logic. |
| `api/_lib/monaUsage.js` | Mona's shared daily ceiling per user in `mona_uso`: reserve the worst case before the call, reconcile by id after (idempotent, retried), fail-closed; plus the SSE usage meter. |
| `api/mona-data.js` | Token-gated CRUD for `mona_*` tables (service key). Username/role from token, never body. |
| `tanques/estado.js` | Pure tank state: derive contents from the movement log, validate a movement. No DOM, no imports. |
| `tanques/plan.js` | Pure bodega-plan layout (where each vessel is drawn) and colour-token mapping. No DOM. |
| `tanques/view.js` | Tanques tab: SVG plan, colour modes, search, tank side panel. Read-only; no queries. |
| `tanques/moves.js` | Recording a movement: the drag/tap gestures, the move dialog, the undo toast, and the pure planner behind them (dialog defaults, volume ceiling, posted payload). The only write surface of the Tanques tab. |
| `api/datos.js` | Session-checked, read-only access to the confidential lab tables (service key): paged table reads and the upload preview's key probe. The anon key reads none of them. |
| `api/tanques.js` | Session/role gate over the tank catalog and the movement log (service key). Reads any session, writes role `lab`. Calls `tanques/estado.js`; restates no tank semantics. |

Do not add chart rendering to dataLoader.js. Do not add data queries to charts.js. Respect boundaries. Do not add scoring logic to maps.js or dataLoader.js. Do not query Supabase from classification.js. Do not call `DataStore.cacheData()` or Supabase from `demoMode.js`. Do not add any business logic, table reads, or session-token checks to `api/ping.js`. Do not add DOM access to `mona/tools.js`, `mona/dataAccess.js`, `tanques/estado.js` or `tanques/plan.js` (keep them Node-importable). `tanques/view.js` computes no geometry of its own: a position, a height or a colour comes from `tanques/plan.js`, and a litre count or a stage comes from `tanques/estado.js`. `tanques/view.js` stays read-only: every write control is drawn by `tanques/moves.js`, which `view.js` imports (never the other way round) and which draws nothing unless the user is role `lab`. `tanques/moves.js` restates no tank rule either: its client gate IS `validarMovimientoEnLog`, the same call `api/tanques.js` makes. Tank contents are DERIVED from `movimientos_tanque` by `tanques/estado.js`: never store a tank's current litres or lote as state, and never duplicate the derivation in the API or the UI. Do not put the Anthropic key or any business logic in the client; `api/mona.js` stays a thin stateless proxy. Never let the client supply the system prompt, the tools, the model or max_tokens to `api/mona.js`; `monaValidate.js` refuses them. Mona's spend limit is the `mona_uso` counter, never an in-memory per-instance map, and `api/mona.js` never calls Anthropic without a reservation from `mona_uso_reservar`. All `mona_*` table access goes through `api/mona-data.js` — never the anon key — with two server-side exceptions: `api/mona.js` reads approved `mona_knowledge` with the service key, and `api/_lib/monaUsage.js` calls the `mona_uso` RPCs. Client reads of `wine_samples`, `tank_receptions`, `reception_lots`, `prefermentativos`, `berry_samples`, `mediciones_tecnicas` and `harvest_target_overrides` go through `api/datos.js`, never the anon key. All `dim_tanque` / `dim_tanque_sinonimo` / `movimientos_tanque` access goes through `api/tanques.js`: never the anon key, and never a second copy of the derivation.

## Upload Pipeline Rules

- `.csv` = WineXRay, `.xlsx` = Recepcion de Tanque
- WineXRay: values `<50`, `<10` -> NULL with `below_detection = true`
- WineXRay: `-`, `—`, `NA`, `N/A` and blank -> NULL with NO flag. They mean empty,
  not measured. Decision 2026-10-26 (xd-2ae): WineXRay writes `-` in every blank
  cell, so flagging it would mark almost every row and hide the real
  detection-limit values. Pinned by `tests/mt13-upload-winexray.test.mjs`.
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

## Adding a SQL migration (Round 36 guardrail)

A code change that references a new column MUST ship with its migration applied. Three steps, no exceptions:

1. Create `sql/migration_<name>.sql`. End the file with:
   ```sql
   INSERT INTO public.applied_migrations (name) VALUES ('migration_<name>')
     ON CONFLICT (name) DO NOTHING;
   ```
2. Append the same `'migration_<name>'` to the `MIGRATIONS` array in `js/migrations-manifest.js`.
3. Run the file in **Supabase SQL Editor** before the dependent code reaches production.

The dashboard's migration banner (rendered for `lab`/`admin` users via `/api/migrations-status`) detects drift between the manifest and `public.applied_migrations` and names the missing file. If you see `Could not find the 'X' column ... in the schema cache`, a migration is unrun.

## Workflow

Developed in a single Claude Code console — one session plans, builds, tests, and ships. See [docs/Development-Rules.md](docs/Development-Rules.md).

- Design specs and implementation plans live under `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- The old planner/builder/reviewer split is retired; legacy `PLAN.md`/`TASK.md`/`REVIEW.md` are archived in `docs/archive/` and no longer drive work. Trust git history and the test suite.

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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Output discipline (Agent HQ)
- Never cat a log or dump raw command output. Filter first: head, tail, grep, or rg with context flags.
- JSON goes through jq, YAML through yq. Extract the fields you need, never paste raw payloads.
- Run test suites with quiet reporters and surface failures only (pytest -q, vitest --reporter=dot or equivalent).
- Read diffs, not files, when reviewing changes (git diff, git show). Open a full file only to edit it.
- Search before reading: rg / fd to locate, then read the minimal span.
- Long builds and installs: redirect to a file, report the exit code and the last 20 lines.
