// MT.60 — the login rate limiter is one atomic server-side call (bead xd-tqx).
//
// checkRateLimit() used to GET the rate_limits row, add 1 in JS, then PATCH (or
// upsert a new window). N overlapping logins from one IP all read the same
// count, all decided they were under the limit, and all wrote back the same
// value, so parallel load blew straight through MAX_ATTEMPTS. The fix is a
// Postgres function (sql/migration_login_rate_limit_atomic.sql) that creates or
// increments the row under its row lock and returns whether the caller is
// allowed; the client does no arithmetic.
//
// The fake backend below serves BOTH the old REST routes (GET/POST/PATCH/DELETE
// on rate_limits, each answering after a tick, the way a network round trip
// interleaves) and the new rpc, which mutates its store in one synchronous step
// the way the row lock serialises it in Postgres. Against the old code the
// concurrency case lets every request in; against the fix exactly MAX through.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { checkRateLimit } = await import('../api/_lib/loginRateLimit.js');

const MAX_ATTEMPTS = 10;
const RPC = '/rest/v1/rpc/login_rate_limit_hit';

function resp({ ok = true, status = 200, body } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body ?? '') };
}
const tick = () => new Promise(r => setTimeout(r, 1));

// A tiny rate_limits table. `calls` records every request for assertions.
function fakeBackend() {
  const rows = new Map();
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const u = new URL(String(url));
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path: u.pathname, body });

    if (u.pathname === RPC) {
      // Atomic: read, decide and write happen with no await in between.
      const now = Date.now();
      const windowMs = body.p_window_seconds * 1000;
      const row = rows.get(body.p_ip);
      if (!row || row.window_start < now - windowMs) {
        rows.set(body.p_ip, { attempts: 1, window_start: now });
      } else {
        row.attempts = Math.min(row.attempts + 1, body.p_max + 1);
      }
      const allowed = rows.get(body.p_ip).attempts <= body.p_max;
      await tick();
      return resp({ body: allowed });
    }

    // Old read-modify-write routes: the response lands a tick later, so
    // overlapping requests interleave between their read and their write.
    const ip = (u.searchParams.get('ip') || '').replace(/^eq\./, '');
    await tick();
    if (method === 'DELETE') return resp({ status: 204 });
    if (method === 'GET') {
      const row = rows.get(ip);
      return resp({ body: row ? [{ attempts: row.attempts, window_start: new Date(row.window_start).toISOString() }] : [] });
    }
    if (method === 'POST') {
      rows.set(body.ip, { attempts: body.attempts, window_start: Date.parse(body.window_start) });
      return resp({ status: 201 });
    }
    if (method === 'PATCH') {
      rows.get(ip).attempts = body.attempts;
      return resp({ status: 204 });
    }
    return resp({ ok: false, status: 404, body: {} });
  };
  return { fetch, rows, calls };
}

describe('MT.60 — concurrent login attempts cannot exceed MAX_ATTEMPTS', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('30 overlapping attempts from one IP: exactly MAX_ATTEMPTS are allowed', async () => {
    const be = fakeBackend();
    globalThis.fetch = be.fetch;

    const results = await Promise.all(
      Array.from({ length: 30 }, () => checkRateLimit('192.0.2.60'))
    );
    const allowed = results.filter(Boolean).length;
    assert.equal(allowed, MAX_ATTEMPTS,
      `parallel attempts must not exceed the limit; ${allowed} were allowed`);
  });

  it('each attempt is ONE rpc round trip; no client-side read or write of rate_limits', async () => {
    const be = fakeBackend();
    globalThis.fetch = be.fetch;

    await checkRateLimit('192.0.2.61');
    assert.equal(be.calls.length, 1, 'one call per attempt');
    assert.equal(be.calls[0].method, 'POST');
    assert.equal(be.calls[0].path, RPC);
    assert.deepEqual(be.calls[0].body, { p_ip: '192.0.2.61', p_window_seconds: 900, p_max: MAX_ATTEMPTS });
  });

  it('two IPs in parallel keep separate counters', async () => {
    const be = fakeBackend();
    globalThis.fetch = be.fetch;

    const a = Promise.all(Array.from({ length: 15 }, () => checkRateLimit('192.0.2.62')));
    const b = Promise.all(Array.from({ length: 15 }, () => checkRateLimit('192.0.2.63')));
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.filter(Boolean).length, MAX_ATTEMPTS);
    assert.equal(rb.filter(Boolean).length, MAX_ATTEMPTS);
  });
});

describe('MT.60 — the in-memory fallback applies only when the atomic call fails', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('a denial from the atomic call is final (does not consult the in-memory map)', async () => {
    // The rpc says "blocked" on the first call. The in-memory map has never
    // seen this IP, so falling back would wrongly allow.
    globalThis.fetch = async () => resp({ body: false });
    assert.equal(await checkRateLimit('192.0.2.64'), false);
  });

  it('a non-boolean rpc body is treated as a failure and falls back', async () => {
    // e.g. PostgREST answering 200 with an error-shaped or array body. Falling
    // back means in-memory counting: 10 allowed, then denied.
    globalThis.fetch = async () => resp({ body: [{ allowed: true }] });
    const ip = '192.0.2.65';
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await checkRateLimit(ip));
    assert.equal(results.filter(Boolean).length, MAX_ATTEMPTS);
    assert.equal(results[MAX_ATTEMPTS], false);
  });

  it('a thrown fetch (network error) falls back to in-memory', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
    const ip = '192.0.2.66';
    let allowed = 0;
    for (let i = 0; i < 12; i++) if (await checkRateLimit(ip)) allowed++;
    assert.equal(allowed, MAX_ATTEMPTS);
  });
});

describe('MT.60 — the migration is a single atomic upsert, server-only', () => {
  const sql = fs.readFileSync(new URL('../sql/migration_login_rate_limit_atomic.sql', import.meta.url), 'utf8');
  const manifest = fs.readFileSync(new URL('../js/migrations-manifest.js', import.meta.url), 'utf8');

  it('creates or increments with INSERT ... ON CONFLICT (ip) DO UPDATE ... RETURNING', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.login_rate_limit_hit\(/);
    assert.match(sql, /INSERT INTO public\.rate_limits[\s\S]*ON CONFLICT \(ip\) DO UPDATE[\s\S]*RETURNING/);
  });

  it('the stale sweep skips locked rows, so it never waits on another attempt', () => {
    assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  });

  it('only service_role may execute it', () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.login_rate_limit_hit\(TEXT, INTEGER, INTEGER\) FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /GRANT\s+EXECUTE ON FUNCTION public\.login_rate_limit_hit\(TEXT, INTEGER, INTEGER\) TO service_role;/);
  });

  it('records itself in applied_migrations and in the manifest', () => {
    assert.match(sql, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_login_rate_limit_atomic'\)\s+ON CONFLICT \(name\) DO NOTHING;/);
    assert.match(manifest, /'migration_login_rate_limit_atomic',/);
  });
});
