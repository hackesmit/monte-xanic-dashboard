# Operations

## Environment Variables

All required for production. Store in `.env.local` locally, add to Vercel Settings > Environment Variables for deployment.

| Variable | Required | Used By | Purpose |
|----------|----------|---------|---------|
| `SUPABASE_URL` | Yes | All /api/* endpoints, frontend (via /api/config) | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Frontend (via /api/config) | Client-side Supabase key (respects RLS) |
| `SUPABASE_SERVICE_KEY` | Yes | /api/upload, /api/login, /api/logout | Server-side key (bypasses RLS) |
| `SESSION_SECRET` | Yes | /api/login, /api/verify, /api/logout, /api/config | HMAC signing key (min 32 bytes recommended) |
| `AUTH_USERNAME` | Yes | /api/login | Admin username |
| `AUTH_PASSWORD_HASH` | Yes | /api/login | Admin bcrypt hash |
| `LAB_USERNAME` | Yes | /api/login | Lab user username |
| `LAB_PASSWORD_HASH` | Yes | /api/login | Lab user bcrypt hash |

**Generate a bcrypt hash:**
```bash
node -e "const b=require('bcryptjs');b.hash('yourpassword',10,(e,h)=>console.log(h))"
```

## Local Development

**Prerequisites:** Node.js 20 (pinned in `.nvmrc`)

```bash
npm install          # Install bcryptjs + playwright
npm start            # Serve on http://localhost:8080
npm test             # Run unit tests (node:test)
```

The `npm start` command runs `npx serve -l 8080 -s .` which serves the repo root as a static site. API endpoints (`/api/*`) only work on Vercel or with `vercel dev`.

**Local dev with API:**
```bash
npx vercel dev       # Serves frontend + serverless functions locally
```
Requires Vercel CLI and a linked Vercel project. Environment variables must be configured in `.env.local`.

**Fallback for local dev without API:**
Store Supabase credentials in localStorage:
```javascript
localStorage.setItem('xanic_dev_supabase_url', 'https://xxx.supabase.co');
localStorage.setItem('xanic_dev_supabase_key', 'your-anon-key');
```
This bypasses /api/config. Auth will not work in this mode.

## Vercel Deployment

- Auto-deploys on every push to `main`
- Serverless functions in `/api/` are deployed automatically
- Environment variables must be set in Vercel dashboard (Settings > Environment Variables)
- All env vars must match `.env.local` keys exactly
- `vercel.json` defines security headers and CSP rules

**Files excluded from deploy** (via `.vercelignore`):
```
sql/, CLAUDE.md, PLAN.md, TASK.md, REVIEW.md, REPORTE_DASHBOARD.txt,
RESUMEN*.txt, PROJECT_SUMMARY.md, tests/, docs/, .claude/, .editorconfig, .nvmrc
```

## Supabase Setup

**Project requirements:**
- PostgreSQL database (free tier sufficient: 500MB)
- REST API enabled (default)
- No RLS policies needed (service key bypasses RLS)

**Table creation:**
Run these SQL scripts in order via Supabase SQL Editor:
1. `sql/schema.sql` - Core tables
2. `sql/migration_overhaul.sql` - Origin rename, Durif, composite key
3. `sql/migration_sample_seq.sql` - sample_seq column
4. `sql/migration_rate_limits.sql` - Rate limiting table
5. `sql/migration_token_blacklist.sql` - Token revocation table
6. `sql/migration_mediciones.sql` - Mediciones tecnicas table

## Backup Strategy

**Current status:** No automated backups configured.

**Supabase free tier:** Daily automated backups (7-day retention) are included.

**Recommended:**
- Enable Supabase point-in-time recovery if upgrading to Pro tier
- Periodically export critical tables (wine_samples, tank_receptions, mediciones_tecnicas) via Supabase dashboard
- Store exports in a separate location (not just Supabase)

## Monitoring and Logging

**Current status:** Minimal.
- Server-side `console.error()` for failed operations (visible in Vercel Function Logs)
- No structured logging
- No alerting
- No uptime monitoring

**Recommended:**
- Add Vercel Analytics or a simple uptime check
- Add structured error logging for /api/ endpoints
- Monitor Supabase usage (storage, API calls) via Supabase dashboard
- Set up alerts for rate limit spikes or repeated auth failures

## Data Scale

| Table | Current rows | Growth rate |
|-------|-------------|-------------|
| wine_samples | ~3,500 | ~500-800 per vendimia |
| tank_receptions | ~150 | ~100-150 per season |
| meteorology | ~1,500 | ~365 per year per valley |
| mediciones_tecnicas | ~0 (new) | ~110 per season |

Supabase free tier (500MB) is sufficient for 5+ years at current growth.
