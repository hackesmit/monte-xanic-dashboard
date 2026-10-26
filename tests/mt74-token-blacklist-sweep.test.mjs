// MT.74 — token_blacklist is swept, off the auth path (xd-mqy)
//
// sql/migration_token_blacklist.sql promised an auto-cleanup of revocations
// older than a token's life, and nothing ever deleted a row. /api/logout now
// sweeps them after the revoke insert succeeds. The sweep is housekeeping: it
// must never change what logout answers, never run when the revoke failed, and
// never delete a row whose token could still be alive.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const logoutHandler = (await import('../api/logout.js')).default;
const {
  sweepExpiredRevocations, BLACKLIST_RETENTION_MS, SWEEP_TIMEOUT_MS,
} = await import('../api/_lib/blacklistSweep.js');

const HOUR = 60 * 60 * 1000;

function validToken() {
  const payloadB64 = Buffer.from(JSON.stringify({
    exp: Date.now() + 60_000, role: 'lab', user: 'labuser', nonce: crypto.randomUUID(),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function resp({ ok, status }) {
  return { ok, status, text: async () => '', json: async () => null };
}

function logoutReq(token) {
  return { method: 'POST', body: { token }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
}

// A fetch that never answers on its own and rejects only when its signal fires,
// like a real fetch to a server that hangs.
function hangingFetch(_url, opts = {}) {
  return new Promise((_, reject) => {
    const sig = opts.signal;
    if (!sig) return; // no deadline: hangs forever, which the guard below catches
    sig.addEventListener('abort', () => reject(sig.reason), { once: true });
  });
}

// Fail the test instead of hanging the runner when a deadline is missing.
function guard(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`no result within ${ms} ms`)), ms); }),
  ]);
}

describe('MT.74 — logout sweeps expired token_blacklist rows', () => {
  let originalFetch, originalError, calls;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalError = console.error;
    console.error = () => {};
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  });

  it('after a successful revoke, DELETEs only rows older than the retention window', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return resp({ ok: true, status: opts.method === 'DELETE' ? 204 : 201 });
    };
    const before = Date.now();
    const res = makeRes();
    await logoutHandler(logoutReq(validToken()), res);
    const after = Date.now();

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(calls.length, 2, 'one insert, then one sweep');
    assert.equal(calls[0].opts.method, 'POST', 'the revoke insert runs first');

    const sweep = calls[1];
    assert.equal(sweep.opts.method, 'DELETE');
    assert.equal(sweep.opts.headers.apikey, 'test-service-key');
    assert.equal(sweep.opts.headers.Authorization, 'Bearer test-service-key');
    const u = new URL(sweep.url);
    assert.equal(u.pathname, '/rest/v1/token_blacklist');
    const filter = u.searchParams.get('invalidated_at');
    assert.ok(filter, 'the DELETE must carry a filter, never an unfiltered delete');
    assert.match(filter, /^lt\./);
    const cutoff = Date.parse(filter.slice(3));
    assert.ok(Number.isFinite(cutoff), `cutoff is a timestamp: ${filter}`);
    assert.ok(cutoff >= before - BLACKLIST_RETENTION_MS && cutoff <= after - BLACKLIST_RETENTION_MS,
      'cutoff is now minus the retention window');
    assert.deepEqual([...u.searchParams.keys()], ['invalidated_at'], 'no other filter or select');
  });

  it('does not sweep when the revoke insert failed', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), opts });
      return resp({ ok: false, status: 500 });
    };
    const res = makeRes();
    await logoutHandler(logoutReq(validToken()), res);

    assert.equal(res.statusCode, 502);
    assert.equal(calls.length, 1, 'only the insert ran');
    assert.notEqual(calls[0].opts.method, 'DELETE');
  });

  it('a rejected sweep (non-2xx) does not change the logout answer', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      calls.push(opts.method);
      return opts.method === 'DELETE' ? resp({ ok: false, status: 500 }) : resp({ ok: true, status: 201 });
    };
    const res = makeRes();
    await logoutHandler(logoutReq(validToken()), res);

    assert.deepEqual(calls, ['POST', 'DELETE']);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  it('a sweep that throws does not change the logout answer', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      if (opts.method === 'DELETE') throw new TypeError('fetch failed');
      return resp({ ok: true, status: 201 });
    };
    const res = makeRes();
    await logoutHandler(logoutReq(validToken()), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  it('a sweep that hangs is cut off and logout still answers ok', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      if (opts.method === 'DELETE') return hangingFetch(url, opts);
      return resp({ ok: true, status: 201 });
    };
    const res = makeRes();
    const started = Date.now();
    await guard(logoutHandler(logoutReq(validToken()), res), SWEEP_TIMEOUT_MS + 2000);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Date.now() - started < SWEEP_TIMEOUT_MS + 1000, 'bounded by the sweep deadline');
  });
});

describe('MT.74 — sweepExpiredRevocations', () => {
  it('reports the outcome and never throws', async () => {
    const ok = await sweepExpiredRevocations('https://x.supabase.co', 'k', {
      fetchImpl: async () => resp({ ok: true, status: 204 }),
    });
    assert.equal(ok, true);

    const rejected = await sweepExpiredRevocations('https://x.supabase.co', 'k', {
      fetchImpl: async () => resp({ ok: false, status: 403 }),
    });
    assert.equal(rejected, false);

    const thrown = await sweepExpiredRevocations('https://x.supabase.co', 'k', {
      fetchImpl: async () => { throw new Error('boom'); },
      log: () => {},
    });
    assert.equal(thrown, false);
  });

  it('honours its deadline', async () => {
    const r = await guard(sweepExpiredRevocations('https://x.supabase.co', 'k', {
      fetchImpl: hangingFetch, timeoutMs: 50, log: () => {},
    }), 2000);
    assert.equal(r, false);
  });
});

describe('MT.74 — the retention window outlives every token', () => {
  it('retention is at least the login token life plus an hour of clock-skew margin', () => {
    // A revoked row may go only once its token has expired on EVERY clock that
    // judges it. The cutoff is computed on the function host while
    // invalidated_at is stamped by Postgres, so the window carries a margin.
    const src = readFileSync(new URL('../api/login.js', import.meta.url), 'utf8');
    const m = src.match(/exp:\s*Date\.now\(\)\s*\+\s*([\d\s*]+?)\s*,/);
    assert.ok(m, 'api/login.js still sets exp as Date.now() + <ms literal>');
    const ttl = m[1].split('*').map((s) => Number(s.trim())).reduce((a, b) => a * b, 1);
    assert.ok(Number.isFinite(ttl) && ttl > 0, `token life parsed: ${m[1]}`);
    assert.ok(BLACKLIST_RETENTION_MS >= ttl + HOUR,
      `retention ${BLACKLIST_RETENTION_MS} ms must cover token life ${ttl} ms plus 1 h`);
  });
});
