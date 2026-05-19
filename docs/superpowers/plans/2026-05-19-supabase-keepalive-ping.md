# Supabase Keep-Alive Ping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Supabase from auto-pausing the project after 7 days of DB inactivity by adding a daily Vercel cron that runs a lightweight read against `applied_migrations`.

**Architecture:** One new serverless function (`api/ping.js`) gated by a `CRON_SECRET` bearer token, scheduled via a `crons` entry in `vercel.json` to run daily at 12:00 UTC. The handler issues a single `GET .../rest/v1/applied_migrations?select=name&limit=1` against PostgREST using the existing `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars and returns `{ ok, pinged_at, latency_ms }`. No client-side changes.

**Tech Stack:** Vercel serverless (Node 20 ESM), `fetch()` (native), Supabase PostgREST, no new dependencies.

**Branch:** `feat/supabase-keepalive-ping` (already checked out, spec committed).

**Spec:** [docs/superpowers/specs/2026-05-19-supabase-keepalive-ping-design.md](../specs/2026-05-19-supabase-keepalive-ping-design.md)

---

## Conventions referenced in this plan

- Existing serverless API pattern: see `api/migrations-status.js` — `res.setHeader('Cache-Control', 'no-store')`, method gating, raw `fetch()` against PostgREST, `console.error` logging, Spanish user-facing error strings (but English log strings).
- No unit-test harness exists for `api/` endpoints. The spec explicitly accepts manual `curl` verification for this fixed, side-effect-free ping. Steps below treat curl-against-deploy as the "test".
- This codebase commits frequently with conventional-commit prefixes (`feat:`, `docs:`, `chore:`). One commit per task below.

---

### Task 1: Generate `CRON_SECRET` and add it to Vercel

**Files:**
- Local note only — secret is set in Vercel project UI, not in the repo.

- [ ] **Step 1: Generate a high-entropy secret**

Run locally:

```bash
openssl rand -hex 32
```

Expected: a 64-character hex string, e.g. `b3f2c1a8...`. Copy it to your clipboard.

- [ ] **Step 2: Add the secret to Vercel project settings**

In a browser, open the project's Vercel dashboard:

1. Navigate to **Project Settings → Environment Variables**.
2. Add a new variable:
   - **Key:** `CRON_SECRET`
   - **Value:** the hex string from Step 1
   - **Environments:** check **Production** only (cron only runs on Production; dev/preview don't need it).
3. Click **Save**.

- [ ] **Step 3: Confirm presence**

Verify the variable appears in the **Environment Variables** list with `Production` scope. No deploy is triggered by adding the var alone — the next push will pick it up.

No commit for this task (manual UI step).

---

### Task 2: Create `api/ping.js` with auth gating only (failing happy-path)

**Files:**
- Create: `api/ping.js`

This task delivers an endpoint that correctly returns 401 for unauthorized callers and 405 for non-GET. It does NOT yet hit Supabase. We commit it first so the auth/method-gating layer is testable in isolation.

- [ ] **Step 1: Write the initial handler**

Create `api/ping.js`:

```js
// GET /api/ping
//
// Daily keep-alive ping for Supabase. Vercel cron (declared in vercel.json)
// invokes this endpoint once per day. The handler runs a single lightweight
// read against public.applied_migrations so Supabase sees real DB activity
// and does not pause the free-tier project after 7 idle days.
//
// Auth: Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron-triggered
// requests when the CRON_SECRET env var is set. Any other caller (including
// unauthenticated external traffic) is rejected with 401 before any DB work.
//
// Response shape on success:
//   200 { ok: true, pinged_at: '<iso>', latency_ms: <int> }
// On Supabase failure:
//   500 { ok: false, error: '<message>' }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  // DB ping arrives in Task 3. For now, acknowledge so the auth layer is
  // independently testable on a preview deploy.
  return res.status(200).json({ ok: true, pinged_at: new Date().toISOString(), latency_ms: 0 });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/ping.js
git commit -m "feat(ping): add /api/ping endpoint scaffold with CRON_SECRET auth"
```

---

### Task 3: Add the Supabase read

**Files:**
- Modify: `api/ping.js`

- [ ] **Step 1: Add the PostgREST fetch and latency measurement**

Edit `api/ping.js`. Replace the placeholder success block (the line `return res.status(200).json({ ok: true, pinged_at: new Date().toISOString(), latency_ms: 0 });`) with the real ping:

```js
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[ping] missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var');
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  const startedAt = Date.now();
  try {
    const url = `${supabaseUrl}/rest/v1/applied_migrations?select=name&limit=1`;
    const resp = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ping] Supabase error:', resp.status, errText);
      return res.status(500).json({ ok: false, error: 'No se pudo consultar Supabase' });
    }

    const latency_ms = Date.now() - startedAt;
    console.log(`[ping] ok latency_ms=${latency_ms}`);
    return res.status(200).json({
      ok: true,
      pinged_at: new Date().toISOString(),
      latency_ms,
    });
  } catch (err) {
    console.error('[ping] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
```

The final `api/ping.js` should now look like this in full (use this as the reference to confirm your edit landed correctly):

```js
// GET /api/ping
//
// Daily keep-alive ping for Supabase. Vercel cron (declared in vercel.json)
// invokes this endpoint once per day. The handler runs a single lightweight
// read against public.applied_migrations so Supabase sees real DB activity
// and does not pause the free-tier project after 7 idle days.
//
// Auth: Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron-triggered
// requests when the CRON_SECRET env var is set. Any other caller (including
// unauthenticated external traffic) is rejected with 401 before any DB work.
//
// Response shape on success:
//   200 { ok: true, pinged_at: '<iso>', latency_ms: <int> }
// On Supabase failure:
//   500 { ok: false, error: '<message>' }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[ping] missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var');
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  const startedAt = Date.now();
  try {
    const url = `${supabaseUrl}/rest/v1/applied_migrations?select=name&limit=1`;
    const resp = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ping] Supabase error:', resp.status, errText);
      return res.status(500).json({ ok: false, error: 'No se pudo consultar Supabase' });
    }

    const latency_ms = Date.now() - startedAt;
    console.log(`[ping] ok latency_ms=${latency_ms}`);
    return res.status(200).json({
      ok: true,
      pinged_at: new Date().toISOString(),
      latency_ms,
    });
  } catch (err) {
    console.error('[ping] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
```

- [ ] **Step 2: Local syntax check**

Run:

```bash
node --check api/ping.js
```

Expected: exit code 0, no output. Confirms the file parses as valid ESM.

- [ ] **Step 3: Commit**

```bash
git add api/ping.js
git commit -m "feat(ping): query applied_migrations and report latency"
```

---

### Task 4: Schedule the cron in `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the `crons` array**

Open `vercel.json`. The current file has a top-level `buildCommand`, `outputDirectory`, and `headers`. Add a new top-level `crons` key. The full file should read:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "crons": [
    { "path": "/api/ping", "schedule": "0 12 * * *" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co https://archive-api.open-meteo.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';" }
      ]
    }
  ]
}
```

Schedule `0 12 * * *` = daily at 12:00 UTC.

- [ ] **Step 2: Validate JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json', 'utf8')); console.log('ok')"
```

Expected: prints `ok`. If it errors, you have a JSON syntax problem to fix before committing.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(ping): schedule daily Vercel cron for /api/ping"
```

---

### Task 5: Push and verify on Vercel preview deploy

**Files:** none (deploy + verification)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/supabase-keepalive-ping
```

Expected: push succeeds; Vercel auto-builds a preview deployment for the branch.

- [ ] **Step 2: Wait for the preview deploy URL**

In the Vercel dashboard → **Deployments**, find the deployment for `feat/supabase-keepalive-ping` and wait until it reads **Ready**. Copy the preview URL (looks like `https://<project>-<hash>-<scope>.vercel.app`).

> **Important:** Preview deployments do **not** automatically receive Production-scoped env vars. For the verification curl in Step 3 to work, the preview must either have `CRON_SECRET` mirrored to the `Preview` environment, or you must run Step 3 against a Production deploy after merging. Pick one:
> - **Path A (test on preview):** In Vercel → Settings → Environment Variables, edit `CRON_SECRET` and also enable the `Preview` environment. Redeploy.
> - **Path B (test after merge):** Skip Step 3 here and run it in Task 6 against Production after merging.

If you don't want to expose `CRON_SECRET` to previews, take Path B.

- [ ] **Step 3 (Path A only): Verify auth gating and DB query against the preview**

With `$PREVIEW_URL` set to the preview URL and `$CRON_SECRET` set to the secret from Task 1:

```bash
# Unauthorized: should return 401
curl -i "$PREVIEW_URL/api/ping"

# Wrong method: should return 405
curl -i -X POST -H "Authorization: Bearer $CRON_SECRET" "$PREVIEW_URL/api/ping"

# Authorized: should return 200 with ok:true and a positive latency_ms
curl -i -H "Authorization: Bearer $CRON_SECRET" "$PREVIEW_URL/api/ping"
```

Expected:
- Call 1 prints `HTTP/2 401` and `{"ok":false,"error":"No autorizado"}`.
- Call 2 prints `HTTP/2 405` and `{"ok":false,"error":"Method not allowed"}`.
- Call 3 prints `HTTP/2 200` and a body like `{"ok":true,"pinged_at":"2026-05-19T...","latency_ms":<positive int>}`.

If Call 3 returns 500 with `"Configuración de base de datos incompleta"`, the preview environment is missing `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — either mirror those to Preview as well, or skip to Path B.

- [ ] **Step 4: No commit here — verification only**

---

### Task 6: Merge to main and verify production

**Files:** none (merge + production verification)

- [ ] **Step 1: Open a PR for review**

The user's project rules prohibit working on `main` directly and prohibit auto-merge. Open a PR from `feat/supabase-keepalive-ping` to `main` and request user review.

```bash
gh pr create --title "feat(ping): daily Supabase keep-alive cron" --body "$(cat <<'EOF'
## Summary
- New `api/ping.js` serverless endpoint that runs a daily HEAD-equivalent read against `public.applied_migrations` so Supabase doesn't auto-pause the project after 7 idle days.
- New `crons` entry in `vercel.json` scheduling `/api/ping` daily at 12:00 UTC.
- Endpoint is gated by `CRON_SECRET` (Vercel-injected on cron-triggered requests); unauthorized callers get `401` before any DB work.

## Test plan
- [ ] `CRON_SECRET` env var is set in Vercel Production scope
- [ ] Preview or Production curl: unauthorized request returns 401
- [ ] Preview or Production curl: authorized request returns 200 with `latency_ms`
- [ ] Vercel dashboard → Cron Jobs lists `/api/ping` with schedule `0 12 * * *`
- [ ] First scheduled run within 24h shows status 200 in Vercel Cron Jobs logs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: prints the PR URL.

- [ ] **Step 2: After the user merges, verify against Production**

Once `main` is merged and Production deploy is **Ready**:

```bash
# Substitute the production domain.
PROD_URL=https://<production-domain>

curl -i "$PROD_URL/api/ping"                                              # → 401
curl -i -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/ping"      # → 200 ok
```

Expected: same response shapes as Task 5 Step 3.

- [ ] **Step 3: Confirm the cron is registered**

In Vercel dashboard → **Settings → Cron Jobs**, confirm there is an entry for `/api/ping` with schedule `0 12 * * *` and next run within 24h.

- [ ] **Step 4: Within 24h, confirm first scheduled run succeeded**

After the next 12:00 UTC, return to **Cron Jobs** and verify:
- Last run timestamp matches the most recent 12:00 UTC.
- Status code: `200`.
- Click into the invocation → **Logs** → look for `[ping] ok latency_ms=<n>` with a positive integer.

If status is non-200, open the invocation logs and debug from the printed `[ping] ...` line.

---

## Definition of done

All of the following must be true:

1. `api/ping.js` exists on `main` and handles GET with `CRON_SECRET` bearer auth.
2. `vercel.json` on `main` contains the `crons` entry for `/api/ping` at `0 12 * * *`.
3. `CRON_SECRET` is set in the Vercel Production environment.
4. Production curl with the bearer token returns `200 { ok: true, latency_ms: <int> }`.
5. Vercel dashboard → Cron Jobs lists `/api/ping` as active.
6. At least one scheduled invocation has run and recorded status 200.
