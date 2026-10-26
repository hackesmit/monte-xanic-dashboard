// MT.61 - the WineXRay sync takes a cross-instance lease (xd-wh7).
//
// The in-memory in-flight guard only collapses requests on ONE warm Vercel
// instance. Two instances each ran a full WineXRay fetch and the later writer
// overwrote the fresher snapshot. The lease (sql/migration_sync_lease.sql,
// api/_lib/syncLease.js) is taken in Postgres before the first upstream call
// and freed in a finally.
//
// The two-instance case loads the handler twice under different module URLs,
// so each copy has its own inFlight, exactly like two instances, and both share
// one lease whose semantics copy the SQL: take the row when it is free or
// expired, release only by owner. The SQL itself is checked against the live
// database when the migration is applied (see the bead's receipt).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret-for-mt61';
process.env.SUPABASE_URL = 'https://stub.invalid';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.WINEXRAY_USERNAME = 'lab-user';
process.env.WINEXRAY_PASSWORD = 'lab-pass';

const MODULE = new URL('../api/winexray-sync.js', import.meta.url).href;
const { default: handler } = await import(MODULE);
const { default: handlerOtherInstance } = await import(`${MODULE}?instance=b`);
const { postgresLease, LeaseError } = await import('../api/_lib/syncLease.js');
const { MIGRATIONS } = await import('../js/migrations-manifest.js');
const { readFile } = await import('node:fs/promises');

function mintToken(role) {
  const p = Buffer.from(JSON.stringify({ role, exp: Date.now() + 60000 })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(p).digest('base64url')}`;
}
let ipSeq = 0;
const mkReq = body => ({
  method: 'POST', body, socket: {},
  headers: { 'x-real-ip': `10.61.0.${++ipSeq}`, 'x-session-token': mintToken('lab') },
});
function httpRes() {
  const out = { statusCode: null, body: null };
  return { out, setHeader() {}, status(c) { out.statusCode = c; return this; }, json(b) { out.body = b; return this; } };
}

// The SQL lease, in memory: one row per name, taken when free or expired.
function sharedLease(clock = () => Date.now()) {
  const rows = new Map();
  const log = [];
  return {
    log,
    rows,
    async acquire(name, owner, ttl) {
      log.push(['acquire', name, owner, ttl]);
      const row = rows.get(name);
      if (row && row.expiresAt > clock()) return false;
      rows.set(name, { owner, expiresAt: clock() + ttl * 1000 });
      return true;
    },
    async release(name, owner) {
      log.push(['release', name, owner]);
      if (rows.get(name)?.owner !== owner) return false;
      rows.delete(name);
      return true;
    },
  };
}

// A WineXRay stand-in that counts fetches and can be held open.
function countingClient() {
  let fetches = 0;
  let open;
  const gate = new Promise(r => { open = r; });
  return {
    get fetches() { return fetches; },
    open: () => open(),
    make: () => ({ async fetchExportCsv() { fetches++; await gate; return { buffer: null, sampleCount: 0 }; } }),
  };
}

const noNetwork = async u => { throw new Error(`test must not hit the network: ${u}`); };

test('MT.61 - a second instance is refused while the first holds the lease, and never fetches', { timeout: 5000 }, async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = noNetwork;
  try {
    const lease = sharedLease();
    const wx = countingClient();
    const range = { from: '2026-10-01', to: '2026-10-26' };

    const resA = httpRes();
    const a = handler(mkReq(range), resA, { lease, makeClient: wx.make });
    while (wx.fetches === 0) await new Promise(r => setImmediate(r));

    // Same window, other instance: an in-memory join cannot happen there.
    const resB = httpRes();
    await handlerOtherInstance(mkReq(range), resB, { lease, makeClient: wx.make });
    assert.equal(resB.out.statusCode, 409);
    assert.match(resB.out.body.error, /sincronizaci[oó]n en curso/i);
    assert.equal(wx.fetches, 1, 'the refused instance must not start a second WineXRay fetch');

    wx.open();
    await a;
    assert.equal(resA.out.statusCode, 200);
    assert.equal(lease.rows.size, 0, 'the first run must free the lease when it ends');

    // Freed: the other instance can sync now.
    const resC = httpRes();
    await handlerOtherInstance(mkReq(range), resC, {
      lease, makeClient: () => ({ async fetchExportCsv() { return { buffer: null, sampleCount: 0 }; } }),
    });
    assert.equal(resC.out.statusCode, 200);
  } finally { globalThis.fetch = realFetch; }
});

test('MT.61 - the lease is taken before WineXRay and released in a finally when the run throws', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = noNetwork;
  try {
    const lease = sharedLease();
    const order = [];
    const res = httpRes();
    await handler(mkReq({ from: '2026-10-01', to: '2026-10-02' }), res, {
      lease: {
        acquire: async (...a) => { order.push('acquire'); return lease.acquire(...a); },
        release: async (...a) => { order.push('release'); return lease.release(...a); },
      },
      makeClient: () => ({ async fetchExportCsv() { order.push('fetch'); throw new Error('upstream blew up'); } }),
    });
    assert.equal(res.out.statusCode, 500);
    assert.deepEqual(order, ['acquire', 'fetch', 'release']);
    const [[, name, owner, ttl], [, relName, relOwner]] = lease.log;
    assert.equal(name, 'winexray-sync');
    assert.equal(ttl, 600, 'TTL must outlive the 300 s function timeout');
    assert.equal(relName, name);
    assert.equal(relOwner, owner, 'release must name the owner that acquired');
    assert.equal(lease.rows.size, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('MT.61 - every run uses a fresh owner id', async () => {
  const lease = sharedLease();
  for (let i = 0; i < 2; i++) {
    await handler(mkReq({ from: '2026-10-01', to: '2026-10-02' }), httpRes(), {
      lease, makeClient: () => ({ async fetchExportCsv() { return { buffer: null, sampleCount: 0 }; } }),
    });
  }
  const owners = lease.log.filter(e => e[0] === 'acquire').map(e => e[2]);
  assert.equal(owners.length, 2);
  assert.notEqual(owners[0], owners[1]);
});

test('MT.61 - a crashed run does not wedge the lease: it is taken over once expired', async () => {
  let now = 1_000_000;
  const lease = sharedLease(() => now);
  assert.equal(await lease.acquire('winexray-sync', 'crashed', 600), true);
  // The crashed holder never releases.
  const fetched = [];
  const run = async () => {
    const res = httpRes();
    await handler(mkReq({ from: '2026-10-01', to: '2026-10-02' }), res, {
      lease, makeClient: () => ({ async fetchExportCsv() { fetched.push(1); return { buffer: null, sampleCount: 0 }; } }),
    });
    return res.out.statusCode;
  };
  now += 599_000;
  assert.equal(await run(), 409, 'still inside the TTL');
  now += 2_000;
  assert.equal(await run(), 200, 'past the TTL the lease is taken over');
  assert.equal(fetched.length, 1);
  // The crashed owner's late release must not free the new holder's lease.
  assert.equal(await lease.release('winexray-sync', 'crashed'), false);
});

test('MT.61 - a lease service that cannot answer fails closed in Spanish, with no fetch', async () => {
  let fetched = 0;
  for (const acquire of [
    async () => { throw new LeaseError('sync_lease_acquire answered 404'); },
    async () => { throw new Error('socket hang up'); },
  ]) {
    const res = httpRes();
    await handler(mkReq({ from: '2026-10-01', to: '2026-10-02' }), res, {
      lease: { acquire, async release() { throw new Error('must not release a lease never held'); } },
      makeClient: () => ({ async fetchExportCsv() { fetched++; return { buffer: null, sampleCount: 0 }; } }),
    });
    assert.equal(res.out.statusCode, 503);
    assert.match(res.out.body.error, /No se pudo reservar la sincronización/);
  }
  assert.equal(fetched, 0);
});

test('MT.61 - a failed release does not change a successful answer', async () => {
  const res = httpRes();
  await handler(mkReq({ from: '2026-10-01', to: '2026-10-02' }), res, {
    lease: { async acquire() { return true; }, async release() { throw new Error('db gone'); } },
    makeClient: () => ({ async fetchExportCsv() { return { buffer: null, sampleCount: 0 }; } }),
  });
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.ok, true);
});

// ── postgresLease: the PostgREST adapter ──────────────────────────────
function fakeFetch(answer) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    if (answer instanceof Error) throw answer;
    return { ok: answer.status < 300, status: answer.status, async json() { return answer.body; } };
  };
  return { calls, impl };
}

test('MT.61 - postgresLease posts the RPC with the service key and returns its boolean', async () => {
  for (const body of [true, false]) {
    const f = fakeFetch({ status: 200, body });
    const lease = postgresLease({ supabaseUrl: 'https://db.example', serviceKey: 'svc', fetchImpl: f.impl });
    assert.equal(await lease.acquire('winexray-sync', 'o1', 600), body);
    assert.equal(f.calls[0].url, 'https://db.example/rest/v1/rpc/sync_lease_acquire');
    assert.equal(f.calls[0].opts.method, 'POST');
    assert.equal(f.calls[0].opts.headers.apikey, 'svc');
    assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer svc');
    assert.deepEqual(JSON.parse(f.calls[0].opts.body), { p_name: 'winexray-sync', p_owner: 'o1', p_ttl_seconds: 600 });
  }
  const f = fakeFetch({ status: 200, body: true });
  await postgresLease({ supabaseUrl: 'https://db.example', serviceKey: 'svc', fetchImpl: f.impl }).release('winexray-sync', 'o1');
  assert.equal(f.calls[0].url, 'https://db.example/rest/v1/rpc/sync_lease_release');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { p_name: 'winexray-sync', p_owner: 'o1' });
});

test('MT.61 - postgresLease never reads an unclear answer as held', async () => {
  for (const answer of [
    { status: 404, body: { message: 'function not found' } },
    { status: 500, body: {} },
    { status: 200, body: null },
    { status: 200, body: 'true' },
    { status: 200, body: [true] },
    new Error('ECONNRESET'),
  ]) {
    const f = fakeFetch(answer);
    const lease = postgresLease({ supabaseUrl: 'https://db.example', serviceKey: 'svc', fetchImpl: f.impl });
    await assert.rejects(lease.acquire('winexray-sync', 'o1', 600), LeaseError, JSON.stringify(answer.body ?? String(answer)));
  }
});

// Round 36 guardrail: the migration self-registers and is in the manifest, so
// the banner names it if a deploy outruns the SQL Editor.
test('MT.61 - migration_sync_lease registers itself and is in the manifest', async () => {
  const sql = await readFile(new URL('../sql/migration_sync_lease.sql', import.meta.url), 'utf8');
  assert.match(sql, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_sync_lease'\)/);
  assert.ok(MIGRATIONS.includes('migration_sync_lease'));
  // The anon key ships in the client: it must not reach the lease.
  assert.match(sql, /REVOKE ALL ON public\.sync_lease FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.sync_lease_acquire\(text, text, integer\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.sync_lease_release\(text, text\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /WHERE l\.expires_at <= now\(\)/, 'expiry must be enforced by the acquire statement');
});
