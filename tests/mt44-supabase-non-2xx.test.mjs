// MT.44 — Supabase non-2xx responses are treated as failure, not success (bead xd-io5).
//
// fetch() does not throw on an HTTP error status. Three server paths used to
// ignore resp.ok and report failure as success:
//   1. api/logout.js — a rejected token_blacklist insert still returned { ok: true },
//      so a session the UI reports as revoked was never actually revoked.
//   2. api/mona-data.js — sb() carried { ok } that no handler inspected, so a failed
//      write returned 200 { ok: true } and a failed read degraded silently to [].
//   3. api/login.js — checkRateLimit() read the GET body without checking status, so a
//      Supabase error object yielded an unconditional allow instead of the in-memory fallback.
//
// These tests drive the REAL handlers with a fetch stub that returns a non-2xx
// status for the Supabase write/read under test and assert each path surfaces a
// real error (or falls back), never a masked success.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const logoutHandler   = (await import('../api/logout.js')).default;
const monaDataHandler = (await import('../api/mona-data.js')).default;
// The rate limiter is imported directly (not through login.js) so this suite
// stays runnable without node_modules — login.js pulls in bcryptjs.
const { checkRateLimit } = await import('../api/lib/loginRateLimit.js');

function validToken(role = 'lab', user = 'labuser') {
  const payloadB64 = Buffer.from(JSON.stringify({
    exp: Date.now() + 60_000, role, user, nonce: 'n',
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

// A fetch response object matching the subset the handlers use.
function resp({ ok, status, body }) {
  return {
    ok,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body,
  };
}

describe('MT.44 — logout treats a failed blacklist insert as failure', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('returns non-2xx (not { ok: true }) when the blacklist insert is rejected', async () => {
    const token = validToken();
    globalThis.fetch = async (url) => {
      assert.match(String(url), /token_blacklist/);
      return resp({ ok: false, status: 500, body: { message: 'insert failed' } });
    };
    const req = { method: 'POST', body: { token }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = makeRes();
    await logoutHandler(req, res);

    assert.notEqual(res.statusCode, 200, 'a rejected revoke must not report success');
    assert.equal(res.body.ok, false, 'ok must be false when the token was not blacklisted');
  });

  it('returns { ok: true } when the blacklist insert succeeds', async () => {
    const token = validToken();
    globalThis.fetch = async () => resp({ ok: true, status: 201, body: undefined });
    const req = { method: 'POST', body: { token }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res = makeRes();
    await logoutHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  it('fails (not { ok: true }) when Supabase is not configured — no supported blacklist-free mode', async () => {
    // SUPABASE_SERVICE_KEY is a required env var for /api/logout (docs/Operations.md).
    // With it unset the token_blacklist — the only revocation mechanism — is
    // unreachable, so logout must not claim success while the token stays usable.
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      const token = validToken();
      globalThis.fetch = async () => {
        throw new Error('fetch must not run when Supabase is unconfigured');
      };
      const req = { method: 'POST', body: { token }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
      const res = makeRes();
      await logoutHandler(req, res);

      assert.notEqual(res.statusCode, 200, 'a token that could not be revoked must not report success');
      assert.equal(res.body.ok, false, 'ok must be false when revocation is impossible');
    } finally {
      process.env.SUPABASE_URL = savedUrl;
      process.env.SUPABASE_SERVICE_KEY = savedKey;
    }
  });
});

describe('MT.44 — login rate limit falls back to in-memory when Supabase errors', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('blocks after the in-memory limit instead of allowing unconditionally', async () => {
    // Every Supabase rate_limits call returns an error object with a non-2xx status.
    // The old code read `rows` off that error object, saw no `.length`, and treated
    // every request as a fresh window (unconditional allow). The fix must fall back
    // to the in-memory limiter, which blocks after MAX_ATTEMPTS (10).
    globalThis.fetch = async () => resp({ ok: false, status: 503, body: { message: 'service unavailable' } });

    const ip = '198.51.100.7';
    let allowed = 0;
    let blocked = false;
    for (let i = 0; i < 12; i++) {
      if (await checkRateLimit(ip)) allowed++;
      else { blocked = true; break; }
    }
    assert.equal(blocked, true, 'in-memory fallback must eventually deny despite the DB error');
    assert.equal(allowed, 10, 'exactly MAX_ATTEMPTS (10) allowed before the fallback blocks');
  });

  it('a failed stale-entry sweep is best-effort and keeps using the persistent limiter', async () => {
    // The stale-entry sweep DELETE is housekeeping, not load-bearing. A non-2xx on it
    // must NOT abandon the persistent limiter and drop to the in-memory map (trivially
    // reset by Vercel cold starts / multiple instances). Here the sweep fails but the
    // read and increment for this IP succeed: the function must still drive the
    // persistent PATCH increment. The in-memory fallback makes NO fetch call, so a
    // recorded PATCH proves the persistent path — not the fallback — ran.
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const u = String(url);
      calls.push(method);
      if (method === 'DELETE') {
        return resp({ ok: false, status: 500, body: { message: 'sweep failed' } });
      }
      if (u.includes('select=attempts')) {
        // Persistent read: this IP has 3 attempts in the current window.
        return resp({ ok: true, status: 200, body: [{ attempts: 3, window_start: new Date().toISOString() }] });
      }
      // Persistent increment (PATCH) succeeds.
      return resp({ ok: true, status: 204, body: undefined });
    };

    const allowed = await checkRateLimit('203.0.113.55');
    assert.equal(allowed, true, 'a persistent count of 4 is under MAX, so allow');
    assert.ok(calls.includes('DELETE'), 'the sweep was attempted');
    assert.ok(calls.includes('GET'), 'the persistent read ran despite the failed sweep');
    assert.ok(calls.includes('PATCH'),
      'the persistent increment ran — proves we did NOT fall back to in-memory (which makes no fetch call)');
  });
});

describe('MT.44 — mona-data surfaces a real error on failed reads and writes', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  // Blacklist lookup (verifyToken) must succeed-and-empty so the token is accepted;
  // the mona_* call under test returns a non-2xx status.
  function stub(monaResp) {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('token_blacklist')) return resp({ ok: true, status: 200, body: [] });
      return monaResp;
    };
  }

  it('returns 500 (not 200 ok) when a write is rejected', async () => {
    stub(resp({ ok: false, status: 500, body: { message: 'write rejected' } }));
    const req = {
      method: 'POST',
      headers: { 'x-session-token': validToken() },
      body: { action: 'createConversation', title: 'Hola' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = makeRes();
    await monaDataHandler(req, res);

    assert.equal(res.statusCode, 500, 'a rejected write must not report 200 success');
    assert.equal(res.body.error, 'Error de persistencia');
  });

  it('returns 500 (not an empty list) when a read is rejected', async () => {
    stub(resp({ ok: false, status: 500, body: { message: 'read rejected' } }));
    const req = {
      method: 'POST',
      headers: { 'x-session-token': validToken() },
      body: { action: 'listConversations' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = makeRes();
    await monaDataHandler(req, res);

    assert.equal(res.statusCode, 500, 'a failed read must surface an error, not degrade to []');
    assert.equal(res.body.error, 'Error de persistencia');
  });
});
