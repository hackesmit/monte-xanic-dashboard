// MT.41 — /api/upload upsert-key integrity (bead xd-qub).
//
// The (sample_id, sample_date, sample_seq) natural key is enforced by a DB
// unique constraint (sql/migration_sample_seq.sql, sql/migration_berry_samples.sql),
// and PostgREST upserts with resolution=merge-duplicates against it. But Postgres
// treats NULL as distinct, so a NULL in any key column silently defeats the
// constraint: the row INSERTs fresh on every retry instead of merging. A sync
// button makes double-clicks, timeout retries, and overlapping runs ordinary,
// so an upload path that lets a NULL-keyed row through duplicates data.
//
// These tests demonstrate: (a) two genuinely distinct samples do NOT collide on
// the upsert key — both reach Supabase with distinct keys under one on_conflict
// upsert; (b) a row whose key column is NULL/empty/missing is rejected before it
// can duplicate; (c) the defaulted disambiguator sample_seq may be omitted.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const handler = (await import('../api/upload.js')).default;

function token(role = 'lab', user = 'labuser') {
  const payloadB64 = Buffer.from(JSON.stringify({
    exp: Date.now() + 60_000, role, user, nonce: 'n',
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() {},
  };
}

function makeReq(body, role = 'lab') {
  return {
    method: 'POST',
    headers: { 'x-session-token': token(role) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

// Stub fetch: satisfy verifyToken's blacklist lookup, capture the Supabase
// upsert, and echo back the rows PostgREST would have written.
function stubSupabase() {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('blacklist')) return { ok: true, json: async () => [] };
    calls.push({ url, opts });
    const rows = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows };
  };
  return calls;
}

describe('MT.41 — /api/upload distinct samples do not collide on the upsert key', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('forwards two distinct wine_samples (same id, different date) as one on_conflict upsert, both keys intact', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'wine_samples',
      rows: [
        { sample_id: '25CSMX-1', sample_date: '2025-08-01', brix: 24.1 },
        { sample_id: '25CSMX-1', sample_date: '2025-08-08', brix: 25.3 },
      ],
    });
    const res = makeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 2);
    assert.equal(calls.length, 1, 'a single batched upsert, not row-by-row');
    // Conflict key + merge semantics are what makes the retry-safe dedup real.
    assert.match(calls[0].url, /\?on_conflict=sample_id%2Csample_date%2Csample_seq/);
    // missing=default is what makes the keyDefault allowance real. PostgREST
    // builds one INSERT from the union of keys across the batch, so without it
    // a column some rows carry and others omit (sample_seq) is sent as NULL for
    // the omitting rows: either failing its NOT NULL for the whole batch, or
    // writing a NULL that makes the composite unique constraint a no-op and
    // brings duplicate-on-retry straight back.
    const prefer = calls[0].opts.headers.Prefer.split(',').map(s => s.trim());
    assert.ok(prefer.includes('resolution=merge-duplicates'), 'merge semantics required');
    assert.ok(prefer.includes('missing=default'),
      'omitted keyDefault columns must resolve to the DB default, not NULL');
    // Both distinct samples survive to the DB — they differ on sample_date, so
    // the composite key keeps them apart rather than merging one onto the other.
    const sent = JSON.parse(calls[0].opts.body);
    assert.equal(sent.length, 2);
    assert.deepEqual(
      sent.map(r => `${r.sample_id}|${r.sample_date}`).sort(),
      ['25CSMX-1|2025-08-01', '25CSMX-1|2025-08-08'],
    );
  });

  it('allows sample_seq to be omitted (DB default keeps the arbiter deterministic)', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'wine_samples',
      rows: [{ sample_id: '25CSMX-2', sample_date: '2025-08-01', brix: 24.0 }],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1, 'the row reached Supabase — omission is allowed');
    assert.equal('sample_seq' in JSON.parse(calls[0].opts.body)[0], false);
  });
});

describe('MT.41 — /api/upload rejects NULL/missing key columns before they can duplicate', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('rejects a wine_samples row with a missing sample_date (would INSERT-not-merge on retry)', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'wine_samples',
      rows: [{ sample_id: '25CSMX-3', brix: 24.0 }],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /sample_date/);
    assert.equal(calls.length, 0, 'nothing reaches Supabase — no duplicate can be created');
  });

  it('rejects a wine_samples row with an explicit NULL sample_date', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'wine_samples',
      rows: [{ sample_id: '25CSMX-4', sample_date: null, brix: 24.0 }],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /sample_date/);
    assert.equal(calls.length, 0);
  });

  it('rejects an explicit empty-string sample_seq (cannot fall back to the DB default)', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'wine_samples',
      rows: [{ sample_id: '25CSMX-5', sample_date: '2025-08-01', sample_seq: '' }],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /sample_seq/);
    assert.equal(calls.length, 0);
  });

  it('rejects a berry_samples row missing sample_date the same way', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'berry_samples',
      rows: [{ sample_id: '25CSMX-6', berry_count: 100 }],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /sample_date/);
    assert.equal(calls.length, 0);
  });

  it('rejects a reception_lots row missing its lot_position key (multi-lot dedup)', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'reception_lots',
      rows: [{ report_code: 'R-1', lot_code: 'LOTE-A' }],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /lot_position/);
    assert.equal(calls.length, 0);
  });

  it('reports the offending row index so a bad row in a batch is findable', async () => {
    const calls = stubSupabase();
    const req = makeReq({
      table: 'wine_samples',
      rows: [
        { sample_id: '25CSMX-7', sample_date: '2025-08-01' },
        { sample_id: '25CSMX-8' }, // missing date — row 2
      ],
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Fila 2/);
    assert.equal(calls.length, 0);
  });
});
