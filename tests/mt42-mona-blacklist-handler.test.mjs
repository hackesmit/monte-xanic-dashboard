// MT.42 — /api/mona and /api/mona-data reject a blacklisted (revoked) token
// at the handler boundary (bead xd-318).
//
// The unit test in mt3 proves verifyToken() rejects a revoked token by default.
// This file closes the gap that unit test cannot: it drives the REAL handlers
// with a revoked token and asserts each one (a) responds 401 and (b) performs
// NO downstream side effect — no Anthropic request from /api/mona, no Supabase
// CRUD from /api/mona-data. So the tests still catch a regression where a route
// stops calling verifyToken, ignores its error, or reaches upstream anyway.
//
// The fetch stub does NOT match "any url": it returns a revoked-row hit ONLY
// when the blacklist query filters on the exact sha256 hash of the token under
// test. If a handler ever queried the wrong hash, the mock returns empty, the
// token would be accepted, an upstream call would fire, and the side-effect
// assertion below would fail — so this proves the correct token hash is queried.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'; // present so /api/mona would reach fetch if auth passed

const monaHandler = (await import('../api/mona.js')).default;
const monaDataHandler = (await import('../api/mona-data.js')).default;

function token(role = 'lab', user = 'labuser') {
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
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    write() {},
    end() {},
  };
}

// Stub fetch so verifyToken's blacklist lookup returns a revoked hit for THIS
// token's hash only, and record every other fetch as a forbidden side effect.
function stubRevoked(revokedToken) {
  const expectedHash = crypto.createHash('sha256').update(revokedToken).digest('hex');
  const state = { blacklistQueried: false, blacklistUrl: null, sideEffects: [] };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('token_blacklist')) {
      state.blacklistQueried = true;
      state.blacklistUrl = u;
      // Discriminate on the exact hash — a wrong-hash query yields no hit.
      const hit = u.includes(`token_hash=eq.${expectedHash}`);
      return { ok: true, json: async () => (hit ? [{ token_hash: expectedHash }] : []) };
    }
    // Anything else (Anthropic messages, mona_* CRUD) is a side effect that must not happen.
    state.sideEffects.push({ url: u, method: (opts && opts.method) || 'GET' });
    return { ok: true, status: 200, text: async () => '[]', json: async () => [] };
  };
  return { state, expectedHash };
}

describe('MT.42 — /api/mona rejects a revoked token before any Anthropic call', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('responds 401 and makes no upstream Anthropic request', async () => {
    const t = token();
    const { state, expectedHash } = stubRevoked(t);
    const req = {
      method: 'POST',
      headers: { 'x-session-token': t },
      body: { messages: [{ role: 'user', content: 'hola' }] },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = makeRes();
    await monaHandler(req, res);

    assert.equal(res.statusCode, 401, 'revoked token must be rejected');
    assert.equal(res.body.error, 'No autorizado');
    assert.equal(state.blacklistQueried, true, 'the blacklist must actually be consulted');
    assert.match(state.blacklistUrl, new RegExp(`token_hash=eq\\.${expectedHash}(&|$)`),
      'blacklist query must filter on this token\'s hash, not any url');
    assert.equal(state.sideEffects.length, 0,
      `no Anthropic request may be made; saw ${JSON.stringify(state.sideEffects)}`);
  });
});

describe('MT.42 — /api/mona-data rejects a revoked token before any Supabase CRUD', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('responds 401 and performs no mona_* read or write', async () => {
    const t = token();
    const { state, expectedHash } = stubRevoked(t);
    // A mutating action — if the revoke check were skipped, this would DELETE.
    const req = {
      method: 'POST',
      headers: { 'x-session-token': t },
      body: { action: 'deleteConversation', id: 'c-1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = makeRes();
    await monaDataHandler(req, res);

    assert.equal(res.statusCode, 401, 'revoked token must be rejected');
    assert.equal(res.body.error, 'No autorizado');
    assert.equal(state.blacklistQueried, true, 'the blacklist must actually be consulted');
    assert.match(state.blacklistUrl, new RegExp(`token_hash=eq\\.${expectedHash}(&|$)`),
      'blacklist query must filter on this token\'s hash, not any url');
    assert.equal(state.sideEffects.length, 0,
      `no Supabase CRUD may run; saw ${JSON.stringify(state.sideEffects)}`);
  });
});
