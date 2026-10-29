// MT.90 — Mona logout clears client state; appendMessage/saveView reject
// oversized content (bead xd-0lt.5, security-audit findings).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';

const SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const handler = (await import('../api/mona-data.js')).default;
const { MonaChat } = await import('../js/mona/chat.js');

function token(role = 'lab', user = 'labuser') {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, role, user, nonce: 'n' })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`;
}
const makeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe('MT.90 — logout clears Mona client state', () => {
  it('MonaChat.clearAll drops messages, conversation id and conversation list', () => {
    MonaChat.messages = [{ role: 'user', content: 'secreto de la cuenta A' }];
    MonaChat.conversationId = 'c1';
    MonaChat.conversations = [{ id: 'c1', title: 'A' }];
    MonaChat.clearAll();
    assert.deepEqual(MonaChat.messages, []);
    assert.equal(MonaChat.conversationId, null);
    assert.deepEqual(MonaChat.conversations, []);
  });

  it('Auth.logout calls Mona.reset, which allows a fresh init', () => {
    const auth = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
    const start = auth.indexOf('logout() {');
    const logout = auth.slice(start, auth.indexOf('getToken() {', start));
    assert.match(logout, /Mona\.reset\(\)/);
    const idx = readFileSync(new URL('../js/mona/index.js', import.meta.url), 'utf8');
    const rs = idx.indexOf('reset() {');
    const reset = idx.slice(rs, idx.indexOf('updateKbButton() {', rs));
    assert.match(reset, /initialized = false/);
    assert.match(reset, /MonaChat\.clearAll\(\)/);
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
