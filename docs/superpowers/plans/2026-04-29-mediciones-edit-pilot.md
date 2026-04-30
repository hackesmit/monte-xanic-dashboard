# Mediciones Edit/Delete + Interactive Table — Implementation Plan (Round 37)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the editable-table pilot on `mediciones_tecnicas` — modal editor, hard delete, lightweight audit stamps, role-permission rework (admin → view-only), shared validation module, and table polish (search, aria-sort arrows, global-filter wire-in).

**Architecture:** Approach 3 from the spec — generic server (`/api/row`) and shared validation module factored from day one; client editor stays bespoke in `js/mediciones.js` until a second concrete consumer lands. Last-write-wins; lightweight audit columns on the row.

**Tech Stack:** Vanilla JS ES modules, Vite, Supabase REST upsert/PATCH/DELETE, Vercel serverless. Tests run under Node's built-in test runner (`node --test tests/*.test.mjs`); e2e via Playwright. Spanish UI throughout.

**Spec:** [`../specs/2026-04-29-mediciones-edit-design.md`](../specs/2026-04-29-mediciones-edit-design.md)

**Spec correction discovered during planning:** The JWT payload issued by `api/login.js:136` only carries `{ exp, role, nonce }`. The spec's audit stamp logic (`result.payload.username`) won't work as written. Task 4 adds `user` to the JWT payload; the endpoint reads `result.payload.user` with a `'lab'` fallback for in-flight sessions.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `sql/migration_mediciones_audit.sql` | Create | Add `last_edited_at`, `last_edited_by` to `mediciones_tecnicas` |
| `js/migrations-manifest.js` | Modify | Append migration name to `MIGRATIONS` |
| `js/validation.js` | Create | `COLUMN_TYPES` registry + `validateRow()` |
| `js/upload/prerecepcion.js` | Modify | Import `COLUMN_TYPES` instead of inline INT/NUMERIC sets |
| `js/upload/winexray.js` | Modify | Same |
| `js/upload/recepcion.js` | Modify | Same (two parsers in one file: recepcion + prefermentativos) |
| `api/login.js` | Modify | Include `user` in signed JWT payload |
| `js/auth.js` | Modify | Add `canWrite()`/`canExport()`; remove admin from drift-banner gate |
| `api/row.js` | Create | Generic update/delete endpoint, `lab`-only |
| `api/upload.js` | Modify | Role gate becomes `lab`-only (admin loses upload) |
| `index.html` | Modify | Add `<dialog id="med-edit-modal">` block + table toolbar with search input; gate page-export buttons by role |
| `css/styles.css` | Modify | Modal shell, `.field-dirty`, `.row-clickable`, sort arrows (`aria-sort`), hover, table toolbar, mobile modal, demo-mode hides |
| `js/mediciones.js` | Modify | Dirty-state helpers, `openEditModal`, `submitEdit`, `submitDelete`, audit/source-banner rendering, search + global filter wire-in, aria-sort toggle |
| `js/events.js` | Modify | Row click → open modal; modal close handlers; search input listener; gate edit/delete by role |
| `tests/mt18-validation.test.mjs` | Create | Validation module unit tests |
| `tests/mt19-mediciones-edit.test.mjs` | Create | Dirty-math + helpers unit tests |
| `tests/mt20-api-row.test.mjs` | Create | API integration tests |
| `tests/mt7-column-whitelist.test.mjs` | Modify | Update inline ALLOWED_TABLES copy if it drifts during this round (currently stale — leave unless its tests fail) |
| `tests/mt16-upload-controller.test.mjs` | Modify | Role gate change: admin → 403 on upload (only if it asserts admin success today) |

---

## Task 1: Schema migration + manifest

**Files:**
- Create: `sql/migration_mediciones_audit.sql`
- Modify: `js/migrations-manifest.js`

- [ ] **Step 1: Write the migration SQL**

Create `sql/migration_mediciones_audit.sql`:

```sql
-- Round 37: lightweight audit stamps for in-dashboard editing of
-- mediciones_tecnicas. Both columns are NULLable so historical rows
-- (which have no edit history) remain valid.

ALTER TABLE public.mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_mediciones_audit')
  ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: Append to manifest**

Open `js/migrations-manifest.js`. Find the `MIGRATIONS` array and append `'migration_mediciones_audit'` to it (preserving the existing comma style).

Example diff (the surrounding entries depend on what's already there — match the existing trailing-comma style):

```js
export const MIGRATIONS = [
  // ... existing entries ...
  'migration_unify_mediciones',
  'migration_mediciones_audit',
];
```

- [ ] **Step 3: Commit**

```bash
git add sql/migration_mediciones_audit.sql js/migrations-manifest.js
git commit -m "feat(schema): audit stamps on mediciones_tecnicas (Round 37 setup)"
```

> **Run the SQL in Supabase SQL Editor before deploying any code that references the new columns** — this is the Round 36 guardrail. The dashboard's drift banner will name this migration as missing if you forget.

---

## Task 2: Shared validation module + mt18 tests

**Files:**
- Create: `js/validation.js`
- Create: `tests/mt18-validation.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `tests/mt18-validation.test.mjs`:

```js
// MT.18 — Shared validation module: validateRow() and COLUMN_TYPES.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateRow, COLUMN_TYPES } from '../js/validation.js';

describe('MT.18 — validateRow', () => {
  it('accepts a valid mediciones_tecnicas update payload', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      berry_avg_weight_g: 1.92,
    });
    assert.equal(result.ok, true);
  });

  it('rejects a non-numeric value in a NUMERIC column', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      brix: 'foo',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /brix/);
    assert.match(result.error, /numérico/);
  });

  it('rejects a fractional value in an INT column', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      health_madura: 1.5,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /health_madura/);
    assert.match(result.error, /entero/);
  });

  it('on action: insert, requires medicion_code and other identity fields', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_date: '2026-04-29',
    }, { action: 'insert' });
    assert.equal(result.ok, false);
    assert.match(result.error, /medicion_code/);
  });

  it('on action: update (default), does NOT require non-key fields', () => {
    const result = validateRow('mediciones_tecnicas', {
      medicion_code: 'MT-2025-001',
      // no medicion_date, vintage_year, variety, appellation
    });
    assert.equal(result.ok, true);
  });

  it('rejects an unknown table', () => {
    const result = validateRow('made_up_table', { foo: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error, /Tabla no soportada/);
  });

  it('exposes COLUMN_TYPES.mediciones_tecnicas with int + numeric sets', () => {
    const spec = COLUMN_TYPES.mediciones_tecnicas;
    assert.ok(spec.intCols instanceof Set);
    assert.ok(spec.numericCols instanceof Set);
    assert.ok(spec.intCols.has('vintage_year'));
    assert.ok(spec.numericCols.has('brix'));
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- --test-name-pattern="MT.18"
```

Expected: errors loading `../js/validation.js` (Cannot find module). Test does not run.

- [ ] **Step 3: Implement the module**

Create `js/validation.js`:

```js
// Shared validation module — used by api/row.js (server-authoritative gate)
// and by the mediciones edit modal (client UX). Pure ESM so it runs in both
// Node and the browser without polyfills.
//
// Round 37: factored from inline INT_COLUMNS / NUMERIC_COLUMNS definitions
// previously duplicated across each parser. Keep the per-table sets here so
// adding a column updates parsers and the editor in one place.

import { validateColumnTypes } from './upload/normalize.js';

export const COLUMN_TYPES = {
  mediciones_tecnicas: {
    intCols: new Set([
      'vintage_year', 'berry_count_sample',
      'health_madura', 'health_inmadura', 'health_sobremadura',
      'health_picadura', 'health_enfermedad', 'health_quemadura',
      'total_bins', 'health_pasificada', 'health_aceptable',
      'health_no_aceptable',
    ]),
    numericCols: new Set([
      'tons_received', 'berry_avg_weight_g', 'berry_diameter_mm',
      'bin_temp_c', 'truck_temp_c', 'bunch_avg_weight_g',
      'berry_length_avg_cm', 'berries_200_weight_g',
      'brix', 'ph', 'at', 'ag', 'am',
      'polifenoles', 'catequinas', 'antocianos',
    ]),
    requiredOnInsert: new Set([
      'medicion_code', 'medicion_date', 'vintage_year',
      'variety', 'appellation',
    ]),
  },
};

export { validateColumnTypes };

export function validateRow(table, row, { action = 'update' } = {}) {
  const spec = COLUMN_TYPES[table];
  if (!spec) return { ok: false, error: `Tabla no soportada: ${table}` };

  const typeError = validateColumnTypes(row, spec);
  if (typeError) return { ok: false, error: typeError };

  if (action === 'insert') {
    for (const f of spec.requiredOnInsert) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        return { ok: false, error: `Campo requerido: ${f}` };
      }
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npm test -- --test-name-pattern="MT.18"
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/validation.js tests/mt18-validation.test.mjs
git commit -m "feat(validation): shared module — COLUMN_TYPES + validateRow"
```

---

## Task 3: Refactor parsers to use COLUMN_TYPES

The four parser code paths each define their own `INT_COLUMNS` / `NUMERIC_COLUMNS` sets and pass them to `validateColumnTypes`. After this task they all read the same source of truth. **Behavior must not change** — `mt13` / `mt14` / `mt15` / `mt17` are the safety net.

**Files:**
- Modify: `js/upload/prerecepcion.js`
- Modify: `js/upload/winexray.js`
- Modify: `js/upload/recepcion.js`

**Important:** This task adds entries to `COLUMN_TYPES` for the OTHER parsers' tables. The mediciones entry from Task 2 stays.

- [ ] **Step 1: Inventory the existing inline sets**

Run, and copy each printed set into a scratch buffer — these become the new entries:

```bash
grep -n "INT_COLUMNS\s*=\|NUMERIC_COLUMNS\s*=\|RECEPCION_INT\|PREFERMENT_INT\|WINEXRAY" js/upload/*.js | head -40
```

You're looking for four (table, intCols, numericCols) triples:
- `prerecepcion.js` → writes to `mediciones_tecnicas` (Round 35 unification — mediciones already in `COLUMN_TYPES`, but this parser may have a different set inline; reconcile)
- `winexray.js` → writes to `wine_samples`
- `recepcion.js` recepcion sheet → `tank_receptions`
- `recepcion.js` prefermentativos sheet → `prefermentativos`

- [ ] **Step 2: Extend `js/validation.js` with the additional table specs**

Open `js/validation.js`. Inside `COLUMN_TYPES`, add entries for `wine_samples`, `tank_receptions`, `prefermentativos`. Use the **exact** sets currently defined inline in the parsers — do not editorialize. For each, also fill `requiredOnInsert` from `api/upload.js`'s `ALLOWED_TABLES[table].required`.

The existing `mediciones_tecnicas` entry should match what `prerecepcion.js` uses today; if they differ, the parser is the source of truth and the spec entry must be updated to match (this would indicate the spec's mediciones set was incomplete).

- [ ] **Step 3: Refactor `prerecepcion.js`**

At the top of the file, change the import line so it pulls `COLUMN_TYPES` from `validation.js`:

```js
import { normalizeValue, normalizeDate, validateColumnTypes } from './normalize.js';
import { COLUMN_TYPES } from '../validation.js';
```

Delete the local `INT_COLUMNS` and `NUMERIC_COLUMNS` constants. Replace the `validateColumnTypes` call:

```js
const { intCols, numericCols } = COLUMN_TYPES.mediciones_tecnicas;
const typeReject = validateColumnTypes(obj, { intCols, numericCols });
```

- [ ] **Step 4: Refactor `winexray.js`**

Same shape. The destination table is `wine_samples`:

```js
import { COLUMN_TYPES } from '../validation.js';
// …
const { intCols, numericCols } = COLUMN_TYPES.wine_samples;
const reject = validateColumnTypes(obj, { intCols, numericCols });
```

- [ ] **Step 5: Refactor `recepcion.js` (two destinations in one file)**

This file parses both the Recepción sheet (→ `tank_receptions`) and the Prefermentativos sheet (→ `prefermentativos`). Replace the two `validateColumnTypes` calls:

```js
import { COLUMN_TYPES } from '../validation.js';
// …
// Recepción sheet:
const recReject = validateColumnTypes(obj, COLUMN_TYPES.tank_receptions);

// Prefermentativos sheet:
const prefReject = validateColumnTypes(obj, COLUMN_TYPES.prefermentativos);
```

(`validateColumnTypes` accepts the spec object directly — no need to destructure.)

Delete the four local sets (`RECEPCION_INT_COLUMNS`, `RECEPCION_NUMERIC_COLUMNS`, `PREFERMENT_INT_COLUMNS`, `PREFERMENT_NUMERIC_COLUMNS`).

- [ ] **Step 6: Run the existing parser tests, verify still passes**

```bash
npm test -- --test-name-pattern="MT.13|MT.14|MT.15|MT.17|MT.18"
```

Expected: all pass. If any test fails, the parser's inline set differed from what was put in `validation.js`. Reconcile by copying the parser's actual set verbatim into `validation.js`.

- [ ] **Step 7: Commit**

```bash
git add js/upload/prerecepcion.js js/upload/winexray.js js/upload/recepcion.js js/validation.js
git commit -m "refactor(upload): parsers import COLUMN_TYPES from validation.js"
```

---

## Task 4: login.js — include `user` in JWT payload

The audit stamp's `last_edited_by` must record *which* lab user edited a row. Today the JWT carries only `{ exp, role, nonce }` — there's no user identifier. This task adds `user`. In-flight sessions issued before this deploy will not have `user`; the server endpoint falls back to `'lab'` (Task 6).

**Files:**
- Modify: `api/login.js`

- [ ] **Step 1: Add `user` to the signed payload**

Open `api/login.js`. Find the payload construction (~line 136):

```js
const payload = JSON.stringify({
  exp: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
  role: matchedRole,
  nonce: crypto.randomBytes(16).toString('hex')
});
```

Add `user` (the matched account's username — the `user` field on the matching entry from the `accounts` array):

```js
const payload = JSON.stringify({
  exp: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
  user: matchedAccount.user,
  role: matchedRole,
  nonce: crypto.randomBytes(16).toString('hex')
});
```

`matchedAccount` is the variable already used in the existing comparison loop. Confirm the local name in the file before editing — it may be called something slightly different. The right value is whatever the function currently uses to look up `matchedRole`.

- [ ] **Step 2: Manual smoke (no automated test for login.js — its existing test is mt3 against verifyToken)**

Locally, with `npm run dev` running:
1. Log in as the lab account.
2. In DevTools console, base64-decode the first segment of `localStorage.xanic_session_token`. Verify the decoded JSON contains `user: "<lab username>"` alongside `role: "lab"`.
3. Log out, log back in — confirm the freshly-issued token also contains `user`.

- [ ] **Step 3: Commit**

```bash
git add api/login.js
git commit -m "feat(auth): include user in JWT payload (audit stamp prep)"
```

---

## Task 5: Auth helpers + remove admin from drift banner

**Files:**
- Modify: `js/auth.js`

- [ ] **Step 1: Add the helper methods**

Open `js/auth.js`. Find the `Auth` object (`export const Auth = { ... }`). Add two methods near the existing `isLab()` (or wherever role-based predicates live, around line 146):

```js
canWrite()  { return this.role === 'lab'; },
canExport() { return this.role === 'lab' || this.role === 'admin'; },
```

- [ ] **Step 2: Remove `admin` from the migration-drift banner gate**

In the same file, find the line that triggers `checkMigrationsDrift()` (around line 154):

```js
if (this.role === 'lab' || this.role === 'admin') this.checkMigrationsDrift();
```

Replace with:

```js
if (this.role === 'lab') this.checkMigrationsDrift();
```

- [ ] **Step 3: Hide page-export buttons when `!canExport()`**

The page-export buttons (`.page-export-btn`) currently render unconditionally. The cleanest hook is in `events.js`'s page-export click binding — but the gate should also hide them visually. Add a CSS-class toggle in `auth.js`'s `init()` (or wherever role state finalises). After `this.role` is set:

```js
if (typeof document !== 'undefined') {
  document.body.classList.toggle('can-write',  this.canWrite());
  document.body.classList.toggle('can-export', this.canExport());
}
```

(CSS rules that consume those classes go in Task 11.)

- [ ] **Step 4: Manual smoke**

Reload the dashboard as `lab`, `admin`, `viewer` (use the env-var lab/admin accounts; spoof `viewer` by clearing the role from `localStorage.xanic_user_role` and reloading — or whatever your existing `viewer` flow is). Open DevTools and inspect `<body>`:
- `lab` → `class="can-write can-export"`
- `admin` → `class="can-export"` (no `can-write`)
- `viewer` → no auth-related classes

The drift banner stays visible only for `lab`.

- [ ] **Step 5: Commit**

```bash
git add js/auth.js
git commit -m "feat(auth): canWrite/canExport helpers; admin loses drift banner"
```

---

## Task 6: api/row.js — auth + role + table gates with mt20 tests

This task lands the endpoint scaffold and gate logic only. Update + delete actions follow in Tasks 7 and 8.

**Files:**
- Create: `api/row.js`
- Create: `tests/mt20-api-row.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `tests/mt20-api-row.test.mjs`:

```js
// MT.20 — /api/row endpoint: authentication, role, table-validation gates,
// then update + delete pipelines (Tasks 7 & 8).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const handler = (await import('../api/row.js')).default;

function token(role, user = 'labuser') {
  const payloadB64 = Buffer.from(JSON.stringify({
    exp: Date.now() + 60_000, role, user, nonce: 'n',
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() {},
  };
  return res;
}

function makeReq({ method = 'POST', body = {}, role = 'lab' } = {}) {
  return {
    method,
    headers: { 'x-session-token': token(role) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

describe('MT.20 — /api/row gates', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('rejects non-POST with 405', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    // Stub fetch (verifyToken's blacklist check) — should not even be reached
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });

  it('rejects missing token with 401', async () => {
    const req = { method: 'POST', headers: {}, body: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
  });

  it('rejects viewer role with 403', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const req = makeReq({ role: 'viewer', body: { table: 'mediciones_tecnicas', action: 'update', row: { medicion_code: 'X' } } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it('rejects admin role with 403 (admin = view-only after Round 37)', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const req = makeReq({ role: 'admin', body: { table: 'mediciones_tecnicas', action: 'update', row: { medicion_code: 'X' } } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it('rejects unknown table with 400', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const req = makeReq({ body: { table: 'made_up', action: 'update', row: {} } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejects unknown action with 400', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const req = makeReq({ body: { table: 'mediciones_tecnicas', action: 'inhale', row: { medicion_code: 'X' } } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejects missing conflict-key column with 400', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const req = makeReq({ body: { table: 'mediciones_tecnicas', action: 'update', row: { berry_avg_weight_g: 1.9 } } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- --test-name-pattern="MT.20"
```

Expected: errors loading `../api/row.js`.

- [ ] **Step 3: Implement the gate scaffold**

Create `api/row.js`:

```js
import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';
import { ALLOWED_TABLES } from './upload.js';
import { validateRow } from '../js/validation.js';

const ALLOWED_ACTIONS = new Set(['update', 'delete']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { maxRequests: 30 })) return;

  const token = req.headers['x-session-token'];
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }

  const role = result.payload.role || 'viewer';
  if (role !== 'lab') {
    return res.status(403).json({ ok: false, error: 'Sin permisos para editar datos' });
  }

  const { table, action, row } = req.body || {};

  if (!table || !ALLOWED_TABLES[table]) {
    return res.status(400).json({ ok: false, error: 'Tabla no válida' });
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: 'Acción no válida' });
  }
  if (!row || typeof row !== 'object') {
    return res.status(400).json({ ok: false, error: 'Sin datos para actualizar' });
  }

  const tableConfig = ALLOWED_TABLES[table];
  const conflictCols = (tableConfig.conflict || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!conflictCols.length) {
    return res.status(400).json({ ok: false, error: 'Tabla no soportada para edición' });
  }

  // Strip unknown columns (same allowlist as upload)
  if (tableConfig.columns) {
    for (const k of Object.keys(row)) {
      if (!tableConfig.columns.has(k)) delete row[k];
    }
  }
  // Server-authoritative audit fields. Strip explicitly — even if a future
  // schema adds them to the whitelist, the server is the only writer.
  delete row.last_edited_at;
  delete row.last_edited_by;

  for (const col of conflictCols) {
    if (row[col] === undefined || row[col] === null || row[col] === '') {
      return res.status(400).json({ ok: false, error: `Falta llave: ${col}` });
    }
  }

  const validation = validateRow(table, row, { action: 'update' });
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  // ── Update / delete bodies land in Tasks 7 and 8 ──
  return res.status(501).json({ ok: false, error: 'No implementado' });
}
```

> Note: importing `ALLOWED_TABLES` from `./upload.js` reuses the single source of truth for table whitelisting and conflict keys. `api/upload.js` already exports it (`export const ALLOWED_TABLES`).

- [ ] **Step 4: Run the test, verify the gate tests pass**

```bash
npm test -- --test-name-pattern="MT.20 — /api/row gates"
```

Expected: 7 tests pass. (The "happy path" tests added in Tasks 7 & 8 don't exist yet.)

- [ ] **Step 5: Commit**

```bash
git add api/row.js tests/mt20-api-row.test.mjs
git commit -m "feat(api): /api/row scaffold — auth, role, table, action gates (Round 37)"
```

---

## Task 7: api/row.js — UPDATE action

Add the PATCH-to-Supabase logic. Server stamps `last_edited_at` / `last_edited_by` from the verified token.

**Files:**
- Modify: `api/row.js`
- Modify: `tests/mt20-api-row.test.mjs`

- [ ] **Step 1: Append failing tests for the update path**

Append to `tests/mt20-api-row.test.mjs` (inside a new `describe`):

```js
describe('MT.20 — /api/row update', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('PATCHes Supabase with the right URL+filter and returns the updated row', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      // First call may be the verifyToken blacklist check — distinguish by URL
      if (url.includes('blacklist')) return { ok: true, json: async () => [] };
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => [{ medicion_code: 'MT-2025-001', berry_avg_weight_g: 1.92,
                              last_edited_at: '2026-04-29T00:00:00Z', last_edited_by: 'labuser' }],
      };
    };
    const req = makeReq({ body: {
      table: 'mediciones_tecnicas', action: 'update',
      row: { medicion_code: 'MT-2025-001', berry_avg_weight_g: 1.92 },
    }});
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.row.medicion_code, 'MT-2025-001');
    assert.match(captured.url, /\/rest\/v1\/mediciones_tecnicas\?medicion_code=eq\.MT-2025-001/);
    assert.equal(captured.opts.method, 'PATCH');
    assert.equal(captured.opts.headers.Prefer, 'return=representation');
    const sentBody = JSON.parse(captured.opts.body);
    assert.equal(sentBody.berry_avg_weight_g, 1.92);
    assert.ok(sentBody.last_edited_at, 'server should stamp last_edited_at');
    assert.equal(sentBody.last_edited_by, 'labuser');
  });

  it('strips client-supplied audit fields and re-applies server values', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('blacklist')) return { ok: true, json: async () => [] };
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => [{ medicion_code: 'X' }] };
    };
    const req = makeReq({ body: {
      table: 'mediciones_tecnicas', action: 'update',
      row: {
        medicion_code: 'X',
        last_edited_by: 'forged-attacker',
        last_edited_at: '1999-01-01T00:00:00Z',
      },
    }});
    const res = makeRes();
    await handler(req, res);
    const sentBody = JSON.parse(captured.opts.body);
    assert.notEqual(sentBody.last_edited_by, 'forged-attacker');
    assert.notEqual(sentBody.last_edited_at, '1999-01-01T00:00:00Z');
    assert.equal(sentBody.last_edited_by, 'labuser');
  });

  it('returns 400 when validateRow fails (bad numeric)', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    const req = makeReq({ body: {
      table: 'mediciones_tecnicas', action: 'update',
      row: { medicion_code: 'X', brix: 'foo' },
    }});
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /brix/);
  });

  it('falls back to last_edited_by="lab" if token lacks user', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('blacklist')) return { ok: true, json: async () => [] };
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => [{ medicion_code: 'X' }] };
    };
    // Hand-craft a token without `user`
    const payloadB64 = Buffer.from(JSON.stringify({
      exp: Date.now() + 60_000, role: 'lab', nonce: 'n',
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
    const legacyToken = `${payloadB64}.${sig}`;
    const req = {
      method: 'POST',
      headers: { 'x-session-token': legacyToken },
      body: { table: 'mediciones_tecnicas', action: 'update', row: { medicion_code: 'X' } },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = makeRes();
    await handler(req, res);
    const sentBody = JSON.parse(captured.opts.body);
    assert.equal(sentBody.last_edited_by, 'lab');
  });
});
```

- [ ] **Step 2: Run, verify the new tests fail (501)**

```bash
npm test -- --test-name-pattern="MT.20 — /api/row update"
```

Expected: 4 failures because the handler currently returns 501.

- [ ] **Step 3: Implement the update action**

Replace the placeholder `return res.status(501)` line in `api/row.js` with:

```js
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  const filter = conflictCols
    .map(c => `${c}=eq.${encodeURIComponent(row[c])}`)
    .join('&');
  const url = `${supabaseUrl}/rest/v1/${table}?${filter}`;

  if (action === 'update') {
    // Server-authoritative audit stamp (overrides anything the client sent)
    row.last_edited_at = new Date().toISOString();
    row.last_edited_by = result.payload.user || 'lab';

    try {
      const supaRes = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(row),
      });
      const updated = await supaRes.json();
      if (!supaRes.ok) {
        return res.status(supaRes.status).json({
          ok: false, error: updated?.message || 'Error al actualizar',
        });
      }
      const updatedRow = Array.isArray(updated) ? updated[0] : updated;
      if (!updatedRow) {
        return res.status(404).json({ ok: false, error: 'Fila no encontrada' });
      }
      return res.status(200).json({ ok: true, row: updatedRow });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error de red al actualizar' });
    }
  }

  // delete branch — Task 8
  return res.status(501).json({ ok: false, error: 'No implementado' });
```

- [ ] **Step 4: Run all MT.20 tests, verify they pass**

```bash
npm test -- --test-name-pattern="MT.20"
```

Expected: gates (7) + update path (4) = 11 pass. Delete tests don't exist yet.

- [ ] **Step 5: Commit**

```bash
git add api/row.js tests/mt20-api-row.test.mjs
git commit -m "feat(api): /api/row PATCH update with server-stamped audit (Round 37)"
```

---

## Task 8: api/row.js — DELETE action

**Files:**
- Modify: `api/row.js`
- Modify: `tests/mt20-api-row.test.mjs`

- [ ] **Step 1: Append failing tests for the delete path**

Append to `tests/mt20-api-row.test.mjs`:

```js
describe('MT.20 — /api/row delete', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('DELETEs from Supabase and reports deleted: 1', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      if (url.includes('blacklist')) return { ok: true, json: async () => [] };
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => [{ medicion_code: 'X' }] };
    };
    const req = makeReq({ body: {
      table: 'mediciones_tecnicas', action: 'delete', row: { medicion_code: 'X' },
    }});
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.deleted, 1);
    assert.equal(captured.opts.method, 'DELETE');
    assert.match(captured.url, /medicion_code=eq\.X/);
  });

  it('returns deleted: 0 when no row matches', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('blacklist')) return { ok: true, json: async () => [] };
      return { ok: true, status: 200, json: async () => [] };
    };
    const req = makeReq({ body: {
      table: 'mediciones_tecnicas', action: 'delete', row: { medicion_code: 'NOPE' },
    }});
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deleted, 0);
  });
});
```

- [ ] **Step 2: Run, verify the delete tests fail (501)**

```bash
npm test -- --test-name-pattern="MT.20 — /api/row delete"
```

Expected: 2 failures.

- [ ] **Step 3: Implement the delete branch**

In `api/row.js`, replace the placeholder after the update branch:

```js
  if (action === 'delete') {
    try {
      const supaRes = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=representation',
        },
      });
      const body = await supaRes.json();
      if (!supaRes.ok) {
        return res.status(supaRes.status).json({
          ok: false, error: body?.message || 'Error al eliminar',
        });
      }
      const count = Array.isArray(body) ? body.length : 0;
      return res.status(200).json({ ok: true, deleted: count });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error de red al eliminar' });
    }
  }

  // Should be unreachable — ALLOWED_ACTIONS guards above.
  return res.status(400).json({ ok: false, error: 'Acción no válida' });
```

- [ ] **Step 4: Run all MT.20, verify all pass**

```bash
npm test -- --test-name-pattern="MT.20"
```

Expected: 7 + 4 + 2 = 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/row.js tests/mt20-api-row.test.mjs
git commit -m "feat(api): /api/row DELETE branch (Round 37)"
```

---

## Task 9: api/upload.js — remove admin upload

**Files:**
- Modify: `api/upload.js`
- Possibly modify: `tests/mt16-upload-controller.test.mjs` (only if it currently asserts admin can upload; otherwise leave alone)

- [ ] **Step 1: Tighten the role gate**

Open `api/upload.js`. Find the role check (around line 132):

```js
if (role !== 'lab' && role !== 'admin') {
  return res.status(403).json({ ok: false, error: 'Sin permisos para subir datos' });
}
```

Replace with:

```js
if (role !== 'lab') {
  return res.status(403).json({ ok: false, error: 'Sin permisos para subir datos' });
}
```

- [ ] **Step 2: Audit the upload-related tests**

```bash
grep -n "admin" tests/mt16-upload-controller.test.mjs tests/mt17-upload-whitelist.test.mjs
```

If any test asserts an admin-role upload returning 200, change the expectation to 403. Today `mt16` stubs `Auth.canUpload = () => true` and never exercises a role gate against the server endpoint — likely no change needed. `mt17` tests the whitelist config, not the role gate.

- [ ] **Step 3: Run the suite**

```bash
npm test
```

Expected: full suite passes. If `mt16` or any other test breaks because it expected admin-can-upload, update that test to reflect the new behavior.

- [ ] **Step 4: Commit**

```bash
git add api/upload.js tests/mt16-upload-controller.test.mjs
git commit -m "feat(auth): remove admin upload capability — lab-only writes (Round 37)"
```

(If `mt16` wasn't touched, drop it from the `git add`.)

---

## Task 10: index.html — modal markup + table toolbar

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the search toolbar above the existing table**

Find the section header for the table (around line 883):

```html
<div class="section-label" style="margin-top:24px">Registro de Mediciones · <span id="med-table-count"></span></div>
```

Replace with a toolbar that wraps the heading + search input + count:

```html
<div class="table-toolbar" style="margin-top:24px">
  <div class="section-label">Registro de Mediciones</div>
  <input id="med-search" type="search" class="table-search"
         placeholder="Buscar por código, variedad, lote, notas…"
         aria-label="Buscar en mediciones">
  <span class="table-toolbar-count" id="med-table-count"></span>
</div>
```

- [ ] **Step 2: Add the edit-modal `<dialog>` block**

Immediately after the closing `</div>` of `view-mediciones` (find `<div id="view-mediciones"` and locate its matching close), add:

```html
<dialog id="med-edit-modal" class="row-edit-modal" aria-labelledby="med-edit-title">
  <form method="dialog" id="med-edit-form" class="medicion-form">
    <header class="modal-header">
      <h2 id="med-edit-title">Editar medición · <span id="med-edit-code">—</span></h2>
      <p id="med-edit-audit" class="modal-audit-line">—</p>
      <button type="button" class="modal-close" id="med-edit-close" aria-label="Cerrar">×</button>
    </header>

    <div id="med-edit-source-banner" class="source-banner" hidden>
      Esta medición fue importada desde Pre-recepción. Si el archivo origen
      se vuelve a subir, los cambios se sobrescribirán.
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Código</label>
        <input type="text" id="med-edit-code-input" disabled>
      </div>
      <div class="form-group">
        <label>Fecha</label>
        <input type="date" id="med-edit-date">
      </div>
      <div class="form-group">
        <label>Vendimia</label>
        <input type="number" id="med-edit-vintage" min="2020" max="2030">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Variedad</label>
        <select id="med-edit-variety"><option value="">—</option></select>
      </div>
      <div class="form-group">
        <label>Origen</label>
        <select id="med-edit-origin"><option value="">—</option></select>
      </div>
      <div class="form-group">
        <label>Lote</label>
        <input type="text" id="med-edit-lot">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Toneladas</label>
        <input type="number" id="med-edit-tons" step="0.01" min="0">
      </div>
      <div class="form-group">
        <label>Peso Prom. Baya (g)</label>
        <input type="number" id="med-edit-weight" step="0.01" min="0">
      </div>
      <div class="form-group">
        <label>Diámetro Prom. (mm)</label>
        <input type="number" id="med-edit-diameter" step="0.01" min="0">
      </div>
    </div>

    <div class="section-label" style="margin-top:12px;font-size:11px">Sorteo Sanitario</div>
    <div class="form-row health-row">
      <div class="form-group form-group-sm"><label>Madura</label>      <input type="number" id="med-edit-h-madura"      min="0"></div>
      <div class="form-group form-group-sm"><label>Inmadura</label>    <input type="number" id="med-edit-h-inmadura"    min="0"></div>
      <div class="form-group form-group-sm"><label>Sobremad.</label>   <input type="number" id="med-edit-h-sobremadura" min="0"></div>
      <div class="form-group form-group-sm"><label>Picadura</label>    <input type="number" id="med-edit-h-picadura"    min="0"></div>
      <div class="form-group form-group-sm"><label>Enferm.</label>     <input type="number" id="med-edit-h-enfermedad"  min="0"></div>
      <div class="form-group form-group-sm"><label>Quemad.</label>     <input type="number" id="med-edit-h-quemadura"   min="0"></div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Grado Sanitario</label>
        <select id="med-edit-grade">
          <option value="">— Seleccionar —</option>
          <option value="Excelente">Excelente</option>
          <option value="Bueno">Bueno</option>
          <option value="Regular">Regular</option>
          <option value="Malo">Malo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Madurez Fenólica</label>
        <select id="med-edit-phenolic-maturity">
          <option value="">—</option>
          <option value="Sobresaliente">Sobresaliente (+3)</option>
          <option value="Parcial">Parcial (0)</option>
          <option value="No sobresaliente">No sobresaliente (−3)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Medido por</label>
        <input type="text" id="med-edit-by">
      </div>
      <div class="form-group">
        <label>Notas</label>
        <input type="text" id="med-edit-notes">
      </div>
    </div>

    <footer class="modal-footer">
      <button type="button" class="btn-danger" id="med-edit-delete">Eliminar</button>
      <span id="med-edit-status" class="form-status"></span>
      <button type="button" class="btn-secondary" id="med-edit-cancel">Cancelar</button>
      <button type="button" class="btn-gold"      id="med-edit-save" disabled>Guardar cambios</button>
    </footer>
  </form>
</dialog>
```

- [ ] **Step 3: Manual visual smoke**

```bash
npm run dev
```

Open the dashboard, navigate to Mediciones. Confirm the search input appears above the table and the modal markup is hidden (it's a `<dialog>` without `open`). Run in DevTools console:

```js
document.getElementById('med-edit-modal').showModal();
```

The unstyled modal should appear; verify all field IDs are present. Close with `document.getElementById('med-edit-modal').close();`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(mediciones): add edit-modal markup + table search toolbar (Round 37)"
```

---

## Task 11: css/styles.css — modal + interactivity styles

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Append the new style rules**

Append to `css/styles.css`:

```css
/* ── Round 37: editable-table styles ── */

/* Sort arrows (driven by aria-sort, set by mediciones.js after each render) */
.data-table th[data-sort]                   { cursor: pointer; user-select: none; }
.data-table th[aria-sort="ascending"]::after  { content: " ▲"; opacity: 0.7; font-size: 0.85em; }
.data-table th[aria-sort="descending"]::after { content: " ▼"; opacity: 0.7; font-size: 0.85em; }

/* Hover + clickable affordance (the row gets `row-clickable` only when the
   user is `lab` and demo mode is inactive — see mediciones.js:renderTable) */
.data-table tbody tr.row-clickable          { cursor: pointer; }
.data-table tbody tr:hover                  { background: rgba(212, 175, 55, 0.08); }

/* Table toolbar (search + heading + count) */
.table-toolbar {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 12px; flex-wrap: wrap;
}
.table-toolbar .section-label    { margin: 0; }
.table-toolbar .table-toolbar-count { margin-left: auto; color: var(--muted); font-size: 11px; }
.table-search {
  flex: 1 1 240px; min-width: 200px;
  padding: 6px 10px; border: 1px solid var(--border, #ddd); border-radius: 4px;
  font-size: 12px;
}

/* Edit modal */
.row-edit-modal              { padding: 0; border: none; border-radius: 6px; max-width: 800px; width: 90vw; }
.row-edit-modal::backdrop    { background: rgba(0,0,0,0.45); }
.row-edit-modal form         { padding: 20px 24px; }
.row-edit-modal .modal-header   { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--border, #ddd); padding-bottom: 12px; }
.row-edit-modal .modal-header h2 { margin: 0; font-size: 16px; flex: 1 1 auto; }
.row-edit-modal .modal-audit-line { margin: 4px 0 0 0; font-size: 11px; color: var(--muted); flex-basis: 100%; }
.row-edit-modal .modal-close   { background: none; border: none; font-size: 22px; cursor: pointer; line-height: 1; }
.row-edit-modal .modal-footer  { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border, #ddd); }
.row-edit-modal .modal-footer .btn-secondary { margin-left: auto; }
.btn-danger {
  background: #c0392b; color: #fff; border: none; padding: 8px 14px;
  border-radius: 4px; cursor: pointer; font-size: 12px;
}
.btn-danger:hover { background: #a93226; }
.btn-secondary {
  background: transparent; color: var(--text, #333); border: 1px solid var(--border, #ddd);
  padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
}

/* Source-banner (only visible for source='upload' rows) */
.source-banner {
  background: rgba(245, 197, 66, 0.18); border-left: 3px solid #F5C542;
  padding: 8px 12px; margin-bottom: 12px; font-size: 11px; color: #6B5A1A;
}

/* Dirty-field marker */
.field-dirty input,
.field-dirty select { border-left: 3px solid #d4af37; }

/* Permission-driven hides (body classes set by auth.js) */
body:not(.can-write)  #medicion-form,
body:not(.can-write)  .row-clickable        { display: none; }
body:not(.can-export) .page-export-btn      { display: none; }

/* Demo-mode hides write affordances even for lab users */
body.demo-mode-active #medicion-form,
body.demo-mode-active .row-clickable        { display: none; }

/* Mobile: modal full-screen */
@media (max-width: 720px) {
  .row-edit-modal      { width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; }
  .row-edit-modal form { padding: 16px; }
  .table-toolbar       { gap: 8px; }
  .table-search        { font-size: 13px; }
}
```

- [ ] **Step 2: Manual visual smoke**

```bash
npm run dev
```

In DevTools console, open the modal:

```js
document.getElementById('med-edit-modal').showModal();
```

Verify: backdrop dims the page, modal sits centered, fields are styled, footer has the gold/red/secondary buttons. Resize the viewport below 720px — modal should stretch full-screen.

Close with the × button (handler not bound yet — close manually):

```js
document.getElementById('med-edit-modal').close();
```

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "style(mediciones): edit-modal + sort arrows + table toolbar styles"
```

---

## Task 12: Mediciones pure helpers + mt19 tests

Pure helpers extracted up front, so the integration code in Tasks 13–16 can lean on tested primitives. These three helpers (`collectDirty`, `ariaSortFor`, `shouldShowSourceBanner`) cover the testable parts of the modal logic without needing a DOM.

**Files:**
- Modify: `js/mediciones.js`
- Create: `tests/mt19-mediciones-edit.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/mt19-mediciones-edit.test.mjs`:

```js
// MT.19 — Mediciones edit helpers (pure functions, no DOM).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectDirty, ariaSortFor, shouldShowSourceBanner } from '../js/mediciones.js';

describe('MT.19 — collectDirty', () => {
  it('returns empty when no fields differ', () => {
    const initial = { a: 1, b: 2, c: 'x' };
    const current = { a: 1, b: 2, c: 'x' };
    assert.deepEqual(collectDirty(initial, current), {});
  });

  it('returns only the changed fields', () => {
    const initial = { a: 1, b: 2, c: 'x' };
    const current = { a: 1, b: 5, c: 'y' };
    assert.deepEqual(collectDirty(initial, current), { b: 5, c: 'y' });
  });

  it('treats null and undefined as equal so blank fields don\'t show as dirty', () => {
    const initial = { a: null };
    const current = { a: undefined };
    assert.deepEqual(collectDirty(initial, current), {});
  });

  it('detects a value reverted to its initial as no-longer-dirty', () => {
    const initial = { a: 1 };
    const current = { a: 1 };  // user typed and re-typed the same
    assert.deepEqual(collectDirty(initial, current), {});
  });
});

describe('MT.19 — ariaSortFor', () => {
  it('returns "ascending" or "descending" for the active column', () => {
    assert.equal(ariaSortFor('date', true,  'date'), 'ascending');
    assert.equal(ariaSortFor('date', false, 'date'), 'descending');
  });

  it('returns null for a non-active column', () => {
    assert.equal(ariaSortFor('date', true, 'variety'), null);
  });
});

describe('MT.19 — shouldShowSourceBanner', () => {
  it('returns true for upload-source rows', () => {
    assert.equal(shouldShowSourceBanner({ source: 'upload' }), true);
  });

  it('returns false for form-source rows', () => {
    assert.equal(shouldShowSourceBanner({ source: 'form' }), false);
  });

  it('returns false when source is missing (defensive)', () => {
    assert.equal(shouldShowSourceBanner({}), false);
  });
});
```

- [ ] **Step 2: Run, verify it fails (helpers don't exist)**

```bash
npm test -- --test-name-pattern="MT.19"
```

Expected: ImportError or "is not a function" for the missing exports.

- [ ] **Step 3: Add the helpers as named exports of `js/mediciones.js`**

Open `js/mediciones.js`. Below the `import` block at the top of the file, add:

```js
// ── Pure helpers (exported for tests; used by methods on Mediciones below) ──

export function collectDirty(initial, current) {
  const out = {};
  const keys = new Set([...Object.keys(initial || {}), ...Object.keys(current || {})]);
  for (const k of keys) {
    const a = initial?.[k];
    const b = current?.[k];
    // Treat null/undefined as equivalent so a never-touched blank field
    // doesn't register as dirty when the input emits an empty-string value.
    if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
    if (a !== b) out[k] = b;
  }
  return out;
}

export function ariaSortFor(activeField, ascending, columnField) {
  if (activeField !== columnField) return null;
  return ascending ? 'ascending' : 'descending';
}

export function shouldShowSourceBanner(row) {
  return !!row && row.source === 'upload';
}
```

These exports coexist with the existing default `Mediciones` object — no conflicts.

- [ ] **Step 4: Run, verify all MT.19 tests pass**

```bash
npm test -- --test-name-pattern="MT.19"
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/mediciones.js tests/mt19-mediciones-edit.test.mjs
git commit -m "feat(mediciones): pure helpers (collectDirty, ariaSortFor, source banner)"
```

---

## Task 13: openEditModal — populate fields, audit line, source banner

**Files:**
- Modify: `js/mediciones.js`

- [ ] **Step 1: Add modal-open / modal-close methods**

In `js/mediciones.js`, inside the `Mediciones` object (alongside `submitForm`, `_setStatus`, etc.), add:

```js
  // ── Edit modal ──
  _editing: null,        // the row being edited (deep-clone snapshot)
  _editingId: null,      // medicion_code (immutable while modal is open)

  openEditModal(medicion_code) {
    const row = (DataStore.medicionesData || []).find(r => r.code === medicion_code);
    if (!row) return;
    this._editing = JSON.parse(JSON.stringify(row));
    this._editingId = medicion_code;

    document.getElementById('med-edit-code').textContent = medicion_code;
    document.getElementById('med-edit-code-input').value = medicion_code;

    // Audit line
    const auditEl = document.getElementById('med-edit-audit');
    if (row.lastEditedAt) {
      const dt = new Date(row.lastEditedAt).toLocaleString('es-MX', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
      auditEl.textContent = `Última edición: ${dt}${row.lastEditedBy ? ' por ' + row.lastEditedBy : ''}`;
    } else {
      auditEl.textContent = 'Sin ediciones previas';
    }

    // Source banner
    const banner = document.getElementById('med-edit-source-banner');
    if (banner) banner.hidden = !shouldShowSourceBanner({ source: row.source });

    // Populate fields from the row
    document.getElementById('med-edit-date').value     = row.date || '';
    document.getElementById('med-edit-vintage').value  = row.vintage ?? '';
    this._populateEditDropdowns(row);
    document.getElementById('med-edit-lot').value      = row.lotCode || '';
    document.getElementById('med-edit-tons').value     = row.tons ?? '';
    document.getElementById('med-edit-weight').value   = row.berryWeight ?? '';
    document.getElementById('med-edit-diameter').value = row.berryDiameter ?? '';
    document.getElementById('med-edit-h-madura').value      = row.healthMadura      ?? 0;
    document.getElementById('med-edit-h-inmadura').value    = row.healthInmadura    ?? 0;
    document.getElementById('med-edit-h-sobremadura').value = row.healthSobremadura ?? 0;
    document.getElementById('med-edit-h-picadura').value    = row.healthPicadura    ?? 0;
    document.getElementById('med-edit-h-enfermedad').value  = row.healthEnfermedad  ?? 0;
    document.getElementById('med-edit-h-quemadura').value   = row.healthQuemadura   ?? 0;
    document.getElementById('med-edit-grade').value           = row.healthGrade      || '';
    document.getElementById('med-edit-phenolic-maturity').value = row.phenolicMaturity || '';
    document.getElementById('med-edit-by').value    = row.measuredBy || '';
    document.getElementById('med-edit-notes').value = row.notes      || '';

    this._editStatus('', '');
    this._refreshDirtyState();

    document.getElementById('med-edit-modal').showModal();
  },

  closeEditModal({ force = false } = {}) {
    const dirtyKeys = Object.keys(this._collectFormDirty());
    if (!force && dirtyKeys.length) {
      if (!confirm('Hay cambios sin guardar. ¿Descartar?')) return;
    }
    this._editing = null;
    this._editingId = null;
    document.getElementById('med-edit-modal').close();
  },

  _populateEditDropdowns(row) {
    const varietyEl = document.getElementById('med-edit-variety');
    const originEl  = document.getElementById('med-edit-origin');
    if (!varietyEl.options.length || varietyEl.options.length < 2) {
      const allVarieties = [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white].sort();
      varietyEl.innerHTML = '<option value="">— Seleccionar —</option>' +
        allVarieties.map(v => `<option value="${v}">${v}</option>`).join('');
      const origins = Object.keys(CONFIG.originColors).sort();
      originEl.innerHTML = '<option value="">— Seleccionar —</option>' +
        origins.map(o => `<option value="${o}">${o}</option>`).join('');
    }
    varietyEl.value = row.variety || '';
    originEl.value  = row.appellation || '';
  },

  _editStatus(msg, type) {
    const el = document.getElementById('med-edit-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'form-status' + (type ? ' ' + type : '');
  },

  // Read current form values, mapped to the same shape as DataStore.medicionesData.
  _readEditForm() {
    const num = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : parseFloat(v);
    };
    const intv = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : parseInt(v, 10);
    };
    const str = (id) => {
      const v = document.getElementById(id)?.value;
      return v === '' || v == null ? null : v.trim();
    };
    return {
      date:           document.getElementById('med-edit-date').value || null,
      vintage:        intv('med-edit-vintage'),
      variety:        str('med-edit-variety'),
      appellation:    str('med-edit-origin'),
      lotCode:        str('med-edit-lot'),
      tons:           num('med-edit-tons'),
      berryWeight:    num('med-edit-weight'),
      berryDiameter: num('med-edit-diameter'),
      healthMadura:      intv('med-edit-h-madura')      ?? 0,
      healthInmadura:    intv('med-edit-h-inmadura')    ?? 0,
      healthSobremadura: intv('med-edit-h-sobremadura') ?? 0,
      healthPicadura:    intv('med-edit-h-picadura')    ?? 0,
      healthEnfermedad:  intv('med-edit-h-enfermedad')  ?? 0,
      healthQuemadura:   intv('med-edit-h-quemadura')   ?? 0,
      healthGrade:       str('med-edit-grade'),
      phenolicMaturity: str('med-edit-phenolic-maturity'),
      measuredBy: str('med-edit-by'),
      notes:      str('med-edit-notes'),
    };
  },

  // Compare current form against the snapshot taken at openEditModal.
  _collectFormDirty() {
    if (!this._editing) return {};
    return collectDirty(this._editing, this._readEditForm());
  },

  // Update Save button + dirty-class outlines on every input event.
  _refreshDirtyState() {
    const dirty = this._collectFormDirty();
    const saveBtn = document.getElementById('med-edit-save');
    if (saveBtn) saveBtn.disabled = Object.keys(dirty).length === 0;

    // Toggle .field-dirty on the form-group of each dirty input. Map of
    // dirty-row-key → DOM element id is tracked here for clarity.
    const fieldMap = {
      date: 'med-edit-date',                vintage: 'med-edit-vintage',
      variety: 'med-edit-variety',          appellation: 'med-edit-origin',
      lotCode: 'med-edit-lot',              tons: 'med-edit-tons',
      berryWeight: 'med-edit-weight',       berryDiameter: 'med-edit-diameter',
      healthMadura: 'med-edit-h-madura',    healthInmadura: 'med-edit-h-inmadura',
      healthSobremadura: 'med-edit-h-sobremadura', healthPicadura: 'med-edit-h-picadura',
      healthEnfermedad: 'med-edit-h-enfermedad',   healthQuemadura: 'med-edit-h-quemadura',
      healthGrade: 'med-edit-grade',        phenolicMaturity: 'med-edit-phenolic-maturity',
      measuredBy: 'med-edit-by',            notes: 'med-edit-notes',
    };
    Object.entries(fieldMap).forEach(([rowKey, inputId]) => {
      const el = document.getElementById(inputId);
      if (!el) return;
      const group = el.closest('.form-group');
      if (!group) return;
      group.classList.toggle('field-dirty', rowKey in dirty);
    });
  },
```

You'll also need to import `shouldShowSourceBanner` and `collectDirty` at the top of the file — but they're already exported from this same file, so they're in scope without an import.

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```

Navigate to Mediciones (you must be logged in as `lab`). In DevTools console:

```js
Mediciones.openEditModal(DataStore.medicionesData[0].code);
```

Verify the modal opens with the right data populated, audit line shows correctly, source banner appears for `source: 'upload'` rows. Type in a field — it should pick up the gold left-border. Type back to the original value — border clears, Save button disables.

Close via DevTools (close button isn't wired yet):

```js
document.getElementById('med-edit-modal').close();
```

- [ ] **Step 3: Commit**

```bash
git add js/mediciones.js
git commit -m "feat(mediciones): openEditModal — populate, audit line, dirty tracking"
```

---

## Task 14: submitEdit + submitDelete

**Files:**
- Modify: `js/mediciones.js`

- [ ] **Step 1: Add the two write methods**

Append to the `Mediciones` object in `js/mediciones.js`:

```js
  async submitEdit() {
    if (!this._editingId) return;
    if (DemoMode.isActive()) {
      this._editStatus('Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    const dirty = this._collectFormDirty();
    if (!Object.keys(dirty).length) return;

    // Map UI keys → DB columns
    const dbRow = { medicion_code: this._editingId };
    if ('date'             in dirty) dbRow.medicion_date     = dirty.date;
    if ('vintage'          in dirty) dbRow.vintage_year      = dirty.vintage;
    if ('variety'          in dirty) dbRow.variety           = dirty.variety;
    if ('appellation'      in dirty) dbRow.appellation       = dirty.appellation;
    if ('lotCode'          in dirty) dbRow.lot_code          = dirty.lotCode;
    if ('tons'             in dirty) dbRow.tons_received     = dirty.tons;
    if ('berryWeight'      in dirty) dbRow.berry_avg_weight_g = dirty.berryWeight;
    if ('berryDiameter'    in dirty) dbRow.berry_diameter_mm = dirty.berryDiameter;
    if ('healthMadura'     in dirty) dbRow.health_madura     = dirty.healthMadura;
    if ('healthInmadura'   in dirty) dbRow.health_inmadura   = dirty.healthInmadura;
    if ('healthSobremadura' in dirty) dbRow.health_sobremadura = dirty.healthSobremadura;
    if ('healthPicadura'   in dirty) dbRow.health_picadura   = dirty.healthPicadura;
    if ('healthEnfermedad' in dirty) dbRow.health_enfermedad = dirty.healthEnfermedad;
    if ('healthQuemadura'  in dirty) dbRow.health_quemadura  = dirty.healthQuemadura;
    if ('healthGrade'      in dirty) dbRow.health_grade      = dirty.healthGrade;
    if ('phenolicMaturity' in dirty) dbRow.phenolic_maturity = dirty.phenolicMaturity;
    if ('measuredBy'       in dirty) dbRow.measured_by       = dirty.measuredBy;
    if ('notes'            in dirty) dbRow.notes             = dirty.notes;

    const saveBtn = document.getElementById('med-edit-save');
    if (saveBtn) saveBtn.disabled = true;
    this._editStatus('Guardando...', '');

    try {
      const token = localStorage.getItem('xanic_session_token');
      const res = await fetch('/api/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({ table: 'mediciones_tecnicas', action: 'update', row: dbRow }),
      });
      const data = await res.json();
      if (data.ok) {
        await DataStore.loadMediciones();   // re-fetch so the join with berry data re-runs
        this.refresh();
        this.closeEditModal({ force: true });
      } else {
        this._editStatus(data.error || `Error (${res.status})`, 'error');
        if (saveBtn) saveBtn.disabled = false;
      }
    } catch (e) {
      console.error('[Mediciones] submitEdit network error:', e);
      this._editStatus('Error de conexión: ' + e.message, 'error');
      if (saveBtn) saveBtn.disabled = false;
    }
  },

  async submitDelete() {
    if (!this._editingId) return;
    if (DemoMode.isActive()) {
      this._editStatus('Modo demo — no se pueden guardar cambios', 'error');
      return;
    }
    if (!confirm(`¿Eliminar medición ${this._editingId}? Esta acción no se puede deshacer.`)) return;

    this._editStatus('Eliminando...', '');
    try {
      const token = localStorage.getItem('xanic_session_token');
      const res = await fetch('/api/row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': token || '' },
        body: JSON.stringify({
          table: 'mediciones_tecnicas', action: 'delete',
          row: { medicion_code: this._editingId },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await DataStore.loadMediciones();
        this.refresh();
        this.closeEditModal({ force: true });
      } else {
        this._editStatus(data.error || `Error (${res.status})`, 'error');
      }
    } catch (e) {
      console.error('[Mediciones] submitDelete network error:', e);
      this._editStatus('Error de conexión: ' + e.message, 'error');
    }
  },
```

- [ ] **Step 2: Add the import for `DemoMode`**

At the top of `js/mediciones.js`, add to the existing imports:

```js
import { DemoMode } from './demoMode.js';
```

- [ ] **Step 3: Surface `lastEditedAt` and `lastEditedBy` in `_rowToMedicion`**

The audit line in `openEditModal` reads `row.lastEditedAt` / `row.lastEditedBy`, but the existing `_rowToMedicion` mapping in `js/dataLoader.js` doesn't surface these columns. Open `js/dataLoader.js` and find `_rowToMedicion` (line 110). Add at the bottom of the returned object:

```js
      lastEditedAt: row.last_edited_at || null,
      lastEditedBy: row.last_edited_by || null,
      source:       row.source || 'form',  // ensure shouldShowSourceBanner has data
```

(Some existing rows may not have `source` populated if Round 35 left any nulls — defaulting to `'form'` is the safe fallback.)

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Log in as `lab`. Open the modal on a row, change `Notas` to "test edit". Open DevTools → Network. Click Save. Verify:
- Network tab shows POST to `/api/row` with `action: 'update'` and only the changed fields plus `medicion_code`.
- Response is `{ ok: true, row: {...} }`.
- Modal closes; row in the table updates; KPIs / charts reflect the new value.
- Re-open the same row → audit line now reads "Última edición: <today, hh:mm> por <lab username>".

Then click Eliminar on a test row → confirm dialog → confirm. Row disappears from table and KPI count drops by one.

> Make sure to do this against a non-production database, or revert your edits via Supabase SQL Editor afterwards.

- [ ] **Step 5: Commit**

```bash
git add js/mediciones.js js/dataLoader.js
git commit -m "feat(mediciones): submitEdit + submitDelete via /api/row (Round 37)"
```

---

## Task 15: Search + global filter wire-in + aria-sort

**Files:**
- Modify: `js/mediciones.js`

- [ ] **Step 1: Add the filter pipeline**

Inside `Mediciones`, replace the existing `refresh()` method with:

```js
  // Search state — populated by events.js on input.
  _searchTerm: '',

  refresh() {
    const raw = DataStore.medicionesData || [];
    const filtered = this._applyGlobalFilters(raw);
    this.updateKPIs(filtered);
    this.renderCharts(filtered);
    this.renderTable(this._applySearch(filtered));  // search affects table only
  },

  _applyGlobalFilters(rows) {
    const s = Filters.state || {};
    return rows.filter(r => {
      if (s.vintages?.size  && !s.vintages.has(String(r.vintage))) return false;
      if (s.varieties?.size && !s.varieties.has(r.variety))        return false;
      if (s.origins?.size   && !s.origins.has(r.appellation))      return false;
      // Lot filter is more permissive — match either lotCode or appellation prefix
      if (s.lots?.size      && r.lotCode && !s.lots.has(r.lotCode)) return false;
      return true;
    });
  },

  _applySearch(rows) {
    const term = (this._searchTerm || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => {
      const haystack = [r.code, r.variety, r.appellation, r.lotCode, r.notes, r.measuredBy]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  },

  setSearch(term) {
    this._searchTerm = term;
    // Re-render only the table (KPIs / charts already reflect the filtered set).
    this.renderTable(this._applySearch(this._applyGlobalFilters(DataStore.medicionesData || [])));
  },
```

Add the import for `Filters` at the top of `js/mediciones.js`:

```js
import { Filters } from './filters.js';
```

- [ ] **Step 2: Add aria-sort toggle inside `renderTable`**

Find the existing `renderTable` method. After the line `if (countEl) countEl.textContent = ...`, add:

```js
    // Sort indicator — driven by aria-sort, styled in CSS
    const table = document.getElementById('mediciones-table');
    if (table) {
      table.querySelectorAll('th[data-sort]').forEach(th => th.removeAttribute('aria-sort'));
      const active = table.querySelector(`th[data-sort="${this._sortField}"]`);
      const sort = ariaSortFor(this._sortField, this._sortAsc, this._sortField);
      if (active && sort) active.setAttribute('aria-sort', sort);
    }
```

- [ ] **Step 3: Add `row-clickable` class to rendered rows**

In the same `renderTable`, find the `tbody.innerHTML = sorted.map(d => ...)` block. Modify the opening `<tr>` to:

```js
return `<tr class="${Auth.canWrite() && !DemoMode.isActive() ? 'row-clickable' : ''}" data-code="${esc(d.code)}">
```

Then at the top of the file, add the import (if not already present):

```js
import { Auth } from './auth.js';
```

- [ ] **Step 4: Update the empty-state text to be filter-aware**

Inside `renderTable`, replace the existing `noData.style.display = data.length ? 'none' : ''` line with:

```js
    if (noData) {
      noData.style.display = data.length ? 'none' : '';
      const hasFilter = (Filters.state?.vintages?.size || Filters.state?.varieties?.size ||
                        Filters.state?.origins?.size || Filters.state?.lots?.size ||
                        (this._searchTerm || '').trim().length > 0);
      noData.textContent = hasFilter
        ? 'No hay mediciones que coincidan con los filtros actuales.'
        : 'No hay mediciones registradas. Use el formulario para agregar la primera.';
    }
```

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
```

- Click a column header — `aria-sort` updates on the active TH (Inspect element to confirm), arrow appears via CSS.
- Type in the search box — table narrows; KPIs and charts stay full.
- Toggle a global Variedad chip — KPIs / charts / table all narrow together.
- Clear all filters / search — empty-state message switches between the two text variants.

(Search input listener is wired in Task 16 — for this step you can drive it from DevTools: `Mediciones.setSearch('CSMX')`.)

- [ ] **Step 6: Commit**

```bash
git add js/mediciones.js
git commit -m "feat(mediciones): aria-sort arrows, search, global filter wire-in"
```

---

## Task 16: events.js — wire row click, modal close, search, delete

**Files:**
- Modify: `js/events.js`

- [ ] **Step 1: Add the new bindings**

Find the existing `bindMedicionesView()` method in `js/events.js` (around line 425). It currently binds the form submit and the column-header sort click. Append:

```js
    // Row click → open edit modal (only on `.row-clickable` rows)
    const tbody = document.getElementById('med-table-body');
    if (tbody) tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.row-clickable');
      if (!tr) return;
      const code = tr.dataset.code;
      if (code) Mediciones.openEditModal(code);
    });

    // Modal close — close button, Cancel button, ESC (native via <dialog>),
    // backdrop click. Each path routes through closeEditModal so the
    // discard-confirm fires on dirty state.
    document.getElementById('med-edit-close')?.addEventListener('click',
      () => Mediciones.closeEditModal());
    document.getElementById('med-edit-cancel')?.addEventListener('click',
      () => Mediciones.closeEditModal());
    const modal = document.getElementById('med-edit-modal');
    if (modal) {
      modal.addEventListener('cancel', (e) => {
        // ESC fires this — intercept so we can run the dirty-discard check
        e.preventDefault();
        Mediciones.closeEditModal();
      });
      modal.addEventListener('click', (e) => {
        // Backdrop click: <dialog> reports e.target === modal when the
        // user clicks outside the form's bounding box.
        if (e.target === modal) Mediciones.closeEditModal();
      });
    }

    // Save + Delete buttons
    document.getElementById('med-edit-save')?.addEventListener('click',
      () => Mediciones.submitEdit());
    document.getElementById('med-edit-delete')?.addEventListener('click',
      () => Mediciones.submitDelete());

    // Live dirty tracking — every input inside the modal triggers a refresh
    document.getElementById('med-edit-form')?.addEventListener('input',
      () => Mediciones._refreshDirtyState());

    // Search input (debounced)
    const searchEl = document.getElementById('med-search');
    if (searchEl) {
      let t;
      searchEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => Mediciones.setSearch(searchEl.value), 200);
      });
    }
```

- [ ] **Step 2: Verify import of `Mediciones`**

The existing file already imports `Mediciones` (used by the column-sort handler at line 433). No import changes needed.

- [ ] **Step 3: Manual smoke — full flow**

```bash
npm run dev
```

Log in as `lab`. From a clean page reload:
- Click any row in the mediciones table → modal opens.
- Type into Notas → field gets gold border, Save enables.
- Click ESC → discard-confirm fires.
- Click ESC again, confirm yes → modal closes.
- Re-open, change Notas, click Save → modal closes, table reflects new value.
- Re-open, click Eliminar → confirm fires, accept → row gone.
- Type in search input → table narrows; KPIs unchanged.

Now log in as `admin`:
- Form is hidden, rows are not hoverable, no edit cursor, no migration banner.
- Page-export buttons still visible (admin = view + export).

As `viewer`:
- Page-export buttons hidden.

- [ ] **Step 4: Commit**

```bash
git add js/events.js
git commit -m "feat(events): wire row click, modal close, search, delete (Round 37)"
```

---

## Task 17: Demo mode runtime guards (belt-and-suspenders)

The CSS in Task 11 already hides write controls under `body.demo-mode-active`. This task adds runtime guards inside the submit functions, mirroring the existing upload pattern, so any future code path that bypasses the CSS still can't write.

**Files:**
- Modify: `js/mediciones.js`

- [ ] **Step 1: Verify the demo guards are present in the methods written in Tasks 13–14**

Tasks 13–14 already added `if (DemoMode.isActive()) { … return; }` at the top of `submitEdit` and `submitDelete`. Confirm those exist. If they don't, add them:

```js
if (DemoMode.isActive()) {
  this._editStatus('Modo demo — no se pueden guardar cambios', 'error');
  return;
}
```

- [ ] **Step 2: Add the same guard to `submitForm`**

The existing `submitForm` (line 30 in the original file) doesn't have a demo-mode check. Add one at the top of the method body, before the existing field reads:

```js
async submitForm() {
  if (DemoMode.isActive()) {
    this._setStatus('Modo demo — no se pueden guardar cambios', 'error');
    return;
  }
  // ... existing implementation ...
}
```

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Log in as `lab`. Activate demo mode (whatever the existing UI flow is — likely a button somewhere on the dashboard, or `DemoMode.enable()` from DevTools). Verify:

- Mediciones form input area is hidden.
- Rows have no clickable cursor.
- Forcing `Mediciones.openEditModal('<some code>')` from DevTools opens the modal anyway. Type a change and click Save → status reads "Modo demo — no se pueden guardar cambios"; no network request fires.

Disable demo mode → write paths return.

- [ ] **Step 4: Commit**

```bash
git add js/mediciones.js
git commit -m "feat(mediciones): demo-mode runtime guards on form/edit/delete"
```

---

## Task 18: Final verification — full suite + manual walkthrough + push

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: every existing test passes plus mt18 (7) + mt19 (9) + mt20 (13) = 29 new passing tests, ~101 total. If anything is red, diagnose root cause and fix before proceeding (per CLAUDE.md "Identify root cause before patching").

- [ ] **Step 2: Run e2e smoke (optional but recommended)**

```bash
npm run test:e2e
```

If existing e2e tests fail because of the role-rework or new modal markup, update them. (Failures here are likely if any e2e test logs in as `admin` and tries to upload.)

- [ ] **Step 3: Run the SQL migration**

In the Supabase SQL editor for the **production** project, paste the contents of `sql/migration_mediciones_audit.sql` and execute. Verify in the Table editor that `mediciones_tecnicas` now has `last_edited_at` and `last_edited_by` columns, and that `applied_migrations` has the new entry.

- [ ] **Step 4: Manual walkthrough on the deployed preview (or local)**

Cover all bullets from the spec's §11 manual UI walkthrough:
- As `lab`: edit form-row → save → audit line appears.
- As `lab`: edit upload-row → yellow source banner shown.
- As `lab`: delete a row → confirm dialog → row removed.
- As `lab`: open modal, change a field, hit Cancel → discard-confirm fires.
- As `lab`: type `foo` in brix in the modal → Save disabled (validation), Spanish field error in status.
- As `admin`: page renders, no edit affordance, no upload form, no migration banner; export buttons visible.
- As `viewer`: page renders, no export buttons.
- Activate demo mode as `lab`: write controls hidden, search still works.
- Mobile (≤720px): modal full-screen, fields stack.

If any step fails, file a follow-up issue and fix before pushing — do not push half-broken work per CLAUDE.md.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Verify the push succeeded (per CLAUDE.md: do not say "done" until `git push` succeeds and output is shown). Verify the Vercel deployment turns green.

- [ ] **Step 6: Final summary commit (optional)**

If the round needs a wrap-up doc entry (e.g. `docs/Roadmap.md`), add a line referencing the spec/plan and commit it.

```bash
git add docs/Roadmap.md
git commit -m "docs: Round 37 summary — mediciones edit/delete + interactive table"
git push origin main
```

---

## Self-Review Notes

**Spec coverage:** every numbered section of the spec has at least one task:
- §4 permission matrix → Tasks 4, 5, 9
- §5 schema migration → Task 1
- §6 server endpoint → Tasks 6, 7, 8
- §7 validation module → Tasks 2, 3
- §8 modal → Tasks 10, 11, 13, 14, 16
- §9 table interactivity → Tasks 11, 15, 16
- §10 demo mode → Tasks 11, 17
- §11 testing → Tasks 2, 8, 12, 18
- §12 rollout → Task 18

**Type consistency:** the helper signatures (`collectDirty(initial, current)`,
`ariaSortFor(activeField, ascending, columnField)`,
`shouldShowSourceBanner(row)`) are referenced consistently across Tasks 12,
13, 14, 15. The mediciones-row shape (`code`, `date`, `vintage`, `variety`,
`appellation`, `lotCode`, `tons`, `berryWeight`, `berryDiameter`, `health*`,
`healthGrade`, `phenolicMaturity`, `measuredBy`, `notes`, `source`,
`lastEditedAt`, `lastEditedBy`) is the same in `dataLoader._rowToMedicion`
and in `_readEditForm` / `_collectFormDirty`. The DB-column shape used in
`submitEdit`'s `dbRow` mirrors the `mediciones_tecnicas.columns` allowlist
in `api/upload.js`.

**Spec gap fixed:** Task 4 adds `user` to the JWT payload because the spec
assumed `result.payload.username` exists, but the JWT only carries
`{ exp, role, nonce }` today. Task 7's endpoint includes the
`'lab'` fallback for in-flight sessions issued before this deploy.
