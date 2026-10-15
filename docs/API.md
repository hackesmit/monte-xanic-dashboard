# API Reference

All endpoints are Vercel serverless functions in `/api/`. All set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## POST /api/login

Authenticates a user and returns a session token.

**Auth:** None (public)
**Rate limit:** 10 requests per IP per 15 minutes (persistent in Supabase `rate_limits` table, fallback in-memory)

**Request:**
```json
{ "username": "string", "password": "string" }
```

**Success (200):**
```json
{ "ok": true, "token": "base64url_payload.base64url_signature" }
```

**Errors:**
- `401` - Invalid credentials (generic message, 300ms delay)
- `429` - Rate limit exceeded

**Implementation notes:**
- Two credential sets from env: `AUTH_USERNAME`/`AUTH_PASSWORD_HASH` (admin role) and `LAB_USERNAME`/`LAB_PASSWORD_HASH` (lab role)
- Timing-safe comparison for usernames
- bcryptjs for password verification
- Token payload: `{ exp: Date.now() + 2h, role: 'admin'|'lab', nonce: random }`
- Signed with HMAC-SHA256 using `SESSION_SECRET`

## POST /api/verify

Validates an existing session token.

**Auth:** Token in request body
**Rate limit:** 60 requests per IP per 15 minutes

**Request:**
```json
{ "token": "string" }
```

**Success (200):**
```json
{ "valid": true, "role": "admin" }
```

**Errors:**
- `401` - Invalid, expired, or revoked token
- `429` - Rate limit exceeded

**Implementation notes:**
- Verifies HMAC signature, checks expiry, checks `token_blacklist` table
- Uses shared `api/lib/verifyToken.js` module

## POST /api/logout

Revokes a session token by adding it to the blacklist.

**Auth:** Token verified via HMAC before blacklisting
**Rate limit:** 60 requests per IP per 15 minutes

**Request:**
```json
{ "token": "string" }
```

**Success (200):**
```json
{ "ok": true }
```

**Errors:**
- `400` - No token provided
- `401` - Invalid token (HMAC verification failed)
- `429` - Rate limit exceeded

**Implementation notes:**
- Verifies HMAC signature before blacklisting (prevents forged token spam)
- Stores SHA256 hash of token in `token_blacklist` table (never raw token)
- Blacklist insert failure is non-fatal (logged, returns 200)

## GET /api/config

Returns Supabase credentials for the frontend.

**Auth:** Token in `x-session-token` header. Auth verified BEFORE rate limit.
**Rate limit:** 60 requests per IP per 15 minutes (applied after auth)

**Success (200):**
```json
{
  "supabaseUrl": "https://xxx.supabase.co",
  "supabaseAnonKey": "eyJ..."
}
```

**Errors:**
- `401` - Invalid or missing token
- `429` - Rate limit exceeded
- `405` - Method not GET

**Implementation notes:**
- Auth check runs before rate limit (so unauthenticated requests do not consume rate budget)
- Returns `Cache-Control: private, no-store`

## POST /api/upload

Inserts data rows into a Supabase table (server-side, using service key).

**Auth:** Token in `x-session-token` header. Role must be `lab` or `admin`.
**Rate limit:** 30 requests per IP per 15 minutes

**Request:**
```json
{
  "table": "wine_samples",
  "rows": [ { "sample_id": "25CSMX-1", "sample_date": "2025-08-15", ... } ]
}
```

**Success (200):**
```json
{ "ok": true, "count": 42 }
```

**Errors:**
- `400` - Invalid table name or empty rows
- `403` - Insufficient role
- `429` - Rate limit exceeded
- `500` - Supabase insert error

**Allowed tables and constraints:**

| Table | Conflict columns (upsert) | Max rows/request |
|-------|--------------------------|------------------|
| `wine_samples` | `sample_id, sample_date, sample_seq` | 500 |
| `tank_receptions` | `report_code` | 200 |
| `reception_lots` | None (insert only) | 2000 |
| `prefermentativos` | `report_code, measurement_date` | 200 |
| `mediciones_tecnicas` | `medicion_code` | 200 |

**Implementation notes:**
- Table name is validated server-side against a hardcoded allowlist. Client cannot specify conflict columns.
- Uses Supabase REST API with `Prefer: resolution=merge-duplicates` for upsert behavior.
- Service key (`SUPABASE_SERVICE_KEY`) is used server-side only.

## GET /api/ping

Daily Supabase keep-alive endpoint. Vercel cron (declared in `vercel.json`) invokes this once a day so the free-tier Supabase project doesn't auto-pause after 7 idle days. Not intended for any other caller.

**Auth:** `Authorization: Bearer <CRON_SECRET>` header. Vercel injects this automatically on cron-triggered requests when `CRON_SECRET` is set as an env var.
**Rate limit:** None — the only legit caller is Vercel's own cron, and the auth gate fails closed without the secret.

**Success (200):**
```json
{ "ok": true, "pinged_at": "2026-05-19T12:00:00.123Z", "latency_ms": 142 }
```

**Errors:**
- `401` - Missing or wrong bearer token (also fires when `CRON_SECRET` env var is unset — fails closed)
- `405` - Method not GET
- `500` - Supabase env vars missing or PostgREST returned an error

**Implementation notes:**
- Runs a single `GET applied_migrations?select=name&limit=1` against PostgREST — minimal bytes, real schema-touching activity (which is what Supabase counts toward the inactivity timer).
- `pinged_at` anchors to request start (not response completion) for clean log correlation.
- Response body from Supabase is drained (`await resp.text()`) so the Node fetch runtime releases the stream deterministically.
- Logs `[ping] ok latency_ms=<n>` on success; `console.error` with status + body on failure. No secrets ever logged.
- Cron schedule: `0 12 * * *` (12:00 UTC daily). See `vercel.json` → `crons`.

## Shared Modules

### api/lib/verifyToken.js

Shared HMAC token verification used by verify, logout, config, and upload endpoints.

- Verifies HMAC-SHA256 signature using `SESSION_SECRET`
- Checks token expiry
- Optionally checks `token_blacklist` table (configurable via `checkBlacklist` param)
- Fail-open on blacklist fetch failure (availability over security)
- Returns `{ payload }` on success, `{ error, status }` on failure

## POST /api/mona

Proxies a chat turn to the Claude Messages API and streams the response back. Stateless — the client runs the agent loop and executes tools locally; this endpoint only forwards.

**Auth:** `x-session-token` (any valid session)
**Rate limit:** 20 messages per user per 5 minutes (in-memory per serverless instance)

**Request:**
```json
{ "messages": [ /* Anthropic-format messages */ ], "tools": [ /* tool schemas */ ], "system": "optional appended knowledge context" }
```

**Success (200):** `text/event-stream` — passes through Anthropic SSE (text deltas, `tool_use` blocks, `message_delta`).

**Errors:** `401` no/invalid token · `400` validation (empty/oversized/too many messages, see `api/lib/monaValidate.js`) · `429` rate limited · `500` missing `ANTHROPIC_API_KEY` · `502` upstream error.

**Implementation notes:**
- Model `claude-sonnet-4-6`, `max_tokens` 4096, `stream: true`.
- Server owns `BASE_SYSTEM` (personality, guardrails, house glossary); the client `system` string is appended as an extra system block, never replaces the base.
- `ANTHROPIC_API_KEY` is server-side only; CSP unchanged (same-origin `/api`).

## POST /api/mona-data

Token-gated CRUD for Mona's four server-only Supabase tables (service key). Username and role come from the verified token, never the request body.

**Auth:** `x-session-token`
**Request:** `{ "action": "...", ...args }`

**Actions:**
- Conversations: `listConversations`, `createConversation`, `renameConversation`, `deleteConversation`, `getMessages`, `appendMessage` (all scoped to the token's username)
- Saved views: `listSavedViews`, `saveView`, `renameView`, `deleteView` (username-scoped)
- Knowledge: `listKnowledge`, `proposeFact` (any user) · `addFact`, `approveFact`, `deleteFact` (**lab/admin only**, 403 otherwise)

**Errors:** `401` no/invalid token · `403` insufficient role for a knowledge write · `404` not owned · `400` unknown action · `500` persistence error.

### api/lib/monaValidate.js

Pure request validator for `/api/mona`. Enforces `messages` non-empty and ≤ 40 items, valid roles (`user`/`assistant`), per-message ≤ 40 KB, total body ≤ 150 KB.

### api/lib/rateLimit.js

In-memory rate limiter for all authenticated endpoints.

- Key: `${url}:${ip}` (extracted from `x-real-ip` or first entry of `x-forwarded-for`)
- Default: 60 requests per 15 minutes
- Stale bucket eviction every 100 inserts
- Resets on Vercel cold start (acceptable for serverless)
- Returns 429 with Spanish error message when exceeded

## /api/tanques

Token-gated access to the tank catalog and the movement log. `dim_tanque`,
`dim_tanque_sinonimo` and `movimientos_tanque` are server-only (RLS on with no
policies, and `sql/migration_tanques.sql` revokes the grants the public schema
hands `anon` and `authenticated`), so the client never reads or writes them with
the anon key.

**Auth:** `x-session-token`. Reads need any valid session; writes need role
`lab`, the same gate as `/api/row`.
**Rate limit:** 60 requests per 15 minutes per IP, shared by GET and POST.
**Cache:** `no-store`.

### GET /api/tanques

```json
{
  "ok": true,
  "tanques":     [ { "codigo": "A1", "fila": "A", "posicion": 1, "capacidad_l": 20000,
                     "tipo": "TQ", "area": "fermentacion", "activo": true, "orden": 1 } ],
  "sinonimos":   { "TIB13": "TIBOR 13" },
  "movimientos": [ { "id": 1, "fecha": "2025-09-01", "tipo": "recepcion", "origen": null,
                     "destino": "A1", "lot_code": "CS-01", "vintage_year": 2025,
                     "volumen_l": 10000, "merma_l": 0, "nota": null, "fuente": "manual",
                     "creado_por": "labuser", "anulado": false,
                     "created_at": "2025-09-01T18:00:00+00:00" } ]
}
```

- Returns the whole of all three tables, paged past the PostgREST 1000-row
  ceiling. A truncated log would derive the wrong tank contents.
- Inactive vessels (`activo: false`) are included: they keep their history even
  though the map does not draw them.
- Annulled movements are included, so the history panel can show them struck
  through. The replay in `js/tanques/estado.js` skips them.
- No derived state in the payload. Tank contents come from
  `deriveEstado(tanques, movimientos, { sinonimos })` on the caller's side; the
  endpoint never stores or returns a tank's current litres.

### POST /api/tanques - `{ "action": "crear", "movimiento": { ... } }`

Appends one movement. Allowed fields, and nothing else:

| Field | Required | Notes |
|-------|----------|-------|
| `fecha` | yes | business date `AAAA-MM-DD` |
| `tipo` | yes | `recepcion` `trasiego` `descube` `sangrado` `prensa` `ensamble` `salida` |
| `origen` | per type | tank code or synonym; stored canonical |
| `destino` | per type | tank code or synonym; stored canonical |
| `lot_code` | yes | the column is `NOT NULL` with a non-blank CHECK for every type |
| `vintage_year` | yes | integer 1988..2100 |
| `volumen_l` | yes | > 0; a JSON number, or a plain decimal string (`'5000.5'`; no hex, exponent, blanks or padding) |
| `merma_l` | no | defaults to 0; same number rule as `volumen_l` |
| `nota` | no | <= 2000 characters |
| `fuente` | no | `manual` (default) or `lab` for a confirmed inference |
| `client_id` | yes | UUID, one per user intent, reused when that intent is retried |

Text fields must be JSON strings: an array or an object is a `400`, never
`String()`-coerced into `'A1,A2'` or `'[object Object]'`.

- **Strict whitelist.** Any other key is a `400` naming the field, not a silent
  drop: `creado_por` in a body is a client signing someone else's work (it is
  always taken from the verified token), an explicit `id` desyncs the BIGSERIAL,
  `created_at` or a pre-set `anulado` backdates or pre-kills a row, and `etapa`
  is read by the pure module but the table has no such column (the stage is
  derived from the log).
- **Validation is at the row's place in the log**, via
  `validarMovimientoEnLog`: `fecha` is a business date, so a row written today
  can belong in the middle of the replay. A backdated withdrawal that fits the
  state of its own day but leaves next week overdrawn is refused. The candidate
  is validated with no `created_at`, which sorts it last among rows sharing its
  `fecha`, exactly where `NOW()` will put it.
- **Downstream severity gate, same as `anular`.** `validarMovimientoEnLog`
  only asks whether a later aviso is present, so it lets a row through when the
  later row was already inconsistent. The endpoint also replays the live log
  without and with the candidate and refuses with `400` if the candidate
  introduces or **deepens** a `sobregiro` or `desbordado` on another row: with
  10000 L into A1 on 01 Sep and a 15000 L salida on 20 Sep, a 4000 L salida on
  10 Sep takes the debt from 5000 L to 9000 L and is refused.
- Tank references resolve through `dim_tanque_sinonimo` and the canonical
  `codigo` is stored, because `origen` and `destino` are foreign keys to
  `dim_tanque(codigo)`.
- Synonym resolution is an exact lookup. The migration seeds every variant the
  lab actually writes (`TIB 16`, `TIB16`, `TIBOR16`); a new one is a one-line
  `INSERT`, not a normalization rule in code.
- The endpoint restates no tank semantics. Everything about what a movement
  does lives in `js/tanques/estado.js`, which is stricter than the table in one
  place: the schema permits a `trasiego`/`descube`/`sangrado`/`prensa`/`ensamble`
  with one end NULL (a press or a barrel is not a catalog vessel), the module
  requires both ends, so such a row cannot be created through this endpoint.

**Success (200):** `{ "ok": true, "movimiento": { /* inserted row */ } }`, plus
`duplicado: true` when this `client_id` was already written (the row returned
is the existing one, and nothing new was written).
**Errors:** `400` whitelist, field or validation failure (`error` is the first
Spanish reason, `errores` is all of them) · `401` no/invalid/revoked token ·
`403` not role `lab` · `409` the log kept changing for three attempts, nothing
written · `429` rate limited · `500` env vars missing · `502` PostgREST refused
the read or the write (definite: nothing written) · `503` with
`indeterminado: true`, the write may or may not have committed (see below).

### POST /api/tanques - `{ "action": "anular", "id": 123 }`

Marks one row `anulado = true`. Undo never deletes: the append-only trigger on
`movimientos_tanque` rejects `DELETE`, `TRUNCATE`, re-activation, and any UPDATE
that changes a column other than `anulado`, so `tanques_escribir` sets
`anulado = true` and nothing else.

- `id` must be a positive integer (a digit string is accepted).
- Already annulled is a `200` with `ya_anulado: true` and no write, so a double
  click does not read as a failure.
- **Gated, by severity and not by presence.** `js/tanques/estado.js` validates
  an appended row; an annulment is a removal, and taking out an early
  `recepcion` can leave every withdrawal after it overdrawn. The endpoint
  replays the live log with and without the row and refuses with `400` if
  removing it **introduces or deepens** a `sobregiro` or `desbordado` on a later
  movement. A warning the log already had, unchanged or smaller, is not blamed
  on the annulment: an inconsistency that exists is not permission to make it
  worse, which a plain "was this warning already there" diff would allow.
  Both severities come out of the replay's own numbers, so no tank rule is
  restated here: a `sobregiro` is clamped, so the litres owed are
  `volumen_l - movido_l`; a `desbordado` clamps nothing, so its severity is the
  litres standing in the destination right after that row, accumulated from the
  per-row deltas. Capacity is left out of that figure on purpose, because the
  two replays share one catalog and it cancels.

**Success (200):** `{ "ok": true, "movimiento": { /* updated row */ } }`
(plus `ya_anulado: true` when it was already annulled)
**Errors:** `400` bad id, or the annulment breaks a later movement · `401` ·
`403` not role `lab` · `404` no such movement · `409` the log kept changing ·
`502` PostgREST refused · `503` with `indeterminado: true`.

### Concurrent writes and lost acknowledgments

Decided on bead xd-qrn.8 (2026-10-15) and built by
`sql/migration_tanques_escritura.sql`, which must be applied before this code
reaches production:

- **Optimistic version check.** `public.tanques_version` holds one counter `v`,
  bumped by an `AFTER INSERT OR UPDATE` trigger on `movimientos_tanque` in the
  same transaction as the write. The endpoint reads `v` **before** the log,
  validates, and calls `POST /rest/v1/rpc/tanques_escribir` with that version
  (service key, server-side only). The function locks the version row
  `FOR UPDATE`, so two writes queue there; if `v` moved it returns `conflicto`
  without writing, and the endpoint re-reads, re-validates and tries again, up
  to three attempts in total, then answers `409`. Two simultaneous 6000 L
  withdrawals from a tank holding 10000 L: one lands, the other is re-judged
  against the log that now holds the first and is refused.
- **Idempotency key.** Every `crear` carries a `client_id` UUID, stored in a
  `UNIQUE` column that the append-only trigger freezes. A retry of a write that
  already committed returns the existing row with `duplicado: true`, whether the
  endpoint sees it in the log first or the function finds it.
- **Unknown outcome is not a refusal.** When the RPC fetch rejects, times out
  (8 s), answers 5xx or answers something unreadable, the write may have
  committed. The endpoint answers `503` with `indeterminado: true` and a Spanish
  message, never a plain error. A 4xx from the RPC is definite (the statement
  raised and rolled back) and stays a `502`.
- `tanques_escribir` is `SECURITY INVOKER` with `search_path = public`; EXECUTE
  is revoked from `PUBLIC`, `anon` and `authenticated`, and `tanques_version`
  has RLS on with no policies. It inserts only the whitelisted columns from its
  `p_fila`; `id`, `anulado` and `created_at` never come from outside.
- The derivation of tank contents stays in `js/tanques/estado.js`. The database
  only says "the log changed since you read it"; it judges nothing.

### Client

`js/dataLoader.js` owns the three calls: `loadTanques()` fills
`DataStore.tanquesCatalogo` / `tanquesSinonimos` / `movimientosTanque` and
returns a boolean; `postMovimiento(mov)` and `anularMovimiento(id)` write and
then re-read the log.

Three outcomes, kept apart on purpose, because collapsing them is what makes
someone press the button again and record a movement twice:

- **Written.** Resolves with `{ movimiento, actualizado }`. `actualizado: false`
  (with `DataStore.tanquesDesactualizado` set) means the movement is in the log
  and the screen is stale: report "registrado, no se pudo actualizar la vista"
  and offer a reload, not a retry.
- **Refused.** Throws with the server's Spanish reason, so a caller shows it
  instead of inventing one. Nothing was written and nothing is stale.
- **Unknown.** The request left and no readable answer came back, or the
  server answered `indeterminado: true`. The log is re-read first: if the write
  is visible there (the crear's `client_id`, or the row now annulled), it
  resolves as written with `reconciliado: true`. Otherwise it throws an error
  carrying `indeterminado: true` and, for a crear, `err.movimiento`: the same
  intent with its `client_id`. Retrying with `postMovimiento(err.movimiento)`
  is safe, because the server recognises the key instead of writing twice.
  `tanquesDesactualizado` is set only when the re-read failed too.

`postMovimiento(mov)` generates the `client_id` with `crypto.randomUUID()` when
`mov` has none, once per user intent, and keeps the one `mov` already carries.

`loadTanques()` carries a load generation, so a GET issued before a write that
resolves after that write's refresh replaces nothing and reports no success.
Without it the pre-write log would land on top of the fresh one and the view
would call itself current.
