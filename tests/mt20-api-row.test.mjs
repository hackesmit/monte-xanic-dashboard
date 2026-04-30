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
