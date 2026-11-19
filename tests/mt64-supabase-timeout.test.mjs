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

// 'silencio': never answer; 'goteo': 200 headers, then a stalled body;
// 'rechaza-goteo': 409 headers, then a stalled body (a confirmed rejection);
// 'pasarela': an immediate gateway 504 (the write may have committed behind it).
let modo = 'silencio';
const abiertas = new Set();
// Every write the stub received, recorded BEFORE it stalls: a write the
// handler calls indeterminate really did reach the database (xd-11a).
const escrituras = [];
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
  if (req.method !== 'GET') escrituras.push(`${req.method} ${req.url.split('?')[0]}`);
  if (modo === 'pasarela') {
    res.writeHead(504, { 'content-type': 'application/json' });
    return res.end('{"message":"upstream timeout"}');
  }
  abiertas.add(res);
  if (modo === 'goteo' || modo === 'rechaza-goteo') {
    res.writeHead(modo === 'goteo' ? 200 : 409, { 'content-type': 'application/json' });
    res.write(modo === 'goteo' ? '[' : '{');   // the body never completes
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
    reserveBudget: (await import('../api/_lib/monaUsage.js')).reserveBudget,
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
  for (const kind of ['read', 'batch', 'rpc', 'mona']) assert.equal(mod.supabaseTimeoutMs(kind), BUDGET_MS);
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

// ── xd-11a: a write is a confirmed success, a confirmed rejection, or
// indeterminate; a stalled or unanswered write is never a definite failure.

const FILA = {
  delete: { sample_id: '25CSMX-1', sample_date: '2025-08-01', sample_seq: 1 },
  update: { sample_id: '25CSMX-1', sample_date: '2025-08-01', sample_seq: 1, brix: 24.1 },
  upsert: { sample_id: '25CSMX-1', sample_date: '2025-08-01', sample_seq: 1, sample_type: 'Must', brix: 24.1 },
};
const METODO = { delete: 'DELETE', update: 'PATCH', upsert: 'POST' };

async function filaPor(action) {
  const r = res();
  await dentroDelPlazo(() => mod.row(req({
    headers: { 'x-session-token': mintToken('lab') },
    body: { table: 'wine_samples', action, row: { ...FILA[action] } },
  }), r));
  return r.out;
}

function esIndeterminado(out) {
  assert.equal(out.statusCode, 503);
  assert.equal(out.body.indeterminado, true);
  assert.notEqual(out.body.ok, false, 'an unknown outcome is not a failure');
  assert.notEqual(out.body.ok, true, 'nor a success');
  assert.match(out.body.error, /No se pudo confirmar/);
}

for (const action of ['delete', 'update', 'upsert']) {
  for (const m of ['silencio', 'goteo', 'pasarela']) {
    test(`row ${action}: write reached Supabase, then ${m} -> 503 indeterminado, never a 500 failure`, async () => {
      modo = m;
      escrituras.length = 0;
      const out = await filaPor(action);
      assert.deepEqual(escrituras, [`${METODO[action]} /rest/v1/wine_samples`], 'the write was received before the stall');
      esIndeterminado(out);
    });
  }

  test(`row ${action}: a rejection whose body stalls stays a confirmed rejection (409, ok false)`, async () => {
    modo = 'rechaza-goteo';
    const out = await filaPor(action);
    assert.equal(out.statusCode, 409);
    assert.equal(out.body.ok, false);
    assert.equal(out.body.indeterminado, undefined);
  });
}

const LOTE = () => ({
  table: 'wine_samples',
  rows: [{ sample_id: '25CSMX-1', sample_date: '2025-08-01', sample_seq: 1, sample_type: 'Must' }],
});

for (const m of ['silencio', 'pasarela']) {
  test(`upsertRows: batch reached Supabase, then ${m} -> 503 indeterminado, not ok:false`, async () => {
    modo = m;
    escrituras.length = 0;
    const { value } = await dentroDelPlazo(() => mod.upsertRows(LOTE()));
    assert.deepEqual(escrituras, ['POST /rest/v1/wine_samples']);
    assert.equal(value.status, 503);
    assert.equal(value.body.indeterminado, true);
    assert.notEqual(value.body.ok, false);
    assert.match(value.body.error, /No se pudo confirmar/);
  });
}

test('upsertRows: 200 headers then a stalled body -> 200 success (the status confirms the write)', async () => {
  modo = 'goteo';
  const { value } = await dentroDelPlazo(() => mod.upsertRows(LOTE()));
  assert.equal(value.status, 200);
  assert.equal(value.body.ok, true);
});

test('upsertRows: a rejection whose error body stalls -> confirmed failure, not indeterminate', async () => {
  modo = 'rechaza-goteo';
  const { value } = await dentroDelPlazo(() => mod.upsertRows(LOTE()));
  assert.equal(value.status, 500);
  assert.equal(value.body.ok, false);
  assert.equal(value.body.indeterminado, undefined);
});

const CLAVE = 'a|b|c|d';
for (const m of ['silencio', 'pasarela']) {
  test(`tanques descartar: ${m} -> 503 indeterminado, not the 502 database failure`, async () => {
    modo = m;
    escrituras.length = 0;
    const r = res();
    await dentroDelPlazo(() => mod.tanques(req({ headers: { 'x-session-token': mintToken('lab') }, body: { action: 'descartar', clave: CLAVE } }), r));
    assert.deepEqual(escrituras, ['POST /rest/v1/tanques_propuestas_descartadas']);
    assert.equal(r.out.statusCode, 503);
    assert.equal(r.out.body.indeterminado, true);
    assert.match(r.out.body.error, /Puede repetirlo/);
  });
}

test('tanques descartar: 200 headers then a stalled body -> 200 ok', async () => {
  modo = 'goteo';
  const r = res();
  await dentroDelPlazo(() => mod.tanques(req({ headers: { 'x-session-token': mintToken('lab') }, body: { action: 'descartar', clave: CLAVE } }), r));
  assert.equal(r.out.statusCode, 200);
  assert.equal(r.out.body.ok, true);
});

// ── xd-11a: the override never reaches AbortSignal.timeout as a bad number.

test('override: fractions floor, NaN/0/negative fall back, huge clamps; never a RangeError', async () => {
  const { supabaseTimeoutMs, supabaseFetch, MAX_OVERRIDE_MS } = await import('../api/_lib/supabaseFetch.js');
  const keep = process.env.SUPABASE_TIMEOUT_MS;
  try {
    const casos = [
      ['1000.5', 1000], ['NaN', 8000], ['0', 8000], ['-5', 8000], ['1e12', MAX_OVERRIDE_MS],
      ['0.5', 8000], ['', 8000], ['Infinity', 8000],
    ];
    for (const [env, esperado] of casos) {
      process.env.SUPABASE_TIMEOUT_MS = env;
      const ms = supabaseTimeoutMs('read');
      assert.equal(ms, esperado, `SUPABASE_TIMEOUT_MS=${env}`);
      assert.ok(Number.isInteger(ms) && ms >= 1 && ms <= MAX_OVERRIDE_MS);
      assert.doesNotThrow(() => AbortSignal.timeout(ms), `SUPABASE_TIMEOUT_MS=${env}`);
    }
    // The real call with a fractional override answers instead of throwing RangeError.
    process.env.SUPABASE_TIMEOUT_MS = '1000.5';
    modo = 'pasarela';
    const r = await supabaseFetch(`${process.env.SUPABASE_URL}/rest/v1/x`, { method: 'GET' });
    assert.equal(r.status, 504);
  } finally { process.env.SUPABASE_TIMEOUT_MS = keep; }
});

// ── xd-11a / Opus N1: a caller signal is combined with the budget, never dropped.

test('caller signal: aborts the call before a longer budget would', async () => {
  const { supabaseFetch, isTimeout } = await import('../api/_lib/supabaseFetch.js');
  const keep = process.env.SUPABASE_TIMEOUT_MS;
  process.env.SUPABASE_TIMEOUT_MS = '2500';
  modo = 'silencio';
  const t0 = Date.now();
  try {
    await assert.rejects(
      () => supabaseFetch(`${process.env.SUPABASE_URL}/rest/v1/x`, { signal: AbortSignal.timeout(50) }),
      (e) => isTimeout(e));
    assert.ok(Date.now() - t0 < 1500, `caller signal ignored: ${Date.now() - t0} ms`);
  } finally { process.env.SUPABASE_TIMEOUT_MS = keep; }
});

test('caller signal: the budget still fires when the caller signal never does', async () => {
  const { supabaseFetch, isTimeout } = await import('../api/_lib/supabaseFetch.js');
  modo = 'silencio';
  const nunca = new AbortController();
  const { ms } = await dentroDelPlazo(() => assert.rejects(
    () => supabaseFetch(`${process.env.SUPABASE_URL}/rest/v1/x`, { signal: nunca.signal }),
    (e) => isTimeout(e)));
  assert.ok(ms < HANG_GUARD_MS);
});

test('mona usage RPCs keep their own 3000 ms budget (kind mona), not the 8000 ms read budget', async () => {
  const keep = process.env.SUPABASE_TIMEOUT_MS;
  delete process.env.SUPABASE_TIMEOUT_MS;
  modo = 'silencio';
  const t0 = Date.now();
  try {
    assert.equal(mod.supabaseTimeoutMs('mona'), 3000);
    const r = await mod.reserveBudget('mt64-id', 'mt64', 10);
    const ms = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.status, 503, 'fails closed');
    assert.ok(ms >= 2800 && ms < 6000, `${ms} ms`);
  } finally { process.env.SUPABASE_TIMEOUT_MS = keep; }
});

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
