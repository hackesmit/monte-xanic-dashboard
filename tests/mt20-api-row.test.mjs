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
