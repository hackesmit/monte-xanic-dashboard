// MT.60 — verifyToken() blacklist check fails CLOSED (xd-5ua)
// The token_blacklist query is the only thing that makes logout real. When that
// query cannot answer (non-2xx, a body that is not a row array, a network throw,
// a body that is not JSON, or no Supabase config at all) verifyToken must not
// read the silence as "not revoked". It returns 503 so the caller can tell
// "the revocation check is down" apart from "this token is bad" (401).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { verifyToken } = await import('../api/_lib/verifyToken.js');

function createToken(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

const liveToken = () => createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });

function assertUnavailable(result) {
  assert.equal(result.payload, undefined, 'must not hand back a payload');
  assert.equal(result.status, 503);
  assert.equal(result.error, 'Revocation check unavailable');
}

describe('MT.60 — verifyToken() blacklist fails closed', () => {
  let originalFetch, originalError, logged;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalError = console.error;
    logged = [];
    console.error = (...args) => { logged.push(args.join(' ')); };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  });

  it('rejects with 503 when the blacklist query returns 500 (the audit repro)', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'err' }) });
    assertUnavailable(await verifyToken(liveToken()));
  });

  it('rejects with 503 on a 4xx from schema/RLS drift on token_blacklist', async () => {
    for (const status of [400, 401, 404]) {
      globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ code: 'PGRST205', message: 'not found' }) });
      assertUnavailable(await verifyToken(liveToken()));
    }
  });

  it('rejects with 503 on a non-2xx even when the error body happens to be an array', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => [] });
    assertUnavailable(await verifyToken(liveToken()));
  });

  it('rejects with 503 on a 2xx whose body is not a row array', async () => {
    for (const body of [null, {}, { token_hash: 'x' }, 'ok']) {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => body });
      assertUnavailable(await verifyToken(liveToken()));
    }
  });

  it('rejects with 503 when fetch throws (ECONNRESET)', async () => {
    globalThis.fetch = async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); };
    assertUnavailable(await verifyToken(liveToken()));
  });

  it('rejects with 503 when the body is not JSON (an HTML gateway page)', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    assertUnavailable(await verifyToken(liveToken()));
  });

  it('rejects with 503 when Supabase is not configured, instead of skipping the check', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => [] }; };
    delete process.env.SUPABASE_SERVICE_KEY;
    assertUnavailable(await verifyToken(liveToken()));
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    delete process.env.SUPABASE_URL;
    assertUnavailable(await verifyToken(liveToken()));
    assert.equal(fetchCalled, false);
  });

  it('logs every fail-closed rejection with the upstream status', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'err' }) });
    await verifyToken(liveToken());
    assert.equal(logged.length, 1);
    assert.match(logged[0], /\[verifyToken\]/);
    assert.match(logged[0], /500/);
  });

  it('still rejects a revoked token with 401 when the query answers', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [{ token_hash: 'x' }] });
    const result = await verifyToken(liveToken());
    assert.equal(result.error, 'Token revoked');
    assert.equal(result.status, 401);
  });

  it('still accepts a live token when the query answers with no rows', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
    const result = await verifyToken(liveToken());
    assert.equal(result.payload.role, 'admin');
    assert.equal(result.error, undefined);
  });

  it('a 503 from the blacklist never masks a bad signature or expiry (those stay 401)', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const expired = createToken({ user: 'admin', role: 'admin', exp: Date.now() - 1000 });
    assert.equal((await verifyToken(expired)).status, 401);
    assert.equal((await verifyToken('a.b')).status, 401);
  });

  it('logout (checkBlacklist:false) is unaffected by a broken blacklist', async () => {
    globalThis.fetch = async () => { throw new Error('down'); };
    const result = await verifyToken(liveToken(), { checkBlacklist: false });
    assert.equal(result.payload.role, 'admin');
  });
});
