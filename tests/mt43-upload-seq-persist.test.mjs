// MT.43 — WineXRay parse → /api/upload: same-day same-id samples both persist
// (bead xd-lf9, DoD closure).
//
// xd-lf9's DoD is "a test proves two same-day same-id rows both persist". The
// mt13 parser tests only prove parse() emits two distinct in-memory sample_seq
// keys; they never exercise the upsert. This test drives the REAL path end to
// end: winexrayParser.parse produces the targets, and each target is POSTed
// through the actual /api/upload handler exactly as js/upload.js does, against
// a PostgREST stub that models `resolution=merge-duplicates` ON CONFLICT.
//
// The stub is the point. Postgres raises 21000 ("ON CONFLICT DO UPDATE command
// cannot affect row a second time") when one upsert batch carries the same
// conflict key twice — the exact failure the bead describes for two genuinely
// distinct same-day samples that share a sample_id. The parser's sample_seq
// assignment is what keeps their (sample_id, sample_date, sample_seq) keys
// apart. So if the parser ever stopped assigning sample_seq, both rows would
// resolve to the same DB default seq, collide, and the batch would abort —
// which the "negative control" test below asserts directly, pinning the test's
// sensitivity to the fix under review.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const handler = (await import('../api/upload.js')).default;
const { winexrayParser } = await import('../js/upload/winexray.js');

// ── Test plumbing (mirrors tests/mt41-api-upload-key.test.mjs) ──

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

// Wrap a Buffer as the File-like object the parser consumes (mirrors mt13).
function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

// Stub fetch modelling PostgREST upsert with resolution=merge-duplicates against
// the table's composite unique key. Surviving rows land in `db` keyed by their
// natural key, so a test can assert BOTH rows persist as distinct records. A
// conflict key that appears twice in a single batch triggers Postgres 21000,
// exactly as the live upsert would when two rows share the same default seq.
function stubPostgrest() {
  const db = new Map();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('blacklist')) return { ok: true, json: async () => [] };
    calls.push({ url, opts });
    const rows = JSON.parse(opts.body);
    const m = String(url).match(/on_conflict=([^&]+)/);
    const keyCols = m ? decodeURIComponent(m[1]).split(',') : [];
    // Absent sample_seq resolves to the single DB default for every row (the
    // handler sends Prefer: missing=default), so an omitted key collapses to one
    // shared value — model that as '' here.
    const keyOf = r => keyCols.map(c => `${r[c] ?? ''}`).join('|');
    const seenInBatch = new Set();
    for (const r of rows) {
      const k = keyOf(r);
      if (seenInBatch.has(k)) {
        return { ok: false, status: 409, text: async () => JSON.stringify({
          code: '21000',
          message: 'ON CONFLICT DO UPDATE command cannot affect row a second time',
        }) };
      }
      seenInBatch.add(k);
      db.set(k, r); // insert-or-merge on the natural key
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows };
  };
  return { calls, db, restore() { globalThis.fetch = originalFetch; } };
}

// Two genuinely distinct same-day same-id rows (a re-measurement the same day),
// per table. Same Sample Id + Sample Date, different brix — the case the natural
// key must keep apart.
function sameDayCsv(sampleType) {
  return [
    'Sample Id,Sample Type,Sample Date,Vintage,Variety,Appellation,Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)',
    `25CSMX-1,${sampleType},2/27/2026,2025,Cabernet Sauvignon,Valle de Guadalupe,23.1`,
    `25CSMX-1,${sampleType},2/27/2026,2025,Cabernet Sauvignon,Valle de Guadalupe,24.8`,
  ].join('\n');
}

// Parse a CSV through the real WineXRay parser and return the requested target.
async function parseTarget(csv, table) {
  const file = asFakeFile(Buffer.from(csv), `${table}.csv`);
  const result = await winexrayParser.parse(file);
  return result.targets.find(t => t.table === table);
}

// Drive one parsed target through the real /api/upload handler, exactly as
// js/upload.js#upsertRows does: POST { table, rows }.
async function upload(target) {
  const req = makeReq({ table: target.table, rows: target.rows });
  const res = makeRes();
  await handler(req, res);
  return res;
}

const CASES = [
  { table: 'wine_samples',  sampleType: 'Aging Wine' },
  { table: 'berry_samples', sampleType: 'Berries' },
];

describe('MT.43 — parse → /api/upload: same-day same-id rows both persist', () => {
  let stub;
  beforeEach(() => { stub = stubPostgrest(); });
  afterEach(() => { stub.restore(); });

  for (const { table, sampleType } of CASES) {
    it(`${table}: two same-day same-id samples both reach the DB with distinct keys`, async () => {
      const target = await parseTarget(sameDayCsv(sampleType), table);
      assert.equal(target.rows.length, 2, 'parser must emit both same-day rows');
      assert.equal(target.conflictKey, 'sample_id,sample_date,sample_seq');

      const res = await upload(target);

      // The batch was accepted — no 21000 collision, both rows counted.
      assert.equal(res.statusCode, 200, `upload must succeed, got ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.count, 2, 'both rows must be upserted, not merged into one');
      assert.equal(stub.calls.length, 1, 'a single batched upsert against /api/upload');

      // The upsert requested the composite conflict key with merge semantics.
      assert.match(stub.calls[0].url, /\?on_conflict=sample_id%2Csample_date%2Csample_seq/);
      const prefer = stub.calls[0].opts.headers.Prefer.split(',').map(s => s.trim());
      assert.ok(prefer.includes('resolution=merge-duplicates'), 'merge semantics required');

      // BOTH survive as distinct records under the natural key. Without the
      // parser's sample_seq the two rows would share one default-seq key and
      // this map would hold a single row (or the batch would have 21000'd).
      assert.equal(stub.db.size, 2, 'both same-day rows must persist as distinct DB records');
      const seqs = [...stub.db.values()].map(r => r.sample_seq).sort((a, b) => a - b);
      assert.deepEqual(seqs, [1, 2], 'the surviving rows carry distinct sample_seq 1 and 2');
      const brixes = [...stub.db.values()].map(r => r.brix).sort((a, b) => a - b);
      assert.deepEqual(brixes, [23.1, 24.8], 'both re-measurements survive, neither overwritten');
    });
  }

  // Negative control — pins this test's sensitivity to the fix under review.
  // Reproduce the pre-fix parser output by stripping the sample_seq the parser
  // now assigns, then drive the SAME handler + stub. Both rows collapse to the
  // one DB-default seq, so the upsert batch aborts with 21000 and neither row
  // persists. This is the failure the change prevents, and it is what makes the
  // positive tests above fail if the parser ever stops assigning sample_seq.
  it('regression guard: without the parser-assigned sample_seq the same-day rows collide (21000) and do NOT both persist', async () => {
    const target = await parseTarget(sameDayCsv('Aging Wine'), 'wine_samples');
    assert.deepEqual(
      target.rows.map(r => r.sample_seq).sort((a, b) => a - b),
      [1, 2],
      'precondition: the current parser assigns distinct sample_seq',
    );
    // Simulate the parser NOT assigning sample_seq (the bug this bead fixes).
    for (const r of target.rows) delete r.sample_seq;

    const res = await upload(target);

    assert.equal(res.body.ok, false, 'a same-default-seq collision must not be reported as success');
    assert.equal(res.statusCode, 500, 'the aborted upsert surfaces as a server error');
    assert.notEqual(stub.db.size, 2, 'the two rows must NOT both persist without distinct sample_seq');
  });
});
