// MT.90 — Mona logout clears client state; appendMessage/saveView reject
// oversized content (bead xd-0lt.5, security-audit findings).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const handler = (await import('../api/mona-data.js')).default;

function token(role = 'lab', user = 'labuser') {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, role, user, nonce: 'n' })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`;
}
const makeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe('MT.90 - logout discards in-flight Mona work by reloading the document', () => {
  it('Auth.logout clears the session, reloads, and no Mona write is issued afterwards', async () => {
    const store = { xanic_session_token: 'TOKEN_A', xanic_user_role: 'lab' };
    let reloads = 0;
    globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    globalThis.location = { reload() { reloads++; } };
    const origFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : {} }); return { ok: true, json: async () => ({}) }; };
    try {
      const { Auth } = await import('../js/auth.js');
      Auth.logout();
      assert.equal(store.xanic_session_token, undefined, 'token removed');
      assert.equal(store.xanic_user_role, undefined, 'role removed');
      assert.equal(reloads, 1, 'logout must reload the document');
      assert.ok(calls.some(c => c.url === '/api/logout'), 'token revoked server-side');
      // Nothing talks to mona-data as part of logout itself.
      assert.equal(calls.filter(c => c.url.includes('mona')).length, 0);
    } finally { globalThis.fetch = origFetch; }
  });
});

describe('MT.90 — mona-data caps persisted content', () => {
  let orig, writes;
  beforeEach(() => {
    orig = globalThis.fetch; writes = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('token_blacklist')) return { ok: true, json: async () => [] };
      if (opts.method === 'POST' || opts.method === 'PATCH') writes.push(u);
      const body = u.includes('mona_conversations?id') && !opts.method ? '[{"id":"c1"}]' : '[]';
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    };
  });
  afterEach(() => { globalThis.fetch = orig; });

  const call = async (body, role = 'lab') => {
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'x-session-token': token(role) }, body }, res);
    return res;
  };

  it('rejects an oversized appendMessage with 413 and no write', async () => {
    const r = await call({ action: 'appendMessage', conversationId: 'c1', role: 'user', content: 'x'.repeat(4 * 1024 * 1024) });
    assert.equal(r.statusCode, 413);
    assert.equal(writes.length, 0);
  });

  it('rejects an unknown message role', async () => {
    const r = await call({ action: 'appendMessage', conversationId: 'c1', role: 'not-a-role', content: 'hola' });
    assert.equal(r.statusCode, 400);
    assert.equal(writes.length, 0);
  });

  it('accepts a normal appendMessage', async () => {
    const r = await call({ action: 'appendMessage', conversationId: 'c1', role: 'assistant', content: [{ type: 'text', text: 'hola' }] });
    assert.equal(r.statusCode, 200);
    assert.ok(writes.length >= 1);
  });

  it('rejects an oversized saveView with 413 and no write', async () => {
    const r = await call({ action: 'saveView', title: 'v', view_type: 'chart', spec: { d: 'x'.repeat(2 * 1024 * 1024) } });
    assert.equal(r.statusCode, 413);
    assert.equal(writes.length, 0);
  });
});
