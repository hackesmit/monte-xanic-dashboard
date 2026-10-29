# Security

## Authentication Model

**Approach:** Custom HMAC-signed session tokens. No third-party auth provider.

**Token format:** `base64url(payload).base64url(hmac_signature)`
- Payload: `{ exp, role, nonce }`
- Signature: HMAC-SHA256 using `SESSION_SECRET` environment variable
- Expiry: 2 hours from creation
- Storage: `localStorage` on client

**Roles:**
- `admin` - Full access (credentials: `AUTH_USERNAME` / `AUTH_PASSWORD_HASH`)
- `lab` - Upload access (credentials: `LAB_USERNAME` / `LAB_PASSWORD_HASH`)
- `viewer` - Read-only fallback (default if role extraction fails)

**Password storage:** bcrypt hashes stored as environment variables. Compared with `bcryptjs.compare()`.

## Token Lifecycle

1. **Creation:** `/api/login` creates token after bcrypt password verification
2. **Verification:** `/api/verify` checks HMAC signature, expiry, and blacklist. The blacklist check fails closed: if `token_blacklist` cannot be read (non-2xx, network error, no complete answer within `TOKEN_BLACKLIST_TIMEOUT_MS`, default 3000 ms, missing Supabase config) every gated endpoint answers 503, never "not revoked".
3. **Usage:** Sent as `x-session-token` header on all authenticated requests
4. **Revocation:** `/api/logout` verifies HMAC, then inserts SHA256(token) into `token_blacklist`. Old rows are deleted by the daily `/api/sweep-blacklist` cron (rows older than 3 h: token life plus 1 h clock-skew margin), never on the logout or verify path
5. **Expiry:** Tokens auto-expire after 2 hours. No refresh mechanism.

## Rate Limiting

**Login endpoint:** 10 attempts per IP per 15 minutes
- Primary: Persistent in Supabase `rate_limits` table
- Fallback: In-memory Map (for local dev or Supabase unavailability)
- Failed attempts include 300ms artificial delay

**All other authenticated endpoints:** 60 requests per IP per 15 minutes
- In-memory only (resets on Vercel cold start)
- Stale bucket eviction every 100 inserts
- Key format: `${url}:${ip}`

**IP extraction:** `x-real-ip` header, then first entry of `x-forwarded-for`, then `'unknown'`

## Server-Side Protections

**Upload gating:**
- Token + role validation before any data insertion
- Table name validated against server-side allowlist (client cannot specify arbitrary tables)
- Conflict columns defined server-side only
- Row count limits per table (500 for wine_samples, 200 for others)

**Key separation:**
- `SUPABASE_SERVICE_KEY` (bypasses RLS): used only in `/api/*` server functions
- `SUPABASE_ANON_KEY`: used by frontend Supabase JS SDK
- The anon key reads none of the confidential lab tables (`wine_samples`, `tank_receptions`, `reception_lots`, `prefermentativos`, `berry_samples`, `mediciones_tecnicas`, `harvest_target_overrides`): RLS on, no policies, grants revoked (`migration_lectura_por_sesion`). The dashboard reads them through `/api/datos`, which checks the session and the blacklist on every request, so a revoked or expired session stops reading at once (xd-0lt.1).
- `SESSION_SECRET`: used only server-side for HMAC signing
- `CRON_SECRET`: used only server-side to gate `/api/ping` against non-Vercel callers; rotate by replacing in Vercel env vars and redeploying — old value stops working immediately
- `ANTHROPIC_API_KEY`: used only server-side in `/api/mona`; never sent to the client

**Mona (AI assistant):**
- `/api/mona` and `/api/mona-data` are session-token gated; the Anthropic key stays server-side and the CSP is unchanged (all traffic is same-origin `/api/*`).
- The `mona_*` tables are server-only: RLS enabled with **no anon policies**, so chat history / saved views / knowledge are unreachable with the anon key — all access is through `/api/mona-data` (service key), scoped to the token's username. Knowledge writes (`addFact`/`approveFact`/`deleteFact`) additionally require the `lab`/`admin` role, enforced server-side.
- Prompt-injection resistance is part of Mona's server-side system prompt (never reveal instructions/keys, refuse rule-override attempts). The server owns the whole request shape: the system prompt (base prompt plus the approved `mona_knowledge` facts, read server-side), the tool list (`js/mona/toolDefs.js`), the model and `max_tokens`. A request that carries `system`, `tools`, `tool_choice`, `model` or `max_tokens` is a 400, and message content is limited to `text`, `tool_use` and `tool_result` blocks, all of them text: a `tool_result` carries a string or text blocks, never an image or a document (xd-aiz).
- Spend is bounded by a shared per-user daily ceiling in `public.mona_uso` (requests and tokens, `MONA_MAX_PETICIONES_DIA` default 300, `MONA_MAX_TOKENS_DIA` default 3,000,000; day in America/Tijuana). Every Vercel instance reads the same counter, and it fails closed (503) when it cannot answer. Before calling Anthropic each request reserves its worst case (an input bound from the body's byte length, plus `max_tokens`) in `mona_uso_reserva`, and open reservations count against the cap, so requests in flight cannot all slip under it. When the call ends the reservation is reconciled by id (idempotent, retried): a finished stream is charged what Anthropic reported, a cut one the most it could have generated. A reconciliation that never lands leaves the reservation held for that day, so a lost write over-charges, never under-charges (migration_mona_uso_reserva, xd-aiz r2). The provider-side backstop is the workspace spend limit in the Anthropic console.
- When the browser disconnects, `/api/mona` aborts the Anthropic request, so a closed tab stops generating. The listener is attached before the first await, and the handler checks for a gone client after each await, so a tab closed during the token check, the knowledge read or the reservation never reaches Anthropic. Request body and message size caps bound input tokens.

**Cron endpoints (`/api/ping`, `/api/sweep-blacklist`):**
- Auth model differs from the session-token endpoints. The only legit caller is Vercel's own cron scheduler, which injects `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set. No session token, no role check.
- Fails closed: if `CRON_SECRET` is unset, every request returns `401` (including Vercel's own cron). This prevents an unprovisioned deploy from accidentally exposing an open keep-alive endpoint.
- `/api/ping` runs one fixed read (`applied_migrations limit=1`); no user input is forwarded to Supabase, so the endpoint can't be repurposed as a DB read amplifier even if the secret leaks.
- `/api/sweep-blacklist` forwards no input either. The 3 h window is fixed inside `public.token_blacklist_sweep`, so even a leaked secret cannot delete a revocation whose token could still be alive.

## Content Security Policy

Defined in `vercel.json`:

```
default-src 'self'
script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src 'self' https://fonts.gstatic.com
img-src 'self' data:
connect-src 'self' https://*.supabase.co https://archive-api.open-meteo.com
object-src 'none'
base-uri 'self'
frame-ancestors 'none'
```

**Other headers:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

**Inline handler compliance:** Zero inline `onclick`/`onchange` attributes. All events bound via `events.js` delegation.

## XSS Protections

- Table rendering uses `textContent`-based escaping (creates DOM element, sets textContent, reads innerHTML)
- User-provided strings are escaped before insertion into table cells
- No `innerHTML` assignment with unsanitized user data

## Known Limitations

- `style-src` includes `'unsafe-inline'` (required for Chart.js and dynamic styling)
- No CSRF protection (stateless token auth mitigates most CSRF vectors)
- Rate limit on non-login endpoints is in-memory only (resets on cold start)
- No IP allowlist or geo-fencing
- No audit logging of data modifications
- Supabase RLS is not configured (service key bypasses RLS entirely)

## Recommended Future Hardening

- Add Supabase RLS policies for defense-in-depth
- Add audit logging for upload operations
- Consider moving from custom HMAC tokens to Supabase Auth
- Add rate limiting to login that persists across Vercel instances (already partially implemented via `rate_limits` table)
- Remove `'unsafe-inline'` from `style-src` if Chart.js supports nonce-based styling
