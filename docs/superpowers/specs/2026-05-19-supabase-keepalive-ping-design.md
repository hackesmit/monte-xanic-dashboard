# Supabase Keep-Alive Ping — Design

**Date:** 2026-05-19
**Branch:** `feat/supabase-keepalive-ping` (to be created)
**Status:** Design approved; awaiting spec review before implementation plan.

## Goal

Prevent Supabase from auto-pausing the project after 7 days of database inactivity. Free-tier Supabase counts inactivity by database queries, not website traffic, so a scheduled ping must hit the DB — not just the frontend.

## Constraints (binding)

- Vercel Hobby (free) tier — cron is supported but limited to daily granularity. One daily ping is sufficient (~6 days of headroom vs. the 7-day pause).
- No new dependencies. Reuse the existing serverless function pattern in `api/` (Node ESM, `@supabase/supabase-js` already installed).
- No client-side changes — this is a server-only background task.
- Service key stays server-side only, per `CLAUDE.md` ("Never expose `SUPABASE_SERVICE_KEY` in client code. Anon key only.").
- Endpoint must not be a free abuse vector — restrict to Vercel-cron-triggered invocations via `CRON_SECRET`.

## Architecture

### New file: `api/ping.js`

A single Vercel serverless function. On GET:

1. Verify the request carries `Authorization: Bearer <CRON_SECRET>`. If the env var `CRON_SECRET` is unset or the header doesn't match, return `401`.
2. Connect to Supabase with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (the same env vars `api/migrations-status.js` already uses).
3. Run one lightweight read via the `@supabase/supabase-js` client:
   ```js
   await supabase.from('applied_migrations').select('name', { count: 'exact', head: true });
   ```
   This issues a HEAD request that returns no rows but forces PostgREST to query the table for an exact count — minimal bytes over the wire, real schema-touching activity on the DB side.
4. Measure round-trip latency and respond:
   - Success: `200 { ok: true, pinged_at: <iso>, latency_ms: <int> }`
   - Failure: `500 { ok: false, error: <message> }`
5. Set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on the response, matching existing API conventions.

**Why `applied_migrations`:** Tiny table that already exists in every deployed Supabase project for this app (per the Round 36 migration guardrail in `CLAUDE.md`). Harmless to read, low row count, and a real schema-aware query — not just a TCP handshake — which is what Supabase counts as activity.

### Edit: `vercel.json`

Add a top-level `crons` array:

```json
"crons": [
  { "path": "/api/ping", "schedule": "0 12 * * *" }
]
```

`0 12 * * *` = daily at 12:00 UTC (~07:00 Mexico City). Time of day is arbitrary; midday UTC keeps it well away from any deploy windows and is easy to remember.

### Environment variable: `CRON_SECRET`

Set in Vercel project settings (Production environment). Any high-entropy random string (suggest `openssl rand -hex 32`). Vercel automatically injects `Authorization: Bearer <CRON_SECRET>` into cron-triggered requests when this var is set.

No client exposure — this is a server-only secret, never read in the Vite build.

## Security model

| Threat | Mitigation |
|---|---|
| External attacker hits `/api/ping` repeatedly to drive up Vercel invocations | `CRON_SECRET` bearer check rejects unauthorized requests with `401` before touching Supabase. |
| Service key leak via response body or logs | Function never echoes the key; logs only contain latency + row count. |
| Endpoint abused as a DB read amplifier | Single fixed query (count of a tiny table); no user input is forwarded to Supabase. |
| `CRON_SECRET` not set in Vercel | Function fails closed — returns `401` to everyone, including Vercel's cron. Cron logs make this visible; first deploy after setup must be verified manually. |

## Observability

- Function logs (visible in Vercel dashboard → Logs):
  - On success: `[ping] ok latency_ms=<n>`
  - On failure: `[ping] error: <message>` with stack trace
- Vercel dashboard → Settings → Cron Jobs shows last invocation time and status code.
- No external alerting / no email-on-failure — YAGNI. If Supabase pauses despite the cron, the next manual visit wakes it; the cron logs will show why it failed.

## Testing

### Manual verification (after deploy)

```bash
# Should return 401
curl -i https://<deploy>.vercel.app/api/ping

# Should return 200 { ok: true, ... }
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<deploy>.vercel.app/api/ping
```

Then check Vercel dashboard → Logs for the success line.

### After first scheduled run

Open Vercel dashboard → Cron Jobs → `/api/ping`. Confirm:
- Last run time is within the last 24h.
- Status code is `200`.
- Logs show non-zero `latency_ms`.

### Local dev

Vercel cron does not fire under `vercel dev` or `npm run dev`. To test locally, hit the endpoint directly with `curl` against `vercel dev` and pass the bearer header.

## Out of scope

- Email/Slack/SMS notifications on ping failure.
- Pinging from multiple regions.
- Pinging more than once per day.
- A dashboard widget showing ping status — this is purely a background concern.
- Migrating to Supabase pg_cron or GitHub Actions (alternatives documented in brainstorm; rejected for this iteration).

## File summary

| File | Action |
|---|---|
| `api/ping.js` | **New** — serverless function, ~40 lines |
| `vercel.json` | **Edit** — add `crons` array (3 lines) |
| Vercel project env vars | **Manual** — add `CRON_SECRET` in Vercel UI |

No SQL migration, no client code, no test file changes (no existing harness for serverless endpoints; manual curl verification is acceptable for a fixed, side-effect-free ping endpoint).
