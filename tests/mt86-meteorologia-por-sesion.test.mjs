// MT.86 - meteorology is written only through a session check, never with the
// anon key (security audit 2026-10, bead xd-0lt.2).
//
// The finding: js/weather.js upserted Open-Meteo rows into meteorology with the
// anon key from /api/config, so RLS kept anon_insert WITH CHECK (true) and
// anon_update USING (true). The anon key outlives logout, so anyone who held it
// once could rewrite any day's weather for every user. Each part of the fix is
// pinned here:
//   1. api/meteorologia.js checks the token against the blacklist, fetches
//      Open-Meteo itself for the valley's fixed coordinates, range-checks every
//      value and upserts with the service key (the handler cases).
//   2. js/weather.js syncs through /api/meteorologia with the session token and
//      never writes through the anon client.
//   3. sql/migration_meteorologia_sin_escritura_anon.sql drops the anon write
//      policies and revokes the write grants. The Postgres case (XD_TEST_PG, a
//      THROWAWAY database; one transaction that ends in ROLLBACK) shows anon
//      rewriting a row before the migration and refused after it.
//
// Supabase and Open-Meteo are mocked by replacing globalThis.fetch, as in MT.85.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { todayInVineyard } from '../js/utils.js';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const exists = (rel) => fs.existsSync(new URL(rel, import.meta.url));
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

function token({ exp = Date.now() + 60_000 } = {}) {
  const payloadB64 = Buffer.from(JSON.stringify({ exp, role: 'viewer', user: 'u', nonce: 'n' })).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() {},
  };
}

let _n = 0;
const makeReq = ({ method = 'POST', body, tok = token() } = {}) => ({
  method,
  url: '/api/meteorologia',
  headers: { 'x-session-token': tok, 'x-real-ip': `10.0.0.${_n++ % 250}` },
  body,
  socket: { remoteAddress: '127.0.0.1' },
});

const jsonRes = (status, data) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(data), json: async () => data,
});

const DAILY = {
  time: ['2025-07-01', '2025-07-02'],
  temperature_2m_max: [31.2, 30.1],
  temperature_2m_min: [14.0, 13.5],
  temperature_2m_mean: [22.1, 21.4],
  precipitation_sum: [0, 0.4],
  relative_humidity_2m_mean: [55, 60],
  uv_index_max: [9.1, 8.8],
  wind_speed_10m_max: [18.0, 22.3],
};

// Routes the handler's outbound calls. `revocados` is the blacklist content.
let llamadas, revocados, daily, upsertStatus;
const realFetch = globalThis.fetch;
function mockFetch() {
  llamadas = []; revocados = []; daily = structuredClone(DAILY); upsertStatus = 201;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    llamadas.push({ url: u, opts });
    if (u.includes('/rest/v1/token_blacklist')) return jsonRes(200, revocados);
    if (u.startsWith('https://archive-api.open-meteo.com/')) return jsonRes(200, { daily });
    if (u.includes('/rest/v1/meteorology')) return jsonRes(upsertStatus, null);
    throw new Error(`unexpected fetch ${u}`);
  };
}
const openMeteo = () => llamadas.filter(c => c.url.includes('open-meteo.com'));
const escrituras = () => llamadas.filter(c => c.url.includes('/rest/v1/meteorology'));

const cargarHandler = async () => {
  assert.ok(exists('../api/meteorologia.js'), 'api/meteorologia.js exists (the session-checked sync route)');
  return (await import('../api/meteorologia.js')).default;
};

describe('MT.86 - /api/meteorologia writes only for a valid session', () => {
  beforeEach(mockFetch);
  afterEach(() => { globalThis.fetch = realFetch; });

  it('a valid session: the server fetches the valley, then upserts with the service key', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    await handler(makeReq({ body: { valle: 'VON', desde: '2025-07-01', hasta: '2025-07-02' } }), res);
    assert.equal(res.statusCode, 200);
    const [om] = openMeteo();
    const q = new URL(om.url).searchParams;
    assert.equal(q.get('latitude'), '32');          // CONFIG.valleyCoordinates.VON
    assert.equal(q.get('longitude'), '-116.25');
    assert.equal(q.get('start_date'), '2025-07-01');
    assert.equal(q.get('end_date'), '2025-07-02');
    const [w] = escrituras();
    assert.match(w.url, /\/rest\/v1\/meteorology\?on_conflict=date,location$/);
    assert.equal(w.opts.method, 'POST');
    assert.equal(w.opts.headers.apikey, 'test-service-key');
    assert.match(w.opts.headers.Prefer, /resolution=merge-duplicates/);
    const filas = JSON.parse(w.opts.body);
    assert.deepEqual(filas[0], {
      date: '2025-07-01', location: 'VON', temp_max: 31.2, temp_min: 14.0, temp_avg: 22.1,
      rainfall_mm: 0, humidity_pct: 55, uv_index: 9.1, wind_speed: 18.0,
    });
    assert.deepEqual(res.body, { ok: true, filas });
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  });

  it('a revoked, expired, rotated-secret or missing token writes nothing and fetches nothing', async () => {
    const handler = await cargarHandler();
    const body = { valle: 'VDG', desde: '2025-07-01', hasta: '2025-07-02' };
    const viejo = token();
    for (const tok of [token({ exp: Date.now() - 1 }), null]) {
      const res = makeRes();
      await handler(makeReq({ body, tok }), res);
      assert.equal(res.statusCode, 401);
    }
    process.env.SESSION_SECRET = 'rotated-secret';
    try {
      const res = makeRes();
      await handler(makeReq({ body, tok: viejo }), res);
      assert.equal(res.statusCode, 401);
    } finally {
      process.env.SESSION_SECRET = TEST_SECRET;
    }
    revocados = [{ token_hash: 'x' }];
    const res = makeRes();
    await handler(makeReq({ body }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(openMeteo().length, 0);
    assert.equal(escrituras().length, 0);
  });

  it('values come from Open-Meteo, never from the request body', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    await handler(makeReq({ body: {
      valle: 'VDG', desde: '2025-07-01', hasta: '2025-07-01',
      filas: [{ date: '2025-07-01', location: 'VDG', temp_max: 99 }], temp_max: 99, lat: 0,
    } }), res);
    assert.equal(res.statusCode, 200);
    const q = new URL(openMeteo()[0].url).searchParams;
    assert.equal(q.get('latitude'), '32.08');
    const filas = JSON.parse(escrituras()[0].opts.body);
    assert.deepEqual(filas.map(f => f.temp_max), [31.2]);
  });

  it('a day with a value out of range or not a number is dropped, nulls are kept', async () => {
    const handler = await cargarHandler();
    daily = {
      time: ['2025-07-01', '2025-07-02', '2025-07-03', '2025-07-04', '2025-07-05', '2025-07-06'],
      temperature_2m_max: [99, 30, 30, '30', 30, null],
      temperature_2m_min: [10, 10, 10, 10, 10, null],
      temperature_2m_mean: [20, 20, 20, 20, 20, null],
      precipitation_sum: [0, -1, 0, 0, 0, null],
      relative_humidity_2m_mean: [50, 50, 101, 50, 50, null],
      uv_index_max: [5, 5, 5, 5, 5, null],
      wind_speed_10m_max: [10, 10, 10, 10, 10, null],
    };
    const res = makeRes();
    await handler(makeReq({ body: { valle: 'SV', desde: '2025-07-01', hasta: '2025-07-06' } }), res);
    assert.equal(res.statusCode, 200);
    const filas = JSON.parse(escrituras()[0].opts.body);
    assert.deepEqual(filas.map(f => f.date), ['2025-07-05', '2025-07-06']);
    assert.equal(filas[1].temp_max, null);
  });

  it('a day outside the requested span is not written', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    await handler(makeReq({ body: { valle: 'VDG', desde: '2025-07-02', hasta: '2025-07-02' } }), res);
    assert.deepEqual(JSON.parse(escrituras()[0].opts.body).map(f => f.date), ['2025-07-02']);
  });

  it('a bad valley or date span is a 400 with no fetch and no write', async () => {
    const handler = await cargarHandler();
    for (const body of [
      { valle: 'XX', desde: '2025-07-01', hasta: '2025-07-02' },
      { valle: '__proto__', desde: '2025-07-01', hasta: '2025-07-02' },
      { valle: 'VDG', desde: '2025-07-02', hasta: '2025-07-01' },
      { valle: 'VDG', desde: '2025-02-30', hasta: '2025-03-02' },
      { valle: 'VDG', desde: '07/01/2025', hasta: '2025-07-02' },
      { valle: 'VDG', desde: '1900-01-01', hasta: '1900-01-02' },
      { valle: 'VDG', desde: '2015-01-01', hasta: '2025-01-01' },
      { valle: 'VDG' },
      undefined,
    ]) {
      const res = makeRes();
      await handler(makeReq({ body }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
    }
    assert.equal(openMeteo().length, 0);
    assert.equal(escrituras().length, 0);
  });

  it('an end date in the future is capped at today in the vineyard', async () => {
    const handler = await cargarHandler();
    const hoy = todayInVineyard();
    const res = makeRes();
    await handler(makeReq({ body: { valle: 'VDG', desde: hoy, hasta: '2999-12-31' } }), res);
    assert.equal(new URL(openMeteo()[0].url).searchParams.get('end_date'), hoy);
  });

  it('only POST is served', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(escrituras().length, 0);
  });

  it('a failed Open-Meteo call or a failed write is a 502, never a silent success', async () => {
    const handler = await cargarHandler();
    const body = { valle: 'VDG', desde: '2025-07-01', hasta: '2025-07-02' };
    upsertStatus = 500;
    let res = makeRes();
    await handler(makeReq({ body }), res);
    assert.equal(res.statusCode, 502);
    globalThis.fetch = async (url) => String(url).includes('token_blacklist')
      ? jsonRes(200, []) : jsonRes(503, {});
    res = makeRes();
    await handler(makeReq({ body }), res);
    assert.equal(res.statusCode, 502);
  });
});

describe('MT.86 - the dashboard syncs weather through /api/meteorologia', () => {
  let WeatherStore, DataStore, pedidas, anonEscrituras;
  beforeEach(async () => {
    ({ WeatherStore } = await import('../js/weather.js'));
    ({ DataStore } = await import('../js/dataLoader.js'));
    WeatherStore.data = []; WeatherStore._byDate = {}; WeatherStore._gddCache = {};
    pedidas = []; anonEscrituras = [];
    globalThis.localStorage = { getItem: (k) => (k === 'xanic_session_token' ? 'tok-123' : null) };
    // The anon client may read the schema probe, and must never write.
    const write = (op) => async () => { anonEscrituras.push(op); return { error: null }; };
    DataStore.supabase = { from: () => ({
      select: () => ({ limit: async () => ({ data: [], error: null }) }),
      upsert: write('upsert'), insert: write('insert'), update: write('update'),
    }) };
    globalThis.fetch = async (url, opts = {}) => {
      pedidas.push({ url: String(url), opts });
      if (String(url) !== '/api/meteorologia') throw new Error(`browser fetched ${url}`);
      const { valle, desde } = JSON.parse(opts.body);
      return jsonRes(200, { ok: true, filas: [{ date: desde, location: valle, temp_avg: 20 }] });
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; delete globalThis.localStorage; DataStore.supabase = null; });

  it('posts each valley and gap with the session token; no anon write, no Open-Meteo from the browser', async () => {
    await WeatherStore._syncInner([2020], () => ({ start: '2020-07-01', end: '2020-07-05' }));
    assert.deepEqual(anonEscrituras, []);
    assert.equal(pedidas.length, 3);
    for (const p of pedidas) {
      assert.equal(p.opts.method, 'POST');
      assert.equal(p.opts.headers['x-session-token'], 'tok-123');
    }
    assert.deepEqual(pedidas.map(p => JSON.parse(p.opts.body)).sort((a, b) => a.valle.localeCompare(b.valle)), [
      { valle: 'SV', desde: '2020-07-01', hasta: '2020-07-05' },
      { valle: 'VDG', desde: '2020-07-01', hasta: '2020-07-05' },
      { valle: 'VON', desde: '2020-07-01', hasta: '2020-07-05' },
    ]);
    assert.equal(WeatherStore._byDate['2020-07-01'].VDG.temp_avg, 20);
  });

  it('a refused sync (revoked session) leaves the store unchanged', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      pedidas.push({ url: String(url), opts });
      return jsonRes(401, { ok: false, error: 'No autorizado' });
    };
    await WeatherStore._syncInner([2020], () => ({ start: '2020-07-01', end: '2020-07-05' }));
    assert.deepEqual(anonEscrituras, []);
    assert.deepEqual(WeatherStore.data, []);
  });
});

describe('MT.86 - the migration drops the anon write on meteorology', () => {
  it('drops anon_insert and anon_update and revokes the write grants, keeping the read', () => {
    assert.ok(exists('../sql/migration_meteorologia_sin_escritura_anon.sql'), 'the migration file exists');
    const sql = read('../sql/migration_meteorologia_sin_escritura_anon.sql');
    assert.match(sql, /DROP POLICY IF EXISTS "anon_insert" ON public\.meteorology;/);
    assert.match(sql, /DROP POLICY IF EXISTS "anon_update" ON public\.meteorology;/);
    assert.match(sql, /ALTER TABLE public\.meteorology ENABLE ROW LEVEL SECURITY;/);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.meteorology FROM anon, authenticated;/);
    assert.doesNotMatch(sql, /DROP POLICY[^;]*"public_read"|REVOKE[^;]*SELECT/);
    assert.match(sql, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_meteorologia_sin_escritura_anon'\)\s+ON CONFLICT \(name\) DO NOTHING;/);
  });

  it('is in the manifest, and no later migration grants a write back', async () => {
    const { MIGRATIONS } = await import('../js/migrations-manifest.js');
    const i = MIGRATIONS.indexOf('migration_meteorologia_sin_escritura_anon');
    assert.ok(i >= 0, 'manifest lists migration_meteorologia_sin_escritura_anon');
    for (const m of MIGRATIONS.slice(i + 1)) {
      const sql = read(`../sql/${m}.sql`);
      assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON\s+(public\.)?meteorology\b[^;]*FOR\s+(INSERT|UPDATE|DELETE|ALL)/i, `${m} re-opens meteorology`);
      assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(TABLE\s+)?(public\.)?meteorology\b[^;]*TO[^;]*\b(anon|authenticated)\b/i, `${m} re-grants meteorology`);
    }
  });
});

const PG = process.env.XD_TEST_PG;

describe('MT.86 - anon rewrites a day before the migration and is refused after (Postgres)', { skip: !PG && 'XD_TEST_PG not set' }, () => {
  it('runs in one transaction that rolls back', () => {
    const migracion = read('../sql/migration_meteorologia_sin_escritura_anon.sql');
    // The pre-fix state, built only where the scratch database lacks it: the
    // Supabase roles, the table, the grant Supabase gives anon, and the
    // policies from schema.sql.
    const intentar = (fase) => `
SET LOCAL ROLE anon;
DO $$ DECLARE n int; BEGIN
  UPDATE public.meteorology SET temp_max = 99 WHERE date = '2025-08-01' AND location = 'VDG';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'MT86 ${fase} update filas=%', n;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'MT86 ${fase} update denegado';
END $$;
DO $$ BEGIN
  INSERT INTO public.meteorology (date, location, temp_max) VALUES ('2025-08-0${fase === 'antes' ? 2 : 3}', 'VDG', -40);
  RAISE NOTICE 'MT86 ${fase} insert ok';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'MT86 ${fase} insert denegado';
END $$;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.meteorology;
  RAISE NOTICE 'MT86 ${fase} select filas=%', n;
END $$;
RESET ROLE;`;
    const script = `
\\set ON_ERROR_STOP 1
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE IF NOT EXISTS public.applied_migrations (name text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.meteorology (date date, location text, temp_max numeric, UNIQUE (date, location));
INSERT INTO public.meteorology (date, location, temp_max) VALUES ('2025-08-01', 'VDG', 30)
  ON CONFLICT (date, location) DO NOTHING;
ALTER TABLE public.meteorology ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read" ON public.meteorology;
DROP POLICY IF EXISTS "anon_insert" ON public.meteorology;
DROP POLICY IF EXISTS "anon_update" ON public.meteorology;
CREATE POLICY "public_read" ON public.meteorology FOR SELECT USING (true);
CREATE POLICY "anon_insert" ON public.meteorology FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_update" ON public.meteorology FOR UPDATE USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meteorology TO anon, authenticated;
${intentar('antes')}
${migracion}
${intentar('despues')}
ROLLBACK;
`;
    // The NOTICEs are on stderr; ON_ERROR_STOP makes any SQL error a non-zero exit.
    const run = spawnSync('psql', [PG, '-qX'], { input: script, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const err = run.stderr;
    assert.match(err, /MT86 antes update filas=1/, 'anon rewrites a stored day before');
    assert.match(err, /MT86 antes insert ok/, 'anon inserts a made-up day before');
    assert.match(err, /MT86 despues update denegado/, 'anon refused an update after');
    assert.match(err, /MT86 despues insert denegado/, 'anon refused an insert after');
    assert.match(err, /MT86 despues select filas=[1-9]/, 'anon still reads after');
  });
});
