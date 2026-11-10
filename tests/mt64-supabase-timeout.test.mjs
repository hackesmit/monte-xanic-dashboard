// MT.64 — a stalled Supabase fails each handler cleanly, within the budget.
//
// xd-d71: no server-side Supabase fetch carried a timeout, so a Supabase that
// accepted the connection and never finished the response hung the invocation
// until Vercel killed it. Every such fetch now goes through
// api/_lib/supabaseFetch.js. These tests point SUPABASE_URL at a local server
// that stalls in the two ways that matter (never answers; answers headers and
// then stalls the body), shrink the budget through SUPABASE_TIMEOUT_MS, and
// require each handler's own failure path well before a hang guard fires.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const BUDGET_MS = 150;
const HANG_GUARD_MS = 3000;   // a handler still running here is a hang

process.env.SESSION_SECRET = 'test-secret-for-mt64';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.SUPABASE_TIMEOUT_MS = String(BUDGET_MS);
// xd-5ua: the revocation check has its own deadline; shrink it too so the
// session gate in front of every handler answers inside the test budget.
process.env.TOKEN_BLACKLIST_TIMEOUT_MS = String(BUDGET_MS);
process.env.CRON_SECRET = 'cron-mt64';

let modo = 'silencio';   // 'silencio': never answer; 'goteo': headers, then a stalled body
const abiertas = new Set();
let revocacion = 'limpia';   // 'limpia': the revocation check answers [] (token not revoked)
const server = http.createServer((req, res) => {
  if (revocacion === 'limpia' && req.method === 'GET' && req.url.startsWith('/rest/v1/token_blacklist')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('[]');
  }
  // The sync lease is not under test here (it keeps its own deadline); grant it
  // so the cursor read is what stalls.
  if (req.url.startsWith('/rest/v1/rpc/sync_lease_')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('true');
  }
  abiertas.add(res);
  if (modo === 'goteo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('[');   // the body never completes
  }
});

let mod;
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  // Imported after SUPABASE_URL is set: api/mona-data.js reads it at load.
  mod = {
    ping: (await import('../api/ping.js')).default,
    migrations: (await import('../api/migrations-status.js')).default,
    logout: (await import('../api/logout.js')).default,
    row: (await import('../api/row.js')).default,
    monaData: (await import('../api/mona-data.js')).default,
    tanques: (await import('../api/tanques.js')).default,
    sync: (await import('../api/winexray-sync.js')).default,
    upsertRows: (await import('../api/_lib/upsertRows.js')).upsertRows,
    checkRateLimit: (await import('../api/_lib/loginRateLimit.js')).checkRateLimit,
    verifyToken: (await import('../api/_lib/verifyToken.js')).verifyToken,
    supabaseTimeoutMs: (await import('../api/_lib/supabaseFetch.js')).supabaseTimeoutMs,
  };
});
after(() => {
  for (const r of abiertas) r.destroy();
  server.closeAllConnections?.();
  server.close();
});

function mintToken(role) {
  const payload = Buffer.from(JSON.stringify({ role, user: 'mt64', exp: Date.now() + 60_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

let ip = 0;
function req({ method = 'POST', headers = {}, body } = {}) {
  ip += 1;   // a fresh address per call keeps the in-memory request limiter out of the way
  return { method, headers: { 'x-forwarded-for': `10.61.0.${ip}`, ...headers }, body, socket: { remoteAddress: `10.61.0.${ip}` } };
}
function res() {
  const out = { statusCode: null, body: null };
  return {
    out,
    setHeader() {},
    status(code) { out.statusCode = code; return this; },
    json(b) { out.body = b; return this; },
    end() { return this; },
    write() { return true; },
  };
}

// Run fn, fail if it is still running at the hang guard, return elapsed ms.
async function dentroDelPlazo(fn) {
  const t0 = Date.now();
  let guard;
  const colgado = new Promise((_, rej) => { guard = setTimeout(() => rej(new Error('hung: no answer before the hang guard')), HANG_GUARD_MS); });
  try {
    const value = await Promise.race([fn(), colgado]);
    return { value, ms: Date.now() - t0 };
  } finally { clearTimeout(guard); }
}

test('the budget is configurable in one place and every kind honours the override', () => {
  for (const kind of ['read', 'batch', 'rpc']) assert.equal(mod.supabaseTimeoutMs(kind), BUDGET_MS);
});

for (const m of ['silencio', 'goteo']) {
  const etiqueta = m === 'silencio' ? 'never answers' : 'stalls the body after the headers';

  test(`ping: Supabase ${etiqueta} -> 500 within the budget`, async () => {
    modo = m;
    const r = res();
    const { ms } = await dentroDelPlazo(() => mod.ping(req({ method: 'GET', headers: { authorization: 'Bearer cron-mt64' } }), r));
    assert.equal(r.out.statusCode, 500);
    assert.equal(r.out.body.ok, false);
    assert.ok(ms < HANG_GUARD_MS, `${ms} ms`);
  });

  test(`migrations-status: Supabase ${etiqueta} -> 500`, async () => {
    modo = m;
    const r = res();
    await dentroDelPlazo(() => mod.migrations(req({ method: 'GET', headers: { 'x-session-token': mintToken('admin') } }), r));
    assert.equal(r.out.statusCode, 500);
  });

  test(`logout: Supabase ${etiqueta} -> answers within the budget (502 when nothing came back)`, async () => {
    modo = m;
    const r = res();
    await dentroDelPlazo(() => mod.logout(req({ body: { token: mintToken('lab') } }), r));
    if (m === 'silencio') {
      assert.equal(r.out.statusCode, 502);
      assert.equal(r.out.body.ok, false);
    } else {
      // The blacklist insert is checked on its status only; a 200 whose body
      // stalls already committed, so success is the right answer there.
      assert.equal(r.out.statusCode, 200);
    }
  });

  test(`row delete: Supabase ${etiqueta} -> 500 'Error de red'`, async () => {
    modo = m;
    const r = res();
    await dentroDelPlazo(() => mod.row(req({
      headers: { 'x-session-token': mintToken('lab') },
      body: { table: 'wine_samples', action: 'delete', row: { sample_id: '25CSMX-1', sample_date: '2025-08-01', sample_seq: 1 } },
    }), r));
    assert.equal(r.out.statusCode, 500);
    assert.match(r.out.body.error, /Error de red/);
  });

  test(`mona-data: Supabase ${etiqueta} -> 500`, async () => {
    modo = m;
    const r = res();
    await dentroDelPlazo(() => mod.monaData(req({
      headers: { 'x-session-token': mintToken('lab') },
      body: { action: 'listConversations' },
    }), r));
    assert.equal(r.out.statusCode, 500);
  });

  test(`tanques GET: Supabase ${etiqueta} -> 502 database error, not the generic 500`, async () => {
    modo = m;
    const r = res();
    await dentroDelPlazo(() => mod.tanques(req({ method: 'GET', headers: { 'x-session-token': mintToken('lab') } }), r));
    assert.equal(r.out.statusCode, 502);
    assert.match(r.out.body.error, /base de datos/);
  });

  test(`winexray-sync cursor: Supabase ${etiqueta} -> 502 in Spanish`, async () => {
    modo = m;
    const r = res();
    await dentroDelPlazo(() => mod.sync(req({ headers: { 'x-session-token': mintToken('lab') }, body: {} }), r));
    assert.equal(r.out.statusCode, 502);
    assert.match(r.out.body.error, m === 'silencio' ? /no respondió a tiempo/ : /no respondió a tiempo|No se pudo consultar/);
  });

  test(`upsertRows: Supabase ${etiqueta} -> answers within the budget (504 when nothing came back)`, async () => {
    modo = m;
    const { value } = await dentroDelPlazo(() => mod.upsertRows({
      table: 'wine_samples',
      rows: [{ sample_id: '25CSMX-1', sample_date: '2025-08-01', sample_seq: 1, sample_type: 'Must' }],
    }));
    if (m === 'silencio') {
      assert.equal(value.status, 504);
      assert.match(value.body.error, /no respondió a tiempo/);
    } else {
      // A 200 whose body stalls: upsertRows reads no success body, so the
      // write is reported as the 200 it was.
      assert.equal(value.status, 200);
    }
  });

  test(`login limiter: Supabase ${etiqueta} -> falls back to the in-memory limiter`, async () => {
    modo = m;
    const { value } = await dentroDelPlazo(() => mod.checkRateLimit(`10.62.0.${m.length}`));
    assert.equal(value, true, 'first attempt from a fresh IP is allowed by the fallback');
  });

  test(`verifyToken blacklist: Supabase ${etiqueta} -> fails CLOSED with 503 within the budget (xd-5ua)`, async () => {
    modo = m;
    revocacion = 'estancada';
    const { value } = await dentroDelPlazo(() => mod.verifyToken(mintToken('lab'), { checkBlacklist: true })).finally(() => { revocacion = 'limpia'; });
    assert.equal(value.status, 503, 'could not check is not not-revoked');
    assert.equal(value.error, 'Revocation check unavailable');
    assert.equal(value.payload, undefined);
  });
}

test('error shape: supabaseFetch rejects with a TimeoutError that isTimeout names', async () => {
  modo = 'silencio';
  const { supabaseFetch, isTimeout } = await import('../api/_lib/supabaseFetch.js');
  const t0 = Date.now();
  let err;
  try { await supabaseFetch(`${process.env.SUPABASE_URL}/rest/v1/x`); } catch (e) { err = e; }
  assert.ok(err, 'a stalled call must reject');
  assert.equal(err.name, 'TimeoutError');
  assert.equal(isTimeout(err), true);
  assert.equal(isTimeout(new Error('boom')), false);
  assert.ok(Date.now() - t0 < HANG_GUARD_MS);
});

test('error shape: a stalled body rejects the body read, not just the headers', async () => {
  modo = 'goteo';
  const { supabaseFetch, isTimeout } = await import('../api/_lib/supabaseFetch.js');
  const res = await supabaseFetch(`${process.env.SUPABASE_URL}/rest/v1/x`);
  await assert.rejects(() => res.json(), (e) => isTimeout(e));
});

test('budget: kinds, env override, bad override falls back', async () => {
  const { supabaseTimeoutMs } = await import('../api/_lib/supabaseFetch.js');
  const keep = process.env.SUPABASE_TIMEOUT_MS;
  try {
    delete process.env.SUPABASE_TIMEOUT_MS;
    assert.equal(supabaseTimeoutMs('read'), 8000);
    assert.equal(supabaseTimeoutMs('batch'), 20000);
    process.env.SUPABASE_TIMEOUT_MS = 'abc';
    assert.equal(supabaseTimeoutMs('read'), 8000);
    process.env.SUPABASE_TIMEOUT_MS = '50';
    assert.equal(supabaseTimeoutMs('batch'), 50);
  } finally { process.env.SUPABASE_TIMEOUT_MS = keep; }
});
