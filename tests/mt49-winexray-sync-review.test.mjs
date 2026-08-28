// MT.49 — regression cover for the defects the cross-vendor adversarial review
// found on the first cut of the WineXRay sync (lucy/gpt-5.6, 2026-08-28).
// Each test names the failure it locks out.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret-for-mt49';
process.env.SUPABASE_URL = 'https://stub.invalid';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.WINEXRAY_USERNAME = 'lab-user';
process.env.WINEXRAY_PASSWORD = 'sup3r-s3cret-pw';

const { WineXRayClient, WineXRayError } = await import('../api/_lib/winexrayClient.js');
const { default: handler, runSync } = await import('../api/winexray-sync.js');

function mkRes({ status = 200, headers = {}, body = '', setCookie = [] } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: k => h.get(String(k).toLowerCase()) ?? null, getSetCookie: () => setCookie },
    async text() { return body; },
    async json() { return JSON.parse(body); },
    async arrayBuffer() { return new TextEncoder().encode(body).buffer; },
  };
}
const LOGIN_OK = mkRes({ status: 303, setCookie: ['_ncfa=abc; path=/; HttpOnly'] });
const json = o => mkRes({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

// The login body is a urlencoded form, not JSON.
function safeJson(body) { try { return JSON.parse(body); } catch { return null; } }

function mintToken(role) {
  const p = Buffer.from(JSON.stringify({ role, exp: Date.now() + 60000 })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(p).digest('base64url')}`;
}
function httpRes() {
  const out = { statusCode: null, body: null };
  return { out, setHeader() {}, status(c) { out.statusCode = c; return this; }, json(b) { out.body = b; return this; } };
}

// ── BLOCKER 1: a window past one page was silently truncated ──────────
test('MT.49 — listResults pages past the first 500 instead of truncating', async () => {
  const page = (n, ids) => json({ count: n, results: ids.map(id => ({ id })) });
  const first = Array.from({ length: 500 }, (_, i) => i + 1);
  const calls = [];
  let i = 0;
  const responses = [LOGIN_OK, page(620, first), page(620, Array.from({ length: 120 }, (_, i) => 501 + i))];
  const c = new WineXRayClient({
    username: 'u', password: 'p',
    fetchImpl: async (url, opts) => { calls.push(safeJson(opts.body)); return responses[i++]; },
  });
  await c.login();
  const rows = await c.listResults({ from: '2026-07-01', to: '2026-10-31' });
  assert.equal(rows.length, 620, 'every result in the window must be collected');
  const pages = calls.filter(Boolean).map(b => b.currentPage);
  assert.deepEqual(pages, [0, 1], 'a second page must actually be requested');
});

test('MT.49 — repeated ids across page boundaries are deduped', async () => {
  const first = Array.from({ length: 500 }, (_, i) => i + 1);
  const responses = [LOGIN_OK,
    json({ count: 505, results: first.map(id => ({ id })) }),
    json({ count: 505, results: [500, 501, 502, 503, 504, 505].map(id => ({ id })) })];
  let i = 0;
  const c = new WineXRayClient({ username: 'u', password: 'p', fetchImpl: async () => responses[i++] });
  await c.login();
  const rows = await c.listResults({ from: '2026-07-01', to: '2026-10-31' });
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'no duplicate ids');
  assert.equal(rows.length, 505);
});

// ── MAJOR 5: a cross-year range was truncated by the season filter ────
test('MT.49 — season bounds span the whole requested window', async () => {
  const bodies = [];
  const responses = [LOGIN_OK, json({ count: 0, results: [] })];
  let i = 0;
  const c = new WineXRayClient({
    username: 'u', password: 'p',
    fetchImpl: async (url, opts) => { bodies.push(safeJson(opts.body)); return responses[i++]; },
  });
  await c.login();
  await c.listResults({ from: '2025-12-20', to: '2026-01-10' });
  const q = bodies.find(Boolean);
  assert.equal(q.seasonStart, '2025-01-01');
  assert.equal(q.seasonEnd, '2026-12-31', 'season must not end before the requested window');
});

// ── BLOCKER 2: a partial write let the cursor skip rows permanently ───
test('MT.49 — the resume cursor tracks the table furthest behind', async () => {
  // berry_samples lags (a failed write); wine_samples is current. The next run
  // must resume from the BERRY date, or those samples are lost forever.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('berry_samples')) return json([{ sample_date: '2026-08-01' }]);
    if (u.includes('wine_samples')) return json([{ sample_date: '2026-08-28' }]);
    throw new Error('unexpected ' + u);
  };
  try {
    let asked = null;
    await runSync({}, {
      makeClient: () => ({ async fetchExportCsv(r) { asked = r; return { buffer: null, sampleCount: 0 }; } }),
    });
    assert.equal(asked.from, '2026-07-25', 'must resume 7 days before the LAGGING table, not the leading one');
  } finally { globalThis.fetch = realFetch; }
});

test('MT.49 — a Supabase cursor failure fails the run instead of syncing a wrong window', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => mkRes({ status: 500, headers: { 'content-type': 'application/json' }, body: '{}' });
  try {
    const res = httpRes();
    await handler({ method: 'POST', headers: { 'x-session-token': mintToken('lab') }, body: {}, socket: {} }, res);
    assert.equal(res.out.statusCode, 502);
    assert.equal(res.out.body.ok, false);
    assert.match(res.out.body.error, /no se pudo consultar|base de datos/i,
      'must be a Spanish failure, not a silent broad sync');
  } finally { globalThis.fetch = realFetch; }
});

// ── MAJOR 6: an empty DB before July synced a single day ──────────────
test('MT.49 — an empty database before July pulls the previous harvest season', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json([]);
  try {
    let asked = null;
    await runSync({ to: '2027-02-15' }, {
      makeClient: () => ({ async fetchExportCsv(r) { asked = r; return { buffer: null, sampleCount: 0 }; } }),
    });
    assert.equal(asked.from, '2026-07-01', 'February belongs to the season that opened last July');
    assert.ok(asked.from < asked.to);
  } finally { globalThis.fetch = realFetch; }
});

// ── MAJOR 4: a joiner got another window's success ───────────────────
test('MT.49 — a concurrent request for a different window is refused, not joined', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = () => ({ async fetchExportCsv() { await gate; return { buffer: null, sampleCount: 0 }; } });

  // Any real network call here is a test bug: fail loudly rather than reach out.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async u => { throw new Error(`test must not hit the network: ${u}`); };

  const resA = httpRes();
  const a = handler({ method: 'POST', headers: { 'x-session-token': mintToken('lab') },
    body: { from: '2026-01-01', to: '2026-01-31' }, socket: {} }, resA, { makeClient: slow });

  // Give A a tick to register itself as in flight.
  await new Promise(r => setImmediate(r));

  const resB = httpRes();
  await handler({ method: 'POST', headers: { 'x-session-token': mintToken('lab') },
    body: { from: '2026-08-01', to: '2026-08-31' }, socket: {} }, resB);

  assert.equal(resB.out.statusCode, 409, 'August must not receive January’s answer');
  assert.match(resB.out.body.error, /sincronizaci[oó]n en curso/i);
  release();
  await a;
  assert.equal(resA.out.statusCode, 200, 'the first window must still complete');
  globalThis.fetch = realFetch;
});

test('MT.49 — the too-many-pages guard is a Spanish error, not a truncated success', async () => {
  const full = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
  let i = 0;
  const c = new WineXRayClient({
    username: 'u', password: 'p',
    fetchImpl: async () => (i++ === 0 ? LOGIN_OK : json({ count: 999999, results: full })),
  });
  await c.login();
  await assert.rejects(
    () => c.listResults({ from: '2020-01-01', to: '2026-12-31', maxPages: 3 }),
    e => e instanceof WineXRayError && e.code === 'winexray_too_many'
  );
});
