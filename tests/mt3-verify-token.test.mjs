// MT.3 — verifyToken() shared module
// Tests: valid token, expired token, invalid signature, missing token, blacklisted token, fetch failure.

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// Set env before importing module
const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { verifyToken } = await import('../api/lib/verifyToken.js');

/** Helper: create a valid HMAC token with given payload */
function createToken(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

describe('MT.3 — verifyToken()', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts a valid, non-expired token', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    const result = await verifyToken(token);
    assert.ok(result.payload, 'Should return payload');
    assert.equal(result.payload.user, 'admin');
    assert.equal(result.payload.role, 'admin');
    assert.equal(result.error, undefined);
  });

  it('rejects an expired token', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() - 1000 });
    const result = await verifyToken(token);
    assert.equal(result.error, 'Token expired');
    assert.equal(result.status, 401);
  });

  it('rejects a token with missing exp field', async () => {
    const token = createToken({ user: 'admin', role: 'admin' });
    const result = await verifyToken(token);
    assert.equal(result.error, 'Token expired');
    assert.equal(result.status, 401);
  });

  it('rejects a token with invalid HMAC signature', async () => {
    const payload = { user: 'admin', role: 'admin', exp: Date.now() + 60000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(payloadB64).digest('base64url');
    const token = `${payloadB64}.${wrongSig}`;
    const result = await verifyToken(token);
    assert.equal(result.error, 'Invalid token');
    assert.equal(result.status, 401);
  });

  it('rejects a tampered payload (signature mismatch)', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    const [, sig] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ user: 'hacker', role: 'admin', exp: Date.now() + 60000 })).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${sig}`;
    const result = await verifyToken(tamperedToken);
    assert.equal(result.error, 'Invalid token');
    assert.equal(result.status, 401);
  });

  it('rejects null/undefined/empty token', async () => {
    assert.equal((await verifyToken(null)).error, 'Unauthorized');
    assert.equal((await verifyToken(undefined)).error, 'Unauthorized');
    assert.equal((await verifyToken('')).error, 'Unauthorized');
  });

  it('rejects a token with wrong format (no dot separator)', async () => {
    const result = await verifyToken('not-a-valid-token-format');
    assert.equal(result.error, 'Invalid token');
    assert.equal(result.status, 401);
  });

  it('rejects a token with malformed base64 payload', async () => {
    const sig = crypto.createHmac('sha256', TEST_SECRET).update('!!!invalid-base64!!!').digest('base64url');
    const result = await verifyToken(`!!!invalid-base64!!!.${sig}`);
    // JSON.parse will fail on garbage → should return Invalid token
    assert.equal(result.error, 'Invalid token');
    assert.equal(result.status, 401);
  });

  it('detects a blacklisted (revoked) token', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    // Mock fetch to return a blacklist hit
    globalThis.fetch = async () => ({
      json: async () => [{ token_hash: 'some-hash' }]
    });
    const result = await verifyToken(token, { checkBlacklist: true });
    assert.equal(result.error, 'Token revoked');
    assert.equal(result.status, 401);
  });

  it('accepts a valid token when blacklist returns empty', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    globalThis.fetch = async () => ({
      json: async () => []
    });
    const result = await verifyToken(token, { checkBlacklist: true });
    assert.ok(result.payload, 'Should return payload');
    assert.equal(result.error, undefined);
  });

  it('fail-open: accepts token when blacklist fetch throws (availability)', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    globalThis.fetch = async () => { throw new Error('Network failure'); };
    const result = await verifyToken(token, { checkBlacklist: true });
    // Fail-open: should still return payload
    assert.ok(result.payload, 'Should fail-open and return payload');
    assert.equal(result.error, undefined);
  });

  it('skips blacklist check when checkBlacklist is false (default)', async () => {
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { json: async () => [{ token_hash: 'x' }] }; };
    const result = await verifyToken(token);
    assert.ok(result.payload);
    assert.equal(fetchCalled, false, 'fetch should not be called without checkBlacklist');
  });

  it('rejects token when SESSION_SECRET is missing', async () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    // Need to re-import or test inline — verifyToken reads env at call time
    const token = createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });
    const result = await verifyToken(token);
    assert.equal(result.error, 'Unauthorized');
    assert.equal(result.status, 401);
    process.env.SESSION_SECRET = saved;
  });
});
