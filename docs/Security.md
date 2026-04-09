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
2. **Verification:** `/api/verify` checks HMAC signature, expiry, and blacklist
3. **Usage:** Sent as `x-session-token` header on all authenticated requests
4. **Revocation:** `/api/logout` verifies HMAC, then inserts SHA256(token) into `token_blacklist`
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
- `SESSION_SECRET`: used only server-side for HMAC signing

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
- Token blacklist has no TTL cleanup (expired tokens accumulate in `token_blacklist` table)
- Rate limit on non-login endpoints is in-memory only (resets on cold start)
- No IP allowlist or geo-fencing
- No audit logging of data modifications
- Supabase RLS is not configured (service key bypasses RLS entirely)

## Recommended Future Hardening

- Add Supabase RLS policies for defense-in-depth
- Add TTL cleanup for `token_blacklist` (cron or Supabase function)
- Add audit logging for upload operations
- Consider moving from custom HMAC tokens to Supabase Auth
- Add rate limiting to login that persists across Vercel instances (already partially implemented via `rate_limits` table)
- Remove `'unsafe-inline'` from `style-src` if Chart.js supports nonce-based styling
