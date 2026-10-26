// MT.74 — token_blacklist is swept, off the auth path (xd-mqy)
//
// sql/migration_token_blacklist.sql promised an auto-cleanup of revocations
// older than a token's life, and nothing ever deleted a row. Round 1 swept from
// /api/logout; the cross-vendor review sent it back: the sweep sat on the
// logout path, and its single unbounded DELETE could time out and roll back
// all its work on every try. Round 2: a daily cron (/api/sweep-blacklist)
// calls public.token_blacklist_sweep, which deletes at most p_limit expired
// rows per call, so each batch commits on its own.
//
// The Postgres part needs XD_TEST_PG (a libpq conninfo string) and psql on
// PATH. It runs in ONE transaction that ends in ROLLBACK.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const logoutHandler = (await import('../api/logout.js')).default;
const sweepHandler = (await import('../api/sweep-blacklist.js')).default;
const { sweepExpiredRevocations, BATCH_SIZE, MAX_BATCHES } = await import('../api/_lib/blacklistSweep.js');
const { MIGRATIONS } = await import('../js/migrations-manifest.js');

const HOUR = 60 * 60 * 1000;
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const MIGRATION = read('sql/migration_token_blacklist_sweep.sql');

function validToken() {
  const payloadB64 = Buffer.from(JSON.stringify({
    exp: Date.now() + 60_000, role: 'lab', user: 'labuser', nonce: crypto.randomUUID(),
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
  };
}

function resp({ ok = true, status = 200, body = null } = {}) {
  return { ok, status, text: async () => JSON.stringify(body), json: async () => body };
}

// A fetch that answers each RPC call with the next count in `counts`.
function batchFetch(counts, calls) {
  let i = 0;
  return async (url, opts) => {
    calls.push({ url, opts });
    const n = counts[i++];
    if (n instanceof Error) throw n;
    if (typeof n === 'object' && n !== null) return resp(n);
    return resp({ body: n });
  };
}

// A fetch that never answers on its own and rejects only when its signal fires.
function hangingFetch(_url, opts = {}) {
  return new Promise((_, reject) => {
    const sig = opts.signal;
    if (!sig) return;
    sig.addEventListener('abort', () => reject(sig.reason), { once: true });
  });
}

const quiet = () => {};

describe('MT.74 — the sweep is off the auth path', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('logout makes exactly one Supabase call, the revoke insert', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, method: opts?.method });
      // verifyToken's blacklist read answers "not revoked"; the insert succeeds.
      return url.includes('token_blacklist?') ? resp({ body: [] }) : resp({ status: 201 });
    };
    const res = makeRes();
    await logoutHandler({ method: 'POST', body: { token: validToken() }, headers: {},
      socket: { remoteAddress: '127.0.0.1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.filter((c) => c.method !== undefined && c.method !== 'GET')
      .map((c) => [c.method, c.url]), [['POST', 'https://test.supabase.co/rest/v1/token_blacklist']]);
    assert.ok(!calls.some((c) => /rpc\/token_blacklist_sweep|DELETE/.test(`${c.method} ${c.url}`)));
  });

  it('no auth handler imports the sweep', () => {
    for (const f of ['api/logout.js', 'api/verify.js', 'api/login.js', 'api/_lib/verifyToken.js']) {
      const src = read(f);
      assert.ok(!/blacklistSweep|token_blacklist_sweep/.test(src), `${f} must not sweep`);
    }
  });
});

describe('MT.74 — sweepExpiredRevocations runs bounded batches', () => {
  it('calls the RPC with p_limit until a batch comes back short', async () => {
    const calls = [];
    const out = await sweepExpiredRevocations('https://x.supabase.co', 'k', {
      fetchImpl: batchFetch([3, 3, 1], calls), batchSize: 3, log: quiet,
    });
    assert.deepEqual(out, { ok: true, deleted: 7, batches: 3, done: true });
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.url, 'https://x.supabase.co/rest/v1/rpc/token_blacklist_sweep');
      assert.equal(c.opts.method, 'POST');
      assert.deepEqual(JSON.parse(c.opts.body), { p_limit: 3 });
      assert.equal(c.opts.headers.Authorization, 'Bearer k');
      assert.ok(c.opts.signal instanceof AbortSignal);
    }
  });

  it('is idempotent: nothing to delete is one call, ok and done', async () => {
    const calls = [];
    const out = await sweepExpiredRevocations('u', 'k', { fetchImpl: batchFetch([0], calls), log: quiet });
    assert.deepEqual(out, { ok: true, deleted: 0, batches: 1, done: true });
    assert.equal(calls.length, 1);
  });

  it('stops at maxBatches and reports the backlog as not done', async () => {
    const calls = [];
    const out = await sweepExpiredRevocations('u', 'k', {
      fetchImpl: batchFetch(Array(10).fill(2), calls), batchSize: 2, maxBatches: 4, log: quiet,
    });
    assert.deepEqual(out, { ok: true, deleted: 8, batches: 4, done: false });
    assert.equal(calls.length, 4);
  });

  it('a rejected batch stops the run and keeps the count of committed batches', async () => {
    const calls = [];
    const out = await sweepExpiredRevocations('u', 'k', {
      fetchImpl: batchFetch([2, { ok: false, status: 500, body: { message: 'boom' } }, 2], calls),
      batchSize: 2, log: quiet,
    });
    assert.deepEqual(out, { ok: false, deleted: 2, batches: 1, done: false });
    assert.equal(calls.length, 2);
  });

  it('a thrown batch never throws out of the helper', async () => {
    const out = await sweepExpiredRevocations('u', 'k', {
      fetchImpl: batchFetch([new Error('network down')], []), log: quiet,
    });
    assert.deepEqual(out, { ok: false, deleted: 0, batches: 0, done: false });
  });

  it('an unexpected body (not a count within the limit) is a failure', async () => {
    for (const body of [null, '5', -1, 1.5, 4]) {
      const out = await sweepExpiredRevocations('u', 'k', {
        fetchImpl: batchFetch([body], []), batchSize: 3, log: quiet,
      });
      assert.equal(out.ok, false, `body ${JSON.stringify(body)}`);
    }
  });

  it('a hanging batch is cut off by its deadline', async () => {
    const t0 = Date.now();
    const out = await sweepExpiredRevocations('u', 'k', {
      fetchImpl: hangingFetch, batchTimeoutMs: 50, log: quiet,
    });
    assert.deepEqual(out, { ok: false, deleted: 0, batches: 0, done: false });
    assert.ok(Date.now() - t0 < 1000);
  });

  it('stops starting batches once the run budget is spent', async () => {
    let t = 0;
    const calls = [];
    const fetchImpl = async (url, opts) => { t += 400; calls.push(opts); return resp({ body: 2 }); };
    const out = await sweepExpiredRevocations('u', 'k', {
      fetchImpl, batchSize: 2, budgetMs: 1000, clock: () => t, log: quiet,
    });
    assert.equal(calls.length, 3, 'batches start at t=0, 400, 800; none at 1200');
    assert.deepEqual(out, { ok: true, deleted: 6, batches: 3, done: false });
  });

  it('defaults keep one run bounded', () => {
    assert.ok(BATCH_SIZE >= 1 && BATCH_SIZE <= 10000, 'within the SQL p_limit range');
    assert.ok(MAX_BATCHES >= 1 && MAX_BATCHES <= 50);
  });
});

describe('MT.74 — /api/sweep-blacklist', () => {
  let originalFetch;
  let originalSecret;
  beforeEach(() => { originalFetch = globalThis.fetch; originalSecret = process.env.CRON_SECRET; process.env.CRON_SECRET = 'cron-s'; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  });

  const req = (auth, method = 'GET') => ({ method, headers: auth ? { authorization: auth } : {} });

  it('refuses a caller without the cron secret before any DB work', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return resp({ body: 0 }); };
    for (const r of [req(null), req('Bearer nope')]) {
      const res = makeRes();
      await sweepHandler(r, res);
      assert.equal(res.statusCode, 401);
    }
    delete process.env.CRON_SECRET;
    const res = makeRes();
    await sweepHandler(req('Bearer undefined'), res);
    assert.equal(res.statusCode, 401, 'unset CRON_SECRET fails closed');
    assert.equal(called, false);
  });

  it('refuses a non-GET', async () => {
    const res = makeRes();
    await sweepHandler(req('Bearer cron-s', 'POST'), res);
    assert.equal(res.statusCode, 405);
  });

  it('answers 200 with the counts when the sweep finishes', async () => {
    globalThis.fetch = batchFetch([BATCH_SIZE, 7], []);
    const res = makeRes();
    const log = console.log; console.log = quiet;
    try { await sweepHandler(req('Bearer cron-s'), res); } finally { console.log = log; }
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, deleted: BATCH_SIZE + 7, batches: 2, done: true });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });

  it('answers 500 with what was deleted when a batch fails', async () => {
    globalThis.fetch = batchFetch([BATCH_SIZE, { ok: false, status: 503 }], []);
    const res = makeRes();
    const err = console.error; console.error = quiet;
    try { await sweepHandler(req('Bearer cron-s'), res); } finally { console.error = err; }
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.deleted, BATCH_SIZE);
  });

  it('is declared as a daily Vercel cron', () => {
    const { crons } = JSON.parse(read('vercel.json'));
    const c = crons.find((x) => x.path === '/api/sweep-blacklist');
    assert.ok(c, 'cron declared');
    assert.match(c.schedule, /^\d+ \d+ \* \* \*$/);
    assert.ok(crons.some((x) => x.path === '/api/ping'), 'keep-alive cron kept');
  });
});

describe('MT.74 — the migration', () => {
  it('records itself in applied_migrations and the manifest', () => {
    assert.match(MIGRATION, /^BEGIN;$/m);
    assert.match(MIGRATION, /^COMMIT;\n$/m);
    assert.match(MIGRATION, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_token_blacklist_sweep'\)\s+ON CONFLICT \(name\) DO NOTHING;/);
    assert.ok(MIGRATIONS.includes('migration_token_blacklist_sweep'));
  });

  it('only service_role may run the function', () => {
    assert.match(MIGRATION, /REVOKE EXECUTE ON FUNCTION public\.token_blacklist_sweep\(INTEGER\) FROM PUBLIC, anon, authenticated;/);
    assert.match(MIGRATION, /GRANT\s+EXECUTE ON FUNCTION public\.token_blacklist_sweep\(INTEGER\) TO service_role;/);
  });

  it('the window outlives every token: login token life plus an hour of clock skew', () => {
    // exp is stamped on the login host, invalidated_at by Postgres; a row may
    // go only once its token has expired on every clock that judges it.
    const src = read('api/login.js');
    const m = src.match(/exp:\s*Date\.now\(\)\s*\+\s*([\d\s*]+?)\s*,/);
    assert.ok(m, 'api/login.js still sets exp as Date.now() + <ms literal>');
    const ttl = m[1].split('*').map((s) => Number(s.trim())).reduce((a, b) => a * b, 1);
    assert.ok(Number.isFinite(ttl) && ttl > 0, `token life parsed: ${m[1]}`);
    const w = [...MIGRATION.matchAll(/now\(\) - interval '(\d+) hours'/g)];
    assert.equal(w.length, 1, 'one window in the function');
    assert.ok(Number(w[0][1]) * HOUR >= ttl + HOUR, `window ${w[0][1]} h must cover ${ttl} ms plus 1 h`);
  });
});

const PG = process.env.XD_TEST_PG;

// The migration without its transaction and its applied_migrations row, so the
// test can load it into its own rolled-back transaction.
function migrationBody() {
  return MIGRATION.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
    .replace(/INSERT INTO public\.applied_migrations[\s\S]*?DO NOTHING;/, '');
}

function runPsql(body) {
  const sql = `
\\set ON_ERROR_STOP 1
SET client_min_messages = error;
BEGIN;
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
CREATE TABLE IF NOT EXISTS public.token_blacklist (
  token_hash TEXT PRIMARY KEY,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA public TO service_role, anon;
-- Supabase grants service_role ALL on public tables; FOR UPDATE needs UPDATE.
GRANT ALL ON public.token_blacklist TO service_role;
${migrationBody()}
DELETE FROM public.token_blacklist WHERE token_hash LIKE 'mt74-%';
INSERT INTO public.token_blacklist (token_hash, invalidated_at)
  SELECT 'mt74-old-' || g, now() - interval '3 hours' - make_interval(secs => g) FROM generate_series(1, 2500) g;
INSERT INTO public.token_blacklist (token_hash, invalidated_at)
  SELECT 'mt74-live-' || g, now() - interval '3 hours' + make_interval(secs => g) FROM generate_series(1, 5) g;
${body}
ROLLBACK;
`;
  return execFileSync('psql', [PG, '-X', '-q', '-A', '-t'], {
    input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n');
}

describe('MT.74 — real Postgres: token_blacklist_sweep', { skip: PG ? false : 'XD_TEST_PG not set' }, () => {
  it('deletes at most p_limit expired rows per call, then 0, and never a live one', () => {
    const out = runPsql(`
SET LOCAL ROLE service_role;
SELECT public.token_blacklist_sweep(1000);
SELECT public.token_blacklist_sweep(1000);
SELECT public.token_blacklist_sweep(1000);
SELECT public.token_blacklist_sweep(1000);
RESET ROLE;
SELECT 'old_left=' || count(*) FROM public.token_blacklist WHERE token_hash LIKE 'mt74-old-%';
SELECT 'live_left=' || count(*) FROM public.token_blacklist WHERE token_hash LIKE 'mt74-live-%';
`);
    assert.deepEqual(out, ['1000', '1000', '500', '0', 'old_left=0', 'live_left=5']);
  });

  it('deletes the oldest rows first', () => {
    const out = runPsql(`
SET LOCAL ROLE service_role;
SELECT public.token_blacklist_sweep(10);
RESET ROLE;
SELECT 'gone_oldest=' || count(*) FROM generate_series(2491, 2500) g
  WHERE NOT EXISTS (SELECT 1 FROM public.token_blacklist WHERE token_hash = 'mt74-old-' || g);
`);
    assert.deepEqual(out, ['10', 'gone_oldest=10']);
  });

  it('refuses an out-of-range limit', () => {
    for (const lim of ['0', '10001', 'NULL']) {
      assert.throws(() => runPsql(`SELECT public.token_blacklist_sweep(${lim});`),
        (err) => /p_limit must be between 1 and 10000/.test(String(err.stderr)), `limit ${lim}`);
    }
  });

  it('anon may not run it', () => {
    assert.throws(() => runPsql('SET LOCAL ROLE anon;\nSELECT public.token_blacklist_sweep(10);'),
      (err) => /permission denied for function token_blacklist_sweep/.test(String(err.stderr)));
  });
});
