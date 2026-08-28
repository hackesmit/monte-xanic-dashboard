// MT.48 — WineXRay sync: handler gating and the parse-then-upsert integration.
//
// The integration test drives the REAL parser and the REAL upsert validation
// with a stub adapter, so it proves the sync path reuses the manual path's
// semantics rather than reimplementing them — including the repair for the
// unquoted "Total Phenolics Index (IPT, d-less)" header, which the shared
// fixture carries (59 header fields against 58 data fields on a naive split).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

process.env.SESSION_SECRET = 'test-secret-for-mt48';
// Present so runSync passes its config check; the stub adapter means no
// request is ever made to either host.
process.env.SUPABASE_URL = 'https://stub.invalid';
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.WINEXRAY_USERNAME = 'lab-user';
process.env.WINEXRAY_PASSWORD = 'sup3r-s3cret-pw';

const { default: handler, runSync } = await import('../api/winexray-sync.js');

function mintToken(role, ttlMs = 60_000) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function mkRes() {
  const out = { statusCode: null, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
    status(code) { out.statusCode = code; return this; },
    json(b) { out.body = b; return this; },
    end() { return this; },
  };
}

const mkReq = (over = {}) => ({ method: 'POST', headers: {}, body: {}, socket: {}, ...over });

async function fixtureBuffer() {
  const buf = await readFile(new URL('./fixtures/winexray_mixed.csv', import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// A stand-in for WineXRayClient with the same surface runSync uses.
function stubClient(result) {
  return () => ({ async fetchExportCsv() { return result; } });
}

test('MT.48 — non-POST is rejected before any auth or upstream work', async () => {
  const res = mkRes();
  await handler(mkReq({ method: 'GET' }), res);
  assert.equal(res.out.statusCode, 405);
  assert.equal(res.out.headers['cache-control'], 'no-store');
});

test('MT.48 — a request with no session token is refused in Spanish', async () => {
  const res = mkRes();
  await handler(mkReq({ headers: {} }), res);
  assert.equal(res.out.statusCode, 401);
  assert.equal(res.out.body.error, 'No autorizado');
});

test('MT.48 — a valid non-lab role cannot sync', async () => {
  for (const role of ['viewer', 'admin']) {
    const res = mkRes();
    await handler(mkReq({ headers: { 'x-session-token': mintToken(role) } }), res);
    assert.equal(res.out.statusCode, 403, `role ${role} must be refused`);
    assert.match(res.out.body.error, /Sin permisos/);
  }
});

test('MT.48 — an expired lab token is refused', async () => {
  const res = mkRes();
  await handler(mkReq({ headers: { 'x-session-token': mintToken('lab', -1000) } }), res);
  assert.equal(res.out.statusCode, 401);
});

test('MT.48 — a malformed date is rejected before contacting WineXRay', async () => {
  const res = mkRes();
  await handler(mkReq({
    headers: { 'x-session-token': mintToken('lab') },
    body: { from: '2026-08-01T00:00:00Z' },
  }), res);
  assert.equal(res.out.statusCode, 400);
  assert.match(res.out.body.error, /AAAA-MM-DD/);
});

test('MT.48 — the fixture reproduces the malformed IPT header', async () => {
  const text = new TextDecoder().decode(await fixtureBuffer());
  const header = text.split('\n')[0];
  assert.ok(header.includes('Total Phenolics Index (IPT, d-less)'));
  assert.ok(!header.includes('"Total Phenolics Index (IPT, d-less)"'),
    'fixture must keep the header UNQUOTED — that is the regression case');
});

test('MT.48 — sync parses the export and upserts through the shared core', async () => {
  const seen = [];
  const out = await runSync({ from: '2026-07-01', to: '2026-07-31' }, {
    makeClient: stubClient({ buffer: await fixtureBuffer(), sampleCount: 12 }),
    upsert: async ({ table, rows }) => {
      seen.push({ table, rows });
      return { status: 200, body: { ok: true, count: rows.length } };
    },
  });

  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  const tables = seen.map(s => s.table);
  assert.ok(tables.includes('berry_samples'), 'berry samples must be written');
  assert.equal(out.body.count, seen.reduce((n, s) => n + s.rows.length, 0));
  assert.deepEqual(out.body.rango, { desde: '2026-07-01', hasta: '2026-07-31' });
  assert.match(out.body.mensaje, /Se sincronizaron \d+ muestras de WineXRay/);

  // Every written row carries the full natural key, or the shared upsert-key
  // guard would reject it and duplicates would accumulate on retry.
  for (const { rows } of seen) {
    for (const r of rows) {
      assert.ok(r.sample_id, 'sample_id must be present');
      assert.ok(r.sample_date, 'sample_date must be present');
    }
  }
});

test('MT.48 — IPT survives the sync path, proving the header repair ran', async () => {
  const seen = [];
  await runSync({ from: '2026-07-01', to: '2026-07-31' }, {
    makeClient: stubClient({ buffer: await fixtureBuffer(), sampleCount: 12 }),
    upsert: async ({ table, rows }) => { seen.push({ table, rows }); return { status: 200, body: { ok: true, count: rows.length } }; },
  });
  const all = seen.flatMap(s => s.rows);
  // Without the repair the column splits and nothing lands in `ipt` at all.
  assert.ok(all.some(r => r.ipt !== undefined && r.ipt !== null),
    'at least one row must carry a parsed IPT value');
});

test('MT.48 — an empty window reports success with zero rows, in Spanish', async () => {
  const out = await runSync({ from: '2026-01-01', to: '2026-01-02' }, {
    makeClient: stubClient({ buffer: null, sampleCount: 0 }),
    upsert: async () => { throw new Error('upsert must not be called'); },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.count, 0);
  assert.match(out.body.mensaje, /Sin muestras nuevas/);
});

test('MT.48 — an upsert failure surfaces the table and range, not a silent no-op', async () => {
  const out = await runSync({ from: '2026-07-01', to: '2026-07-31' }, {
    makeClient: stubClient({ buffer: await fixtureBuffer(), sampleCount: 12 }),
    upsert: async () => ({ status: 400, body: { ok: false, error: "llave de conflicto 'sample_date' falta o está vacía" } }),
  });
  assert.equal(out.status, 400);
  assert.equal(out.body.ok, false);
  assert.ok(out.body.tabla);
  assert.deepEqual(out.body.rango, { desde: '2026-07-01', hasta: '2026-07-31' });
});

test('MT.48 — start after end is clamped rather than sent as an inverted range', async () => {
  let asked = null;
  await runSync({ from: '2026-09-30', to: '2026-07-01' }, {
    makeClient: () => ({ async fetchExportCsv(range) { asked = range; return { buffer: null, sampleCount: 0 }; } }),
  });
  assert.ok(asked.from <= asked.to, `range must not be inverted: ${JSON.stringify(asked)}`);
});
