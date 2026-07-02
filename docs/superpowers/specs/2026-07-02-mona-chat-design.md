# Mona — LLM Chat Assistant — Design Spec

**Date:** 2026-07-02
**Status:** Approved by Daniel (brainstorming session)
**Scope decisions:** Claude Sonnet 4.6 · read-only analyst + app control · all authenticated users · Supabase persistence · declarative chart specs · Mona-proposes/lab-approves knowledge base · saved views = Mona charts + tables

---

## 1. What we're building

Mona is an in-dashboard AI analyst for Monte Xanic. Users chat with her in Spanish; she queries the loaded wine data, computes aggregates/KPIs, renders charts and tables that look and behave exactly like the dashboard's native ones, drives the app (filters, view navigation), and accumulates an approved knowledge base of winery facts that makes her smarter over time.

Surfaces:

1. **Nav tab "Mona"** — full-page chat.
2. **Nav tab "Guardados"** — folder of user-saved Mona charts/tables, live-rendered.
3. **Floating widget** — Mona button on every other view that opens a compact chat panel. Same conversation state as the full tab (one store, two renderers — inherently synced).

## 2. Architecture

```
Browser                                     Vercel                   Anthropic
┌──────────────────────────────┐
│ js/mona/                     │
│  chat.js   — state + agent  ─┼─ POST /api/mona (SSE) ─► mona.js ─► Sonnet 4.6
│              loop            │   session-token gated,
│  tools.js  — executes tool   │   rate-limited,
│              calls against   │   ANTHROPIC_API_KEY
│              DataStore/KPIs  │   server-side only
│  chartSpec.js — validate +   │
│              render specs    │
│  ui.js     — tab + widget   ─┼─ POST /api/mona-data ─► Supabase (service key):
│  knowledge.js — KB panel    ─┼─   (CRUD, token-gated)   mona_conversations,
└──────────────────────────────┘                          mona_messages,
                                                          mona_saved_views,
                                                          mona_knowledge
```

**Client-driven agent loop.** The wine data already lives in `DataStore` (browser memory), so tools execute locally: instant, zero extra DB load, and they inherit `config.js` normalization, active filters, and demo mode for free. `/api/mona` is a thin stateless proxy: it validates the session token, injects the server-side system prompt, forwards the conversation + tool definitions to the Anthropic Messages API, and streams the response back as SSE. When Claude emits `tool_use` blocks, the client executes them, appends `tool_result` blocks, and re-POSTs. Loop cap: 8 tool rounds per user message.

**Why not server-side queries:** normalization (variety/appellation mapping) lives in client `config.js`; duplicating it server-side violates the file-responsibility rules and ignores demo mode.

## 3. Backend

### 3.1 `/api/mona.js` — LLM proxy

- **Auth:** session token via `api/lib/verifyToken.js`. 401 without it.
- **Rate limit:** per-user (username from token), ~20 messages / 5 min, reusing the `rate_limits` table pattern from `api/lib/rateLimit.js`.
- **Request:** `{ messages: [...], context: { view, filters, dataSummary, knowledgeFacts } }`. Server prepends its own system prompt; client context is appended to it as a clearly-delimited data block (never as system-level instructions).
- **Model:** `claude-sonnet-4-6`, `max_tokens` ≈ 4096.
- **Response:** SSE stream (`text/event-stream`) passing through Anthropic streaming events (text deltas, tool_use blocks, message_stop). `/api` is same-origin so no CSP change is needed.
- **System prompt (server-side):** Mona's personality (Spanish, warm-professional, winemaking-literate, metric units), the dataset field dictionary, tool usage guidance, and the chart-spec schema documentation.
- **Guardrails:** request body size cap (~150 KB), messages array length cap, per-message content size cap.

### 3.2 `/api/mona-data.js` — persistence CRUD

All mona tables are **server-only** (RLS enabled, no anon policies), consistent with the June `migration_rls_lockdown` audit — chat history is private per-user and must not be readable with the anon key. This endpoint (session-token gated, service key) multiplexes on an `action` field:

- `listConversations` / `createConversation` / `renameConversation` / `deleteConversation` — scoped to the token's username
- `getMessages` / `appendMessage`
- `listSavedViews` / `saveView` / `renameView` / `deleteView` — scoped to username
- `listKnowledge` (all users — approved facts feed context) / `proposeFact` (any user or Mona) / `approveFact` / `addFact` / `deleteFact` (lab/admin only, role from token)

Function count check: this brings `api/` to 10 functions, within Vercel hobby's 12.

## 4. Mona's tools

| Tool | Behavior |
|---|---|
| `query_data` | Filter/project rows from `berry`, `wine`, `preferment`, or `mediciones` datasets. Filters: equality, ranges, date ranges, lists. Result capped (~200 rows / 30 KB) with a truncation notice so Mona aggregates instead of dumping. |
| `aggregate_data` | Group-by (variety, ranch/appellation, vintage, lot, date bucket) + metrics (avg/min/max/sum/count) over any numeric field. The workhorse for charts. |
| `compute_kpis` | Runs `kpis.js` calculations over a filtered subset. |
| `render_chart` | Takes a chart spec (§5). Client validates + renders inline in chat; returns ok/validation-error to Mona. |
| `render_table` | Same for tables: `{ title, columns: [{key,label,unit?}], rows }`, row-capped. |
| `apply_filters` | Applies supported filter state via `filters.js` public API. Returns resulting counts. |
| `set_view` | Navigates via `App.setView` to a named view. |
| `propose_fact` | Submits a fact to `mona_knowledge` as `pending`. Mona is prompted to propose sparingly and only user-confirmed insights. |

Tool implementations live in `js/mona/tools.js` and call **only** public APIs of `DataStore`, `KPIs`, `Filters`, `App` — no direct Supabase access (that stays in `dataLoader.js`; mona persistence calls go through `/api/mona-data`).

## 5. Chart spec (declarative)

Mona emits JSON with **inline data** (she already computed it via `aggregate_data`):

```json
{
  "type": "line | bar | stackedBar | scatter | pie | area",
  "title": "Evolución de °Bx — Cabernet Sauvignon 2025",
  "xLabel": "Días post-molienda",
  "yLabel": "°Bx",
  "series": [
    { "label": "Viña Grande", "points": [{ "x": 0, "y": 24.1 }, ...] }
  ],
  "options": { "yMin": 0, "showPoints": true }
}
```

`js/mona/chartSpec.js`:

- **Validates** hard: allowed types only, series count ≤ 12, points per series ≤ 500, string length caps, numeric coercion, no passthrough of arbitrary Chart.js options. Invalid → descriptive error returned as `tool_result` so Mona self-corrects.
- **Renders** through Chart.js with the dashboard's theming: CSS-variable palette (same approach as `Charts._getThemeColor`), fonts, tooltip styles, legend toggles, responsive sizing. Mona's charts are visually and interactively indistinguishable from native ones.
- Rendering registers instances for cleanup on view switch (mirroring `Charts.instances` / `destroy`).
- The same module renders specs in chat, in the widget, and in Guardados.

Every rendered chart/table shows a **"Guardar"** pin action → title prompt → `saveView`.

## 6. Persistence (Supabase)

Two migration files (Round-36 guardrail: `applied_migrations` insert at end of each, names appended to `MIGRATIONS` in `js/migrations-manifest.js`, run in SQL Editor before deploy):

**`migration_mona_chat`:**
- `mona_conversations` — id uuid PK, username text, title text, created_at, updated_at
- `mona_messages` — id uuid PK, conversation_id FK (cascade delete), role text, content jsonb (full Anthropic content blocks incl. tool_use/tool_result and rendered specs), created_at

**`migration_mona_views_knowledge`:**
- `mona_saved_views` — id uuid PK, username text, title text, view_type text (`chart|table`), spec jsonb, created_at
- `mona_knowledge` — id uuid PK, fact text, status text (`pending|approved`), proposed_by text, created_at, approved_by text null

All four: RLS enabled, **no anon policies** (server-only via `/api/mona-data`).

**Knowledge lifecycle:** approved facts are fetched at chat init and injected into Mona's context (the "gets smarter" loop). Lab/admin manage them in a "Conocimiento" panel: pending proposals with approve/reject, manual add, delete. Fact count/size soft-capped (~100 facts) with UI warning.

## 7. UI

**Mona tab (`view-mona`):**
- Message list with streaming text, user/Mona bubbles, timestamp grouping.
- Inline charts (canvas) and tables inside Mona bubbles, with pin action.
- Tool-activity chips while working ("Consultando datos…", "Generando gráfica…") and a typing indicator.
- Conversation sidebar (list, new, rename, delete) — collapsible drawer on mobile.
- "Conocimiento" panel button (lab/admin only).
- Input: textarea with Enter-to-send / Shift+Enter newline, disabled while streaming, retry button on error.
- Animations: message fade/slide-in, smooth scroll-to-bottom, chart fade-in on render. CSS transitions only.

**Guardados tab (`view-guardados`):**
- Responsive card grid; each card live-renders its spec (chart or table) with title, date, rename/delete/expand (modal via `modalHygiene.js` patterns).
- Empty state in Spanish.

**Floating widget:**
- Circular Mona button, bottom-right, on all views except Mona/Guardados. Scale/fade micro-animation on open into a compact panel (~380×520 px desktop; near-fullscreen sheet on mobile).
- Renders the **same active conversation** from the same store — messages sent in the widget appear in the full tab and vice versa (same page, single source of truth).
- "Expandir" button switches to the Mona tab preserving scroll position to the latest message.
- Charts render in the widget at compact size; pin works there too.

**Conventions:** all labels Spanish, metric units, event delegation through `events.js` (no inline handlers), mobile responsive throughout.

## 8. Access & security

- Mona visible to **all authenticated users** (any valid session token). Logged-out users don't see the tabs or widget (matching existing auth gating).
- Knowledge management restricted to lab/admin (UI-hidden AND server-enforced via token role).
- `ANTHROPIC_API_KEY` — Vercel env var only, never client-side. Add to `.env.local` for `vercel dev`; document in `docs/Operations.md`.
- Rate limiting per username; friendly Spanish message when exceeded.
- Tool result and request size caps (§3.1, §4) bound token costs. Sonnet 4.6 ≈ <$0.01 per typical exchange.
- Client context block is delimited as data in the prompt; system instructions live server-side only.

## 9. Error handling

- Network/API failure → Spanish inline error bubble + "Reintentar" (retries last user message).
- Tool execution exception → caught, returned to Mona as an error `tool_result` (she adapts or apologizes).
- Invalid chart/table spec → validation error back to Mona; after 2 failed attempts she falls back to a text answer.
- Persistence failure (history save) → chat continues in-memory; non-blocking Spanish warning toast.
- Stream interrupted → partial message kept, marked, retry offered.

## 10. Testing

- **Unit (`node --test`, `tests/*.test.mjs`):** chart-spec validator (valid/invalid/caps/coercion), `aggregate_data` correctness (group-by, metrics, filters), `query_data` filtering + caps, table spec validation, message serialization round-trip, knowledge context assembly.
- **API:** `/api/mona` auth rejection, rate limit, body caps; `/api/mona-data` action routing + role enforcement (mocked Supabase fetch, following existing api test patterns if present; otherwise unit-test extracted pure helpers).
- **Playwright smoke:** open Mona tab, send message with mocked SSE response, assert streamed text renders; mocked tool round renders a chart; pin → appears in Guardados; widget opens and shows same conversation.

## 11. Build phases (single feature branch, incremental commits)

1. **Backend + core chat** — `/api/mona` proxy (auth/rate-limit/SSE), `js/mona/chat.js` + `ui.js` (tab, streaming, loop), `query_data`/`aggregate_data`/`compute_kpis` tools, `migration_mona_chat` + history persistence via `/api/mona-data`.
2. **Charts/tables + Guardados** — `chartSpec.js` validator+renderer, `render_chart`/`render_table` tools, pin flow, `migration_mona_views_knowledge` (views half), Guardados tab.
3. **Widget + polish** — floating widget, shared-store dual rendering, animations, mobile passes.
4. **Knowledge base + app control** — Conocimiento panel, `propose_fact` + approval flow, context injection, `apply_filters`/`set_view` tools.

Each phase lands with its tests green (`npm test`) before the next begins.

## 12. Out of scope (v1)

- Write actions on wine data (edits, uploads, predictions) — explicitly deferred.
- Weather tool, Opus escalation toggle, voice input, proactive notifications.
- Cross-user shared saved views.
