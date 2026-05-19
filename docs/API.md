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

### api/lib/rateLimit.js

In-memory rate limiter for all authenticated endpoints.

- Key: `${url}:${ip}` (extracted from `x-real-ip` or first entry of `x-forwarded-for`)
- Default: 60 requests per 15 minutes
- Stale bucket eviction every 100 inserts
- Resets on Vercel cold start (acceptable for serverless)
- Returns 429 with Spanish error message when exceeded
